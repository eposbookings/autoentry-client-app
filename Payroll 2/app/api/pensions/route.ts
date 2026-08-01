import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, payPeriods,payRuns, pensionMembershipEvents, pensionMemberships, pensionSchemes, submissions } from "../../../db/schema";
import { assessPension } from "../../../lib/pension-engine";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { hasValidFrozenPensionSnapshot, parseFrozenPensionSnapshot } from "../../../lib/pension-snapshot";
import { addCalendarMonths } from "../../../lib/calendar-months";
import { payrollFrequencyRule, scheduledPayPeriods, type PayrollFrequency } from "../../../lib/pay-frequency";

async function employeeForEmployer(db: ReturnType<typeof getDb>, employerId: number, payrollId: string) {
  return db.select().from(employees).where(and(eq(employees.employerId, employerId), eq(employees.payrollId, payrollId))).limit(1);
}
const csv=(rows:unknown[][])=>"\uFEFF"+rows.map(row=>row.map(value=>`"${String(value??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const addDays=(iso:string,days:number)=>new Date(Date.parse(`${iso}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const validIso=(value:string)=>{
  const time=/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(`${value}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
};
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const contributionDeadline=(payDate:string,dueDay:number)=>{
  const date=new Date(`${payDate}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,Math.min(Math.max(dueDay,1),28))).toISOString().slice(0,10);
};
const pensionEvidence=(run:typeof payRuns.$inferSelect,employee:typeof employees.$inferSelect,scheme?:typeof pensionSchemes.$inferSelect)=>{
  if(!run.pensionSchemeId)return {
    schemeId:null,provider:"",schemeName:"Not recorded",employerReference:"",contributionDueDay:22,taxRelief:"none",
    employeeDeduction:0,employeeTaxRelief:0,employeeGrossContribution:0,payrollId:employee.payrollId,
    niNumber:employee.niNumber||"",dateOfBirth:employee.dateOfBirth||"",firstName:employee.firstName,middleNames:employee.middleNames||"",lastName:employee.lastName,
  };
  const snapshot=parseFrozenPensionSnapshot(run.pensionSnapshot);
  const frozen=(field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(snapshot,field)?snapshot[field]:fallback;
  return {
    schemeId:Number(frozen("schemeId",run.pensionSchemeId)||0)||null,
    provider:String(frozen("provider",scheme?.provider)||""),
    schemeName:String(frozen("schemeName",scheme?.schemeName)||"Historical scheme"),
    employerReference:String(frozen("employerReference",scheme?.employerReference)||""),
    contributionDueDay:Number(frozen("contributionDueDay",scheme?.contributionDueDay)||22),
    taxRelief:String(frozen("taxRelief",scheme?.taxRelief)||"legacy"),
    employeeDeduction:Number(frozen("employeeDeduction",run.employeePension)||0),
    employeeTaxRelief:Number(frozen("employeeTaxRelief",0)||0),
    employeeGrossContribution:Number(frozen("employeeGrossContribution",run.employeePension)||0),
    payrollId:String(frozen("payrollId",employee.payrollId)||""),
    niNumber:String(frozen("niNumber",employee.niNumber)||""),
    dateOfBirth:String(frozen("dateOfBirth",employee.dateOfBirth)||""),
    firstName:String(frozen("firstName",employee.firstName)||""),
    middleNames:String(frozen("middleNames",employee.middleNames)||""),
    lastName:String(frozen("lastName",employee.lastName)||""),
  };
};

async function supersedeProviderPackages(employerId:number,reason:string,predicate:(payload:any)=>boolean){
  const db=getDb(),rows=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"PENSION-PROVIDER"),eq(submissions.status,"prepared")));
  let superseded=0;
  for(const row of rows){
    let payload:any={};try{payload=JSON.parse(row.payload||"{}");}catch{continue;}
    if(!predicate(payload))continue;
    await db.update(submissions).set({status:"superseded",response:reason,updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,row.id),eq(submissions.employerId,employerId)));
    superseded++;
  }
  return superseded;
}

