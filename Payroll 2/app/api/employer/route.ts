import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerMemberships, employers, employerSettings, payPeriods, submissions } from "../../../db/schema";
import { currentAdmin, requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { validateEmployerImportRows } from "../../../lib/employer-import";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";
import { normalisePayslipDesign, validPayslipLogo, validatePayslipDesign } from "../../../lib/payslip-design";

const nlw2026=12.71;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanUtr=(value:unknown)=>String(value||"").replace(/\s/g,"");
const clean=(value:unknown)=>String(value??"").trim();
const payePattern=/^\d{3}\/[A-Z0-9]{1,10}$/i;
const accountsOfficePattern=/^\d{3}P[A-Z0-9]\d{8}$/i;
const companyNumberPattern=/^(?:[A-Z]{2}\d{6}|\d{8})$/i;
const dateKeys=["finalFpsDue","epsDue","p60Due","p11dDue"] as const;
const accountingCodeKeys=[
  "accountingDefaultWagesCode","accountingControlCode","accountingPayeCode","accountingNicCode",
  "accountingPensionCode","accountingOtherDeductionsCode","accountingEmployerNicExpenseCode","accountingEmployerPensionExpenseCode",
] as const;
const validDate=(value:unknown)=>{
  const text=clean(value);if(!text)return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const date=new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===text;
};
const validTaxYear=(value:unknown)=>{
  const match=/^(\d{4})\/(\d{2})$/.exec(clean(value));
  return Boolean(match&&Number(match[2])===(Number(match[1])+1)%100);
};
const finiteInRange=(value:unknown,min:number,max:number)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
const optional=(value:unknown)=>clean(value)||null;

function validationError(input:any) {
  if(!clean(input.name))return "Employer name is required.";
  if(input.payeReference&&!payePattern.test(clean(input.payeReference)))return "Enter a PAYE reference in the format 123/AB456.";
  if(input.accountsOfficeReference&&!accountsOfficePattern.test(clean(input.accountsOfficeReference)))return "Enter a valid 13-character Accounts Office reference.";
  if(input.companyNumber&&!companyNumberPattern.test(clean(input.companyNumber).replace(/\s/g,"")))return "Enter a valid 8-character company number.";
  if(input.cisContractor&&!/^\d{10}$/.test(cleanUtr(input.cisUtr)))return "A CIS contractor requires a valid 10-digit UTR.";
  if(!validTaxYear(input.taxYear))return "Enter a consecutive tax year in the format 2026/27.";
  let frequency;
  try{frequency=payrollFrequencyRule(input.payFrequency).frequency;}catch(error){return error instanceof Error?error.message:"Select a supported pay frequency.";}
  if(frequency!=="monthly"){
    if(!clean(input.firstPayDate))return "A first pay date is required for weekly, fortnightly and four-weekly payroll.";
    try{scheduledPayPeriods(clean(input.taxYear),frequency,clean(input.firstPayDate));}
    catch(error){return error instanceof Error?error.message:"The first pay date is invalid.";}
  }
  if(!["hourly","daily","period"].includes(input.typicalPayBasis))return "Select a supported typical pay basis.";
  if(!["active","inactive","onboarding","archived"].includes(input.clientStatus))return "Select a supported client status.";
  if(input.colourReference&&!/^#[0-9a-f]{6}$/i.test(clean(input.colourReference)))return "Tracking colour must be a six-digit hexadecimal colour.";
  if(!/^#[0-9a-f]{6}$/i.test(clean(input.reportAccentColour||"#087b79")))return "Report accent colour must be a six-digit hexadecimal colour.";
  if(!["standard","preprinted","plain"].includes(clean(input.reportStationeryMode||"standard")))return "Select a supported report stationery mode.";
  if(clean(input.reportHeaderText).length>100||clean(input.reportFooterText).length>240)return "Report header or footer text is too long.";
  if(!validPayslipLogo(input.logoUrl))return "Payslip logos must be PNG, JPEG or WebP images no larger than 500 KB.";
  const payslipDesignError=validatePayslipDesign(input.payslipDesign||{});if(payslipDesignError)return payslipDesignError;
  if(!["employee-postcode","employee-ni-last4","manual-per-document"].includes(input.documentPasswordStrategy))return "Select a supported document password strategy.";
  if(input.primaryContactEmail&&!emailPattern.test(clean(input.primaryContactEmail)))return "Enter a valid primary contact email.";
  if(input.alternateContactEmail&&!emailPattern.test(clean(input.alternateContactEmail)))return "Enter a valid alternative contact email.";
  const bankValues=[input.bankName,input.bankAccountName,input.bankSortCode,input.bankAccountNumber].map(clean);
  if(bankValues.some(Boolean)&&(!clean(input.bankAccountName)||!/^\d{6}$/.test(clean(input.bankSortCode).replace(/\D/g,""))||
    !/^\d{8}$/.test(clean(input.bankAccountNumber).replace(/\D/g,""))))
    return "Employer bank details require an account name, 6-digit sort code and 8-digit account number.";
  if(clean(input.employerNotes).length>4000)return "Employer notes must contain no more than 4,000 characters.";
  for(const key of accountingCodeKeys)if(!/^[A-Za-z0-9._-]{1,20}$/.test(clean(input[key])))
    return "Accounting nominal codes must contain 1 to 20 letters, numbers, dots, underscores or hyphens.";
  for(const key of dateKeys)if(!validDate(input[key]))return `${key} must be a real calendar date.`;
  if(!finiteInRange(input.apprenticeshipLevyAllowance,0,15000))return "Apprenticeship Levy allowance must be between £0 and £15,000.";
  if(!finiteInRange(input.typicalAnnualLeaveDays,0,366))return "Typical annual leave must be between 0 and 366 days.";
  if(!finiteInRange(input.typicalWeeklyHours,0,168))return "Typical weekly hours must be between 0 and 168.";
  if(!finiteInRange(input.minimumHourlyRate,0,100000))return "Default minimum hourly rate must be a valid non-negative amount.";
  if(!Number.isInteger(Number(input.nextWorksNumber))||Number(input.nextWorksNumber)<1||Number(input.nextWorksNumber)>999999999)return "Next works number must be a whole number between 1 and 999999999.";
  return null;
}

function warnings(input:any) {
  const result:string[]=[];
  if(Number(input.minimumHourlyRate)<nlw2026)result.push(`Default hourly rate is below the 2026/27 National Living Wage of £${nlw2026.toFixed(2)}.`);
  if(!input.payeReference)result.push("PAYE reference is missing.");
  if(!input.accountsOfficeReference)result.push("Accounts Office reference is missing.");
  if(!input.preferredCredentialLabel)result.push("No Government Gateway credential reference is selected. Secrets must be held in the deployment credential vault.");
  if(input.cisContractor&&!/^\d{10}$/.test(cleanUtr(input.cisUtr)))result.push("CIS contractor UTR must contain 10 digits.");
  if(input.primaryContactEmail&&!emailPattern.test(String(input.primaryContactEmail)))result.push("Primary contact email format is invalid.");
  return result;
}

export async function GET(request:Request) {
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||1),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const [settings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const merged={...employer,...settings,employerId};
  return NextResponse.json({employer:merged,warnings:warnings(merged)});
}

export async function POST(request:Request) {
  const input=await readJsonObject(request);
  if(!input)return NextResponse.json({error:"A JSON employer setup object is required."},{status:400});
  const user=await currentAdmin(request);
  if(!user)return NextResponse.json({error:"Administrator sign-in is required."},{status:401});
  const db=getDb();
  const memberships=await db.select().from(employerMemberships).where(and(eq(employerMemberships.userId,user.userId),eq(employerMemberships.status,"active")));
  if(!memberships.some(item=>["owner","admin"].includes(item.role)))
    return NextResponse.json({error:"An existing owner or administrator may create an employer client."},{status:403});
  if(input.action==="import-employers"){
    if(!Array.isArray(input.rows))return NextResponse.json({error:"Employer import rows are required."},{status:400});
    const existing=await db.select({
      name:employers.name,payeReference:employers.payeReference,accountsOfficeReference:employers.accountsOfficeReference,
    }).from(employers);
    const validation=validateEmployerImportRows(input.rows,{
      names:existing.map(item=>item.name),
      payeReferences:existing.map(item=>item.payeReference||""),
      accountsOfficeReferences:existing.map(item=>item.accountsOfficeReference||""),
    });
    if(validation.errors.length)return NextResponse.json({
      error:"Employer CSV failed validation. No clients were imported.",errors:validation.errors,
    },{status:422});
    const createdIds:number[]=[];
    try{
      for(const row of validation.prepared){
        const [employer]=await db.insert(employers).values({
          name:row.name,legalName:optional(row.legalName),address:optional(row.address),postcode:optional(row.postcode),
          payeReference:optional(row.payeReference),accountsOfficeReference:optional(row.accountsOfficeReference),
          companyNumber:optional(row.companyNumber),cisUtr:optional(row.cisUtr),payFrequency:"monthly",taxYear:row.taxYear,
          smallEmployersRelief:row.smallEmployersRelief,employmentAllowance:row.employmentAllowance,
          apprenticeshipLevy:row.apprenticeshipLevy,apprenticeshipLevyAllowance:15000,
          cisContractor:row.cisContractor,status:row.clientStatus==="inactive"||row.clientStatus==="archived"?"inactive":"active",
        }).returning();
        createdIds.push(employer.id);
        await db.batch([
          db.insert(employerSettings).values({
            employerId:employer.id,typicalPayBasis:row.typicalPayBasis,typicalAnnualLeaveDays:row.typicalAnnualLeaveDays,
            typicalWeeklyHours:row.typicalWeeklyHours,minimumHourlyRate:row.minimumHourlyRate,
            autoWorksNumber:row.autoWorksNumber,nextWorksNumber:row.nextWorksNumber,clientStatus:row.clientStatus,
            managedBy:optional(row.managedBy),colourReference:row.colourReference,
            primaryContactName:optional(row.primaryContactName),primaryContactEmail:optional(row.primaryContactEmail),
            primaryContactPhone:optional(row.primaryContactPhone),documentPasswordStrategy:row.documentPasswordStrategy,
          }),
          db.insert(employerMemberships).values({employerId:employer.id,userId:user.userId,role:"owner",canViewConfidential:true,status:"active"}),
          db.insert(auditLog).values({
            employerId:employer.id,actor:user.displayName,action:"imported:employer-client",entityType:"employer",entityId:String(employer.id),
            after:JSON.stringify({rowNumber:row.rowNumber,name:row.name,taxYear:row.taxYear,payFrequency:"monthly",cisContractor:row.cisContractor}),
          }),
        ]);
      }
    }catch(error){
      if(createdIds.length){
        await db.delete(auditLog).where(inArray(auditLog.employerId,createdIds));
        await db.delete(employerMemberships).where(inArray(employerMemberships.employerId,createdIds));
        await db.delete(employerSettings).where(inArray(employerSettings.employerId,createdIds));
        await db.delete(employers).where(inArray(employers.id,createdIds));
      }
      return NextResponse.json({error:"Employer import failed and every client created by this file was rolled back."},{status:500});
    }
    return NextResponse.json({
      imported:createdIds.length,
      employers:validation.prepared.map((row,index)=>({id:createdIds[index],name:row.name,taxYear:row.taxYear,cisContractor:row.cisContractor})),
    },{status:201});
  }
  const setup={
    name:clean(input.name),legalName:clean(input.legalName)||clean(input.name),address:clean(input.address),postcode:clean(input.postcode),
    payeReference:clean(input.payeReference),accountsOfficeReference:clean(input.accountsOfficeReference),companyNumber:clean(input.companyNumber),
    cisUtr:cleanUtr(input.cisUtr),cisContractor:input.cisContractor===true,
    taxYear:clean(input.taxYear)||"2026/27",payFrequency:clean(input.payFrequency)||"monthly",
    firstPayDate:clean(input.firstPayDate),
    typicalPayBasis:"period",clientStatus:"onboarding",documentPasswordStrategy:"employee-postcode",
    apprenticeshipLevyAllowance:15000,typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,minimumHourlyRate:nlw2026,nextWorksNumber:1,
    accountingDefaultWagesCode:"WAGES",accountingControlCode:"CTRL",accountingPayeCode:"TAX",accountingNicCode:"NIC",
    accountingPensionCode:"PENS",accountingOtherDeductionsCode:"OTHER",
    accountingEmployerNicExpenseCode:"ERNIC",accountingEmployerPensionExpenseCode:"ERPENS",
  };
  const error=validationError(setup);if(error)return NextResponse.json({error},{status:422});
  const [duplicate]=await db.select({id:employers.id}).from(employers).where(eq(employers.name,setup.name)).limit(1);
  if(duplicate)return NextResponse.json({error:"An employer with this name already exists."},{status:409});
  const [employer]=await db.insert(employers).values({
    name:setup.name,legalName:optional(setup.legalName),address:optional(setup.address),postcode:optional(setup.postcode),
    payeReference:optional(setup.payeReference)?.toUpperCase()||null,accountsOfficeReference:optional(setup.accountsOfficeReference)?.toUpperCase()||null,
    companyNumber:clean(setup.companyNumber).replace(/\s/g,"").toUpperCase()||null,cisUtr:setup.cisUtr||null,
    payFrequency:setup.payFrequency,taxYear:setup.taxYear,cisContractor:setup.cisContractor,status:"active",
  }).returning();
  try{
    await db.batch([
      db.insert(employerSettings).values({
        employerId:employer.id,typicalPayBasis:"period",typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,minimumHourlyRate:nlw2026,
        autoWorksNumber:true,nextWorksNumber:1,firstPayDate:optional(setup.firstPayDate),clientStatus:"onboarding",colourReference:"#087b79",documentPasswordStrategy:"employee-postcode",
      }),
      db.insert(employerMemberships).values({employerId:employer.id,userId:user.userId,role:"owner",canViewConfidential:true,status:"active"}),
      db.insert(auditLog).values({employerId:employer.id,actor:user.displayName,action:"created:employer-client",entityType:"employer",entityId:String(employer.id),after:JSON.stringify({name:employer.name,taxYear:employer.taxYear,payFrequency:employer.payFrequency,cisContractor:employer.cisContractor})}),
    ]);
  }catch(error){
    await db.delete(employers).where(eq(employers.id,employer.id));
    throw error;
  }
  return NextResponse.json({employer,role:"owner",warnings:warnings({...employer,...setup})},{status:201});
}

export async function PUT(request:Request) {
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON employer settings object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const [before]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!before)return NextResponse.json({error:"Employer was not found."},{status:404});
  const error=validationError(input);if(error)return NextResponse.json({error},{status:422});
  const [beforeSettings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const scheduleChanged=before.payFrequency!==clean(input.payFrequency)||before.taxYear!==clean(input.taxYear)||
    clean(beforeSettings?.firstPayDate)!==clean(input.firstPayDate);
  if(scheduleChanged){
    const [existingPeriod]=await db.select({id:payPeriods.id}).from(payPeriods).where(eq(payPeriods.employerId,employerId)).limit(1);
    if(existingPeriod)return NextResponse.json({error:"Pay frequency, tax year and first pay date cannot be changed after a payroll period exists. Create a new employer payroll or remove the unprocessed setup period first."},{status:409});
  }
  const [employer]=await db.update(employers).set({
    name:clean(input.name),legalName:optional(input.legalName),address:optional(input.address),postcode:optional(input.postcode),
    payeReference:optional(input.payeReference)?.toUpperCase()||null,accountsOfficeReference:optional(input.accountsOfficeReference)?.toUpperCase()||null,companyNumber:clean(input.companyNumber).replace(/\s/g,"").toUpperCase()||null,cisUtr:cleanUtr(input.cisUtr)||null,
    payFrequency:clean(input.payFrequency),
    taxYear:clean(input.taxYear),smallEmployersRelief:input.smallEmployersRelief===true,
    employmentAllowance:input.employmentAllowance===true,apprenticeshipLevy:input.apprenticeshipLevy===true,
    apprenticeshipLevyAllowance:Number(input.apprenticeshipLevyAllowance),
    cisContractor:input.cisContractor===true,status:input.status==="inactive"?"inactive":"active",
    updatedAt:new Date().toISOString(),
  }).where(eq(employers.id,employerId)).returning();
  const values={
    employerId,logoUrl:optional(input.logoUrl),payslipDesign:JSON.stringify(normalisePayslipDesign(input.payslipDesign||{})),typicalPayBasis:["hourly","daily","period"].includes(input.typicalPayBasis)?input.typicalPayBasis:"period",
    typicalAnnualLeaveDays:Number(input.typicalAnnualLeaveDays),typicalWeeklyHours:Number(input.typicalWeeklyHours),
    minimumHourlyRate:Number(input.minimumHourlyRate),autoWorksNumber:input.autoWorksNumber===true,
    nextWorksNumber:Number(input.nextWorksNumber),firstPayDate:optional(input.firstPayDate),withholdTaxRefundZeroPay:input.withholdTaxRefundZeroPay===true,
    noSspAlternateScheme:input.noSspAlternateScheme===true,optOutCreditChecks:input.optOutCreditChecks===true,
    preferredCredentialLabel:optional(input.preferredCredentialLabel),primaryContactName:optional(input.primaryContactName),
    primaryContactEmail:optional(input.primaryContactEmail)?.toLowerCase()||null,primaryContactPhone:optional(input.primaryContactPhone),
    alternateContactName:optional(input.alternateContactName),alternateContactEmail:optional(input.alternateContactEmail)?.toLowerCase()||null,managedBy:optional(input.managedBy),
    bankName:optional(input.bankName),bankAccountName:optional(input.bankAccountName),
    bankSortCode:clean(input.bankSortCode).replace(/\D/g,"")||null,bankAccountNumber:clean(input.bankAccountNumber).replace(/\D/g,"")||null,
    employerNotes:optional(input.employerNotes),reportAccentColour:clean(input.reportAccentColour)||"#087b79",
    reportHeaderText:optional(input.reportHeaderText),reportFooterText:optional(input.reportFooterText),
    reportStationeryMode:["standard","preprinted","plain"].includes(input.reportStationeryMode)?input.reportStationeryMode:"standard",
    clientStatus:input.clientStatus,colourReference:clean(input.colourReference)||"#087b79",
    finalFpsDue:optional(input.finalFpsDue),epsDue:optional(input.epsDue),p60Due:optional(input.p60Due),p11dDue:optional(input.p11dDue),
    documentPasswordStrategy:["employee-postcode","employee-ni-last4","manual-per-document"].includes(input.documentPasswordStrategy)?input.documentPasswordStrategy:"employee-postcode",
    accountingDefaultWagesCode:clean(input.accountingDefaultWagesCode).toUpperCase(),
    accountingControlCode:clean(input.accountingControlCode).toUpperCase(),
    accountingPayeCode:clean(input.accountingPayeCode).toUpperCase(),
    accountingNicCode:clean(input.accountingNicCode).toUpperCase(),
    accountingPensionCode:clean(input.accountingPensionCode).toUpperCase(),
    accountingOtherDeductionsCode:clean(input.accountingOtherDeductionsCode).toUpperCase(),
    accountingEmployerNicExpenseCode:clean(input.accountingEmployerNicExpenseCode).toUpperCase(),
    accountingEmployerPensionExpenseCode:clean(input.accountingEmployerPensionExpenseCode).toUpperCase(),
    updatedAt:new Date().toISOString(),
  };
  const [existing]=await db.select({employerId:employerSettings.employerId}).from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const [settings]=existing
    ?await db.update(employerSettings).set(values).where(eq(employerSettings.employerId,employerId)).returning()
    :await db.insert(employerSettings).values(values).returning();
  if(scheduleChanged)await db.update(employees).set({reportedPayFrequency:clean(input.payFrequency),updatedAt:new Date().toISOString()}).where(eq(employees.employerId,employerId));
  const merged={...employer,...settings};
  const cisIdentityChanged=["name","payeReference","accountsOfficeReference","cisUtr","cisContractor"].some(key=>(before as any)[key]!==(employer as any)[key]);
  const rtiIdentityChanged=["payeReference","accountsOfficeReference"].some(key=>(before as any)[key]!==(employer as any)[key]);
  let supersededCisArtifacts=0;
  let supersededRtiPackages=0;
  if(cisIdentityChanged){
    const artifacts=await db.select().from(submissions).where(eq(submissions.employerId,employerId));
    for(const artifact of artifacts){
      if(!["CIS300","CIS-PDS"].includes(artifact.type)||!["validated","test-ready","issued"].includes(artifact.status))continue;
      await db.update(submissions).set({status:"superseded",response:"Superseded because the employer CIS registration or document identity changed.",updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,artifact.id),eq(submissions.employerId,employerId)));
      supersededCisArtifacts++;
    }
  }
  if(rtiIdentityChanged){
    const packages=await db.select().from(submissions).where(eq(submissions.employerId,employerId));
    for(const filing of packages){
      if(!["FPS","EPS","NVR","Additional FPS","EXB"].includes(filing.type)||!["validated","test-ready"].includes(filing.status))continue;
      await db.update(submissions).set({
        status:"superseded",response:"Superseded because the employer PAYE or Accounts Office reference changed. Regenerate before filing.",updatedAt:new Date().toISOString(),
      }).where(and(eq(submissions.id,filing.id),eq(submissions.employerId,employerId),eq(submissions.status,filing.status)));
      supersededRtiPackages++;
    }
  }
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"updated",entityType:"employer-settings",entityId:String(employerId),before:JSON.stringify({...before,...beforeSettings}),after:JSON.stringify(merged)});
  if(supersededRtiPackages||supersededCisArtifacts)await db.insert(auditLog).values({
    employerId,actor:access.user.displayName,action:"superseded:employer-identity-packages",entityType:"employer",entityId:String(employerId),
    after:JSON.stringify({supersededRtiPackages,supersededCisArtifacts,rtiIdentityChanged,cisIdentityChanged}),
  });
  return NextResponse.json({employer:merged,warnings:warnings(merged),supersededCisArtifacts,supersededRtiPackages});
}
