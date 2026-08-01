import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, expensesBenefits, payrollOpeningBalances, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { employeeActiveInRange } from "../../../lib/pay-periods";
import { p45OpeningFromFinalisedSnapshots } from "../../../lib/p45-opening-evidence";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

const nextYear=(taxYear:string)=>{
  const start=Number(taxYear.slice(0,4))+1;
  return `${start}/${String((start+1)%100).padStart(2,"0")}`;
};
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const reportChecksum=async(columns:string[],rows:unknown[][],type:string,taxYear:string)=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type,taxYear,columns,rows}));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
};
const parse=(value:string|null)=>{try{return JSON.parse(value||"{}") as Record<string,any>;}catch{return {} as Record<string,any>;}};
const sha256=async(value:string)=>{
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
};
async function auditYear(employerId:number,taxYear:string){
  const db=getDb();
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  if(!employer)throw new Error("Employer was not found.");
  const frequency=payrollFrequencyRule(employer.payFrequency).frequency;
  const paySchedule=scheduledPayPeriods(taxYear,frequency,employer.firstPayDate||undefined);
  const finalPeriodNumber=paySchedule.length;
  const periods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
  const employeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId)).orderBy(asc(employees.id));
  const employeeIds=new Set(employeeRows.map(e=>e.id)),periodIds=new Set(periods.map(p=>p.id));
  const yearRuns=(await db.select().from(payRuns)).filter(r=>periodIds.has(r.payPeriodId)&&employeeIds.has(r.employeeId));
  const runs=yearRuns.filter(r=>r.status==="finalised"),draftRuns=yearRuns.filter(r=>r.status!=="finalised");
  const openingBalances=await db.select().from(payrollOpeningBalances).where(and(
    eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),
  ));
  const openingByEmployee=new Map(openingBalances.map(row=>[row.employeeId,row]));
  const yearSubmissions=(await db.select().from(submissions).where(eq(submissions.employerId,employerId))).filter(s=>{
    try{return JSON.parse(s.payload||"{}").taxYear===taxYear;}catch{return false;}
  });
  const audit=await db.select().from(auditLog).where(eq(auditLog.employerId,employerId));
  const benefits=(await db.select().from(expensesBenefits)).filter(b=>employeeIds.has(b.employeeId)&&b.taxYear===taxYear);
  const activeBenefits=benefits.filter(benefit=>benefit.status!=="voided");
  const employeesWithRuns=new Set(runs.map(r=>r.employeeId));
  const taxYearEnd=`${Number(taxYear.slice(0,4))+1}-04-05`;
  const periodNumber=new Map(periods.map(period=>[period.id,period.periodNumber]));
  const employeeEvidence=employeeRows.map(employee=>{
    const employeeRuns=runs.filter(run=>run.employeeId===employee.id).sort((left,right)=>(periodNumber.get(left.payPeriodId)||0)-(periodNumber.get(right.payPeriodId)||0));
    const first=parse(employeeRuns[0]?.rtiSnapshot||null),last=parse(employeeRuns.at(-1)?.rtiSnapshot||null);
    const frozen=(snapshot:Record<string,any>,field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(snapshot,field)?snapshot[field]:fallback;
    return {
      employee,employeeRuns,first,last,
      name:[String(frozen(last,"firstName",employee.firstName)||""),String(frozen(last,"middleNames",employee.middleNames)||""),String(frozen(last,"lastName",employee.lastName)||"")].filter(Boolean).join(" "),
      payrollId:String(frozen(last,"payrollId",employee.payrollId)||""),
      niNumber:String(frozen(last,"niNumber",employee.niNumber)||""),
      taxCode:String(frozen(last,"taxCode",employee.taxCode)||""),
      startDate:String(frozen(last,"startDate",employee.startDate)||""),
      leavingDate:String(frozen(last,"leavingDate",employee.leavingDate)||""),
    };
  });
  const eligibleForP60=employeeEvidence.filter(evidence=>evidence.employeeRuns.length>0&&(!evidence.startDate||evidence.startDate<=taxYearEnd)&&(!evidence.leavingDate||evidence.leavingDate>=taxYearEnd));
  const p60Columns=["Employee","Payroll ID","NI number","Tax code","Pay in this employment","Tax in this employment","Previous employment pay","Previous employment tax","Total pay","Total tax","Employee NIC"];
  const p60Rows=eligibleForP60.map(evidence=>{
    const {employee,employeeRuns}=evidence;
    const migrationOpening=openingByEmployee.get(employee.id);
    const totals=employeeRuns.reduce((sum,run)=>({taxable:round(sum.taxable+run.taxablePay),tax:round(sum.tax+run.payeTax),nic:round(sum.nic+run.employeeNic)}),{
      taxable:Number(migrationOpening?.taxablePay||0),tax:Number(migrationOpening?.payeTax||0),nic:Number(migrationOpening?.employeeNic||0),
    });
    const opening=p45OpeningFromFinalisedSnapshots(employeeRuns.map(run=>parse(run.rtiSnapshot)),{
      previousPay:employee.p45PreviousPay,previousTax:employee.p45PreviousTax,
    });
    const {previousPay,previousTax}=opening;
    return [evidence.name,evidence.payrollId,evidence.niNumber,evidence.taxCode,totals.taxable,totals.tax,previousPay,previousTax,round(totals.taxable+previousPay),round(totals.tax+previousTax),totals.nic];
  });
  const currentP60Checksum=await reportChecksum(p60Columns,p60Rows,"p60",taxYear);
  const eligibleP60Ids=eligibleForP60.map(evidence=>evidence.employee.id).sort((a,b)=>a-b);
  const completeP60Evidence=audit.some(record=>{
    if(record.action!=="generated:p60")return false;
    const evidence=parse(record.after);
    const evidenceIds=Array.isArray(evidence.employeeIds)?evidence.employeeIds.map(Number).sort((a:number,b:number)=>a-b):[];
    return evidence.taxYear===taxYear&&evidence.sourceChecksum===currentP60Checksum&&
      evidenceIds.length===eligibleP60Ids.length&&evidenceIds.every((id:number,index:number)=>id===eligibleP60Ids[index]);
  });
  const finalFilings=yearSubmissions.filter(s=>{
    if(!["FPS","Additional FPS","EPS"].includes(s.type)||!["test-ready","accepted"].includes(s.status))return false;
    try{const payload=JSON.parse(s.payload||"{}");return Number(payload.periodNumber)===(s.type==="EPS"?12:finalPeriodNumber)&&payload.finalSubmission===true;}catch{return false;}
  });
  const acceptedFinalCandidates=await Promise.all(finalFilings.map(async filing=>{
    const receipt=parse(filing.response),payload=parse(filing.payload);
    const checksumValid=Boolean(filing.payloadChecksum)&&await sha256(JSON.stringify(payload))===filing.payloadChecksum;
    const receiptValid=receipt.schemaVersion==="payflow-rti-external-result-1"&&receipt.outcome==="accepted"&&
      receipt.acknowledgementReference===filing.correlationId&&typeof receipt.evidenceSource==="string"&&receipt.evidenceSource.length>0;
    return filing.status==="accepted"&&Boolean(filing.submittedAt)&&Boolean(filing.correlationId)&&
      !filing.correlationId?.startsWith("PF-TEST-")&&checksumValid&&receiptValid?filing:null;
  }));
  const acceptedFinalFiling=acceptedFinalCandidates.find(Boolean)||null;
  const preparedFinalFiling=acceptedFinalFiling||finalFilings.at(-1)||null;
  const finalPeriodFinalised=periods.some(period=>period.periodNumber===finalPeriodNumber&&period.status==="finalised");
  const activeInStoredPeriod=(employee:typeof employees.$inferSelect,period:typeof payPeriods.$inferSelect)=>
    Boolean(period.periodStart&&period.periodEnd)&&employeeActiveInRange(employee.startDate,employee.leavingDate,period.periodStart!,period.periodEnd!);
  const coverageErrors:string[]=[];
  for(const period of periods.filter(item=>item.status==="finalised")){
    for(const employee of employeeRows){
      if(!activeInStoredPeriod(employee,period))continue;
      const matching=runs.filter(run=>run.payPeriodId===period.id&&run.employeeId===employee.id);
      if(matching.length!==1)coverageErrors.push(`${employee.payrollId} has ${matching.length} finalised records in period ${period.periodNumber}`);
    }
  }
  const unexpectedRuns=runs.filter(run=>{
    const employee=employeeRows.find(row=>row.id===run.employeeId),period=periods.find(row=>row.id===run.payPeriodId);
    return !employee||!period||!activeInStoredPeriod(employee,period);
  });
  if(unexpectedRuns.length)coverageErrors.push(`${unexpectedRuns.length} finalised pay record${unexpectedRuns.length===1?" is":"s are"} outside recorded employment dates`);
  const checks=[
    {name:`All ${finalPeriodNumber} payroll periods completed`,passed:periods.length===finalPeriodNumber&&periods.every((p,index)=>p.periodNumber===index+1&&["migrated","finalised"].includes(p.status)),detail:`${periods.filter(p=>p.status==="finalised").length} finalised in PayFlow${periods.some(p=>p.status==="migrated")?` · ${periods.filter(p=>p.status==="migrated").length} imported from prior payroll`:""}`},
    {name:"No draft payroll remains",passed:draftRuns.length===0,detail:draftRuns.length?`${draftRuns.length} draft pay records remain`:"All year pay records are finalised"},
    {name:"Final RTI submission accepted by HMRC",passed:Boolean(acceptedFinalFiling),detail:acceptedFinalFiling?`HMRC accepted the final submission for ${frequency==="monthly"?"period 12":`payroll period ${finalPeriodNumber}`}`:preparedFinalFiling?"The final FPS or EPS is prepared but no live HMRC acceptance receipt has been recorded":`A final FPS for payroll period ${finalPeriodNumber}, or a tax-month 12 EPS, is required`},
    {name:"Employee year-to-date records reconcile",passed:coverageErrors.length===0&&runs.every(r=>[r.grossPay,r.taxablePay,r.payeTax,r.employeeNic,r.employerNic,r.netPay].every(Number.isFinite)),detail:coverageErrors[0]||`${employeesWithRuns.size} employees have exactly one finalised record in every applicable period`},
    {name:"P60 certificates generated",passed:finalPeriodFinalised&&(eligibleForP60.length===0||completeP60Evidence),detail:finalPeriodFinalised?(completeP60Evidence?`Current P60 evidence covers all ${eligibleForP60.length} eligible employee${eligibleForP60.length===1?"":"s"}`:`Generate a current P60 set for all ${eligibleForP60.length} eligible employee${eligibleForP60.length===1?"":"s"}`):`Final payroll period ${finalPeriodNumber} must be finalised before P60 generation`},
    {name:"Benefits and NIC treatment reviewed",passed:activeBenefits.every(benefit=>benefit.status==="reviewed"&&(benefit.nicTreatment!=="class-1"||Boolean(benefit.providedDate))&&Math.abs(benefit.class1aNic-(benefit.nicTreatment==="class-1a"?benefit.cashEquivalent*.15:0))<.02),detail:activeBenefits.length?`${activeBenefits.filter(benefit=>benefit.status==="reviewed"&&(benefit.nicTreatment!=="class-1"||Boolean(benefit.providedDate))).length} of ${activeBenefits.length} active records have complete treatment evidence`:"No active benefits recorded"},
  ];
  return {ready:checks.every(c=>c.passed),checks,taxYear,nextTaxYear:nextYear(taxYear),frequency,finalPeriodNumber,firstPayDate:employer.firstPayDate||null,externalDependency:"Tax-year rollover is blocked until HMRC returns an accepted response for the final FPS, Additional FPS or EPS. Local test-ready packages are not treated as filed.",finalFilingStatus:preparedFinalFiling?.status||null};
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const result=await auditYear(employerId,taxYear);
  return NextResponse.json({...result,completedAt:result.ready?new Date().toISOString():null});
}

