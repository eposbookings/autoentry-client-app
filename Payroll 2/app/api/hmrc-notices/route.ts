import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, hmrcNotices, payPeriods } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { isRecognisedPayeTaxCode } from "../../../lib/tax-code";
import { compareHmrcNoticePriority, hmrcNoticeInstructionKey } from "../../../lib/hmrc-notice-order";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

const noticeTypes=["coding","student-loan","nino","generic"] as const;
const validNino=(value:string)=>/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/i.test(value.replace(/\s+/g,""));
const today=()=>new Date().toISOString().slice(0,10);
const validIsoDate=(value:unknown)=>{
  const text=String(value||""),timestamp=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
};
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const dateWithinTaxYear=(date:string,taxYear:string)=>{
  const startYear=Number(taxYear.slice(0,4)),timestamp=Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp)&&timestamp>=Date.UTC(startYear,3,6)&&timestamp<=Date.UTC(startYear+1,3,5);
};

async function ownedEmployee(employerId:number,payrollId:string){
  return getDb().select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select({
    id:hmrcNotices.id,type:hmrcNotices.type,noticeIdentifier:hmrcNotices.noticeIdentifier,taxYear:hmrcNotices.taxYear,
    issuedDate:hmrcNotices.issuedDate,effectiveDate:hmrcNotices.effectiveDate,taxCode:hmrcNotices.taxCode,
    week1Month1:hmrcNotices.week1Month1,loanAction:hmrcNotices.loanAction,studentLoanPlan:hmrcNotices.studentLoanPlan,
    postgraduateLoan:hmrcNotices.postgraduateLoan,niNumber:hmrcNotices.niNumber,message:hmrcNotices.message,
    source:hmrcNotices.source,status:hmrcNotices.status,appliedAt:hmrcNotices.appliedAt,ignoredAt:hmrcNotices.ignoredAt,
    payrollId:employees.payrollId,firstName:employees.firstName,lastName:employees.lastName,confidential:employees.confidential,
  }).from(hmrcNotices).leftJoin(employees,eq(hmrcNotices.employeeId,employees.id))
    .where(and(eq(hmrcNotices.employerId,employerId),eq(hmrcNotices.taxYear,taxYear))).orderBy(desc(hmrcNotices.id));
  const visible=access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential);
  return NextResponse.json({notices:visible.map(({confidential:_,...row})=>row),externalDependency:"Automatic retrieval requires HMRC-recognised software credentials, fraud-prevention headers and the notice transport service."});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON HMRC notice object is required."},{status:400});
  const employerId=Number(input.employerId),type=String(input.type||"generic");
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  if(!noticeTypes.includes(type as typeof noticeTypes[number]))return NextResponse.json({error:"Notice type must be coding, student-loan, nino or generic."},{status:422});
  const payrollId=String(input.payrollId||""),employee=type!=="generic"&&payrollId?(await ownedEmployee(employerId,payrollId))[0]:null;
  if(type!=="generic"&&(!employee||employee.confidential&&!access.membership.canViewConfidential))return NextResponse.json({error:"Select an employee belonging to this employer."},{status:404});
  const taxCode=String(input.taxCode||"").toUpperCase().replace(/\s+/g,""),niNumber=String(input.niNumber||"").toUpperCase().replace(/\s+/g,"");
  if(type==="coding"&&!isRecognisedPayeTaxCode(taxCode))return NextResponse.json({error:"Enter a valid HMRC tax code."},{status:422});
  if(type==="nino"&&!validNino(niNumber))return NextResponse.json({error:"Enter a valid National Insurance number."},{status:422});
  const loanAction=String(input.loanAction||"start"),studentLoanPlan=input.studentLoanPlan?String(input.studentLoanPlan):null,postgraduateLoan=Boolean(input.postgraduateLoan);
  if(type==="student-loan"&&!["start","stop","stop-student","stop-postgraduate","stop-all"].includes(loanAction))return NextResponse.json({error:"Select a supported student or postgraduate loan instruction."},{status:422});
  if(type==="student-loan"&&loanAction==="start"&&!postgraduateLoan&&!["1","2","4","5"].includes(studentLoanPlan||""))return NextResponse.json({error:"Choose a student loan plan or postgraduate loan."},{status:422});
  const issuedDate=String(input.issuedDate||today()),effectiveDate=String(input.effectiveDate||issuedDate);
  if(!validIsoDate(issuedDate)||!validIsoDate(effectiveDate))return NextResponse.json({error:"Enter valid issued and effective dates."},{status:422});
  if(issuedDate>today())return NextResponse.json({error:"A notice cannot be issued in the future."},{status:422});
  const taxYear=String(input.taxYear||"");
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Enter a consecutive notice tax year in the format 2026/27."},{status:422});
  if(!dateWithinTaxYear(effectiveDate,taxYear))return NextResponse.json({error:"The notice effective date must fall within its tax year."},{status:422});
  const noticeIdentifier=String(input.noticeIdentifier||`MANUAL-${type.toUpperCase()}-${Date.now()}`).trim();
  const message=String(input.message||"").trim();
  if(noticeIdentifier.length<3||noticeIdentifier.length>100)return NextResponse.json({error:"Notice identifier must contain 3 to 100 characters."},{status:422});
  if(message.length>500||type==="generic"&&message.length<3)return NextResponse.json({error:"Generic notices require a message of 3 to 500 characters."},{status:422});
  const candidate={
    id:0,type,employeeId:employee?.id||null,taxYear,issuedDate,effectiveDate,
    taxCode:type==="coding"?taxCode:null,week1Month1:Boolean(input.week1Month1),
    loanAction:type==="student-loan"?loanAction:null,studentLoanPlan:type==="student-loan"?studentLoanPlan:null,
    postgraduateLoan:type==="student-loan"&&postgraduateLoan,niNumber:type==="nino"?niNumber:null,message:message||null,
  };
  const existingNotices=(await getDb().select().from(hmrcNotices).where(eq(hmrcNotices.employerId,employerId)))
    .filter(item=>["new","applied"].includes(item.status));
  if(existingNotices.some(item=>hmrcNoticeInstructionKey(item)===hmrcNoticeInstructionKey(candidate)))
    return NextResponse.json({error:"An equivalent active HMRC notice already exists for this employee, instruction and effective date."},{status:409});
  try{
    const [created]=await getDb().insert(hmrcNotices).values({
      employerId,employeeId:employee?.id||null,type,noticeIdentifier,taxYear,
      issuedDate,effectiveDate,taxCode:type==="coding"?taxCode:null,week1Month1:Boolean(input.week1Month1),
      loanAction:type==="student-loan"?loanAction:null,studentLoanPlan:type==="student-loan"?studentLoanPlan:null,
      postgraduateLoan:type==="student-loan"&&postgraduateLoan,niNumber:type==="nino"?niNumber:null,
      message:message||null,source:input.source==="hmrc"?"hmrc":"manual",status:"new",payload:input.payload?JSON.stringify(input.payload):null,
    }).returning();
    await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:hmrc-notice",entityType:"hmrc-notice",entityId:String(created.id),after:JSON.stringify({type,noticeIdentifier,payrollId})});
    return NextResponse.json(created,{status:201});
  }catch(error){
    return NextResponse.json({error:String(error).includes("UNIQUE")?"A notice with this identifier already exists for the employer.":"The notice could not be saved."},{status:409});
  }
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON HMRC notice update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),action=String(input.action||"apply");
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const [notice]=await getDb().select().from(hmrcNotices).where(and(eq(hmrcNotices.id,id),eq(hmrcNotices.employerId,employerId))).limit(1);
  if(!notice)return NextResponse.json({error:"HMRC notice was not found for this employer."},{status:404});
  const linkedEmployee=notice.employeeId?(await getDb().select().from(employees).where(and(
    eq(employees.id,notice.employeeId),eq(employees.employerId,employerId),
  )).limit(1))[0]:null;
  if(linkedEmployee?.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"HMRC notice was not found for this employer."},{status:404});
  if(notice.status!=="new")return NextResponse.json({error:`This notice is already ${notice.status}.`},{status:409});
  const timestamp=new Date().toISOString();
  if(action==="ignore"){
    const [updated]=await getDb().update(hmrcNotices).set({status:"ignored",ignoredAt:timestamp,updatedAt:timestamp}).where(and(eq(hmrcNotices.id,id),eq(hmrcNotices.employerId,employerId))).returning();
    await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"ignored:hmrc-notice",entityType:"hmrc-notice",entityId:String(id),before:JSON.stringify(notice),after:JSON.stringify(updated)});
    return NextResponse.json(updated);
  }
  if(action!=="apply")return NextResponse.json({error:"Notice action must be apply or ignore."},{status:422});
  let firstOpen:{periodNumber:number;payDate:string|null}|undefined=(await getDb().select({periodNumber:payPeriods.periodNumber,payDate:payPeriods.payDate}).from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,notice.taxYear),eq(payPeriods.status,"open"),
  )).orderBy(asc(payPeriods.periodNumber)).limit(1))[0];
  if(!firstOpen){
    const [firstExisting]=await getDb().select({periodNumber:payPeriods.periodNumber}).from(payPeriods).where(and(
      eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,notice.taxYear),
    )).orderBy(asc(payPeriods.periodNumber)).limit(1);
    if(!firstExisting){
      const [employer]=await getDb().select({payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate})
        .from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
        .where(eq(employers.id,employerId)).limit(1);
      if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
      try{
        const firstScheduled=scheduledPayPeriods(notice.taxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined)[0];
        firstOpen=firstScheduled?{periodNumber:1,payDate:firstScheduled.payDate}:undefined;
      }catch(error){
        return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});
      }
    }
  }
  if(!firstOpen)return NextResponse.json({error:"The notice tax year has no open payroll period."},{status:409});
  if(!firstOpen.payDate||!validIsoDate(firstOpen.payDate))return NextResponse.json({error:`Open Period ${firstOpen.periodNumber} needs a valid pay date before an HMRC notice can be applied.`},{status:409});
  if(notice.effectiveDate>firstOpen.payDate)return NextResponse.json({error:`This notice is not effective for open Period ${firstOpen.periodNumber}.`},{status:409});
  if(notice.type!=="generic"&&!notice.employeeId)return NextResponse.json({error:"The notice has no employee to update."},{status:409});
  const related=notice.employeeId?(await getDb().select().from(hmrcNotices).where(and(
    eq(hmrcNotices.employerId,employerId),eq(hmrcNotices.employeeId,notice.employeeId),eq(hmrcNotices.type,notice.type),eq(hmrcNotices.taxYear,notice.taxYear),
  ))):[];
  const laterApplied=related.find(item=>item.status==="applied"&&item.id!==notice.id&&compareHmrcNoticePriority(item,notice)>=0);
  if(laterApplied)return NextResponse.json({error:`A later ${notice.type} notice (${laterApplied.noticeIdentifier}) has already been applied; this older notice cannot replace it.`},{status:409});
  if(notice.employeeId){
    const employee=linkedEmployee;
    if(!employee)return NextResponse.json({error:"The linked employee no longer belongs to this employer."},{status:409});
    if(notice.type==="coding")await getDb().update(employees).set({taxCode:notice.taxCode!,week1Month1:notice.week1Month1,updatedAt:timestamp}).where(and(eq(employees.id,employee.id),eq(employees.employerId,employerId)));
    if(notice.type==="nino")await getDb().update(employees).set({niNumber:notice.niNumber!,updatedAt:timestamp}).where(and(eq(employees.id,employee.id),eq(employees.employerId,employerId)));
    if(notice.type==="student-loan"){
      const loanUpdate=notice.loanAction==="stop-postgraduate"
        ? {postgraduateLoan:false,updatedAt:timestamp}
        : notice.loanAction==="stop-student"
          ? {studentLoanPlan:null,updatedAt:timestamp}
          : notice.loanAction==="stop"||notice.loanAction==="stop-all"
            ? {studentLoanPlan:null,postgraduateLoan:false,updatedAt:timestamp}
            : notice.postgraduateLoan
              ? {postgraduateLoan:true,updatedAt:timestamp}
              : {studentLoanPlan:notice.studentLoanPlan,updatedAt:timestamp};
      await getDb().update(employees).set(loanUpdate).where(and(eq(employees.id,employee.id),eq(employees.employerId,employerId)));
    }
  }
  const superseded=related.filter(item=>item.status==="new"&&item.id!==notice.id&&compareHmrcNoticePriority(item,notice)<=0);
  for(const older of superseded){
    const [supersededNotice]=await getDb().update(hmrcNotices).set({status:"superseded",ignoredAt:timestamp,updatedAt:timestamp})
      .where(and(eq(hmrcNotices.id,older.id),eq(hmrcNotices.employerId,employerId),eq(hmrcNotices.status,"new"))).returning();
    if(supersededNotice)await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"superseded:hmrc-notice",entityType:"hmrc-notice",entityId:String(older.id),before:JSON.stringify(older),after:JSON.stringify({status:"superseded",supersededByNoticeId:notice.id})});
  }
  const [updated]=await getDb().update(hmrcNotices).set({status:"applied",appliedAt:timestamp,updatedAt:timestamp}).where(and(eq(hmrcNotices.id,id),eq(hmrcNotices.employerId,employerId))).returning();
  await getDb().insert(auditLog).values({employerId,actor:access.user.displayName,action:"applied:hmrc-notice",entityType:"hmrc-notice",entityId:String(id),before:JSON.stringify(notice),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
