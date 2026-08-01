import { NextResponse } from "next/server";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, payItems, payPeriods, payRuns, recurringPayItems } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";
import { childcareVoucherBandFromName, childcareVoucherLimit } from "../../../lib/childcare-vouchers";

const allowedTypes=["earning","benefit","pre-tax-deduction","post-tax-deduction","salary-sacrifice","payroll-giving","childcare-voucher"];
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;

export async function GET(request:Request) {
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select({
    id:recurringPayItems.id,employeeId:recurringPayItems.employeeId,payrollId:employees.payrollId,
    employeeName:employees.firstName,taxYear:recurringPayItems.taxYear,type:recurringPayItems.type,name:recurringPayItems.name,amount:recurringPayItems.amount,
    taxable:recurringPayItems.taxable,nicable:recurringPayItems.nicable,pensionable:recurringPayItems.pensionable,
    startPeriod:recurringPayItems.startPeriod,endPeriod:recurringPayItems.endPeriod,status:recurringPayItems.status,
    confidential:employees.confidential,
  }).from(recurringPayItems).innerJoin(employees,eq(recurringPayItems.employeeId,employees.id))
    .where(and(eq(recurringPayItems.employerId,employerId),eq(recurringPayItems.taxYear,taxYear),eq(employees.employerId,employerId))).orderBy(asc(recurringPayItems.id));
  return NextResponse.json(access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential));
}

