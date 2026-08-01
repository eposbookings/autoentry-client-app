import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  attachmentOrders, auditLog, departments, employeeChangeRequests, employeePortalInvites, employeePortalSessions,
  employees, employers, employerSettings, expensesBenefits, leaveEvents, payRuns, pensionMemberships, recurringPayItems, submissions,
} from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { isRecognisedPayeTaxCode } from "../../../lib/tax-code";
import { supersedeEmployeePaymentBatches } from "../../../lib/payment-batches";

const niCategories=new Set(["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"]);
const starterEvidenceValues=new Set(["P45 provided","No P45 provided","P60 only","Worked elsewhere this tax year","Secondary employment"]);
const validPayrollId=(value:string)=>value.length>=1&&value.length<=35&&!/[\u0000-\u001f\u007f]/.test(value);
const normalizeGender=(value:unknown)=>{
  const gender=String(value||"").trim().toUpperCase();
  return gender==="M"||gender==="MALE"?"M":gender==="F"||gender==="FEMALE"?"F":null;
};
const normalizeStarterDeclaration=(value:unknown)=>{
  const text=String(value||"").trim().toUpperCase(),code=text.match(/^STATEMENT\s+([ABC])\b/)?.[1];
  if(text.startsWith("NO STATEMENT"))return "No statement – use 0T week 1 / month 1";
  return code==="B"?"Statement B – only job now; worked since 6 April":code==="C"?"Statement C – another job or pension":"Statement A – first job since 6 April";
};
const validIsoDate=(value:unknown)=>{
  const text=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const parsed=Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===text;
};
const employmentStatus=(leavingDate:unknown)=>{
  const date=String(leavingDate||"");
  return date&&date<=new Date().toISOString().slice(0,10)?"leaver":"active";
};
const validateP45OpeningBalances=(input:any,taxYear:string)=>{
  const hasOpeningBalances=Number(input.p45PreviousPay||0)>0||Number(input.p45PreviousTax||0)>0;
  if(hasOpeningBalances&&String(input.starterEvidence)!=="P45 provided")return "Current-year previous pay or tax can only be applied from a P45.";
  if(String(input.starterEvidence)!=="P45 provided"&&!hasOpeningBalances)return null;
  const leavingDate=String(input.p45LeavingDate||"");
  if(!validIsoDate(leavingDate))return "A valid P45 leaving date is required when current-year P45 pay or tax is recorded.";
  const startYear=Number(String(taxYear).slice(0,4));
  if(!Number.isInteger(startYear))return "The employer tax year is invalid.";
  const taxYearStart=`${startYear}-04-06`,taxYearEnd=`${startYear+1}-04-05`;
  if(leavingDate<taxYearStart||leavingDate>taxYearEnd)return `P45 opening pay and tax must come from a leaving date within ${taxYear}.`;
  if(input.startDate&&leavingDate>String(input.startDate))return "The P45 leaving date cannot be after this employment starts.";
  return null;
};
const validateStarterEvidence=(input:any)=>{
  const evidence=starterEvidenceValues.has(String(input.starterEvidence))?String(input.starterEvidence):"No P45 provided";
  const declaration=normalizeStarterDeclaration(input.starterDeclaration);
  if(evidence==="Worked elsewhere this tax year"&&!declaration.startsWith("Statement B"))return "An employee who worked elsewhere this tax year and has no P45 must use starter Statement B.";
  if(evidence==="Secondary employment"&&!declaration.startsWith("Statement C"))return "A secondary employment must use starter Statement C.";
  if(evidence!=="P45 provided"&&declaration.startsWith("Statement B")&&(!/^[SC]?1257L$/.test(String(input.taxCode||"").toUpperCase())||!Boolean(input.week1Month1)))return "Starter Statement B must use emergency code 1257L (or the Scottish/Welsh equivalent) on a week 1/month 1 basis.";
  if(evidence!=="P45 provided"&&declaration.startsWith("Statement C")&&!/^[SC]?BR$/.test(String(input.taxCode||"").toUpperCase()))return "Starter Statement C must use tax code BR (or the Scottish/Welsh equivalent).";
  if(evidence!=="P45 provided"&&declaration.startsWith("No statement")&&(!/^[SC]?0T$/.test(String(input.taxCode||"").toUpperCase())||!Boolean(input.week1Month1)))return "A starter with no declaration must use tax code 0T on a week 1/month 1 basis.";
  if(evidence==="P60 only"&&!Boolean(input.p60ReferenceOnly))return "A P60 is reference-only and cannot replace a current P45; confirm the P60 reference-only declaration.";
  if(Boolean(input.p60ReferenceOnly)){
    const year=String(input.p60TaxYear||"");
    if(!/^\d{4}\/\d{2}$/.test(year)||Number(year.slice(5))!==(Number(year.slice(0,4))+1)%100)return "Enter the tax year shown on the reference-only P60 in YYYY/YY format.";
  }
  return null;
};
const revokeEmployeePortalAccess=async(db:ReturnType<typeof getDb>,employeeId:number)=>{
  const now=new Date().toISOString();
  await db.update(employeePortalSessions).set({revokedAt:now,updatedAt:now}).where(and(eq(employeePortalSessions.employeeId,employeeId),isNull(employeePortalSessions.revokedAt)));
  await db.update(employeePortalInvites).set({usedAt:now,updatedAt:now}).where(and(eq(employeePortalInvites.employeeId,employeeId),isNull(employeePortalInvites.usedAt)));
};
const validateBankAndPortalEvidence=(input:any)=>{
  const sortCode=String(input.sortCode||"").replace(/\D/g,""),accountNumber=String(input.accountNumber||"").replace(/\D/g,"");
  const hasBankEvidence=Boolean(input.bankName||input.accountName||input.sortCode||input.accountNumber);
  if(hasBankEvidence&&(!String(input.accountName||"").trim()||sortCode.length!==6||accountNumber.length!==8))
    return "Bank details must include the account name, a 6-digit sort code and an 8-digit account number.";
  if(Boolean(input.portalCanEditBank)&&!Boolean(input.employeePortal))
    return "Enable employee portal access before allowing employee bank-detail requests.";
  return null;
};
const validateEmployeeInput=(input:any)=>{
  if(input.reportedPayFrequency&&!["monthly","weekly","fortnightly","four-weekly"].includes(String(input.reportedPayFrequency)))
    return "Reported pay frequency must be monthly, weekly, fortnightly or four-weekly.";
  const dates=[["Date of birth",input.dateOfBirth],["Employment start date",input.startDate],["Leaving date",input.leavingDate],["P45 leaving date",input.p45LeavingDate],["Directorship start date",input.directorStart],["Directorship end date",input.directorEnd],["Apprenticeship start date",input.apprenticeshipStartDate]] as const;
  const invalid=dates.find(([,value])=>value&&!validIsoDate(value));
  if(invalid)return `${invalid[0]} must be a valid calendar date.`;
  if(input.dateOfBirth&&String(input.dateOfBirth)>new Date().toISOString().slice(0,10))return "Date of birth cannot be in the future.";
  if(input.gender&&!normalizeGender(input.gender))return "Gender for RTI must be Male or Female.";
  if(input.startDate&&input.leavingDate&&String(input.leavingDate)<String(input.startDate))return "Leaving date cannot be before the employment start date.";
  const numericFields=[["Annual salary",input.annualSalary],["Hourly rate",input.hourlyRate],["Daily rate",input.dailyRate],["Contracted weekly hours",input.contractedHours],["Annual leave entitlement",input.annualLeaveDays],["Working days per week",input.workingDaysPerWeek],["P45 previous pay",input.p45PreviousPay],["P45 previous tax",input.p45PreviousTax]] as const;
  const invalidNumber=numericFields.find(([,value])=>value!==undefined&&value!==null&&value!==""&&!Number.isFinite(Number(value)));
  if(invalidNumber)return `${invalidNumber[0]} must be a valid number.`;
  if(input.director){
    if(!input.directorStart)return "A directorship start date is required when the employee is a director.";
    if(input.directorEnd&&String(input.directorEnd)<String(input.directorStart))return "Directorship end date cannot be before the directorship start date.";
    if(input.startDate&&String(input.directorStart)<String(input.startDate))return "Directorship cannot start before the employment start date.";
    if(input.leavingDate&&input.directorEnd&&String(input.directorEnd)>String(input.leavingDate))return "Directorship cannot end after the employment leaving date.";
  }
  if(Number(input.annualSalary||0)<0||Number(input.hourlyRate||0)<0||Number(input.dailyRate||0)<0)return "Employee pay rates cannot be negative.";
  if(Number(input.p45PreviousPay||0)<0||Number(input.p45PreviousTax||0)<0)return "P45 previous pay and tax cannot be negative.";
  if(Number(input.contractedHours||0)<0||Number(input.contractedHours||0)>168)return "Contracted weekly hours must be between 0 and 168.";
  if(Number(input.annualLeaveDays??28)<0)return "Annual leave entitlement cannot be negative.";
  if(input.workingDaysPerWeek!==undefined&&input.workingDaysPerWeek!==null&&(!Number.isInteger(Number(input.workingDaysPerWeek))||Number(input.workingDaysPerWeek)<0||Number(input.workingDaysPerWeek)>7))return "Working days per week must be a whole number between 0 and 7.";
  return null;
};

