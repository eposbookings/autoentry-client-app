import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employers, statutoryNotices } from "../../../db/schema";
import { assessStatutoryEligibility } from "../../../lib/statutory-eligibility";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const validIsoDate=(value:unknown)=>{
  const text=String(value||""),timestamp=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===text;
};
type NoticeSnapshot={schemaVersion:string;employee:{payrollId:string;firstName:string;lastName:string;niNumber:string|null;address:string|null;postcode:string|null};employer:{name:string;legalName:string|null;payeReference:string|null;address:string|null;postcode:string|null};formType:string;statutoryType:string;decisionDate:string;payStartDate:string;payEndDate:string|null;reasonCode:string;reason:string;averageWeeklyEarnings:number;continuousEmploymentWeeks:number;evidenceReceived:boolean;noticeReceived:boolean;issuedAt:string};
const snapshot=(value:unknown):NoticeSnapshot|null=>{try{return value?JSON.parse(String(value)) as NoticeSnapshot:null;}catch{return null;}};
const formTitles:Record<string,string>={
  SMP1:"Statutory Maternity Pay non-payment record",SPP1:"Statutory Paternity Pay non-payment record",
  SAP1:"Statutory Adoption Pay non-payment record",SSP1:"Statutory Sick Pay entitlement record",
  SPBP1:"Statutory Parental Bereavement Pay non-payment record",
  NEO1:"Statutory Neonatal Care Pay non-payment working record","written statement":"Statutory pay non-payment written statement",
};