export async function POST(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON recurring-pay-item object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const taxYear=String(input.taxYear||""),type=String(input.type||""),name=String(input.name||"").trim(),amount=Math.round(Number(input.amount||0)*100)/100;
  const startPeriod=Number(input.startPeriod),endPeriod=Number(input.endPeriod);
  if(!allowedTypes.includes(type))return NextResponse.json({error:"Unsupported recurring pay-item type."},{status:400});
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Enter a consecutive schedule tax year in YYYY/YY format."},{status:422});
  if(name.length<3||name.length>100||!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"A description of 3 to 100 characters and positive amount are required."},{status:422});
  const [employer]=await db.select({payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate})
    .from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  let maximumPeriods=0;
  try{maximumPeriods=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined).length;}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(!Number.isInteger(startPeriod)||!Number.isInteger(endPeriod)||startPeriod<1||endPeriod>maximumPeriods||endPeriod<startPeriod)return NextResponse.json({error:`The schedule must use valid payroll periods from 1 to ${maximumPeriods}.`},{status:422});
  const classificationFields=["taxable","nicable","pensionable"] as const;
  if(classificationFields.some(field=>typeof input[field]!=="boolean"))
    return NextResponse.json({error:"Taxable, NIC-able and pensionable classifications must each be explicitly true or false."},{status:422});
  if(type==="childcare-voucher"){
    const taxBand=childcareVoucherBandFromName(name);
    if(!taxBand)return NextResponse.json({error:'Childcare-voucher schedules must name the basic, higher or additional band, for example "Legacy childcare voucher salary sacrifice · basic".'},{status:422});
    const frequency=payrollFrequencyRule(employer.payFrequency).frequency;
    if(amount>childcareVoucherLimit(taxBand,frequency))
      return NextResponse.json({error:`The scheduled voucher exceeds the ${frequency.replace("-"," ")} ${taxBand}-rate exemption. Use the guided payroll workflow for a voucher with Class 1 excess.`},{status:422});
    if(input.taxable!==false||input.nicable!==false)
      return NextResponse.json({error:"A childcare-voucher salary sacrifice schedule must be non-taxable and non-NICable."},{status:422});
  }
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"The employee was not found for this employer."},{status:404});
  const [firstOpen]=await db.select({periodNumber:payPeriods.periodNumber}).from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.status,"open"),
  )).orderBy(asc(payPeriods.periodNumber)).limit(1);
  const [firstExisting]=firstOpen?[]:await db.select({periodNumber:payPeriods.periodNumber}).from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),
  )).orderBy(asc(payPeriods.periodNumber)).limit(1);
  if(!firstOpen&&firstExisting)return NextResponse.json({error:"This tax year has no open payroll period for a new schedule."},{status:409});
  const firstOpenPeriod=firstOpen?.periodNumber||1;
  if(startPeriod<firstOpenPeriod)return NextResponse.json({error:`A new schedule cannot start before open Period ${firstOpenPeriod}.`},{status:409});
  const [duplicate]=await db.select({id:recurringPayItems.id}).from(recurringPayItems).where(and(
    eq(recurringPayItems.employerId,employerId),eq(recurringPayItems.employeeId,employee.id),eq(recurringPayItems.taxYear,taxYear),
    eq(recurringPayItems.type,type),eq(recurringPayItems.name,name),eq(recurringPayItems.amount,amount),
    eq(recurringPayItems.startPeriod,startPeriod),eq(recurringPayItems.endPeriod,endPeriod),eq(recurringPayItems.status,"active"),
  )).limit(1);
  if(duplicate)return NextResponse.json({error:"An identical active pay schedule already exists for this employee."},{status:409});
  const [created]=await db.insert(recurringPayItems).values({
    employerId,employeeId:employee.id,taxYear,type,name,amount,taxable:input.taxable,nicable:input.nicable,
    pensionable:input.pensionable,startPeriod,endPeriod,status:"active",
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"created",entityType:"recurring-pay-item",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json(created,{status:201});
}

export async function PUT(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON recurring-pay-item update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [existing]=await db.select({...getTableColumns(recurringPayItems),confidential:employees.confidential}).from(recurringPayItems)
    .innerJoin(employees,eq(recurringPayItems.employeeId,employees.id))
    .where(and(eq(recurringPayItems.id,id),eq(recurringPayItems.employerId,employerId),eq(employees.employerId,employerId))).limit(1);
  if(!existing||existing.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"The recurring pay item was not found for this employer."},{status:404});
  if(input.action!=="stop")return NextResponse.json({error:"Unsupported schedule action."},{status:400});
  if(existing.status!=="active")return NextResponse.json({error:"Only an active pay schedule can be stopped."},{status:409});
  const requestedEnd=Number(input.endPeriod);
  const [employer]=await db.select({payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate})
    .from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  let maximumPeriods=0;
  try{maximumPeriods=scheduledPayPeriods(existing.taxYear,payrollFrequencyRule(employer?.payFrequency).frequency,employer?.firstPayDate||undefined).length;}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(!Number.isInteger(requestedEnd)||requestedEnd<0||requestedEnd>maximumPeriods)return NextResponse.json({error:`Enter the final included payroll period from 0 to ${maximumPeriods}.`},{status:422});
  const applied=await db.select({id:payItems.id,payRunId:payRuns.id,runStatus:payRuns.status,periodNumber:payPeriods.periodNumber})
    .from(payItems).innerJoin(payRuns,eq(payItems.payRunId,payRuns.id)).innerJoin(payPeriods,eq(payRuns.payPeriodId,payPeriods.id))
    .where(and(eq(payItems.recurringItemId,id),eq(payPeriods.employerId,employerId)));
  const finalisedThrough=applied.filter(item=>item.runStatus==="finalised").reduce((latest,item)=>Math.max(latest,item.periodNumber),0);
  if(requestedEnd<finalisedThrough)return NextResponse.json({
    error:`This schedule is already included in finalised Period ${finalisedThrough}. Reopen affected payroll periods before stopping it earlier.`,
    finalisedThrough,
  },{status:409});
  const endPeriod=Math.min(existing.endPeriod,requestedEnd);
  const [updated]=await db.update(recurringPayItems).set({endPeriod,status:"stopped",updatedAt:new Date().toISOString()})
    .where(and(eq(recurringPayItems.id,id),eq(recurringPayItems.employerId,employerId))).returning();
  const removable=applied.filter(item=>item.runStatus==="draft"&&item.periodNumber>endPeriod);
  const draftRunIds=[...new Set(removable.map(item=>item.payRunId))];
  for(const payRunId of draftRunIds){
    await db.delete(payItems).where(eq(payItems.payRunId,payRunId));
    await db.delete(payRuns).where(eq(payRuns.id,payRunId));
  }
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"stopped",entityType:"recurring-pay-item",entityId:String(id),before:JSON.stringify(existing),after:JSON.stringify(updated)});
  return NextResponse.json({...updated,removedDraftOccurrences:removable.length,invalidatedDraftRuns:draftRunIds.length});
}
