import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { attachmentOrderDeductions, attachmentOrders, auditLog, employees, employers } from "../../../db/schema";
import { attachmentPriority, calculateAttachment } from "../../../lib/attachment-engine";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
const validIsoDate=(value:unknown)=>{
  const text=String(value||""),timestamp=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
};

export async function GET(request:Request) {
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||1),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const joined=await db.select().from(attachmentOrders).innerJoin(employees,eq(attachmentOrders.employeeId,employees.id))
    .where(eq(employees.employerId,employerId)).orderBy(desc(attachmentOrders.id));
  const orders=access.membership.canViewConfidential?joined:joined.filter(row=>!row.employees.confidential);
  const orderIds=new Set(orders.map(row=>row.attachment_orders.id));
  const history=(await db.select().from(attachmentOrderDeductions).orderBy(desc(attachmentOrderDeductions.id))).filter(row=>orderIds.has(row.attachmentOrderId));
  return NextResponse.json({orders:orders.map(row=>row.attachment_orders),history});
}

export async function POST(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON attachment-order object is required."},{status:400});
  const db=getDb(),employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const calculationRule=String(input.calculationRule||"manual");
  const payFrequency=String(input.payFrequency||"monthly");
  const rules=["manual","aeo-priority","aeo-non-priority","dea-standard","dea-higher","dea-fixed","child-maintenance","council-tax-england-wales","scottish-earnings-arrestment","scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed","ni-court-fine","ni-ejo"];
  if(!rules.includes(calculationRule))return NextResponse.json({error:"Select a supported attachment calculation rule."},{status:400});
  if(!["monthly","weekly","fortnightly","four-weekly"].includes(payFrequency))return NextResponse.json({error:"Attachment pay frequency must be monthly, weekly, fortnightly or four-weekly."},{status:422});
  const [employer]=await db.select({payFrequency:employers.payFrequency}).from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  if(payFrequency!==employer.payFrequency)return NextResponse.json({error:"Attachment-order frequency must match the employer payroll schedule."},{status:422});
  const amounts={netPay:Number(input.netPay||0),deductionValue:Number(input.deductionValue||0),protectedEarnings:Number(input.protectedEarnings||0),balance:input.balance==null?null:Number(input.balance),adminFee:Number(input.adminFee??1),arrears:Number(input.arrears||0),periodDays:Number(input.periodDays||0),ordinaryDebtBalance:input.ordinaryDebtBalance==null?null:Number(input.ordinaryDebtBalance),maintenanceDailyRate:Number(input.maintenanceDailyRate||0)};
  if(Object.values(amounts).some(value=>value!==null&&(!Number.isFinite(value)||value<0)))return NextResponse.json({error:"Attachment amounts must be valid non-negative numbers."},{status:422});
  if(input.action==="preview")return NextResponse.json(calculateAttachment({
    netPay:amounts.netPay,type:String(input.type),deductionType:input.deductionType==="percentage"?"percentage":"fixed",
    deductionValue:amounts.deductionValue,calculationRule:calculationRule as any,payFrequency:payFrequency as any,
    protectedEarnings:amounts.protectedEarnings,balance:amounts.balance,adminFee:amounts.adminFee,arrears:amounts.arrears,
    periodDays:amounts.periodDays,
    ordinaryDebtBalance:amounts.ordinaryDebtBalance,maintenanceDailyRate:amounts.maintenanceDailyRate,
  }));
  const [employee]=await db.select({id:employees.id,confidential:employees.confidential}).from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  if(!["fixed","percentage"].includes(String(input.deductionType)))return NextResponse.json({error:"Deduction type must be fixed or percentage."},{status:400});
  const type=String(input.type||"").trim(),authority=String(input.issuingAuthority||"").trim(),reference=String(input.reference||"").trim();
  if(type.length<3||authority.length<2||reference.length<3)return NextResponse.json({error:"Order type, issuing authority and a legal reference are required."},{status:422});
  if(!validIsoDate(input.effectiveDate))return NextResponse.json({error:"Enter a valid attachment-order effective date."},{status:422});
  if(["manual","aeo-priority","aeo-non-priority","dea-fixed","child-maintenance","ni-ejo","scottish-current-maintenance","scottish-conjoined-maintenance"].includes(calculationRule)&&amounts.deductionValue<=0)return NextResponse.json({error:"This attachment rule requires a positive instructed deduction."},{status:422});
  if(["aeo-priority","aeo-non-priority","ni-ejo"].includes(calculationRule)&&amounts.protectedEarnings<=0)return NextResponse.json({error:"Court AEOs require the positive protected earnings rate printed on the order."},{status:422});
  if(calculationRule==="scottish-conjoined-mixed"&&
    (!(Number(amounts.ordinaryDebtBalance)>0)||amounts.maintenanceDailyRate<=0))
    return NextResponse.json({error:"Mixed Scottish conjoined orders require a positive ordinary-debt balance and aggregate maintenance daily rate."},{status:422});
  if(amounts.balance!==null&&amounts.balance<=0)return NextResponse.json({error:"Outstanding balance must be positive or left blank."},{status:422});
  const requestedPriority=Number(input.priority??50);
  if(!Number.isFinite(requestedPriority)||requestedPriority<1||requestedPriority>100)return NextResponse.json({error:"Attachment priority must be between 1 and 100."},{status:422});
  const [duplicate]=await db.select({id:attachmentOrders.id}).from(attachmentOrders).where(and(
    eq(attachmentOrders.employeeId,employee.id),eq(attachmentOrders.reference,reference),eq(attachmentOrders.status,"active"),
  )).limit(1);
  if(duplicate)return NextResponse.json({error:"An active attachment order with this legal reference already exists for the employee."},{status:409});
  const [created]=await db.insert(attachmentOrders).values({
    employeeId:employee.id,type,issuingAuthority:authority,reference,protectedEarnings:amounts.protectedEarnings,
    deductionType:String(input.deductionType),deductionValue:amounts.deductionValue,
    calculationRule,payFrequency,priority:attachmentPriority(type,requestedPriority),
    arrears:amounts.arrears,effectiveDate:String(input.effectiveDate),
    adminFee:amounts.adminFee,balance:amounts.balance,status:"active",
    ordinaryDebtBalance:amounts.ordinaryDebtBalance,maintenanceDailyRate:amounts.maintenanceDailyRate,
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:attachment-order",entityType:"attachment-order",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json(created,{status:201});
}

export async function PUT(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON attachment-order update object is required."},{status:400});
  const db=getDb(),employerId=Number(input.employerId),id=Number(input.id);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [existing]=await db.select().from(attachmentOrders).innerJoin(employees,eq(attachmentOrders.employeeId,employees.id))
    .where(and(eq(attachmentOrders.id,id),eq(employees.employerId,employerId))).limit(1);
  if(!existing||existing.employees.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Attachment order was not found for this employer."},{status:404});
  const action=String(input.action||"");
  if(!["suspend","resume","stop"].includes(action))return NextResponse.json({error:"Attachment action must be suspend, resume or stop."},{status:400});
  if(existing.attachment_orders.status==="completed")return NextResponse.json({error:"A completed attachment order cannot be changed."},{status:409});
  if(action==="resume"&&existing.attachment_orders.status!=="suspended")return NextResponse.json({error:"Only a suspended attachment order can be resumed."},{status:409});
  if(action==="suspend"&&existing.attachment_orders.status!=="active")return NextResponse.json({error:"Only an active attachment order can be suspended."},{status:409});
  const status=action==="resume"?"active":action==="suspend"?"suspended":"completed";
  const [updated]=await db.update(attachmentOrders).set({status,updatedAt:new Date().toISOString()}).where(eq(attachmentOrders.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`${action}:attachment-order`,entityType:"attachment-order",entityId:String(id),before:JSON.stringify(existing.attachment_orders),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
