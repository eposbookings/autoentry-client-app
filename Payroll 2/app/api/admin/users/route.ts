import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { adminUsers, auditLog, employerMemberships } from "../../../../db/schema";
import { hashPassword, requireEmployerAccess } from "../../../../lib/admin-auth";
import { readJsonObject } from "../../../../lib/request-body";

const roles=["admin","payroll","manager","viewer"];
export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||1),access=await requireEmployerAccess(request,employerId,"employer-admin");
  if(!access.ok)return access.response;
  return NextResponse.json(await getDb().select({
    id:adminUsers.id,membershipId:employerMemberships.id,email:adminUsers.email,displayName:adminUsers.displayName,role:employerMemberships.role,
    canViewConfidential:employerMemberships.canViewConfidential,status:employerMemberships.status,
  }).from(employerMemberships).innerJoin(adminUsers,eq(employerMemberships.userId,adminUsers.id)).where(eq(employerMemberships.employerId,employerId)));
}
export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON administrator object is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"employer-admin");
  if(!access.ok)return access.response;
  const email=String(input.email||"").trim().toLowerCase(),password=String(input.temporaryPassword||"");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10)return NextResponse.json({error:"A valid email and temporary password of at least 10 characters are required."},{status:422});
  const role=roles.includes(input.role)?input.role:"viewer",db=getDb();
  let [user]=await db.select().from(adminUsers).where(eq(adminUsers.email,email)).limit(1);
  if(!user)[user]=await db.insert(adminUsers).values({email,displayName:String(input.displayName||email),passwordHash:await hashPassword(password)}).returning();
  const existing=await db.select().from(employerMemberships).where(and(eq(employerMemberships.employerId,employerId),eq(employerMemberships.userId,user.id))).limit(1);
  if(existing.length)return NextResponse.json({error:"This user already belongs to the employer."},{status:409});
  const [membership]=await db.insert(employerMemberships).values({employerId,userId:user.id,role,canViewConfidential:Boolean(input.canViewConfidential)}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:employer-membership",entityType:"employer-membership",entityId:String(membership.id),after:JSON.stringify({userId:user.id,email:user.email,role,canViewConfidential:membership.canViewConfidential})});
  return NextResponse.json({user:{id:user.id,email:user.email,displayName:user.displayName},membership},{status:201});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON administrator update object is required."},{status:400});
  const employerId=Number(input.employerId),membershipId=Number(input.membershipId),access=await requireEmployerAccess(request,employerId,"employer-admin");
  if(!access.ok)return access.response;
  if(!Number.isInteger(membershipId)||membershipId<1)return NextResponse.json({error:"A valid employer membership is required."},{status:422});
  const role=String(input.role||""),status=String(input.status||"active");
  if(!["owner",...roles].includes(role)||!["active","revoked"].includes(status))return NextResponse.json({error:"Choose a valid role and membership status."},{status:422});
  const db=getDb(),[before]=await db.select().from(employerMemberships).where(and(eq(employerMemberships.id,membershipId),eq(employerMemberships.employerId,employerId))).limit(1);
  if(!before)return NextResponse.json({error:"Employer membership was not found."},{status:404});
  const removesAdmin=["owner","admin"].includes(before.role)&&(status!=="active"||!["owner","admin"].includes(role));
  if(removesAdmin){
    const members=await db.select().from(employerMemberships).where(and(eq(employerMemberships.employerId,employerId),eq(employerMemberships.status,"active")));
    if(members.filter(item=>["owner","admin"].includes(item.role)).length<=1)return NextResponse.json({error:"The last active employer administrator cannot be demoted or revoked."},{status:409});
  }
  const timestamp=new Date().toISOString(),[membership]=await db.update(employerMemberships).set({role,status,canViewConfidential:Boolean(input.canViewConfidential),updatedAt:timestamp}).where(and(eq(employerMemberships.id,membershipId),eq(employerMemberships.employerId,employerId))).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:status==="revoked"?"revoked:employer-membership":"updated:employer-membership",entityType:"employer-membership",entityId:String(membershipId),before:JSON.stringify(before),after:JSON.stringify(membership)});
  return NextResponse.json({membership});
}
