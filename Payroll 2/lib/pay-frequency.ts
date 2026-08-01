export type PayrollFrequency="monthly"|"weekly"|"fortnightly"|"four-weekly";

export const payrollFrequencyRules:Record<PayrollFrequency,{
  label:string;
  periodsPerYear:number;
  maximumPeriods:number;
  weeksPerPeriod:number|null;
  reportedPayFrequency:"monthly"|"weekly"|"fortnightly"|"four-weekly";
}>={
  monthly:{label:"Monthly",periodsPerYear:12,maximumPeriods:12,weeksPerPeriod:null,reportedPayFrequency:"monthly"},
  weekly:{label:"Weekly",periodsPerYear:52,maximumPeriods:53,weeksPerPeriod:1,reportedPayFrequency:"weekly"},
  fortnightly:{label:"Every 2 weeks",periodsPerYear:26,maximumPeriods:27,weeksPerPeriod:2,reportedPayFrequency:"fortnightly"},
  "four-weekly":{label:"Every 4 weeks",periodsPerYear:13,maximumPeriods:14,weeksPerPeriod:4,reportedPayFrequency:"four-weekly"},
};

export function payrollFrequencyRule(value:unknown){
  const frequency=String(value||"monthly") as PayrollFrequency;
  const rule=payrollFrequencyRules[frequency];
  if(!rule)throw new Error("Payroll frequency must be monthly, weekly, fortnightly or four-weekly.");
  return {frequency,...rule};
}

export function validatePayrollPeriod(frequency:PayrollFrequency,periodNumber:number){
  const rule=payrollFrequencyRule(frequency);
  if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>rule.maximumPeriods)
    throw new Error(`${rule.label} payroll period must be between 1 and ${rule.maximumPeriods}.`);
  return periodNumber;
}

export function currentTaxFraction(frequency:PayrollFrequency){
  const rule=payrollFrequencyRule(frequency);
  return frequency==="monthly"?1/12:Number(rule.weeksPerPeriod)/52;
}

export function cumulativeTaxFraction(frequency:PayrollFrequency,periodNumber:number,taxWeekNumber?:number){
  validatePayrollPeriod(frequency,periodNumber);
  const rule=payrollFrequencyRule(frequency);
  if(frequency==="monthly")return periodNumber/12;
  const week=taxWeekNumber??periodNumber*Number(rule.weeksPerPeriod);
  if(!Number.isInteger(week)||week<1||week>56)throw new Error("PAYE tax week must be a whole number between 1 and 56.");
  return Math.min(52,week)/52;
}

export function isExtraPayPeriod(frequency:PayrollFrequency,periodNumber:number,taxWeekNumber?:number){
  const rule=payrollFrequencyRule(frequency);
  validatePayrollPeriod(frequency,periodNumber);
  return frequency==="monthly"?false:(taxWeekNumber??periodNumber*Number(rule.weeksPerPeriod))>52;
}

export function rtiTaxWeekNumber(frequency:PayrollFrequency,periodNumber:number){
  validatePayrollPeriod(frequency,periodNumber);
  if(frequency==="monthly")return periodNumber;
  if(frequency==="weekly")return periodNumber;
  if(frequency==="fortnightly")return periodNumber===27?54:periodNumber*2;
  return periodNumber===14?56:periodNumber*4;
}

const dayMs=86_400_000;
export function taxWeekForDate(taxYear:string,payDate:string){
  const match=/^(\d{4})\/(\d{2})$/.exec(taxYear),time=Date.parse(`${payDate}T00:00:00Z`);
  if(!match||Number(match[2])!==(Number(match[1])+1)%100||!/^\d{4}-\d{2}-\d{2}$/.test(payDate)||!Number.isFinite(time))
    throw new Error("Tax year and pay date must be valid.");
  const start=Date.UTC(Number(match[1]),3,6),end=Date.UTC(Number(match[1])+1,3,5);
  if(time<start||time>end)throw new Error("Pay date must fall within the selected tax year.");
  return Math.floor((time-start)/dayMs/7)+1;
}

