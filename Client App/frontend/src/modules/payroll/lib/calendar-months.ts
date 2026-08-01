export function addCalendarMonths(iso:string,months:number){
  const source=new Date(`${iso}T00:00:00Z`);
  if(!Number.isFinite(source.getTime())||!Number.isInteger(months))throw new Error("A valid ISO date and whole calendar-month adjustment are required.");
  const targetMonth=source.getUTCMonth()+months;
  const year=source.getUTCFullYear()+Math.floor(targetMonth/12),month=((targetMonth%12)+12)%12;
  const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate(),day=Math.min(source.getUTCDate(),lastDay);
  return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}