export async function GET(request: Request) {
  const employerId = Number(new URL(request.url).searchParams.get("employerId") || 1);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const db = getDb();
  const rows=await db.select().from(employees).where(eq(employees.employerId, employerId)).orderBy(desc(employees.id));
  const departmentRows=await db.select().from(departments).where(eq(departments.employerId,employerId)),departmentName=new Map(departmentRows.map(row=>[row.id,row.name]));
  const visible=access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential);
  return NextResponse.json(visible.map(row=>({
    ...row,departmentName:row.departmentId?departmentName.get(row.departmentId)||"Unassigned":"Unassigned",
    ...(!access.membership.canViewConfidential?{passportNumber:null,medicalInformation:null,hrNotes:null,emergencyContactName:null,emergencyContactPhone:null,emergencyContactRelationship:null}:{}),
  })));
}

export async function POST(request: Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON employee object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const payrollId = String(input.payrollId || `PAY-${Date.now()}`).trim();
  if(!validPayrollId(payrollId))return NextResponse.json({error:"Payroll ID must contain 1 to 35 printable characters."},{status:422});
  if(Boolean(input.confidential)&&!access.membership.canViewConfidential)return NextResponse.json({error:"Confidential employee permission is required."},{status:403});
  if(!String(input.firstName||"").trim()||!String(input.lastName||"").trim())return NextResponse.json({error:"First name and last name are required."},{status:422});
  const employeeInputError=validateEmployeeInput(input);if(employeeInputError)return NextResponse.json({error:employeeInputError},{status:422});
  const bankEvidenceError=validateBankAndPortalEvidence(input);if(bankEvidenceError)return NextResponse.json({error:bankEvidenceError},{status:422});
  const starterEvidenceError=validateStarterEvidence(input);if(starterEvidenceError)return NextResponse.json({error:starterEvidenceError},{status:422});
  const niNumber=String(input.niNumber||"").replace(/\s/g,"").toUpperCase();
  if(niNumber&&!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(niNumber))return NextResponse.json({error:"Enter a valid National Insurance number."},{status:422});
  const taxCode=String(input.taxCode||"1257L").trim().toUpperCase(),niCategory=String(input.niCategory||"A").trim().toUpperCase();
  if(!isRecognisedPayeTaxCode(taxCode))return NextResponse.json({error:"Enter a recognised PAYE tax code."},{status:422});
  if(!niCategories.has(niCategory))return NextResponse.json({error:"Select a supported National Insurance category."},{status:422});
  if(input.studentLoanPlan&&!["1","2","4","5"].includes(String(input.studentLoanPlan)))return NextResponse.json({error:"Student loan plan must be 1, 2, 4 or 5."},{status:422});
  const existingEmployer = await db.select({ id: employers.id,taxYear:employers.taxYear,payFrequency:employers.payFrequency }).from(employers).where(eq(employers.id, employerId)).limit(1);
  if(!existingEmployer.length)return NextResponse.json({error:"Employer was not found."},{status:404});
  if(input.reportedPayFrequency&&input.reportedPayFrequency!==existingEmployer[0].payFrequency)
    return NextResponse.json({error:"Employee RTI pay frequency must match the employer payroll frequency."},{status:422});
  const p45OpeningError=validateP45OpeningBalances(input,existingEmployer[0].taxYear);
  if(p45OpeningError)return NextResponse.json({error:p45OpeningError},{status:422});
  const existingEmployee = await db.select().from(employees).where(and(eq(employees.employerId, employerId), eq(employees.payrollId, payrollId))).limit(1);
  if(existingEmployee.length)return NextResponse.json({error:"Payroll ID is already assigned to another employee for this employer."},{status:409});
  const [settings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const requestedDepartment=String(input.departmentName||"").trim();
  let departmentId:number|null=null;
  if(requestedDepartment){
    let [department]=await db.select().from(departments).where(and(eq(departments.employerId,employerId),eq(departments.name,requestedDepartment))).limit(1);
    if(!department)[department]=await db.insert(departments).values({employerId,name:requestedDepartment}).returning();
    departmentId=department.id;
  }
  const sortCode=String(input.sortCode||"").replace(/\D/g,""),accountNumber=String(input.accountNumber||"").replace(/\D/g,"");
  if(sortCode&&sortCode.length!==6)return NextResponse.json({error:"Sort code must contain 6 digits."},{status:422});
  if(accountNumber&&accountNumber.length!==8)return NextResponse.json({error:"Account number must contain 8 digits."},{status:422});
  const payBasis=["period","hourly","daily"].includes(input.payBasis)?input.payBasis:settings?.typicalPayBasis||"period";
  if(payBasis==="hourly"&&(Number(input.hourlyRate)<=0||Number(input.contractedHours)<=0))return NextResponse.json({error:"Hourly employees require a positive hourly rate and contracted weekly hours."},{status:422});
  if(payBasis==="daily"&&(Number(input.dailyRate)<=0||Number(input.workingDaysPerWeek)<=0||Number(input.workingDaysPerWeek)>7))return NextResponse.json({error:"Daily employees require a positive daily rate and between 1 and 7 working days per week."},{status:422});
  const generatedWorksNumber=settings?.autoWorksNumber?`EMP-${String(settings.nextWorksNumber).padStart(4,"0")}`:null;
  const values = {
    employerId,
    departmentId,
    payrollId,
    title:input.title||null,
    firstName: String(input.firstName || ""),
    middleNames:input.middleNames||null,
    lastName: String(input.lastName || ""),
    dateOfBirth:input.dateOfBirth||null,
    gender:normalizeGender(input.gender),
    address:input.address||null,
    postcode:input.postcode||null,
    nationality:input.nationality||null,passportNumber:input.passportNumber||null,maritalStatus:input.maritalStatus||null,
    email: input.email || null,
    phone: input.phone || null,
    jobTitle: input.jobTitle || null,
    startDate: input.startDate || null,
    leavingDate: input.leavingDate || null,
    status:employmentStatus(input.leavingDate),
    starterEvidence: starterEvidenceValues.has(String(input.starterEvidence))?String(input.starterEvidence):"No P45 provided",
    starterDeclaration:normalizeStarterDeclaration(input.starterDeclaration),
    p45LeavingDate: input.p45LeavingDate || null,
    p45PreviousPay: Number(input.p45PreviousPay || 0),
    p45PreviousTax: Number(input.p45PreviousTax || 0),
    p45ReceivedAfterPayroll: Boolean(input.p45ReceivedAfterPayroll),
    p60TaxYear: input.p60TaxYear || null,
    p60ReferenceOnly: Boolean(input.p60ReferenceOnly),
    taxCode,
    week1Month1: Boolean(input.week1Month1),
    niCategory,
    niNumber: niNumber || null,
    director: Boolean(input.director),
    directorStart:input.director?input.directorStart:null,
    directorEnd:input.director?input.directorEnd||null:null,
    alternativeDirectorNic: Boolean(input.director&&input.alternativeDirectorNic),
    noSecondaryNic: Boolean(input.noSecondaryNic),
    studentLoanPlan: input.studentLoanPlan || null,
    postgraduateLoan: Boolean(input.postgraduateLoan),
    annualSalary: Number(input.annualSalary || 0),
    hourlyRate: Number(input.hourlyRate ?? settings?.minimumHourlyRate ?? 0),
    payBasis,
    dailyRate:Math.max(0,Number(input.dailyRate||0)),
    workingDaysPerWeek:Math.max(0,Math.min(7,Number(input.workingDaysPerWeek??5))),
    contractedHours:Number(input.contractedHours??settings?.typicalWeeklyHours??0),
    minimumWageCategory:input.minimumWageCategory==="apprentice"?"apprentice":"age-based",
    apprenticeshipStartDate:input.apprenticeshipStartDate||null,
    annualLeaveDays:Number(input.annualLeaveDays??settings?.typicalAnnualLeaveDays??28),
    paymentMethod:["credit-transfer","cash","cheque"].includes(input.paymentMethod)?input.paymentMethod:"credit-transfer",
    bankName:input.bankName||null,accountName:input.accountName||null,sortCode:sortCode||null,accountNumber:accountNumber||null,
    irregularPayment:Boolean(input.irregularPayment),zeroPayFpsExclusion:Boolean(input.zeroPayFpsExclusion),
    reportedPayFrequency:existingEmployer[0].payFrequency,
    workplacePostcode:input.workplacePostcode||null,previousPayrollId:input.previousPayrollId||null,
    paymentToBody:Boolean(input.paymentToBody),trivialCommutation:Boolean(input.trivialCommutation),flexibleDrawdown:Boolean(input.flexibleDrawdown),
    worksNumber:input.worksNumber||generatedWorksNumber||undefined,
    employeePortal: Boolean(input.employeePortal),
    portalCanEditBank:Boolean(input.employeePortal&&input.portalCanEditBank),
    confidential:Boolean(input.confidential),
    managerName:input.managerName||null,emergencyContactName:input.emergencyContactName||null,
    emergencyContactPhone:input.emergencyContactPhone||null,emergencyContactRelationship:input.emergencyContactRelationship||null,
    medicalInformation:input.medicalInformation||null,hrNotes:input.hrNotes||null,hrNotesConfidential:Boolean(input.hrNotesConfidential),
    updatedAt: new Date().toISOString(),
  };
  const [created] = await db.insert(employees).values(values).returning();
  if(generatedWorksNumber&&settings)await db.update(employerSettings).set({nextWorksNumber:settings.nextWorksNumber+1,updatedAt:new Date().toISOString()}).where(eq(employerSettings.employerId,employerId));
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:employee",entityType:"employee",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(request: Request) {
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON employee update object is required."},{status:400});
  const id = Number(input.id);
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const db=getDb(),[existing]=await db.select().from(employees).where(and(eq(employees.id,id),eq(employees.employerId,employerId))).limit(1);
  if(!existing||existing.confidential&&!access.membership.canViewConfidential)return NextResponse.json({ error: "Employee was not found for this employer." }, { status: 404 });
  if(Boolean(input.confidential)&&!access.membership.canViewConfidential)return NextResponse.json({error:"Confidential employee permission is required."},{status:403});
  if(!String(input.firstName||"").trim()||!String(input.lastName||"").trim())return NextResponse.json({error:"First name and last name are required."},{status:422});
  const payrollId=String(input.payrollId||existing.payrollId).trim();
  if(!validPayrollId(payrollId))return NextResponse.json({error:"Payroll ID must contain 1 to 35 printable characters."},{status:422});
  const payrollIdChanged=payrollId!==existing.payrollId;
  if(payrollIdChanged){
    const duplicate=await db.select({id:employees.id}).from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
    if(duplicate.length)return NextResponse.json({error:"Payroll ID is already assigned to another employee for this employer."},{status:409});
  }
  const employeeInputError=validateEmployeeInput(input);if(employeeInputError)return NextResponse.json({error:employeeInputError},{status:422});
  const bankEvidenceError=validateBankAndPortalEvidence(input);if(bankEvidenceError)return NextResponse.json({error:bankEvidenceError},{status:422});
  const starterEvidenceError=validateStarterEvidence(input);if(starterEvidenceError)return NextResponse.json({error:starterEvidenceError},{status:422});
  const [employer]=await db.select({taxYear:employers.taxYear,payFrequency:employers.payFrequency}).from(employers).where(eq(employers.id,employerId)).limit(1);
  if(input.reportedPayFrequency&&input.reportedPayFrequency!==employer?.payFrequency)
    return NextResponse.json({error:"Employee RTI pay frequency must match the employer payroll frequency."},{status:422});
  const p45OpeningError=validateP45OpeningBalances(input,employer?.taxYear||"2026/27");
  if(p45OpeningError)return NextResponse.json({error:p45OpeningError},{status:422});
  const niNumber=String(input.niNumber||"").replace(/\s/g,"").toUpperCase();
  if(niNumber&&!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(niNumber))return NextResponse.json({error:"Enter a valid National Insurance number."},{status:422});
  const taxCode=String(input.taxCode||"1257L").trim().toUpperCase(),niCategory=String(input.niCategory||"A").trim().toUpperCase();
  if(!isRecognisedPayeTaxCode(taxCode))return NextResponse.json({error:"Enter a recognised PAYE tax code."},{status:422});
  if(!niCategories.has(niCategory))return NextResponse.json({error:"Select a supported National Insurance category."},{status:422});
  if(input.studentLoanPlan&&!["1","2","4","5"].includes(String(input.studentLoanPlan)))return NextResponse.json({error:"Student loan plan must be 1, 2, 4 or 5."},{status:422});
  const requestedDepartment=String(input.departmentName||"").trim();
  let departmentId:number|null=null;
  if(requestedDepartment){
    let [department]=await getDb().select().from(departments).where(and(eq(departments.employerId,employerId),eq(departments.name,requestedDepartment))).limit(1);
    if(!department)[department]=await getDb().insert(departments).values({employerId,name:requestedDepartment}).returning();
    departmentId=department.id;
  }
  const sortCode=String(input.sortCode||"").replace(/\D/g,""),accountNumber=String(input.accountNumber||"").replace(/\D/g,"");
  if(sortCode&&sortCode.length!==6)return NextResponse.json({error:"Sort code must contain 6 digits."},{status:422});
  if(accountNumber&&accountNumber.length!==8)return NextResponse.json({error:"Account number must contain 8 digits."},{status:422});
  const payBasis=["period","hourly","daily"].includes(input.payBasis)?input.payBasis:"period";
  if(payBasis==="hourly"&&(Number(input.hourlyRate)<=0||Number(input.contractedHours)<=0))return NextResponse.json({error:"Hourly employees require a positive hourly rate and contracted weekly hours."},{status:422});
  if(payBasis==="daily"&&(Number(input.dailyRate)<=0||Number(input.workingDaysPerWeek)<=0||Number(input.workingDaysPerWeek)>7))return NextResponse.json({error:"Daily employees require a positive daily rate and between 1 and 7 working days per week."},{status:422});
  const [updated] = await db.update(employees).set({
    departmentId,
    payrollId,
    title:input.title||null,
    firstName: String(input.firstName || ""),
    middleNames:input.middleNames||null,
    lastName: String(input.lastName || ""),
    dateOfBirth:input.dateOfBirth||null,
    gender:normalizeGender(input.gender),
    address:input.address||null,
    postcode:input.postcode||null,
    nationality:input.nationality||null,passportNumber:input.passportNumber||null,maritalStatus:input.maritalStatus||null,
    email: input.email || null,
    phone: input.phone || null,
    jobTitle: input.jobTitle || null,
    startDate: input.startDate || null,
    leavingDate: input.leavingDate || null,
    status:employmentStatus(input.leavingDate),
    starterEvidence: starterEvidenceValues.has(String(input.starterEvidence))?String(input.starterEvidence):"No P45 provided",
    starterDeclaration:normalizeStarterDeclaration(input.starterDeclaration),
    p45LeavingDate: input.p45LeavingDate || null,
    p45PreviousPay: Number(input.p45PreviousPay || 0),
    p45PreviousTax: Number(input.p45PreviousTax || 0),
    p45ReceivedAfterPayroll: Boolean(input.p45ReceivedAfterPayroll),
    p60TaxYear: input.p60TaxYear || null,
    p60ReferenceOnly: Boolean(input.p60ReferenceOnly),
    taxCode,
    week1Month1: Boolean(input.week1Month1),
    niCategory,
    niNumber: niNumber || null,
    director: Boolean(input.director),
    directorStart:input.director?input.directorStart:null,
    directorEnd:input.director?input.directorEnd||null:null,
    alternativeDirectorNic: Boolean(input.director&&input.alternativeDirectorNic),
    noSecondaryNic: Boolean(input.noSecondaryNic),
    studentLoanPlan: input.studentLoanPlan || null,
    postgraduateLoan: Boolean(input.postgraduateLoan),
    annualSalary: Number(input.annualSalary || 0),
    hourlyRate: Number(input.hourlyRate || 0),
    payBasis,
    dailyRate:Math.max(0,Number(input.dailyRate||0)),
    workingDaysPerWeek:Math.max(0,Math.min(7,Number(input.workingDaysPerWeek??5))),
    contractedHours:Number(input.contractedHours||0),
    minimumWageCategory:input.minimumWageCategory==="apprentice"?"apprentice":"age-based",
    apprenticeshipStartDate:input.apprenticeshipStartDate||null,
    annualLeaveDays:Number(input.annualLeaveDays??28),
    paymentMethod:["credit-transfer","cash","cheque"].includes(input.paymentMethod)?input.paymentMethod:"credit-transfer",
    bankName:input.bankName||null,accountName:input.accountName||null,sortCode:sortCode||null,accountNumber:accountNumber||null,
    irregularPayment:Boolean(input.irregularPayment),zeroPayFpsExclusion:Boolean(input.zeroPayFpsExclusion),
    reportedPayFrequency:employer?.payFrequency||"monthly",
    workplacePostcode:input.workplacePostcode||null,previousPayrollId:payrollIdChanged?existing.payrollId:existing.previousPayrollId,
    paymentToBody:Boolean(input.paymentToBody),trivialCommutation:Boolean(input.trivialCommutation),flexibleDrawdown:Boolean(input.flexibleDrawdown),
    employeePortal:Boolean(input.employeePortal),
    portalCanEditBank:Boolean(input.employeePortal&&input.portalCanEditBank),
    confidential:Boolean(input.confidential),
    managerName:input.managerName||null,emergencyContactName:input.emergencyContactName||null,
    emergencyContactPhone:input.emergencyContactPhone||null,emergencyContactRelationship:input.emergencyContactRelationship||null,
    medicalInformation:input.medicalInformation||null,hrNotes:input.hrNotes||null,hrNotesConfidential:Boolean(input.hrNotesConfidential),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(employees.id, id), eq(employees.employerId, employerId))).returning();
  if(updated&&existing.employeePortal&&!updated.employeePortal)await revokeEmployeePortalAccess(db,id);
  if(updated){
    const pensionIdentityChanged=["payrollId","niNumber","dateOfBirth","firstName","lastName"].some(field=>
      String(existing[field as keyof typeof existing]??"")!==String(updated[field as keyof typeof updated]??"")
    );
    let supersededPensionPackages=0;
    const paymentSourceChanged=["payrollId","paymentMethod","accountName","sortCode","accountNumber"].some(field=>
      String(existing[field as keyof typeof existing]??"")!==String(updated[field as keyof typeof updated]??"")
    );
    const supersededPaymentBatches=paymentSourceChanged
      ?await supersedeEmployeePaymentBatches(db,employerId,updated.id,`payment details changed for employee ${updated.id}`)
      :[];
    if(pensionIdentityChanged){
      const preparedPackages=await db.select({id:submissions.id}).from(submissions).where(and(
        eq(submissions.employerId,employerId),eq(submissions.type,"PENSION-PROVIDER"),eq(submissions.status,"prepared"),
      ));
      if(preparedPackages.length){
        await db.update(submissions).set({
          status:"superseded",response:`Superseded because pension identity data changed for employee ${updated.id}.`,updatedAt:new Date().toISOString(),
        }).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"PENSION-PROVIDER"),eq(submissions.status,"prepared")));
        supersededPensionPackages=preparedPackages.length;
      }
    }
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"updated:employee",entityType:"employee",entityId:String(updated.id),before:JSON.stringify(existing),after:JSON.stringify(updated)});
    if(payrollIdChanged)await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:"changed:employee-payroll-id",entityType:"employee",entityId:String(updated.id),
      before:JSON.stringify({payrollId:existing.payrollId,previousPayrollId:existing.previousPayrollId}),
      after:JSON.stringify({payrollId:updated.payrollId,previousPayrollId:updated.previousPayrollId}),
    });
    if(supersededPensionPackages)await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:"superseded:pension-provider-files",entityType:"employee",entityId:String(updated.id),
      after:JSON.stringify({supersededPensionPackages,reason:"pension-identity-change"}),
    });
    if(supersededPaymentBatches.length)await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:"superseded:bank-payment-files",entityType:"employee",entityId:String(updated.id),
      after:JSON.stringify({submissionIds:supersededPaymentBatches,reason:"payment-source-change"}),
    });
    return NextResponse.json({...updated,supersededPensionPackages,supersededPaymentBatches:supersededPaymentBatches.length});
  }
  return NextResponse.json({ error: "Employee was not found for this employer." }, { status: 404 });
}

