import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, payrollAdjustments, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";

const finalisedValueTypes=["gross-pay","taxable-pay","nicable-pay","statutory-pay","net-pay"];
const allowedTypes=[...finalisedValueTypes,"statutory-recovery","paye-tax","employee-nic","employer-nic","student-loan","postgraduate-loan"];
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
async function acceptedRtiExists(db:ReturnType<typeof getDb>,employerId:number,payPeriodId:number){
  const rows=await db.select({type:submissions.type,status:submissions.status}).from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.payPeriodId,payPeriodId)));
  return rows.some(row=>["FPS","Additional FPS"].includes(row.type)&&row.status==="accepted");
}
async function latestFinalisedPeriod(db:ReturnType<typeof getDb>,employerId:number,taxYear:string){
  const [period]=await db.select({id:payPeriods.id,periodNumber:payPeriods.periodNumber}).from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.status,"finalised"),
  )).orderBy(desc(payPeriods.periodNumber)).limit(1);
  return period||null;
}
async function applyToFinalisedRun(db:ReturnType<typeof getDb>,payPeriodId:number,employeeId:number,type:string,amount:number){
  const [run]=await db.select().from(payRuns).where(and(eq(payRuns.payPeriodId,payPeriodId),eq(payRuns.employeeId,employeeId),eq(payRuns.status,"finalised"))).limit(1);
  if(!run)throw new Error("The finalised employee pay record was not found.");
  const changes:Partial<typeof payRuns.$inferInsert>={updatedAt:new Date().toISOString()};
  let netPay=run.netPay;
  if(type==="gross-pay")changes.grossPay=round(run.grossPay+amount);
  if(type==="taxable-pay")changes.taxablePay=round(run.taxablePay+amount);
  if(type==="nicable-pay")changes.nicablePay=round(run.nicablePay+amount);
  if(type==="statutory-pay")changes.statutoryPay=round(run.statutoryPay+amount);
  if(type==="statutory-recovery")return {before:run,after:run};
  if(type==="net-pay")netPay+=amount;
  if(type==="paye-tax"){changes.payeTax=round(run.payeTax+amount);netPay-=amount;}
  if(type==="employee-nic"){changes.employeeNic=round(run.employeeNic+amount);netPay-=amount;}
  if(type==="employer-nic")changes.employerNic=round(run.employerNic+amount);
  if(type==="student-loan"){changes.studentLoan=round(run.studentLoan+amount);netPay-=amount;}
  if(type==="postgraduate-loan"){changes.postgraduateLoan=round(run.postgraduateLoan+amount);netPay-=amount;}
  changes.netPay=round(netPay);
  for(const [field,value] of Object.entries(changes))if(field!=="updatedAt"&&Number(value)<0)throw new Error(`The correction would make ${field} negative.`);
  const [updated]=await db.update(payRuns).set(changes).where(eq(payRuns.id,run.id)).returning();
  return {before:run,after:updated};
}

export async function GET(request:Request) {
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select({
    id:payrollAdjustments.id,employeeId:payrollAdjustments.employeeId,payrollId:employees.payrollId,
    firstName:employees.firstName,lastName:employees.lastName,periodNumber:payPeriods.periodNumber,type:payrollAdjustments.type,
    amount:payrollAdjustments.amount,reason:payrollAdjustments.reason,status:payrollAdjustments.status,
    createdBy:payrollAdjustments.createdBy,reversedAt:payrollAdjustments.reversedAt,createdAt:payrollAdjustments.createdAt,
    confidential:employees.confidential,
  }).from(payrollAdjustments).innerJoin(employees,eq(payrollAdjustments.employeeId,employees.id))
    .innerJoin(payPeriods,eq(payrollAdjustments.payPeriodId,payPeriods.id)).where(and(
      eq(payrollAdjustments.employerId,employerId),eq(employees.employerId,employerId),
      eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),
    )).orderBy(asc(payrollAdjustments.id));
  return NextResponse.json(access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential));
}

