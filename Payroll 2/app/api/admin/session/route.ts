import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { adminSessions, adminUsers, employerMemberships, employers, employerSettings } from "../../../../db/schema";
import { currentAdmin, hashPassword, randomToken, sessionCookie, sha256, verifyPassword } from "../../../../lib/admin-auth";
import { payrollRoleForEpos, trustedEposContext } from "../../../../lib/epos-integration";
import { readJsonObject } from "../../../../lib/request-body";

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const expires=()=>new Date(Date.now()+12*60*60*1000).toISOString();
function withCookie(response:NextResponse,request:Request,token:string,maxAge=43200){
  response.headers.append("set-cookie",`${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==="https:"?"; Secure":""}`);
  return response;
}
async function memberships(userId:number){
  return getDb().select({
    employerId:employerMemberships.employerId,employerName:employers.name,taxYear:employers.taxYear,payFrequency:employers.payFrequency,role:employerMemberships.role,
    canViewConfidential:employerMemberships.canViewConfidential,employerStatus:employers.status,
    firstPayDate:employerSettings.firstPayDate,clientStatus:employerSettings.clientStatus,managedBy:employerSettings.managedBy,colourReference:employerSettings.colourReference,
    finalFpsDue:employerSettings.finalFpsDue,epsDue:employerSettings.epsDue,p60Due:employerSettings.p60Due,p11dDue:employerSettings.p11dDue,
  }).from(employerMemberships).innerJoin(employers,eq(employerMemberships.employerId,employers.id))
    .leftJoin(employerSettings,eq(employerMemberships.employerId,employerSettings.employerId))
    .where(and(eq(employerMemberships.userId,userId),eq(employerMemberships.status,"active")));
}
async function createSession(userId:number){
  const token=randomToken();
  await getDb().insert(adminSessions).values({userId,tokenHash:await sha256(token),expiresAt:expires()});
  return token;
}

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||1),db=getDb(),user=await currentAdmin(request);
  const trusted=await trustedEposContext(request,employerId);
  if(trusted){
    const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
    const [settings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
    if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
    return NextResponse.json({authenticated:true,user:{id:trusted.userId,email:trusted.email,displayName:trusted.displayName},memberships:[{
      employerId,employerName:employer.name,taxYear:employer.taxYear,payFrequency:employer.payFrequency,
      role:payrollRoleForEpos(trusted.role),canViewConfidential:trusted.canViewConfidential,
      employerStatus:employer.status,firstPayDate:settings?.firstPayDate||null,clientStatus:settings?.clientStatus||"active",
      managedBy:settings?.managedBy||null,colourReference:settings?.colourReference||"#087b79",
      finalFpsDue:settings?.finalFpsDue||null,epsDue:settings?.epsDue||null,p60Due:settings?.p60Due||null,p11dDue:settings?.p11dDue||null,
    }]});
  }
  const existing=await db.select({id:employerMemberships.id}).from(employerMemberships).where(eq(employerMemberships.employerId,employerId)).limit(1);
  if(!user)return NextResponse.json({authenticated:false,setupRequired:existing.length===0});
  return NextResponse.json({authenticated:true,user:{id:user.userId,email:user.email,displayName:user.displayName},memberships:await memberships(user.userId)});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON authentication object is required."},{status:400});
  const action=String(input.action||"login"),email=String(input.email||"").trim().toLowerCase(),password=String(input.password||""),db=getDb();
  if(!emailPattern.test(email))return NextResponse.json({error:"Enter a valid email address."},{status:422});
  if(password.length<10)return NextResponse.json({error:"Password must contain at least 10 characters."},{status:422});
  if(action==="bootstrap"){
    const employerId=Number(input.employerId);
    const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
    if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
    const existing=await db.select({id:employerMemberships.id}).from(employerMemberships).where(eq(employerMemberships.employerId,employerId)).limit(1);
    if(existing.length)return NextResponse.json({error:"This employer already has an administrator."},{status:409});
    let [user]=await db.select().from(adminUsers).where(eq(adminUsers.email,email)).limit(1);
    if(user&&!await verifyPassword(password,user.passwordHash))return NextResponse.json({error:"That email belongs to an existing account; sign in first."},{status:409});
    if(!user)[user]=await db.insert(adminUsers).values({email,displayName:String(input.displayName||"Payroll administrator").trim(),passwordHash:await hashPassword(password)}).returning();
    await db.insert(employerMemberships).values({employerId,userId:user.id,role:"owner",canViewConfidential:true});
    const token=await createSession(user.id);
    return withCookie(NextResponse.json({authenticated:true,user:{id:user.id,email:user.email,displayName:user.displayName},memberships:await memberships(user.id)},{status:201}),request,token);
  }
  if(action!=="login")return NextResponse.json({error:"Unsupported authentication action."},{status:400});
  const [user]=await db.select().from(adminUsers).where(eq(adminUsers.email,email)).limit(1);
  if(!user||user.status!=="active"||!await verifyPassword(password,user.passwordHash))return NextResponse.json({error:"Email or password is incorrect."},{status:401});
  await db.update(adminUsers).set({lastLoginAt:new Date().toISOString(),updatedAt:new Date().toISOString()}).where(eq(adminUsers.id,user.id));
  const token=await createSession(user.id);
  return withCookie(NextResponse.json({authenticated:true,user:{id:user.id,email:user.email,displayName:user.displayName},memberships:await memberships(user.id)}),request,token);
}

export async function DELETE(request:Request){
  const user=await currentAdmin(request);
  if(user)await getDb().update(adminSessions).set({revokedAt:new Date().toISOString()}).where(eq(adminSessions.id,user.sessionId));
  return withCookie(NextResponse.json({signedOut:true}),request,"",0);
}
