import { calculateStatutoryPay } from "./payroll-engine.ts";
import { assessStatutoryTouchDays, type StatutoryTouchDay } from "./statutory-touch-days.ts";
import { assessStatutoryWorkedWeeks, type StatutoryWorkedWeek } from "./statutory-work-weeks.ts";

const statutoryTypes=new Set(["maternity","adoption","sick","paternity","shared-parental","bereavement","neonatal"]);
const familyKinds:Record<string,string[]>={
  maternity:["birth"],adoption:["adoption"],paternity:["birth","adoption"],
  "shared-parental":["birth","adoption"],bereavement:["death","stillbirth","miscarriage"],
};
const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const parseArray=(value:unknown)=>{
  if(value===null||value===undefined||value==="")return [];
  try { const parsed=JSON.parse(String(value)); return Array.isArray(parsed)?parsed:null; }
  catch { return null; }
};
const moneyEqual=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<0.005;

export function validateStatutoryEventEvidence(row:any,smallEmployer=false):string|null {
  if(!validIso(row?.startDate)||!validIso(row?.endDate)||row.endDate<row.startDate)
    return "Leave event has an invalid date range.";
  if(!["draft","calculated","cancelled"].includes(String(row.status||"")))
    return "Leave event has an unsupported lifecycle status.";
  const calendarDays=Math.floor((Date.parse(`${row.endDate}T00:00:00Z`)-Date.parse(`${row.startDate}T00:00:00Z`))/86_400_000)+1;
  const qualifyingDays=Number(row.qualifyingDays),daysPerWeek=Number(row.qualifyingDaysPerWeek);
  if(!Number.isInteger(qualifyingDays)||qualifyingDays<0||qualifyingDays>calendarDays||
    !Number.isInteger(daysPerWeek)||daysPerWeek<1||daysPerWeek>7)
    return "Leave event has invalid qualifying-day evidence.";
  const weekdays=String(row.qualifyingWeekdays||"").split(",").map(Number);
  if(weekdays.length!==daysPerWeek||new Set(weekdays).size!==weekdays.length||
    weekdays.some(day=>!Number.isInteger(day)||day<1||day>7))
    return "Leave event has invalid qualifying weekday evidence.";
  const amountFields=["averageWeeklyEarnings","relevantPayTotal","statutoryAmount","recoveredAmount"];
  if(amountFields.some(field=>!Number.isFinite(Number(row[field]))||Number(row[field])<0))
    return "Leave event contains invalid statutory-pay amounts.";
  if(!["manual","finalised-payroll"].includes(String(row.averageWeeklyEarningsSource||"")))
    return "Leave event has an unsupported average-weekly-earnings source.";
  if(row.averageWeeklyEarningsSource==="finalised-payroll"&&
    (!validIso(row.relevantPeriodStart)||!validIso(row.relevantPeriodEnd)||row.relevantPeriodEnd<row.relevantPeriodStart))
    return "Payroll-derived statutory pay is missing its relevant-period evidence.";
  if(row.averageWeeklyEarningsSource==="manual"&&(row.relevantPeriodStart||row.relevantPeriodEnd||Number(row.relevantPayTotal)!==0))
    return "Manual statutory pay contains contradictory payroll-derived evidence.";
  if(!Number.isInteger(Number(row.statutoryPaidDayOffset))||Number(row.statutoryPaidDayOffset)<0)
    return "Leave event has an invalid statutory paid-day offset.";

  const subtype=String(row.subtype||"none"),isStatutory=statutoryTypes.has(subtype);
  if(subtype!=="none"&&!isStatutory)return "Leave event has an unsupported statutory-pay type.";
  const touchDays=parseArray(row.statutoryTouchDays),workedWeeks=parseArray(row.statutoryWorkedWeeks);
  if(!touchDays||!workedWeeks)return "Leave event contains malformed statutory work evidence.";
  if(touchDays.length){
    if(!["maternity","adoption","shared-parental"].includes(subtype))return "Leave event contains work-in-touch days for an unsupported statutory type.";
    const assessment=assessStatutoryTouchDays({
      statutoryType:subtype as "maternity"|"adoption"|"shared-parental",
      startDate:row.startDate,endDate:row.endDate,days:touchDays as StatutoryTouchDay[],previousDays:[],
    });
    if(!assessment.valid)return assessment.error;
  }
  const payPeriodStart=String(row.statutoryPayPeriodStart||row.startDate);
  const workAssessment=assessStatutoryWorkedWeeks({
    statutoryType:subtype,startDate:row.startDate,endDate:row.endDate,payPeriodStart,
    workDates:(workedWeeks as StatutoryWorkedWeek[]).map(week=>String(week?.workDate||"")),
    protectedDates:(touchDays as StatutoryTouchDay[]).map(day=>String(day?.date||"")),
  });
  if(!workAssessment.valid||workAssessment.weeks.some((week,index)=>week.weekStart!==(workedWeeks as StatutoryWorkedWeek[])[index]?.weekStart))
    return workAssessment.error||"Leave event contains inconsistent statutory worked-week evidence.";

  if(!isStatutory){
    if(Number(row.statutoryAmount)!==0||Number(row.recoveredAmount)!==0||touchDays.length||workedWeeks.length||
      row.statutoryPayPeriodStart||Number(row.statutoryPaidDayOffset)!==0)
      return "Non-statutory leave contains statutory payment evidence.";
    return null;
  }
  if(familyKinds[subtype]){
    if(!String(row.familyEventReference||"").trim()||!validIso(row.familyEventDate)||
      !familyKinds[subtype].includes(String(row.familyEventKind||"")))
      return "Family statutory pay is missing its frozen family-event evidence.";
  }
  if(subtype==="shared-parental"&&(!Number.isInteger(Number(row.sharedPayWeeksAvailable))||
    Number(row.sharedPayWeeksAvailable)<1||Number(row.sharedPayWeeksAvailable)>37))
    return "Shared Parental Pay has invalid available-week evidence.";
  if(["maternity","adoption"].includes(subtype)&&!validIso(row.statutoryPayPeriodStart))
    return "Maternity or adoption pay is missing its statutory pay-period start.";
  if(subtype==="neonatal"&&(!validIso(row.childBirthDate)||!validIso(row.neonatalCareStartDate)||
    !validIso(row.neonatalCareEndDate)||row.neonatalCareEndDate<row.neonatalCareStartDate||
    !["tier-1","tier-2"].includes(String(row.neonatalTier||""))||
    !Boolean(row.relationshipDeclaration)||!Boolean(row.caringResponsibilityDeclaration)))
    return "Neonatal Care Pay is missing its frozen eligibility evidence.";

  const calculation=calculateStatutoryPay(subtype,Number(row.averageWeeklyEarnings),qualifyingDays/daysPerWeek,smallEmployer,{
    payableDays:qualifyingDays,qualifyingDaysPerWeek:daysPerWeek,
    payPeriodDayOffset:Number(row.statutoryPaidDayOffset),
    excludedWeekOffsets:workAssessment.excludedWeekOffsets,
  });
  if(!calculation.eligible&&row.status==="draft"&&Number(row.statutoryAmount)===0&&Number(row.recoveredAmount)===0)return null;
  if(!calculation.eligible||!moneyEqual(row.statutoryAmount,calculation.total)||!moneyEqual(row.recoveredAmount,calculation.recoverable))
    return "Leave event statutory pay or HMRC recovery does not reconcile.";
  return null;
}
