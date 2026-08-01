import { NextResponse } from "next/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, cisPayments, employers, subcontractors, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { cisVerificationDecision } from "../../../lib/cis-verification";
import { validateCisFilingResult } from "../../../lib/cis-filing-result";
import { taxMonthRange } from "../../../lib/pay-periods";
import { validateCisPaymentEvidence } from "../../../lib/cis-payment-evidence";
import { validateCisImportRows } from "../../../lib/cis-import";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const allowedRates=[0,20,30];

const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const validDate=(value:string)=>{
  const time=/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(`${value}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
};
const validTaxMonth=(value:number)=>Number.isInteger(value)&&value>=1&&value<=12;
const cisDeadline=(taxYear:string,taxMonth:number)=>new Date(Date.UTC(Number(taxYear.slice(0,4)),3+taxMonth,19)).toISOString().slice(0,10);
const cleanUtr=(value:unknown)=>String(value||"").replace(/\s/g,"");
const html=(value:unknown)=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]||character));
const csv=(value:unknown)=>{
  let text=String(value??"");
  if(/^[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
};
const money=(value:unknown)=>Number(value||0).toFixed(2);
const documentHeaders=(filename:string,contentType:string,checksum:string)=>({
  "content-type":contentType,"content-disposition":`attachment; filename="${filename}"`,
  "cache-control":"private, no-store, max-age=0","pragma":"no-cache","x-content-type-options":"nosniff",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'","x-payflow-source-checksum":checksum,
});

async function supersedeCisArtifacts(employerId:number,taxYear:string,taxMonth:number,reason:string,subcontractorId?:number){
  const db=getDb(),rows=await db.select().from(submissions).where(eq(submissions.employerId,employerId));
  let returns=0,statements=0;
  for(const row of rows){
    if(row.type!=="CIS300"&&row.type!=="CIS-PDS")continue;
    if(row.type==="CIS300"&&!["validated","test-ready"].includes(row.status))continue;
    if(row.type==="CIS-PDS"&&row.status!=="issued")continue;
    let payload:any={};try{payload=JSON.parse(row.payload||"{}");}catch{continue;}
    if(payload.taxYear!==taxYear||Number(payload.taxMonth)!==taxMonth)continue;
    if(row.type==="CIS-PDS"&&subcontractorId&&Number(payload.statement?.subcontractorId)!==subcontractorId)continue;
    await db.update(submissions).set({status:"superseded",response:reason,updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,row.id),eq(submissions.employerId,employerId)));
    if(row.type==="CIS300")returns++;else statements++;
  }
  return {returns,statements};
}

async function cisReturn(employerId:number,taxYear:string,taxMonth:number) {
  const db=getDb();
  const subs=await db.select().from(subcontractors).where(eq(subcontractors.employerId,employerId));
  const subIds=new Set(subs.map(s=>s.id));
  const payments=(await db.select().from(cisPayments)).filter(p=>subIds.has(p.subcontractorId)&&p.taxYear===taxYear&&p.taxMonth===taxMonth&&p.status!=="voided");
  const statements=subs.map(sub=>{
    const rows=payments.filter(p=>p.subcontractorId===sub.id);
    const evidence=rows[0];
    const rates=[...new Set(rows.map(row=>row.deductionRate))];
    const verificationNumbers=[...new Set(rows.map(row=>row.verificationNumber).filter(Boolean))];
    return {
      subcontractorId:sub.id,name:evidence?.subcontractorName||sub.name,type:evidence?.subcontractorType||sub.type,
      utr:evidence?.subcontractorUtr||sub.utr,niNumber:evidence?.subcontractorNiNumber||sub.niNumber,
      companyNumber:evidence?.subcontractorCompanyNumber||sub.companyNumber,
      partnerUtr:evidence?.subcontractorPartnerUtr||sub.partnerUtr,verificationNumber:verificationNumbers.at(-1)||null,
      deductionRate:rates.length===1?rates[0]:null,deductionRates:rates,verificationNumbers,payments:rows.length,
      labour:round(rows.reduce((n,p)=>n+p.labour,0)),materials:round(rows.reduce((n,p)=>n+p.materials,0)),
      vat:round(rows.reduce((n,p)=>n+p.vat,0)),retention:round(rows.reduce((n,p)=>n+p.retention,0)),
      grossPayment:round(rows.reduce((n,p)=>n+p.labour+p.materials-p.retention,0)),
      deductibleAmount:round(rows.reduce((n,p)=>n+Math.max(0,p.labour-p.retention),0)),
      deduction:round(rows.reduce((n,p)=>n+p.deduction,0)),netPayment:round(rows.reduce((n,p)=>n+p.netPayment,0)),
    };
  }).filter(s=>s.payments>0);
  const totals={
    subcontractors:statements.length,payments:payments.length,
    labour:round(statements.reduce((n,s)=>n+s.labour,0)),materials:round(statements.reduce((n,s)=>n+s.materials,0)),
    vat:round(statements.reduce((n,s)=>n+s.vat,0)),retention:round(statements.reduce((n,s)=>n+s.retention,0)),
    grossPayment:round(statements.reduce((n,s)=>n+s.grossPayment,0)),deductibleAmount:round(statements.reduce((n,s)=>n+s.deductibleAmount,0)),
    deduction:round(statements.reduce((n,s)=>n+s.deduction,0)),netPayment:round(statements.reduce((n,s)=>n+s.netPayment,0)),
  };
  const validationErrors:string[]=[];
  for(const payment of payments){const error=validateCisPaymentEvidence(payment);if(error&&!validationErrors.includes(error))validationErrors.push(error);}
  if(!payments.length)validationErrors.push("No subcontractor payments are recorded for this tax month.");
  if(statements.some(s=>!s.utr))validationErrors.push("Every paid subcontractor must have a UTR.");
  if(statements.some(s=>s.type==="sole-trader"&&!/^[A-Z]{2}\d{6}[A-D]$/i.test(String(s.niNumber||"").replace(/\s/g,""))))validationErrors.push("Every paid sole trader must retain a valid National Insurance number.");
  if(statements.some(s=>s.type==="company"&&!/^[A-Z0-9]{8}$/i.test(String(s.companyNumber||"").replace(/\s/g,""))))validationErrors.push("Every paid company must retain a valid company registration number.");
  if(statements.some(s=>s.type==="partnership"&&!/^\d{10}$/.test(cleanUtr(s.partnerUtr))))validationErrors.push("Every paid partnership must retain its nominated partner UTR.");
  if(payments.some(payment=>payment.deductionRate!==0&&!payment.verificationNumber))validationErrors.push("Every deducted payment must retain its verification number.");
  if(payments.some(payment=>!allowedRates.includes(payment.deductionRate)))validationErrors.push("Every payment must retain a valid 0%, 20% or 30% verification rate.");
  if(statements.some(statement=>{
    const rows=payments.filter(payment=>payment.subcontractorId===statement.subcontractorId);
    return new Set(rows.map(payment=>JSON.stringify([
      payment.subcontractorName,payment.subcontractorType,payment.subcontractorUtr,payment.subcontractorNiNumber,
      payment.subcontractorCompanyNumber,payment.subcontractorPartnerUtr,
    ]))).size>1;
  }))validationErrors.push("A subcontractor has conflicting payment-time identity evidence in this tax month. Void and replace the affected payment before preparing CIS300.");
  const month=taxMonthRange(taxYear,taxMonth);
  if(payments.some(payment=>{const time=Date.parse(`${payment.paymentDate}T00:00:00Z`);return !validDate(payment.paymentDate)||time<month.start||time>month.end;}))validationErrors.push(`Every payment date must fall within CIS tax month ${taxMonth}.`);
  return {taxYear,taxMonth,statements,totals,validation:{valid:validationErrors.length===0,errors:validationErrors}};
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const employerId = Number(url.searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(url.searchParams.get("action")==="statement-document"){
    const id=Number(url.searchParams.get("id")),format=url.searchParams.get("format")==="csv"?"csv":"html";
    if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"Select a valid CIS statement."},{status:400});
    const db=getDb(),[record]=await db.select().from(submissions).where(and(
      eq(submissions.id,id),eq(submissions.employerId,employerId),eq(submissions.type,"CIS-PDS"),
    )).limit(1);
    if(!record)return NextResponse.json({error:"CIS statement was not found for this employer."},{status:404});
    let payload:any={};try{payload=JSON.parse(record.payload||"{}");}catch{return NextResponse.json({error:"The stored CIS statement is unreadable."},{status:409});}
    if(await sha256(JSON.stringify(payload))!==record.payloadChecksum)return NextResponse.json({error:"The stored CIS statement checksum does not match. Do not use this document."},{status:409});
    const statement=payload.statement||{},safeYear=String(payload.taxYear||"tax-year").replace("/","-"),filename=`CIS-statement-${id}-${safeYear}-M${Number(payload.taxMonth)||0}.${format}`;
    if(format==="csv"){
      const rows=[
        ["Document","CIS payment and deduction statement"],["Statement ID",id],["Contractor",payload.contractor?.name],["PAYE reference",payload.contractor?.payeReference],
        ["Tax year",payload.taxYear],["Tax month",payload.taxMonth],["Tax month end",payload.taxMonthEnd],["Subcontractor",statement.name],["UTR",statement.utr],
        ["Verification number",statement.verificationNumber],["Gross payment",money(statement.grossPayment)],["Materials",money(statement.materials)],
        ["Amount liable to deduction",money(statement.deductibleAmount)],["CIS deduction",money(statement.deduction)],["Net payment",money(statement.netPayment)],
        ["Duplicate",payload.duplicate?"Yes":"No"],["Duplicate of statement",payload.duplicatesSubmissionId||""],["Corrected replacement of statement",payload.replacesStatementId||""],["Issued at",payload.issuedAt],
        ["Source checksum",record.payloadChecksum],
      ];
      return new Response(rows.map(row=>row.map(csv).join(",")).join("\r\n"),{headers:documentHeaders(filename,"text/csv; charset=utf-8",record.payloadChecksum)});
    }
    const body=`<!doctype html><html><head><meta charset="utf-8"><title>CIS payment and deduction statement</title><style>body{font:15px Arial,sans-serif;color:#172033;max-width:820px;margin:40px auto;padding:0 24px}h1{color:#075985}header{border-bottom:3px solid #0284c7;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 32px}.box{background:#f4f8fb;border:1px solid #d8e2ea;border-radius:8px;padding:18px;margin:20px 0}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #d8e2ea;text-align:right}th:first-child,td:first-child{text-align:left}.notice{color:#8a4b08}.checksum{font:11px monospace;overflow-wrap:anywhere;color:#596577}@media print{body{margin:0}.no-print{display:none}}</style></head><body><header><h1>CIS payment and deduction statement</h1><p>${html(payload.contractor?.name)} · PAYE reference ${html(payload.contractor?.payeReference||"Not recorded")}</p></header>${payload.duplicate?`<p class="notice"><strong>Duplicate statement</strong>${payload.duplicatesSubmissionId?` of statement #${html(payload.duplicatesSubmissionId)}`:""}</p>`:""}${payload.replacesStatementId?`<p class="notice"><strong>Corrected replacement statement</strong> replacing statement #${html(payload.replacesStatementId)}</p>`:""}<div class="grid"><p><strong>Subcontractor</strong><br>${html(statement.name)}</p><p><strong>UTR</strong><br>${html(statement.utr)}</p><p><strong>Tax year / month</strong><br>${html(payload.taxYear)} · month ${html(payload.taxMonth)}</p><p><strong>Month ended</strong><br>${html(payload.taxMonthEnd)}</p><p><strong>Verification number</strong><br>${html(statement.verificationNumber||"Not applicable")}</p><p><strong>Issued</strong><br>${html(payload.issuedAt)}</p></div><div class="box"><table><tbody><tr><td>Gross payment</td><td>£${money(statement.grossPayment)}</td></tr><tr><td>Cost of materials</td><td>£${money(statement.materials)}</td></tr><tr><td>Amount liable to deduction</td><td>£${money(statement.deductibleAmount)}</td></tr><tr><td>CIS deduction</td><td><strong>£${money(statement.deduction)}</strong></td></tr><tr><td>Net payment</td><td>£${money(statement.netPayment)}</td></tr></tbody></table></div><p>This document was generated from the payment evidence frozen when statement #${id} was issued.</p><p class="checksum">Source checksum: ${html(record.payloadChecksum)}</p><button class="no-print" onclick="window.print()">Print / save as PDF</button></body></html>`;
    return new Response(body,{headers:documentHeaders(filename,"text/html; charset=utf-8",record.payloadChecksum)});
  }
  const taxYear=String(url.searchParams.get("taxYear")||"2026/27");
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:400});
  const taxMonthParam=url.searchParams.get("taxMonth");
  if(taxMonthParam!==null){
    const taxMonth=Number(taxMonthParam);
    if(!validTaxMonth(taxMonth))return NextResponse.json({error:"Tax month must be a whole number between 1 and 12."},{status:400});
    return NextResponse.json(await cisReturn(employerId,taxYear,taxMonth));
  }
  const db = getDb();
  const filingRows=await db.select({
    id:submissions.id,type:submissions.type,status:submissions.status,dueDate:submissions.dueDate,
    preparedAt:submissions.preparedAt,submittedAt:submissions.submittedAt,response:submissions.response,
    correlationId:submissions.correlationId,irMark:submissions.irMark,payloadChecksum:submissions.payloadChecksum,
    payload:submissions.payload,
  }).from(submissions).where(eq(submissions.employerId,employerId)).orderBy(desc(submissions.id));
  return NextResponse.json({
    subcontractors: await db.select().from(subcontractors).where(eq(subcontractors.employerId, employerId)).orderBy(desc(subcontractors.id)),
    payments: await db.select({
      id: cisPayments.id, subcontractorId: cisPayments.subcontractorId, taxYear:cisPayments.taxYear,taxMonth: cisPayments.taxMonth,
      deductionRate:cisPayments.deductionRate,verificationNumber:cisPayments.verificationNumber,
      verificationMethod:cisPayments.verificationMethod,verifiedAt:cisPayments.verifiedAt,
      paymentDate: cisPayments.paymentDate,invoiceNumber:cisPayments.invoiceNumber,paymentRecipient:cisPayments.paymentRecipient,
      materialsEvidence:cisPayments.materialsEvidence, labour: cisPayments.labour, materials: cisPayments.materials,
      subcontractorName:cisPayments.subcontractorName,subcontractorType:cisPayments.subcontractorType,
      subcontractorUtr:cisPayments.subcontractorUtr,subcontractorNiNumber:cisPayments.subcontractorNiNumber,
      subcontractorCompanyNumber:cisPayments.subcontractorCompanyNumber,subcontractorPartnerUtr:cisPayments.subcontractorPartnerUtr,
      vat: cisPayments.vat, retention: cisPayments.retention, deduction: cisPayments.deduction,
      netPayment: cisPayments.netPayment,replacesPaymentId:cisPayments.replacesPaymentId,voidReason:cisPayments.voidReason,status: cisPayments.status,
    }).from(cisPayments).innerJoin(subcontractors, eq(cisPayments.subcontractorId, subcontractors.id))
      .where(eq(subcontractors.employerId, employerId)).orderBy(desc(cisPayments.id)),
    filingHistory:filingRows.filter(row=>["CIS300","CIS-PDS"].includes(row.type)&&row.status!=="invalid").map(row=>{
      let payload:any={};try{payload=JSON.parse(row.payload||"{}");}catch{}
      const {payload:_,...publicRow}=row;
      return {...publicRow,amendsSubmissionId:payload.amendsSubmissionId||null,replacesSubmissionId:payload.replacesSubmissionId||payload.replacesStatementId||null,duplicatesSubmissionId:payload.duplicatesSubmissionId||null};
    }),
  });
}

