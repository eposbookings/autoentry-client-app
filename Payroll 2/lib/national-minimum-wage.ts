export type MinimumWageProfile={
  dateOfBirth?:string|null;
  referenceDate:string;
  minimumWageCategory?:string|null;
  apprenticeshipStartDate?:string|null;
};

function ageOn(dateOfBirth:string,referenceDate:string){
  const birth=new Date(`${dateOfBirth}T00:00:00Z`),at=new Date(`${referenceDate}T00:00:00Z`);
  if(!Number.isFinite(birth.getTime())||!Number.isFinite(at.getTime())||birth>at)return null;
  return at.getUTCFullYear()-birth.getUTCFullYear()-
    (at.getUTCMonth()<birth.getUTCMonth()||(at.getUTCMonth()===birth.getUTCMonth()&&at.getUTCDate()<birth.getUTCDate())?1:0);
}

export function minimumWageRate(profile:MinimumWageProfile){
  const age=profile.dateOfBirth?ageOn(profile.dateOfBirth,profile.referenceDate):null;
  const apprenticeshipStart=profile.apprenticeshipStartDate?Date.parse(`${profile.apprenticeshipStartDate}T00:00:00Z`):NaN;
  const reference=Date.parse(`${profile.referenceDate}T00:00:00Z`);
  const firstYearApprentice=Number.isFinite(apprenticeshipStart)&&Number.isFinite(reference)&&reference>=apprenticeshipStart&&reference<new Date(apprenticeshipStart).setUTCFullYear(new Date(apprenticeshipStart).getUTCFullYear()+1);
  if(profile.minimumWageCategory==="apprentice"&&((age!==null&&age<19)||firstYearApprentice))
    return {rate:8,category:"Apprentice",age};
  if(age===null)return {rate:12.71,category:"Age unknown — 21+ rate used",age};
  if(age<18)return {rate:8,category:"Aged 16 to 17",age};
  if(age<21)return {rate:10.85,category:"Aged 18 to 20",age};
  return {rate:12.71,category:"Aged 21 and over",age};
}

export function effectiveHourlyRate(input:{payBasis?:string|null;hourlyRate:number;annualSalary:number;contractedHours:number;dailyRate?:number;workingDaysPerWeek?:number}){
  if(input.payBasis==="period"&&input.annualSalary>0&&input.contractedHours>0)
    return Math.round(input.annualSalary/(input.contractedHours*52)*100)/100;
  if(input.payBasis==="daily"&&Number(input.dailyRate)>0&&input.contractedHours>0&&Number(input.workingDaysPerWeek)>0)
    return Math.round((Number(input.dailyRate)/(input.contractedHours/Number(input.workingDaysPerWeek)))*100)/100;
  return Math.max(0,Math.round(input.hourlyRate*100)/100);
}
