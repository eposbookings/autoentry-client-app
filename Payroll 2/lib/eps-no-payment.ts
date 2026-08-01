export type EpsPaymentRun = {
  grossPay?: number | null;
  taxablePay?: number | null;
  nicablePay?: number | null;
  statutoryPay?: number | null;
  payeTax?: number | null;
  employeeNic?: number | null;
  employerNic?: number | null;
  studentLoan?: number | null;
  postgraduateLoan?: number | null;
  employeePension?: number | null;
  employerPension?: number | null;
  otherDeductions?: number | null;
  netPay?: number | null;
};

const paymentValueKeys: Array<keyof EpsPaymentRun> = [
  "grossPay","taxablePay","nicablePay","statutoryPay","payeTax","employeeNic","employerNic",
  "studentLoan","postgraduateLoan","employeePension","employerPension","otherDeductions","netPay",
];

export function hasEmployeePaymentActivity(run:EpsPaymentRun){
  return paymentValueKeys.some(key=>Math.abs(Number(run[key]||0))>=0.005);
}

export function epsTaxMonthWindow(taxYear:string,taxMonth:number){
  if(!/^\d{4}\/\d{2}$/.test(taxYear)||!Number.isInteger(taxMonth)||taxMonth<1||taxMonth>12)
    throw new Error("EPS tax month must be between 1 and 12 for a valid tax year.");
  const startYear=Number(taxYear.slice(0,4));
  const start=new Date(Date.UTC(startYear,3+taxMonth-1,6));
  const end=new Date(Date.UTC(startYear,3+taxMonth,5));
  const deadline=new Date(Date.UTC(startYear,3+taxMonth,19));
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),deadline:deadline.toISOString().slice(0,10)};
}
