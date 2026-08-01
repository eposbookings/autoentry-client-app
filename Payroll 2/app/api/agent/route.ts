import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { agentCharges, agentInvoices, agentProfiles, auditLog, employers, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { calculateAgentInvoice } from "../../../lib/agent-billing";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const validDate=(value:unknown)=>{
  const text=String(value||""),time=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const plusDays=(date:string,days:number)=>{
  const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);
};

async function billingSource(db:ReturnType<typeof getDb>,employerId:number,periodStart:string,periodEnd:string){
  const periods=(await db.select().from(payPeriods).where(eq(payPeriods.employerId,employerId)))
    .filter(period=>period.status==="finalised"&&Boolean(period.payDate)&&period.payDate!>=periodStart&&period.payDate!<=periodEnd);
  const periodIds=periods.map(period=>period.id);
  const runs=periodIds.length?await db.select({
    id:payRuns.id,employeeId:payRuns.employeeId,payPeriodId:payRuns.payPeriodId,status:payRuns.status,
  }).from(payRuns).where(inArray(payRuns.payPeriodId,periodIds)):[];
  const filingRows=(await db.select({
    id:submissions.id,type:submissions.type,status:submissions.status,preparedAt:submissions.preparedAt,submittedAt:submissions.submittedAt,
  }).from(submissions).where(eq(submissions.employerId,employerId))).filter(item=>{
    const date=String(item.submittedAt||item.preparedAt||"").slice(0,10);
    return date>=periodStart&&date<=periodEnd&&!["draft","invalid","superseded","rejected"].includes(item.status);
  });
  return {
    periodIds:periodIds.sort((a,b)=>a-b),
    payRuns:runs.filter(run=>run.status==="finalised").map(({id,employeeId,payPeriodId})=>({id,employeeId,payPeriodId})).sort((a,b)=>a.id-b.id),
    submissions:filingRows.map(({id,type})=>({id,type})).sort((a,b)=>a.id-b.id),
  };
}

async function invoicePreview(db:ReturnType<typeof getDb>,employerId:number,periodStart:string,periodEnd:string){
  if(!validDate(periodStart)||!validDate(periodEnd)||periodEnd<periodStart)
    throw new Error("Choose a valid billing date range.");
  const charges=await db.select().from(agentCharges).where(eq(agentCharges.employerId,employerId));
  const source=await billingSource(db,employerId,periodStart,periodEnd);
  const calculation=calculateAgentInvoice(charges,source,periodStart,periodEnd);
  return {...calculation,source};
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db=getDb(),invoiceId=Number(url.searchParams.get("invoiceId")||0);
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(invoiceId&&url.searchParams.get("format")==="html"){
    const [invoice]=await db.select().from(agentInvoices).where(and(eq(agentInvoices.id,invoiceId),eq(agentInvoices.employerId,employerId))).limit(1);
    const [profile]=await db.select().from(agentProfiles).where(eq(agentProfiles.employerId,employerId)).limit(1);
    if(!invoice||!profile||!employer)return NextResponse.json({error:"Agent invoice was not found."},{status:404});
    const lines=JSON.parse(invoice.lineItems||"[]");
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice.invoiceNumber)}</title><style>body{font:14px Arial;color:#17313b;margin:40px}header{display:flex;justify-content:space-between;border-bottom:3px solid #087b79;padding-bottom:20px}h1{margin:0;color:#087b79}section{display:flex;justify-content:space-between;margin:25px 0}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #d8e2e5;text-align:right}th:first-child,td:first-child{text-align:left}.totals{margin-left:auto;width:320px}.totals p{display:flex;justify-content:space-between}.gross{font-size:18px;font-weight:bold;color:#087b79}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / save PDF</button><header><div><h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1><p>${escapeHtml(profile.firmName)}<br>${escapeHtml(profile.address)} ${escapeHtml(profile.postcode)}<br>${escapeHtml(profile.email)} ${escapeHtml(profile.phone)}</p></div><div><b>Invoice date</b> ${escapeHtml(invoice.invoiceDate)}<br><b>Due</b> ${escapeHtml(invoice.dueDate)}<br><b>Status</b> ${escapeHtml(invoice.status)}</div></header><section><div><b>Bill to</b><br>${escapeHtml(employer.legalName||employer.name)}<br>${escapeHtml(employer.address)}<br>${escapeHtml(employer.postcode)}</div><div><b>Billing period</b><br>${escapeHtml(invoice.periodStart)} to ${escapeHtml(invoice.periodEnd)}<br>${invoice.payslipCount} payslips · ${invoice.payrollPeriodCount} payroll periods</div></section><table><thead><tr><th>Service</th><th>Units</th><th>Rate</th><th>VAT</th><th>Total</th></tr></thead><tbody>${lines.map((line:any)=>`<tr><td>${escapeHtml(line.description)}</td><td>${line.units}</td><td>£${Number(line.unitRate).toFixed(2)}</td><td>£${Number(line.vatAmount).toFixed(2)}</td><td>£${Number(line.grossAmount).toFixed(2)}</td></tr>`).join("")}</tbody></table><div class="totals"><p><span>Net</span><b>£${invoice.netAmount.toFixed(2)}</b></p><p><span>VAT</span><b>£${invoice.vatAmount.toFixed(2)}</b></p><p class="gross"><span>Total due</span><b>£${invoice.grossAmount.toFixed(2)}</b></p></div><p><b>Payment details</b><br>${escapeHtml(profile.bankPaymentDetails||"Contact the agent for payment instructions.")}</p></body></html>`;
    return new NextResponse(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"}});
  }
  const [profile,charges,invoices]=await Promise.all([
    db.select().from(agentProfiles).where(eq(agentProfiles.employerId,employerId)).limit(1),
    db.select().from(agentCharges).where(eq(agentCharges.employerId,employerId)),
    db.select().from(agentInvoices).where(eq(agentInvoices.employerId,employerId)).orderBy(desc(agentInvoices.id)),
  ]);
  const periodStart=url.searchParams.get("periodStart"),periodEnd=url.searchParams.get("periodEnd");
  let preview=null;
  if(periodStart||periodEnd){
    try{preview=await invoicePreview(db,employerId,String(periodStart||""),String(periodEnd||""));}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Billing preview could not be calculated."},{status:422});}
  }
  return NextResponse.json({
    employer:{id:employer?.id,name:employer?.name,legalName:employer?.legalName,taxYear:employer?.taxYear},
    profile:profile[0]||null,charges,invoices:invoices.map(invoice=>({...invoice,lineItems:JSON.parse(invoice.lineItems||"[]")})),preview,
  });
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON agent operation is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db=getDb(),action=String(input.action||"");
  if(action==="save-profile"){
    const firmName=String(input.firmName||"").trim(),contactName=String(input.contactName||"").trim(),email=String(input.email||"").trim().toLowerCase();
    if(firmName.length<2||contactName.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({error:"Agent firm, contact name and a valid email address are required."},{status:422});
    const defaultVatRate=Number(input.defaultVatRate),paymentTermsDays=Number(input.paymentTermsDays),nextInvoiceNumber=Number(input.nextInvoiceNumber);
    if(!Number.isFinite(defaultVatRate)||defaultVatRate<0||defaultVatRate>100||!Number.isInteger(paymentTermsDays)||paymentTermsDays<0||paymentTermsDays>365||
      !Number.isInteger(nextInvoiceNumber)||nextInvoiceNumber<1)
      return NextResponse.json({error:"VAT rate, payment terms and next invoice number are outside the supported range."},{status:422});
    const invoicePrefix=String(input.invoicePrefix||"PAY").trim().toUpperCase();
    if(!/^[A-Z0-9-]{1,10}$/.test(invoicePrefix))return NextResponse.json({error:"Invoice prefix may contain up to 10 letters, numbers or hyphens."},{status:422});
    const priorInvoices=await db.select({invoiceNumber:agentInvoices.invoiceNumber}).from(agentInvoices).where(eq(agentInvoices.employerId,employerId));
    const highestPrior=priorInvoices.map(item=>{
      const match=new RegExp(`^${invoicePrefix.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}-(\\d+)$`).exec(item.invoiceNumber);
      return match?Number(match[1]):0;
    }).reduce((highest,value)=>Math.max(highest,value),0);
    if(nextInvoiceNumber<=highestPrior)return NextResponse.json({error:`Next invoice number must be greater than ${highestPrior} for prefix ${invoicePrefix}.`},{status:409});
    const values={firmName,contactName,email,phone:String(input.phone||"").trim()||null,address:String(input.address||"").trim()||null,
      postcode:String(input.postcode||"").trim().toUpperCase()||null,agentReference:String(input.agentReference||"").trim()||null,
      vatRegistrationNumber:String(input.vatRegistrationNumber||"").replace(/\s/g,"").toUpperCase()||null,defaultVatRate:round(defaultVatRate),
      paymentTermsDays,invoicePrefix,nextInvoiceNumber,bankPaymentDetails:String(input.bankPaymentDetails||"").trim()||null,
      payslipFooter:String(input.payslipFooter||"").trim()||null,status:"active",updatedAt:new Date().toISOString()};
    const [before]=await db.select().from(agentProfiles).where(eq(agentProfiles.employerId,employerId)).limit(1);
    const [profile]=before?await db.update(agentProfiles).set(values).where(eq(agentProfiles.id,before.id)).returning():
      await db.insert(agentProfiles).values({employerId,...values}).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:before?"updated:agent-profile":"created:agent-profile",entityType:"agent-profile",entityId:String(profile.id),before:before?JSON.stringify(before):null,after:JSON.stringify(profile)});
    return NextResponse.json(profile,{status:before?200:201});
  }
  if(action==="save-charge"){
    const chargeCode=String(input.chargeCode||"").trim().toLowerCase(),description=String(input.description||"").trim();
    const billingBasis=String(input.billingBasis||""),unitRate=Number(input.unitRate),vatRate=Number(input.vatRate);
    if(!/^[a-z0-9-]{2,40}$/.test(chargeCode)||description.length<3||description.length>120)
      return NextResponse.json({error:"Charge code and description are required."},{status:422});
    if(!["fixed","per-payslip","per-period","per-employee","per-submission"].includes(billingBasis)||!Number.isFinite(unitRate)||unitRate<0||unitRate>1_000_000||
      !Number.isFinite(vatRate)||vatRate<0||vatRate>100)
      return NextResponse.json({error:"Choose a supported billing basis and non-negative rate."},{status:422});
    const effectiveFrom=input.effectiveFrom?String(input.effectiveFrom):null,effectiveTo=input.effectiveTo?String(input.effectiveTo):null;
    if(effectiveFrom&&!validDate(effectiveFrom)||effectiveTo&&!validDate(effectiveTo)||effectiveFrom&&effectiveTo&&effectiveTo<effectiveFrom)
      return NextResponse.json({error:"Charge effective dates are invalid."},{status:422});
    const [before]=await db.select().from(agentCharges).where(and(eq(agentCharges.employerId,employerId),eq(agentCharges.chargeCode,chargeCode))).limit(1);
    const values={description,billingBasis,unitRate:round(unitRate),vatRate:round(vatRate),effectiveFrom,effectiveTo,status:"active",updatedAt:new Date().toISOString()};
    const [charge]=before?await db.update(agentCharges).set(values).where(eq(agentCharges.id,before.id)).returning():
      await db.insert(agentCharges).values({employerId,chargeCode,...values}).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:before?"updated:agent-charge":"created:agent-charge",entityType:"agent-charge",entityId:String(charge.id),before:before?JSON.stringify(before):null,after:JSON.stringify(charge)});
    return NextResponse.json(charge,{status:before?200:201});
  }
  if(action==="archive-charge"){
    const [before]=await db.select().from(agentCharges).where(and(eq(agentCharges.id,Number(input.id)),eq(agentCharges.employerId,employerId))).limit(1);
    if(!before)return NextResponse.json({error:"Agent charge was not found."},{status:404});
    if(before.status==="archived")return NextResponse.json({error:"Agent charge is already archived."},{status:409});
    const [charge]=await db.update(agentCharges).set({status:"archived",updatedAt:new Date().toISOString()}).where(eq(agentCharges.id,before.id)).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"archived:agent-charge",entityType:"agent-charge",entityId:String(charge.id),before:JSON.stringify(before),after:JSON.stringify(charge)});
    return NextResponse.json(charge);
  }
  if(action==="preview-invoice"){
    try{return NextResponse.json(await invoicePreview(db,employerId,String(input.periodStart||""),String(input.periodEnd||"")));}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Billing preview could not be calculated."},{status:422});}
  }
  if(action==="create-invoice"){
    const [profile]=await db.select().from(agentProfiles).where(eq(agentProfiles.employerId,employerId)).limit(1);
    if(!profile)return NextResponse.json({error:"Save the agent profile before creating an invoice."},{status:409});
    const periodStart=String(input.periodStart||""),periodEnd=String(input.periodEnd||""),invoiceDate=String(input.invoiceDate||new Date().toISOString().slice(0,10));
    if(!validDate(invoiceDate))return NextResponse.json({error:"Choose a valid invoice date."},{status:422});
    let preview;
    try{preview=await invoicePreview(db,employerId,periodStart,periodEnd);}
    catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invoice could not be calculated."},{status:422});}
    if(!preview.lines.length)return NextResponse.json({error:"No active charge produced an invoice line for this date range."},{status:422});
    const sourceEvidence=JSON.stringify({...preview.source,periodStart,periodEnd,chargeLines:preview.lines});
    const sourceChecksum=await sha256(sourceEvidence),invoiceNumber=`${profile.invoicePrefix}-${String(profile.nextInvoiceNumber).padStart(6,"0")}`;
    const prior=await db.select({id:agentInvoices.id,invoiceNumber:agentInvoices.invoiceNumber,status:agentInvoices.status}).from(agentInvoices).where(and(
      eq(agentInvoices.employerId,employerId),eq(agentInvoices.sourceChecksum,sourceChecksum),
    ));
    const duplicate=prior.find(invoice=>invoice.status!=="voided");
    if(duplicate)return NextResponse.json({error:`Invoice ${duplicate.invoiceNumber} already bills this unchanged source period. Void it before creating a replacement.`,invoiceId:duplicate.id},{status:409});
    const invoiceValues={
      employerId,invoiceNumber,invoiceDate,periodStart,periodEnd,dueDate:plusDays(invoiceDate,profile.paymentTermsDays),status:"draft",
      payslipCount:preview.payslipCount,payrollPeriodCount:preview.payrollPeriodCount,employeeCount:preview.employeeCount,submissionCount:preview.submissionCount,
      netAmount:preview.netAmount,vatAmount:preview.vatAmount,grossAmount:preview.grossAmount,lineItems:JSON.stringify(preview.lines),sourceEvidence,sourceChecksum,
    };
    await db.batch([
      db.update(agentProfiles).set({nextInvoiceNumber:profile.nextInvoiceNumber+1,updatedAt:new Date().toISOString()}).where(and(eq(agentProfiles.id,profile.id),eq(agentProfiles.nextInvoiceNumber,profile.nextInvoiceNumber))),
      db.insert(agentInvoices).values(invoiceValues),
    ]);
    const [invoice]=await db.select().from(agentInvoices).where(and(eq(agentInvoices.employerId,employerId),eq(agentInvoices.invoiceNumber,invoiceNumber))).limit(1);
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"created:agent-invoice",entityType:"agent-invoice",entityId:String(invoice.id),after:JSON.stringify(invoice)});
    return NextResponse.json({...invoice,lineItems:preview.lines},{status:201});
  }
  return NextResponse.json({error:"Unsupported agent operation."},{status:400});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON invoice lifecycle operation is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db=getDb(),[before]=await db.select().from(agentInvoices).where(and(eq(agentInvoices.id,Number(input.id)),eq(agentInvoices.employerId,employerId))).limit(1);
  if(!before)return NextResponse.json({error:"Agent invoice was not found."},{status:404});
  const now=new Date().toISOString(),action=String(input.action||"");
  if(action==="issue"){
    if(before.status!=="draft")return NextResponse.json({error:"Only a draft invoice can be issued."},{status:409});
    const [invoice]=await db.update(agentInvoices).set({status:"issued",issuedAt:now,updatedAt:now}).where(eq(agentInvoices.id,before.id)).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"issued:agent-invoice",entityType:"agent-invoice",entityId:String(invoice.id),before:JSON.stringify(before),after:JSON.stringify(invoice)});
    return NextResponse.json(invoice);
  }
  if(action==="void"){
    if(before.status==="voided")return NextResponse.json({error:"Invoice is already voided."},{status:409});
    const reason=String(input.reason||"").trim();
    if(reason.length<5||reason.length>500)return NextResponse.json({error:"Enter a void reason between 5 and 500 characters."},{status:422});
    const [invoice]=await db.update(agentInvoices).set({status:"voided",voidReason:reason,voidedAt:now,updatedAt:now}).where(eq(agentInvoices.id,before.id)).returning();
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"voided:agent-invoice",entityType:"agent-invoice",entityId:String(invoice.id),before:JSON.stringify(before),after:JSON.stringify(invoice)});
    return NextResponse.json(invoice);
  }
  return NextResponse.json({error:"Choose issue or void for the invoice."},{status:422});
}
