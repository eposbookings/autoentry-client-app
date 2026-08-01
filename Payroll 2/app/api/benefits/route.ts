import { NextResponse } from "next/server";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employers, expensesBenefits, payPeriods } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { calculateCompanyCarBenefit } from "../../../lib/company-car-benefit";
import { calculateCompanyVanBenefit, type CompanyVanUse } from "../../../lib/company-van-benefit";
import { calculateBeneficialLoan } from "../../../lib/beneficial-loan";
import { calculateLivingAccommodation } from "../../../lib/living-accommodation";
import { benefitCategories, classifyBenefit, class1aForBenefit, type BenefitNicTreatment } from "../../../lib/benefit-classification";
import { payrolledBenefitForRange } from "../../../lib/payrolled-benefits";
import { nextTaxYear, prepareBenefitCopy, type BenefitCopySource } from "../../../lib/benefit-copy";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const validIsoDate=(value:unknown)=>{
  const text=String(value||""),timestamp=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
};
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
async function finalisedBenefitPeriods(db:ReturnType<typeof getDb>,employerId:number,taxYear:string,source:{cashEquivalent:number;availableFrom?:string|null;availableTo?:string|null;providedDate?:string|null}){
  const periods=await db.select({
    periodNumber:payPeriods.periodNumber,status:payPeriods.status,
    periodStart:payPeriods.periodStart,periodEnd:payPeriods.periodEnd,
  }).from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear)));
  return periods.filter(period=>
    period.status==="finalised"&&period.periodStart&&period.periodEnd&&
    payrolledBenefitForRange(source,taxYear,period.periodStart,period.periodEnd)>0
  ).map(period=>period.periodNumber).sort((a,b)=>a-b);
}

export async function GET(request:Request) {
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||1);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select({
    id:expensesBenefits.id,employeeId:expensesBenefits.employeeId,taxYear:expensesBenefits.taxYear,
    category:expensesBenefits.category,p11dSection:expensesBenefits.p11dSection,nicTreatment:expensesBenefits.nicTreatment,providedDate:expensesBenefits.providedDate,description:expensesBenefits.description,cashEquivalent:expensesBenefits.cashEquivalent,
    payrolled:expensesBenefits.payrolled,class1aNic:expensesBenefits.class1aNic,status:expensesBenefits.status,
    benefitEvent:expensesBenefits.benefitEvent,availableFrom:expensesBenefits.availableFrom,availableTo:expensesBenefits.availableTo,
    vehicleRegistration:expensesBenefits.vehicleRegistration,makeModel:expensesBenefits.makeModel,fuelType:expensesBenefits.fuelType,
    firstRegistered:expensesBenefits.firstRegistered,co2Emissions:expensesBenefits.co2Emissions,zeroEmissionMileage:expensesBenefits.zeroEmissionMileage,
    listPrice:expensesBenefits.listPrice,capitalContributions:expensesBenefits.capitalContributions,privateUseContribution:expensesBenefits.privateUseContribution,
    vanUseType:expensesBenefits.vanUseType,vanFuelProvided:expensesBenefits.vanFuelProvided,
    vanFuelRepaid:expensesBenefits.vanFuelRepaid,vanSharedEmployees:expensesBenefits.vanSharedEmployees,
    loanOpeningBalance:expensesBenefits.loanOpeningBalance,loanClosingBalance:expensesBenefits.loanClosingBalance,
    loanMaximumAggregateBalance:expensesBenefits.loanMaximumAggregateBalance,loanWholeMonths:expensesBenefits.loanWholeMonths,
    loanInterestPaid:expensesBenefits.loanInterestPaid,loanSalaryForegone:expensesBenefits.loanSalaryForegone,
    accommodationAnnualValue:expensesBenefits.accommodationAnnualValue,accommodationProviderRent:expensesBenefits.accommodationProviderRent,
    accommodationPropertyCost:expensesBenefits.accommodationPropertyCost,accommodationImprovements:expensesBenefits.accommodationImprovements,
    accommodationEmployeeCapital:expensesBenefits.accommodationEmployeeCapital,accommodationEmployeeRent:expensesBenefits.accommodationEmployeeRent,
    accommodationAvailableDays:expensesBenefits.accommodationAvailableDays,accommodationSharedEmployees:expensesBenefits.accommodationSharedEmployees,
    accommodationSalaryForegone:expensesBenefits.accommodationSalaryForegone,
    voidReason:expensesBenefits.voidReason,voidedAt:expensesBenefits.voidedAt,replacesBenefitId:expensesBenefits.replacesBenefitId,
    copiedFromBenefitId:expensesBenefits.copiedFromBenefitId,copiedAt:expensesBenefits.copiedAt,
    confidential:employees.confidential,
  }).from(expensesBenefits).innerJoin(employees,eq(expensesBenefits.employeeId,employees.id))
    .where(eq(employees.employerId,employerId)).orderBy(desc(expensesBenefits.id));
  return NextResponse.json(access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential));
}

