import { NextResponse } from "next/server";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { attachmentOrderDeductions, attachmentOrders, auditLog, departments, employeeLoanDeductions, employeeLoans, employeePayRounding, employees, employers, employerSettings, expensesBenefits, holidayFundEntries, holidayFundSettings, leaveEvents, payrollAdjustments, payrollOpeningBalances, payItems, payPeriods, payRoundingEntries, payRuns, pensionMembershipEvents, pensionMemberships, pensionSchemes, recurringPayItems, submissions } from "../../../db/schema";
import { calculateMonthlyPayroll, p45OpeningBalances, type PayrollInput } from "../../../lib/payroll-engine";
import { attachmentPriority, calculateAttachment } from "../../../lib/attachment-engine";
import { employeeActiveInRange, statutoryPayAllocation, statutoryPayAllocationForRange } from "../../../lib/pay-periods";
import { assessPension } from "../../../lib/pension-engine";
import { applyDeductionAdjustments } from "../../../lib/payroll-adjustments";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { allocateEmployeeLoanRecoveries } from "../../../lib/employee-loans";
import { applyCashPayRounding } from "../../../lib/pay-rounding";
import { totalPayrolledBenefitsForRange } from "../../../lib/payrolled-benefits";
import { payrollFrequencyRule, scheduledPayPeriods, validatePayrollPeriod, type PayrollFrequency } from "../../../lib/pay-frequency";
import { calculateChildcareVoucher, childcareVoucherBandFromName } from "../../../lib/childcare-vouchers";
import { calculateHolidayFundPeriod, holidayFundEntryEvidence, type HolidayFundPeriodResult } from "../../../lib/holiday-fund";
import { hasEmployeePaymentActivity } from "../../../lib/eps-no-payment";

type EmployeePayInput = PayrollInput & {
  employeeId?: number;
  payrollId: string;
  firstName: string;
  lastName: string;
  email?: string;
  annualSalary?: number;
  hourlyRate?: number;
  payrollNote?:string;
  postLeavingPayment?:boolean;
  postLeavingNicBasis?:"usual"|"weekly";
  postLeavingP45Issued?:boolean;
  items?: Array<{
    type:"earning"|"benefit"|"pre-tax-deduction"|"post-tax-deduction"|"salary-sacrifice"|"payroll-giving"|"childcare-voucher";
    name:string;quantity?:number;rate?:number;amount?:number;
    taxable?:boolean;nicable?:boolean;pensionable?:boolean;
    recurringItemId?:number|null;
  }>;
};
const isoDay=(value:string)=>Date.parse(`${value}T00:00:00Z`);
const elapsedPayDays=(fromDate:string,toDate:string)=>Math.max(1,Math.round((isoDay(toDate)-isoDay(fromDate))/86_400_000));

const payItemTypes=["earning","benefit","pre-tax-deduction","post-tax-deduction","salary-sacrifice","payroll-giving","childcare-voucher"];
const numericPayFields=[
  "grossPay","taxableGrossPay","nicableGrossPay","pensionableGrossPay","taxableBenefits","preTaxDeductions",
  "taxablePreTaxDeductions","postTaxDeductions","statutoryPay","contractedHours",
] as const;
const forbiddenClientYtdFields=["ytdTaxablePay","ytdTaxPaid","ytdNicablePay","ytdEmployeeNic","ytdEmployerNic"] as const;
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
type RtiWorkflowTask={
  type:"FPS"|"EPS_NO_PAYMENT"|"EPS_RECOVERY";
  periodNumber:number;
  taxMonth:number;
  reason:"employee-payments"|"no-employee-payments"|"statutory-pay-recovery";
  amount?:number;
  statutoryPayByType?:Record<string,number>;
};
const roundMoney=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const statutoryPayKey=(value:unknown)=>String(value||"statutory").toLowerCase().replace(/\s+leave$/," ").trim().replaceAll(" ","-");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const employerId = Number(url.searchParams.get("employerId") || 1);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const taxYear = url.searchParams.get("taxYear") || "2026/27";
  const db = getDb();
  const [workflowEmployer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
    .where(eq(employers.id,employerId)).limit(1);
  const periods = await db.select().from(payPeriods).where(and(eq(payPeriods.employerId, employerId), eq(payPeriods.taxYear, taxYear))).orderBy(asc(payPeriods.periodNumber));
  const runs = await db.select({
    id: payRuns.id,
    payPeriodId: payRuns.payPeriodId,
    employeeId: payRuns.employeeId,
    grossPay: payRuns.grossPay,
    taxablePay: payRuns.taxablePay,
    nicablePay:payRuns.nicablePay,
    payeTax: payRuns.payeTax,
    employeeNic: payRuns.employeeNic,
    employerNic: payRuns.employerNic,
    studentLoan: payRuns.studentLoan,
    postgraduateLoan: payRuns.postgraduateLoan,
    pensionablePay:payRuns.pensionablePay,
    pensionSchemeId:payRuns.pensionSchemeId,
    employeePension: payRuns.employeePension,
    employerPension: payRuns.employerPension,
    statutoryPay: payRuns.statutoryPay,
    otherDeductions: payRuns.otherDeductions,
    netPay: payRuns.netPay,
    payrollNote:payRuns.payrollNote,
    rtiSnapshot:payRuns.rtiSnapshot,
    pensionSnapshot:payRuns.pensionSnapshot,
    status: payRuns.status,
    confidential:employees.confidential,
  }).from(payRuns).innerJoin(payPeriods, eq(payRuns.payPeriodId, payPeriods.id))
    .innerJoin(employees,eq(payRuns.employeeId,employees.id)).where(and(
    eq(payPeriods.employerId, employerId),
    eq(payPeriods.taxYear, taxYear),
    eq(employees.employerId,employerId),
  )).orderBy(asc(payRuns.payPeriodId), asc(payRuns.employeeId));
  const visibleRuns=access.membership.canViewConfidential?runs:runs.filter(run=>!run.confidential);
  const runIds=new Set(visibleRuns.map(run=>run.id));
  const items=(await db.select().from(payItems).orderBy(asc(payItems.id))).filter(item=>runIds.has(item.payRunId));
  const openingBalances=await db.select({
    id:payrollOpeningBalances.id,employeeId:payrollOpeningBalances.employeeId,taxYear:payrollOpeningBalances.taxYear,
    firstPayFlowPeriod:payrollOpeningBalances.firstPayFlowPeriod,grossPay:payrollOpeningBalances.grossPay,
    taxablePay:payrollOpeningBalances.taxablePay,payeTax:payrollOpeningBalances.payeTax,nicablePay:payrollOpeningBalances.nicablePay,
    employeeNic:payrollOpeningBalances.employeeNic,employerNic:payrollOpeningBalances.employerNic,
    nicCategoryBreakdown:payrollOpeningBalances.nicCategoryBreakdown,
    studentLoan:payrollOpeningBalances.studentLoan,postgraduateLoan:payrollOpeningBalances.postgraduateLoan,
    statutoryPay:payrollOpeningBalances.statutoryPay,employeePension:payrollOpeningBalances.employeePension,
    employerPension:payrollOpeningBalances.employerPension,netPay:payrollOpeningBalances.netPay,
    source:payrollOpeningBalances.source,notes:payrollOpeningBalances.notes,payloadChecksum:payrollOpeningBalances.payloadChecksum,
    confidential:employees.confidential,
  }).from(payrollOpeningBalances).innerJoin(employees,eq(payrollOpeningBalances.employeeId,employees.id)).where(and(
    eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),eq(employees.employerId,employerId),
  ));
  const workflowFilings=await db.select({
    payPeriodId:submissions.payPeriodId,type:submissions.type,status:submissions.status,payload:submissions.payload,
  }).from(submissions).where(eq(submissions.employerId,employerId));
  const completedRtiPeriodIds=new Set(workflowFilings.filter(row=>row.type==="FPS"&&row.payPeriodId&&row.status==="accepted").map(row=>row.payPeriodId!));
  const acceptedEpsPayloads=workflowFilings.flatMap(row=>{
    if(row.type!=="EPS"||row.status!=="accepted")return [];
    try{const payload=JSON.parse(row.payload||"{}");return payload.taxYear===taxYear?[payload]:[];}catch{return [];}
  });
  const acceptedNoPaymentTaxMonths=new Set(acceptedEpsPayloads.filter(payload=>payload.noPaymentForPeriod===true&&Number.isInteger(Number(payload.periodNumber))).map(payload=>Number(payload.periodNumber)));
  const preparedPensionPeriodIds=new Set(workflowFilings.filter(row=>row.type==="PENSION-PROVIDER"&&row.payPeriodId&&["prepared","submitted","accepted"].includes(row.status)).map(row=>row.payPeriodId!));
  const finalisedPeriods=periods.filter(row=>row.status==="finalised");
  const pensionContributionPeriodIds=new Set(runs.filter(run=>run.status==="finalised"&&run.pensionSchemeId&&(run.employeePension!==0||run.employerPension!==0)).map(run=>run.payPeriodId));
  const periodByNumber=new Map(periods.map(row=>[row.periodNumber,row]));
  const runsByPeriodId=new Map<number,typeof runs>();
  for(const run of runs)runsByPeriodId.set(run.payPeriodId,[...(runsByPeriodId.get(run.payPeriodId)||[]),run]);
  const workflowEmployeeIds=new Set(runs.map(run=>run.employeeId));
  const workflowLeaveEvents=(await db.select().from(leaveEvents)).filter(event=>workflowEmployeeIds.has(event.employeeId)&&event.status==="calculated");
  const rtiTasks:RtiWorkflowTask[]=[];
  if(workflowEmployer){
    const workflowSchedule=scheduledPayPeriods(taxYear,payrollFrequencyRule(workflowEmployer.payFrequency).frequency,workflowEmployer.firstPayDate||undefined);
    for(const scheduled of workflowSchedule){
      const stored=periodByNumber.get(scheduled.periodNumber);
      if(stored?.status!=="finalised"||completedRtiPeriodIds.has(stored.id))continue;
      const hasPayments=(runsByPeriodId.get(stored.id)||[]).some(run=>run.status==="finalised"&&hasEmployeePaymentActivity(run));
      if(hasPayments)rtiTasks.push({type:"FPS",periodNumber:stored.periodNumber,taxMonth:scheduled.taxMonth,reason:"employee-payments"});
    }
    for(const taxMonth of Array.from({length:12},(_,index)=>index+1)){
      const scheduledMonth=workflowSchedule.filter(item=>item.taxMonth===taxMonth);
      const storedMonth=scheduledMonth.map(item=>periodByNumber.get(item.periodNumber));
      const monthComplete=storedMonth.length>0&&storedMonth.every(row=>row&&["finalised","migrated"].includes(row.status));
      const hasPayFlowPeriod=storedMonth.some(row=>row?.status==="finalised");
      const hasPayments=storedMonth.some(row=>row&&(runsByPeriodId.get(row.id)||[]).some(run=>run.status==="finalised"&&hasEmployeePaymentActivity(run)));
      if(monthComplete&&hasPayFlowPeriod&&!hasPayments&&!acceptedNoPaymentTaxMonths.has(taxMonth)){
        const taskPeriod=scheduledMonth.at(-1)!.periodNumber;
        rtiTasks.push({type:"EPS_NO_PAYMENT",periodNumber:taskPeriod,taxMonth,reason:"no-employee-payments"});
      }
    }
    let cumulativeRecovery=0;
    const cumulativeRecoveryByType:Record<string,number>={};
    let recoveryTask:RtiWorkflowTask|undefined;
    for(const taxMonth of Array.from({length:12},(_,index)=>index+1)){
      const scheduledMonth=workflowSchedule.filter(item=>item.taxMonth===taxMonth);
      const storedMonth=scheduledMonth.map(item=>periodByNumber.get(item.periodNumber));
      const monthComplete=storedMonth.length>0&&storedMonth.every(row=>row&&["finalised","migrated"].includes(row.status));
      const hasPayFlowPeriod=storedMonth.some(row=>row?.status==="finalised");
      if(monthComplete){
        for(const event of workflowLeaveEvents){
          const recovery=statutoryPayAllocation(event,taxMonth,taxYear).recovery;
          if(!recovery)continue;
          const key=statutoryPayKey(event.subtype||event.type);
          cumulativeRecoveryByType[key]=roundMoney((cumulativeRecoveryByType[key]||0)+recovery);
          cumulativeRecovery=roundMoney(cumulativeRecovery+recovery);
        }
      }
      if(!monthComplete||!hasPayFlowPeriod||cumulativeRecovery<=0)continue;
      const covered=acceptedEpsPayloads.some(payload=>Number(payload.periodNumber)>=taxMonth&&Number(payload.recoveries?.statutoryPayRecovered||0)+0.005>=cumulativeRecovery);
      if(!covered)recoveryTask={
        type:"EPS_RECOVERY",periodNumber:scheduledMonth.at(-1)!.periodNumber,taxMonth,
        reason:"statutory-pay-recovery",amount:cumulativeRecovery,statutoryPayByType:{...cumulativeRecoveryByType},
      };
    }
    if(recoveryTask)rtiTasks.push(recoveryTask);
  }
  rtiTasks.sort((left,right)=>left.periodNumber-right.periodNumber||({FPS:0,EPS_NO_PAYMENT:1,EPS_RECOVERY:1}[left.type]-{FPS:0,EPS_NO_PAYMENT:1,EPS_RECOVERY:1}[right.type]));
  const rtiReadyPeriods=[...new Set(rtiTasks.map(task=>task.periodNumber))];
  const pensionReadyPeriods=finalisedPeriods.filter(row=>pensionContributionPeriodIds.has(row.id)&&!preparedPensionPeriodIds.has(row.id)).map(row=>row.periodNumber);
  return NextResponse.json({
    periods,runs:visibleRuns,items,openingBalances:access.membership.canViewConfidential?openingBalances:openingBalances.filter(row=>!row.confidential),
    workflowStatus:{
      rti:{count:rtiReadyPeriods.length,returnCount:rtiTasks.length,periods:rtiReadyPeriods,tasks:rtiTasks},
      pensions:{count:pensionReadyPeriods.length,periods:pensionReadyPeriods},
    },
  });
}