async function scopedRows(employerId:number){
  return getDb().select({
    id:statutoryNotices.id,employeeId:statutoryNotices.employeeId,payrollId:employees.payrollId,
    firstName:employees.firstName,lastName:employees.lastName,niNumber:employees.niNumber,address:employees.address,
    postcode:employees.postcode,formType:statutoryNotices.formType,statutoryType:statutoryNotices.statutoryType,
    decisionDate:statutoryNotices.decisionDate,payStartDate:statutoryNotices.payStartDate,payEndDate:statutoryNotices.payEndDate,
    reasonCode:statutoryNotices.reasonCode,reason:statutoryNotices.reason,
    averageWeeklyEarnings:statutoryNotices.averageWeeklyEarnings,continuousEmploymentWeeks:statutoryNotices.continuousEmploymentWeeks,
    evidenceReceived:statutoryNotices.evidenceReceived,noticeReceived:statutoryNotices.noticeReceived,
    status:statutoryNotices.status,issuedAt:statutoryNotices.issuedAt,employeeSnapshot:statutoryNotices.employeeSnapshot,
    payloadChecksum:statutoryNotices.payloadChecksum,cancellationReason:statutoryNotices.cancellationReason,confidential:employees.confidential,
  }).from(statutoryNotices).innerJoin(employees,eq(statutoryNotices.employeeId,employees.id))
    .where(eq(employees.employerId,employerId)).orderBy(desc(statutoryNotices.id));
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),id=Number(url.searchParams.get("id")||0),format=url.searchParams.get("format");
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=(await scopedRows(employerId)).filter(r=>(access.membership.canViewConfidential||!r.confidential)&&(!id||r.id===id));
  if(id&&!rows.length)return NextResponse.json({error:"Statutory notice was not found for this employer."},{status:404});
  if(format!=="html")return NextResponse.json(rows);
  if(rows.length!==1)return NextResponse.json({error:"Choose one statutory notice to print."},{status:400});
  const row=rows[0],[currentEmployer]=await getDb().select().from(employers).where(eq(employers.id,employerId)).limit(1),frozen=snapshot(row.employeeSnapshot);
  if(row.employeeSnapshot){
    const checksum=await sha256(String(row.employeeSnapshot));
    if(!frozen||!row.payloadChecksum||checksum!==row.payloadChecksum)return NextResponse.json({error:"The frozen statutory-notice evidence is incomplete or has failed its checksum. The document cannot be printed."},{status:409});
  }
  const employee=frozen?.employee||row,employer=frozen?.employer||currentEmployer,title=formTitles[row.formType]||"Statutory pay non-payment record";
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(row.formType)} ${esc(employee.firstName)} ${esc(employee.lastName)}</title><style>@page{size:A4;margin:14mm}body{font:14px Arial;color:#17313b;margin:auto;max-width:185mm}header{border-top:8px solid #087b79;padding-top:18px;display:flex;justify-content:space-between}h1{font-size:30px}.box{border:1px solid #b9c9ce;padding:14px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.label{font-size:11px;color:#60757d;text-transform:uppercase}.value{font-size:16px;font-weight:700;margin-top:4px}.reason{background:#f1f6f6;border-left:5px solid #087b79;padding:16px}.signature{margin-top:55px;border-top:1px solid #71858d;padding-top:8px;width:55%}footer{margin-top:35px;color:#60757d;font-size:11px}</style></head><body><header><b>PayFlow · ${esc(employer?.name)}</b><b>${esc(row.formType)}</b></header><h1>${esc(title)}</h1><p>This record explains why ${esc(employer?.name)} cannot pay, or cannot continue paying, ${esc(row.statutoryType)} statutory pay.</p><div class="box grid"><div><div class="label">Employee</div><div class="value">${esc(employee.firstName)} ${esc(employee.lastName)}</div></div><div><div class="label">National Insurance number</div><div class="value">${esc(employee.niNumber||"Not recorded")}</div></div><div><div class="label">Payroll ID</div><div class="value">${esc(employee.payrollId)}</div></div><div><div class="label">Decision date</div><div class="value">${esc(row.decisionDate)}</div></div><div><div class="label">Pay period requested</div><div class="value">${esc(row.payStartDate)}${row.payEndDate?` to ${esc(row.payEndDate)}`:""}</div></div><div><div class="label">Average weekly earnings</div><div class="value">£${row.averageWeeklyEarnings.toFixed(2)}</div></div></div><div class="reason"><div class="label">Reason for non-payment</div><div class="value">${esc(row.reason)}</div></div><p>Give this record to the employee and retain a copy with the payroll records. Where HMRC or DWP prescribes an official form, transfer these reconciled details to the current official form before issue.</p><div class="signature">Authorised employer signature / date</div><footer>Evidence frozen ${esc(row.issuedAt||row.decisionDate)} · PAYE reference ${esc(employer?.payeReference||"Not recorded")} · SHA-256 ${esc(row.payloadChecksum||"Legacy record—checksum unavailable")}</footer></body></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","content-disposition":`attachment; filename="${row.formType}-${row.payrollId}.html"`,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'","x-payflow-source-checksum":row.payloadChecksum||"legacy"}});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON statutory-notice object is required."},{status:400});
  const employerId=Number(input.employerId),payrollId=String(input.payrollId||""),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  if(!validIsoDate(input.payStartDate)||input.payEndDate&&!validIsoDate(input.payEndDate)||input.payEndDate&&String(input.payEndDate)<String(input.payStartDate))return NextResponse.json({error:"Enter a valid statutory-pay date range."},{status:422});
  if(input.decisionDate&&!validIsoDate(input.decisionDate))return NextResponse.json({error:"Decision date must be a valid calendar date."},{status:422});
  const averageWeeklyEarnings=Number(input.averageWeeklyEarnings||0);
  if(!Number.isFinite(averageWeeklyEarnings)||averageWeeklyEarnings<0)return NextResponse.json({error:"Average weekly earnings must be a valid non-negative amount."},{status:422});
  const assessment=assessStatutoryEligibility({
    statutoryType:String(input.statutoryType||""),averageWeeklyEarnings,
    continuousEmploymentWeeks:Math.max(0,Math.floor(Number(input.continuousEmploymentWeeks||0))),
    evidenceReceived:Boolean(input.evidenceReceived),noticeReceived:Boolean(input.noticeReceived),
    inLegalCustody:Boolean(input.inLegalCustody),sspEnding:Boolean(input.sspEnding),
  });
  if(assessment.eligible)return NextResponse.json({error:"The recorded checks show that the employee is eligible; a non-payment notice cannot be issued.",assessment},{status:409});
  const [duplicate]=await db.select({id:statutoryNotices.id}).from(statutoryNotices).where(and(
    eq(statutoryNotices.employeeId,employee.id),eq(statutoryNotices.formType,assessment.formType),
    eq(statutoryNotices.payStartDate,String(input.payStartDate)),eq(statutoryNotices.status,"issued"),
  )).limit(1);
  if(duplicate)return NextResponse.json({error:"An issued statutory non-payment notice already exists for this employee, form and start date."},{status:409});
  const issuedAt=new Date().toISOString(),decisionDate=String(input.decisionDate||issuedAt.slice(0,10));
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  const employeeSnapshot:NoticeSnapshot={schemaVersion:"payflow-statutory-notice-1",employee:{payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,niNumber:employee.niNumber,address:employee.address,postcode:employee.postcode},employer:{name:employer.name,legalName:employer.legalName,payeReference:employer.payeReference,address:employer.address,postcode:employer.postcode},formType:assessment.formType,statutoryType:String(input.statutoryType),decisionDate,payStartDate:String(input.payStartDate),payEndDate:input.payEndDate?String(input.payEndDate):null,reasonCode:assessment.reasonCode,reason:assessment.reason,averageWeeklyEarnings,continuousEmploymentWeeks:Math.max(0,Math.floor(Number(input.continuousEmploymentWeeks||0))),evidenceReceived:Boolean(input.evidenceReceived),noticeReceived:Boolean(input.noticeReceived),issuedAt};
  const serializedSnapshot=JSON.stringify(employeeSnapshot),payloadChecksum=await sha256(serializedSnapshot);
  const [created]=await db.insert(statutoryNotices).values({
    employeeId:employee.id,formType:assessment.formType,statutoryType:String(input.statutoryType),
    decisionDate,payStartDate:String(input.payStartDate),
    payEndDate:input.payEndDate||null,reasonCode:assessment.reasonCode,reason:assessment.reason,
    averageWeeklyEarnings,
    continuousEmploymentWeeks:Math.max(0,Math.floor(Number(input.continuousEmploymentWeeks||0))),
    evidenceReceived:Boolean(input.evidenceReceived),noticeReceived:Boolean(input.noticeReceived),
    status:"issued",issuedAt,employeeSnapshot:serializedSnapshot,payloadChecksum,
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`issued:${assessment.formType.toLowerCase()}`,entityType:"statutory-notice",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json({...created,assessment},{status:201});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON statutory-notice update object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"employee-write");if(!access.ok)return access.response;
  const owned=(await scopedRows(employerId)).find(r=>r.id===id&&(access.membership.canViewConfidential||!r.confidential));
  if(!owned)return NextResponse.json({error:"Statutory notice was not found for this employer."},{status:404});
  const status=String(input.status||"");
  const transitions:Record<string,string[]>={issued:["delivered","cancelled"],delivered:["cancelled"],cancelled:[]};
  if(!transitions[owned.status]?.includes(status))return NextResponse.json({error:`A ${owned.status} statutory notice cannot move to ${status||"an unspecified status"}.`},{status:409});
  const reason=String(input.reason||"").trim();
  if(status==="cancelled"&&(reason.length<5||reason.length>500))return NextResponse.json({error:"Enter a cancellation reason between 5 and 500 characters."},{status:422});
  const now=new Date().toISOString();
  const [updated]=await db.update(statutoryNotices).set({status,cancellationReason:status==="cancelled"?reason:null,updatedAt:now}).where(eq(statutoryNotices.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`${status}:statutory-notice`,entityType:"statutory-notice",entityId:String(id),before:JSON.stringify({status:owned.status}),after:JSON.stringify({status,reason:reason||null})});
  return NextResponse.json(updated);
}
