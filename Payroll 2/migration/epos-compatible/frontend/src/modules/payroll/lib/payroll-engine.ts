import { cumulativeTaxFraction, currentTaxFraction, isExtraPayPeriod, payrollFrequencyRule, type PayrollFrequency } from "./pay-frequency.ts";

export type PayrollInput = {
  grossPay: number;
  taxableGrossPay?: number;
  nicableGrossPay?: number;
  pensionableGrossPay?: number;
  taxableBenefits?: number;
  preTaxDeductions?: number;
  taxablePreTaxDeductions?:number;
  postTaxDeductions?: number;
  statutoryPay?: number;
  taxCode?: string;
  week1Month1?: boolean;
  niCategory?: string;
  studentLoanPlan?: "1" | "2" | "4" | "5" | null;
  postgraduateLoan?: boolean;
  pensionEmployeeRate?: number;
  pensionEmployerRate?: number;
  pensionBasis?: "qualifying" | "gross";
  pensionRefund?:number;
  employerPensionRefund?:number;
  employerPensionAdditional?:number;
  ytdTaxablePay?: number;
  ytdTaxPaid?: number;
  ytdNicablePay?:number;
  ytdEmployeeNic?: number;
  ytdEmployerNic?: number;
  periodNumber?: number;
  director?: boolean;
  noSecondaryNic?: boolean;
  directorMethod?: "annual" | "alternative";
  directorStartPeriod?:number;
  directorEarningsPeriodWeeks?:number;
  finalDirectorPeriod?:boolean;
  pensionTaxRelief?: "net-pay" | "relief-at-source";
  contractedHours?: number;
  earningsPeriod?: "monthly" | "weekly";
  payFrequency?:PayrollFrequency;
  taxWeekNumber?:number;
};

export type PayrollResult = {
  grossPay: number;
  taxablePay: number;
  incomeTax: number;
  employeeNic: number;
  employerNic: number;
  studentLoan: number;
  postgraduateLoan: number;
  pensionablePay:number;
  employeePension: number;
  employeePensionTaxRelief:number;
  employeePensionGross:number;
  employerPension: number;
  netPay: number;
  employerCost: number;
  warnings: string[];
};

