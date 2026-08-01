import { calculateBeneficialLoan } from "./beneficial-loan.ts";
import { class1aForBenefit, type BenefitNicTreatment } from "./benefit-classification.ts";
import { calculateCompanyCarBenefit } from "./company-car-benefit.ts";
import { calculateCompanyVanBenefit, type CompanyVanUse } from "./company-van-benefit.ts";
import { calculateLivingAccommodation } from "./living-accommodation.ts";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const taxYearStart=(taxYear:string)=>`${taxYear.slice(0,4)}-04-06`;
const taxYearEnd=(taxYear:string)=>`${Number(taxYear.slice(0,4))+1}-04-05`;
const taxYearDays=(taxYear:string)=>
  Math.floor((Date.parse(`${taxYearEnd(taxYear)}T00:00:00Z`)-Date.parse(`${taxYearStart(taxYear)}T00:00:00Z`))/86_400_000)+1;

export function nextTaxYear(taxYear:string){
  const start=Number(taxYear.slice(0,4));
  return `${start+1}/${String((start+2)%100).padStart(2,"0")}`;
}

export function shiftDateByTaxYear(value:string|null|undefined,years=1){
  if(!value)return null;
  const [year,month,day]=value.split("-").map(Number);
  const targetYear=year+years;
  const lastDay=new Date(Date.UTC(targetYear,month,0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2,"0")}-${String(Math.min(day,lastDay)).padStart(2,"0")}`;
}

export type BenefitCopySource={
  id:number;employeeId:number;taxYear:string;category:string;p11dSection:string|null;nicTreatment:string;
  providedDate:string|null;description:string|null;cashEquivalent:number;payrolled:boolean;class1aNic:number;
  benefitEvent:string|null;availableFrom:string|null;availableTo:string|null;vehicleRegistration:string|null;
  makeModel:string|null;fuelType:string|null;firstRegistered:string|null;co2Emissions:number|null;
  zeroEmissionMileage:number|null;listPrice:number|null;capitalContributions:number|null;
  privateUseContribution:number|null;vanUseType:string|null;vanFuelProvided:boolean|null;
  vanFuelRepaid:boolean|null;vanSharedEmployees:number|null;loanOpeningBalance:number|null;
  loanClosingBalance:number|null;loanMaximumAggregateBalance:number|null;loanWholeMonths:number|null;
  loanInterestPaid:number|null;loanSalaryForegone:number|null;accommodationAnnualValue:number|null;
  accommodationProviderRent:number|null;accommodationPropertyCost:number|null;accommodationImprovements:number|null;
  accommodationEmployeeCapital:number|null;accommodationEmployeeRent:number|null;accommodationAvailableDays:number|null;
  accommodationSharedEmployees:number|null;accommodationSalaryForegone:number|null;
};

export function prepareBenefitCopy(source:BenefitCopySource,targetTaxYear:string){
  if(nextTaxYear(source.taxYear)!==targetTaxYear)throw new Error("Benefits can only be copied into the immediately following tax year.");
  const targetStart=taxYearStart(targetTaxYear);
  if(["Company car","Company van"].includes(source.category)&&source.availableTo&&source.availableTo<targetStart)
    return {eligible:false as const,reason:"Vehicle availability ended before the destination tax year."};

  const nicTreatment=source.nicTreatment as BenefitNicTreatment;
  let cashEquivalent=round(Number(source.cashEquivalent));
  let class1aNic=class1aForBenefit(cashEquivalent,nicTreatment);
  const availableFrom=["Company car","Company van"].includes(source.category)
    ? source.availableFrom&&source.availableFrom>targetStart?source.availableFrom:targetStart
    : null;
  const availableTo=["Company car","Company van"].includes(source.category)?source.availableTo:null;
  let loanOpeningBalance=source.loanOpeningBalance,loanClosingBalance=source.loanClosingBalance;
  let loanMaximumAggregateBalance=source.loanMaximumAggregateBalance;
  let accommodationAvailableDays=source.accommodationAvailableDays;

  if(source.category==="Company car"){
    const result=calculateCompanyCarBenefit({
      taxYear:targetTaxYear,co2Emissions:Number(source.co2Emissions),zeroEmissionMileage:Number(source.zeroEmissionMileage),
      listPrice:Number(source.listPrice),capitalContributions:Number(source.capitalContributions),
      privateUseContribution:Number(source.privateUseContribution),availableFrom:availableFrom!,
      availableTo,fuelType:source.fuelType as Parameters<typeof calculateCompanyCarBenefit>[0]["fuelType"],
    });
    cashEquivalent=result.cashEquivalent;class1aNic=class1aForBenefit(cashEquivalent,nicTreatment);
  }else if(source.category==="Company van"){
    const result=calculateCompanyVanBenefit({
      taxYear:targetTaxYear,availableFrom:availableFrom!,availableTo,zeroEmission:source.fuelType==="Electric",
      useType:source.vanUseType as CompanyVanUse,sharedEmployees:Number(source.vanSharedEmployees),
      privateUseContribution:Number(source.privateUseContribution),privateFuelProvided:Boolean(source.vanFuelProvided),
      privateFuelRepaid:Boolean(source.vanFuelRepaid),
    });
    cashEquivalent=result.cashEquivalent;class1aNic=class1aForBenefit(cashEquivalent,nicTreatment);
  }else if(source.category==="Beneficial loan"){
    loanOpeningBalance=Number(source.loanClosingBalance);
    loanClosingBalance=Number(source.loanClosingBalance);
    loanMaximumAggregateBalance=Number(source.loanClosingBalance);
    const result=calculateBeneficialLoan({
      taxYear:targetTaxYear,openingBalance:loanOpeningBalance,closingBalance:loanClosingBalance,
      maximumAggregateBalance:loanMaximumAggregateBalance,wholeMonthsOutstanding:Number(source.loanWholeMonths),
      interestPaid:Number(source.loanInterestPaid),salaryForegone:Number(source.loanSalaryForegone),
    });
    cashEquivalent=result.cashEquivalent;class1aNic=class1aForBenefit(cashEquivalent,nicTreatment);
  }else if(source.category==="Living accommodation"){
    if(Number(source.accommodationAvailableDays)===taxYearDays(source.taxYear))
      accommodationAvailableDays=taxYearDays(targetTaxYear);
    const result=calculateLivingAccommodation({
      taxYear:targetTaxYear,annualValue:Number(source.accommodationAnnualValue),providerRent:Number(source.accommodationProviderRent),
      propertyCost:Number(source.accommodationPropertyCost),improvements:Number(source.accommodationImprovements),
      employeeCapitalContribution:Number(source.accommodationEmployeeCapital),employeeRent:Number(source.accommodationEmployeeRent),
      availableDays:Number(accommodationAvailableDays),sharedEmployees:Number(source.accommodationSharedEmployees),
      salaryForegone:Number(source.accommodationSalaryForegone),
    });
    cashEquivalent=result.cashEquivalent;class1aNic=class1aForBenefit(cashEquivalent,nicTreatment);
  }

  return {eligible:true as const,values:{
    employeeId:source.employeeId,taxYear:targetTaxYear,category:source.category,p11dSection:source.p11dSection,
    nicTreatment,providedDate:nicTreatment==="class-1"?shiftDateByTaxYear(source.providedDate):null,
    description:source.description,cashEquivalent,payrolled:nicTreatment==="exempt"?false:Boolean(source.payrolled),
    class1aNic,benefitEvent:source.category==="Company car"?"provided":source.benefitEvent,
    availableFrom,availableTo,vehicleRegistration:source.vehicleRegistration,makeModel:source.makeModel,
    fuelType:source.fuelType,firstRegistered:source.firstRegistered,co2Emissions:source.co2Emissions,
    zeroEmissionMileage:source.zeroEmissionMileage,listPrice:source.listPrice,
    capitalContributions:source.capitalContributions,privateUseContribution:source.privateUseContribution,
    vanUseType:source.vanUseType,vanFuelProvided:source.vanFuelProvided,vanFuelRepaid:source.vanFuelRepaid,
    vanSharedEmployees:source.vanSharedEmployees,loanOpeningBalance,loanClosingBalance,loanMaximumAggregateBalance,
    loanWholeMonths:source.loanWholeMonths,loanInterestPaid:source.loanInterestPaid,loanSalaryForegone:source.loanSalaryForegone,
    accommodationAnnualValue:source.accommodationAnnualValue,accommodationProviderRent:source.accommodationProviderRent,
    accommodationPropertyCost:source.accommodationPropertyCost,accommodationImprovements:source.accommodationImprovements,
    accommodationEmployeeCapital:source.accommodationEmployeeCapital,accommodationEmployeeRent:source.accommodationEmployeeRent,
    accommodationAvailableDays,accommodationSharedEmployees:source.accommodationSharedEmployees,
    accommodationSalaryForegone:source.accommodationSalaryForegone,status:"draft",voidReason:null,voidedAt:null,
    replacesBenefitId:null,copiedFromBenefitId:source.id,copiedAt:new Date().toISOString(),
  }};
}