export async function POST(request:Request){
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON year-end operation object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON year-end operation object is required."},{status:400});
  const employerId=Number(input.employerId),taxYear=String(input.taxYear||""),action=String(input.action||""),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(action!=="rollover")return NextResponse.json({error:"Unsupported year-end action."},{status:400});
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const result=await auditYear(employerId,taxYear);
  if(!result.ready)return NextResponse.json({error:"Year end is not ready for rollover.",checks:result.checks},{status:409});
  const frequency=payrollFrequencyRule(result.frequency).frequency;
  let nextFirstPayDate:string|undefined;
  if(frequency!=="monthly"){
    const currentSchedule=scheduledPayPeriods(taxYear,frequency,result.firstPayDate||undefined);
    const stepDays=Number(payrollFrequencyRule(frequency).weeksPerPeriod)*7;
    const nextYearStart=`${Number(result.nextTaxYear.slice(0,4))}-04-06`;
    let nextDate=Date.parse(`${currentSchedule.at(-1)!.payDate}T00:00:00Z`)+stepDays*86_400_000;
    while(new Date(nextDate).toISOString().slice(0,10)<nextYearStart)nextDate+=stepDays*86_400_000;
    nextFirstPayDate=new Date(nextDate).toISOString().slice(0,10);
  }
  const expectedSchedule=scheduledPayPeriods(result.nextTaxYear,frequency,nextFirstPayDate);
  const existing=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,result.nextTaxYear))).orderBy(asc(payPeriods.periodNumber));
  if(existing.length){
    const expected=existing.map(period=>({...expectedSchedule.find(item=>item.periodNumber===period.periodNumber)!,period}));
    const validExisting=existing.length===expectedSchedule.length&&existing.every((period,index)=>
      period.periodNumber===index+1&&period.frequency===frequency&&period.status===(index===0?"open":"future")&&
      Boolean(expected[index].periodNumber)&&(!period.periodStart||period.periodStart===expected[index].periodStart)&&(!period.periodEnd||period.periodEnd===expected[index].periodEnd)&&
      (!period.payDate||period.payDate===expected[index].payDate)
    );
    if(!validExisting)return NextResponse.json({error:"The next tax year contains an incomplete or changed period set and requires review."},{status:409});
    const recoveredAt=new Date().toISOString();
    const recoveryOperations=[
      ...expected.filter(item=>!item.period.periodStart||!item.period.periodEnd||!item.period.payDate).map(item=>db.update(payPeriods).set({
        periodStart:item.periodStart,periodEnd:item.periodEnd,payDate:item.payDate,updatedAt:recoveredAt,
      }).where(and(eq(payPeriods.id,item.period.id),eq(payPeriods.employerId,employerId)))),
      db.update(employers).set({taxYear:result.nextTaxYear,updatedAt:recoveredAt}).where(eq(employers.id,employerId)),
      db.update(employerSettings).set({firstPayDate:nextFirstPayDate||null,updatedAt:recoveredAt}).where(eq(employerSettings.employerId,employerId)),
      db.insert(auditLog).values({employerId,actor:access.user.email,action:"tax-year-rollover-recovered",entityType:"tax-year",entityId:result.nextTaxYear,after:JSON.stringify({from:taxYear,to:result.nextTaxYear,periodsCreated:0,datesBackfilled:expected.filter(item=>!item.period.periodStart||!item.period.periodEnd||!item.period.payDate).length})}),
    ];
    await db.batch(recoveryOperations as [any,...any[]]);
    return NextResponse.json({rolledOver:true,alreadyExisted:true,fromTaxYear:taxYear,toTaxYear:result.nextTaxYear,periodsCreated:0,firstOpenPeriod:1});
  }
  const nextPeriods=expectedSchedule.map((scheduled,index)=>({
    employerId,taxYear:result.nextTaxYear,periodNumber:scheduled.periodNumber,frequency,status:index===0?"open":"future",
    payDate:scheduled.payDate,periodStart:scheduled.periodStart,periodEnd:scheduled.periodEnd,
  }));
  await db.batch([
    db.insert(payPeriods).values(nextPeriods),
    db.update(employers).set({taxYear:result.nextTaxYear,updatedAt:new Date().toISOString()}).where(eq(employers.id,employerId)),
    db.update(employerSettings).set({firstPayDate:nextFirstPayDate||null,updatedAt:new Date().toISOString()}).where(eq(employerSettings.employerId,employerId)),
    db.insert(auditLog).values({employerId,actor:access.user.email,action:"tax-year-rollover",entityType:"tax-year",entityId:result.nextTaxYear,after:JSON.stringify({from:taxYear,to:result.nextTaxYear})}),
  ]);
  return NextResponse.json({rolledOver:true,alreadyExisted:false,fromTaxYear:taxYear,toTaxYear:result.nextTaxYear,periodsCreated:nextPeriods.length,firstOpenPeriod:1,firstPayDate:nextFirstPayDate||null},{status:201});
}
