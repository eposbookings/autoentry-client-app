export type CompanyVanUse="taxable-private-use"|"restricted-private-use"|"insignificant-private-use"|"pool-van";
export type CompanyVanBenefitInput={
  taxYear:string;availableFrom:string;availableTo?:string|null;zeroEmission:boolean;
  useType:CompanyVanUse;sharedEmployees?:number;privateUseContribution?:number;
  privateFuelProvided?:boolean;privateFuelRepaid?:boolean;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const time=(value:string)=>Date.parse(`${value}T00:00:00Z`);
const days=(start:string,end:string)=>Math.floor((time(end)-time(start))/86_400_000)+1;
const rates:Record<string,{van:number;fuel:number}>={"2025/26":{van:4020,fuel:769},"2026/27":{van:4170,fuel:798}};

export function calculateCompanyVanBenefit(input:CompanyVanBenefitInput){
  const rate=rates[input.taxYear];
  if(!rate)throw new Error("Automatic company-van rates are available for tax years 2025/26 and 2026/27.");
  const startYear=Number(input.taxYear.slice(0,4)),taxYearStart=`${startYear}-04-06`,taxYearEnd=`${startYear+1}-04-05`;
  if(!Number.isFinite(time(input.availableFrom))||input.availableTo&&!Number.isFinite(time(input.availableTo)))throw new Error("Enter valid company-van availability dates.");
  const availableStart=input.availableFrom<taxYearStart?taxYearStart:input.availableFrom;
  const availableEnd=!input.availableTo||input.availableTo>taxYearEnd?taxYearEnd:input.availableTo;
  if(availableEnd<availableStart)throw new Error("The company van is not available in the selected tax year.");
  const sharedEmployees=Math.floor(input.sharedEmployees||1);
  if(sharedEmployees<1||sharedEmployees>100)throw new Error("Shared van employees must be between 1 and 100.");
  const taxYearDays=days(taxYearStart,taxYearEnd),availableDays=days(availableStart,availableEnd),availability=availableDays/taxYearDays;
  const exempt=input.zeroEmission||input.useType!=="taxable-private-use";
  const vanCharge=exempt?0:round(Math.max(0,rate.van/sharedEmployees*availability-Math.max(0,input.privateUseContribution||0)));
  const fuelCharge=input.zeroEmission||!input.privateFuelProvided||input.privateFuelRepaid?0:round(rate.fuel*availability);
  return {annualVanRate:rate.van,annualFuelRate:rate.fuel,taxYearDays,availableDays,sharedEmployees,vanCharge,fuelCharge,cashEquivalent:round(vanCharge+fuelCharge),class1aNic:round((vanCharge+fuelCharge)*.15),exempt};
}
