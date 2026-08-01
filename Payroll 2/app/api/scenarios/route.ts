import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, departments, employees, employerMemberships, employers, employerSettings, pensionSchemes, subcontractors } from "../../../db/schema";
import { currentAdmin } from "../../../lib/admin-auth";
import { scenarioReport } from "../../../lib/payroll-scenarios";
import { readJsonObject } from "../../../lib/request-body";
import { sampleDepartments, sampleEmployeeProfiles, sampleSubcontractors } from "../../../lib/sample-payroll";

export async function GET() {
  return NextResponse.json(scenarioReport());
}

export async function POST(request:Request){
  const input=await readJsonObject(request);
  if(!input||input.action!=="create-isolated-sample"||input.confirmation!=="CREATE ISOLATED SAMPLE")
    return NextResponse.json({error:"Confirm creation of an isolated sample payroll."},{status:422});
  const user=await currentAdmin(request);
  if(!user)return NextResponse.json({error:"Administrator sign-in is required."},{status:401});
  const db=getDb();
  const memberships=await db.select().from(employerMemberships).where(and(
    eq(employerMemberships.userId,user.userId),eq(employerMemberships.status,"active"),
  ));
  if(!memberships.some(item=>["owner","admin"].includes(item.role)))
    return NextResponse.json({error:"Only an existing owner or administrator may create sample payroll data."},{status:403});

  const createdAt=new Date().toISOString(),runKey=createdAt.replace(/\D/g,"").slice(0,14);
  const [employer]=await db.insert(employers).values({
    name:`PayFlow Demonstration ${runKey}`,legalName:`PayFlow Demonstration ${runKey} Limited`,
    address:"1 Demonstration Way, London",postcode:"EC1A 1AA",payeReference:"999/DEMO26",
    accountsOfficeReference:"999PD00000000",companyNumber:"00000000",cisUtr:"1000000000",
    payFrequency:"monthly",taxYear:"2026/27",smallEmployersRelief:true,employmentAllowance:true,
    apprenticeshipLevy:false,apprenticeshipLevyAllowance:15000,cisContractor:true,status:"active",
    createdAt,updatedAt:createdAt,
  }).returning();

  try{
    const departmentRows:{id:number;name:string}[]=[];
    for(const department of sampleDepartments){
      const [created]=await db.insert(departments).values({employerId:employer.id,...department}).returning({id:departments.id,name:departments.name});
      departmentRows.push(created);
    }
    const departmentIds=new Map(departmentRows.map(item=>[item.name,item.id]));
    const employeeRows=sampleEmployeeProfiles().map((profile,index)=>({
      employerId:employer.id,departmentId:departmentIds.get(profile.department)||null,payrollId:profile.payrollId,
      worksNumber:String(index+1).padStart(4,"0"),firstName:profile.firstName,lastName:profile.lastName,
      dateOfBirth:profile.dateOfBirth,gender:profile.gender,address:profile.address,postcode:profile.postcode,
      email:profile.email,jobTitle:profile.jobTitle,startDate:profile.startDate,starterEvidence:profile.starterEvidence,
      starterDeclaration:profile.starterDeclaration,p45LeavingDate:profile.p45LeavingDate||null,
      p45PreviousPay:profile.p45PreviousPay||0,p45PreviousTax:profile.p45PreviousTax||0,
      p60TaxYear:profile.p60TaxYear||null,p60ReferenceOnly:Boolean(profile.p60ReferenceOnly),taxCode:profile.taxCode,
      week1Month1:Boolean(profile.week1Month1),niCategory:profile.niCategory,director:Boolean(profile.director),
      directorStart:profile.directorStart||null,alternativeDirectorNic:Boolean(profile.alternativeDirectorNic),
      noSecondaryNic:Boolean(profile.noSecondaryNic),studentLoanPlan:profile.studentLoanPlan||null,
      postgraduateLoan:Boolean(profile.postgraduateLoan),payBasis:"period",annualSalary:profile.annualSalary,
      contractedHours:profile.contractedHours,workingDaysPerWeek:5,minimumWageCategory:profile.minimumWageCategory||"age-based",
      apprenticeshipStartDate:profile.apprenticeshipStartDate||null,annualLeaveDays:28,paymentMethod:"credit-transfer",
      bankName:"PayFlow Demo Bank",accountName:`${profile.firstName} ${profile.lastName}`,sortCode:"000000",accountNumber:String(index+1).padStart(8,"0"),
      irregularPayment:Boolean(profile.irregularPayment),zeroPayFpsExclusion:Boolean(profile.zeroPayFpsExclusion),
      reportedPayFrequency:"monthly",workplacePostcode:"EC1A 1AA",paymentToBody:Boolean(profile.paymentToBody),
      trivialCommutation:Boolean(profile.trivialCommutation),flexibleDrawdown:Boolean(profile.flexibleDrawdown),
      employeePortal:Boolean(profile.employeePortal),portalCanEditBank:Boolean(profile.portalCanEditBank),
      confidential:Boolean(profile.confidential),hrNotes:profile.confidential?"Demonstration confidential employee record.":null,
      hrNotesConfidential:Boolean(profile.confidential),status:"active",createdAt,updatedAt:createdAt,
    }));
    const sampleCreationOperations=[
      db.insert(employerSettings).values({
        employerId:employer.id,typicalPayBasis:"period",typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,
        minimumHourlyRate:12.71,autoWorksNumber:true,nextWorksNumber:21,firstPayDate:"2026-04-30",
        clientStatus:"onboarding",managedBy:user.displayName,colourReference:"#7c3aed",
        primaryContactName:"Demo Payroll Contact",primaryContactEmail:"payroll@demo.payflow.local",
        documentPasswordStrategy:"employee-postcode",reportAccentColour:"#7c3aed",
        reportHeaderText:"PAYFLOW DEMONSTRATION — NOT FOR LIVE FILING",
        reportFooterText:"Sample data only. Never submit these identifiers to HMRC or a pension provider.",
        reportStationeryMode:"standard",createdAt,updatedAt:createdAt,
      }),
      db.insert(employerMemberships).values({
        employerId:employer.id,userId:user.userId,role:"owner",canViewConfidential:true,status:"active",createdAt,updatedAt:createdAt,
      }),
      ...employeeRows.map(employee=>db.insert(employees).values(employee)),
      db.insert(pensionSchemes).values({
        employerId:employer.id,provider:"Demonstration provider",schemeName:"PayFlow Demonstration Workplace Pension",
        employerReference:"DEMO-PENSION-2026",employeeRate:5,employerRate:3,earningsBasis:"qualifying",
        taxRelief:"relief-at-source",automaticEnrolmentScheme:true,dutiesStartDate:"2026-04-06",
        nextReenrolmentDate:"2029-04-06",declarationDueDate:"2026-09-05",declarationStatus:"not-filed",
        contributionDueDay:22,status:"active",
      }),
      db.insert(subcontractors).values(sampleSubcontractors.map(item=>({
        employerId:employer.id,address:"1 Demonstration Way, London",postcode:"EC1A 1AA",
        email:"cis@demo.payflow.local",phone:"020 0000 0000",bankDetails:"Demonstration only",
        createdAt,updatedAt:createdAt,...item,
      }))),
      db.insert(auditLog).values({
        employerId:employer.id,actor:user.displayName,action:"created:isolated-sample-payroll",
        entityType:"employer",entityId:String(employer.id),
        after:JSON.stringify({runKey,employees:employeeRows.length,departments:departmentRows.length,subcontractors:sampleSubcontractors.length,taxYear:"2026/27",nonProduction:true}),
        createdAt,
      }),
    ];
    await db.batch(sampleCreationOperations as [any,...any[]]);
    return NextResponse.json({
      created:true,employerId:employer.id,employerName:employer.name,taxYear:"2026/27",
      employees:employeeRows.length,departments:departmentRows.length,subcontractors:sampleSubcontractors.length,
      warning:"This isolated employer contains demonstration identifiers and must never be filed externally.",
    },{status:201});
  }catch(error){
    console.error("Isolated sample payroll creation failed",error);
    await db.delete(auditLog).where(eq(auditLog.employerId,employer.id));
    await db.delete(subcontractors).where(eq(subcontractors.employerId,employer.id));
    await db.delete(pensionSchemes).where(eq(pensionSchemes.employerId,employer.id));
    await db.delete(employees).where(eq(employees.employerId,employer.id));
    await db.delete(employerMemberships).where(eq(employerMemberships.employerId,employer.id));
    await db.delete(employerSettings).where(eq(employerSettings.employerId,employer.id));
    await db.delete(departments).where(eq(departments.employerId,employer.id));
    await db.delete(employers).where(eq(employers.id,employer.id));
    return NextResponse.json({error:"Sample payroll creation failed and every sample record was rolled back."},{status:500});
  }
}
