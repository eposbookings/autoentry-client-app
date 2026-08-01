import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { employees, employerSettings, employers, hmrcPayments, leaveEvents, payrollAdjustments, payPeriods, payRuns } from "../../../db/schema";
import { statutoryPayAllocation, taxMonthRange } from "../../../lib/pay-periods";
import { apprenticeshipLevyByMonth } from "../../../lib/apprenticeship-levy";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { payrollFrequencyRule, scheduledPayPeriods, taxMonthForDate } from "../../../lib/pay-frequency";

const round = (value:number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const paymentDeadline=(taxYear:string,taxMonth:number,day:19|22)=>{
  const startYear=Number(taxYear.slice(0,4));
  return new Date(Date.UTC(startYear,3+taxMonth,day)).toISOString().slice(0,10);
};

export async function GET(request:Request) {
  const url=new URL(request.url);
  const employerId=Number(url.searchParams.get("employerId")||1);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const taxYear=url.searchParams.get("taxYear")||"2026/27";
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const db=getDb();
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer) return NextResponse.json({error:"Employer was not found."},{status:404});
  const [settings]=await db.select({firstPayDate:employerSettings.firstPayDate}).from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  let paySchedule:ReturnType<typeof scheduledPayPeriods>;
  try{paySchedule=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,settings?.firstPayDate||undefined);}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  const periods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
  const recoveryRows=await db.select({
    type:leaveEvents.type,subtype:leaveEvents.subtype,startDate:leaveEvents.startDate,endDate:leaveEvents.endDate,
    qualifyingDays:leaveEvents.qualifyingDays,qualifyingDaysPerWeek:leaveEvents.qualifyingDaysPerWeek,qualifyingWeekdays:leaveEvents.qualifyingWeekdays,averageWeeklyEarnings:leaveEvents.averageWeeklyEarnings,
    statutoryPayPeriodStart:leaveEvents.statutoryPayPeriodStart,statutoryWorkedWeeks:leaveEvents.statutoryWorkedWeeks,statutoryPaidDayOffset:leaveEvents.statutoryPaidDayOffset,
    statutoryAmount:leaveEvents.statutoryAmount,recoveredAmount:leaveEvents.recoveredAmount,
  }).from(leaveEvents).innerJoin(employees,eq(leaveEvents.employeeId,employees.id))
    .where(and(eq(employees.employerId,employerId),eq(leaveEvents.status,"calculated")));
  const paymentRows=await db.select().from(hmrcPayments).where(and(eq(hmrcPayments.employerId,employerId),eq(hmrcPayments.taxYear,taxYear)));
  const recoveryAdjustments=await db.select().from(payrollAdjustments).where(and(
    eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.type,"statutory-recovery"),eq(payrollAdjustments.status,"active"),
  ));
  const runsByPeriod=new Map<number,typeof payRuns.$inferSelect[]>();
  for(const period of periods)runsByPeriod.set(period.id,await db.select().from(payRuns).where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.status,"finalised"))));
  const periodTaxMonth=(period:typeof payPeriods.$inferSelect)=>{
    try{return period.payDate?taxMonthForDate(taxYear,period.payDate):paySchedule.find(item=>item.periodNumber===period.periodNumber)?.taxMonth||0;}
    catch{return 0;}
  };
  const monthlyPayBills=Array.from({length:12},()=>0);
  for(const period of periods){
    const month=periodTaxMonth(period);
    if(month>=1&&month<=12)monthlyPayBills[month-1]=round(monthlyPayBills[month-1]+(runsByPeriod.get(period.id)||[]).reduce((sum,run)=>sum+run.nicablePay,0));
  }
  const levySchedule=apprenticeshipLevyByMonth(monthlyPayBills,employer.apprenticeshipLevy,employer.apprenticeshipLevyAllowance);
  const result=[];
  let ytd={payeTax:0,employeeNic:0,employerNic:0,studentLoans:0,statutoryRecovery:0,employmentAllowance:0,apprenticeshipLevy:0,payBill:0,amountDue:0};
  let employmentAllowanceUsed=0;
  const today=new Date().toISOString().slice(0,10);
  for(let taxMonth=1;taxMonth<=12;taxMonth++) {
    const expectedPeriods=paySchedule.filter(item=>item.taxMonth===taxMonth);
    const monthPeriods=periods.filter(item=>periodTaxMonth(item)===taxMonth);
    const completedStatuses=new Set(["finalised","migrated"]);
    const monthEnd=new Date(taxMonthRange(taxYear,taxMonth).end).toISOString().slice(0,10);
    const monthComplete=expectedPeriods.length
      ?expectedPeriods.every(item=>monthPeriods.some(period=>period.periodNumber===item.periodNumber&&completedStatuses.has(period.status)))
      :today>monthEnd;
    const allMigrated=monthPeriods.length>0&&monthPeriods.every(period=>period.status==="migrated");
    const status=allMigrated&&monthComplete?"migrated":monthComplete?"finalised":"open";
    const runs=monthPeriods.flatMap(period=>runsByPeriod.get(period.id)||[]),levy=levySchedule[taxMonth-1];
    const allocatedRecovery=status==="finalised"
      ? recoveryRows.reduce((total,row)=>total+statutoryPayAllocation(row,taxMonth,taxYear).recovery,0)
      : 0;
    const monthPeriodIds=new Set(monthPeriods.map(item=>item.id));
    const recoveryCorrection=status==="finalised"
      ?recoveryAdjustments.filter(item=>monthPeriodIds.has(item.payPeriodId)).reduce((total,item)=>total+item.amount,0)
      :0;
    const current={
      payeTax:round(runs.reduce((n,r)=>n+r.payeTax,0)),
      employeeNic:round(runs.reduce((n,r)=>n+r.employeeNic,0)),
      employerNic:round(runs.reduce((n,r)=>n+r.employerNic,0)),
      studentLoans:round(runs.reduce((n,r)=>n+r.studentLoan+r.postgraduateLoan,0)),
      statutoryRecovery:round(allocatedRecovery+recoveryCorrection),
      employmentAllowance:0,
      apprenticeshipLevy:levy.currentDue,
      payBill:levy.payBill,
      amountDue:0,
    };
    current.employmentAllowance=employer.employmentAllowance?round(Math.min(current.employerNic,Math.max(0,10500-employmentAllowanceUsed))):0;
    employmentAllowanceUsed=round(employmentAllowanceUsed+current.employmentAllowance);
    current.amountDue=round(current.payeTax+current.employeeNic+current.employerNic+current.studentLoans+current.apprenticeshipLevy-current.statutoryRecovery-current.employmentAllowance);
    const recorded=paymentRows.filter(row=>row.taxMonth===taxMonth&&row.status==="recorded");
    const paymentTotal=round(recorded.filter(row=>row.kind==="payment").reduce((sum,row)=>sum+row.amount,0));
    const creditTotal=round(recorded.filter(row=>row.kind==="credit").reduce((sum,row)=>sum+row.amount,0));
    const chargeTotal=round(recorded.filter(row=>row.kind==="charge").reduce((sum,row)=>sum+row.amount,0));
    const settled=round(paymentTotal+creditTotal-chargeTotal),balance=round(current.amountDue-settled);
    const dueDate=paymentDeadline(taxYear,taxMonth,22),postalDueDate=paymentDeadline(taxYear,taxMonth,19);
    const reconciliationStatus=status==="migrated"?"migrated-history":status!=="finalised"?"awaiting-payroll":Math.abs(balance)<.01?"reconciled":new Date().toISOString().slice(0,10)>dueDate?"overdue":"payment-due";
    ytd={payeTax:round(ytd.payeTax+current.payeTax),employeeNic:round(ytd.employeeNic+current.employeeNic),employerNic:round(ytd.employerNic+current.employerNic),studentLoans:round(ytd.studentLoans+current.studentLoans),statutoryRecovery:round(ytd.statutoryRecovery+current.statutoryRecovery),employmentAllowance:round(ytd.employmentAllowance+current.employmentAllowance),apprenticeshipLevy:round(ytd.apprenticeshipLevy+current.apprenticeshipLevy),payBill:round(ytd.payBill+current.payBill),amountDue:round(ytd.amountDue+current.amountDue)};
    result.push({periodNumber:taxMonth,status,payDate:monthPeriods.map(item=>item.payDate).filter(Boolean).at(-1)||expectedPeriods.at(-1)?.payDate||null,payrollPeriods:monthPeriods.map(item=>item.periodNumber),dueDate,postalDueDate,reconciliationStatus,current:{...current,paymentTotal,creditTotal,chargeTotal,settled,balance},ytd:{...ytd},payments:paymentRows.filter(row=>row.taxMonth===taxMonth)});
  }
  return NextResponse.json({employer:{name:employer.name,payeReference:employer.payeReference,accountsOfficeReference:employer.accountsOfficeReference},taxYear,periods:result});
}