export type TargetNetResult = {
  targetNetPay:number;
  requiredGrossPay:number;
  achievedNetPay:number;
  difference:number;
  iterations:number;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundUpPenny = (value:number) => Math.ceil((value-1e-9)*100)/100;
const clamp = (value: number) => Math.max(0, value);

export function p45OpeningBalances(input:{
  previousPay?:number|null;previousTax?:number|null;
  receivedAfterFirstPayroll?:boolean;priorFinalisedRuns:number;
}) {
  const applies=!input.receivedAfterFirstPayroll||input.priorFinalisedRuns>0;
  return {
    taxablePay:applies?round(clamp(Number(input.previousPay||0))):0,
    taxPaid:applies?round(clamp(Number(input.previousTax||0))):0,
    applied:applies,
  };
}

function normalizedCode(code:string){
  return code.toUpperCase().replace(/\s|W1|M1|X$/g,"");
}
function baseCode(code:string){
  const normalized=normalizedCode(code);
  return /^[SC]/.test(normalized)?normalized.slice(1):normalized;
}
function allowanceFromCode(code: string) {
  const normalized = baseCode(code);
  if (["BR","D0","D1","D2","0T"].includes(normalized)) return 0;
  const number = Number(normalized.match(/\d+/)?.[0] || 0);
  if (normalized.startsWith("K")) return -(number * 10 + 9);
  return number ? number * 10 + 9 : 12570;
}

function annualTax(annualTaxable: number, code: string) {
  const normalized = normalizedCode(code),base=baseCode(normalized),scottish=normalized.startsWith("S");
  if (base === "NT") return 0;
  const flatRates:Record<string,number>=scottish?{BR:.2,D0:.21,D1:.42,D2:.45,D3:.48}:{BR:.2,D0:.4,D1:.45};
  if(base in flatRates)return annualTaxable*flatRates[base];
  const taxable = clamp(annualTaxable - allowanceFromCode(normalized));
  if (scottish) {
    const starter = Math.min(taxable, 3_967) * .19;
    const basic = Math.min(clamp(taxable - 3_967), 12_989) * .2;
    const intermediate = Math.min(clamp(taxable - 16_956), 14_136) * .21;
    const higher = Math.min(clamp(taxable - 31_092), 31_338) * .42;
    const advanced = Math.min(clamp(taxable - 62_430), 62_710) * .45;
    const top = clamp(taxable - 125_140) * .48;
    return starter + basic + intermediate + higher + advanced + top;
  }
  const basic = Math.min(taxable, 37700) * .2;
  const higher = Math.min(clamp(taxable - 37700), 87440) * .4;
  const additional = clamp(taxable - 125140) * .45;
  return basic + higher + additional;
}

function calculatePaye(input: PayrollInput, taxablePay: number) {
  const code = input.taxCode || "1257L";
  const frequency=input.payFrequency||"monthly";
  const period=Math.max(1,Math.min(payrollFrequencyRule(frequency).maximumPeriods,input.periodNumber||1));
  const currentFraction=currentTaxFraction(frequency),cumulativeFraction=cumulativeTaxFraction(frequency,period,input.taxWeekNumber);
  const nonCumulative=Boolean(input.week1Month1)||/W1|M1|X$/i.test(code.replace(/\s/g,""));
  if (nonCumulative) return Math.min(annualTax(taxablePay/currentFraction,code)*currentFraction,taxablePay*.5);
  const ytdTaxable = (input.ytdTaxablePay || 0) + taxablePay;
  if(isExtraPayPeriod(frequency,period,input.taxWeekNumber)){
    const annualAllowance=allowanceFromCode(code);
    if(annualAllowance>0&&ytdTaxable<=annualAllowance)return 0;
    return Math.min(annualTax(taxablePay/currentFraction,code)*currentFraction,taxablePay*.5);
  }
  const annualEquivalent = ytdTaxable / cumulativeFraction;
  const cumulativeDue = annualTax(annualEquivalent, code) * cumulativeFraction;
  const adjustment=cumulativeDue-(input.ytdTaxPaid||0);
  return adjustment<0?Math.max(adjustment,-(input.ytdTaxPaid||0)):Math.min(adjustment,taxablePay*.5);
}

function standardNic(gross:number,category:string,earningsPeriod:"monthly"|"weekly"="monthly",periodWeeks=1) {
  const weekly=earningsPeriod==="weekly",multiplier=weekly?Math.max(1,periodWeeks):1;
  const pt = weekly?242*multiplier:1048;
  const uel = weekly?967*multiplier:4189;
  const st = weekly?96*multiplier:417;
  const normalized = category.toUpperCase();
  const employeeExempt = ["C", "K", "S", "X"].includes(normalized);
  const employerExempt = normalized === "X";
  const reduced=["B","E","I"].includes(normalized),deferred=["D","J","L","Z"].includes(normalized);
  const mainEmployeeRate = reduced ? .0185 : deferred ? .02 : .08;
  const employee = employeeExempt ? 0 : Math.min(clamp(gross - pt), uel - pt) * mainEmployeeRate + clamp(gross - uel) * .02;
  const employerThreshold = ["H","M","V","Z"].includes(normalized)?uel:["D","E","F","I","K","L","N","S"].includes(normalized)?(weekly?481*multiplier:2083):st;
  const employer = employerExempt ? 0 : clamp(gross - employerThreshold) * .15;
  return { employee, employer };
}

function calculateNic(input: PayrollInput, gross: number, category: string) {
  if (!input.director || input.directorMethod === "alternative"&&!input.finalDirectorPeriod) {
    const frequency=input.payFrequency||"monthly",frequencyWeeks=payrollFrequencyRule(frequency).weeksPerPeriod;
    const earningsPeriod=input.earningsPeriod||(frequency==="monthly"?"monthly":"weekly");
    const result=standardNic(gross,category,earningsPeriod,earningsPeriod==="weekly"?Number(frequencyWeeks||1):1);
    return { employee: result.employee, employer: input.noSecondaryNic ? 0 : result.employer };
  }
  const normalized = category.toUpperCase();
  const ytdGross = (input.ytdNicablePay || 0) + gross;
  const factor=input.directorEarningsPeriodWeeks
    ? Math.max(1,Math.min(52,input.directorEarningsPeriodWeeks))/52
    : Math.max(1,13-Math.max(1,Math.min(12,input.directorStartPeriod||1)))/12;
  const annualPt=12_570*factor,annualUel=50_270*factor;
  const employeeExempt = ["C","K","S","X"].includes(normalized);
  const employerExempt = normalized === "X";
  const reduced=["B","E","I"].includes(normalized),deferred=["D","J","L","Z"].includes(normalized);
  const mainRate=reduced?.0185:deferred?.02:.08;
  const employeeAnnual = employeeExempt ? 0 : Math.min(clamp(ytdGross-annualPt),annualUel-annualPt)*mainRate+clamp(ytdGross-annualUel)*.02;
  const employerBase=["H","M","V","Z"].includes(normalized)?50_270:["D","E","F","I","K","L","N","S"].includes(normalized)?25_000:5_000;
  const employerAnnual = employerExempt ? 0 : clamp(ytdGross-employerBase*factor)*.15;
  return {
    employee: clamp(employeeAnnual - (input.ytdEmployeeNic || 0)),
    employer: input.noSecondaryNic ? 0 : clamp(employerAnnual - (input.ytdEmployerNic || 0)),
  };
}

const studentThresholds = { "1": 2241.66, "2": 2448.75, "4": 2816.25, "5": 2083.33 };
const weeklyStudentThresholds = { "1": 517.30, "2": 565.09, "4": 649.90, "5": 480.76 };

export function calculateMonthlyPayroll(input: PayrollInput): PayrollResult {
  const warnings: string[] = [];
  const statutoryPay=clamp(input.statutoryPay||0);
  const gross = round(clamp(input.grossPay + statutoryPay));
  const taxableGross = round(clamp((input.taxableGrossPay ?? input.grossPay)+statutoryPay));
  const nicableGross = round(clamp((input.nicableGrossPay ?? input.grossPay)+statutoryPay));
  const pensionableGross = round(clamp((input.pensionableGrossPay ?? input.grossPay)+statutoryPay));
  const frequency=input.payFrequency||"monthly",frequencyWeeks=payrollFrequencyRule(frequency).weeksPerPeriod;
  const pensionLower=frequency==="monthly"?520:120*Number(frequencyWeeks);
  const pensionUpper=frequency==="monthly"?4189:Number(frequencyWeeks)===4?3867:967*Number(frequencyWeeks);
  const pensionBasisPay = input.pensionBasis === "gross" ? pensionableGross : Math.min(clamp(pensionableGross-pensionLower),pensionUpper-pensionLower);
  const employeePensionGross = round(pensionBasisPay * ((input.pensionEmployeeRate ?? 5) / 100));
  const employeePensionTaxRelief=input.pensionTaxRelief==="relief-at-source"?round(employeePensionGross*.2):0;
  const employeePensionContribution=round(employeePensionGross-employeePensionTaxRelief);
  const pensionRefund=round(clamp(input.pensionRefund||0));
  const employeePension = round(employeePensionContribution-pensionRefund);
  const pensionTaxDeduction = input.pensionTaxRelief === "net-pay" ? employeePensionGross : 0;
  const taxablePay = round(clamp(taxableGross + (input.taxableBenefits || 0) - (input.taxablePreTaxDeductions ?? input.preTaxDeductions ?? 0) - pensionTaxDeduction));
  const incomeTax = round(calculatePaye(input, taxablePay));
  const nic = calculateNic(input, nicableGross, input.niCategory || "A");
  const employeeNic = round(nic.employee);
  const employerNic = round(nic.employer);
  const earningsPeriod=input.earningsPeriod||(frequency==="monthly"?"monthly":"weekly");
  const thresholdWeeks=earningsPeriod==="weekly"?Number(frequencyWeeks||1):1;
  const studentThreshold=input.studentLoanPlan?(earningsPeriod==="weekly"?weeklyStudentThresholds[input.studentLoanPlan]*thresholdWeeks:studentThresholds[input.studentLoanPlan]):0;
  const studentLoan = round(studentThreshold ? Math.floor(clamp(nicableGross - studentThreshold) * .09) : 0);
  const postgraduateLoan = round(input.postgraduateLoan ? Math.floor(clamp(nicableGross - (earningsPeriod==="weekly"?403.84*thresholdWeeks:1750)) * .06) : 0);
  const employerPension = round(pensionBasisPay * ((input.pensionEmployerRate ?? 3) / 100)+clamp(input.employerPensionAdditional||0)-clamp(input.employerPensionRefund||0));
  const netBeforeClamp=gross - incomeTax - employeeNic - studentLoan - postgraduateLoan - employeePensionContribution + pensionRefund - (input.preTaxDeductions||0) - (input.postTaxDeductions || 0);
  const netPay = round(clamp(netBeforeClamp));
  const employerCost = round(gross + employerNic + employerPension);
  const periodHours=input.contractedHours
    ?input.contractedHours*(frequency==="monthly"?52/12:Number(frequencyWeeks))
    :frequency==="monthly"?173.33:40*Number(frequencyWeeks);
  if (gross > 0 && periodHours > 0 && gross / periodHours < 12.71) warnings.push("Pay may be below the 2026/27 National Living Wage.");
  if(statutoryPay>0&&input.grossPay>0)warnings.push("Statutory pay is additional to the entered cash pay; review any occupational pay or salary reduction before finalising.");
  if(netBeforeClamp<0)warnings.push("Deductions exceeded available net pay and were capped at zero.");
  if (!input.taxCode) warnings.push("No tax code supplied; 1257L has been used.");
  return { grossPay: gross, taxablePay, incomeTax, employeeNic, employerNic, studentLoan, postgraduateLoan, pensionablePay:round(pensionBasisPay), employeePension,employeePensionTaxRelief,employeePensionGross, employerPension, netPay, employerCost, warnings };
}

export function solveGrossForTargetNet(input:Omit<PayrollInput,"grossPay">,targetNetPay:number):TargetNetResult {
  if(!Number.isFinite(targetNetPay)||targetNetPay<0)throw new Error("Target net pay must be a valid non-negative number.");
  const calculate=(grossPay:number)=>calculateMonthlyPayroll({
    ...input,
    grossPay,
    taxableGrossPay:input.taxableGrossPay===undefined?undefined:grossPay,
    nicableGrossPay:input.nicableGrossPay===undefined?undefined:grossPay,
    pensionableGrossPay:input.pensionableGrossPay===undefined?undefined:grossPay,
  }).netPay;
  let lower=0,upper=Math.max(100,targetNetPay*2),iterations=0;
  while(calculate(upper)<targetNetPay&&upper<10_000_000){upper*=2;iterations++;}
  if(calculate(upper)<targetNetPay)throw new Error("The target net pay is outside the supported calculation range.");
  while(upper-lower>.005&&iterations<100){
    const midpoint=(lower+upper)/2;
    if(calculate(midpoint)<targetNetPay)lower=midpoint;else upper=midpoint;
    iterations++;
  }
  const candidates=[Math.floor(lower*100)/100,Math.ceil(upper*100)/100];
  const requiredGrossPay=candidates.reduce((best,value)=>
    Math.abs(calculate(value)-targetNetPay)<Math.abs(calculate(best)-targetNetPay)?value:best,candidates[0]);
  const achievedNetPay=calculate(requiredGrossPay);
  return {
    targetNetPay:round(targetNetPay),
    requiredGrossPay:round(requiredGrossPay),
    achievedNetPay,
    difference:round(achievedNetPay-targetNetPay),
    iterations,
  };
}

export type StatutoryPayType = "maternity" | "adoption" | "paternity" | "shared-parental" | "bereavement" | "neonatal" | "sick";

const statutoryWeekLimits: Record<StatutoryPayType, number> = {
  maternity: 39, adoption: 39, paternity: 2, "shared-parental": 37,
  bereavement: 2, neonatal: 12, sick: 28,
};

export function calculateStatutoryPay(type: string, averageWeeklyEarnings: number, weeks: number, smallEmployer = false,options?:{payableDays?:number;qualifyingDaysPerWeek?:number;payPeriodDayOffset?:number;excludedWeekOffsets?:number[];priorExcludedWeeks?:number}) {
  const normalized = (type === "family" ? "paternity" : type) as StatutoryPayType;
  if (!(normalized in statutoryWeekLimits)) return { weeklyRate: 0, total: 0, recoverable: 0, eligible: false, reason: "This absence does not attract statutory pay." };
  const payableWeeks = Math.max(0, Math.min(weeks, statutoryWeekLimits[normalized]));
  const qualifyingDaysPerWeek=Math.max(1,Math.min(7,Math.round(options?.qualifyingDaysPerWeek||5)));
  const payableDays=Math.max(0,Math.min(
    Math.round(options?.payableDays??(normalized==="sick"?payableWeeks*qualifyingDaysPerWeek:payableWeeks*7)),
    statutoryWeekLimits[normalized]*(normalized==="sick"?qualifyingDaysPerWeek:7),
  ));
  const standard = 194.32;
  const ninety = averageWeeklyEarnings * .9;
  const capped = Math.min(standard, ninety);
  const eligible = normalized === "sick" ? averageWeeklyEarnings > 0 : averageWeeklyEarnings >= 129;
  if (!eligible) return { weeklyRate: 0, total: 0, recoverable: 0, eligible: false, reason: normalized==="sick"?"No qualifying average weekly earnings were recorded.":"Average weekly earnings are below the £129 statutory-pay threshold." };
  const payPeriodDayOffset=Math.max(0,Math.min(273,Math.round(options?.payPeriodDayOffset||0)));
  const excludedWeekOffsets=new Set((options?.excludedWeekOffsets||[]).filter(value=>Number.isInteger(value)&&value>=0&&value<statutoryWeekLimits[normalized]));
  const recordStartWeek=Math.floor(payPeriodDayOffset/7),recordEndWeek=Math.floor((payPeriodDayOffset+Math.max(0,payableDays-1))/7);
  const excludedWeeks=[...excludedWeekOffsets].filter(value=>value>=recordStartWeek&&value<=recordEndWeek).length;
  const paidDays=Math.max(0,payableDays-excludedWeeks*7);
  const priorExcludedWeeks=Math.max(0,Math.round(options?.priorExcludedWeeks||0));
  const priorPaidDays=Math.max(0,payPeriodDayOffset-priorExcludedWeeks*7);
  const enhancedRateDays=normalized==="maternity"||normalized==="adoption"?Math.max(0,Math.min(paidDays,42-priorPaidDays)):0;
  const total = normalized === "maternity" || normalized === "adoption"
    ? enhancedRateDays * ninety/7 + (paidDays-enhancedRateDays) * capped/7
    : normalized === "sick"
      ? payableDays * Math.min(123.25, averageWeeklyEarnings * .8)/qualifyingDaysPerWeek
      : Math.max(0,payableDays-(normalized==="shared-parental"?excludedWeeks*7:0)) * capped/7;
  const roundedTotal=normalized==="sick"?roundUpPenny(total):round(total);
  const recoverable = normalized === "sick" ? 0 : roundedTotal * (smallEmployer ? 1.09 : .92);
  return { weeklyRate: round(normalized === "sick" ? Math.min(123.25, averageWeeklyEarnings * .8) : capped),payableDays,paidDays,excludedWeeks,qualifyingDaysPerWeek,total:roundedTotal, recoverable: round(recoverable), eligible: true, reason: null };
}
