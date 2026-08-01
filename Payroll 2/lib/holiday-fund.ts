export type HolidayFundSchemeType="employer-accrual"|"employee-savings"|"rolled-up";
export type HolidayFundWorkerType="regular-hours"|"irregular-hours"|"part-year";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export type HolidayFundPeriodInput={
  schemeType:HolidayFundSchemeType;
  workerType:HolidayFundWorkerType;
  contractConfirmed:boolean;
  accrualRate:number;
  openingBalance:number;
  basicAndHourlyPay:number;
  totalPay:number;
  manualAdded:number;
  requestedPaid:number;
  referencePayOverride?:number|null;
  hasStatutoryAbsence?:boolean;
};

export type HolidayFundPeriodResult={
  schemeType:HolidayFundSchemeType;
  accrualRate:number;
  accrualBase:number;
  addedAmount:number;
  paidAmount:number;
  balanceBefore:number;
  balanceAfter:number;
  taxablePay:number;
  nicablePay:number;
  postTaxDeduction:number;
  payslipLine:"taxable-holiday-pay"|"non-taxable-savings-withdrawal"|"rolled-up-holiday-pay"|null;
};

export function calculateHolidayFundPeriod(input:HolidayFundPeriodInput):HolidayFundPeriodResult{
  const values=[input.accrualRate,input.openingBalance,input.basicAndHourlyPay,input.totalPay,input.manualAdded,input.requestedPaid];
  if(values.some(value=>!Number.isFinite(value)||value<0))throw new Error("Holiday-fund values must be valid non-negative amounts.");
  if(input.accrualRate>100)throw new Error("Holiday-fund percentage cannot exceed 100%.");
  if(!["employer-accrual","employee-savings","rolled-up"].includes(input.schemeType))throw new Error("Select a supported holiday-fund scheme.");
  if(!["regular-hours","irregular-hours","part-year"].includes(input.workerType))throw new Error("Select the employee's contractual working pattern.");

  if(input.schemeType==="rolled-up"){
    if(!["irregular-hours","part-year"].includes(input.workerType))
      throw new Error("Rolled-up holiday pay is available only to irregular-hours or part-year workers.");
    if(!input.contractConfirmed)throw new Error("Confirm that the worker's contract permits rolled-up holiday pay.");
    if(input.accrualRate<=0)throw new Error("Rolled-up holiday pay requires a positive percentage.");
    if(input.hasStatutoryAbsence&&(input.referencePayOverride===null||input.referencePayOverride===undefined))
      throw new Error("Enter the 52-week average reference pay for rolled-up holiday pay during sickness or family leave.");
    if(input.referencePayOverride!==null&&input.referencePayOverride!==undefined&&(!Number.isFinite(input.referencePayOverride)||input.referencePayOverride<0))
      throw new Error("The rolled-up holiday-pay reference amount must be a valid non-negative amount.");
    const accrualBase=round(input.referencePayOverride??input.totalPay);
    const amount=round(accrualBase*input.accrualRate/100);
    return {schemeType:input.schemeType,accrualRate:input.accrualRate,accrualBase,addedAmount:amount,paidAmount:amount,
      balanceBefore:round(input.openingBalance),balanceAfter:round(input.openingBalance),taxablePay:amount,nicablePay:amount,
      postTaxDeduction:0,payslipLine:"rolled-up-holiday-pay"};
  }

  const accrualBase=round(input.basicAndHourlyPay);
  const addedAmount=round(input.accrualRate>0?accrualBase*input.accrualRate/100:input.manualAdded);
  const paidAmount=round(input.requestedPaid);
  const balanceBefore=round(input.openingBalance),balanceAfter=round(balanceBefore+addedAmount-paidAmount);
  if(balanceAfter<0)throw new Error(`Holiday-fund withdrawal cannot exceed the available £${round(balanceBefore+addedAmount).toFixed(2)} balance.`);
  if(input.schemeType==="employee-savings"){
    return {schemeType:input.schemeType,accrualRate:input.accrualRate,accrualBase,addedAmount,paidAmount,balanceBefore,balanceAfter,
      taxablePay:0,nicablePay:0,postTaxDeduction:addedAmount,payslipLine:paidAmount>0?"non-taxable-savings-withdrawal":null};
  }
  return {schemeType:input.schemeType,accrualRate:input.accrualRate,accrualBase,addedAmount,paidAmount,balanceBefore,balanceAfter,
    taxablePay:paidAmount,nicablePay:paidAmount,postTaxDeduction:0,payslipLine:paidAmount>0?"taxable-holiday-pay":null};
}

export function holidayFundEntryEvidence(row:any){
  return {
    employerId:Number(row.employerId),employeeId:Number(row.employeeId),holidayFundSettingId:Number(row.holidayFundSettingId),
    payRunId:Number(row.payRunId),payPeriodId:Number(row.payPeriodId),taxYear:String(row.taxYear),periodNumber:Number(row.periodNumber),
    schemeType:String(row.schemeType),workerType:String(row.workerType),contractConfirmed:row.contractConfirmed===true,
    accrualRate:Number(row.accrualRate),manualAdded:Number(row.manualAdded),requestedPaid:Number(row.requestedPaid),
    referencePayOverride:row.referencePayOverride===null||row.referencePayOverride===undefined?null:Number(row.referencePayOverride),
    accrualBase:Number(row.accrualBase),addedAmount:Number(row.addedAmount),paidAmount:Number(row.paidAmount),
    balanceBefore:Number(row.balanceBefore),balanceAfter:Number(row.balanceAfter),taxablePay:Number(row.taxablePay),
    nicablePay:Number(row.nicablePay),postTaxDeduction:Number(row.postTaxDeduction),status:String(row.status),
  };
}

export function validateHolidayFundEntryEvidence(row:any){
  if(!Number.isInteger(Number(row.payRunId))||Number(row.payRunId)<1||!Number.isInteger(Number(row.payPeriodId))||Number(row.payPeriodId)<1)
    return "Holiday-fund payroll references are invalid.";
  if(!/^\d{4}\/\d{2}$/.test(String(row.taxYear||""))||!Number.isInteger(Number(row.periodNumber))||Number(row.periodNumber)<1)
    return "Holiday-fund tax-year or period evidence is invalid.";
  if(!["draft","finalised"].includes(String(row.status||"")))return "Holiday-fund entry status is invalid.";
  let calculated:HolidayFundPeriodResult;
  try{
    calculated=calculateHolidayFundPeriod({
      schemeType:String(row.schemeType) as HolidayFundSchemeType,workerType:String(row.workerType) as HolidayFundWorkerType,
      contractConfirmed:row.contractConfirmed===true,accrualRate:Number(row.accrualRate),openingBalance:Number(row.balanceBefore),
      basicAndHourlyPay:Number(row.accrualBase),totalPay:Number(row.accrualBase),manualAdded:Number(row.manualAdded),
      requestedPaid:Number(row.requestedPaid),referencePayOverride:row.referencePayOverride,
      hasStatutoryAbsence:String(row.schemeType)==="rolled-up"&&row.referencePayOverride!==null&&row.referencePayOverride!==undefined,
    });
  }catch(error){return error instanceof Error?error.message:"Holiday-fund evidence is invalid.";}
  for(const field of ["addedAmount","paidAmount","balanceAfter","taxablePay","nicablePay","postTaxDeduction"] as const)
    if(Math.abs(Number(row[field])-calculated[field])>.005)return `Holiday-fund ${field} does not reconcile.`;
  return null;
}
