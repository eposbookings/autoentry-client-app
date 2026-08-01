import { countWorkingDays, normalizeWorkingWeekdays } from "./working-days.ts";

export type LeaveEntitlementEvent={
  type:string;
  startDate:string;
  endDate:string;
  qualifyingDays:number;
  qualifyingWeekdays?:string|null;
  excludedCalendarDates?:string|null;
  status:string;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const day=86_400_000;

export function leaveYearRange(taxYear:string) {
  const startYear=Number(taxYear.slice(0,4));
  if(!/^\d{4}\/\d{2}$/.test(taxYear)||Number(taxYear.slice(5))!==(startYear+1)%100)
    throw new Error("Leave year must use a consecutive tax year such as 2026/27.");
  return {start:`${startYear}-04-06`,end:`${startYear+1}-04-05`};
}

export function leaveYearForDate(date:string) {
  const timestamp=Date.parse(`${date}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date)
    throw new Error("Enter a valid leave date.");
  const year=Number(date.slice(0,4)),startsThisYear=date>=`${year}-04-06`,startYear=startsThisYear?year:year-1;
  return `${startYear}/${String((startYear+1)%100).padStart(2,"0")}`;
}

export function leaveYearsAcrossRange(startDate:string,endDate:string) {
  const first=Number(leaveYearForDate(startDate).slice(0,4)),last=Number(leaveYearForDate(endDate).slice(0,4));
  if(endDate<startDate)throw new Error("Enter a valid leave date range.");
  return Array.from({length:last-first+1},(_,index)=>{
    const year=first+index;
    return `${year}/${String((year+1)%100).padStart(2,"0")}`;
  });
}

function overlapShare(startDate:string,endDate:string,rangeStart:string,rangeEnd:string) {
  const start=Date.parse(`${startDate}T00:00:00Z`),end=Date.parse(`${endDate}T00:00:00Z`);
  const from=Date.parse(`${rangeStart}T00:00:00Z`),to=Date.parse(`${rangeEnd}T00:00:00Z`);
  if(![start,end,from,to].every(Number.isFinite)||end<start)return 0;
  return Math.max(0,Math.min(end,to)-Math.max(start,from)+day)/Math.max(day,end-start+day);
}

export function proratedLeaveEntitlement(annualDays:number,startDate:string|null|undefined,leavingDate:string|null|undefined,taxYear:string) {
  const range=leaveYearRange(taxYear),yearStart=Date.parse(`${range.start}T00:00:00Z`),yearEnd=Date.parse(`${range.end}T00:00:00Z`);
  const employmentStart=Math.max(yearStart,startDate?Date.parse(`${startDate}T00:00:00Z`):yearStart);
  const employmentEnd=Math.min(yearEnd,leavingDate?Date.parse(`${leavingDate}T00:00:00Z`):yearEnd);
  if(![employmentStart,employmentEnd].every(Number.isFinite)||employmentEnd<employmentStart)return 0;
  const employedDays=(employmentEnd-employmentStart)/day+1,totalDays=(yearEnd-yearStart)/day+1;
  return round(Math.max(0,Number(annualDays)||0)*employedDays/totalDays);
}

export function annualLeaveUsed(events:LeaveEntitlementEvent[],taxYear:string) {
  const range=leaveYearRange(taxYear);
  return round(events.filter(event=>event.status==="calculated"&&event.type.toLowerCase().includes("annual"))
    .reduce((sum,event)=>{
      const overlapStart=event.startDate<range.start?range.start:event.startDate,overlapEnd=event.endDate>range.end?range.end:event.endDate;
      if(overlapStart>overlapEnd)return sum;
      const weekdays=normalizeWorkingWeekdays(String(event.qualifyingWeekdays||"").split(",").map(Number));
      let excludedDates:string[]=[];
      try{const parsed=JSON.parse(String(event.excludedCalendarDates||"[]"));if(Array.isArray(parsed))excludedDates=parsed.map(String);}catch{}
      return sum+(weekdays.length?countWorkingDays(overlapStart,overlapEnd,weekdays,excludedDates):Math.max(0,Number(event.qualifyingDays)||0)*overlapShare(event.startDate,event.endDate,range.start,range.end));
    },0));
}

export function leaveEntitlementBalance(annualDays:number,startDate:string|null|undefined,leavingDate:string|null|undefined,events:LeaveEntitlementEvent[],taxYear:string) {
  const entitlement=proratedLeaveEntitlement(annualDays,startDate,leavingDate,taxYear),used=annualLeaveUsed(events,taxYear);
  return {contractual:round(Math.max(0,Number(annualDays)||0)),entitlement,used,remaining:round(entitlement-used)};
}