export async function POST(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON benefit object is required."},{status:400});
  const db=getDb(),employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(input.action==="copy-tax-year"){
    const sourceTaxYear=String(input.sourceTaxYear||""),targetTaxYear=String(input.targetTaxYear||"");
    if(!validTaxYear(sourceTaxYear)||!validTaxYear(targetTaxYear)||nextTaxYear(sourceTaxYear)!==targetTaxYear)
      return NextResponse.json({error:"Choose consecutive source and destination tax years."},{status:422});
    const [employer]=await db.select({taxYear:employers.taxYear}).from(employers).where(eq(employers.id,employerId)).limit(1);
    if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
    if(targetTaxYear!==employer.taxYear)
      return NextResponse.json({error:`Benefits may only be copied into this employer’s active tax year, ${employer.taxYear}.`},{status:409});
    const rows=await db.select({
      ...getTableColumns(expensesBenefits),confidential:employees.confidential,leavingDate:employees.leavingDate,
    }).from(expensesBenefits).innerJoin(employees,eq(expensesBenefits.employeeId,employees.id))
      .where(eq(employees.employerId,employerId)).orderBy(expensesBenefits.id);
    const reviewed=rows.filter(row=>row.taxYear===sourceTaxYear&&row.status==="reviewed");
    if(!reviewed.length)return NextResponse.json({error:`No reviewed expenses or benefits were found in ${sourceTaxYear}.`},{status:422});
    if(!access.membership.canViewConfidential&&reviewed.some(row=>row.confidential))
      return NextResponse.json({error:"Confidential employees have reviewed benefits in the source year. A user with confidential HR permission must perform the complete copy."},{status:403});
    const targetRows=rows.filter(row=>row.taxYear===targetTaxYear);
    const alreadyCopied=new Set(targetRows.map(row=>row.copiedFromBenefitId).filter((id):id is number=>id!==null));
    const pending=reviewed.filter(row=>!alreadyCopied.has(row.id));
    if(!pending.length)return NextResponse.json({error:`All reviewed ${sourceTaxYear} benefits have already been copied into ${targetTaxYear}.`},{status:409});
    const targetStart=`${targetTaxYear.slice(0,4)}-04-06`,skipped:{sourceBenefitId:number;reason:string}[]=[];
    const allPrepared:Extract<ReturnType<typeof prepareBenefitCopy>,{eligible:true}>[]=[];
    try{
      for(const source of pending){
        if(source.leavingDate&&source.leavingDate<targetStart){
          skipped.push({sourceBenefitId:source.id,reason:"Employee left before the destination tax year."});continue;
        }
        const copied=prepareBenefitCopy(source as BenefitCopySource,targetTaxYear);
        if(!copied.eligible){skipped.push({sourceBenefitId:source.id,reason:copied.reason});continue;}
        allPrepared.push(copied);
      }
    }catch(error){
      return NextResponse.json({error:error instanceof Error?error.message:"Benefit values could not be recalculated for the destination tax year."},{status:422});
    }
    const prepared=allPrepared.slice(0,75);
    const conflicts=prepared.filter(item=>targetRows.some(target=>
      target.employeeId===item.values.employeeId&&target.category===item.values.category&&
      String(target.description||"").trim()===String(item.values.description||"").trim()&&
      String(target.vehicleRegistration||"")===String(item.values.vehicleRegistration||"")
    )).map(item=>item.values.copiedFromBenefitId);
    if(conflicts.length)return NextResponse.json({
      error:"Destination-year benefits already exist for one or more source records. Review those records before copying so benefits are not duplicated.",
      conflictingSourceBenefitIds:conflicts,
    },{status:409});
    if(!prepared.length){
      if(reviewed.some(row=>alreadyCopied.has(row.id)))return NextResponse.json({
        error:`All eligible reviewed ${sourceTaxYear} benefits have already been copied into ${targetTaxYear}.`,
        skipped,
      },{status:409});
      return NextResponse.json({
        copied:0,skipped,remaining:0,
        message:"No eligible continuing benefits were available to copy.",
      });
    }
    const now=new Date().toISOString(),operations=prepared.map(item=>db.insert(expensesBenefits).values({...item.values,copiedAt:now}));
    operations.push(db.insert(auditLog).values({
      employerId,actor:access.user.email,action:"copied:expense-benefits",entityType:"expense-benefits",
      entityId:`${sourceTaxYear}->${targetTaxYear}`,after:JSON.stringify({
        sourceTaxYear,targetTaxYear,sourceBenefitIds:prepared.map(item=>item.values.copiedFromBenefitId),
        skipped,copiedAs:"draft",recalculated:true,
      }),
    }) as any);
    await db.batch(operations as [any,...any[]]);
    const created=(await db.select().from(expensesBenefits))
      .filter(row=>row.taxYear===targetTaxYear&&prepared.some(item=>item.values.copiedFromBenefitId===row.copiedFromBenefitId));
    return NextResponse.json({
      copied:created.length,benefits:created,skipped,
      remaining:Math.max(0,allPrepared.length-prepared.length),
      status:"draft",requiresReview:true,
    },{status:201});
  }
  const [employee]=await db.select({id:employees.id,confidential:employees.confidential}).from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  const taxYear=String(input.taxYear||""),category=String(input.category||""),description=String(input.description||"").trim();
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Enter a consecutive tax year in the format 2026/27."},{status:422});
  if(!benefitCategories.includes(category as typeof benefitCategories[number]))return NextResponse.json({error:"Select a supported P11D expense or benefit category."},{status:422});
  const classification=classifyBenefit(category)!;
  const requestedTreatment=String(input.nicTreatment||classification.defaultNicTreatment);
  if(!["class-1a","class-1","exempt"].includes(requestedTreatment))return NextResponse.json({error:"Select Class 1, Class 1A or exempt National Insurance treatment."},{status:422});
  const nicTreatment=requestedTreatment as BenefitNicTreatment;
  const providedDate=nicTreatment==="class-1"?String(input.providedDate||""):null;
  if(nicTreatment==="class-1"&&!validIsoDate(providedDate))return NextResponse.json({error:"Class 1 benefits require the date the value was provided or paid."},{status:422});
  if(providedDate){
    const yearStart=`${taxYear.slice(0,4)}-04-06`,yearEnd=`${Number(taxYear.slice(0,4))+1}-04-05`;
    if(providedDate<yearStart||providedDate>yearEnd)return NextResponse.json({error:`The Class 1 provision date must fall within ${taxYear}.`},{status:422});
  }
  if(description.length<3||description.length>250)return NextResponse.json({error:"Enter a description between 3 and 250 characters."},{status:422});
  const replacesBenefitId=input.replacesBenefitId==null?null:Number(input.replacesBenefitId);
  if(replacesBenefitId!==null){
    const [replaced]=await db.select({id:expensesBenefits.id,employeeId:expensesBenefits.employeeId,taxYear:expensesBenefits.taxYear,status:expensesBenefits.status})
      .from(expensesBenefits).innerJoin(employees,eq(expensesBenefits.employeeId,employees.id))
      .where(and(eq(expensesBenefits.id,replacesBenefitId),eq(employees.employerId,employerId))).limit(1);
    if(!replaced||replaced.employeeId!==employee.id||replaced.taxYear!==taxYear)return NextResponse.json({error:"Replacement must refer to a benefit for the same employee and tax year."},{status:422});
    if(replaced.status!=="voided")return NextResponse.json({error:"The original benefit must be voided before its replacement is created."},{status:409});
    const [existingReplacement]=await db.select({id:expensesBenefits.id}).from(expensesBenefits).where(eq(expensesBenefits.replacesBenefitId,replacesBenefitId)).limit(1);
    if(existingReplacement)return NextResponse.json({error:"This benefit already has a replacement record.",benefitId:existingReplacement.id},{status:409});
  }
  const companyCar=category==="Company car",companyVan=category==="Company van",beneficialLoan=category==="Beneficial loan",livingAccommodation=category==="Living accommodation";
  let cashEquivalent=Number(input.cashEquivalent);
  if(!companyCar&&!companyVan&&!beneficialLoan&&!livingAccommodation&&(!Number.isFinite(cashEquivalent)||cashEquivalent<0))return NextResponse.json({error:"Cash equivalent must be a valid non-negative amount."},{status:422});
  const carAmounts=[input.co2Emissions,input.zeroEmissionMileage,input.listPrice,input.capitalContributions,input.privateUseContribution].map(value=>Number(value||0));
  if(companyCar&&carAmounts.some(value=>!Number.isFinite(value)||value<0))return NextResponse.json({error:"Company-car values must be valid non-negative numbers."},{status:422});
  if(companyCar&&!["provided","withdrawn","additional"].includes(String(input.benefitEvent||"")))return NextResponse.json({error:"Choose whether the company car was provided, withdrawn or added."},{status:422});
  if(companyCar&&(!String(input.vehicleRegistration||"").trim()||!validIsoDate(input.availableFrom)))return NextResponse.json({error:"Company-car registration and a valid availability date are required."},{status:422});
  if(companyCar&&input.benefitEvent==="withdrawn"&&!validIsoDate(input.availableTo))return NextResponse.json({error:"A valid withdrawal date is required when a company car is withdrawn."},{status:422});
  if(companyCar&&input.availableTo&&!validIsoDate(input.availableTo))return NextResponse.json({error:"Enter a valid company-car withdrawal date."},{status:422});
  if(companyCar&&input.firstRegistered&&!validIsoDate(input.firstRegistered))return NextResponse.json({error:"Enter a valid first-registration date."},{status:422});
  if(companyCar&&input.availableTo&&String(input.availableTo)<String(input.availableFrom))return NextResponse.json({error:"Company-car withdrawal date cannot be before the availability date."},{status:422});
  if(companyCar&&Number(input.listPrice)<=0)return NextResponse.json({error:"Enter the company car list price and accessories."},{status:422});
  const allowedFuelTypes=["Electric","Petrol","Hybrid","Diesel (RDE2)","Diesel (not RDE2)"];
  if(companyCar&&!allowedFuelTypes.includes(String(input.fuelType||"")))return NextResponse.json({error:"Select the company car fuel and diesel emissions standard."},{status:422});
  let carCalculation:ReturnType<typeof calculateCompanyCarBenefit>|null=null;
  if(companyCar){
    try{carCalculation=calculateCompanyCarBenefit({
      taxYear,co2Emissions:Number(input.co2Emissions||0),zeroEmissionMileage:Number(input.zeroEmissionMileage||0),
      listPrice:Number(input.listPrice),capitalContributions:Number(input.capitalContributions||0),
      privateUseContribution:Number(input.privateUseContribution||0),availableFrom:String(input.availableFrom),
      availableTo:input.availableTo?String(input.availableTo):null,fuelType:String(input.fuelType) as Parameters<typeof calculateCompanyCarBenefit>[0]["fuelType"],
    });cashEquivalent=carCalculation.cashEquivalent;
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Company-car calculation failed."},{status:422});}
  }
  const allowedVanUses=["taxable-private-use","restricted-private-use","insignificant-private-use","pool-van"];
  let vanCalculation:ReturnType<typeof calculateCompanyVanBenefit>|null=null;
  if(companyVan){
    if(!allowedVanUses.includes(String(input.vanUseType||"")))return NextResponse.json({error:"Select the company van private-use treatment."},{status:422});
    if(!String(input.vehicleRegistration||"").trim()||!validIsoDate(input.availableFrom))return NextResponse.json({error:"Company-van registration and a valid availability date are required."},{status:422});
    if(input.availableTo&&!validIsoDate(input.availableTo))return NextResponse.json({error:"Enter a valid company-van end date."},{status:422});
    if(input.availableTo&&String(input.availableTo)<String(input.availableFrom))return NextResponse.json({error:"Company-van end date cannot be before the availability date."},{status:422});
    try{vanCalculation=calculateCompanyVanBenefit({
      taxYear,availableFrom:String(input.availableFrom),availableTo:input.availableTo?String(input.availableTo):null,
      zeroEmission:Boolean(input.zeroEmission),useType:String(input.vanUseType) as CompanyVanUse,
      sharedEmployees:Number(input.vanSharedEmployees||1),privateUseContribution:Number(input.privateUseContribution||0),
      privateFuelProvided:Boolean(input.vanFuelProvided),privateFuelRepaid:Boolean(input.vanFuelRepaid),
    });cashEquivalent=vanCalculation.cashEquivalent;
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Company-van calculation failed."},{status:422});}
  }
  let loanCalculation:ReturnType<typeof calculateBeneficialLoan>|null=null;
  if(beneficialLoan){
    try{loanCalculation=calculateBeneficialLoan({
      taxYear,openingBalance:Number(input.loanOpeningBalance),closingBalance:Number(input.loanClosingBalance),
      maximumAggregateBalance:Number(input.loanMaximumAggregateBalance),wholeMonthsOutstanding:Number(input.loanWholeMonths),
      interestPaid:Number(input.loanInterestPaid||0),salaryForegone:Number(input.loanSalaryForegone||0),
    });cashEquivalent=loanCalculation.cashEquivalent;
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Beneficial-loan calculation failed."},{status:422});}
  }
  let accommodationCalculation:ReturnType<typeof calculateLivingAccommodation>|null=null;
  if(livingAccommodation){
    try{accommodationCalculation=calculateLivingAccommodation({
      taxYear,annualValue:Number(input.accommodationAnnualValue),providerRent:Number(input.accommodationProviderRent),
      propertyCost:Number(input.accommodationPropertyCost),improvements:Number(input.accommodationImprovements||0),
      employeeCapitalContribution:Number(input.accommodationEmployeeCapital||0),employeeRent:Number(input.accommodationEmployeeRent||0),
      availableDays:Number(input.accommodationAvailableDays),sharedEmployees:Number(input.accommodationSharedEmployees||1),
      salaryForegone:Number(input.accommodationSalaryForegone||0),
    });cashEquivalent=accommodationCalculation.cashEquivalent;
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Living-accommodation calculation failed."},{status:422});}
  }
  const normalized={
    category,p11dSection:classification.section,nicTreatment,providedDate,description,cashEquivalent:round(cashEquivalent),payrolled:nicTreatment==="exempt"?false:Boolean(input.payrolled),
    benefitEvent:companyCar?String(input.benefitEvent):null,availableFrom:companyCar||companyVan?String(input.availableFrom):null,
    availableTo:(companyCar||companyVan)&&input.availableTo?String(input.availableTo):null,
    vehicleRegistration:companyCar||companyVan?String(input.vehicleRegistration).trim().toUpperCase():null,
    status:input.status==="reviewed"?"reviewed":"draft",
  };
  if(normalized.status==="reviewed"&&(nicTreatment==="class-1"||normalized.payrolled)){
    const locked=await finalisedBenefitPeriods(db,employerId,taxYear,normalized);
    if(locked.length)return NextResponse.json({error:`This benefit affects finalised Period${locked.length===1?"":"s"} ${locked.join(", ")}. Reopen ${locked.length===1?"that period":"the affected periods"} and recalculate payroll, then prepare an Additional FPS for any period whose FPS HMRC already accepted.`,affectedPeriods:locked},{status:409});
  }
  const existingBenefits=await db.select().from(expensesBenefits).where(and(eq(expensesBenefits.employeeId,employee.id),eq(expensesBenefits.taxYear,taxYear)));
  const duplicate=existingBenefits.find(item=>
    item.category===normalized.category&&String(item.description||"")===normalized.description&&
    round(item.cashEquivalent)===normalized.cashEquivalent&&item.payrolled===normalized.payrolled&&
    (item.p11dSection||classification.section)===normalized.p11dSection&&(item.nicTreatment||"class-1a")===normalized.nicTreatment&&
    (item.providedDate||null)===normalized.providedDate&&
    (item.benefitEvent||null)===normalized.benefitEvent&&(item.availableFrom||null)===normalized.availableFrom&&
    (item.availableTo||null)===normalized.availableTo&&(item.vehicleRegistration||null)===normalized.vehicleRegistration&&
    item.status===normalized.status
  );
  if(duplicate)return NextResponse.json({error:"An identical benefit record already exists for this employee and tax year.",benefitId:duplicate.id},{status:409});
  const [created]=await db.insert(expensesBenefits).values({
    employeeId:employee.id,taxYear,...normalized,class1aNic:nicTreatment==="class-1a"?(carCalculation?.class1aNic??vanCalculation?.class1aNic??loanCalculation?.class1aNic??accommodationCalculation?.class1aNic??class1aForBenefit(cashEquivalent,nicTreatment)):0,
    makeModel:companyCar||companyVan?String(input.makeModel||"").trim()||null:null,
    fuelType:companyCar?String(input.fuelType||"").trim()||null:companyVan?(input.zeroEmission?"Electric":"Combustion"):null,
    firstRegistered:companyCar&&input.firstRegistered?String(input.firstRegistered):null,
    co2Emissions:companyCar?Math.max(0,Math.floor(Number(input.co2Emissions||0))):null,
    zeroEmissionMileage:companyCar?Math.max(0,Math.floor(Number(input.zeroEmissionMileage||0))):null,
    listPrice:companyCar?Math.max(0,Number(input.listPrice||0)):null,
    capitalContributions:companyCar?Math.max(0,Number(input.capitalContributions||0)):null,
    privateUseContribution:companyCar||companyVan?Math.max(0,Number(input.privateUseContribution||0)):null,
    vanUseType:companyVan?String(input.vanUseType):null,
    vanFuelProvided:companyVan?Boolean(input.vanFuelProvided):null,
    vanFuelRepaid:companyVan?Boolean(input.vanFuelRepaid):null,
    vanSharedEmployees:companyVan?Math.floor(Number(input.vanSharedEmployees||1)):null,
    loanOpeningBalance:beneficialLoan?Number(input.loanOpeningBalance):null,
    loanClosingBalance:beneficialLoan?Number(input.loanClosingBalance):null,
    loanMaximumAggregateBalance:beneficialLoan?Number(input.loanMaximumAggregateBalance):null,
    loanWholeMonths:beneficialLoan?Number(input.loanWholeMonths):null,
    loanInterestPaid:beneficialLoan?Number(input.loanInterestPaid||0):null,
    loanSalaryForegone:beneficialLoan?Number(input.loanSalaryForegone||0):null,
    accommodationAnnualValue:livingAccommodation?Number(input.accommodationAnnualValue):null,
    accommodationProviderRent:livingAccommodation?Number(input.accommodationProviderRent):null,
    accommodationPropertyCost:livingAccommodation?Number(input.accommodationPropertyCost):null,
    accommodationImprovements:livingAccommodation?Number(input.accommodationImprovements||0):null,
    accommodationEmployeeCapital:livingAccommodation?Number(input.accommodationEmployeeCapital||0):null,
    accommodationEmployeeRent:livingAccommodation?Number(input.accommodationEmployeeRent||0):null,
    accommodationAvailableDays:livingAccommodation?Number(input.accommodationAvailableDays):null,
    accommodationSharedEmployees:livingAccommodation?Number(input.accommodationSharedEmployees||1):null,
    accommodationSalaryForegone:livingAccommodation?Number(input.accommodationSalaryForegone||0):null,
    replacesBenefitId,
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"created",entityType:"expense-benefit",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json({...created,companyCarCalculation:carCalculation,companyVanCalculation:vanCalculation,beneficialLoanCalculation:loanCalculation,livingAccommodationCalculation:accommodationCalculation},{status:201});
}

export async function PUT(request:Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON benefit review object is required."},{status:400});
  const db=getDb(),employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [owned]=await db.select({id:expensesBenefits.id,employeeId:expensesBenefits.employeeId,taxYear:expensesBenefits.taxYear,status:expensesBenefits.status,nicTreatment:expensesBenefits.nicTreatment,payrolled:expensesBenefits.payrolled,cashEquivalent:expensesBenefits.cashEquivalent,availableFrom:expensesBenefits.availableFrom,availableTo:expensesBenefits.availableTo,providedDate:expensesBenefits.providedDate,confidential:employees.confidential}).from(expensesBenefits).innerJoin(employees,eq(expensesBenefits.employeeId,employees.id))
    .where(and(eq(expensesBenefits.id,Number(input.id)),eq(employees.employerId,employerId))).limit(1);
  if(!owned||owned.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Benefit was not found for this employer."},{status:404});
  if(input.action==="void"){
    if(owned.status==="voided")return NextResponse.json({error:"Benefit is already voided."},{status:409});
    if(owned.status==="reviewed"&&(owned.nicTreatment==="class-1"||owned.payrolled)){
      const locked=await finalisedBenefitPeriods(db,employerId,owned.taxYear,owned);
      if(locked.length)return NextResponse.json({error:`This benefit is already reflected in finalised Period${locked.length===1?"":"s"} ${locked.join(", ")}. Reopen ${locked.length===1?"that period":"the affected periods"}, void the record, recalculate payroll and prepare an Additional FPS where HMRC accepted the original FPS.`,affectedPeriods:locked},{status:409});
    }
    const reason=String(input.reason||"").trim();
    if(reason.length<5||reason.length>500)return NextResponse.json({error:"Enter a correction reason between 5 and 500 characters."},{status:422});
    const now=new Date().toISOString();
    const [updated]=await db.update(expensesBenefits).set({status:"voided",voidReason:reason,voidedAt:now,updatedAt:now}).where(eq(expensesBenefits.id,owned.id)).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"voided",entityType:"expense-benefit",entityId:String(owned.id),before:JSON.stringify(owned),after:JSON.stringify(updated)});
    return NextResponse.json({...updated,finalisedPayrollPreserved:true});
  }
  const status=input.status==="reviewed"?"reviewed":"draft";
  if(owned.status==="voided")return NextResponse.json({error:"A voided benefit cannot be returned to review. Create a replacement record instead."},{status:409});
  if(status===owned.status)return NextResponse.json({error:`Benefit is already ${status}.`},{status:409});
  const [updated]=await db.update(expensesBenefits).set({status,updatedAt:new Date().toISOString()}).where(eq(expensesBenefits.id,owned.id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:`marked:${status}`,entityType:"expense-benefit",entityId:String(owned.id),before:JSON.stringify(owned),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
