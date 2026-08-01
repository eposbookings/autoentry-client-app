const validIso=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export type StatutoryTouchDay={date:string;kind:"kit"|"split"};
export type StatutoryTouchType="maternity"|"adoption"|"shared-parental";

export function assessStatutoryTouchDays(input:{
  statutoryType:StatutoryTouchType;
  startDate:string;
  endDate:string;
  days:StatutoryTouchDay[];
  previousDays:StatutoryTouchDay[];
}){
  const kind=input.statutoryType==="shared-parental"?"split":"kit",limit=kind==="kit"?10:20;
  const empty={valid:false,error:"",kind,limit,currentDays:0,previousDays:input.previousDays.length,usedDays:input.previousDays.length,remainingDays:Math.max(0,limit-input.previousDays.length)};
  if(!validIso(input.startDate)||!validIso(input.endDate)||input.endDate<input.startDate)return {...empty,error:"Enter a valid statutory-pay date range before recording work-in-touch days."};
  if(!Array.isArray(input.days)||input.days.length>31)return {...empty,error:"Record no more than 31 work-in-touch days on one statutory-pay record."};
  const previousDates=new Set(input.previousDays.map(day=>day.date)),currentDates=new Set<string>();
  for(const day of input.days){
    if(!day||day.kind!==kind)return {...empty,error:`Only ${kind.toUpperCase()} days can be recorded for ${input.statutoryType.replace("-"," ")} pay.`};
    if(!validIso(day.date)||day.date<input.startDate||day.date>input.endDate)return {...empty,error:`Every ${kind.toUpperCase()} day must be a valid date within this statutory-pay record.`};
    if(currentDates.has(day.date)||previousDates.has(day.date))return {...empty,error:`${day.date} is already recorded as a ${kind.toUpperCase()} day for this family event.`};
    currentDates.add(day.date);
  }
  const usedDays=input.previousDays.length+input.days.length;
  if(usedDays>limit)return {...empty,currentDays:input.days.length,usedDays,remainingDays:0,error:`No more than ${limit} ${kind.toUpperCase()} days can be protected for this family event. Record further work through the ordinary worked-week exclusion workflow.`};
  return {valid:true,error:"",kind,limit,currentDays:input.days.length,previousDays:input.previousDays.length,usedDays,remainingDays:limit-usedDays};
}
