import { calculateBeneficialLoan } from "./beneficial-loan.ts";
import { classifyBenefit, class1aForBenefit } from "./benefit-classification.ts";
import { calculateCompanyCarBenefit } from "./company-car-benefit.ts";
import { calculateCompanyVanBenefit } from "./company-van-benefit.ts";
import { calculateLivingAccommodation } from "./living-accommodation.ts";

const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&
  Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const moneyEqual=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<.005;

export function validateBenefitEvidence(row:any):string|null {
  if(!validTaxYear(row?.taxYear))return "Benefit has an invalid tax year.";
  const classification=classifyBenefit(String(row.category||""));
  if(!classification||row.p11dSection!==classification.section||
    !["class-1a","class-1","exempt"].includes(String(row.nicTreatment||"")))
    return "Benefit has an unsupported P11D classification or NIC treatment.";
  if(String(row.description||"").trim().length<3||String(row.description||"").trim().length>250||
    !Number.isFinite(Number(row.cashEquivalent))||Number(row.cashEquivalent)<0||
    !Number.isFinite(Number(row.class1aNic))||Number(row.class1aNic)<0)
    return "Benefit contains invalid description or monetary evidence.";
  const yearStart=`${String(row.taxYear).slice(0,4)}-04-06`,yearEnd=`${Number(String(row.taxYear).slice(0,4))+1}-04-05`;
  if(row.nicTreatment==="class-1"&&(!validIso(row.providedDate)||row.providedDate<yearStart||row.providedDate>yearEnd))
    return "Class 1 benefit is missing a valid provision date.";
  if(row.nicTreatment!=="class-1"&&row.providedDate)return "Benefit contains a contradictory Class 1 provision date.";
  if(row.nicTreatment==="exempt"&&Boolean(row.payrolled))return "Exempt benefit cannot be marked as payrolled.";
  if(!["draft","reviewed","voided"].includes(String(row.status||"")))return "Benefit has an unsupported lifecycle status.";
  if(row.status==="voided"){
    if(!validTimestamp(row.voidedAt)||String(row.voidReason||"").trim().length<5||String(row.voidReason||"").trim().length>500)
      return "Voided benefit is missing valid correction evidence.";
  }else if(row.voidedAt||row.voidReason)return "Active benefit contains contradictory void evidence.";

  let expectedCash=Number(row.cashEquivalent);
  try {
    if(row.category==="Company car"){
      if(!["provided","withdrawn","additional"].includes(String(row.benefitEvent||""))||
        !String(row.vehicleRegistration||"").trim()||!validIso(row.availableFrom)||
        row.availableTo&&(!validIso(row.availableTo)||row.availableTo<row.availableFrom))
        return "Company-car benefit has incomplete vehicle or availability evidence.";
      expectedCash=calculateCompanyCarBenefit({
        taxYear:row.taxYear,co2Emissions:Number(row.co2Emissions),zeroEmissionMileage:Number(row.zeroEmissionMileage),
        listPrice:Number(row.listPrice),capitalContributions:Number(row.capitalContributions),
        privateUseContribution:Number(row.privateUseContribution),availableFrom:row.availableFrom,
        availableTo:row.availableTo||null,fuelType:row.fuelType,
      }).cashEquivalent;
    }else if(row.category==="Company van"){
      if(!["taxable-private-use","restricted-private-use","insignificant-private-use","pool-van"].includes(String(row.vanUseType||""))||
        !String(row.vehicleRegistration||"").trim()||!validIso(row.availableFrom)||
        row.availableTo&&(!validIso(row.availableTo)||row.availableTo<row.availableFrom))
        return "Company-van benefit has incomplete vehicle or availability evidence.";
      expectedCash=calculateCompanyVanBenefit({
        taxYear:row.taxYear,availableFrom:row.availableFrom,availableTo:row.availableTo||null,
        zeroEmission:row.fuelType==="Electric",useType:row.vanUseType,sharedEmployees:Number(row.vanSharedEmployees),
        privateUseContribution:Number(row.privateUseContribution),privateFuelProvided:Boolean(row.vanFuelProvided),
        privateFuelRepaid:Boolean(row.vanFuelRepaid),
      }).cashEquivalent;
    }else if(row.category==="Beneficial loan"){
      expectedCash=calculateBeneficialLoan({
        taxYear:row.taxYear,openingBalance:Number(row.loanOpeningBalance),closingBalance:Number(row.loanClosingBalance),
        maximumAggregateBalance:Number(row.loanMaximumAggregateBalance),wholeMonthsOutstanding:Number(row.loanWholeMonths),
        interestPaid:Number(row.loanInterestPaid),salaryForegone:Number(row.loanSalaryForegone),
      }).cashEquivalent;
    }else if(row.category==="Living accommodation"){
      expectedCash=calculateLivingAccommodation({
        taxYear:row.taxYear,annualValue:Number(row.accommodationAnnualValue),providerRent:Number(row.accommodationProviderRent),
        propertyCost:Number(row.accommodationPropertyCost),improvements:Number(row.accommodationImprovements),
        employeeCapitalContribution:Number(row.accommodationEmployeeCapital),employeeRent:Number(row.accommodationEmployeeRent),
        availableDays:Number(row.accommodationAvailableDays),sharedEmployees:Number(row.accommodationSharedEmployees),
        salaryForegone:Number(row.accommodationSalaryForegone),
      }).cashEquivalent;
    }
  } catch {
    return "Benefit contains invalid category-specific calculation evidence.";
  }
  const expectedClass1a=class1aForBenefit(expectedCash,row.nicTreatment);
  if(!moneyEqual(row.cashEquivalent,expectedCash)||!moneyEqual(row.class1aNic,expectedClass1a))
    return "Benefit cash equivalent or Class 1A NIC does not reconcile.";
  return null;
}
