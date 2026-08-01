import type { PayrollResult } from "./payroll-engine";

export type DeductionAdjustments={
  payeTax?:number;employeeNic?:number;employerNic?:number;studentLoan?:number;postgraduateLoan?:number;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function applyDeductionAdjustments(result:PayrollResult,adjustments:DeductionAdjustments):PayrollResult {
  const payeTax=round(result.incomeTax+Number(adjustments.payeTax||0));
  const employeeNic=round(result.employeeNic+Number(adjustments.employeeNic||0));
  const employerNic=round(result.employerNic+Number(adjustments.employerNic||0));
  const studentLoan=round(result.studentLoan+Number(adjustments.studentLoan||0));
  const postgraduateLoan=round(result.postgraduateLoan+Number(adjustments.postgraduateLoan||0));
  const netBeforeClamp=round(result.netPay-(payeTax-result.incomeTax)-(employeeNic-result.employeeNic)-(studentLoan-result.studentLoan)-(postgraduateLoan-result.postgraduateLoan));
  const warnings=[...result.warnings];
  if(netBeforeClamp<0)warnings.push("Manual adjustments exceeded available net pay and take-home pay was capped at zero.");
  return {...result,incomeTax:payeTax,employeeNic,employerNic,studentLoan,postgraduateLoan,
    netPay:Math.max(0,netBeforeClamp),employerCost:round(result.employerCost+(employerNic-result.employerNic)),warnings};
}
