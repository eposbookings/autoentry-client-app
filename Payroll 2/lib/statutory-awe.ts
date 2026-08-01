export type AwePayment={payDate:string;earnings:number};
export type AweResult={
  averageWeeklyEarnings:number;relevantPeriodStart:string|null;relevantPeriodEnd:string|null;
  relevantPayTotal:number;paymentCount:number;method:string;warning:string|null;
};
const day=86_400_000;
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function deriveStatutoryAwe(payments:AwePayment[],firstAbsenceDate:string,frequency:string,contractualWeeklyEarnings=0):AweResult{
  const absence=Date.parse(`${firstAbsenceDate}T00:00:00Z`);
  const paid=payments.filter(item=>Number.isFinite(Date.parse(`${item.payDate}T00:00:00Z`))&&Date.parse(`${item.payDate}T00:00:00Z`)<absence)
    .sort((a,b)=>a.payDate.localeCompare(b.payDate));
  const last=paid.at(-1);
  if(!last)return {averageWeeklyEarnings:round(Math.max(0,contractualWeeklyEarnings)),relevantPeriodStart:null,relevantPeriodEnd:null,relevantPayTotal:0,paymentCount:0,method:"contractual-fallback",warning:"No finalised payment exists before the relevant date; contractual weekly earnings were used and require review."};
  const lastTime=Date.parse(`${last.payDate}T00:00:00Z`);
  let boundaryIndex=-1;
  for(let index=paid.length-2;index>=0;index--)if(lastTime-Date.parse(`${paid[index].payDate}T00:00:00Z`)>=56*day){boundaryIndex=index;break;}
  const included=boundaryIndex>=0?paid.slice(boundaryIndex+1):paid;
  const total=included.reduce((sum,item)=>sum+Math.max(0,item.earnings),0);
  const normalized=frequency.toLowerCase();
  let average=0,method="";
  if(normalized==="monthly"){
    average=included.length?total/included.length*12/52:0;method="monthly-payments-x12-div52";
  }else if(["weekly","fortnightly","four-weekly"].includes(normalized)){
    const representedWeeks=normalized==="weekly"?included.length:normalized==="fortnightly"?included.length*2:included.length*4;
    average=representedWeeks?total/representedWeeks:0;method=`${normalized}-payments-div-represented-weeks`;
  }else{
    const startTime=Date.parse(`${included[0].payDate}T00:00:00Z`),days=Math.max(1,Math.round((lastTime-startTime)/day)+1);
    average=total/days*7;method="irregular-payments-div-days-x7";
  }
  const insufficient=boundaryIndex<0;
  return {
    averageWeeklyEarnings:round(average),relevantPeriodStart:included[0]?.payDate||null,relevantPeriodEnd:last.payDate,
    relevantPayTotal:round(total),paymentCount:included.length,method,
    warning:insufficient?"Fewer than eight weeks of finalised payment history were available; review the new-starter calculation against contractual earnings.":null,
  };
}
