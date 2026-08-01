export type CompanyCarFuel =
  | "Electric"
  | "Petrol"
  | "Hybrid"
  | "Diesel (RDE2)"
  | "Diesel (not RDE2)";

export type CompanyCarBenefitInput = {
  taxYear:string;
  co2Emissions:number;
  zeroEmissionMileage?:number;
  listPrice:number;
  capitalContributions?:number;
  privateUseContribution?:number;
  availableFrom:string;
  availableTo?:string|null;
  fuelType:CompanyCarFuel;
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const isoDay=(value:string)=>Date.parse(`${value}T00:00:00Z`);
const dayCount=(start:string,end:string)=>Math.floor((isoDay(end)-isoDay(start))/86_400_000)+1;

export function companyCarAppropriatePercentage(input:Pick<CompanyCarBenefitInput,"taxYear"|"co2Emissions"|"zeroEmissionMileage"|"fuelType">){
  const co2=Math.max(0,Math.floor(input.co2Emissions));
  const range=Math.max(0,Math.floor(input.zeroEmissionMileage||0));
  const lowEmissionIncrease=input.taxYear==="2025/26"?0:input.taxYear==="2026/27"?1:input.taxYear==="2027/28"?2:null;
  if(lowEmissionIncrease===null)throw new Error("Automatic company-car rates are available for tax years 2025/26 to 2027/28.");
  let percentage:number;
  if(co2===0)percentage=3+lowEmissionIncrease;
  else if(co2<=50){
    const base=range>=130?3:range>=70?6:range>=40?9:range>=30?13:15;
    percentage=Math.min(21,base+lowEmissionIncrease);
  }else{
    percentage=co2<=54?16:co2<=59?17:co2<=64?18:co2<=69?19:co2<=74?20:co2<=79?21:Math.min(37,22+Math.floor((co2-80)/5));
  }
  if(input.fuelType==="Diesel (not RDE2)"&&co2>0)percentage=Math.min(37,percentage+4);
  return percentage;
}

export function calculateCompanyCarBenefit(input:CompanyCarBenefitInput){
  const startYear=Number(input.taxYear.slice(0,4));
  if(!/^\d{4}\/\d{2}$/.test(input.taxYear)||Number(input.taxYear.slice(5))!==(startYear+1)%100)throw new Error("Tax year must use the format 2026/27.");
  const taxYearStart=`${startYear}-04-06`,taxYearEnd=`${startYear+1}-04-05`;
  if(!Number.isFinite(isoDay(input.availableFrom))||input.availableTo&&!Number.isFinite(isoDay(input.availableTo)))throw new Error("Enter valid company-car availability dates.");
  const availableStart=input.availableFrom<taxYearStart?taxYearStart:input.availableFrom;
  const availableEnd=!input.availableTo||input.availableTo>taxYearEnd?taxYearEnd:input.availableTo;
  if(availableEnd<availableStart)throw new Error("The company car is not available in the selected tax year.");
  if(!Number.isFinite(input.listPrice)||input.listPrice<=0)throw new Error("Enter a positive company-car list price.");
  const percentage=companyCarAppropriatePercentage(input);
  const taxYearDays=dayCount(taxYearStart,taxYearEnd),availableDays=dayCount(availableStart,availableEnd);
  const allowableCapitalContribution=Math.min(5000,Math.max(0,input.capitalContributions||0));
  const priceForTax=Math.max(0,input.listPrice-allowableCapitalContribution);
  const fullYearBenefit=round(priceForTax*percentage/100);
  const availabilityAdjustedBenefit=round(fullYearBenefit*availableDays/taxYearDays);
  const cashEquivalent=round(Math.max(0,availabilityAdjustedBenefit-Math.max(0,input.privateUseContribution||0)));
  return {
    percentage,taxYearDays,availableDays,allowableCapitalContribution,priceForTax,
    fullYearBenefit,availabilityAdjustedBenefit,cashEquivalent,class1aNic:round(cashEquivalent*.15),
  };
}
