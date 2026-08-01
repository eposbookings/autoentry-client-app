const dayMs=86_400_000;
const validIso=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export type StatutoryWorkedWeek={workDate:string;weekStart:string};

const iso=(time:number)=>new Date(time).toISOString().slice(0,10);

export function statutoryWeekStart(workDate:string,payPeriodStart:string){
  if(!validIso(workDate)||!validIso(payPeriodStart)||workDate<payPeriodStart)return "";
  const elapsed=Math.floor((Date.parse(`${workDate}T00:00:00Z`)-Date.parse(`${payPeriodStart}T00:00:00Z`))/dayMs);
  return iso(Date.parse(`${payPeriodStart}T00:00:00Z`)+Math.floor(elapsed/7)*7*dayMs);
}

export function assessStatutoryWorkedWeeks(input:{
  statutoryType:string;
  startDate:string;
  endDate:string;
  payPeriodStart:string;
  workDates:string[];
  protectedDates:string[];
  previousWeeks?:StatutoryWorkedWeek[];
}){
  const empty={valid:false,error:"",weeks:[] as StatutoryWorkedWeek[],excludedWeeks:0,excludedWeekOffsets:[] as number[]};
  if(!["maternity","adoption","shared-parental"].includes(input.statutoryType))return input.workDates.length?{...empty,error:"Ordinary worked-week exclusions apply only to maternity, adoption or shared parental pay."}:{...empty,valid:true};
  if(![input.startDate,input.endDate,input.payPeriodStart].every(validIso)||input.endDate<input.startDate)return {...empty,error:"Enter valid statutory-pay dates before recording ordinary work."};
  if(input.workDates.length>39)return {...empty,error:"No more than 39 worked-week evidence dates can be recorded on one statutory-pay claim."};
  const uniqueDates=new Set<string>(),uniqueWeeks=new Set<string>(),protectedDates=new Set(input.protectedDates);
  const previousWeekStarts=new Set((input.previousWeeks||[]).map(week=>week.weekStart));
  const weeks:StatutoryWorkedWeek[]=[];
  for(const workDate of input.workDates){
    if(!validIso(workDate)||workDate<input.startDate||workDate>input.endDate)return {...empty,error:"Every ordinary work date must fall within this statutory-pay record."};
    if(uniqueDates.has(workDate))return {...empty,error:"The same ordinary work date cannot be recorded twice."};
    if(protectedDates.has(workDate))return {...empty,error:"A work date cannot be both a protected KIT or SPLIT day and ordinary work."};
    const weekStart=statutoryWeekStart(workDate,input.payPeriodStart);
    if(!weekStart)return {...empty,error:"The ordinary work date must fall on or after the statutory-pay period start."};
    if(uniqueWeeks.has(weekStart)||previousWeekStarts.has(weekStart))return {...empty,error:`Only one exclusion is recorded for statutory-pay week beginning ${weekStart}, even when more than one day was worked.`};
    uniqueDates.add(workDate);uniqueWeeks.add(weekStart);weeks.push({workDate,weekStart});
  }
  weeks.sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
  const start=Date.parse(`${input.payPeriodStart}T00:00:00Z`);
  const excludedWeekOffsets=weeks.map(week=>Math.floor((Date.parse(`${week.weekStart}T00:00:00Z`)-start)/dayMs/7));
  return {valid:true,error:"",weeks,excludedWeeks:weeks.length,excludedWeekOffsets};
}
