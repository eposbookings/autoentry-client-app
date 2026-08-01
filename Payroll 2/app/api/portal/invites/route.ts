import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLog, employeePortalInvites, employees } from "../../../../db/schema";
import { hashSecret, randomSecret } from "../../../../lib/portal-auth";
import { requireEmployerAccess } from "../../../../lib/admin-auth";

export async function POST(request:Request) {
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON portal invitation object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON portal invitation object is required."},{status:400});
  const db=getDb(),employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  if(!employee.employeePortal)return NextResponse.json({error:"Enable employee portal access on the employee record first."},{status:409});
  const now=new Date().toISOString(),code=randomSecret(),expiresAt=new Date(Date.now()+7*86_400_000).toISOString();
  await db.update(employeePortalInvites).set({usedAt:now,updatedAt:now}).where(and(
    eq(employeePortalInvites.employeeId,employee.id),isNull(employeePortalInvites.usedAt),
  ));
  const [invite]=await db.insert(employeePortalInvites).values({employeeId:employee.id,codeHash:await hashSecret(code),expiresAt}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"created:employee-portal-invite",entityType:"employee",entityId:String(employee.id),after:JSON.stringify({inviteId:invite.id,expiresAt})});
  return NextResponse.json({id:invite.id,employeeId:employee.id,code,expiresAt,note:"Show this one-time code to the employee securely; it is not stored in recoverable form."},{status:201});
}
