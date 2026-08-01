const validIsoDate=(value:string)=>{
  const timestamp=Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
};

export function normalizeWorkingWeekdays(values:Iterable<number>) {
  return [...new Set([...values].filter(day=>Number.isInteger(day)&&day>=1&&day<=7))].sort((left,right)=>left-right);
}

export function defaultWorkingWeekdays(daysPerWeek:number) {
  const count=Math.max(1,Math.min(7,Math.floor(Number(daysPerWeek)||5)));
  return Array.from({length:count},(_,index)=>index+1);
}

export function countWorkingDays(startDate:string,endDate:string,weekdays:Iterable<number>,excludedDates:Iterable<string>=[]) {
  if(!validIsoDate(startDate)||!validIsoDate(endDate)||endDate<startDate)throw new Error("Enter a valid working-day date range.");
  const selected=new Set(normalizeWorkingWeekdays(weekdays));
  if(!selected.size)throw new Error("Select at least one working weekday.");
  const excluded=new Set([...excludedDates].filter(validIsoDate));
  let count=0;
  for(let timestamp=Date.parse(`${startDate}T00:00:00Z`),end=Date.parse(`${endDate}T00:00:00Z`);timestamp<=end;timestamp+=86_400_000){
    const date=new Date(timestamp).toISOString().slice(0,10),weekday=new Date(timestamp).getUTCDay()||7;
    if(selected.has(weekday)&&!excluded.has(date))count++;
  }
  return count;
}
