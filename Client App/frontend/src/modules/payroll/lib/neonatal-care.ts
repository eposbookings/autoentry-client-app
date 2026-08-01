const dayMs=86_400_000;
const validIso=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const daysBetween=(from:string,to:string)=>Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/dayMs);

export type NeonatalCareClaim={
  childBirthDate:string;
  careStartDate:string;
  careEndDate:string;
  payStartDate:string;
  payEndDate:string;
  tier:"tier-1"|"tier-2";
  relationshipDeclaration:boolean;
  caringResponsibilityDeclaration:boolean;
};

export function assessNeonatalCareClaim(input:NeonatalCareClaim){
  const dates=[input.childBirthDate,input.careStartDate,input.careEndDate,input.payStartDate,input.payEndDate];
  if(dates.some(value=>!validIso(value)))return {valid:false,error:"Enter the baby’s birth, neonatal care and pay dates.",careDays:0,accruedWeeks:0,claimedWeeks:0};
  if(input.childBirthDate<"2025-04-06")return {valid:false,error:"Statutory Neonatal Care Pay applies only where the baby was born on or after 6 April 2025.",careDays:0,accruedWeeks:0,claimedWeeks:0};
  if(input.careStartDate<input.childBirthDate||daysBetween(input.childBirthDate,input.careStartDate)>27)return {valid:false,error:"Neonatal care must start within 28 days of the baby’s birth.",careDays:0,accruedWeeks:0,claimedWeeks:0};
  if(input.careEndDate<input.careStartDate)return {valid:false,error:"The neonatal care end date cannot be before the care start date.",careDays:0,accruedWeeks:0,claimedWeeks:0};
  const careDays=daysBetween(input.careStartDate,input.careEndDate)+1,accruedWeeks=Math.min(12,Math.floor(careDays/7));
  if(accruedWeeks<1)return {valid:false,error:"At least 7 consecutive full neonatal care days are required.",careDays,accruedWeeks,claimedWeeks:0};
  if(input.payEndDate<input.payStartDate)return {valid:false,error:"The neonatal pay end date cannot be before its start date.",careDays,accruedWeeks,claimedWeeks:0};
  const claimedDays=daysBetween(input.payStartDate,input.payEndDate)+1,claimedWeeks=claimedDays/7;
  if(!Number.isInteger(claimedWeeks)||claimedWeeks<1)return {valid:false,error:"Statutory Neonatal Care Pay must be claimed in whole weeks.",careDays,accruedWeeks,claimedWeeks};
  if(claimedWeeks>accruedWeeks)return {valid:false,error:`Only ${accruedWeeks} week${accruedWeeks===1?" has":"s have"} accrued from the recorded neonatal care.`,careDays,accruedWeeks,claimedWeeks};
  if(daysBetween(input.childBirthDate,input.payStartDate)>475)return {valid:false,error:"Neonatal Care Pay must start within 68 weeks of the baby’s birth.",careDays,accruedWeeks,claimedWeeks};
  if(!["tier-1","tier-2"].includes(input.tier))return {valid:false,error:"Select Tier 1 or Tier 2 neonatal care pay.",careDays,accruedWeeks,claimedWeeks};
  if(!input.relationshipDeclaration||!input.caringResponsibilityDeclaration)return {valid:false,error:"Record both the parental relationship and caring responsibility declarations.",careDays,accruedWeeks,claimedWeeks};
  return {valid:true,error:"",careDays,accruedWeeks,claimedWeeks};
}