export async function POST(request: Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON payroll operation object is required."},{status:400});
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const taxYear = String(input.taxYear || "");
  const periodNumber = Number(input.periodNumber);
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  if(taxYear!=="2026/27")return NextResponse.json({error:`Payroll calculation rules for ${taxYear} are not installed. Add the approved PAYE, NIC, loan, statutory-pay and minimum-wage tables before processing this year.`},{status:422});
  if(!["draft","finalise"].includes(String(input.action||"draft")))return NextResponse.json({error:"Payroll action must be draft or finalise."},{status:400});
  const operationSource=String(input.source||"manual");
  if(!["manual","pay-details-csv"].includes(operationSource))return NextResponse.json({error:"Payroll source must be manual or pay-details-csv."},{status:400});
  if(input.action==="finalise"&&operationSource!=="manual")return NextResponse.json({error:"Imported pay details must be saved and reviewed as a draft before finalisation."},{status:409});
  const db = getDb();
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
    .where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  let frequency:PayrollFrequency,schedule:ReturnType<typeof scheduledPayPeriods>;
  try {
    frequency=payrollFrequencyRule(employer.payFrequency).frequency;
    validatePayrollPeriod(frequency,periodNumber);
    schedule=scheduledPayPeriods(taxYear,frequency,employer.firstPayDate||undefined);
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});
  }
  const scheduledPeriod=schedule.find(item=>item.periodNumber===periodNumber);
  if(!scheduledPeriod)return NextResponse.json({error:`Period ${periodNumber} does not occur in this employer's ${payrollFrequencyRule(frequency).label.toLowerCase()} schedule for ${taxYear}.`},{status:422});
  const requestedPayDate=String(input.payDate||""),payDateTime=Date.parse(`${requestedPayDate}T00:00:00Z`);
  const periodRange={start:isoDay(scheduledPeriod.periodStart),end:isoDay(scheduledPeriod.periodEnd)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedPayDate)||!Number.isFinite(payDateTime)||new Date(payDateTime).toISOString().slice(0,10)!==requestedPayDate)
    return NextResponse.json({error:"A valid payroll pay date is required."},{status:422});
  if(frequency==="monthly"&&(payDateTime<periodRange.start||payDateTime>periodRange.end))
    return NextResponse.json({error:`The pay date must fall within PAYE tax month ${scheduledPeriod.taxMonth}.`},{status:422});
  if(frequency!=="monthly"&&requestedPayDate!==scheduledPeriod.payDate)
    return NextResponse.json({error:`Period ${periodNumber} must use the scheduled pay date ${scheduledPeriod.payDate}.`},{status:422});
  const confirmedEmptyPayroll=input.action==="finalise"&&input.confirmNoEmployeePayments===true;
  if(!Array.isArray(input.employees)||input.employees.length>500||(!input.employees.length&&!confirmedEmptyPayroll))
    return NextResponse.json({error:"Payroll must contain between 1 and 500 employees, unless an empty payroll is explicitly confirmed during finalisation."},{status:400});
  const records = input.employees as EmployeePayInput[];
  const identities=new Set<string>();
  for(let index=0;index<records.length;index++){
    const record=records[index],label=`Employee ${index+1}`;
    if(!record||typeof record!=="object")return NextResponse.json({error:`${label} is not a valid payroll record.`},{status:422});
    const payrollId=String(record.payrollId||"").trim(),employeeId=record.employeeId===undefined?undefined:Number(record.employeeId);
    if(!payrollId)return NextResponse.json({error:`${label} requires a payroll ID.`},{status:422});
    if(employeeId!==undefined&&(!Number.isInteger(employeeId)||employeeId<=0))return NextResponse.json({error:`${label} has an invalid employee ID.`},{status:422});
    const identity=employeeId?`id:${employeeId}`:`payroll:${payrollId}`;
    if(identities.has(identity))return NextResponse.json({error:`${label} duplicates another employee in this payroll request.`},{status:409});
    identities.add(identity);
    for(const field of numericPayFields){
      const value=record[field];
      if(value!==undefined&&value!==null&&(!Number.isFinite(Number(value))||Number(value)<0))
        return NextResponse.json({error:`${label} has an invalid non-negative value for ${field}.`},{status:422});
    }
    if(forbiddenClientYtdFields.some(field=>record[field]!==undefined))
      return NextResponse.json({error:`${label} cannot supply year-to-date payroll totals; PayFlow derives them from finalised payroll and validated P45 evidence.`},{status:422});
    if(record.items!==undefined&&!Array.isArray(record.items))return NextResponse.json({error:`${label} pay items must be an array.`},{status:422});
    const items=record.items||[];
    if(items.length>100)return NextResponse.json({error:`${label} cannot contain more than 100 pay items.`},{status:422});
    for(let itemIndex=0;itemIndex<items.length;itemIndex++){
      const item=items[itemIndex],itemLabel=`${label}, pay item ${itemIndex+1}`;
      if(!payItemTypes.includes(String(item?.type||"")))return NextResponse.json({error:`${itemLabel} has an unsupported type.`},{status:422});
      const name=String(item?.name||"").trim();
      if(!name||name.length>100)return NextResponse.json({error:`${itemLabel} requires a description of 1 to 100 characters.`},{status:422});
      for(const field of ["quantity","rate","amount"] as const){
        const value=item?.[field];
        if(value!==undefined&&value!==null&&(!Number.isFinite(Number(value))||Number(value)<0))
          return NextResponse.json({error:`${itemLabel} has an invalid non-negative ${field}.`},{status:422});
      }
      if(item?.recurringItemId!==undefined&&item.recurringItemId!==null&&(!Number.isInteger(Number(item.recurringItemId))||Number(item.recurringItemId)<=0))
        return NextResponse.json({error:`${itemLabel} has an invalid recurring schedule reference.`},{status:422});
    }
    if(items.length&&!items.some(item=>item.type==="earning"))return NextResponse.json({error:`${label}: Itemised payroll must include at least one earning line.`},{status:422});
    if(!items.length&&record.grossPay===undefined)return NextResponse.json({error:`${label} requires gross pay or itemised earnings.`},{status:422});
  }
  const resolvedEmployees:typeof employees.$inferSelect[]=[];
  for(const record of records){
    const [existing]=record.employeeId
      ?await db.select().from(employees).where(and(eq(employees.id,Number(record.employeeId)),eq(employees.employerId,employerId))).limit(1)
      :await db.select().from(employees).where(and(eq(employees.payrollId,String(record.payrollId)),eq(employees.employerId,employerId))).limit(1);
    if(!existing||existing.payrollId!==String(record.payrollId)||existing.confidential&&!access.membership.canViewConfidential)
      return NextResponse.json({error:"One or more employees were not found for this employer."},{status:404});
    if(existing.reportedPayFrequency!==frequency)
      return NextResponse.json({error:`Employee ${existing.payrollId} reports ${existing.reportedPayFrequency} pay but this employer runs ${frequency} payroll. Correct the employee's RTI frequency before processing.`},{status:409});
    resolvedEmployees.push(existing);
  }
  const departmentRows=await db.select().from(departments).where(eq(departments.employerId,employerId));
  const departmentById=new Map(departmentRows.map(department=>[department.id,department]));
  for(const employee of resolvedEmployees){
    const activeOrders=await db.select({reference:attachmentOrders.reference,payFrequency:attachmentOrders.payFrequency,calculationRule:attachmentOrders.calculationRule}).from(attachmentOrders)
      .where(and(eq(attachmentOrders.employeeId,employee.id),eq(attachmentOrders.status,"active")));
    const expectedOrderFrequency=frequency;
    const incompatibleOrder=activeOrders.find(order=>order.payFrequency!==expectedOrderFrequency);
    if(incompatibleOrder)return NextResponse.json({error:`Attachment order ${incompatibleOrder.reference} for ${employee.payrollId} uses ${incompatibleOrder.payFrequency} bands but this payroll requires ${expectedOrderFrequency} bands.`},{status:409});
  }
  if(input.action==="finalise"){
    const employerEmployees=await db.select().from(employees).where(eq(employees.employerId,employerId));
    const suppliedIds=new Set(resolvedEmployees.map(employee=>employee.id));
    const missing=employerEmployees.filter(employee=>employeeActiveInRange(employee.startDate,employee.leavingDate,scheduledPeriod.periodStart,scheduledPeriod.periodEnd)&&!suppliedIds.has(employee.id));
    if(missing.length){
      if(missing.some(employee=>employee.confidential)&&!access.membership.canViewConfidential)
        return NextResponse.json({error:"Confidential employee permission is required to finalise a complete payroll period."},{status:403});
      return NextResponse.json({error:`Finalisation must include every employee active in this period. Missing payroll IDs: ${missing.map(employee=>employee.payrollId).join(", ")}.`},{status:409});
    }
  }
  for(let index=0;index<records.length;index++){
    const record=records[index],employee=resolvedEmployees[index],postLeavingPayment=record.postLeavingPayment===true;
    const validPostLeavingPayment=postLeavingPayment&&Boolean(employee.leavingDate)&&Date.parse(`${employee.leavingDate}T00:00:00Z`)<periodRange.start;
    if(postLeavingPayment&&!validPostLeavingPayment)return NextResponse.json({error:`${employee.payrollId}: payment after leaving can only be used in a payroll period that starts after the recorded leaving date.`},{status:422});
    if(postLeavingPayment&&record.postLeavingP45Issued!==true)return NextResponse.json({error:`${employee.payrollId}: confirm that the employee's P45 was issued before setting the payment-after-leaving FPS indicator.`},{status:422});
    const postLeavingNicBasis=String(record.postLeavingNicBasis||"weekly");
    if(postLeavingPayment&&!["usual","weekly"].includes(postLeavingNicBasis))return NextResponse.json({error:`${employee.payrollId}: select usual-period NIC for a final salary or weekly NIC for an irregular payment.`},{status:422});
    if(postLeavingPayment&&(record.items||[]).filter(item=>item.type==="earning").reduce((sum,item)=>sum+Math.max(0,Number(item.amount??Number(item.quantity??1)*Number(item.rate??0))),0)<=0)
      return NextResponse.json({error:`${employee.payrollId}: enter a positive taxable payment after leaving.`},{status:422});
  }
  const scheduledByRecord:typeof recurringPayItems.$inferSelect[][]=[];
  for(let index=0;index<records.length;index++){
    const record=records[index],employee=resolvedEmployees[index];
    const scheduled=await db.select().from(recurringPayItems).where(and(
      eq(recurringPayItems.employerId,employerId),eq(recurringPayItems.employeeId,employee.id),
      eq(recurringPayItems.taxYear,taxYear),
    ));
    const ownedScheduleIds=new Set(scheduled.map(item=>item.id));
    if((record.items||[]).some(item=>item.recurringItemId&&!ownedScheduleIds.has(Number(item.recurringItemId))))
      return NextResponse.json({error:`Employee ${index+1} has a recurring schedule reference that does not belong to this employee and tax year.`},{status:422});
    const applicable=scheduled.filter(item=>item.startPeriod<=periodNumber&&item.endPeriod>=periodNumber);
    const implicit=applicable.filter(item=>!(record.items||[]).some(line=>Number(line.recurringItemId)===item.id));
    if((record.items||[]).length+implicit.length>100)
      return NextResponse.json({error:`Employee ${index+1} cannot contain more than 100 supplied and scheduled pay items.`},{status:422});
    scheduledByRecord.push(scheduled);
  }
  const yearPeriods = await db.select().from(payPeriods).where(and(eq(payPeriods.employerId, employerId), eq(payPeriods.taxYear, taxYear))).orderBy(asc(payPeriods.periodNumber));
  let firstOpenPeriod=1;
  while(yearPeriods.some(p=>p.periodNumber===firstOpenPeriod&&["finalised","migrated"].includes(p.status)))firstOpenPeriod++;
  if(periodNumber!==firstOpenPeriod) {
    return NextResponse.json({error:`Period ${firstOpenPeriod} must be completed before period ${periodNumber} can be processed.`},{status:409});
  }
  let [period] = await db.select().from(payPeriods).where(and(eq(payPeriods.employerId, employerId), eq(payPeriods.taxYear, taxYear), eq(payPeriods.periodNumber, periodNumber))).limit(1);
  if(period&&period.frequency!==frequency)return NextResponse.json({error:`Period ${periodNumber} is stored as ${period.frequency} but the employer is configured for ${frequency} payroll.`},{status:409});
  if (!period) {
    [period] = await db.insert(payPeriods).values({
      employerId,taxYear,periodNumber,frequency,payDate:requestedPayDate,status:"open",
      periodStart:scheduledPeriod.periodStart,periodEnd:scheduledPeriod.periodEnd,
    }).returning();
  }
  if (period.status === "finalised") return NextResponse.json({ error: `Period ${periodNumber} is already finalised.` }, { status: 409 });
  [period]=await db.update(payPeriods).set({
    payDate:requestedPayDate,periodStart:scheduledPeriod.periodStart,
    periodEnd:scheduledPeriod.periodEnd,status:"open",updatedAt:new Date().toISOString(),
  }).where(eq(payPeriods.id,period.id)).returning();
  const priorPeriodPayDate=yearPeriods.find(item=>item.periodNumber===periodNumber-1)?.payDate||
    new Date(periodRange.start-86_400_000).toISOString().slice(0,10);

  const [activePensionScheme]=await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.employerId,employerId),eq(pensionSchemes.status,"active"))).limit(1);
  const assessmentDate=requestedPayDate;
  const calculated = [];
  for (let recordIndex=0;recordIndex<records.length;recordIndex++) {
    const record=records[recordIndex],employee=resolvedEmployees[recordIndex];
    const activeInPeriod=employeeActiveInRange(employee.startDate,employee.leavingDate,scheduledPeriod.periodStart,scheduledPeriod.periodEnd);
    const postLeavingPayment=record.postLeavingPayment===true;
    const validPostLeavingPayment=postLeavingPayment&&Boolean(employee.leavingDate)&&Date.parse(`${employee.leavingDate}T00:00:00Z`)<periodRange.start;
    const postLeavingNicBasis=String(record.postLeavingNicBasis||"weekly");
    if(!activeInPeriod&&!validPostLeavingPayment) {
      const staleRuns=await db.select({id:payRuns.id}).from(payRuns).where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.employeeId,employee.id)));
      for(const stale of staleRuns){
        await db.update(holidayFundEntries).set({payRunId:null,sourceChecksum:null,updatedAt:new Date().toISOString()})
          .where(and(eq(holidayFundEntries.payRunId,stale.id),eq(holidayFundEntries.employerId,employerId),eq(holidayFundEntries.status,"draft")));
        await db.delete(payItems).where(eq(payItems.payRunId,stale.id));
      }
      await db.delete(payRuns).where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.employeeId,employee.id)));
      calculated.push({employee,result:null,skipped:true,reason:"outside-employment-dates"});
      continue;
    }
    const scheduled=scheduledByRecord[recordIndex];
    const scheduledForPeriod=postLeavingPayment?[]:scheduled.filter(item=>item.startPeriod<=periodNumber&&item.endPeriod>=periodNumber);
    const supplied=record.items||[];
    const scheduledLines=scheduledForPeriod.filter(item=>!supplied.some(line=>Number(line.recurringItemId)===item.id)).map(item=>({
      type:item.type as any,name:item.name,quantity:1,rate:item.amount,amount:item.amount,
      taxable:item.taxable,nicable:item.nicable,pensionable:item.pensionable,recurringItemId:item.id,
    }));
    let lines=[...supplied,...scheduledLines].map(line=>{
      const quantity=Math.max(0,Number(line.quantity??1)),rate=Math.max(0,Number(line.rate??0));
      const amount=Math.round(Math.max(0,Number(line.amount??quantity*rate))*100)/100;
      return {...line,quantity,rate,amount,name:String(line.name||"Pay item").slice(0,100),recurringItemId:line.recurringItemId?Number(line.recurringItemId):null};
    });
    const statutoryEvents=await db.select().from(leaveEvents).where(and(eq(leaveEvents.employeeId,employee.id),eq(leaveEvents.status,"calculated")));
    const statutoryAllocations=postLeavingPayment?[]:statutoryEvents.map(event=>({event,...statutoryPayAllocationForRange(event,scheduledPeriod.periodStart,scheduledPeriod.periodEnd)}));
    const statutoryPayByType:Record<string,number>={},statutoryRecoveryByType:Record<string,number>={};
    for(const allocation of statutoryAllocations){
      const key=statutoryPayKey(allocation.event.subtype||allocation.event.type);
      if(allocation.pay)statutoryPayByType[key]=roundMoney((statutoryPayByType[key]||0)+allocation.pay);
      if(allocation.recovery)statutoryRecoveryByType[key]=roundMoney((statutoryRecoveryByType[key]||0)+allocation.recovery);
    }
    const automaticStatutoryPay=roundMoney(Object.values(statutoryPayByType).reduce((sum,value)=>sum+value,0));
    const manualStatutoryPay=Math.max(0,Number(record.statutoryPay||0));
    if(manualStatutoryPay)statutoryPayByType.unclassified=roundMoney((statutoryPayByType.unclassified||0)+manualStatutoryPay);
    const statutoryRecovery=roundMoney(Object.values(statutoryRecoveryByType).reduce((sum,value)=>sum+value,0));
    const nonAttachableStatutoryPay=roundMoney(statutoryAllocations.filter(allocation=>allocation.event.subtype!=="sick").reduce((sum,allocation)=>sum+allocation.pay,0));
    const statutoryPay=roundMoney(automaticStatutoryPay+manualStatutoryPay);
    const [holidaySetting]=await db.select().from(holidayFundSettings).where(and(
      eq(holidayFundSettings.employerId,employerId),eq(holidayFundSettings.employeeId,employee.id),eq(holidayFundSettings.status,"active"),
    )).limit(1);
    const [holidayEntry]=holidaySetting?await db.select().from(holidayFundEntries).where(and(
      eq(holidayFundEntries.holidayFundSettingId,holidaySetting.id),eq(holidayFundEntries.payPeriodId,period.id),
    )).limit(1):[];
    let holidayFund:HolidayFundPeriodResult|null=null;
    if(holidaySetting&&holidaySetting.startDate<=requestedPayDate){
      const ordinaryEarnings=lines.filter(line=>line.type==="earning");
      const explicitBasicAndHourly=ordinaryEarnings.filter(line=>line.name===`${payrollFrequencyRule(frequency).label} salary`||line.name==="Monthly salary"||line.name==="Additional hours");
      const basicAndHourlyPay=(explicitBasicAndHourly.length?explicitBasicAndHourly:ordinaryEarnings).reduce((sum,line)=>sum+line.amount,0);
      try{
        holidayFund=calculateHolidayFundPeriod({
          schemeType:holidaySetting.schemeType as any,workerType:holidaySetting.workerType as any,
          contractConfirmed:holidaySetting.contractConfirmed,accrualRate:holidaySetting.accrualRate,
          openingBalance:holidaySetting.currentBalance,basicAndHourlyPay,
          totalPay:ordinaryEarnings.reduce((sum,line)=>sum+line.amount,0),
          manualAdded:holidayEntry?.manualAdded||0,requestedPaid:holidayEntry?.requestedPaid||0,
          referencePayOverride:holidayEntry?.referencePayOverride,
          hasStatutoryAbsence:statutoryEvents.some(event=>statutoryPayAllocationForRange(event,scheduledPeriod.periodStart,scheduledPeriod.periodEnd).pay>0),
        });
      }catch(error){return NextResponse.json({error:`${employee.payrollId}: ${error instanceof Error?error.message:"Holiday-fund calculation failed."}`},{status:422});}
      if(holidayFund.payslipLine==="rolled-up-holiday-pay"&&holidayFund.paidAmount>0)lines.push({
        type:"earning",name:"Rolled-up holiday pay",quantity:1,rate:holidayFund.paidAmount,amount:holidayFund.paidAmount,
        taxable:true,nicable:true,pensionable:true,recurringItemId:null,
      });
      if(holidayFund.payslipLine==="taxable-holiday-pay"&&holidayFund.paidAmount>0)lines.push({
        type:"earning",name:"Holiday fund payment",quantity:1,rate:holidayFund.paidAmount,amount:holidayFund.paidAmount,
        taxable:true,nicable:true,pensionable:true,recurringItemId:null,
      });
      if(holidayFund.payslipLine==="non-taxable-savings-withdrawal"&&holidayFund.paidAmount>0)lines.push({
        type:"earning",name:"Holiday savings withdrawal",quantity:1,rate:holidayFund.paidAmount,amount:holidayFund.paidAmount,
        taxable:false,nicable:false,pensionable:false,recurringItemId:null,
      });
      if(holidayFund.postTaxDeduction>0)lines.push({
        type:"post-tax-deduction",name:"Holiday savings contribution",quantity:1,rate:holidayFund.postTaxDeduction,amount:holidayFund.postTaxDeduction,
        taxable:false,nicable:false,pensionable:false,recurringItemId:null,
      });
    }
    const earnings=lines.filter(line=>line.type==="earning");
    const salarySacrificeLines=lines.filter(line=>line.type==="salary-sacrifice"),salarySacrifice=salarySacrificeLines.reduce((sum,line)=>sum+line.amount,0);
    const childcareVoucherLines=lines.filter(line=>line.type==="childcare-voucher"),childcareVoucherSacrifice=childcareVoucherLines.reduce((sum,line)=>sum+line.amount,0);
    const cashSacrifice=salarySacrifice+childcareVoucherSacrifice;
    const contractualGross=earnings.reduce((sum,line)=>sum+line.amount,0),derivedGross=Math.max(0,contractualGross-cashSacrifice);
    if(cashSacrifice>contractualGross+.005)return NextResponse.json({error:`${employee.payrollId}: salary sacrifice cannot exceed contractual cash earnings for the period.`},{status:422});
    if(childcareVoucherLines.some(line=>line.taxable!==false||line.nicable!==false))
      return NextResponse.json({error:`${employee.payrollId}: the childcare-voucher sacrifice line must be non-taxable and non-NICable; report only the excess as a separate Class 1 benefit.`},{status:422});
    let expectedChildcareClass1Excess=0;
    for(const line of childcareVoucherLines){
      const taxBand=childcareVoucherBandFromName(line.name);
      if(!taxBand)return NextResponse.json({error:`${employee.payrollId}: each childcare-voucher line must identify its basic, higher or additional earnings-assessment band. Use the guided legacy-childcare workflow.`},{status:422});
      expectedChildcareClass1Excess+=calculateChildcareVoucher({
        amount:line.amount,taxBand,eligibleLegacyMember:true,payFrequency:frequency,
      }).class1Excess;
    }
    expectedChildcareClass1Excess=Math.round(expectedChildcareClass1Excess*100)/100;
    const childcareClass1Lines=lines.filter(line=>line.type==="benefit"&&line.name==="Childcare voucher excess · Class 1 NIC and P11D");
    if(childcareClass1Lines.some(line=>line.taxable!==false||line.nicable!==true))
      return NextResponse.json({error:`${employee.payrollId}: childcare-voucher excess must be non-taxable and Class 1 NICable.`},{status:422});
    const suppliedChildcareClass1Excess=Math.round(childcareClass1Lines.reduce((sum,line)=>sum+line.amount,0)*100)/100;
    if(Math.abs(suppliedChildcareClass1Excess-expectedChildcareClass1Excess)>.005)
      return NextResponse.json({error:`${employee.payrollId}: childcare-voucher Class 1 excess must be ${expectedChildcareClass1Excess.toFixed(2)} for this ${frequency.replace("-"," ")} pay period.`},{status:422});
    const preTaxLines=lines.filter(line=>line.type==="pre-tax-deduction"||line.type==="payroll-giving");
    const taxableGross=Math.max(0,earnings.filter(line=>line.taxable!==false).reduce((sum,line)=>sum+line.amount,0)-cashSacrifice);
    const suppliedClass1Benefits=lines.filter(line=>line.type==="benefit"&&line.nicable!==false).reduce((sum,line)=>sum+line.amount,0);
    const nicableGross=Math.max(0,earnings.filter(line=>line.nicable!==false).reduce((sum,line)=>sum+line.amount,0)-cashSacrifice-preTaxLines.filter(line=>line.nicable!==false).reduce((sum,line)=>sum+line.amount,0)+suppliedClass1Benefits);
    const pensionableGross=Math.max(0,earnings.filter(line=>line.pensionable!==false).reduce((sum,line)=>sum+line.amount,0)-salarySacrificeLines.filter(line=>line.pensionable===false).reduce((sum,line)=>sum+line.amount,0)-childcareVoucherLines.filter(line=>line.pensionable===false).reduce((sum,line)=>sum+line.amount,0)-preTaxLines.filter(line=>line.pensionable!==false).reduce((sum,line)=>sum+line.amount,0));
    const preTaxLineDeductions=preTaxLines.reduce((sum,line)=>sum+line.amount,0);
    const taxablePreTaxLineDeductions=preTaxLines.filter(line=>line.taxable!==false).reduce((sum,line)=>sum+line.amount,0);
    const benefitTotal=lines.filter(line=>line.type==="benefit"&&line.taxable!==false).reduce((sum,line)=>sum+line.amount,0);
    const reviewedPayrolledBenefits=await db.select({
      cashEquivalent:expensesBenefits.cashEquivalent,availableFrom:expensesBenefits.availableFrom,availableTo:expensesBenefits.availableTo,
      providedDate:expensesBenefits.providedDate,payrolled:expensesBenefits.payrolled,nicTreatment:expensesBenefits.nicTreatment,
    }).from(expensesBenefits).where(and(
      eq(expensesBenefits.employeeId,employee.id),eq(expensesBenefits.taxYear,taxYear),
      eq(expensesBenefits.status,"reviewed"),
    ));
    const automaticPayrolledBenefits=totalPayrolledBenefitsForRange(reviewedPayrolledBenefits.filter(benefit=>benefit.payrolled&&benefit.nicTreatment!=="exempt"),taxYear,scheduledPeriod.periodStart,scheduledPeriod.periodEnd);
    const automaticClass1Benefits=totalPayrolledBenefitsForRange(reviewedPayrolledBenefits.filter(benefit=>benefit.nicTreatment==="class-1"),taxYear,scheduledPeriod.periodStart,scheduledPeriod.periodEnd);
    const postTaxLineDeductions=lines.filter(line=>line.type==="post-tax-deduction").reduce((sum,line)=>sum+line.amount,0);
    let pensionEmployeeRate=0,pensionEmployerRate=0,pensionRefund=0,employerPensionRefund=0,pensionMembershipId:number|null=null,pensionSchemeId:number|null=null,pensionBasis:PayrollInput["pensionBasis"]="qualifying",pensionTaxRelief:PayrollInput["pensionTaxRelief"]="relief-at-source";
    const commitPensionLifecycle=input.action==="finalise";
    if(activePensionScheme&&!postLeavingPayment) {
      pensionSchemeId=activePensionScheme.id;
      let [membership]=await db.select().from(pensionMemberships).where(and(eq(pensionMemberships.schemeId,activePensionScheme.id),eq(pensionMemberships.employeeId,employee.id))).limit(1);
      const birth=employee.dateOfBirth?new Date(`${employee.dateOfBirth}T00:00:00Z`):null;
      const at=new Date(`${assessmentDate}T00:00:00Z`);
      const age=birth&&Number.isFinite(birth.getTime())?at.getUTCFullYear()-birth.getUTCFullYear()-(at.getUTCMonth()<birth.getUTCMonth()||(at.getUTCMonth()===birth.getUTCMonth()&&at.getUTCDate()<birth.getUTCDate())?1:0):null;
      const assessmentEarnings=(lines.length?derivedGross:Number(record.grossPay||0))+statutoryPay;
      const assessment=age===null?null:assessPension({age,earnings:assessmentEarnings,payFrequency:frequency,employeeRate:activePensionScheme.employeeRate,employerRate:activePensionScheme.employerRate});
      if(!membership&&assessment) {
        const projected={
          schemeId:activePensionScheme.id,employeeId:employee.id,assessmentStatus:assessment.category,
          membershipStatus:assessment.action==="enrol"?"active":"not-enrolled",enrolmentDate:assessment.action==="enrol"?assessmentDate:null,
          enrolmentInformationDate:assessment.action==="enrol"?assessmentDate:null,
          communicationDueDate:assessment.action==="enrol"?new Date(Date.parse(`${assessmentDate}T00:00:00Z`)+42*86400000).toISOString().slice(0,10):null,
        };
        if(commitPensionLifecycle) {
          [membership]=await db.insert(pensionMemberships).values(projected).returning();
          await db.insert(pensionMembershipEvents).values({
            employerId,membershipId:membership.id,employeeId:employee.id,schemeId:activePensionScheme.id,
            eventType:"payroll-assessment",effectiveDate:assessmentDate,previousStatus:null,newStatus:membership.membershipStatus,
            details:JSON.stringify({periodNumber,taxYear,assessment:assessment.category,action:assessment.action,earnings:assessmentEarnings}),
            createdBy:access.user.email,
          });
        } else membership={id:0,...projected} as typeof pensionMemberships.$inferSelect;
      } else if(membership?.membershipStatus==="postponed"&&membership.postponementEnd&&membership.postponementEnd<=assessmentDate&&assessment) {
        const previousStatus=membership.membershipStatus;
        const changes={
          assessmentStatus:assessment.category,membershipStatus:assessment.action==="enrol"?"active":"not-enrolled",
          enrolmentDate:assessment.action==="enrol"?assessmentDate:null,enrolmentInformationDate:assessment.action==="enrol"?assessmentDate:null,updatedAt:new Date().toISOString(),
          communicationDueDate:assessment.action==="enrol"?new Date(Date.parse(`${assessmentDate}T00:00:00Z`)+42*86400000).toISOString().slice(0,10):membership.communicationDueDate,
        };
        if(commitPensionLifecycle) {
          const [updated]=await db.update(pensionMemberships).set(changes).where(eq(pensionMemberships.id,membership.id)).returning();
          membership=updated;
          await db.insert(pensionMembershipEvents).values({
            employerId,membershipId:membership.id,employeeId:employee.id,schemeId:activePensionScheme.id,
            eventType:"postponement-ended",effectiveDate:assessmentDate,previousStatus,newStatus:membership.membershipStatus,
            details:JSON.stringify({periodNumber,taxYear,assessment:assessment.category,action:assessment.action,earnings:assessmentEarnings}),
            createdBy:access.user.email,
          });
        } else membership={...membership,...changes};
      } else if(membership?.membershipStatus==="not-enrolled"&&assessment) {
        const previousAssessment=membership.assessmentStatus,becomesEligible=assessment.action==="enrol";
        const changes={
          assessmentStatus:assessment.category,
          membershipStatus:becomesEligible?"active":"not-enrolled",
          enrolmentDate:becomesEligible?assessmentDate:membership.enrolmentDate,
          enrolmentInformationDate:becomesEligible?assessmentDate:membership.enrolmentInformationDate,
          communicationDueDate:becomesEligible?new Date(Date.parse(`${assessmentDate}T00:00:00Z`)+42*86400000).toISOString().slice(0,10):membership.communicationDueDate,
          updatedAt:new Date().toISOString(),
        };
        if(commitPensionLifecycle) {
          const [updated]=await db.update(pensionMemberships).set(changes).where(eq(pensionMemberships.id,membership.id)).returning();
          membership=updated;
          if(becomesEligible||previousAssessment!==assessment.category)await db.insert(pensionMembershipEvents).values({
            employerId,membershipId:membership.id,employeeId:employee.id,schemeId:activePensionScheme.id,
            eventType:becomesEligible?"became-eligible":"payroll-reassessment",effectiveDate:assessmentDate,
            previousStatus:"not-enrolled",newStatus:membership.membershipStatus,
            details:JSON.stringify({periodNumber,taxYear,previousAssessment,assessment:assessment.category,action:assessment.action,earnings:assessmentEarnings}),
            createdBy:access.user.email,
          });
        } else membership={...membership,...changes};
      }
      if(membership?.membershipStatus==="active") {
        pensionEmployeeRate=activePensionScheme.employeeRate;pensionEmployerRate=membership.employerContributionRequired?activePensionScheme.employerRate:0;
        pensionBasis=activePensionScheme.earningsBasis==="gross"?"gross":"qualifying";
        pensionTaxRelief=activePensionScheme.taxRelief==="net-pay"?"net-pay":"relief-at-source";
      }
      if(membership?.membershipStatus==="opted-out") {
        pensionRefund=membership.employeeRefundDue;employerPensionRefund=membership.employerRefundDue;pensionMembershipId=membership.id;
      }
    }
    const prior = await db.select({
      taxablePay: payRuns.taxablePay,
      nicablePay:payRuns.nicablePay,
      payeTax: payRuns.payeTax,
      employeeNic: payRuns.employeeNic,
      employerNic: payRuns.employerNic,
    }).from(payRuns).innerJoin(payPeriods, eq(payRuns.payPeriodId, payPeriods.id)).where(and(
      eq(payRuns.employeeId, employee.id),
      eq(payPeriods.employerId, employerId),
      eq(payPeriods.taxYear, taxYear),
      lt(payPeriods.periodNumber, periodNumber),
      eq(payRuns.status, "finalised"),
    ));
    const opening=p45OpeningBalances({
      previousPay:employee.p45PreviousPay,previousTax:employee.p45PreviousTax,
      receivedAfterFirstPayroll:employee.p45ReceivedAfterPayroll,priorFinalisedRuns:prior.length,
    });
    const [migrationOpening]=await db.select().from(payrollOpeningBalances).where(and(
      eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.employeeId,employee.id),
      eq(payrollOpeningBalances.taxYear,taxYear),
    )).limit(1);
    const totals = prior.reduce((a, r) => ({
      taxablePay: a.taxablePay + r.taxablePay,
      nicablePay:a.nicablePay+r.nicablePay,
      tax: a.tax + r.payeTax,
      employeeNic: a.employeeNic + r.employeeNic,
      employerNic: a.employerNic + r.employerNic,
    }), {
      taxablePay:opening.taxablePay+(migrationOpening?.taxablePay||0),
      nicablePay:migrationOpening?.nicablePay||0,
      tax:opening.taxPaid+(migrationOpening?.payeTax||0),
      employeeNic:migrationOpening?.employeeNic||0,
      employerNic:migrationOpening?.employerNic||0,
    });
    const payrollInput:PayrollInput = {
      ...record,
      grossPay:lines.length?derivedGross:record.grossPay,
      taxableGrossPay:lines.length?taxableGross:record.taxableGrossPay,
      nicableGrossPay:Number(lines.length?nicableGross:(record.nicableGrossPay??record.grossPay??0))+automaticClass1Benefits,
      pensionableGrossPay:lines.length?pensionableGross:record.pensionableGrossPay,
      taxableBenefits:Number(record.taxableBenefits||0)+benefitTotal+automaticPayrolledBenefits,
      statutoryPay,
      preTaxDeductions:Number(record.preTaxDeductions||0)+preTaxLineDeductions,
      taxablePreTaxDeductions:Number(record.taxablePreTaxDeductions??record.preTaxDeductions??0)+taxablePreTaxLineDeductions,
      postTaxDeductions:Number(record.postTaxDeductions||0)+postTaxLineDeductions,
      employerPensionAdditional:Number(record.employerPensionAdditional||0)+salarySacrifice,
      pensionEmployeeRate,pensionEmployerRate,pensionBasis,pensionTaxRelief,pensionRefund,employerPensionRefund,
      taxCode: postLeavingPayment?(/^S/i.test(employee.taxCode)?"S0T":/^C/i.test(employee.taxCode)?"C0T":"0T"):record.taxCode || employee.taxCode,
      niCategory: record.niCategory || employee.niCategory,
      week1Month1: postLeavingPayment?true:record.week1Month1 ?? employee.week1Month1,
      studentLoanPlan: record.studentLoanPlan || employee.studentLoanPlan as PayrollInput["studentLoanPlan"],
      postgraduateLoan: record.postgraduateLoan ?? employee.postgraduateLoan,
      director: record.director ?? employee.director,
      noSecondaryNic: record.noSecondaryNic ?? employee.noSecondaryNic,
      directorMethod: record.directorMethod || (employee.alternativeDirectorNic ? "alternative" : "annual"),
      directorStartPeriod:employee.directorStart?schedule.find(item=>employee.directorStart!>=item.periodStart&&employee.directorStart!<=item.periodEnd)?.periodNumber||1:1,
      directorEarningsPeriodWeeks:employee.directorStart?Math.max(1,Math.min(52,Math.ceil((Date.UTC(Number(taxYear.slice(0,4))+1,3,5)-Date.parse(`${employee.directorStart}T00:00:00Z`))/604_800_000))):52,
      finalDirectorPeriod:Boolean(record.finalDirectorPeriod)||(record.directorMethod==="alternative"||employee.alternativeDirectorNic)&&(periodNumber===schedule.length||[employee.directorEnd,employee.leavingDate].filter(Boolean).some(value=>String(value)>=scheduledPeriod.periodStart&&String(value)<=scheduledPeriod.periodEnd)),
      earningsPeriod:postLeavingPayment&&postLeavingNicBasis==="weekly"?"weekly":frequency==="monthly"?"monthly":"weekly",
      payFrequency:frequency,taxWeekNumber:scheduledPeriod.taxWeekNumber,periodNumber,
      ytdTaxablePay: totals.taxablePay,
      ytdNicablePay:totals.nicablePay,
      ytdTaxPaid: totals.tax,
      ytdEmployeeNic: totals.employeeNic,
      ytdEmployerNic: totals.employerNic,
    };
    const initialResult=calculateMonthlyPayroll(payrollInput);
    if(holidayFund?.postTaxDeduction){
      const withoutHolidaySaving=calculateMonthlyPayroll({
        ...payrollInput,postTaxDeductions:Math.max(0,Number(payrollInput.postTaxDeductions||0)-holidayFund.postTaxDeduction),
      });
      if(holidayFund.postTaxDeduction>withoutHolidaySaving.netPay+.005)
        return NextResponse.json({error:`${employee.payrollId}: holiday savings contribution cannot exceed the £${withoutHolidaySaving.netPay.toFixed(2)} net pay available before that deduction.`},{status:422});
    }
    const adjustmentRows=await db.select().from(payrollAdjustments).where(and(
      eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.employeeId,employee.id),
      eq(payrollAdjustments.payPeriodId,period.id),eq(payrollAdjustments.status,"active"),
    ));
    const adjustmentTotals=adjustmentRows.reduce((totals,item)=>{
      if(item.type==="paye-tax")totals.payeTax+=item.amount;
      if(item.type==="employee-nic")totals.employeeNic+=item.amount;
      if(item.type==="employer-nic")totals.employerNic+=item.amount;
      if(item.type==="student-loan")totals.studentLoan+=item.amount;
      if(item.type==="postgraduate-loan")totals.postgraduateLoan+=item.amount;
      return totals;
    },{payeTax:0,employeeNic:0,employerNic:0,studentLoan:0,postgraduateLoan:0});
    const adjustedResult=applyDeductionAdjustments(initialResult,adjustmentTotals);
    const orders=(await db.select().from(attachmentOrders).where(and(eq(attachmentOrders.employeeId,employee.id),eq(attachmentOrders.status,"active"))))
      .filter(order=>!order.effectiveDate||order.effectiveDate<=String(input.payDate||period.payDate||scheduledPeriod.periodEnd))
      .sort((left,right)=>attachmentPriority(left.type,left.priority)-attachmentPriority(right.type,right.priority)||left.id-right.id);
    const orderCalculations:ReturnType<typeof calculateAttachment>[]=[];
    let existingOrderDeductions=0;
    const attachmentNetPay=Math.max(0,adjustedResult.netPay-nonAttachableStatutoryPay);
    for(const order of orders) {
      const maintenanceDays=["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(order.calculationRule)
        ?elapsedPayDays(order.effectiveDate&&order.effectiveDate>priorPeriodPayDate?order.effectiveDate:priorPeriodPayDate,requestedPayDate)
        :undefined;
      const calculation=calculateAttachment({
        netPay:attachmentNetPay,type:order.type,deductionType:order.deductionType==="percentage"?"percentage":"fixed",
        calculationRule:order.calculationRule as any,payFrequency:order.payFrequency as any,
        deductionValue:order.deductionValue,protectedEarnings:order.protectedEarnings,balance:order.balance,
        adminFee:order.adminFee,existingDeductions:existingOrderDeductions,arrears:order.arrears,
        periodDays:maintenanceDays,
        ordinaryDebtBalance:order.ordinaryDebtBalance,maintenanceDailyRate:order.maintenanceDailyRate,
      });
      orderCalculations.push(calculation);
      existingOrderDeductions+=calculation.totalFromPay;
    }
    const attachmentDeduction=orderCalculations.reduce((sum,item)=>sum+item.totalFromPay,0);
    const resultBeforeLoans=attachmentDeduction?{...adjustedResult,netPay:Math.round(Math.max(0,adjustedResult.netPay-attachmentDeduction)*100)/100}:adjustedResult;
    const activeLoans=postLeavingPayment?[]:(await db.select().from(employeeLoans).where(and(
      eq(employeeLoans.employerId,employerId),eq(employeeLoans.employeeId,employee.id),eq(employeeLoans.status,"active"),
    ))).filter(loan=>loan.startDate<=requestedPayDate&&loan.balance>0).sort((left,right)=>left.id-right.id);
    const loanCalculations=allocateEmployeeLoanRecoveries(activeLoans,resultBeforeLoans.netPay);
    const loanDeduction=loanCalculations.reduce((sum,item)=>Math.round((sum+item.amount)*100)/100,0);
    const resultAfterLoans=loanDeduction?{...resultBeforeLoans,netPay:Math.round((resultBeforeLoans.netPay-loanDeduction)*100)/100}:resultBeforeLoans;
    const [roundingSetting]=employee.paymentMethod==="cash"&&!postLeavingPayment
      ?await db.select().from(employeePayRounding).where(and(
        eq(employeePayRounding.employerId,employerId),eq(employeePayRounding.employeeId,employee.id),eq(employeePayRounding.status,"active"),
      )).limit(1):[];
    const roundingCalculation=roundingSetting?applyCashPayRounding({
      netPay:resultAfterLoans.netPay,openingCarry:roundingSetting.carry,unit:roundingSetting.unit,
    }):null;
    const result=roundingCalculation?{...resultAfterLoans,netPay:roundingCalculation.roundedNet}:resultAfterLoans;
    const priorRuns=await db.select({id:payRuns.id}).from(payRuns).where(and(eq(payRuns.payPeriodId, period.id), eq(payRuns.employeeId, employee.id)));
    for(const priorRun of priorRuns){
      await db.update(holidayFundEntries).set({payRunId:null,sourceChecksum:null,updatedAt:new Date().toISOString()})
        .where(and(eq(holidayFundEntries.payRunId,priorRun.id),eq(holidayFundEntries.employerId,employerId),eq(holidayFundEntries.status,"draft")));
      await db.delete(payItems).where(eq(payItems.payRunId,priorRun.id));
    }
    await db.delete(payRuns).where(and(eq(payRuns.payPeriodId, period.id), eq(payRuns.employeeId, employee.id)));
    const [saved] = await db.insert(payRuns).values({
      payPeriodId: period.id,
      employeeId: employee.id,
      grossPay: result.grossPay,
      taxablePay: result.taxablePay,
      nicablePay: Math.round((Number(payrollInput.nicableGrossPay ?? payrollInput.grossPay) + Number(payrollInput.statutoryPay || 0)) * 100) / 100,
      payeTax: result.incomeTax,
      employeeNic: result.employeeNic,
      employerNic: result.employerNic,
      studentLoan: result.studentLoan,
      postgraduateLoan: result.postgraduateLoan,
      pensionSchemeId,
      pensionablePay:result.pensionablePay,
      employeePension: result.employeePension,
      employerPension: result.employerPension,
      statutoryPay,
      otherDeductions: Number(payrollInput.postTaxDeductions || 0) + attachmentDeduction + loanDeduction,
      netPay: result.netPay,
      payrollNote:String(record.payrollNote||"").trim().slice(0,4000)||null,
      rtiSnapshot:JSON.stringify({
        departmentId:employee.departmentId,
        departmentName:departmentById.get(employee.departmentId||0)?.name||"Unassigned",
        departmentCostCentre:departmentById.get(employee.departmentId||0)?.costCentre||"000",
        departmentNominalCode:departmentById.get(employee.departmentId||0)?.nominalCode||null,
        payrollId:employee.payrollId,title:employee.title,firstName:employee.firstName,middleNames:employee.middleNames,lastName:employee.lastName,
        dateOfBirth:employee.dateOfBirth,gender:employee.gender,address:employee.address,postcode:employee.postcode,
        taxCode:payrollInput.taxCode,week1Month1:payrollInput.week1Month1,
        niCategory:payrollInput.niCategory,niNumber:employee.niNumber,startDate:employee.startDate,leavingDate:employee.leavingDate,
        starterEvidence:employee.starterEvidence,starterDeclaration:employee.starterDeclaration,p45PreviousPay:employee.p45PreviousPay,p45PreviousTax:employee.p45PreviousTax,
        reportedPayFrequency:employee.reportedPayFrequency,contractedHours:employee.contractedHours,
        director:Boolean(employee.director),directorMethod:employee.alternativeDirectorNic?"alternative":"annual",
        irregularPayment:employee.irregularPayment,zeroPayFpsExclusion:employee.zeroPayFpsExclusion,
        workplacePostcode:employee.workplacePostcode,previousPayrollId:employee.previousPayrollId,
        paymentToBody:employee.paymentToBody,trivialCommutation:employee.trivialCommutation,flexibleDrawdown:employee.flexibleDrawdown,
        paymentMethod:employee.paymentMethod,
        cashRounding:roundingCalculation?{
          unit:roundingCalculation.unit,unroundedNet:roundingCalculation.netPay,openingCarry:roundingCalculation.openingCarry,
          roundedNet:roundingCalculation.roundedNet,closingCarry:roundingCalculation.closingCarry,adjustment:roundingCalculation.adjustment,
        }:null,
        holidayFund:holidaySetting&&holidayFund?{
          settingId:holidaySetting.id,schemeType:holidayFund.schemeType,workerType:holidaySetting.workerType,
          accrualRate:holidayFund.accrualRate,accrualBase:holidayFund.accrualBase,addedAmount:holidayFund.addedAmount,
          paidAmount:holidayFund.paidAmount,balanceBefore:holidayFund.balanceBefore,balanceAfter:holidayFund.balanceAfter,
          taxablePay:holidayFund.taxablePay,nicablePay:holidayFund.nicablePay,postTaxDeduction:holidayFund.postTaxDeduction,
        }:null,
        paymentAfterLeaving:postLeavingPayment,
        postLeavingNicBasis:postLeavingPayment?postLeavingNicBasis:null,
        postLeavingP45Issued:postLeavingPayment?true:null,
        earningsPeriod:payrollInput.earningsPeriod,
        taxWeekNumber:scheduledPeriod.taxWeekNumber,taxMonth:scheduledPeriod.taxMonth,
        payrolledBenefits:automaticPayrolledBenefits,
        class1Benefits:automaticClass1Benefits,
        statutoryPayByType,
        statutoryRecoveryByType,
      }),
      pensionSnapshot:pensionSchemeId&&activePensionScheme?JSON.stringify({
        schemaVersion:"payflow-pension-evidence-2",
        schemeId:activePensionScheme.id,provider:activePensionScheme.provider,schemeName:activePensionScheme.schemeName,
        employerReference:activePensionScheme.employerReference,earningsBasis:activePensionScheme.earningsBasis,
        taxRelief:activePensionScheme.taxRelief,employeeRate:activePensionScheme.employeeRate,employerRate:activePensionScheme.employerRate,
        employeeDeduction:result.employeePension,employeeTaxRelief:result.employeePensionTaxRelief,employeeGrossContribution:result.employeePensionGross,
        contributionDueDay:activePensionScheme.contributionDueDay,
        payrollId:employee.payrollId,niNumber:employee.niNumber,dateOfBirth:employee.dateOfBirth,
        firstName:employee.firstName,middleNames:employee.middleNames,lastName:employee.lastName,
      }):null,
      status: input.action === "finalise" ? "finalised" : "draft",
    }).returning();
    if(lines.length)await db.insert(payItems).values(lines.map(line=>({
      payRunId:saved.id,type:line.type,name:line.name,quantity:line.quantity,rate:line.rate,amount:line.amount,
      taxable:line.taxable!==false,nicable:line.nicable!==false,pensionable:line.pensionable!==false,recurringItemId:line.recurringItemId,
    })));
    if(holidaySetting&&holidayFund){
      const status=input.action==="finalise"?"finalised":"draft";
      const entryValues={
        employerId,employeeId:employee.id,holidayFundSettingId:holidaySetting.id,payRunId:saved.id,payPeriodId:period.id,
        taxYear,periodNumber,schemeType:holidaySetting.schemeType,workerType:holidaySetting.workerType,
        contractConfirmed:holidaySetting.contractConfirmed,accrualRate:holidaySetting.accrualRate,
        manualAdded:holidayEntry?.manualAdded||0,requestedPaid:holidayEntry?.requestedPaid||0,
        referencePayOverride:holidayEntry?.referencePayOverride??null,accrualBase:holidayFund.accrualBase,
        addedAmount:holidayFund.addedAmount,paidAmount:holidayFund.paidAmount,balanceBefore:holidayFund.balanceBefore,
        balanceAfter:holidayFund.balanceAfter,taxablePay:holidayFund.taxablePay,nicablePay:holidayFund.nicablePay,
        postTaxDeduction:holidayFund.postTaxDeduction,status,
      };
      const sourceChecksum=await sha256(JSON.stringify(holidayFundEntryEvidence(entryValues)));
      if(holidayEntry)await db.update(holidayFundEntries).set({...entryValues,sourceChecksum,updatedAt:new Date().toISOString()}).where(eq(holidayFundEntries.id,holidayEntry.id));
      else await db.insert(holidayFundEntries).values({...entryValues,sourceChecksum});
      if(status==="finalised")await db.update(holidayFundSettings).set({
        currentBalance:holidayFund.balanceAfter,updatedAt:new Date().toISOString(),
      }).where(eq(holidayFundSettings.id,holidaySetting.id));
    }
    if(input.action==="finalise") {
      if(pensionMembershipId&&(pensionRefund>0||employerPensionRefund>0))await db.update(pensionMemberships).set({employeeRefundDue:0,employerRefundDue:0,updatedAt:new Date().toISOString()}).where(eq(pensionMemberships.id,pensionMembershipId));
      for(let index=0;index<orders.length;index++) {
        const calculation=orderCalculations[index];
        if(calculation.totalFromPay<=0)continue;
        await db.insert(attachmentOrderDeductions).values({
          attachmentOrderId:orders[index].id,payRunId:saved.id,deduction:calculation.deduction,
          adminFee:calculation.adminFee,balanceAfter:calculation.balanceAfter,rate:calculation.rate,
          attachableNetPay:attachmentNetPay,protectedEarningsApplied:calculation.protectedEarnings,
          shortfall:calculation.shortfall,arrearsBefore:orders[index].arrears,arrearsAfter:calculation.arrearsAfter,
          ordinaryDeduction:calculation.ordinaryDeduction,maintenanceDeduction:calculation.maintenanceDeduction,
          ordinaryBalanceAfter:calculation.ordinaryBalanceAfter,
        });
        await db.update(attachmentOrders).set({
          balance:calculation.balanceAfter,arrears:calculation.arrearsAfter,
          ordinaryDebtBalance:calculation.ordinaryBalanceAfter,
          status:calculation.balanceAfter===0?"completed":"active",updatedAt:new Date().toISOString(),
        }).where(eq(attachmentOrders.id,orders[index].id));
      }
      for(const calculation of loanCalculations){
        await db.insert(employeeLoanDeductions).values({
          employeeLoanId:calculation.loan.id,payRunId:saved.id,amount:calculation.amount,
          balanceBefore:calculation.balanceBefore,balanceAfter:calculation.balanceAfter,
        });
        await db.update(employeeLoans).set({
          balance:calculation.balanceAfter,status:calculation.balanceAfter===0?"completed":"active",updatedAt:new Date().toISOString(),
        }).where(eq(employeeLoans.id,calculation.loan.id));
      }
      if(roundingSetting&&roundingCalculation){
        await db.insert(payRoundingEntries).values({
          employeePayRoundingId:roundingSetting.id,payRunId:saved.id,unroundedNet:roundingCalculation.netPay,
          openingCarry:roundingCalculation.openingCarry,roundedNet:roundingCalculation.roundedNet,
          closingCarry:roundingCalculation.closingCarry,adjustment:roundingCalculation.adjustment,
        });
        await db.update(employeePayRounding).set({
          carry:roundingCalculation.closingCarry,updatedAt:new Date().toISOString(),
        }).where(eq(employeePayRounding.id,roundingSetting.id));
      }
    }
    calculated.push({ employee, result, payrolledBenefits:automaticPayrolledBenefits, adjustments:adjustmentRows, attachments:orderCalculations, employeeLoans:loanCalculations, cashRounding:roundingCalculation, holidayFund, statutoryPayByType,statutoryRecoveryByType,statutoryRecovery,payRunId: saved.id });
  }
  const noEmployeePayments=!calculated.some(item=>item.result&&hasEmployeePaymentActivity({
    grossPay:item.result.grossPay,taxablePay:item.result.taxablePay,payeTax:item.result.incomeTax,
    employeeNic:item.result.employeeNic,employerNic:item.result.employerNic,
    studentLoan:item.result.studentLoan,postgraduateLoan:item.result.postgraduateLoan,
    employeePension:item.result.employeePension,employerPension:item.result.employerPension,
    otherDeductions:item.attachments.reduce((sum,entry)=>sum+entry.totalFromPay,0)+item.employeeLoans.reduce((sum,entry)=>sum+entry.amount,0),
    netPay:item.result.netPay,
  }));
  const statutoryRecovery=roundMoney(calculated.reduce((sum,item)=>sum+Number(item.statutoryRecovery||0),0));
  const rtiTypes=noEmployeePayments
    ?[frequency==="monthly"?"EPS_NO_PAYMENT":"RTI_MONTH_REVIEW"]
    :["FPS",...(statutoryRecovery>0?["EPS_RECOVERY"]:[])];
  if (input.action === "finalise") {
    await db.update(payPeriods).set({ status: "finalised", finalisedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(payPeriods.id, period.id));
    if (periodNumber < schedule.length) {
      const next = await db.select().from(payPeriods).where(and(eq(payPeriods.employerId, employerId), eq(payPeriods.taxYear, taxYear), eq(payPeriods.periodNumber, periodNumber + 1))).limit(1);
      if (next.length) await db.update(payPeriods).set({status:"open",updatedAt:new Date().toISOString()}).where(eq(payPeriods.id,next[0].id));
      else {
        const nextScheduled=schedule[periodNumber];
        await db.insert(payPeriods).values({
          employerId,taxYear,periodNumber:periodNumber+1,frequency,status:"open",
          payDate:nextScheduled.payDate,periodStart:nextScheduled.periodStart,periodEnd:nextScheduled.periodEnd,
        });
      }
    }
    const pensionSubmissionReady=calculated.some(item=>item.result.employeePension!==0||item.result.employerPension!==0);
    await db.insert(auditLog).values({ employerId, actor: access.user.displayName, action: "finalised", entityType: "pay-period", entityId: String(period.id), after: JSON.stringify({ periodNumber, employees: calculated.length,noEmployeePayments,noPaymentConfirmed:input.confirmNoEmployeePayments===true,postLeavingPayments:records.filter(record=>record.postLeavingPayment===true).map(record=>record.payrollId),workflowTasks:{rtiReady:true,rtiType:rtiTypes[0],rtiTypes,taxMonth:scheduledPeriod.taxMonth,statutoryRecovery,pensionReady:pensionSubmissionReady} }) });
  }else{
    await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,
      action:operationSource==="pay-details-csv"?"imported:pay-details":"saved:payroll-draft",
      entityType:"pay-period",entityId:String(period.id),
      after:JSON.stringify({periodNumber,employees:calculated.length,source:operationSource,payrollIds:records.map(record=>record.payrollId)}),
    });
  }
  return NextResponse.json({
    periodNumber,status:input.action === "finalise" ? "finalised" : "draft",calculated,
    workflowTasks:input.action==="finalise"?{
      rtiReady:true,
      rtiType:rtiTypes[0],
      rtiTypes,
      taxMonth:scheduledPeriod.taxMonth,
      noEmployeePayments,
      statutoryRecovery,
      pensionReady:calculated.some(item=>item.result.employeePension!==0||item.result.employerPension!==0),
    }:undefined,
  });
}

