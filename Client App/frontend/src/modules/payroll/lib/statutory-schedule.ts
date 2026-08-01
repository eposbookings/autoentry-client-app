const dayMs=86_400_000;
const validIsoDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export function automaticStatutoryPayWeeks(statutoryType:string){
  return statutoryType==="maternity"||statutoryType==="adoption"?39:null;
}

export function automaticStatutoryPayEndDate(statutoryType:string,startDate:string){
  const weeks=automaticStatutoryPayWeeks(statutoryType);
  if(!weeks||!validIsoDate(startDate))return null;
  return new Date(Date.parse(`${startDate}T00:00:00Z`)+(weeks*7-1)*dayMs).toISOString().slice(0,10);
}