export async function GET(request: Request) {
  const employerId = Number(new URL(request.url).searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const db = getDb();
  const schemes = await db.select().from(pensionSchemes).where(eq(pensionSchemes.employerId, employerId));
  const today=new Date().toISOString().slice(0,10),displaySchemes=schemes.map(scheme=>({
    ...scheme,declarationStatus:scheme.declarationStatus==="filed"?"filed":scheme.declarationDueDate&&scheme.declarationDueDate<today?"overdue":"not-filed",
  }));
  const memberships = await db.select({
    id: pensionMemberships.id, employeeId: pensionMemberships.employeeId,
    payrollId:employees.payrollId,employeeName:employees.firstName,
    employeeLastName:employees.lastName,schemeName:pensionSchemes.schemeName,provider:pensionSchemes.provider,
    assessmentStatus: pensionMemberships.assessmentStatus, membershipStatus: pensionMemberships.membershipStatus,
    enrolmentDate: pensionMemberships.enrolmentDate, postponementEnd: pensionMemberships.postponementEnd,optOutDate:pensionMemberships.optOutDate,
    postponementNoticeDate:pensionMemberships.postponementNoticeDate,employerContributionRequired:pensionMemberships.employerContributionRequired,
    enrolmentInformationDate:pensionMemberships.enrolmentInformationDate,optOutNoticeDate:pensionMemberships.optOutNoticeDate,
    optOutNoticeValid:pensionMemberships.optOutNoticeValid,ceasedDate:pensionMemberships.ceasedDate,lastReenrolmentDate:pensionMemberships.lastReenrolmentDate,
    employeeRefundDue:pensionMemberships.employeeRefundDue,employerRefundDue:pensionMemberships.employerRefundDue,
    communicationDueDate:pensionMemberships.communicationDueDate,lastCommunicationDate:pensionMemberships.lastCommunicationDate,confidential:employees.confidential,
  }).from(pensionMemberships).innerJoin(pensionSchemes, eq(pensionMemberships.schemeId, pensionSchemes.id)).innerJoin(employees,eq(pensionMemberships.employeeId,employees.id))
    .where(and(eq(pensionSchemes.employerId, employerId),eq(pensionSchemes.status,"active")));
  const periods=await db.select().from(payPeriods).where(eq(payPeriods.employerId,employerId)).orderBy(asc(payPeriods.periodNumber));
  const periodMap=new Map(periods.map(period=>[period.id,period]));
  const schemeMap=new Map(schemes.map(scheme=>[scheme.id,scheme]));
  const employeeRows=(await db.select().from(employees).where(eq(employees.employerId,employerId))).filter(employee=>access.membership.canViewConfidential||!employee.confidential);
  const employeeMap=new Map(employeeRows.map(employee=>[employee.id,employee]));
  const contributionRuns=(await db.select().from(payRuns).where(eq(payRuns.status,"finalised")))
    .filter(run=>periodMap.has(run.payPeriodId)&&employeeMap.has(run.employeeId));
  if(contributionRuns.some(run=>run.pensionSchemeId&&!hasValidFrozenPensionSnapshot(run.pensionSnapshot)))
    return NextResponse.json({error:"A finalised contribution has invalid frozen pension evidence. Reopen and recalculate the affected payroll."},{status:409});
  const contributions=contributionRuns
    .map(run=>{const employee=employeeMap.get(run.employeeId)!,period=periodMap.get(run.payPeriodId)!,evidence=pensionEvidence(run,employee,run.pensionSchemeId?schemeMap.get(run.pensionSchemeId):undefined);return{
      payRunId:run.id,periodNumber:period.periodNumber,taxYear:period.taxYear,payDate:period.payDate,
      payrollId:evidence.payrollId,employeeName:[evidence.firstName,evidence.middleNames,evidence.lastName].filter(Boolean).join(" "),niNumber:evidence.niNumber,
      schemeId:evidence.schemeId,schemeName:evidence.schemeId?evidence.schemeName:"Not recorded",
      pensionablePay:run.pensionablePay,taxReliefMethod:evidence.taxRelief,employeeContribution:evidence.employeeDeduction,
      employeeTaxRelief:evidence.employeeTaxRelief,employeeGrossContribution:evidence.employeeGrossContribution,employerContribution:run.employerPension,
      totalContribution:Math.round((evidence.employeeGrossContribution+run.employerPension)*100)/100,
    };});
  const events=(await db.select().from(pensionMembershipEvents).where(eq(pensionMembershipEvents.employerId,employerId)).orderBy(asc(pensionMembershipEvents.id))).filter(event=>employeeMap.has(event.employeeId));
  const filingHistory=(await db.select({
    id:submissions.id,type:submissions.type,status:submissions.status,dueDate:submissions.dueDate,
    payPeriodId:submissions.payPeriodId,payload:submissions.payload,payloadChecksum:submissions.payloadChecksum,
    preparedAt:submissions.preparedAt,submittedAt:submissions.submittedAt,response:submissions.response,
  }).from(submissions).where(eq(submissions.employerId,employerId)).orderBy(asc(submissions.id)))
    .filter(row=>["PENSION-PROVIDER","PENSION-LETTER","PENSION-DECLARATION"].includes(row.type)&&row.status!=="invalid")
    .map(row=>{
      let payload:Record<string,unknown>={};
      try{payload=JSON.parse(row.payload||"{}") as Record<string,unknown>;}catch{}
      return {
        id:row.id,type:row.type,status:row.status,dueDate:row.dueDate,payPeriodId:row.payPeriodId,
        taxYear:typeof payload.taxYear==="string"?payload.taxYear:null,
        periodNumber:Number.isInteger(Number(payload.periodNumber))?Number(payload.periodNumber):null,
        payDate:typeof payload.payDate==="string"?payload.payDate:null,
        records:Number.isInteger(Number(payload.records))?Number(payload.records):null,
        providerTransmission:payload.providerTransmission===true,
        declarationDate:typeof payload.declarationDate==="string"?payload.declarationDate:null,
        declarationReference:typeof payload.reference==="string"?payload.reference:null,
        payloadChecksum:row.payloadChecksum,preparedAt:row.preparedAt,submittedAt:row.submittedAt,response:row.response,
      };
    });
  return NextResponse.json({ schemes:displaySchemes, memberships:memberships.filter(membership=>access.membership.canViewConfidential||!membership.confidential), contributions,events,filingHistory });
}

export async function POST(request: Request) {
  const input = await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON pension operation object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  let payFrequency:PayrollFrequency,paySchedule:ReturnType<typeof scheduledPayPeriods>;
  try{
    payFrequency=payrollFrequencyRule(employer.payFrequency).frequency;
    paySchedule=scheduledPayPeriods(String(input.taxYear||"2026/27"),payFrequency,employer.firstPayDate||undefined);
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(input.action==="export-contributions"){
    const periodNumber=Number(input.periodNumber),taxYear=String(input.taxYear||"2026/27");
    if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
    if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>paySchedule.length)return NextResponse.json({error:`Choose a payroll period between 1 and ${paySchedule.length}.`},{status:422});
    const [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber),eq(payPeriods.status,"finalised"))).limit(1);
    if(!period)return NextResponse.json({error:`Period ${periodNumber} must be finalised before contribution export.`},{status:409});
    const payDate=period.payDate;
    if(!payDate||!validIso(payDate))return NextResponse.json({error:`Period ${periodNumber} needs a valid pay date before contribution export.`},{status:409});
    const employeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId)),employeeMap=new Map(employeeRows.map(employee=>[employee.id,employee]));
    const schemeRows=await db.select().from(pensionSchemes).where(eq(pensionSchemes.employerId,employerId)),exportSchemeMap=new Map(schemeRows.map(item=>[item.id,item]));
    const runs=(await db.select().from(payRuns).where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.status,"finalised")))).filter(run=>employeeMap.has(run.employeeId));
    const schemeId=Number(input.schemeId||0);
    const exportRuns=runs.filter(run=>(!schemeId||run.pensionSchemeId===schemeId)&&Boolean(run.pensionSchemeId)&&(run.employeePension!==0||run.employerPension!==0));
    if(!exportRuns.length)return NextResponse.json({error:"No non-zero finalised contributions exist for the selected scheme and period."},{status:409});
    if(exportRuns.some(run=>!hasValidFrozenPensionSnapshot(run.pensionSnapshot)))return NextResponse.json({error:"One or more finalised contributions have invalid frozen pension evidence. Reopen and recalculate the affected payroll before generating a provider file."},{status:409});
    if(!access.membership.canViewConfidential&&exportRuns.some(run=>employeeMap.get(run.employeeId)?.confidential))return NextResponse.json({error:"Confidential employee permission is required to generate the complete provider contribution file."},{status:403});
    const evidenceRows=exportRuns.map(run=>{const employee=employeeMap.get(run.employeeId)!,scheme=run.pensionSchemeId?exportSchemeMap.get(run.pensionSchemeId):undefined;return{run,evidence:pensionEvidence(run,employee,scheme)};});
    const identityErrors=evidenceRows.filter(({evidence})=>!evidence.payrollId||(!evidence.niNumber&&!evidence.dateOfBirth));
    if(identityErrors.length)return NextResponse.json({error:`${identityErrors.length} contribution record(s) need a payroll ID and either NINO or date of birth.`},{status:422});
    const rows=[["Provider","Scheme","Employer Reference","Payroll ID","NI Number","Forename","Surname","Pay Date","Pensionable Earnings","Tax Relief Method","Employee Deduction","Provider Tax Relief","Gross Employee Contribution","Employer Contribution","Total Contribution"],
      ...evidenceRows.map(({run,evidence})=>[evidence.provider,evidence.schemeName,evidence.employerReference,evidence.payrollId,evidence.niNumber,evidence.firstName,evidence.lastName,payDate,run.pensionablePay,evidence.taxRelief,evidence.employeeDeduction,evidence.employeeTaxRelief,evidence.employeeGrossContribution,run.employerPension,Math.round((evidence.employeeGrossContribution+run.employerPension)*100)/100])];
    const content=csv(rows),payloadChecksum=await sha256(content),usedSchemes=[...new Set(exportRuns.map(run=>run.pensionSchemeId!))];
    const sourceChecksum=await sha256(JSON.stringify({periodId:period.id,taxYear,periodNumber,payDate,rows}));
    const dueDates=evidenceRows.map(({evidence})=>contributionDeadline(payDate,evidence.contributionDueDay));
    const preparedAt=new Date().toISOString();
    const supersededPackages=await supersedeProviderPackages(employerId,`Superseded by a regenerated contribution file for ${taxYear} period ${periodNumber}.`,payload=>payload.taxYear===taxYear&&Number(payload.periodNumber)===periodNumber&&Array.isArray(payload.schemeIds)&&payload.schemeIds.some((id:number)=>usedSchemes.includes(Number(id))));
    const [filing]=await db.insert(submissions).values({employerId,payPeriodId:period.id,type:"PENSION-PROVIDER",dueDate:dueDates.sort()[0],payload:JSON.stringify({schemaVersion:"payflow-pension-generic-csv-2",taxYear,periodNumber,payDate,schemeIds:usedSchemes,records:exportRuns.length,payloadChecksum,sourceChecksum,providerTransmission:false}),payloadChecksum,preparedAt,status:"prepared",submittedAt:null,response:"Generic provider contribution file generated; no provider transmission occurred."}).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"generated:pension-contributions",entityType:"submission",entityId:String(filing.id),after:JSON.stringify({taxYear,periodNumber,records:exportRuns.length,schemeIds:usedSchemes,payloadChecksum,sourceChecksum,dueDate:filing.dueDate,supersededPackages,providerTransmission:false})});
    return new Response(content,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="pension-contributions-period-${periodNumber}.csv"`,"x-payflow-submission-id":String(filing.id)}});
  }
  if(input.action==="letter"){
    const payrollId=String(input.payrollId||""),letterType=String(input.letterType||"enrolment");
    if(!["enrolment","postponement","opt-in","opt-out","cessation","re-enrolment"].includes(letterType))return NextResponse.json({error:"Unsupported pension letter type."},{status:422});
    const [employee]=await employeeForEmployer(db,employerId,payrollId);
    if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
    const [membership]=await db.select({
      id:pensionMemberships.id,
      membershipStatus:pensionMemberships.membershipStatus,enrolmentDate:pensionMemberships.enrolmentDate,
      postponementEnd:pensionMemberships.postponementEnd,optOutDate:pensionMemberships.optOutDate,
      schemeName:pensionSchemes.schemeName,provider:pensionSchemes.provider,
    }).from(pensionMemberships).innerJoin(pensionSchemes,eq(pensionMemberships.schemeId,pensionSchemes.id))
      .where(and(eq(pensionMemberships.employeeId,employee.id),eq(pensionSchemes.employerId,employerId),eq(pensionSchemes.status,"active"))).limit(1);
    if(!membership)return NextResponse.json({error:"Assess the employee before creating a pension letter."},{status:409});
    const allowedByStatus:Record<string,string[]>={
      enrolment:["active"],postponement:["postponed"],"opt-in":["active"],"opt-out":["opted-out"],
      cessation:["ceased"],"re-enrolment":["active"],
    };
    if(!allowedByStatus[letterType]?.includes(membership.membershipStatus))return NextResponse.json({error:`A ${letterType} letter is not valid for membership status ${membership.membershipStatus}.`},{status:409});
    const title={"enrolment":"Automatic enrolment notice","postponement":"Postponement notice","opt-in":"Opt-in confirmation","opt-out":"Opt-out confirmation","cessation":"Cessation confirmation","re-enrolment":"Automatic re-enrolment notice"}[letterType]!;
    const effective=membership.enrolmentDate||membership.postponementEnd||membership.optOutDate||new Date().toISOString().slice(0,10);
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:18mm}body{font:15px Arial;color:#17313b;line-height:1.55;max-width:760px;margin:40px auto}header{border-bottom:6px solid #087b79;padding-bottom:18px}h1{margin-top:42px}.details{background:#f2f7f7;padding:18px;margin:24px 0}footer{margin-top:70px;color:#60757d}</style></head><body><header><b>PayFlow · Workplace pension communication</b></header><h1>${escapeHtml(title)}</h1><p>Dear ${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)},</p><p>This letter confirms your workplace pension position with <b>${escapeHtml(membership.schemeName)}</b>, administered through ${escapeHtml(membership.provider)}.</p><div class="details"><b>Status:</b> ${escapeHtml(membership.membershipStatus)}<br><b>Effective date:</b> ${escapeHtml(effective)}<br><b>Payroll ID:</b> ${escapeHtml(employee.payrollId)}</div><p>Your statutory right to opt in, join, or opt out depends on your worker category and applicable time limits. Contact your employer if any details are incorrect.</p><footer>Generated ${escapeHtml(new Date().toISOString().slice(0,10))} from the stored pension membership record.</footer></body></html>`;
    const issuedAt=new Date().toISOString(),payloadChecksum=await sha256(html);
    const [communication]=await db.insert(submissions).values({employerId,type:"PENSION-LETTER",payload:JSON.stringify({schemaVersion:"payflow-pension-letter-1",membershipId:membership.id,payrollId,letterType,effectiveDate:effective,issuedAt,payloadChecksum}),payloadChecksum,preparedAt:issuedAt,status:"issued",response:"Pension communication generated locally."}).returning();
    await db.update(pensionMemberships).set({lastCommunicationDate:issuedAt.slice(0,10),updatedAt:issuedAt}).where(eq(pensionMemberships.id,membership.id));
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`generated:pension-letter:${letterType}`,entityType:"submission",entityId:String(communication.id),after:JSON.stringify({membershipId:membership.id,payrollId,payloadChecksum,issuedAt})});
    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","content-disposition":`attachment; filename="${letterType}-${payrollId}.html"`,"x-payflow-submission-id":String(communication.id)}});
  }
  if(input.action==="record-declaration"){
    const schemeId=Number(input.schemeId),declarationDate=String(input.declarationDate||""),reference=String(input.reference||"").trim();
    if(!Number.isInteger(schemeId)||schemeId<1)return NextResponse.json({error:"Choose an active pension scheme."},{status:422});
    const [scheme]=await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.id,schemeId),eq(pensionSchemes.employerId,employerId),eq(pensionSchemes.status,"active"))).limit(1);
    if(!scheme)return NextResponse.json({error:"The active pension scheme was not found for this employer."},{status:404});
    if(!validIso(declarationDate))return NextResponse.json({error:"Enter the date the declaration was filed."},{status:422});
    if(scheme.dutiesStartDate&&declarationDate<scheme.dutiesStartDate)return NextResponse.json({error:"The filing date cannot be before the recorded duties start date."},{status:422});
    if(reference.length<3||reference.length>100)return NextResponse.json({error:"Enter the external declaration acknowledgement reference (3 to 100 characters)."},{status:422});
    if(input.confirmed!==true)return NextResponse.json({error:"Confirm that the declaration was filed outside PayFlow and the acknowledgement was checked."},{status:422});
    const prior=(await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"PENSION-DECLARATION")))).filter(row=>{try{return Number(JSON.parse(row.payload||"{}").schemeId)===schemeId&&row.status==="recorded";}catch{return false;}});
    const exactPrior=prior.find(row=>{try{const evidence=JSON.parse(row.payload||"{}");return evidence.declarationDate===declarationDate&&evidence.reference===reference;}catch{return false;}});
    if(exactPrior)return NextResponse.json({error:`This pension declaration acknowledgement is already recorded as submission ${exactPrior.id}.`},{status:409});
    const recordedAt=new Date().toISOString(),payload={schemaVersion:"payflow-pension-declaration-1",schemeId,provider:scheme.provider,schemeName:scheme.schemeName,employerReference:scheme.employerReference,dutiesStartDate:scheme.dutiesStartDate,nextReenrolmentDate:scheme.nextReenrolmentDate,declarationDueDate:scheme.declarationDueDate,declarationDate,reference,externalFiling:true,recordedAt,recordedBy:access.user.displayName};
    const payloadChecksum=await sha256(JSON.stringify(payload));
    for(const row of prior)await db.update(submissions).set({status:"superseded",response:`Superseded by corrected declaration evidence recorded ${recordedAt}.`,updatedAt:recordedAt}).where(and(eq(submissions.id,row.id),eq(submissions.employerId,employerId)));
    const [filing]=await db.insert(submissions).values({employerId,type:"PENSION-DECLARATION",dueDate:scheme.declarationDueDate,payload:JSON.stringify(payload),payloadChecksum,preparedAt:recordedAt,submittedAt:declarationDate,status:"recorded",response:"External declaration filing and acknowledgement recorded; PayFlow did not transmit this declaration."}).returning();
    await db.update(pensionSchemes).set({declarationStatus:"filed"}).where(and(eq(pensionSchemes.id,schemeId),eq(pensionSchemes.employerId,employerId)));
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"recorded:pension-declaration",entityType:"submission",entityId:String(filing.id),after:JSON.stringify({schemeId,declarationDate,reference,payloadChecksum,supersededEvidence:prior.map(row=>row.id),externalFiling:true})});
    return NextResponse.json({...filing,payload:undefined,declarationDate,reference,payloadChecksum,supersededEvidence:prior.map(row=>row.id)},{status:201});
  }
  if(input.action==="save-scheme") {
    const employeeRate=Number(input.employeeRate),employerRate=Number(input.employerRate);
    if(!String(input.provider||"").trim()||!String(input.schemeName||"").trim())return NextResponse.json({error:"Provider and scheme name are required."},{status:422});
    if(!Number.isFinite(employeeRate)||employeeRate<0||employeeRate>100||!Number.isFinite(employerRate)||employerRate<0||employerRate>100)return NextResponse.json({error:"Contribution rates must be between 0% and 100%."},{status:422});
    if(typeof input.automaticEnrolmentScheme!=="boolean")return NextResponse.json({error:"Specify whether this is an automatic-enrolment scheme."},{status:422});
    const automaticEnrolmentScheme=input.automaticEnrolmentScheme;
    if(automaticEnrolmentScheme&&(employerRate<3||employeeRate+employerRate<8))return NextResponse.json({error:"An automatic-enrolment qualifying-earnings scheme needs at least 3% employer and 8% total contributions."},{status:422});
    const dutiesStartDate=String(input.dutiesStartDate||""),nextReenrolmentDate=String(input.nextReenrolmentDate||"");
    const certificationDate=String(input.certificationDate||""),declarationDueDate=String(input.declarationDueDate||"");
    const effectiveDate=String(input.effectiveDate||new Date().toISOString().slice(0,10));
    if(dutiesStartDate&&!validIso(dutiesStartDate))return NextResponse.json({error:"Enter a valid duties start date."},{status:422});
    if(nextReenrolmentDate&&!validIso(nextReenrolmentDate))return NextResponse.json({error:"Enter a valid next re-enrolment date."},{status:422});
    if(certificationDate&&!validIso(certificationDate))return NextResponse.json({error:"Enter a valid certification date."},{status:422});
    if(declarationDueDate&&!validIso(declarationDueDate))return NextResponse.json({error:"Enter a valid declaration due date."},{status:422});
    if(!validIso(effectiveDate))return NextResponse.json({error:"Enter a valid scheme-change effective date."},{status:422});
    const contributionDueDay=Number(input.contributionDueDay??22);
    if(!Number.isInteger(contributionDueDay)||contributionDueDay<1||contributionDueDay>28)return NextResponse.json({error:"Contribution due day must be a whole number between 1 and 28."},{status:422});
    const schemeId=Number(input.schemeId||0);
    const [ownedForStatus]=schemeId?await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.id,schemeId),eq(pensionSchemes.employerId,employerId))).limit(1):[];
    const values={
      employerId,provider:String(input.provider).trim(),schemeName:String(input.schemeName).trim(),employerReference:input.employerReference||null,
      employeeRate,employerRate,earningsBasis:input.earningsBasis==="gross"?"gross":"qualifying",
      taxRelief:input.taxRelief==="net-pay"?"net-pay":"relief-at-source",automaticEnrolmentScheme,
      certificationDate:certificationDate||null,dutiesStartDate:dutiesStartDate||null,nextReenrolmentDate:nextReenrolmentDate||null,
      declarationDueDate:declarationDueDate||null,declarationStatus:ownedForStatus?.declarationStatus==="filed"&&ownedForStatus.declarationDueDate===(declarationDueDate||null)?"filed":"not-filed",
      contributionDueDay,
      status:input.status==="inactive"?"inactive":"active",
    };
    const [priorActive]=await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.employerId,employerId),eq(pensionSchemes.status,"active"))).limit(1);
    if(schemeId) {
      const [owned]=await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.id,schemeId),eq(pensionSchemes.employerId,employerId))).limit(1);
      if(!owned)return NextResponse.json({error:"Pension scheme was not found for this employer."},{status:404});
      if(values.status==="active")await db.update(pensionSchemes).set({status:"inactive"}).where(eq(pensionSchemes.employerId,employerId));
      const [updated]=await db.update(pensionSchemes).set(values).where(and(eq(pensionSchemes.id,schemeId),eq(pensionSchemes.employerId,employerId))).returning();
      await db.insert(auditLog).values({
        employerId,actor:access.user.email,action:"pension:scheme-update",entityType:"pension-scheme",entityId:String(schemeId),
        before:JSON.stringify(owned),after:JSON.stringify(updated),
      });
      const supersededPackages=await supersedeProviderPackages(employerId,`Superseded because pension scheme ${schemeId} was updated.`,payload=>Array.isArray(payload.schemeIds)&&payload.schemeIds.includes(schemeId));
      return NextResponse.json({...updated,supersededPackages});
    }
    if(values.status==="active")await db.update(pensionSchemes).set({status:"inactive"}).where(eq(pensionSchemes.employerId,employerId));
    const [created]=await db.insert(pensionSchemes).values(values).returning();
    let transferredMemberships=0;
    if(values.status==="active"&&priorActive&&priorActive.id!==created.id){
      const priorMemberships=await db.select().from(pensionMemberships).where(eq(pensionMemberships.schemeId,priorActive.id));
      for(const prior of priorMemberships){
        const [replacement]=await db.insert(pensionMemberships).values({
          schemeId:created.id,employeeId:prior.employeeId,assessmentStatus:prior.assessmentStatus,membershipStatus:prior.membershipStatus,
          enrolmentDate:prior.enrolmentDate,postponementEnd:prior.postponementEnd,postponementNoticeDate:prior.postponementNoticeDate,optOutDate:prior.optOutDate,
          enrolmentInformationDate:prior.enrolmentInformationDate,optOutNoticeDate:prior.optOutNoticeDate,optOutNoticeValid:prior.optOutNoticeValid,
          ceasedDate:prior.ceasedDate,lastReenrolmentDate:prior.lastReenrolmentDate,
          employeeRefundDue:prior.employeeRefundDue,employerRefundDue:prior.employerRefundDue,
          employerContributionRequired:prior.employerContributionRequired,communicationDueDate:prior.communicationDueDate,lastCommunicationDate:prior.lastCommunicationDate,
        }).returning();
        await db.update(pensionMemberships).set({membershipStatus:"transferred",ceasedDate:effectiveDate,updatedAt:new Date().toISOString()}).where(eq(pensionMemberships.id,prior.id));
        await db.insert(pensionMembershipEvents).values({
          employerId,membershipId:replacement.id,employeeId:prior.employeeId,schemeId:created.id,eventType:"scheme-transfer",
          effectiveDate,previousStatus:prior.membershipStatus,newStatus:replacement.membershipStatus,
          details:JSON.stringify({fromSchemeId:priorActive.id,toSchemeId:created.id}),createdBy:access.user.email,
        });
        transferredMemberships++;
      }
      await db.insert(auditLog).values({employerId,actor:access.user.email,action:"pension:scheme-switch",entityType:"pension-scheme",entityId:String(created.id),before:JSON.stringify(priorActive),after:JSON.stringify({created,transferredMemberships})});
    }
    return NextResponse.json({...created,transferredMemberships},{status:201});
  }
  const action=String(input.action||"assess");
  if(!["assess","postpone","opt-out","cease","opt-in","join","re-enrol"].includes(action))return NextResponse.json({error:"Unsupported pension membership action."},{status:422});
  const employee = await employeeForEmployer(db, employerId, String(input.payrollId || ""));
  if (!employee.length) return NextResponse.json({ error: "Save the employee before pension assessment." }, { status: 404 });
  if(employee[0].confidential&&!access.membership.canViewConfidential)return NextResponse.json({ error: "Save the employee before pension assessment." }, { status: 404 });
  const assessmentDate=String(input.assessmentDate||new Date().toISOString().slice(0,10));
  if(!validIso(assessmentDate))return NextResponse.json({error:"Assessment date must be a valid calendar date."},{status:422});
  if(!employee[0].dateOfBirth)return NextResponse.json({error:"Date of birth is required for pension assessment."},{status:422});
  const birth=new Date(`${employee[0].dateOfBirth}T00:00:00Z`),at=new Date(`${assessmentDate}T00:00:00Z`);
  if(!Number.isFinite(birth.getTime())||!Number.isFinite(at.getTime())||birth>at)return NextResponse.json({error:"Enter valid employee and assessment dates."},{status:422});
  const age=at.getUTCFullYear()-birth.getUTCFullYear()-(at.getUTCMonth()<birth.getUTCMonth()||(at.getUTCMonth()===birth.getUTCMonth()&&at.getUTCDate()<birth.getUTCDate())?1:0);
  const periodNumber=Number(input.periodNumber||0),taxYear=String(input.taxYear||"2026/27");
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  if(input.periodNumber!==undefined&&input.periodNumber!==null&&input.periodNumber!==""&&(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>paySchedule.length))return NextResponse.json({error:`Assessment payroll period must be a whole number between 1 and ${paySchedule.length}.`},{status:422});
  let periodEarnings=Number(input.earnings??input.monthlyEarnings??0);
  if(!Number.isFinite(periodEarnings)||periodEarnings<0)return NextResponse.json({error:"Pay-period earnings must be a valid non-negative amount."},{status:422});
  if(periodNumber){
    const [run]=await db.select({grossPay:payRuns.grossPay,payDate:payPeriods.payDate}).from(payRuns).innerJoin(payPeriods,eq(payRuns.payPeriodId,payPeriods.id)).where(and(
      eq(payRuns.employeeId,employee[0].id),eq(payRuns.status,"finalised"),eq(payPeriods.employerId,employerId),
      eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber),
    )).limit(1);
    if(!run)return NextResponse.json({error:`A finalised pay run is required for pension assessment in period ${periodNumber}.`},{status:409});
    if(action==="assess"&&assessmentDate!==run.payDate)return NextResponse.json({error:`Period ${periodNumber} pension assessment must use its authoritative pay date ${run.payDate}.`},{status:422});
    periodEarnings=run.grossPay;
  }
  let scheme = await db.select().from(pensionSchemes).where(and(eq(pensionSchemes.employerId, employerId),eq(pensionSchemes.status,"active"))).limit(1);
  if (!scheme.length)return NextResponse.json({error:"Create and activate a workplace pension scheme before assessing employees."},{status:409});
  const assessment = assessPension({ age, earnings:periodEarnings, payFrequency, employeeRate: scheme[0].employeeRate, employerRate: scheme[0].employerRate });
  let membershipStatus = action === "postpone" ? "postponed"
    : action === "opt-out" ? "opted-out"
    : action === "cease" ? "ceased"
    : ["opt-in","join","re-enrol"].includes(action) ? "active"
    : assessment.action === "enrol" ? "active" : "not-enrolled";
  if(membershipStatus==="postponed"&&(!input.postponementEnd||String(input.postponementEnd)<=assessmentDate))return NextResponse.json({error:"Postponement end date must be after the assessment date."},{status:422});
  if(membershipStatus==="postponed"&&String(input.postponementEnd)>addCalendarMonths(assessmentDate,3))return NextResponse.json({error:"Postponement cannot exceed three calendar months."},{status:422});
  const existing = await db.select().from(pensionMemberships)
    .where(and(eq(pensionMemberships.schemeId, scheme[0].id), eq(pensionMemberships.employeeId, employee[0].id))).limit(1);
  if(action==="assess"&&existing[0]?.membershipStatus==="active")membershipStatus="active";
  if(action==="assess"&&existing[0]&&["opted-out","ceased"].includes(existing[0].membershipStatus)) {
    membershipStatus=existing[0].membershipStatus;
  }
  if(action==="postpone"&&existing[0]?.membershipStatus==="active")return NextResponse.json({error:"An active member cannot be postponed. Use postponement before automatic enrolment starts."},{status:409});
  if(action==="postpone"&&assessment.action!=="enrol")return NextResponse.json({error:"Postponement applies when automatic-enrolment duties first arise for an eligible jobholder."},{status:409});
  if(action==="join"&&assessment.category!=="entitled-worker")return NextResponse.json({error:"The join action is reserved for entitled workers; use opt-in for a jobholder."},{status:409});
  if(action==="opt-in"&&assessment.category==="entitled-worker")return NextResponse.json({error:"An entitled worker joins rather than opts in."},{status:409});
  if(["opt-in","join"].includes(action)&&existing[0]?.membershipStatus==="active")return NextResponse.json({error:"The employee already has active pension membership."},{status:409});
  if(action==="opt-out"&&(!existing[0]||existing[0].membershipStatus!=="active"||!existing[0].enrolmentDate))return NextResponse.json({error:"An employee can only opt out after active membership has started."},{status:409});
  if(action==="cease"&&(!existing[0]||existing[0].membershipStatus!=="active"))return NextResponse.json({error:"Only an active pension membership can be ceased."},{status:409});
  if(action==="re-enrol"&&(!existing[0]||!["opted-out","ceased","not-enrolled"].includes(existing[0].membershipStatus)))return NextResponse.json({error:"Re-enrolment applies to an employee who previously left or was not enrolled."},{status:409});
  if(action==="re-enrol"&&existing[0]&&assessmentDate<=String(existing[0].optOutDate||existing[0].ceasedDate||""))return NextResponse.json({error:"Re-enrolment date must be after the employee left the scheme."},{status:422});
  if(action==="re-enrol"&&scheme[0].nextReenrolmentDate){
    const earliest=addCalendarMonths(scheme[0].nextReenrolmentDate,-3),latest=addCalendarMonths(scheme[0].nextReenrolmentDate,3);
    if(assessmentDate<earliest||assessmentDate>latest)return NextResponse.json({error:`Re-enrolment must fall within the permitted window ${earliest} to ${latest}.`},{status:409});
  }
  let employeeRefundDue=existing[0]?.employeeRefundDue||0,employerRefundDue=existing[0]?.employerRefundDue||0;
  const enrolmentInformationDate=String(input.enrolmentInformationDate||existing[0]?.enrolmentInformationDate||assessmentDate);
  const postponementNoticeDate=action==="postpone"?String(input.postponementNoticeDate||""):existing[0]?.postponementNoticeDate||null;
  if(action==="postpone"&&(!validIso(postponementNoticeDate!)||postponementNoticeDate!<assessmentDate||postponementNoticeDate!>addDays(assessmentDate,43)))return NextResponse.json({error:`The postponement notice must be issued between ${assessmentDate} and ${addDays(assessmentDate,43)}.`},{status:422});
  const optOutNoticeDate=action==="opt-out"?String(input.optOutNoticeDate||assessmentDate):existing[0]?.optOutNoticeDate||null;
  const optOutNoticeValid=action==="opt-out"?input.optOutNoticeValid===true:existing[0]?.optOutNoticeValid||false;
  if(action==="opt-out"&&existing[0]) {
    if(!optOutNoticeValid)return NextResponse.json({error:"A valid provider-issued opt-out notice must be recorded."},{status:422});
    const windowStart=[existing[0].enrolmentDate!,enrolmentInformationDate].sort().at(-1)!;
    const windowEnd=addCalendarMonths(windowStart,1);
    if(String(optOutNoticeDate)<windowStart||String(optOutNoticeDate)>windowEnd)return NextResponse.json({error:`The statutory opt-out window ran from ${windowStart} to ${windowEnd}. Use cessation outside this window.`},{status:409});
    const prior=await db.select({
      employeePension:payRuns.employeePension,employerPension:payRuns.employerPension,
      pensionSchemeId:payRuns.pensionSchemeId,payDate:payPeriods.payDate,
    }).from(payRuns).innerJoin(payPeriods,eq(payRuns.payPeriodId,payPeriods.id)).where(and(eq(payRuns.employeeId,employee[0].id),eq(payRuns.status,"finalised")));
    const refundable=prior.filter(row=>row.payDate!==null&&row.payDate>=windowStart&&row.payDate<=String(optOutNoticeDate)&&(!row.pensionSchemeId||row.pensionSchemeId===scheme[0].id));
    employeeRefundDue=Math.round(refundable.reduce((sum,row)=>sum+Math.max(0,row.employeePension),0)*100)/100;
    employerRefundDue=Math.round(refundable.reduce((sum,row)=>sum+Math.max(0,row.employerPension),0)*100)/100;
  }
  const startsActiveMembership=membershipStatus==="active"&&existing[0]?.membershipStatus!=="active";
  const values = {
    schemeId: scheme[0].id, employeeId: employee[0].id, assessmentStatus: assessment.category,
    membershipStatus,
    enrolmentDate: membershipStatus === "active"
      ? (action==="assess"&&existing[0]?.membershipStatus==="active" ? existing[0].enrolmentDate||assessmentDate : assessmentDate)
      : existing[0]?.enrolmentDate||null,
    postponementEnd: membershipStatus === "postponed" ? String(input.postponementEnd) : null,
    postponementNoticeDate,
    optOutDate: membershipStatus === "opted-out" ? optOutNoticeDate : existing[0]?.optOutDate||null,
    enrolmentInformationDate:membershipStatus==="active"?enrolmentInformationDate:existing[0]?.enrolmentInformationDate||null,
    optOutNoticeDate,optOutNoticeValid,
    ceasedDate:membershipStatus==="ceased"?(action==="cease"?assessmentDate:existing[0]?.ceasedDate||assessmentDate):existing[0]?.ceasedDate||null,
    lastReenrolmentDate:action==="re-enrol"?assessmentDate:existing[0]?.lastReenrolmentDate||null,
    employeeRefundDue,employerRefundDue,
    employerContributionRequired:action==="join"?false:["opt-in","re-enrol"].includes(action)||(action==="assess"&&!existing[0]&&assessment.action==="enrol")?true:existing[0]?.employerContributionRequired??true,
    communicationDueDate:action==="postpone"
      ? addDays(assessmentDate,42)
      : startsActiveMembership
        ? addDays(assessmentDate,42)
        : membershipStatus==="active"&&!existing[0]?.communicationDueDate
          ? addDays(existing[0]?.enrolmentDate||assessmentDate,42)
          : existing[0]?.communicationDueDate||null,
    lastCommunicationDate:existing[0]?.lastCommunicationDate||null,
  };
  const [membership] = existing.length
    ? await db.update(pensionMemberships).set(values).where(eq(pensionMemberships.id, existing[0].id)).returning()
    : await db.insert(pensionMemberships).values(values).returning();
  const eventDetails={assessment:assessment.category,postponementEnd:values.postponementEnd,postponementNoticeDate,optOutNoticeDate,employerContributionRequired:values.employerContributionRequired,communicationDueDate:values.communicationDueDate,refund:{employeeRefundDue,employerRefundDue}};
  const sameDateAssessments=action==="assess"?await db.select().from(pensionMembershipEvents).where(and(
    eq(pensionMembershipEvents.membershipId,membership.id),eq(pensionMembershipEvents.eventType,"assess"),eq(pensionMembershipEvents.effectiveDate,assessmentDate),
  )):[];
  const unchangedAssessment=sameDateAssessments.some(event=>{try{const details=JSON.parse(event.details||"{}");return details.assessment===assessment.category&&event.newStatus===membershipStatus;}catch{return false;}});
  if(!unchangedAssessment){
    await db.insert(pensionMembershipEvents).values({
      employerId,membershipId:membership.id,employeeId:employee[0].id,schemeId:scheme[0].id,eventType:action,
      effectiveDate:assessmentDate,previousStatus:existing[0]?.membershipStatus||null,newStatus:membershipStatus,
      details:JSON.stringify(eventDetails),createdBy:access.user.email,
    });
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:`pension:${action}`,entityType:"pension-membership",entityId:String(membership.id),before:existing[0]?JSON.stringify(existing[0]):null,after:JSON.stringify(membership)});
  }
  return NextResponse.json({ assessment, membership, scheme: scheme[0] }, { status: existing.length ? 200 : 201 });
}
