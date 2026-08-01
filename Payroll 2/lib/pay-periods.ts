const dayMs=86_400_000;

export function taxMonthRange(taxYear:string,periodNumber:number) {
  const startYear=Number(taxYear.slice(0,4));
  const monthIndex=(3+periodNumber-1)%12;
  const year=startYear+(3+periodNumber-1>=12?1:0);
  const start=Date.UTC(year,monthIndex,6);
  const nextMonth=monthIndex===11?0:monthIndex+1;
  const nextYear=monthIndex===11?year+1:year;
  return {start,end:Date.UTC(nextYear,nextMonth,5)};
}

export function employeeActiveInPeriod(startDate:string|null|undefined,leavingDate:string|null|undefined,periodNumber:number,taxYear:string) {
  const range=taxMonthRange(taxYear,periodNumber);
  return employeeActiveInRange(startDate,leavingDate,new Date(range.start).toISOString().slice(0,10),new Date(range.end).toISOString().slice(0,10));
}

export function employeeActiveInRange(startDate:string|null|undefined,leavingDate:string|null|undefined,periodStart:string,periodEnd:string) {
  const starts=startDate?Date.parse(`${startDate}T00:00:00Z`):Number.NEGATIVE_INFINITY;
  const leaves=leavingDate?Date.parse(`${leavingDate}T00:00:00Z`):Number.POSITIVE_INFINITY;
  return starts<=Date.parse(`${periodEnd}T00:00:00Z`)&&leaves>=Date.parse(`${periodStart}T00:00:00Z`);
}

export function overlapShare(startDate:string,endDate:string,periodNumber:number,taxYear:string) {
  const period=taxMonthRange(taxYear,periodNumber);
  const eventStart=Date.parse(`${startDate}T00:00:00Z`);
  const eventEnd=Date.parse(`${endDate}T00:00:00Z`);
  if(!Number.isFinite(eventStart)||!Number.isFinite(eventEnd)||eventEnd<eventStart)return 0;
  const overlap=Math.max(0,Math.min(eventEnd,period.end)-Math.max(eventStart,period.start)+dayMs);
  const duration=Math.max(dayMs,eventEnd-eventStart+dayMs);
  return overlap/duration;
}

type StatutoryEvent={
  type:string;subtype?:string|null;startDate:string;endDate:string;qualifyingDays:number;
  qualifyingDaysPerWeek?:number;
  qualifyingWeekdays?:string|null;
  statutoryPayPeriodStart?:string|null;
  statutoryWorkedWeeks?:string|null;
  statutoryPaidDayOffset?:number;
  averageWeeklyEarnings:number;statutoryAmount:number;recoveredAmount:number;
};

function statutoryKind(event:StatutoryEvent) {
  const value=(event.subtype||event.type).toLowerCase();
  if(value.includes("maternity"))return "maternity";
  if(value.includes("adoption"))return "adoption";
  if(value.includes("sick"))return "sick";
  return "family";
}

export function statutoryPayAllocationForRange(event:StatutoryEvent,periodStart:string,periodEnd:string) {
  if(event.statutoryAmount<=0||event.qualifyingDays<=0)return {pay:0,recovery:0};
  const period={start:Date.parse(`${periodStart}T00:00:00Z`),end:Date.parse(`${periodEnd}T00:00:00Z`)};
  if(!Number.isFinite(period.start)||!Number.isFinite(period.end)||period.end<period.start)throw new Error("Statutory allocation period is invalid.");
  const eventStart=Date.parse(`${event.startDate}T00:00:00Z`);
  const eventEnd=Date.parse(`${event.endDate}T00:00:00Z`),kind=statutoryKind(event);
  const statutoryPayPeriodStart=Date.parse(`${event.statutoryPayPeriodStart||event.startDate}T00:00:00Z`);
  let workedWeekStarts=new Set<number>();
  try{
    const parsed=JSON.parse(event.statutoryWorkedWeeks||"[]");
    if(Array.isArray(parsed))workedWeekStarts=new Set(parsed.map(item=>Date.parse(`${String(item?.weekStart||"")}T00:00:00Z`)).filter(Number.isFinite));
  }catch{}
  const parsedWeekdays=String(event.qualifyingWeekdays||"").split(",").map(Number).filter(day=>Number.isInteger(day)&&day>=1&&day<=7);
  const qualifyingWeekdays=new Set(parsedWeekdays.length?parsedWeekdays:Array.from({length:Math.max(1,Math.min(7,event.qualifyingDaysPerWeek||7))},(_,index)=>index+1));
  const qualifyingDaysPerWeek=qualifyingWeekdays.size;
  const dates:number[]=[];
  for(let date=eventStart;date<=eventEnd;date+=dayMs) {
    const weekday=new Date(date).getUTCDay()||7;
    if(kind!=="sick"||qualifyingWeekdays.has(weekday))dates.push(date);
  }
  const payableDates=dates.slice(0,event.qualifyingDays);
  let paidDayIndex=Math.max(0,event.statutoryPaidDayOffset===undefined
    ?Math.floor((eventStart-statutoryPayPeriodStart)/dayMs)
    :event.statutoryPaidDayOffset);
  const weights=payableDates.map(date=>{
    const ninety=event.averageWeeklyEarnings*.9;
    if(kind==="sick")return {date,weight:Math.min(123.25,event.averageWeeklyEarnings*.8)/qualifyingDaysPerWeek};
    const payPeriodDayIndex=Math.max(0,Math.floor((date-statutoryPayPeriodStart)/dayMs));
    const weekStart=statutoryPayPeriodStart+Math.floor(payPeriodDayIndex/7)*7*dayMs;
    if(workedWeekStarts.has(weekStart))return {date,weight:0};
    const weekly=(kind==="maternity"||kind==="adoption")&&paidDayIndex<42?ninety:Math.min(194.32,ninety);
    paidDayIndex++;
    return {date,weight:weekly/7};
  });
  const allWeight=weights.reduce((sum,item)=>sum+item.weight,0);
  const allocatedThrough=(amount:number,through:number)=>{
    if(!allWeight||amount<=0)return 0;
    const cumulativeWeight=weights.filter(item=>item.date<=through).reduce((sum,item)=>sum+item.weight,0);
    return Math.round(amount*cumulativeWeight/allWeight*100)/100;
  };
  const beforePeriod=period.start-dayMs;
  const pay=allocatedThrough(event.statutoryAmount,period.end)-allocatedThrough(event.statutoryAmount,beforePeriod);
  const recovery=allocatedThrough(event.recoveredAmount,period.end)-allocatedThrough(event.recoveredAmount,beforePeriod);
  return {pay,recovery};
}

export function statutoryPayAllocation(event:StatutoryEvent,periodNumber:number,taxYear:string) {
  const period=taxMonthRange(taxYear,periodNumber);
  return statutoryPayAllocationForRange(event,new Date(period.start).toISOString().slice(0,10),new Date(period.end).toISOString().slice(0,10));
}