export async function POST(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON payroll-adjustment object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const taxYear=String(input.taxYear||""),periodNumber=Number(input.periodNumber),type=String(input.type||"");
  const amount=Math.round(Number(input.amount)*100)/100,reason=String(input.reason||"").trim();
  if(!/^\d{4}\/\d{2}$/.test(taxYear)||Number(taxYear.slice(5))!==(Number(taxYear.slice(0,4))+1)%100)return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  if(!allowedTypes.includes(type))return NextResponse.json({error:"Unsupported payroll adjustment type."},{status:400});
  if(!Number.isFinite(amount)||amount===0)return NextResponse.json({error:"The adjustment must be a non-zero signed amount."},{status:422});
  if(reason.length<5||reason.length>500)return NextResponse.json({error:"Enter an audit reason between 5 and 500 characters."},{status:422});
  const [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber))).limit(1);
  if(!period)return NextResponse.json({error:"The payroll period was not found."},{status:404});
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"The employee was not found for this employer."},{status:404});
  const finalisedCorrection=period.status==="finalised";
  if(finalisedValueTypes.includes(type)&&!finalisedCorrection)return NextResponse.json({error:"Gross, taxable, NIC-able, statutory and net pay overrides are reserved for finalised periods with an accepted FPS baseline. Correct open-period earnings through payroll items instead."},{status:409});
  if(type==="statutory-recovery"&&!finalisedCorrection)return NextResponse.json({error:"Correct open-period statutory recovery through the underlying leave record. Manual HMRC recovery adjustments are reserved for accepted, finalised payroll."},{status:409});
  if(finalisedCorrection&&!await acceptedRtiExists(db,employerId,period.id))return NextResponse.json({error:"Reopen this finalised period before adding a correction. Direct finalised corrections are reserved for periods with an HMRC-accepted FPS baseline."},{status:409});
  if(finalisedCorrection){
    const latest=await latestFinalisedPeriod(db,employerId,taxYear);
    if(!latest||latest.id!==period.id)return NextResponse.json({
      error:`Period ${latest?.periodNumber||periodNumber} is the latest finalised period. Apply the cumulative correction there; editing period ${periodNumber} would leave later year-to-date payroll and RTI evidence inconsistent.`,
    },{status:409});
  }
  if(!finalisedCorrection&&!["open","draft"].includes(period.status))return NextResponse.json({error:"Adjustments can only be added to an open payroll period."},{status:409});
  const [duplicate]=await db.select({id:payrollAdjustments.id}).from(payrollAdjustments).where(and(
    eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.employeeId,employee.id),
    eq(payrollAdjustments.payPeriodId,period.id),eq(payrollAdjustments.type,type),
    eq(payrollAdjustments.amount,amount),eq(payrollAdjustments.reason,reason),eq(payrollAdjustments.status,"active"),
  )).limit(1);
  if(duplicate)return NextResponse.json({error:"An identical active correction already exists for this employee and period."},{status:409});
  const [created]=await db.insert(payrollAdjustments).values({
    employerId,employeeId:employee.id,payPeriodId:period.id,type,amount,reason,status:"active",createdBy:access.user.email,
  }).returning();
  let finalisedRunCorrection:null|Awaited<ReturnType<typeof applyToFinalisedRun>>=null;
  try{if(finalisedCorrection)finalisedRunCorrection=await applyToFinalisedRun(db,period.id,employee.id,type,amount);}
  catch(error){await db.delete(payrollAdjustments).where(eq(payrollAdjustments.id,created.id));return NextResponse.json({error:error instanceof Error?error.message:"The finalised correction could not be applied."},{status:422});}
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:finalisedCorrection?"created:finalised-rti-correction":"created",entityType:"payroll-adjustment",entityId:String(created.id),before:finalisedRunCorrection?JSON.stringify(finalisedRunCorrection.before):null,after:JSON.stringify({adjustment:created,payRun:finalisedRunCorrection?.after||null})});
  return NextResponse.json({...created,finalisedCorrection,additionalFpsRequired:finalisedCorrection&&type!=="statutory-recovery",epsRequired:finalisedCorrection&&type==="statutory-recovery"},{status:201});
}

export async function PUT(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON payroll-adjustment update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(input.action!=="reverse")return NextResponse.json({error:"Unsupported adjustment action."},{status:400});
  const [existing]=await db.select({
    id:payrollAdjustments.id,status:payrollAdjustments.status,payPeriodId:payrollAdjustments.payPeriodId,employeeId:payrollAdjustments.employeeId,
    type:payrollAdjustments.type,amount:payrollAdjustments.amount,reason:payrollAdjustments.reason,periodStatus:payPeriods.status,
    periodNumber:payPeriods.periodNumber,taxYear:payPeriods.taxYear,
    confidential:employees.confidential,
  }).from(payrollAdjustments).innerJoin(payPeriods,eq(payrollAdjustments.payPeriodId,payPeriods.id))
    .innerJoin(employees,eq(payrollAdjustments.employeeId,employees.id)).where(and(
    eq(payrollAdjustments.id,id),eq(payrollAdjustments.employerId,employerId),eq(payPeriods.employerId,employerId),
    eq(employees.employerId,employerId),
  )).limit(1);
  if(!existing||existing.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"The payroll adjustment was not found for this employer."},{status:404});
  if(existing.status!=="active")return NextResponse.json({error:"Only an active adjustment can be reversed."},{status:409});
  const finalisedCorrection=existing.periodStatus==="finalised";
  if(finalisedCorrection&&!await acceptedRtiExists(db,employerId,existing.payPeriodId))return NextResponse.json({error:"Reopen the latest payroll period before reversing this adjustment."},{status:409});
  if(finalisedCorrection){
    const latest=await latestFinalisedPeriod(db,employerId,existing.taxYear);
    if(!latest||latest.id!==existing.payPeriodId)return NextResponse.json({
      error:`Period ${latest?.periodNumber||existing.periodNumber} is the latest finalised period. Reverse the cumulative correction there; changing period ${existing.periodNumber} would leave later year-to-date payroll and RTI evidence inconsistent.`,
    },{status:409});
  }
  let finalisedRunCorrection:null|Awaited<ReturnType<typeof applyToFinalisedRun>>=null;
  try{if(finalisedCorrection)finalisedRunCorrection=await applyToFinalisedRun(db,existing.payPeriodId,existing.employeeId,existing.type,-existing.amount);}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The finalised correction could not be reversed."},{status:422});}
  const [updated]=await db.update(payrollAdjustments).set({status:"reversed",reversedAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
    .where(and(eq(payrollAdjustments.id,id),eq(payrollAdjustments.employerId,employerId))).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:finalisedCorrection?"reversed:finalised-rti-correction":"reversed",entityType:"payroll-adjustment",entityId:String(id),before:JSON.stringify({adjustment:existing,payRun:finalisedRunCorrection?.before||null}),after:JSON.stringify({adjustment:updated,payRun:finalisedRunCorrection?.after||null})});
  return NextResponse.json({...updated,finalisedCorrection,additionalFpsRequired:finalisedCorrection&&existing.type!=="statutory-recovery",epsRequired:finalisedCorrection&&existing.type==="statutory-recovery"});
}