export async function DELETE(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON employee deletion object is required."},{status:400});
  const id=Number(input.id),employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"A valid employee ID is required."},{status:422});
  const db=getDb(),[employee]=await db.select().from(employees).where(and(eq(employees.id,id),eq(employees.employerId,employerId))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  const protectedRecords=await Promise.all([
    db.select({id:payRuns.id}).from(payRuns).where(eq(payRuns.employeeId,id)).limit(1),
    db.select({id:leaveEvents.id}).from(leaveEvents).where(eq(leaveEvents.employeeId,id)).limit(1),
    db.select({id:pensionMemberships.id}).from(pensionMemberships).where(eq(pensionMemberships.employeeId,id)).limit(1),
    db.select({id:expensesBenefits.id}).from(expensesBenefits).where(eq(expensesBenefits.employeeId,id)).limit(1),
    db.select({id:attachmentOrders.id}).from(attachmentOrders).where(eq(attachmentOrders.employeeId,id)).limit(1),
    db.select({id:recurringPayItems.id}).from(recurringPayItems).where(eq(recurringPayItems.employeeId,id)).limit(1),
  ]);
  if(protectedRecords.some(rows=>rows.length))return NextResponse.json({
    error:"This employee has payroll or compliance history and cannot be deleted. Record a leaving date and retain the statutory audit trail.",
  },{status:409});
  await db.batch([
    db.delete(employeePortalSessions).where(eq(employeePortalSessions.employeeId,id)),
    db.delete(employeePortalInvites).where(eq(employeePortalInvites.employeeId,id)),
    db.delete(employeeChangeRequests).where(eq(employeeChangeRequests.employeeId,id)),
    db.delete(employees).where(and(eq(employees.id,id),eq(employees.employerId,employerId))),
    db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"deleted:unused-employee",entityType:"employee",entityId:String(id),before:JSON.stringify(employee)}),
  ]);
  return NextResponse.json({deleted:true,id});
}
