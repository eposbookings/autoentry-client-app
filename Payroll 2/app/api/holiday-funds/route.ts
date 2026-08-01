import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, holidayFundEntries, holidayFundSettings, payPeriods } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";
import { readJsonObject } from "../../../lib/request-body";

const validIsoDate=(value:unknown)=>{
  const text=String(value||""),parsed=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===text;
};
const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

async function ownedEmployee(employerId:number,employeeId:number){
  return (await getDb().select().from(employees).where(and(eq(employees.id,employeeId),eq(employees.employerId,employerId))).limit(1))[0];
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const db=getDb(),employeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId));
  const visible=new Set(employeeRows.filter(row=>access.membership.canViewConfidential||!row.confidential).map(row=>row.id));
  const settings=(await db.select().from(holidayFundSettings).where(eq(holidayFundSettings.employerId,employerId))).filter(row=>visible.has(row.employeeId));
  const settingIds=new Set(settings.map(row=>row.id));
  const entries=(await db.select().from(holidayFundEntries).where(eq(holidayFundEntries.employerId,employerId))).filter(row=>settingIds.has(row.holidayFundSettingId));
  const names=new Map(employeeRows.map(row=>[row.id,{payrollId:row.payrollId,name:[row.firstName,row.middleNames,row.lastName].filter(Boolean).join(" ")}]));
  return NextResponse.json({
    settings:settings.map(row=>({...row,...names.get(row.employeeId)})),
    entries:entries.map(row=>({...row,...names.get(row.employeeId)})).sort((a,b)=>a.periodNumber-b.periodNumber||a.id-b.id),
    retentionNotice:"From 6 April 2026, annual-leave and holiday-pay records must be kept for at least 6 years.",
  });
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON holiday-fund operation is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const employeeId=Number(input.employeeId),employee=await ownedEmployee(employerId,employeeId);
  if(!employee)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  if(employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"You do not have permission to manage this employee's holiday fund."},{status:403});
  const db=getDb(),action=String(input.action||"");

  if(action==="configure"){
    const schemeType=String(input.schemeType||""),workerType=String(input.workerType||"");
    const accrualRate=Number(input.accrualRate),openingBalance=Number(input.openingBalance),startDate=String(input.startDate||"");
    const contractConfirmed=input.contractConfirmed===true;
    if(!["employer-accrual","employee-savings","rolled-up"].includes(schemeType))
      return NextResponse.json({error:"Select employer accrual, employee savings or rolled-up holiday pay."},{status:422});
    if(!["regular-hours","irregular-hours","part-year"].includes(workerType))
      return NextResponse.json({error:"Select regular-hours, irregular-hours or part-year working."},{status:422});
    if(!Number.isFinite(accrualRate)||accrualRate<0||accrualRate>100||!Number.isFinite(openingBalance)||openingBalance<0)
      return NextResponse.json({error:"Holiday-fund rate and opening balance must be valid non-negative amounts."},{status:422});
    if(!validIsoDate(startDate))return NextResponse.json({error:"Enter a valid holiday-fund start date."},{status:422});
    if(schemeType==="rolled-up"&&(!["irregular-hours","part-year"].includes(workerType)||!contractConfirmed||openingBalance!==0))
      return NextResponse.json({error:"Rolled-up holiday pay requires an irregular-hours or part-year contract, explicit confirmation and a zero fund balance."},{status:422});
    const [existing]=await db.select().from(holidayFundSettings).where(and(
      eq(holidayFundSettings.employerId,employerId),eq(holidayFundSettings.employeeId,employeeId),
    )).limit(1);
    const history=existing?await db.select().from(holidayFundEntries).where(and(eq(holidayFundEntries.holidayFundSettingId,existing.id),eq(holidayFundEntries.status,"finalised"))):[];
    if(existing&&history.length&&(existing.schemeType!==schemeType||existing.workerType!==workerType||
      Math.abs(existing.openingBalance-openingBalance)>.005||existing.startDate!==startDate))
      return NextResponse.json({error:"Scheme type, worker classification, start date and opening balance are frozen after the first finalised holiday-fund entry."},{status:409});
    const values={employerId,employeeId,schemeType,workerType,accrualRate:round(accrualRate),
      openingBalance:round(openingBalance),currentBalance:history.length?existing!.currentBalance:round(openingBalance),
      contractConfirmed,startDate,status:"active",updatedAt:new Date().toISOString()};
    const [setting]=existing
      ?await db.update(holidayFundSettings).set(values).where(eq(holidayFundSettings.id,existing.id)).returning()
      :await db.insert(holidayFundSettings).values(values).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:existing?"updated:holiday-fund":"created:holiday-fund",
      entityType:"holiday-fund",entityId:String(setting.id),before:existing?JSON.stringify(existing):null,after:JSON.stringify(setting)});
    return NextResponse.json({setting},{status:existing?200:201});
  }

  if(action==="set-period"){
    const taxYear=String(input.taxYear||""),periodNumber=Number(input.periodNumber);
    const manualAdded=Number(input.manualAdded||0),requestedPaid=Number(input.requestedPaid||0);
    const referencePayOverride=input.referencePayOverride===null||input.referencePayOverride===undefined||input.referencePayOverride===""
      ?null:Number(input.referencePayOverride);
    if(!validTaxYear(taxYear)||!Number.isInteger(periodNumber)||periodNumber<1)
      return NextResponse.json({error:"Enter a valid tax year and payroll period."},{status:422});
    if(!Number.isFinite(manualAdded)||manualAdded<0||!Number.isFinite(requestedPaid)||requestedPaid<0||
      (referencePayOverride!==null&&(!Number.isFinite(referencePayOverride)||referencePayOverride<0)))
      return NextResponse.json({error:"Holiday-fund additions, withdrawals and reference pay must be valid non-negative amounts."},{status:422});
    const [setting]=await db.select().from(holidayFundSettings).where(and(
      eq(holidayFundSettings.employerId,employerId),eq(holidayFundSettings.employeeId,employeeId),eq(holidayFundSettings.status,"active"),
    )).limit(1);
    if(!setting)return NextResponse.json({error:"Configure an active holiday-pay scheme for this employee first."},{status:409});
    const [employer]=await db.select({taxYear:employers.taxYear,payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate})
      .from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
    if(!employer||employer.taxYear!==taxYear)return NextResponse.json({error:"Holiday-fund period must belong to the employer's active tax year."},{status:422});
    let schedule;
    try{schedule=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined);}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Employer pay schedule is invalid."},{status:422});}
    const scheduled=schedule.find(row=>row.periodNumber===periodNumber);
    if(!scheduled)return NextResponse.json({error:"Payroll period is outside this employer's schedule."},{status:422});
    let [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber))).limit(1);
    if(period?.status==="finalised"||period?.status==="migrated")return NextResponse.json({error:"Finalised or imported holiday-fund evidence cannot be edited."},{status:409});
    const completed=(await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))))
      .filter(row=>["finalised","migrated"].includes(row.status)).map(row=>row.periodNumber);
    let firstOpen=1;while(completed.includes(firstOpen))firstOpen++;
    if(periodNumber!==firstOpen||period&&period.status!=="open")
      return NextResponse.json({error:`Holiday values can only be entered for open Period ${firstOpen}.`},{status:409});
    if(!period){
      [period]=await db.insert(payPeriods).values({employerId,taxYear,periodNumber,frequency:payrollFrequencyRule(employer.payFrequency).frequency,
        status:"open",payDate:scheduled.payDate,periodStart:scheduled.periodStart,periodEnd:scheduled.periodEnd}).returning();
    }
    const [existing]=await db.select().from(holidayFundEntries).where(and(
      eq(holidayFundEntries.holidayFundSettingId,setting.id),eq(holidayFundEntries.payPeriodId,period.id),
    )).limit(1);
    const values={employerId,employeeId,holidayFundSettingId:setting.id,payPeriodId:period.id,taxYear,periodNumber,
      schemeType:setting.schemeType,workerType:setting.workerType,contractConfirmed:setting.contractConfirmed,accrualRate:setting.accrualRate,
      manualAdded:round(manualAdded),requestedPaid:round(requestedPaid),referencePayOverride:referencePayOverride===null?null:round(referencePayOverride),
      payRunId:null,accrualBase:0,addedAmount:0,paidAmount:0,balanceBefore:setting.currentBalance,balanceAfter:setting.currentBalance,
      taxablePay:0,nicablePay:0,postTaxDeduction:0,sourceChecksum:null,status:"draft",updatedAt:new Date().toISOString()};
    const [entry]=existing
      ?await db.update(holidayFundEntries).set(values).where(eq(holidayFundEntries.id,existing.id)).returning()
      :await db.insert(holidayFundEntries).values(values).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"saved:holiday-fund-period",
      entityType:"holiday-fund-entry",entityId:String(entry.id),before:existing?JSON.stringify(existing):null,
      after:JSON.stringify({taxYear,periodNumber,manualAdded:values.manualAdded,requestedPaid:values.requestedPaid,referencePayOverride:values.referencePayOverride})});
    return NextResponse.json({entry},{status:existing?200:201});
  }

  return NextResponse.json({error:"Unsupported holiday-fund operation."},{status:400});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON holiday-fund update is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(!Number.isInteger(id)||id<1||!["suspend","restore"].includes(String(input.action||"")))
    return NextResponse.json({error:"Select a valid holiday-fund setting and action."},{status:422});
  const db=getDb(),[setting]=await db.select().from(holidayFundSettings).where(and(eq(holidayFundSettings.id,id),eq(holidayFundSettings.employerId,employerId))).limit(1);
  if(!setting)return NextResponse.json({error:"Holiday-fund setting was not found for this employer."},{status:404});
  const status=input.action==="restore"?"active":"suspended";
  const [updated]=await db.update(holidayFundSettings).set({status,updatedAt:new Date().toISOString()}).where(eq(holidayFundSettings.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:`${status}:holiday-fund`,entityType:"holiday-fund",entityId:String(id),before:JSON.stringify({status:setting.status}),after:JSON.stringify({status})});
  return NextResponse.json({setting:updated});
}
