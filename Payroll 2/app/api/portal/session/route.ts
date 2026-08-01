import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { employeePortalInvites, employeePortalSessions, employees } from "../../../../db/schema";
import { hashSecret, portalSession, randomSecret } from "../../../../lib/portal-auth";

export async function POST(request:Request) {
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON portal sign-in object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON portal sign-in object is required."},{status:400});
  const code=String(input.code||"").replace(/\s/g,"").toUpperCase(),db=getDb(),now=new Date().toISOString();
  if(code.length<20)return NextResponse.json({error:"Invite code is invalid, expired or already used."},{status:401});
  const [invite]=await db.select().from(employeePortalInvites).where(and(eq(employeePortalInvites.codeHash,await hashSecret(code)),gt(employeePortalInvites.expiresAt,now),isNull(employeePortalInvites.usedAt))).limit(1);
  if(!invite)return NextResponse.json({error:"Invite code is invalid, expired or already used."},{status:401});
  const [employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,invite.employeeId),eq(employees.employeePortal,true))).limit(1);
  if(!employee)return NextResponse.json({error:"Employee portal access is disabled."},{status:403});
  const token=randomSecret(),expiresAt=new Date(Date.now()+8*3_600_000).toISOString();
  const [session]=await db.insert(employeePortalSessions).values({employeeId:invite.employeeId,tokenHash:await hashSecret(token),expiresAt}).returning();
  const consumed=await db.update(employeePortalInvites).set({usedAt:now,updatedAt:now}).where(and(
    eq(employeePortalInvites.id,invite.id),isNull(employeePortalInvites.usedAt),
  )).returning();
  if(!consumed.length){
    await db.update(employeePortalSessions).set({revokedAt:now}).where(eq(employeePortalSessions.id,session.id));
    return NextResponse.json({error:"Invite code is invalid, expired or already used."},{status:401});
  }
  const response=NextResponse.json({authenticated:true,expiresAt});
  const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
  response.headers.set("set-cookie",`payflow_portal=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`);
  return response;
}

export async function DELETE(request:Request) {
  const session=await portalSession(request);
  const response=NextResponse.json({authenticated:false});
  response.headers.set("set-cookie","payflow_portal=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  if(session)await getDb().update(employeePortalSessions).set({revokedAt:new Date().toISOString()}).where(eq(employeePortalSessions.id,session.sessionId));
  return response;
}
