import { taxMonthRange } from "./pay-periods.ts";

export type PayrolledBenefitSource = {
  cashEquivalent:number;
  availableFrom?:string|null;
  availableTo?:string|null;
  providedDate?:string|null;
};

const iso=(timestamp:number)=>new Date(timestamp).toISOString().slice(0,10);
const pennies=(value:number)=>Math.round((value+Number.EPSILON)*100);

export function taxYearDateRange(taxYear:string) {
  const startYear=Number(taxYear.slice(0,4));
  if(!/^\d{4}\/\d{2}$/.test(taxYear)||Number(taxYear.slice(5))!==(startYear+1)%100)
    throw new Error("Tax year must be consecutive and use the format 2026/27.");
  return {start:`${startYear}-04-06`,end:`${startYear+1}-04-05`};
}

function daysInclusive(start:string,end:string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86_400_000)+1;
}

export function payrolledBenefitForRange(source:PayrolledBenefitSource,taxYear:string,periodStart:string,periodEnd:string) {
  const annualPennies=pennies(Math.max(0,Number(source.cashEquivalent)||0));
  if(!annualPennies)return 0;
  const year=taxYearDateRange(taxYear);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodStart>periodEnd||
    periodStart<year.start||periodEnd>year.end)throw new Error("Benefit allocation period must be a valid range within the tax year.");
  if(source.providedDate)return source.providedDate>=periodStart&&source.providedDate<=periodEnd?annualPennies/100:0;
  const benefitStart=source.availableFrom&&source.availableFrom>year.start?source.availableFrom:year.start;
  const benefitEnd=source.availableTo&&source.availableTo<year.end?source.availableTo:year.end;
  if(benefitStart>benefitEnd||periodEnd<benefitStart||periodStart>benefitEnd)return 0;
  const activeDays=daysInclusive(benefitStart,benefitEnd);
  const elapsedBefore=periodStart<=benefitStart?0:daysInclusive(benefitStart,periodStart)-1;
  const elapsedThrough=periodEnd>=benefitEnd?activeDays:daysInclusive(benefitStart,periodEnd);
  const allocatedBefore=Math.round(annualPennies*Math.max(0,elapsedBefore)/activeDays);
  const allocatedThrough=Math.round(annualPennies*Math.min(activeDays,elapsedThrough)/activeDays);
  return (allocatedThrough-allocatedBefore)/100;
}

export function payrolledBenefitForPeriod(source:PayrolledBenefitSource,periodNumber:number,taxYear:string) {
  const period=taxMonthRange(taxYear,periodNumber);
  return payrolledBenefitForRange(source,taxYear,iso(period.start),iso(period.end));
}

export function totalPayrolledBenefitsForRange(sources:PayrolledBenefitSource[],taxYear:string,periodStart:string,periodEnd:string) {
  return Math.round(sources.reduce((sum,source)=>sum+payrolledBenefitForRange(source,taxYear,periodStart,periodEnd),0)*100)/100;
}

export function totalPayrolledBenefitsForPeriod(sources:PayrolledBenefitSource[],periodNumber:number,taxYear:string) {
  return Math.round(sources.reduce((sum,source)=>sum+payrolledBenefitForPeriod(source,periodNumber,taxYear),0)*100)/100;
}
