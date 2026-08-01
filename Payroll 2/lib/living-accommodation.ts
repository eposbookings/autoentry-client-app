export type LivingAccommodationInput={
  taxYear:string;annualValue:number;providerRent:number;propertyCost:number;improvements:number;
  employeeCapitalContribution:number;employeeRent:number;availableDays:number;sharedEmployees:number;salaryForegone?:number;
};
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const rates:Record<string,number>={"2025/26":3.75,"2026/27":3.75};
const yearDays=(taxYear:string)=>{const y=Number(taxYear.slice(0,4));return (Date.UTC(y+1,3,5)-Date.UTC(y,3,6))/86_400_000+1;};

export function calculateLivingAccommodation(input:LivingAccommodationInput){
  const officialRate=rates[input.taxYear];if(!officialRate)throw new Error("Automatic accommodation rates are available for tax years 2025/26 and 2026/27.");
  const values=[input.annualValue,input.providerRent,input.propertyCost,input.improvements,input.employeeCapitalContribution,input.employeeRent,input.salaryForegone||0];
  if(values.some(value=>!Number.isFinite(value)||value<0))throw new Error("Accommodation values and employee contributions must be non-negative amounts.");
  const taxYearDays=yearDays(input.taxYear);
  if(!Number.isInteger(input.availableDays)||input.availableDays<1||input.availableDays>taxYearDays)throw new Error(`Available days must be between 1 and ${taxYearDays}.`);
  if(!Number.isInteger(input.sharedEmployees)||input.sharedEmployees<1||input.sharedEmployees>100)throw new Error("Shared occupants must be between 1 and 100.");
  const factor=input.availableDays/taxYearDays/input.sharedEmployees;
  const standardCharge=round(Math.max(input.annualValue,input.providerRent)*factor);
  const accommodationCost=Math.max(0,input.propertyCost+input.improvements-input.employeeCapitalContribution);
  const additionalCharge=round(Math.max(0,accommodationCost-75000)*officialRate/100*factor);
  const grossCharge=round(standardCharge+additionalCharge);
  const normalBenefit=round(Math.max(0,grossCharge-input.employeeRent));
  const opraBenefit=input.salaryForegone?round(Math.max(grossCharge,input.salaryForegone)):0;
  const cashEquivalent=input.salaryForegone?opraBenefit:normalBenefit;
  return {officialRate,taxYearDays,factor,accommodationCost,standardCharge,additionalCharge,grossCharge,normalBenefit,opraBenefit,cashEquivalent,class1aNic:round(cashEquivalent*.15)};
}