export async function PUT(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON payroll reopen object is required."},{status:400});
  const employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(input.action!=="reopen")return NextResponse.json({error:"Unsupported payroll action."},{status:400});
  const taxYear=String(input.taxYear||""),periodNumber=Number(input.periodNumber),db=getDb();
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
    .where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  try {
    const frequency=payrollFrequencyRule(employer.payFrequency).frequency;
    validatePayrollPeriod(frequency,periodNumber);
    if(!scheduledPayPeriods(taxYear,frequency,employer.firstPayDate||undefined).some(item=>item.periodNumber===periodNumber))
      return NextResponse.json({error:`Period ${periodNumber} does not occur in this employer's payroll schedule.`},{status:422});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"A valid payroll period is required."},{status:422});
  }
  const [period]=await db.select().from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber),
  )).limit(1);
  if(!period||period.status!=="finalised")return NextResponse.json({error:"Only a finalised payroll period can be reopened."},{status:409});
  const [latest]=await db.select().from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.status,"finalised"),
  )).orderBy(desc(payPeriods.periodNumber)).limit(1);
  if(!latest||latest.id!==period.id)return NextResponse.json({error:`Period ${latest?.periodNumber||periodNumber} is the latest finalised period and must be reopened first.`},{status:409});
  const periodFilings=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.payPeriodId,period.id)));
  const legacyPensionPackages=(await db.select().from(submissions).where(and(
    eq(submissions.employerId,employerId),eq(submissions.type,"PENSION-PROVIDER"),eq(submissions.status,"prepared"),
  ))).filter(filing=>{
    try {
      const payload=JSON.parse(filing.payload||"{}");
      return payload.taxYear===taxYear&&Number(payload.periodNumber)===periodNumber;
    } catch { return false; }
  });
  const filings=[...periodFilings,...legacyPensionPackages.filter(item=>!periodFilings.some(filing=>filing.id===item.id))];
  if(filings.some(filing=>["submitted","accepted"].includes(filing.status))) {
    return NextResponse.json({error:"This period has an externally submitted RTI filing and cannot be reopened. Prepare an Additional FPS correction instead."},{status:409});
  }
  const runs=await db.select().from(payRuns).where(eq(payRuns.payPeriodId,period.id));
  for(const run of runs) {
    const deductions=await db.select().from(attachmentOrderDeductions).where(eq(attachmentOrderDeductions.payRunId,run.id));
    for(const deduction of deductions) {
      const [order]=await db.select().from(attachmentOrders).where(eq(attachmentOrders.id,deduction.attachmentOrderId)).limit(1);
      if(order)await db.update(attachmentOrders).set({
        balance:order.balance===null?null:Math.round((order.balance+deduction.deduction)*100)/100,
        ordinaryDebtBalance:order.ordinaryDebtBalance===null?null:Math.round((order.ordinaryDebtBalance+deduction.ordinaryDeduction)*100)/100,
        arrears:deduction.arrearsBefore,status:"active",updatedAt:new Date().toISOString(),
      }).where(eq(attachmentOrders.id,order.id));
    }
    await db.delete(attachmentOrderDeductions).where(eq(attachmentOrderDeductions.payRunId,run.id));
    const loanDeductions=await db.select().from(employeeLoanDeductions).where(eq(employeeLoanDeductions.payRunId,run.id));
    for(const deduction of loanDeductions){
      const [loan]=await db.select().from(employeeLoans).where(and(eq(employeeLoans.id,deduction.employeeLoanId),eq(employeeLoans.employerId,employerId))).limit(1);
      if(loan)await db.update(employeeLoans).set({balance:deduction.balanceBefore,status:"active",updatedAt:new Date().toISOString()}).where(eq(employeeLoans.id,loan.id));
    }
    await db.delete(employeeLoanDeductions).where(eq(employeeLoanDeductions.payRunId,run.id));
    const [roundingEntry]=await db.select().from(payRoundingEntries).where(eq(payRoundingEntries.payRunId,run.id)).limit(1);
    if(roundingEntry){
      const [setting]=await db.select().from(employeePayRounding).where(and(
        eq(employeePayRounding.id,roundingEntry.employeePayRoundingId),eq(employeePayRounding.employerId,employerId),
      )).limit(1);
      if(setting)await db.update(employeePayRounding).set({
        carry:roundingEntry.openingCarry,updatedAt:new Date().toISOString(),
      }).where(eq(employeePayRounding.id,setting.id));
      await db.delete(payRoundingEntries).where(eq(payRoundingEntries.id,roundingEntry.id));
    }
    const [holidayEntry]=await db.select().from(holidayFundEntries).where(and(
      eq(holidayFundEntries.payRunId,run.id),eq(holidayFundEntries.employerId,employerId),
    )).limit(1);
    if(holidayEntry){
      const [setting]=await db.select().from(holidayFundSettings).where(and(
        eq(holidayFundSettings.id,holidayEntry.holidayFundSettingId),eq(holidayFundSettings.employerId,employerId),
      )).limit(1);
      if(setting)await db.update(holidayFundSettings).set({
        currentBalance:holidayEntry.balanceBefore,updatedAt:new Date().toISOString(),
      }).where(eq(holidayFundSettings.id,setting.id));
      const draftEvidence={...holidayEntry,status:"draft"};
      await db.update(holidayFundEntries).set({
        status:"draft",sourceChecksum:await sha256(JSON.stringify(holidayFundEntryEvidence(draftEvidence))),
        updatedAt:new Date().toISOString(),
      }).where(eq(holidayFundEntries.id,holidayEntry.id));
    }
    if(run.employeePension<0||run.employerPension<0) {
      const [membership]=await db.select({id:pensionMemberships.id,employeeRefundDue:pensionMemberships.employeeRefundDue,employerRefundDue:pensionMemberships.employerRefundDue})
        .from(pensionMemberships).innerJoin(pensionSchemes,eq(pensionMemberships.schemeId,pensionSchemes.id))
        .where(and(eq(pensionMemberships.employeeId,run.employeeId),eq(pensionSchemes.employerId,employerId),eq(pensionMemberships.membershipStatus,"opted-out"))).limit(1);
      if(membership)await db.update(pensionMemberships).set({
        employeeRefundDue:Math.round((membership.employeeRefundDue+Math.max(0,-run.employeePension))*100)/100,
        employerRefundDue:Math.round((membership.employerRefundDue+Math.max(0,-run.employerPension))*100)/100,
        updatedAt:new Date().toISOString(),
      }).where(eq(pensionMemberships.id,membership.id));
    }
  }
  await db.update(payRuns).set({status:"draft",updatedAt:new Date().toISOString()}).where(eq(payRuns.payPeriodId,period.id));
  await db.update(payPeriods).set({status:"open",finalisedAt:null,updatedAt:new Date().toISOString()}).where(eq(payPeriods.id,period.id));
  const [next]=await db.select().from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber+1),
  )).limit(1);
  if(next) {
    const nextRuns=await db.select({id:payRuns.id}).from(payRuns).where(eq(payRuns.payPeriodId,next.id)).limit(1);
    if(!nextRuns.length)await db.update(payPeriods).set({status:"future",updatedAt:new Date().toISOString()}).where(eq(payPeriods.id,next.id));
  }
  for(const filing of filings)await db.update(submissions).set({
    status:"superseded",response:"Superseded because the payroll period was reopened; regenerate after refinalisation.",updatedAt:new Date().toISOString(),
  }).where(and(eq(submissions.id,filing.id),eq(submissions.employerId,employerId)));
  await db.insert(auditLog).values({
    employerId,actor:access.user.email,action:"reopened",entityType:"pay-period",entityId:String(period.id),
    before:JSON.stringify({status:"finalised",finalisedAt:period.finalisedAt,filingIds:filings.map(item=>item.id)}),
    after:JSON.stringify({status:"open",periodNumber,restoredAttachmentDeductions:true,restoredEmployeeLoanBalances:true,restoredCashRoundingCarries:true,restoredHolidayFundBalances:true,restoredPensionRefunds:true,supersededPensionPackages:filings.filter(item=>item.type==="PENSION-PROVIDER").map(item=>item.id)}),
  });
  return NextResponse.json({periodNumber,status:"open",reopened:true,supersededSubmissions:filings.length});
}
