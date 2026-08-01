import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employerSettings, employers, hmrcPayments, payPeriods } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select().from(hmrcPayments).where(and(eq(hmrcPayments.employerId,employerId),eq(hmrcPayments.taxYear,taxYear))).orderBy(desc(hmrcPayments.paymentDate),desc(hmrcPayments.id));
  return NextResponse.json({payments:rows});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON HMRC payment object is required."},{status:400});
  const employerId=Number(input.employerId),taxYear=String(input.taxYear||""),taxMonth=Number(input.taxMonth);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [employer]=await getDb().select({
    id:employers.id,payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
    .where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  if(!/^\d{4}\/\d{2}$/.test(taxYear)||Number(taxYear.slice(5))!==(Number(taxYear.slice(0,4))+1)%100)return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  if(!Number.isInteger(taxMonth)||taxMonth<1||taxMonth>12)return NextResponse.json({error:"Tax month must be between 1 and 12."},{status:422});
  let expectedPeriods;
  try{
    expectedPeriods=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined)
      .filter(period=>period.taxMonth===taxMonth);
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});
  }
  const storedPeriods=await getDb().select({
    periodNumber:payPeriods.periodNumber,status:payPeriods.status,
  }).from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear)));
  const complete=expectedPeriods.length>0&&expectedPeriods.every(expected=>
    storedPeriods.some(period=>period.periodNumber===expected.periodNumber&&["finalised","migrated"].includes(period.status)),
  );
  if(!complete)return NextResponse.json({
    error:`Complete every payroll period in HMRC tax month ${taxMonth} before recording payments or adjustments.`,
    requiredPayrollPeriods:expectedPeriods.map(period=>period.periodNumber),
  },{status:409});
  const amount=Math.round(Number(input.amount)*100)/100,kind=String(input.kind||"payment");
  if(!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"Amount must be greater than zero."},{status:422});
  if(!["payment","credit","charge"].includes(kind))return NextResponse.json({error:"Record type must be payment, credit or charge."},{status:422});
  const category=String(input.category||"");
  const categories:Record<string,string[]>={
    payment:["paye-payment"],credit:["tax-refund-funding","previous-overpayment","other-credit"],
    charge:["class1a-adjustment","other-charge"],
  };
  if(!categories[kind].includes(category))return NextResponse.json({error:"Select a funding or adjustment category that matches the record type."},{status:422});
  const paymentDate=String(input.paymentDate||""),reference=String(input.reference||"").trim().toUpperCase(),method=String(input.method||"");
  const parsedDate=Date.parse(`${paymentDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||!Number.isFinite(parsedDate)||new Date(parsedDate).toISOString().slice(0,10)!==paymentDate)return NextResponse.json({error:"Enter a valid payment or adjustment date."},{status:422});
  if(paymentDate>new Date().toISOString().slice(0,10))return NextResponse.json({error:"Payment or adjustment date cannot be in the future."},{status:422});
  if(reference.length<3||reference.length>100)return NextResponse.json({error:"Enter an HMRC payment reference of 3 to 100 characters."},{status:422});
  if(!["bank-transfer","direct-debit","online","journal"].includes(method))return NextResponse.json({error:"Select a supported HMRC payment method."},{status:422});
  const notes=String(input.notes||"").trim();
  if(notes.length>500)return NextResponse.json({error:"HMRC payment notes cannot exceed 500 characters."},{status:422});
  const [duplicate]=await getDb().select({id:hmrcPayments.id}).from(hmrcPayments).where(and(eq(hmrcPayments.employerId,employerId),sql`upper(${hmrcPayments.reference}) = ${reference}`)).limit(1);
  if(duplicate)return NextResponse.json({error:"This HMRC payment reference is already recorded for the employer."},{status:409});
  try{
    const [created]=await getDb().insert(hmrcPayments).values({
      employerId,taxYear,taxMonth,paymentDate,kind,category,amount,reference,
      method,notes:notes||null,status:"recorded",
    }).returning();
    await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"recorded:hmrc-payment",entityType:"hmrc-payment",entityId:String(created.id),after:JSON.stringify(created)});
    return NextResponse.json(created,{status:201});
  }catch(error){
    return NextResponse.json({error:/unique|constraint failed|reference_idx/i.test(String(error))?"This HMRC payment reference is already recorded for the employer.":"The HMRC payment could not be recorded."},{status:409});
  }
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON HMRC payment update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [record]=await getDb().select().from(hmrcPayments).where(and(eq(hmrcPayments.id,id),eq(hmrcPayments.employerId,employerId))).limit(1);
  if(!record)return NextResponse.json({error:"HMRC payment was not found for this employer."},{status:404});
  if(record.status==="void")return NextResponse.json({error:"This HMRC payment is already void."},{status:409});
  const reason=String(input.reason||"").trim();
  if(reason.length<5||reason.length>250)return NextResponse.json({error:"Enter a void reason between 5 and 250 characters."},{status:422});
  const timestamp=new Date().toISOString();
  const [updated]=await getDb().update(hmrcPayments).set({status:"void",voidedAt:timestamp,voidReason:reason,updatedAt:timestamp}).where(and(eq(hmrcPayments.id,id),eq(hmrcPayments.employerId,employerId))).returning();
  await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"voided:hmrc-payment",entityType:"hmrc-payment",entityId:String(id),before:JSON.stringify(record),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
