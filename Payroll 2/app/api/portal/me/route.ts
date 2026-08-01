import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { employees, employerSettings, employers, payPeriods, payRuns } from "../../../../db/schema";
import { portalEmployeeId } from "../../../../lib/portal-auth";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../../lib/pay-frequency";

export async function GET(request:Request) {
  const employeeId=await portalEmployeeId(request);
  if(!employeeId)return NextResponse.json({error:"Employee portal authentication is required."},{status:401});
  const db=getDb(),[employee]=await db.select().from(employees).where(eq(employees.id,employeeId)).limit(1);
  if(!employee||!employee.employeePortal)return NextResponse.json({error:"Employee portal access is disabled."},{status:403});
  const payslips=await db.select({
    periodNumber:payPeriods.periodNumber,taxYear:payPeriods.taxYear,payDate:payPeriods.payDate,
    grossPay:payRuns.grossPay,taxablePay:payRuns.taxablePay,payeTax:payRuns.payeTax,employeeNic:payRuns.employeeNic,
    studentLoan:payRuns.studentLoan,postgraduateLoan:payRuns.postgraduateLoan,employeePension:payRuns.employeePension,
    otherDeductions:payRuns.otherDeductions,netPay:payRuns.netPay,status:payRuns.status,
  }).from(payRuns).innerJoin(payPeriods,eq(payRuns.payPeriodId,payPeriods.id)).where(eq(payRuns.employeeId,employeeId))
    .orderBy(asc(payPeriods.taxYear),asc(payPeriods.periodNumber));
  const finalised=payslips.filter(p=>p.status==="finalised");
  const latestTaxYear=finalised.at(-1)?.taxYear||"",latestYearPayslips=finalised.filter(p=>p.taxYear===latestTaxYear);
  const p60=latestYearPayslips.reduce((a,p)=>({taxYear:p.taxYear,taxablePay:a.taxablePay+p.taxablePay,payeTax:a.payeTax+p.payeTax,employeeNic:a.employeeNic+p.employeeNic}),{taxYear:latestTaxYear,taxablePay:0,payeTax:0,employeeNic:0});
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employee.employerId)).limit(1);
  let finalPeriodNumber=12;
  if(employer&&latestTaxYear)try{finalPeriodNumber=scheduledPayPeriods(latestTaxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined).length;}catch{}
  const finalPeriodFinalised=latestYearPayslips.some(p=>p.periodNumber===finalPeriodNumber);
  const p45TaxYear=employee.leavingDate?`${Number(employee.leavingDate.slice(0,4))-(employee.leavingDate.slice(5)<"04-06"?1:0)}/${String((Number(employee.leavingDate.slice(0,4))+(employee.leavingDate.slice(5)<"04-06"?0:1))%100).padStart(2,"0")}`:null;
  return NextResponse.json({
    profile:{firstName:employee.firstName,lastName:employee.lastName,email:employee.email,phone:employee.phone,address:employee.address,postcode:employee.postcode,bankName:employee.bankName,accountName:employee.accountName,sortCode:employee.sortCode,accountNumber:employee.accountNumber,payrollId:employee.payrollId,portalCanEditBank:employee.portalCanEditBank},
    payslips:finalised,p60:{...p60,available:finalPeriodFinalised&&(!employee.leavingDate||employee.leavingDate>=`${Number(p60.taxYear.slice(0,4))+1}-04-05`)},
    p45Available:Boolean(employee.leavingDate&&finalised.some(item=>item.taxYear===p45TaxYear)),p45TaxYear,
  });
}
