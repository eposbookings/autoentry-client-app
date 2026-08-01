const types=new Set(["earning","benefit","pre-tax-deduction","post-tax-deduction","salary-sacrifice","payroll-giving"]);
const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&
  Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const bool=(value:unknown)=>value===true||value===1||value===0||value===false;
const moneyEqual=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<.005;

export function validateRecurringPayEvidence(row:any):string|null {
  if(!validTaxYear(row?.taxYear)||!types.has(String(row?.type||""))||
    String(row.name||"").trim().length<3||String(row.name||"").trim().length>100||
    !Number.isFinite(Number(row.amount))||Number(row.amount)<=0||
    !["taxable","nicable","pensionable"].every(field=>bool(row[field])))
    return "Recurring pay schedule has invalid classification or amount evidence.";
  const start=Number(row.startPeriod),end=Number(row.endPeriod),status=String(row.status||"");
  if(!Number.isInteger(start)||start<1||start>12||!Number.isInteger(end)||end<0||end>12||
    !["active","stopped"].includes(status)||status==="active"&&end<start)
    return "Recurring pay schedule has an invalid period range or lifecycle state.";
  return null;
}

export function validateRecurringOccurrenceEvidence(schedule:any,item:any,period:any):string|null {
  if(period?.taxYear!==schedule.taxYear||Number(period?.periodNumber)<Number(schedule.startPeriod)||
    Number(period?.periodNumber)>Number(schedule.endPeriod))
    return "Recurring pay occurrence falls outside its stored schedule.";
  if(item.type!==schedule.type||item.name!==schedule.name||!moneyEqual(item.amount,schedule.amount)||
    !moneyEqual(item.quantity,1)||!moneyEqual(item.rate,schedule.amount)||
    Boolean(item.taxable)!==Boolean(schedule.taxable)||Boolean(item.nicable)!==Boolean(schedule.nicable)||
    Boolean(item.pensionable)!==Boolean(schedule.pensionable))
    return "Recurring pay occurrence no longer matches its source schedule.";
  return null;
}