export function taxMonthForDate(taxYear:string,payDate:string){
  const weekValidation=taxWeekForDate(taxYear,payDate);
  void weekValidation;
  const startYear=Number(taxYear.slice(0,4)),time=Date.parse(`${payDate}T00:00:00Z`);
  for(let month=1;month<=12;month++){
    const start=Date.UTC(startYear,3+month-1,6),end=Date.UTC(startYear,3+month,5);
    if(time>=start&&time<=end)return month;
  }
  throw new Error("Pay date does not map to a PAYE tax month.");
}

export function rtiPeriodNumberForPayDate(taxYear:string,frequency:PayrollFrequency,payDate:string){
  if(frequency==="monthly")return taxMonthForDate(taxYear,payDate);
  const week=taxWeekForDate(taxYear,payDate),weeks=Number(payrollFrequencyRule(frequency).weeksPerPeriod);
  return Math.min(frequency==="weekly"?53:frequency==="fortnightly"?54:56,Math.ceil(week/weeks)*weeks);
}

export function annualPayPeriodDivisor(frequency:PayrollFrequency){
  return payrollFrequencyRule(frequency).periodsPerYear;
}

export function regularPeriodWeeks(frequency:PayrollFrequency){
  return payrollFrequencyRule(frequency).weeksPerPeriod;
}

export function periodDateSequence(taxYear:string,frequency:Exclude<PayrollFrequency,"monthly">,firstPayDate:string){
  if(!/^(\d{4})\/(\d{2})$/.test(taxYear))throw new Error("Tax year must use the format 2026/27.");
  const startYear=Number(taxYear.slice(0,4)),start=`${startYear}-04-06`,end=`${startYear+1}-04-05`;
  const first=Date.parse(`${firstPayDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(firstPayDate)||!Number.isFinite(first)||firstPayDate<start||firstPayDate>end)
    throw new Error("First pay date must be a real date within the selected tax year.");
  const rule=payrollFrequencyRule(frequency),step=Number(rule.weeksPerPeriod)*7*dayMs;
  return Array.from({length:rule.maximumPeriods},(_,index)=>new Date(first+index*step).toISOString().slice(0,10))
    .filter(date=>date<=end);
}

export type ScheduledPayPeriod={
  periodNumber:number;
  payDate:string;
  periodStart:string;
  periodEnd:string;
  taxMonth:number;
  taxWeekNumber:number;
};

export function scheduledPayPeriods(taxYear:string,frequency:PayrollFrequency,firstPayDate?:string):ScheduledPayPeriod[]{
  const startYear=Number(taxYear.slice(0,4)),taxYearStart=`${startYear}-04-06`;
  if(frequency==="monthly")return Array.from({length:12},(_,index)=>{
    const periodNumber=index+1,monthIndex=(periodNumber+2)%12,year=periodNumber<=9?startYear:startYear+1;
    const payDate=new Date(Date.UTC(year,monthIndex+1,0)).toISOString().slice(0,10);
    const periodStart=new Date(Date.UTC(startYear,3+periodNumber-1,6)).toISOString().slice(0,10);
    const periodEnd=new Date(Date.UTC(startYear,3+periodNumber,5)).toISOString().slice(0,10);
    return {periodNumber,payDate,periodStart,periodEnd,taxMonth:periodNumber,taxWeekNumber:periodNumber};
  });
  const dates=periodDateSequence(taxYear,frequency,String(firstPayDate||""));
  const intervalDays=Number(payrollFrequencyRule(frequency).weeksPerPeriod)*7;
  return dates.map((payDate,index)=>{
    const payTime=Date.parse(`${payDate}T00:00:00Z`);
    const rawStart=new Date(payTime-(intervalDays-1)*dayMs).toISOString().slice(0,10);
    return {
      periodNumber:index+1,payDate,periodStart:rawStart<taxYearStart?taxYearStart:rawStart,periodEnd:payDate,
      taxMonth:taxMonthForDate(taxYear,payDate),taxWeekNumber:rtiPeriodNumberForPayDate(taxYear,frequency,payDate),
    };
  });
}