export async function POST(request: Request) {
  const input = await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON CIS operation object is required."},{status:400});
  const db = getDb();
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(input.action==="import-subcontractors"){
    const validated=validateCisImportRows(input.rows);
    if(validated.errors.length)return NextResponse.json({
      error:"No subcontractors were imported because the file contains validation errors.",errors:validated.errors,
    },{status:422});
    const existing=await db.select({utr:subcontractors.utr}).from(subcontractors).where(eq(subcontractors.employerId,employerId));
    const existingUtrs=new Set(existing.map(row=>cleanUtr(row.utr)));
    const duplicateErrors=validated.values.flatMap((row,index)=>existingUtrs.has(row.utr)
      ?[`Row ${index+2}: a subcontractor with UTR ${row.utr} already exists for this employer.`]:[]);
    if(duplicateErrors.length)return NextResponse.json({
      error:"No subcontractors were imported because one or more UTRs already exist.",errors:duplicateErrors,
    },{status:409});
    const importedAt=new Date().toISOString(),importedValues=validated.values.map(row=>({
      employerId,...row,createdAt:importedAt,updatedAt:importedAt,
    }));
    await db.batch([
      db.insert(subcontractors).values(importedValues),
      db.insert(auditLog).values({
        employerId,actor:access.user.displayName,action:"imported:cis-subcontractors",
        entityType:"subcontractor-import",
        after:JSON.stringify({rows:importedValues.length,utrs:importedValues.map(row=>row.utr),allRowsValidated:true}),
      }),
    ]);
    const importedUtrs=new Set(importedValues.map(row=>row.utr));
    const records=(await db.select().from(subcontractors).where(eq(subcontractors.employerId,employerId)))
      .filter(row=>importedUtrs.has(cleanUtr(row.utr)));
    return NextResponse.json({imported:records.length,records},{status:201});
  }
  if(input.action==="record-filing-result"){
    const submissionId=Number(input.submissionId);
    if(!Number.isInteger(submissionId)||submissionId<1)return NextResponse.json({error:"Select a valid CIS300 package."},{status:422});
    const [existing]=await db.select().from(submissions).where(and(
      eq(submissions.id,submissionId),eq(submissions.employerId,employerId),eq(submissions.type,"CIS300"),
    )).limit(1);
    if(!existing)return NextResponse.json({error:"CIS300 package was not found for this employer."},{status:404});
    const result=validateCisFilingResult({
      currentStatus:existing.status,outcome:String(input.outcome||""),submittedAt:String(input.submittedAt||""),
      acknowledgementReference:String(input.acknowledgementReference||""),responseCode:String(input.responseCode||""),
      responseMessage:String(input.responseMessage||""),
    });
    if(!result.valid)return NextResponse.json({error:result.errors.join(" "),validation:result},{status:422});
    let payload:any={};try{payload=JSON.parse(existing.payload||"{}");}catch{return NextResponse.json({error:"The stored CIS300 payload is unreadable. Do not attach an acknowledgement to it."},{status:409});}
    if(await sha256(JSON.stringify(payload))!==existing.payloadChecksum)return NextResponse.json({error:"The stored CIS300 payload checksum does not match. Do not attach an acknowledgement to it."},{status:409});
    const duplicateReference=await db.select({id:submissions.id}).from(submissions).where(and(
      eq(submissions.employerId,employerId),eq(submissions.correlationId,result.acknowledgementReference),
    )).limit(1);
    if(duplicateReference.some(row=>row.id!==existing.id))return NextResponse.json({error:"This external acknowledgement reference is already attached to another submission."},{status:409});
    if(result.outcome==="accepted"){
      const accepted=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"CIS300"),eq(submissions.status,"accepted"))).orderBy(desc(submissions.id));
      const samePeriod=accepted.find(row=>{try{const prior=JSON.parse(row.payload||"{}");return prior.taxYear===payload.taxYear&&Number(prior.taxMonth)===Number(payload.taxMonth);}catch{return false;}});
      if(samePeriod&&Number(payload.amendsSubmissionId)!==samePeriod.id)return NextResponse.json({error:`Accepted CIS300 #${samePeriod.id} already exists for this tax month. Prepare an amendment linked to that accepted return.`},{status:409});
      if(payload.amendsSubmissionId){
        const [baseline]=await db.select().from(submissions).where(and(
          eq(submissions.id,Number(payload.amendsSubmissionId)),eq(submissions.employerId,employerId),eq(submissions.type,"CIS300"),
        )).limit(1);
        if(!baseline||baseline.status!=="accepted"||baseline.payloadChecksum!==payload.amendsPayloadChecksum)
          return NextResponse.json({error:"The accepted CIS300 amendment baseline has changed. Regenerate the amendment package."},{status:409});
      }
    }
    const recordedAt=new Date().toISOString(),responseEvidence={
      schemaVersion:"payflow-cis300-external-result-1",outcome:result.outcome,
      acknowledgementReference:result.acknowledgementReference,responseCode:String(input.responseCode||"").trim()||null,
      responseMessage:String(input.responseMessage||"").trim()||null,evidenceSource:String(input.evidenceSource||"external-import"),
      recordedAt,recordedBy:access.user.displayName,liveTransmissionPerformedByPayFlow:false,
    };
    const [updated]=await db.update(submissions).set({
      status:result.outcome,submittedAt:new Date(result.submittedAt).toISOString(),
      correlationId:result.acknowledgementReference,irMark:String(input.irMark||"").trim()||null,
      response:JSON.stringify(responseEvidence),updatedAt:recordedAt,
    }).where(and(eq(submissions.id,existing.id),eq(submissions.employerId,employerId),eq(submissions.status,existing.status))).returning();
    if(!updated)return NextResponse.json({error:"The CIS300 package changed while its result was being recorded."},{status:409});
    await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:`recorded:cis300-${result.outcome}`,entityType:"submission",entityId:String(existing.id),
      before:JSON.stringify({status:existing.status,submittedAt:existing.submittedAt,correlationId:existing.correlationId}),
      after:JSON.stringify({...responseEvidence,submittedAt:updated.submittedAt,payloadChecksum:updated.payloadChecksum}),
    });
    return NextResponse.json({submission:updated,evidence:responseEvidence});
  }
  if(input.action==="verify"){
    const [owned]=await db.select().from(subcontractors).where(and(eq(subcontractors.id,Number(input.subcontractorId)),eq(subcontractors.employerId,employerId))).limit(1);
    if(!owned)return NextResponse.json({error:"Subcontractor was not found for this employer."},{status:404});
    if(input.deductionRate===undefined||input.deductionRate===null||input.deductionRate==="")return NextResponse.json({error:"Select the CIS verification deduction rate."},{status:422});
    const rate=Number(input.deductionRate);
    if(!allowedRates.includes(rate))return NextResponse.json({error:"CIS deduction rate must be 0%, 20% or 30%."},{status:400});
    const utr=cleanUtr(input.utr||owned.utr);
    if(!/^\d{10}$/.test(utr))return NextResponse.json({error:"A valid 10-digit UTR is required before verification."},{status:422});
    if(owned.type==="sole-trader"&&!/^[A-Z]{2}\d{6}[A-D]$/i.test(String(input.niNumber||owned.niNumber||"").replace(/\s/g,"")))return NextResponse.json({error:"A valid National Insurance number is required to verify a sole trader."},{status:422});
    if(owned.type==="company"&&!/^[A-Z0-9]{8}$/i.test(String(input.companyNumber||owned.companyNumber||"").replace(/\s/g,"")))return NextResponse.json({error:"A valid 8-character company registration number is required to verify a company."},{status:422});
    if(owned.type==="partnership"&&!/^\d{10}$/.test(cleanUtr(input.partnerUtr||owned.partnerUtr)))return NextResponse.json({error:"The nominated partner's 10-digit UTR is required to verify a partnership."},{status:422});
    if(!input.verificationNumber)return NextResponse.json({error:"Enter the HMRC verification number or test verification reference."},{status:422});
    const verifiedAt=new Date().toISOString(),verificationMethod=String(input.verificationMethod||"manual-or-test");
    const [updated]=await db.update(subcontractors).set({
      utr,niNumber:input.niNumber||owned.niNumber,companyNumber:input.companyNumber||owned.companyNumber,
      partnerUtr:cleanUtr(input.partnerUtr||owned.partnerUtr)||null,
      verificationNumber:String(input.verificationNumber),verificationMethod,
      verificationResponse:JSON.stringify({rate,reference:String(input.verificationNumber),recordedBy:access.user.displayName,liveVerificationPerformed:false}),
      deductionRate:rate,verifiedAt,
      status:rate===0?"gross-payment-status":"verified",updatedAt:new Date().toISOString(),
    }).where(and(eq(subcontractors.id,owned.id),eq(subcontractors.employerId,employerId))).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"recorded:cis-verification",entityType:"subcontractor",entityId:String(owned.id),before:JSON.stringify({status:owned.status,deductionRate:owned.deductionRate,verificationNumber:owned.verificationNumber}),after:JSON.stringify({status:updated.status,deductionRate:rate,verificationNumber:updated.verificationNumber,verificationMethod,verifiedAt,liveVerificationPerformed:false})});
    const affected=(await db.select().from(cisPayments).where(eq(cisPayments.subcontractorId,owned.id))).filter(payment=>payment.status!=="voided");
    const periods=[...new Set(affected.map(payment=>`${payment.taxYear}:${payment.taxMonth}`))];
    let supersededReturns=0,supersededStatements=0;
    for(const key of periods){const [year,month]=key.split(":");const result=await supersedeCisArtifacts(employerId,year,Number(month),`Superseded because subcontractor verification ${owned.id} changed.`,owned.id);supersededReturns+=result.returns;supersededStatements+=result.statements;}
    return NextResponse.json({...updated,verificationMode:verificationMethod,liveVerificationPerformed:false,supersededReturns,supersededStatements});
  }
  if(input.action==="prepare-return"){
    const taxYear=String(input.taxYear||"2026/27"),taxMonth=Number(input.taxMonth);
    if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:400});
    if(!validTaxMonth(taxMonth))return NextResponse.json({error:"Tax month must be a whole number between 1 and 12."},{status:400});
    const data=await cisReturn(employerId,taxYear,taxMonth);
    const errors=[...data.validation.errors];
    const [contractor]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
    if(!contractor?.cisContractor)errors.push("Enable CIS contractor status in the employer record before preparing CIS300.");
    if(!/^\d{10}$/.test(cleanUtr(contractor?.cisUtr)))errors.push("A valid 10-digit contractor UTR is required for CIS300.");
    if(!contractor?.accountsOfficeReference)errors.push("The contractor Accounts Office reference is required for CIS300.");
    const nilReturn=input.nilReturn===true,inactivityRequest=input.inactivityRequest===true;
    if(!data.totals.payments&&!nilReturn&&!inactivityRequest)errors.push("Choose a nil return or an inactivity request when no subcontractor payments were made.");
    if(data.totals.payments&&(nilReturn||inactivityRequest))errors.push("A nil return or inactivity request cannot be used when payments exist for the tax month.");
    if(nilReturn&&inactivityRequest)errors.push("Choose either a nil return or an inactivity request, not both.");
    if(input.employmentStatusConsidered!==true)errors.push("Confirm that subcontractor employment status has been considered.");
    if(input.allSubcontractorsNotEmployees!==true)errors.push("Declare that every subcontractor on the return is not an employee.");
    if(input.allRequiredVerified!==true)errors.push("Confirm that every subcontractor requiring verification has been verified.");
    if(input.declarationAccepted!==true)errors.push("Confirm that the return is complete and correct.");
    if((nilReturn||inactivityRequest)&&errors[0]==="No subcontractor payments are recorded for this tax month.")errors.shift();
    const priorRows=(await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"CIS300"))).orderBy(desc(submissions.id))).filter(item=>{
      let priorPayload:any={};try{priorPayload=JSON.parse(item.payload||"{}");}catch{}
      return priorPayload.taxYear===taxYear&&Number(priorPayload.taxMonth)===taxMonth&&["validated","test-ready","accepted","rejected","superseded"].includes(item.status);
    });
    const acceptedPrior=priorRows.find(item=>item.status==="accepted");
    const replacementPrior=priorRows.find(item=>item.status!=="accepted");
    const declarations={employmentStatusConsidered:input.employmentStatusConsidered===true,allSubcontractorsNotEmployees:input.allSubcontractorsNotEmployees===true,allRequiredVerified:input.allRequiredVerified===true,completeAndCorrect:input.declarationAccepted===true};
    const sourceChecksum=await sha256(JSON.stringify({contractor:{id:contractor?.id,cisContractor:contractor?.cisContractor,cisUtr:contractor?.cisUtr,accountsOfficeReference:contractor?.accountsOfficeReference},taxYear,taxMonth,statements:data.statements,totals:data.totals}));
    const reusablePrior=priorRows.find(item=>item.status==="test-ready");
    if(reusablePrior){
      let reusablePayload:any={};try{reusablePayload=JSON.parse(reusablePrior.payload||"{}");}catch{}
      const sameDeclarations=["employmentStatusConsidered","allSubcontractorsNotEmployees","allRequiredVerified","completeAndCorrect"]
        .every(key=>Boolean(reusablePayload.declarations?.[key])===Boolean((declarations as Record<string,boolean>)[key]));
      const sameAcceptedBaseline=Number(reusablePayload.amendsSubmissionId||0)===Number(acceptedPrior?.id||0)&&
        String(reusablePayload.amendsPayloadChecksum||"")===String(acceptedPrior?.payloadChecksum||"");
      if(reusablePayload.sourceChecksum===sourceChecksum&&Boolean(reusablePayload.nilReturn)===nilReturn&&
        Boolean(reusablePayload.inactivityRequest)===inactivityRequest&&sameDeclarations&&sameAcceptedBaseline)
        return NextResponse.json({submission:reusablePrior,payload:reusablePayload,validation:{valid:true,errors:[]},reused:true});
    }
    const payload={schemaVersion:"payflow-cis300-draft-4",sourceChecksum,...data,validation:{valid:errors.length===0,errors},nilReturn,inactivityRequest,declarations,
      amendsSubmissionId:acceptedPrior?.id||null,amendsPayloadChecksum:acceptedPrior?.payloadChecksum||null,
      replacesSubmissionId:replacementPrior?.id||null,replacesPayloadChecksum:replacementPrior?.payloadChecksum||null,
    };
    const preparedAt=new Date().toISOString(),payloadChecksum=await sha256(JSON.stringify(payload));
    if(errors.length){
      await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"validation-failed:cis300-package",entityType:"submission-validation",entityId:payloadChecksum,after:JSON.stringify({taxYear,taxMonth,payloadChecksum,validationErrors:errors})});
      return NextResponse.json({submission:null,payload,validation:{valid:false,errors}},{status:422});
    }
    const [created]=await db.insert(submissions).values({
      employerId,type:"CIS300",dueDate:cisDeadline(taxYear,taxMonth),payload:JSON.stringify(payload),payloadChecksum,
      preparedAt,declarationAcceptedAt:preparedAt,declarationAcceptedBy:access.user.displayName,
      submittedAt:null,status:"test-ready",response:"Prepared for an HMRC-recognised CIS transport adapter; no live filing occurred.",
    }).returning();
    if(replacementPrior&&["validated","test-ready"].includes(replacementPrior.status))await db.update(submissions).set({status:"superseded",response:`Superseded by CIS300 package ${created.id}.`,updatedAt:preparedAt}).where(eq(submissions.id,replacementPrior.id));
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"prepared:cis300-package",entityType:"submission",entityId:String(created.id),after:JSON.stringify({taxYear,taxMonth,status:created.status,dueDate:created.dueDate,payloadChecksum,sourceChecksum,amendsSubmissionId:acceptedPrior?.id||null,replacesSubmissionId:replacementPrior?.id||null,liveTransmission:false,validationErrors:[]})});
    return NextResponse.json({submission:created,payload,validation:{valid:true,errors:[]}},{status:201});
  }
  if(input.action==="issue-statement"){
    const taxYear=String(input.taxYear||"2026/27"),taxMonth=Number(input.taxMonth),subcontractorId=Number(input.subcontractorId);
    if(!validTaxYear(taxYear)||!validTaxMonth(taxMonth))return NextResponse.json({error:"Select a valid tax year and whole-number tax month."},{status:400});
    const data=await cisReturn(employerId,taxYear,taxMonth),statement=data.statements.find(item=>item.subcontractorId===subcontractorId);
    if(!statement)return NextResponse.json({error:"No payment statement exists for this subcontractor and tax month."},{status:404});
    if(!data.validation.valid)return NextResponse.json({error:`Resolve CIS payment evidence before issuing the statement. ${data.validation.errors.join(" ")}`,validation:data.validation},{status:422});
    if(statement.deduction<=0&&!input.issueGrossStatement)return NextResponse.json({error:"A deduction statement is not legally required for a gross-paid subcontractor. Confirm that you want to issue the optional gross statement."},{status:422});
    const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
    if(!employer?.name||!employer.payeReference)return NextResponse.json({error:"Contractor name and PAYE reference are required before issuing a CIS statement."},{status:422});
    const issuedAt=new Date().toISOString(),month=taxMonthRange(taxYear,taxMonth);
    const sourceChecksum=await sha256(JSON.stringify({contractor:{name:employer.name,payeReference:employer.payeReference},taxYear,taxMonth,taxMonthEnd:new Date(month.end).toISOString().slice(0,10),statement}));
    const priorStatements=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"CIS-PDS"))).orderBy(desc(submissions.id));
    const prior=priorStatements.find(item=>{try{const payload=JSON.parse(item.payload||"{}");return payload.taxYear===taxYear&&Number(payload.taxMonth)===taxMonth&&Number(payload.statement?.subcontractorId)===subcontractorId;}catch{return false;}});
    let priorPayload:any={};try{priorPayload=prior?JSON.parse(prior.payload||"{}"):{};}catch{}
    const priorSourceChecksum=priorPayload.sourceChecksum||await sha256(JSON.stringify({contractor:priorPayload.contractor,taxYear:priorPayload.taxYear,taxMonth:priorPayload.taxMonth,taxMonthEnd:priorPayload.taxMonthEnd,statement:priorPayload.statement}));
    const duplicate=Boolean(prior)&&priorSourceChecksum===sourceChecksum;
    const replacesStatementId=prior&&!duplicate?prior.id:null;
    const deliveryMethod=String(input.deliveryMethod||"download");
    if(!["download","email","post","portal"].includes(deliveryMethod))return NextResponse.json({error:"Select download, email, post or portal delivery."},{status:422});
    const payload={schemaVersion:"payflow-cis-pds-2",sourceChecksum,contractor:{name:employer.name,payeReference:employer.payeReference},taxYear,taxMonth,taxMonthEnd:new Date(month.end).toISOString().slice(0,10),statement,duplicate,duplicatesSubmissionId:duplicate?prior?.id||null:null,replacesStatementId,deliveryMethod,issuedAt};
    const payloadChecksum=await sha256(JSON.stringify(payload));
    const [created]=await db.insert(submissions).values({employerId,type:"CIS-PDS",dueDate:cisDeadline(taxYear,taxMonth),payload:JSON.stringify(payload),payloadChecksum,preparedAt:issuedAt,status:"issued",response:"Payment and deduction statement generated locally; delivery is recorded by the payroll operator."}).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"issued:cis-payment-statement",entityType:"submission",entityId:String(created.id),after:JSON.stringify({subcontractorId,taxYear,taxMonth,duplicate,duplicatesSubmissionId:payload.duplicatesSubmissionId,replacesStatementId,deliveryMethod:payload.deliveryMethod,sourceChecksum,payloadChecksum})});
    return NextResponse.json({submission:created,payload},{status:201});
  }
  if (input.kind === "payment") {
    const subcontractorId = Number(input.subcontractorId);
    const [owner] = await db.select().from(subcontractors).where(and(eq(subcontractors.id, subcontractorId), eq(subcontractors.employerId, employerId))).limit(1);
    if (!owner) return NextResponse.json({ error: "Subcontractor was not found for this employer." }, { status: 404 });
    const taxYear=String(input.taxYear||"2026/27"),taxMonth=Number(input.taxMonth);
    if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:400});
    if(!validTaxMonth(taxMonth))return NextResponse.json({error:"Tax month must be a whole number between 1 and 12."},{status:400});
    const paymentDate=String(input.paymentDate||""),range=taxMonthRange(String(input.taxYear||"2026/27"),taxMonth),paymentTime=Date.parse(`${paymentDate}T00:00:00Z`);
    if(!validDate(paymentDate)||!Number.isFinite(paymentTime)||paymentTime<range.start||paymentTime>range.end)return NextResponse.json({error:`Payment date must be a valid calendar date within CIS tax month ${taxMonth}.`},{status:422});
    const priorPayments=await db.select({
      taxYear:cisPayments.taxYear,paymentDate:cisPayments.paymentDate,deductionRate:cisPayments.deductionRate,
      verificationNumber:cisPayments.verificationNumber,verificationMethod:cisPayments.verificationMethod,
      verifiedAt:cisPayments.verifiedAt,status:cisPayments.status,
    }).from(cisPayments).where(eq(cisPayments.subcontractorId,subcontractorId));
    const verification=cisVerificationDecision(taxYear,paymentDate,{
      status:owner.status,deductionRate:owner.deductionRate,verificationNumber:owner.verificationNumber,
      verificationMethod:owner.verificationMethod,verifiedAt:owner.verifiedAt,
    },priorPayments);
    if(!verification.valid)return NextResponse.json({
      error:"Verify this subcontractor before payment. No complete verification evidence or continuing payment history exists in this tax year or the previous two tax years.",
      verificationRequired:true,verificationReason:verification.reason,
    },{status:409});
    let applicableEvidence=verification.evidence;
    let rate=applicableEvidence.deductionRate;
    if(input.rate!==undefined&&Number(input.rate)!==rate)return NextResponse.json({error:"The payment rate must match the applicable CIS verification evidence."},{status:400});
    const suppliedAmounts=[input.labour,input.materials,input.vat,input.retention].map(value=>Number(value||0));
    if(suppliedAmounts.some(value=>!Number.isFinite(value)||value<0))return NextResponse.json({error:"Labour, materials, VAT and retention must be valid non-negative amounts."},{status:422});
    const [labour,materials,vat,retention]=suppliedAmounts;
    if(labour+materials+vat<=0)return NextResponse.json({error:"Enter a positive subcontractor payment amount."},{status:422});
    if(retention>labour)return NextResponse.json({error:"Labour retention cannot exceed the labour amount. Record retained materials separately."},{status:422});
    const invoiceNumber=String(input.invoiceNumber||"").trim().toUpperCase(),paymentRecipient=String(input.paymentRecipient||owner.name).trim(),materialsEvidence=String(input.materialsEvidence||"").trim();
    if(invoiceNumber.length<3||invoiceNumber.length>100)return NextResponse.json({error:"Enter an invoice or payment reference of 3 to 100 characters."},{status:422});
    if(paymentRecipient.length<2||paymentRecipient.length>150)return NextResponse.json({error:"Enter the legal payment recipient."},{status:422});
    if(materialsEvidence.length>500||materials>0&&materialsEvidence.length<3)return NextResponse.json({error:"Payments including materials require an evidence or estimate note of 3 to 500 characters."},{status:422});
    const [duplicatePayment]=await db.select({id:cisPayments.id}).from(cisPayments).where(and(
      eq(cisPayments.subcontractorId,subcontractorId),eq(cisPayments.taxYear,taxYear),
      sql`upper(${cisPayments.invoiceNumber}) = ${invoiceNumber}`,ne(cisPayments.status,"voided"),
    )).limit(1);
    if(duplicatePayment)return NextResponse.json({error:"This active subcontractor invoice or payment reference is already recorded."},{status:409});
    const replacesPaymentId=input.replacesPaymentId===undefined||input.replacesPaymentId===null?null:Number(input.replacesPaymentId);
    if(replacesPaymentId!==null){
      if(!Number.isInteger(replacesPaymentId)||replacesPaymentId<1)return NextResponse.json({error:"Replacement payment ID must be a positive integer."},{status:422});
      const [replaced]=await db.select({
        id:cisPayments.id,subcontractorId:cisPayments.subcontractorId,taxYear:cisPayments.taxYear,taxMonth:cisPayments.taxMonth,status:cisPayments.status,
        deductionRate:cisPayments.deductionRate,verificationNumber:cisPayments.verificationNumber,
        verificationMethod:cisPayments.verificationMethod,verifiedAt:cisPayments.verifiedAt,
      })
        .from(cisPayments).innerJoin(subcontractors,eq(cisPayments.subcontractorId,subcontractors.id))
        .where(and(eq(cisPayments.id,replacesPaymentId),eq(subcontractors.employerId,employerId))).limit(1);
      if(!replaced)return NextResponse.json({error:"The payment being replaced was not found for this employer."},{status:404});
      if(replaced.status!=="voided")return NextResponse.json({error:"A replacement can only link to a voided CIS payment."},{status:409});
      if(replaced.subcontractorId!==subcontractorId||replaced.taxYear!==taxYear||replaced.taxMonth!==taxMonth)return NextResponse.json({error:"A replacement must use the same subcontractor, tax year and tax month as the voided payment."},{status:422});
      if(!replaced.verificationNumber)return NextResponse.json({error:"The voided payment does not contain complete verification evidence. Record a fresh verification before replacing it."},{status:409});
      applicableEvidence={
        deductionRate:replaced.deductionRate,verificationNumber:replaced.verificationNumber,
        verificationMethod:replaced.verificationMethod||"historic-payment",verifiedAt:replaced.verifiedAt||paymentDate,
      };
      rate=applicableEvidence.deductionRate;
      const [existingReplacement]=await db.select({id:cisPayments.id}).from(cisPayments).where(and(eq(cisPayments.replacesPaymentId,replacesPaymentId),ne(cisPayments.status,"voided"))).limit(1);
      if(existingReplacement)return NextResponse.json({error:"This voided CIS payment already has an active replacement."},{status:409});
    }
    const deductibleAmount=round(labour-retention);
    const deduction = round(deductibleAmount * rate / 100), netPayment = round(labour + materials + vat - deduction - retention);
    const [createdPayment] = await db.insert(cisPayments).values({
      subcontractorId,taxYear,taxMonth,paymentDate,deductionRate:rate,
      verificationNumber:applicableEvidence.verificationNumber,
      verificationMethod:applicableEvidence.verificationMethod,verifiedAt:applicableEvidence.verifiedAt,
      invoiceNumber,paymentRecipient,materialsEvidence:materialsEvidence||null,
      subcontractorName:owner.name,subcontractorType:owner.type,subcontractorUtr:owner.utr,
      subcontractorNiNumber:owner.niNumber,subcontractorCompanyNumber:owner.companyNumber,subcontractorPartnerUtr:owner.partnerUtr,
      labour,materials,vat,retention,deduction,netPayment,status:"calculated",
      replacesPaymentId,
    }).returning();
    const superseded=await supersedeCisArtifacts(employerId,taxYear,taxMonth,`Superseded because CIS payment ${createdPayment.id} was added after preparation.`,subcontractorId);
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"recorded:cis-payment",entityType:"cis-payment",entityId:String(createdPayment.id),after:JSON.stringify({...createdPayment,verificationReason:verification.reason})});
    return NextResponse.json({...createdPayment,verificationReason:verification.reason,supersededReturns:superseded.returns,supersededStatements:superseded.statements}, { status: 201 });
  }
  if(input.action!==undefined||input.kind!==undefined)return NextResponse.json({error:"Unsupported CIS operation."},{status:400});
  const [existingEmployer] = await db.select({ id: employers.id }).from(employers).where(eq(employers.id, employerId)).limit(1);
  if (!existingEmployer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const validated=validateCisImportRows([input]);
  if(validated.errors.length)return NextResponse.json({error:validated.errors.join(" "),errors:validated.errors},{status:422});
  const prepared=validated.values[0],utr=prepared.utr;
  const duplicate=await db.select({id:subcontractors.id}).from(subcontractors).where(and(eq(subcontractors.employerId,employerId),eq(subcontractors.utr,utr))).limit(1);
  if(duplicate.length)return NextResponse.json({error:"A subcontractor with this UTR already exists."},{status:409});
  const [created] = await db.insert(subcontractors).values({
    employerId,...prepared,
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:subcontractor",entityType:"subcontractor",entityId:String(created.id),after:JSON.stringify({name:created.name,type:created.type,utr:created.utr,status:created.status})});
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(request:Request) {
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON CIS correction object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(input.action!=="void-payment")return NextResponse.json({error:"Unsupported CIS correction action."},{status:400});
  const [payment]=await db.select({
    id:cisPayments.id,subcontractorId:cisPayments.subcontractorId,taxYear:cisPayments.taxYear,taxMonth:cisPayments.taxMonth,status:cisPayments.status,
    paymentDate:cisPayments.paymentDate,labour:cisPayments.labour,materials:cisPayments.materials,vat:cisPayments.vat,
    retention:cisPayments.retention,deduction:cisPayments.deduction,netPayment:cisPayments.netPayment,
  }).from(cisPayments).innerJoin(subcontractors,eq(cisPayments.subcontractorId,subcontractors.id)).where(and(
    eq(cisPayments.id,Number(input.paymentId)),eq(subcontractors.employerId,employerId),
  )).limit(1);
  if(!payment)return NextResponse.json({error:"CIS payment was not found for this employer."},{status:404});
  if(payment.status==="voided")return NextResponse.json({error:"This CIS payment is already voided."},{status:409});
  const reason=String(input.reason||"").trim();
  if(reason.length<5||reason.length>500)return NextResponse.json({error:"Enter a correction reason between 5 and 500 characters."},{status:422});
  const [updated]=await db.update(cisPayments).set({status:"voided",voidReason:reason,updatedAt:new Date().toISOString()}).where(eq(cisPayments.id,payment.id)).returning();
  const superseded=await supersedeCisArtifacts(employerId,payment.taxYear,payment.taxMonth,`Superseded because CIS payment ${payment.id} was voided: ${reason}`,payment.subcontractorId);
  await db.insert(auditLog).values({
    employerId,actor:access.user.email,action:"voided",entityType:"cis-payment",entityId:String(payment.id),
    before:JSON.stringify(payment),after:JSON.stringify({status:"voided",reason,supersededReturns:superseded.returns,supersededStatements:superseded.statements}),
  });
  return NextResponse.json({payment:updated,reason,supersededReturns:superseded.returns,supersededStatements:superseded.statements});
}
