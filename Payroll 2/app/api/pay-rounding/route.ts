import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employeePayRounding, employees, payRoundingEntries } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { isCashRoundingUnit } from "../../../lib/pay-rounding";
import { readJsonObject } from "../../../lib/request-body";

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId")),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const joined=await db.select().from(employeePayRounding).innerJoin(employees,eq(employeePayRounding.employeeId,employees.id))
    .where(and(eq(employeePayRounding.employerId,employerId),eq(employees.employerId,employerId))).orderBy(desc(employeePayRounding.id));
  const visible=access.membership.canViewConfidential?joined:joined.filter(row=>!row.employees.confidential);
  const ids=new Set(visible.map(row=>row.employee_pay_rounding.id));
  const history=(await db.select().from(payRoundingEntries).orderBy(desc(payRoundingEntries.id))).filter(row=>ids.has(row.employeePayRoundingId));
  return NextResponse.json({settings:visible.map(row=>({...row.employee_pay_rounding,payrollId:row.employees.payrollId,employeeName:`${row.employees.firstName} ${row.employees.lastName}`})),history});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON cash-rounding object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  if(employee.paymentMethod!=="cash")return NextResponse.json({error:"Cash pay rounding can only be enabled for an employee whose payment method is cash."},{status:409});
  const unit=Number(input.unit);if(!isCashRoundingUnit(unit))return NextResponse.json({error:"Choose a rounding unit of £1, £5 or £10."},{status:422});
  const [existing]=await db.select().from(employeePayRounding).where(and(eq(employeePayRounding.employerId,employerId),eq(employeePayRounding.employeeId,employee.id))).limit(1);
  if(existing)return NextResponse.json({error:"This employee already has a cash-rounding ledger. Resume or update the existing ledger."},{status:409});
  const [created]=await db.insert(employeePayRounding).values({employerId,employeeId:employee.id,unit,carry:0,status:"active"}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:cash-pay-rounding",entityType:"cash-pay-rounding",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json(created,{status:201});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON cash-rounding update is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [joined]=await db.select().from(employeePayRounding).innerJoin(employees,eq(employeePayRounding.employeeId,employees.id))
    .where(and(eq(employeePayRounding.id,id),eq(employeePayRounding.employerId,employerId),eq(employees.employerId,employerId))).limit(1);
  if(!joined||joined.employees.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Cash-rounding ledger was not found."},{status:404});
  const existing=joined.employee_pay_rounding,action=String(input.action||"");
  if(action==="resume"&&existing.status!=="suspended")return NextResponse.json({error:"Only a suspended cash-rounding ledger can be resumed."},{status:409});
  if(action==="suspend"&&existing.status!=="active")return NextResponse.json({error:"Only an active cash-rounding ledger can be suspended."},{status:409});
  if(action==="stop"&&existing.carry>.005)return NextResponse.json({error:"Pay or clear the carried cash balance before stopping this ledger."},{status:409});
  if(action==="change-unit"&&existing.carry>.005)return NextResponse.json({error:"The rounding unit cannot change while a carried balance remains."},{status:409});
  if(!["resume","suspend","stop","change-unit"].includes(action))return NextResponse.json({error:"Action must be resume, suspend, stop or change-unit."},{status:422});
  if(action==="resume"&&joined.employees.paymentMethod!=="cash")return NextResponse.json({error:"Change the employee payment method back to cash before resuming rounding."},{status:409});
  const unit=action==="change-unit"?Number(input.unit):existing.unit;
  if(!isCashRoundingUnit(unit))return NextResponse.json({error:"Choose a rounding unit of £1, £5 or £10."},{status:422});
  const status=action==="resume"?"active":action==="suspend"?"suspended":action==="stop"?"stopped":existing.status;
  const [updated]=await db.update(employeePayRounding).set({status,unit,updatedAt:new Date().toISOString()}).where(eq(employeePayRounding.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`${action}:cash-pay-rounding`,entityType:"cash-pay-rounding",entityId:String(id),before:JSON.stringify(existing),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
