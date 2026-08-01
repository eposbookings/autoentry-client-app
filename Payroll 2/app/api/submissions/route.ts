import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, expensesBenefits, leaveEvents, payrollAdjustments, payrollOpeningBalances, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { statutoryPayAllocation } from "../../../lib/pay-periods";
import { apprenticeshipLevyByMonth } from "../../../lib/apprenticeship-levy";
import { nicEarningsBands } from "../../../lib/nic-bands";
import { hasValidFrozenRtiSnapshot, parseFrozenRtiSnapshot } from "../../../lib/rti-snapshot";
import { hasValidFrozenPensionSnapshot, parseFrozenPensionSnapshot } from "../../../lib/pension-snapshot";
import { cumulativeRtiSources } from "../../../lib/rti-source";
import { validateRtiFilingResult } from "../../../lib/rti-filing-result";
import { payrollFrequencyRule, scheduledPayPeriods, taxMonthForDate, type PayrollFrequency } from "../../../lib/pay-frequency";
import { epsTaxMonthWindow, hasEmployeePaymentActivity } from "../../../lib/eps-no-payment";

const allowedTypes = ["FPS", "EPS", "NVR", "Additional FPS", "EXB"];
const allowedLateReasons=["A","B","C","D","F","G","H"];
const normaliseRtiGender=(value:unknown)=>String(value||"").trim().toUpperCase()==="MALE"?"M":String(value||"").trim().toUpperCase()==="FEMALE"?"F":String(value||"").trim().toUpperCase();
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const validDate=(value:unknown):value is string=>{
  if(typeof value!=="string")return false;
  const time=/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(`${value}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
};
const epsDeadline=(taxYear:string,taxMonth:number)=>new Date(Date.UTC(Number(taxYear.slice(0,4)),3+taxMonth,19)).toISOString().slice(0,10);
const openingNicCategories=(value:string)=>{
  try{
    const parsed=JSON.parse(value||"[]");
    return Array.isArray(parsed)?parsed.filter(line=>line&&typeof line==="object"&&!Array.isArray(line)):[];
  }catch{return [];}
};

async function sourceFingerprint(db:ReturnType<typeof getDb>,employerId:number,type:string,taxYear:string,payPeriodId:number|null,payrollId=""){
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  const employerEvidence=employer?{
    id:employer.id,name:employer.name,legalName:employer.legalName,companyNumber:employer.companyNumber,payeReference:employer.payeReference,accountsOfficeReference:employer.accountsOfficeReference,
    employmentAllowance:employer.employmentAllowance,apprenticeshipLevy:employer.apprenticeshipLevy,
    apprenticeshipLevyAllowance:employer.apprenticeshipLevyAllowance,
  }:null;
  if(["FPS","Additional FPS","EPS"].includes(type)){
    const [period]=payPeriodId?await db.select().from(payPeriods).where(and(eq(payPeriods.id,payPeriodId),eq(payPeriods.employerId,employerId))).limit(1):[];
    const periods=period||type==="EPS"?await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber)):[];
    const periodIds=new Set(periods.map(item=>item.id));
    const runs=periods.length?(await db.select().from(payRuns).orderBy(asc(payRuns.id))).filter(item=>periodIds.has(item.payPeriodId)):[];
    let statutorySources:typeof leaveEvents.$inferSelect[]=[],employeeIds=new Set<number>();
    if(type==="EPS"){
      employeeIds=new Set((await db.select({id:employees.id}).from(employees).where(eq(employees.employerId,employerId))).map(row=>row.id));
      statutorySources=await db.select().from(leaveEvents).orderBy(asc(leaveEvents.id));
    }
    const sources=type==="EPS"?{periods,runs,statutorySources}:period?cumulativeRtiSources(type,period,periods,runs,statutorySources,employeeIds):{periods:[],runs:[],statutorySources:[]};
    const sourcePeriodIds=new Set(sources.periods.map(item=>item.id));
    const recoveryAdjustments=type==="EPS"
      ?(await db.select().from(payrollAdjustments).where(and(
        eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.type,"statutory-recovery"),eq(payrollAdjustments.status,"active"),
      ))).filter(item=>sourcePeriodIds.has(item.payPeriodId))
      :[];
    const openingBalances=type==="FPS"||type==="Additional FPS"
      ?await db.select().from(payrollOpeningBalances).where(and(
        eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),
      )).orderBy(asc(payrollOpeningBalances.employeeId))
      :[];
    return sha256(JSON.stringify({employer:employerEvidence,...sources,recoveryAdjustments,openingBalances}));
  }
  if(type==="NVR"){
    const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
    return sha256(JSON.stringify({employer:employerEvidence,employee:employee||null}));
  }
  if(type==="EXB"){
    const employeeIds=new Set((await db.select({id:employees.id}).from(employees).where(eq(employees.employerId,employerId))).map(row=>row.id));
    const benefits=(await db.select().from(expensesBenefits).where(eq(expensesBenefits.taxYear,taxYear))).filter(row=>employeeIds.has(row.employeeId)).sort((a,b)=>a.id-b.id);
    return sha256(JSON.stringify({employer:employerEvidence,benefits}));
  }
  return sha256(JSON.stringify({employer:employerEvidence,type,taxYear}));
}

export async function GET(request: Request) {
  const url=new URL(request.url),employerId = Number(url.searchParams.get("employerId")),taxYear=url.searchParams.get("taxYear");
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(taxYear&&!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const rows=await getDb().select().from(submissions).where(eq(submissions.employerId, employerId)).orderBy(desc(submissions.id));
  return NextResponse.json(taxYear?rows.filter(row=>{try{return JSON.parse(row.payload||"{}").taxYear===taxYear;}catch{return false;}}):rows);
}

export async function POST(request: Request) {
  const input = await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON RTI submission object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const type = String(input.type || "");
  const taxYear=String(input.taxYear||"");
  if (!allowedTypes.includes(type)) return NextResponse.json({ error: "Unsupported submission type." }, { status: 400 });
  const [employer] = await db.select().from(employers).where(eq(employers.id, employerId)).limit(1);
  if (!employer) return NextResponse.json({ error: "Employer was not found." }, { status: 404 });
  const [settings]=await db.select({firstPayDate:employerSettings.firstPayDate}).from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const errors: string[] = [];
  if(!validTaxYear(taxYear))errors.push("Tax year must use the format 2026/27.");
  if (!employer.payeReference || !employer.accountsOfficeReference) errors.push("PAYE and Accounts Office references are required.");
  let frequency:PayrollFrequency="monthly",paySchedule:ReturnType<typeof scheduledPayPeriods>=[];
  if(validTaxYear(taxYear))try{
    frequency=payrollFrequencyRule(employer.payFrequency).frequency;
    paySchedule=scheduledPayPeriods(taxYear,frequency,settings?.firstPayDate||undefined);
  }catch(error){errors.push(error instanceof Error?error.message:"The employer pay schedule is invalid.");}
  let period: typeof payPeriods.$inferSelect | null = null;
  let employeeRuns: Array<{ employeeId:number; payrollId:string;title:string|null;firstName:string;middleNames:string|null;lastName:string;dateOfBirth:string|null;gender:string|null;address:string|null;postcode:string|null;starterEvidence:string|null;starterDeclaration:string|null; grossPay:number; taxablePay:number; nicablePay:number; statutoryPay:number; payeTax:number; employeeNic:number; employerNic:number; studentLoan:number; postgraduateLoan:number; netPay:number; pensionContributionNetPay:number;pensionContributionReliefAtSource:number;taxCode:string;niCategory:string; niNumber:string|null; startDate:string|null; leavingDate:string|null; reportedPayFrequency:string; contractedHours:number; director?:boolean;directorMethod?:string;irregularPayment:boolean; zeroPayFpsExclusion:boolean; workplacePostcode:string|null; previousPayrollId:string|null; paymentToBody:boolean; trivialCommutation:boolean; flexibleDrawdown:boolean;paymentAfterLeaving?:boolean;p45PreviousPay:number;p45PreviousTax:number;lateReason?:string|null;ytd?:Record<string,unknown> }> = [];
  let correctionOf:typeof submissions.$inferSelect|null=null;
  if (type === "FPS" || type === "Additional FPS") {
    const periodNumber=Number(input.periodNumber);
    const maximumPeriods=paySchedule.length;
    if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>maximumPeriods)errors.push(`FPS payroll period must be a whole number between 1 and ${maximumPeriods||payrollFrequencyRule(frequency).maximumPeriods}.`);
    if(Number.isInteger(periodNumber)&&periodNumber>=1&&periodNumber<=maximumPeriods)[period] = await db.select().from(payPeriods).where(and(
      eq(payPeriods.employerId, employerId),
      eq(payPeriods.taxYear,taxYear),
      eq(payPeriods.periodNumber, periodNumber),
    )).limit(1);
    if (Number.isInteger(periodNumber)&&periodNumber>=1&&periodNumber<=maximumPeriods&&!period) errors.push("The selected payroll period does not exist.");
    else if (period&&period.status !== "finalised") errors.push("The payroll period must be finalised before an FPS can be generated.");
    if (period) {
      const rawRuns = await db.select({
      employeeId: payRuns.employeeId, payrollId: employees.payrollId, grossPay: payRuns.grossPay,
      taxablePay: payRuns.taxablePay, nicablePay:payRuns.nicablePay, statutoryPay:payRuns.statutoryPay, payeTax: payRuns.payeTax, employeeNic: payRuns.employeeNic,
      employerNic: payRuns.employerNic, studentLoan: payRuns.studentLoan,
      postgraduateLoan: payRuns.postgraduateLoan, netPay: payRuns.netPay,
      title:employees.title,firstName:employees.firstName,middleNames:employees.middleNames,lastName:employees.lastName,dateOfBirth:employees.dateOfBirth,
      gender:employees.gender,address:employees.address,postcode:employees.postcode,starterEvidence:employees.starterEvidence,starterDeclaration:employees.starterDeclaration,
      taxCode:employees.taxCode,niNumber:employees.niNumber,startDate:employees.startDate,leavingDate:employees.leavingDate,
      reportedPayFrequency:employees.reportedPayFrequency,contractedHours:employees.contractedHours,
      irregularPayment:employees.irregularPayment,zeroPayFpsExclusion:employees.zeroPayFpsExclusion,
      workplacePostcode:employees.workplacePostcode,previousPayrollId:employees.previousPayrollId,
      paymentToBody:employees.paymentToBody,trivialCommutation:employees.trivialCommutation,flexibleDrawdown:employees.flexibleDrawdown,
      p45PreviousPay:employees.p45PreviousPay,p45PreviousTax:employees.p45PreviousTax,
      employeePension:payRuns.employeePension,pensionSchemeId:payRuns.pensionSchemeId,rtiSnapshot:payRuns.rtiSnapshot,pensionSnapshot:payRuns.pensionSnapshot,
    }).from(payRuns).innerJoin(employees, eq(payRuns.employeeId, employees.id))
      .where(and(eq(payRuns.payPeriodId, period.id), eq(employees.employerId, employerId), eq(payRuns.status, "finalised")));
      if(rawRuns.some(run=>!hasValidFrozenRtiSnapshot(run.rtiSnapshot)))
        return NextResponse.json({error:"One or more finalised pay runs have invalid frozen RTI evidence. Restore valid evidence or reopen and recalculate the affected period before preparing a submission."},{status:409});
      if(rawRuns.some(run=>run.pensionSchemeId&&!hasValidFrozenPensionSnapshot(run.pensionSnapshot)))
        return NextResponse.json({error:"One or more finalised pay runs have invalid frozen pension evidence. Reopen and recalculate the affected period before preparing an FPS."},{status:409});
      employeeRuns=rawRuns.map(({rtiSnapshot,pensionSnapshot,employeePension,pensionSchemeId,...row})=>{
        const snapshot=parseFrozenRtiSnapshot(rtiSnapshot),pension:Record<string,unknown>=pensionSchemeId?parseFrozenPensionSnapshot(pensionSnapshot):{};
        const method=String(pension.taxRelief||"legacy"),deduction=Number(pension.employeeDeduction??employeePension??0);
        return {...row,...snapshot,pensionContributionNetPay:method==="net-pay"?deduction:0,pensionContributionReliefAtSource:method==="relief-at-source"?deduction:0} as typeof employeeRuns[number];
      });
    }
    if(type==="FPS")employeeRuns=employeeRuns.filter(row=>!(row.grossPay===0&&row.zeroPayFpsExclusion));
    if(period){
      const yearPeriods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
      const includedPeriodIds=new Set(yearPeriods.filter(item=>item.periodNumber<=period!.periodNumber).map(item=>item.id));
      const yearRuns=(await db.select().from(payRuns)).filter(run=>includedPeriodIds.has(run.payPeriodId)&&run.status==="finalised");
      const openingBalances=await db.select().from(payrollOpeningBalances).where(and(
        eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),
      ));
      if(yearRuns.some(run=>run.pensionSchemeId&&!hasValidFrozenPensionSnapshot(run.pensionSnapshot)))
        return NextResponse.json({error:"A prior finalised pay run has invalid frozen pension evidence. Reopen and recalculate the affected period before preparing cumulative FPS values."},{status:409});
      employeeRuns=employeeRuns.map(row=>{
        const own=yearRuns.filter(run=>run.employeeId===row.employeeId);
        const migrationOpening=openingBalances.find(item=>item.employeeId===row.employeeId);
        const categories=new Map<string,{niCategory:string;nicablePay:number;earningsAtLel:number;earningsLelToPt:number;earningsPtToUel:number;earningsAboveUel:number;employeeNic:number;employerNic:number}>();
        if(migrationOpening){
          const importedCategories=openingNicCategories(migrationOpening.nicCategoryBreakdown);
          const categoryRows=importedCategories.length?importedCategories:[{
            niCategory:String(row.niCategory||"A"),nicablePay:migrationOpening.nicablePay,earningsAtLel:migrationOpening.earningsAtLel,
            earningsLelToPt:migrationOpening.earningsLelToPt,earningsPtToUel:migrationOpening.earningsPtToUel,
            earningsAboveUel:migrationOpening.earningsAboveUel,employeeNic:migrationOpening.employeeNic,employerNic:migrationOpening.employerNic,
          }];
          for(const imported of categoryRows){
            const category=String(imported.niCategory||row.niCategory||"A");
            categories.set(category,{
              niCategory:category,nicablePay:Number(imported.nicablePay||0),earningsAtLel:Number(imported.earningsAtLel||0),
              earningsLelToPt:Number(imported.earningsLelToPt||0),earningsPtToUel:Number(imported.earningsPtToUel||0),
              earningsAboveUel:Number(imported.earningsAboveUel||0),employeeNic:Number(imported.employeeNic||0),employerNic:Number(imported.employerNic||0),
            });
          }
        }
        for(const run of own){
          let snapshot:any={};try{snapshot=JSON.parse(run.rtiSnapshot||"{}");}catch{}
          const category=String(snapshot.niCategory||row.niCategory||"A"),periodWeeks=snapshot.reportedPayFrequency==="fortnightly"?2:snapshot.reportedPayFrequency==="four-weekly"?4:1,bands=nicEarningsBands(run.nicablePay,snapshot.earningsPeriod==="weekly"?"weekly":"monthly",periodWeeks);
          const current=categories.get(category)||{niCategory:category,nicablePay:0,earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0,employeeNic:0,employerNic:0};
          current.nicablePay=round(current.nicablePay+run.nicablePay);
          current.earningsAtLel=round(current.earningsAtLel+bands.earningsAtLel);
          current.earningsLelToPt=round(current.earningsLelToPt+bands.earningsLelToPt);
          current.earningsPtToUel=round(current.earningsPtToUel+bands.earningsPtToUel);
          current.earningsAboveUel=round(current.earningsAboveUel+bands.earningsAboveUel);
          current.employeeNic=round(current.employeeNic+run.employeeNic);
          current.employerNic=round(current.employerNic+run.employerNic);
          categories.set(category,current);
        }
        const firstPaidPeriod=Math.min(...own.map(run=>yearPeriods.find(item=>item.id===run.payPeriodId)?.periodNumber||99));
        const reportStarterDeclaration=!migrationOpening&&period!.periodNumber===firstPaidPeriod&&row.starterEvidence!=="P45 provided";
        const openingPensionMethod=own.map(run=>run.pensionSchemeId?parseFrozenPensionSnapshot(run.pensionSnapshot).taxRelief:null).find(Boolean);
        return {...row,starterDeclaration:reportStarterDeclaration?row.starterDeclaration:null,ytd:{
          grossPay:round(Number(migrationOpening?.grossPay||0)+own.reduce((sum,run)=>sum+run.grossPay,0)),
          taxablePay:round(Number(migrationOpening?.taxablePay||0)+own.reduce((sum,run)=>sum+run.taxablePay,0)),
          payeTax:round(Number(migrationOpening?.payeTax||0)+own.reduce((sum,run)=>sum+run.payeTax,0)),
          employeeNic:round(Number(migrationOpening?.employeeNic||0)+own.reduce((sum,run)=>sum+run.employeeNic,0)),
          employerNic:round(Number(migrationOpening?.employerNic||0)+own.reduce((sum,run)=>sum+run.employerNic,0)),
          studentLoan:round(Number(migrationOpening?.studentLoan||0)+own.reduce((sum,run)=>sum+run.studentLoan,0)),
          postgraduateLoan:round(Number(migrationOpening?.postgraduateLoan||0)+own.reduce((sum,run)=>sum+run.postgraduateLoan,0)),
          statutoryPay:round(Number(migrationOpening?.statutoryPay||0)+own.reduce((sum,run)=>sum+run.statutoryPay,0)),
          pensionContributionNetPay:round((openingPensionMethod==="net-pay"?Number(migrationOpening?.employeePension||0):0)+own.reduce((sum,run)=>{const evidence:Record<string,unknown>=run.pensionSchemeId?parseFrozenPensionSnapshot(run.pensionSnapshot):{};return sum+(evidence.taxRelief==="net-pay"?Number(evidence.employeeDeduction??run.employeePension):0);},0)),
          pensionContributionReliefAtSource:round((openingPensionMethod==="relief-at-source"?Number(migrationOpening?.employeePension||0):0)+own.reduce((sum,run)=>{const evidence:Record<string,unknown>=run.pensionSchemeId?parseFrozenPensionSnapshot(run.pensionSnapshot):{};return sum+(evidence.taxRelief==="relief-at-source"?Number(evidence.employeeDeduction??run.employeePension):0);},0)),
          previousEmploymentPay:row.p45PreviousPay,previousEmploymentTax:row.p45PreviousTax,niByCategory:[...categories.values()],
        }};
      });
      const existing=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.payPeriodId,period.id))).orderBy(desc(submissions.id));
      const acceptedFps=existing.find(item=>item.type==="FPS"&&item.status==="accepted");
      if(type==="FPS"&&acceptedFps)errors.push("An accepted FPS already exists for this period; prepare an Additional FPS correction instead.");
      if(type==="Additional FPS"){
        correctionOf=existing.find(item=>["FPS","Additional FPS"].includes(item.type)&&item.status==="accepted")||null;
        if(!correctionOf)errors.push("An Additional FPS requires an earlier FPS or Additional FPS accepted by HMRC for this period. A local test-ready package has not been filed.");
        else {
          let priorPayload:any={};
          try{priorPayload=JSON.parse(correctionOf.payload||"{}");}catch{}
          const priorEmployees=new Map((Array.isArray(priorPayload.employees)?priorPayload.employees:[]).map((employee:any)=>[Number(employee.employeeId),employee]));
          const periodValueKeys=["grossPay","taxablePay","nicablePay","statutoryPay","payeTax","employeeNic","employerNic","studentLoan","postgraduateLoan","netPay"] as const;
          employeeRuns=employeeRuns.map(row=>{
            const prior:any=priorEmployees.get(row.employeeId)||{};
            const priorReported=correctionOf?.type==="Additional FPS"?prior.reportedPeriodValues:prior;
            if(correctionOf?.type==="Additional FPS"&&!priorReported)errors.push(`Earlier Additional FPS ${correctionOf.id} lacks a safe period baseline for employee ${row.payrollId}.`);
            return {
              ...row,
              ...Object.fromEntries(periodValueKeys.map(key=>[key,round(Number(row[key]||0)-Number(priorReported?.[key]||0))])),
              reportedPeriodValues:Object.fromEntries(periodValueKeys.map(key=>[key,round(Number(row[key]||0))])),
              correctedYearToDate:row.ytd,
            };
          });
          const hasChangedValues=employeeRuns.some(row=>periodValueKeys.some(key=>Math.abs(Number(row[key]||0))>=0.005));
          if(!hasChangedValues)errors.push("The Additional FPS contains no changed period values.");
        }
      }
    }
    const lateReason=String(input.lateReason||"").trim().toUpperCase();
    if(lateReason&&!allowedLateReasons.includes(lateReason))errors.push("Late reporting reason must be A, B, C, D, F, G or H.");
    if(type==="Additional FPS"&&lateReason!=="H")errors.push("An Additional FPS correction must use late reporting reason H.");
    employeeRuns=employeeRuns.map(row=>({...row,gender:normaliseRtiGender(row.gender),lateReason:lateReason||null}));
    for(const row of employeeRuns){
      const frozenEvidenceAdvice=" Correct the employee record, then reopen and re-finalise this period to refresh its immutable RTI snapshot.";
      if(!row.firstName.trim()||!row.lastName.trim())errors.push(`Employee ${row.payrollId} needs a full legal forename and surname for RTI in the finalised snapshot.${frozenEvidenceAdvice}`);
      if(!row.dateOfBirth||!validDate(row.dateOfBirth))errors.push(`Employee ${row.payrollId} needs a valid date of birth for RTI in the finalised snapshot.${frozenEvidenceAdvice}`);
      else if(period?.payDate&&row.dateOfBirth>period.payDate)errors.push(`Employee ${row.payrollId} has a date of birth after the payroll pay date.`);
      if(!["M","F"].includes(String(row.gender||"")))errors.push(`Employee ${row.payrollId} needs Male or Female recorded for RTI in the finalised snapshot.${frozenEvidenceAdvice}`);
      const nino=String(row.niNumber||"").replace(/\s/g,"").toUpperCase();
      if(nino&&!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(nino))errors.push(`Employee ${row.payrollId} has an invalid National Insurance number in the finalised snapshot.${frozenEvidenceAdvice}`);
      if(!nino&&(!row.address?.trim()||!row.postcode?.trim()))errors.push(`Employee ${row.payrollId} needs an address and postcode because their National Insurance number is unknown in the finalised snapshot.${frozenEvidenceAdvice}`);
    }
    if (period && !employeeRuns.length) errors.push("The finalised period contains no employee pay records.");
    const correctionReason=String(input.correctionReason||"").trim();
    if(type==="Additional FPS"&&(correctionReason.length<5||correctionReason.length>500))errors.push("An Additional FPS correction reason must contain 5 to 500 characters.");
    if(Boolean(input.finalSubmission)&&period?.periodNumber!==paySchedule.length)errors.push(`The final submission indicator can only be set for the final scheduled period (${paySchedule.length}).`);
  }
  let typeData:Record<string,unknown>={};
  if(type==="EPS") {
    const periodNumber=Number(input.periodNumber);
    if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>12)errors.push("EPS tax month must be between 1 and 12.");
    const levyPeriods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
    const periodTaxMonth=(item:typeof payPeriods.$inferSelect)=>{
      try{return item.payDate?taxMonthForDate(taxYear,item.payDate):paySchedule.find(scheduled=>scheduled.periodNumber===item.periodNumber)?.taxMonth||0;}
      catch{return 0;}
    };
    const epsPeriods=levyPeriods.filter(item=>periodTaxMonth(item)===periodNumber);
    period=[...epsPeriods].sort((left,right)=>right.periodNumber-left.periodNumber)[0]||null;
    const epsPeriodIds=new Set(epsPeriods.map(item=>item.id));
    const epsRuns=(await db.select().from(payRuns)).filter(run=>epsPeriodIds.has(run.payPeriodId));
    const levyPayBills=Array.from({length:12},()=>0);
    for(const levyPeriod of levyPeriods){
      if(levyPeriod.status!=="finalised")continue;
      const month=periodTaxMonth(levyPeriod);
      if(month<1||month>12)continue;
      const levyRuns=await db.select({nicablePay:payRuns.nicablePay}).from(payRuns).where(and(eq(payRuns.payPeriodId,levyPeriod.id),eq(payRuns.status,"finalised")));
      levyPayBills[month-1]=round(levyPayBills[month-1]+levyRuns.reduce((sum,run)=>sum+run.nicablePay,0));
    }
    const authoritativeLevy=apprenticeshipLevyByMonth(levyPayBills,employer.apprenticeshipLevy,employer.apprenticeshipLevyAllowance)[periodNumber-1]?.cumulativeDue||0;
    const employeeIds=new Set((await db.select({id:employees.id}).from(employees).where(eq(employees.employerId,employerId))).map(row=>row.id));
    const events=(await db.select().from(leaveEvents)).filter(event=>employeeIds.has(event.employeeId)&&event.status==="calculated");
    const finalisedTaxMonths=new Set(Array.from({length:12},(_,index)=>index+1).filter(month=>{
      const scheduledInMonth=paySchedule.filter(item=>item.taxMonth===month);
      return scheduledInMonth.every(item=>levyPeriods.some(periodRow=>periodRow.periodNumber===item.periodNumber&&periodRow.status==="finalised"));
    }));
    const recoveryByType:Record<string,number>={};
    let authoritativeRecovery=0;
    for(let month=1;month<=periodNumber;month++){
      if(!finalisedTaxMonths.has(month))continue;
      for(const event of events){
        const recovery=statutoryPayAllocation(event,month,taxYear).recovery;
        if(!recovery)continue;
        const paymentType=String(event.subtype||event.type||"statutory").toLowerCase().replace(/\s+leave$/,"").replaceAll(" ","-");
        recoveryByType[paymentType]=round((recoveryByType[paymentType]||0)+recovery);
        authoritativeRecovery=round(authoritativeRecovery+recovery);
      }
    }
    const recoveryPeriodIds=new Set(levyPeriods.filter(item=>periodTaxMonth(item)<=periodNumber&&item.status==="finalised").map(item=>item.id));
    const recoveryAdjustmentRows=(await db.select().from(payrollAdjustments).where(and(
      eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.type,"statutory-recovery"),eq(payrollAdjustments.status,"active"),
    ))).filter(item=>recoveryPeriodIds.has(item.payPeriodId));
    const statutoryRecoveryAdjustment=round(recoveryAdjustmentRows.reduce((sum,item)=>sum+item.amount,0));
    const correctedStatutoryRecovery=round(authoritativeRecovery+statutoryRecoveryAdjustment);
    if(correctedStatutoryRecovery<0)errors.push("Statutory recovery corrections cannot reduce the cumulative HMRC recovery below zero.");
    if(statutoryRecoveryAdjustment)recoveryByType["manual-correction"]=statutoryRecoveryAdjustment;
    const cisDeductionsSuffered=Number(input.cisDeductionsSuffered||0);
    if(!Number.isFinite(cisDeductionsSuffered)||cisDeductionsSuffered<0)errors.push("CIS deductions suffered must be a valid non-negative amount.");
    const recoveries={
      statutoryPayRecovered:Math.max(0,correctedStatutoryRecovery),
      statutoryPayRecoveredByType:recoveryByType,
      statutoryRecoveryAdjustment,
      cisDeductionsSuffered:Number.isFinite(cisDeductionsSuffered)&&cisDeductionsSuffered>=0?round(cisDeductionsSuffered):0,
      apprenticeshipLevy:authoritativeLevy,
    };
    const noPaymentForPeriod=Boolean(input.noPaymentForPeriod),employmentAllowance=Boolean(input.employmentAllowance);
    const finalSubmission=Boolean(input.finalSubmission),ceasedIndicator=Boolean(input.ceasedIndicator);
    const cessationDate=ceasedIndicator?String(input.cessationDate||""):null;
    const paymentRuns=epsRuns.filter(hasEmployeePaymentActivity);
    const unfinalisedPeriods=epsPeriods.filter(item=>item.status!=="finalised");
    if(!noPaymentForPeriod&&unfinalisedPeriods.length)errors.push("Every payroll period whose pay date falls in this tax month must be finalised before an EPS can be generated.");
    if(noPaymentForPeriod&&paymentRuns.length)errors.push("A no-payment EPS cannot be used because this tax month contains employee payment activity. Finalise and submit an FPS for each paid employee instead.");
    if(employmentAllowance&&!employer.employmentAllowance)errors.push("Employment Allowance is not enabled in the employer record.");
    if(finalSubmission&&ceasedIndicator)errors.push("Use either the final-submission indicator or the PAYE-scheme ceased indicator, not both.");
    if(finalSubmission&&periodNumber!==12)errors.push("An EPS final-submission indicator can only be set for tax month 12.");
    if(ceasedIndicator) {
      const startYear=Number(taxYear.slice(0,4));
      const validCessationDate=validDate(cessationDate)?cessationDate:null;
      const ceasedTime=validCessationDate?Date.parse(`${validCessationDate}T00:00:00Z`):NaN,yearStart=Date.UTC(startYear,3,6),yearEnd=Date.UTC(startYear+1,3,5);
      if(!validCessationDate||!Number.isFinite(ceasedTime)||ceasedTime<yearStart||ceasedTime>yearEnd)errors.push("The PAYE-scheme cessation date must be a valid calendar date within the selected tax year.");
      else {
        const activeEmployees=await db.select({payrollId:employees.payrollId,leavingDate:employees.leavingDate}).from(employees).where(eq(employees.employerId,employerId));
        if(activeEmployees.some(employee=>!employee.leavingDate||employee.leavingDate>validCessationDate))errors.push("Record a leaving date on or before the cessation date for every employee.");
      }
    }
    const hasRecoveryOrAdjustment=[recoveries.statutoryPayRecovered,recoveries.cisDeductionsSuffered,recoveries.apprenticeshipLevy].some(value=>value>0);
    if(!noPaymentForPeriod&&!employmentAllowance&&!finalSubmission&&!ceasedIndicator&&!hasRecoveryOrAdjustment)errors.push("EPS requires a no-payment declaration, Employment Allowance indicator, recovery/adjustment, final-submission indicator, or cessation indicator.");
    typeData={periodNumber,recoveries,noPaymentForPeriod,employmentAllowance,finalSubmission,ceasedIndicator,cessationDate,
      reportingWindow:epsTaxMonthWindow(taxYear,periodNumber),payroll:{finalised:epsPeriods.every(item=>item.status==="finalised"),payrollPeriods:epsPeriods.map(item=>item.periodNumber),
      unfinalisedPayrollPeriods:unfinalisedPeriods.map(item=>item.periodNumber),payRecords:epsRuns.length,employeePayments:paymentRuns.length,
      employeesWithPayments:new Set(paymentRuns.map(run=>run.employeeId)).size}};
  }
  if(type==="NVR") {
    errors.push("HMRC withdrew the NINO Verification Request service on 3 February 2025. Report the employee without a NINO on an FPS and action HMRC's response notice instead.");
    typeData={serviceStatus:"withdrawn",withdrawnDate:"2025-02-03",replacementWorkflow:"Complete the employee's identity details and report them without a NINO on the FPS."};
  }
  if(type==="EXB") {
    const rows=await db.select({
      payrollId:employees.payrollId,category:expensesBenefits.category,description:expensesBenefits.description,
      cashEquivalent:expensesBenefits.cashEquivalent,class1aNic:expensesBenefits.class1aNic,status:expensesBenefits.status,
    }).from(expensesBenefits).innerJoin(employees,eq(expensesBenefits.employeeId,employees.id))
      .where(and(eq(employees.employerId,employerId),eq(expensesBenefits.taxYear,taxYear)));
    if(!rows.length)errors.push("No expenses or benefits exist for this employer and tax year.");
    if(rows.some(row=>row.status!=="reviewed"))errors.push("Every expense or benefit must be reviewed before an EXB submission is prepared.");
    typeData={benefits:rows,totals:{cashEquivalent:round(rows.reduce((sum,row)=>sum+row.cashEquivalent,0)),class1aNic:round(rows.reduce((sum,row)=>sum+row.class1aNic,0))}};
  }
  const totals = employeeRuns.reduce((a, row) => ({
    grossPay:a.grossPay+row.grossPay, taxablePay:a.taxablePay+row.taxablePay, nicablePay:a.nicablePay+row.nicablePay, statutoryPay:a.statutoryPay+row.statutoryPay, payeTax:a.payeTax+row.payeTax,
    employeeNic:a.employeeNic+row.employeeNic, employerNic:a.employerNic+row.employerNic,
    studentLoan:a.studentLoan+row.studentLoan, postgraduateLoan:a.postgraduateLoan+row.postgraduateLoan, netPay:a.netPay+row.netPay,
  }), { grossPay:0,taxablePay:0,nicablePay:0,statutoryPay:0,payeTax:0,employeeNic:0,employerNic:0,studentLoan:0,postgraduateLoan:0,netPay:0 });
  const sourceChecksum=await sourceFingerprint(db,employerId,type,taxYear,period?.id||null,String(input.payrollId||""));
  const payload = {
    schemaVersion:"payflow-rti-draft-3", type,taxYear,
    sourceChecksum,
    periodNumber:period?.periodNumber || Number(input.periodNumber || 0), employer:{name:employer.legalName||employer.name,payeReference:employer.payeReference,accountsOfficeReference:employer.accountsOfficeReference,companyNumber:employer.companyNumber||null,corporationTaxReference:null},
    ...((type==="FPS"||type==="Additional FPS")?{
      payFrequency:frequency,
      taxWeekNumber:paySchedule.find(item=>item.periodNumber===period?.periodNumber)?.taxWeekNumber||null,
      taxMonth:paySchedule.find(item=>item.periodNumber===period?.periodNumber)?.taxMonth||null,
      payDate:period?.payDate||null,
    }:{}),
    employees:employeeRuns, totals:Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,round(value)])),
    ...((type==="FPS"||type==="Additional FPS")?{finalSubmission:Boolean(input.finalSubmission)}:{}),
    ...(type==="Additional FPS"?{
      correctionReason:String(input.correctionReason||"").trim(),
      correctionOfSubmissionId:correctionOf?.id||null,
      correctionBaselineChecksum:correctionOf?.payloadChecksum||null,
    }:{}), ...typeData,
  };
  const epsMonth=Number(input.periodNumber);
  const authoritativeDueDate=(type==="FPS"||type==="Additional FPS")?period?.payDate||null:type==="EPS"&&validTaxYear(taxYear)&&Number.isInteger(epsMonth)&&epsMonth>=1&&epsMonth<=12?epsDeadline(taxYear,epsMonth):null;
  const payloadChecksum=await sha256(JSON.stringify(payload));
  if(errors.length){
    await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:`validation-failed:rti-${type.toLowerCase().replaceAll(" ","-")}`,
      entityType:"submission-validation",entityId:payloadChecksum,
      after:JSON.stringify({type,taxYear,periodNumber:Number(input.periodNumber||0),payloadChecksum,validationErrors:errors}),
    });
    return NextResponse.json({submission:null,payload,validation:{valid:false,errors}},{status:422});
  }
  const matchingPrepared=await db.select().from(submissions).where(and(
    eq(submissions.employerId,employerId),eq(submissions.type,type),eq(submissions.payloadChecksum,payloadChecksum),
  )).orderBy(desc(submissions.id));
  for(const row of matchingPrepared){
    if(!["validated","test-ready"].includes(row.status))continue;
    let storedPayload:unknown;
    try{storedPayload=JSON.parse(row.payload||"{}");}catch{continue;}
    if(await sha256(JSON.stringify(storedPayload))!==row.payloadChecksum)continue;
    return NextResponse.json({
      submission:row,payload:storedPayload,validation:{valid:true,errors:[]},reused:true,
    });
  }
  const [created] = await db.insert(submissions).values({
    employerId, payPeriodId:type==="EPS"&&(payload as any).noPaymentForPeriod?null:period?.id || null, type,dueDate:authoritativeDueDate,
    payload:JSON.stringify(payload), status:"validated",
    payloadChecksum,
    response:"Validated locally; not transmitted to HMRC.",
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`prepared:rti-${type.toLowerCase().replaceAll(" ","-")}`,entityType:"submission",entityId:String(created.id),after:JSON.stringify({status:created.status,payloadChecksum,validationErrors:[]})});
  const prepared=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,type)));
  for(const previous of prepared) {
    if(previous.id===created.id||!["validated","test-ready"].includes(previous.status))continue;
    let previousPayload:any={};try{previousPayload=JSON.parse(previous.payload||"{}");}catch{}
    if(previousPayload.taxYear!==payload.taxYear||Number(previousPayload.periodNumber)!==Number(payload.periodNumber))continue;
    if(type==="NVR"&&previousPayload.employee?.payrollId!==(payload as any).employee?.payrollId)continue;
    await db.update(submissions).set({status:"superseded",response:`Superseded by submission draft ${created.id}.`,updatedAt:new Date().toISOString()}).where(eq(submissions.id,previous.id));
  }
  return NextResponse.json({submission:created,payload,validation:{valid:true,errors:[]}},{status:201});
}

export async function PUT(request: Request) {
  const input = await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON RTI approval object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const submissionId=Number(input.id);
  if(!Number.isInteger(submissionId)||submissionId<=0)return NextResponse.json({error:"A valid submission is required."},{status:400});
  const [existing] = await db.select().from(submissions).where(and(eq(submissions.id, submissionId), eq(submissions.employerId, employerId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Submission was not found for this employer." }, { status: 404 });
  if(input.action==="record-filing-result"){
    if(!["FPS","EPS","Additional FPS","EXB"].includes(existing.type))return NextResponse.json({error:"Only an RTI filing package can receive an HMRC result."},{status:422});
    const result=validateRtiFilingResult({
      currentStatus:existing.status,outcome:String(input.outcome||""),submittedAt:String(input.submittedAt||""),
      acknowledgementReference:String(input.acknowledgementReference||""),responseCode:String(input.responseCode||""),
      responseMessage:String(input.responseMessage||""),
    });
    if(!result.valid)return NextResponse.json({error:result.errors.join(" "),validation:result},{status:422});
    let payload:any={};try{payload=JSON.parse(existing.payload||"{}");}catch{return NextResponse.json({error:"The stored RTI payload is unreadable. Do not attach an acknowledgement to it."},{status:409});}
    if(await sha256(JSON.stringify(payload))!==existing.payloadChecksum)return NextResponse.json({error:"The stored RTI payload checksum does not match. Do not attach an acknowledgement to it."},{status:409});
    const duplicateReference=await db.select({id:submissions.id}).from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.correlationId,result.acknowledgementReference))).limit(1);
    if(duplicateReference.some(row=>row.id!==existing.id))return NextResponse.json({error:"This external acknowledgement reference is already attached to another submission."},{status:409});
    if(result.outcome==="accepted"&&existing.type==="FPS"&&existing.payPeriodId){
      const accepted=await db.select({id:submissions.id}).from(submissions).where(and(
        eq(submissions.employerId,employerId),eq(submissions.payPeriodId,existing.payPeriodId),eq(submissions.type,"FPS"),eq(submissions.status,"accepted"),
      )).limit(1);
      if(accepted.length)return NextResponse.json({error:`Accepted FPS #${accepted[0].id} already exists for this period. Prepare an Additional FPS correction instead.`},{status:409});
    }
    if(result.outcome==="accepted"&&existing.type==="Additional FPS"){
      const baselineId=Number(payload.correctionOfSubmissionId),baselineChecksum=String(payload.correctionBaselineChecksum||"");
      const [baseline]=Number.isInteger(baselineId)&&baselineId>0?await db.select().from(submissions).where(and(eq(submissions.id,baselineId),eq(submissions.employerId,employerId))).limit(1):[];
      if(!baseline||baseline.status!=="accepted"||baseline.payloadChecksum!==baselineChecksum)return NextResponse.json({error:"The accepted RTI correction baseline has changed. Regenerate the Additional FPS package."},{status:409});
    }
    const recordedAt=new Date().toISOString(),responseEvidence={
      schemaVersion:"payflow-rti-external-result-1",submissionType:existing.type,outcome:result.outcome,
      acknowledgementReference:result.acknowledgementReference,responseCode:String(input.responseCode||"").trim()||null,
      responseMessage:String(input.responseMessage||"").trim()||null,evidenceSource:String(input.evidenceSource||"external-import"),
      recordedAt,recordedBy:access.user.displayName,liveTransmissionPerformedByPayFlow:false,
    };
    const [updated]=await db.update(submissions).set({
      status:result.outcome,submittedAt:new Date(result.submittedAt).toISOString(),correlationId:result.acknowledgementReference,
      irMark:String(input.irMark||"").trim()||null,response:JSON.stringify(responseEvidence),updatedAt:recordedAt,
    }).where(and(eq(submissions.id,existing.id),eq(submissions.employerId,employerId),eq(submissions.status,existing.status))).returning();
    if(!updated)return NextResponse.json({error:"The RTI package changed while its result was being recorded."},{status:409});
    await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:`recorded:rti-${existing.type.toLowerCase().replaceAll(" ","-")}-${result.outcome}`,
      entityType:"submission",entityId:String(existing.id),
      before:JSON.stringify({status:existing.status,submittedAt:existing.submittedAt,correlationId:existing.correlationId}),
      after:JSON.stringify({...responseEvidence,submittedAt:updated.submittedAt,payloadChecksum:updated.payloadChecksum}),
    });
    return NextResponse.json({submission:updated,evidence:responseEvidence});
  }
  if (existing.status !== "validated") return NextResponse.json({ error: "Only a validated submission can move to the filing queue." }, { status: 409 });
  if (!input.declarationAccepted) return NextResponse.json({ error: "The accuracy declaration must be accepted." }, { status: 422 });
  let payload:any={};try{payload=JSON.parse(existing.payload||"{}");}catch{return NextResponse.json({error:"The stored RTI payload is unreadable and must be regenerated."},{status:409});}
  if(await sha256(JSON.stringify(payload))!==existing.payloadChecksum)return NextResponse.json({error:"The stored RTI payload checksum does not match. Regenerate the package."},{status:409});
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer||payload.employer?.payeReference!==employer.payeReference||payload.employer?.accountsOfficeReference!==employer.accountsOfficeReference)
    return NextResponse.json({error:"The employer PAYE identifiers changed after validation. Regenerate the package."},{status:409});
  if(existing.type==="Additional FPS"){
    const correctionOfSubmissionId=Number(payload.correctionOfSubmissionId),correctionBaselineChecksum=String(payload.correctionBaselineChecksum||"");
    const [baseline]=Number.isInteger(correctionOfSubmissionId)&&correctionOfSubmissionId>0
      ?await db.select().from(submissions).where(and(eq(submissions.id,correctionOfSubmissionId),eq(submissions.employerId,employerId))).limit(1):[];
    if(!baseline||baseline.status!=="accepted"||baseline.payloadChecksum!==correctionBaselineChecksum)
      return NextResponse.json({error:"The Additional FPS baseline changed after validation. Regenerate the correction package."},{status:409});
  }
  const currentSourceChecksum=await sourceFingerprint(db,employerId,existing.type,String(payload.taxYear||""),existing.payPeriodId,String(payload.employee?.payrollId||""));
  if(!payload.sourceChecksum||currentSourceChecksum!==payload.sourceChecksum)
    return NextResponse.json({error:"The RTI source records changed after validation. Regenerate the package."},{status:409});
  if(existing.payPeriodId){
    const [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.id,existing.payPeriodId),eq(payPeriods.employerId,employerId))).limit(1);
    if(!period||period.status!=="finalised")return NextResponse.json({error:"The source payroll period is no longer finalised. Regenerate the package after payroll is finalised."},{status:409});
  }
  const acceptedAt=new Date().toISOString();
  const [updated] = await db.update(submissions).set({
    status:"test-ready",preparedAt:acceptedAt,declarationAcceptedAt:acceptedAt,declarationAcceptedBy:access.user.displayName,submittedAt:null,correlationId:`PF-TEST-${Date.now()}`,
    response:"Prepared for an HMRC-recognised transport adapter; no live filing occurred.", updatedAt:new Date().toISOString(),
  }).where(and(eq(submissions.id, existing.id), eq(submissions.employerId, employerId))).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"approved:rti-test-package",entityType:"submission",entityId:String(existing.id),before:JSON.stringify({status:existing.status}),after:JSON.stringify({status:updated.status,preparedAt:acceptedAt,payloadChecksum:updated.payloadChecksum,liveTransmission:false})});
  return NextResponse.json(updated);
}
