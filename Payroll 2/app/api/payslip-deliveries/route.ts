import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { parseStoredEmailTemplate, renderEmailTemplate } from "../../../lib/email-template";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const runIdentity=(run:typeof payRuns.$inferSelect,employee:typeof employees.$inferSelect)=>{
  let snapshot:Record<string,unknown>={};try{snapshot=JSON.parse(run.rtiSnapshot||"{}");}catch{}
  const frozen=(field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(snapshot,field)?snapshot[field]:fallback;
  return {
    payrollId:String(frozen("payrollId",employee.payrollId)||""),
    title:String(frozen("title",employee.title)||""),
    firstName:String(frozen("firstName",employee.firstName)||""),
    middleNames:String(frozen("middleNames",employee.middleNames)||""),
    lastName:String(frozen("lastName",employee.lastName)||""),
    name:[String(frozen("firstName",employee.firstName)||""),String(frozen("middleNames",employee.middleNames)||""),String(frozen("lastName",employee.lastName)||"")].filter(Boolean).join(" "),
  };
};

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const db=getDb(),rows=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"PAYSLIP-DELIVERY")));
  const employeeRows=access.membership.canViewConfidential?[]:await db.select({
    id:employees.id,payrollId:employees.payrollId,confidential:employees.confidential,
  }).from(employees).where(eq(employees.employerId,employerId));
  const hiddenIds=new Set(employeeRows.filter(row=>row.confidential).map(row=>row.id));
  const hiddenPayrollIds=new Set(employeeRows.filter(row=>row.confidential).map(row=>row.payrollId));
  return NextResponse.json(rows.map(row=>{
    let payload:any=null;try{payload=row.payload?JSON.parse(row.payload):null;}catch{}
    if(payload&&!access.membership.canViewConfidential){
      payload={...payload,
        recipients:Array.isArray(payload.recipients)?payload.recipients.filter((recipient:any)=>!hiddenIds.has(Number(recipient.employeeId))&&!hiddenPayrollIds.has(String(recipient.payrollId))):[],
        excluded:Array.isArray(payload.excluded)?payload.excluded.filter((recipient:any)=>!hiddenIds.has(Number(recipient.employeeId))&&!hiddenPayrollIds.has(String(recipient.payrollId))):[],
      };
    }
    return {...row,payload};
  }));
}

export async function POST(request:Request){
  let input:any;
  try{input=await request.json();}catch{return NextResponse.json({error:"A JSON payslip delivery request is required."},{status:400});}
  const employerId=Number(input?.employerId),taxYear=String(input?.taxYear||""),periodNumber=Number(input?.periodNumber),method=String(input?.method||"");
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  if(!["email","portal"].includes(method))return NextResponse.json({error:"Delivery method must be email or portal."},{status:422});
  const db=getDb();
  const [employer]=await db.select({
    name:employers.name,payeReference:employers.payeReference,accountsOfficeReference:employers.accountsOfficeReference,
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,contactName:employerSettings.primaryContactName,
  })
    .from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  let maximumPeriods=0;
  try{maximumPeriods=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer?.payFrequency).frequency,employer?.firstPayDate||undefined).length;}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>maximumPeriods)return NextResponse.json({error:`Payroll period must be between 1 and ${maximumPeriods}.`},{status:422});
  const [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber))).limit(1);
  if(!period||period.status!=="finalised")return NextResponse.json({error:"Finalise this payroll period before delivering payslips."},{status:409});
  const rows=await db.select({run:payRuns,employee:employees}).from(payRuns).innerJoin(employees,eq(payRuns.employeeId,employees.id)).where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.status,"finalised"),eq(employees.employerId,employerId)));
  if(!rows.length)return NextResponse.json({error:"This finalised period has no payslips to deliver."},{status:404});
  const visibleRows=access.membership.canViewConfidential?rows:rows.filter(({employee})=>!employee.confidential);
  const eligible=visibleRows.filter(({employee})=>method==="email"?Boolean(employee.email?.trim()):employee.employeePortal);
  const eligibleIds=new Set(eligible.map(({employee})=>employee.id));
  const excluded=visibleRows.filter(({employee})=>!eligibleIds.has(employee.id)).map(({employee,run})=>({employeeId:employee.id,...runIdentity(run,employee),reason:method==="email"?"Email address is missing":"Employee portal is not enabled"}));
  if(!eligible.length)return NextResponse.json({error:method==="email"?"No finalised employees have an email address.":"No finalised employees have portal access enabled.",excluded},{status:422});
  const preparedAt=new Date().toISOString();
  const templateRows=method==="email"?await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,"EMAIL-TEMPLATE"),eq(submissions.status,"recorded"))):[];
  const templates=templateRows.map(row=>({row,template:parseStoredEmailTemplate(row.payload)})).filter(item=>item.template);
  const requestedTemplateId=method==="email"&&input.templateId!==undefined&&input.templateId!==null?Number(input.templateId):null;
  if(method==="email"&&requestedTemplateId!==null&&(!Number.isInteger(requestedTemplateId)||requestedTemplateId<1))
    return NextResponse.json({error:"Select a valid active email template."},{status:422});
  const selected=requestedTemplateId===null
    ?templates.find(item=>item.template?.isDefault&&["payslip","general"].includes(item.template.reportType))
    :templates.find(item=>item.row.id===requestedTemplateId);
  if(method==="email"&&requestedTemplateId!==null&&!selected)return NextResponse.json({error:"Email template was not found for this employer."},{status:404});
  const selectedTemplate=selected?.template||{
    schemaVersion:"payflow-email-template-1",name:"PayFlow standard payslip",reportType:"payslip",
    subject:"<employer> payslip - <period>",body:"Hello <forename>,\n\nYour <report+period> is ready.\n\nRegards,\n<employer>",isDefault:true,
  };
  if(method==="email"&&!["payslip","general"].includes(selectedTemplate.reportType))
    return NextResponse.json({error:"The selected email template cannot be used for payslips."},{status:422});
  const contactParts=String(employer.contactName||"").trim().split(/\s+/).filter(Boolean);
  const recipients=eligible.map(({employee,run})=>{
    const identity=runIdentity(run,employee),periodLabel=`Period ${periodNumber}`,report="Employee payslip";
    const context={
      name:identity.name,forename:identity.firstName,surname:identity.lastName,title:identity.title,
      "employee id":identity.payrollId,"preferred name":identity.firstName,report,period:periodLabel,
      "report+period":`${report} - ${periodLabel}`,employer:employer.name||"",payeref:employer.payeReference||"",
      accountsref:employer.accountsOfficeReference||"",contact:employer.contactName||"",
      "contact forename":contactParts[0]||"","contact surname":contactParts.slice(1).join(" "),
      "user reference":"",agent:"","agent contact":"","agent contact forename":"","agent contact surname":"",
    };
    return {employeeId:employee.id,...identity,destination:method==="email"?employee.email:"employee portal",
      emailSubject:method==="email"?renderEmailTemplate(selectedTemplate.subject,context):null,
      emailBody:method==="email"?renderEmailTemplate(selectedTemplate.body,context):null,
      payRunId:run.id,grossPay:run.grossPay,taxablePay:run.taxablePay,payeTax:run.payeTax,employeeNic:run.employeeNic,
      employeePension:run.employeePension,studentLoan:run.studentLoan,postgraduateLoan:run.postgraduateLoan,
      otherDeductions:run.otherDeductions,netPay:run.netPay};
  });
  const sourceChecksum=await sha256(JSON.stringify({employerId,taxYear,periodNumber,method,recipients}));
  const previous=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.payPeriodId,period.id),eq(submissions.type,"PAYSLIP-DELIVERY")));
  const duplicate=previous.find(row=>row.payloadChecksum===sourceChecksum&&row.status!=="superseded");
  if(duplicate&&!input.resend)return NextResponse.json({error:"This exact payslip delivery batch has already been recorded. Select resend to create another batch.",deliveryId:duplicate.id},{status:409});
  const latestSameMethod=input.resend?[...previous].sort((a,b)=>b.id-a.id).find(row=>{
    try{return JSON.parse(row.payload||"{}").method===method;}catch{return false;}
  }):null;
  const status=method==="email"?"queued-external":"published";
  const payload={schemaVersion:"payflow-payslip-delivery-2",taxYear,periodNumber,method,
    template:method==="email"?{id:selected?.row.id||null,name:selectedTemplate.name,subject:selectedTemplate.subject,body:selectedTemplate.body}:null,
    recipients,excluded,sourceChecksum,externalTransmission:method==="email"?false:null,resendOf:input.resend?(duplicate?.id||latestSameMethod?.id||null):null};
  const [created]=await db.insert(submissions).values({employerId,payPeriodId:period.id,type:"PAYSLIP-DELIVERY",payload:JSON.stringify(payload),payloadChecksum:sourceChecksum,status,preparedAt,response:method==="email"?"Queued locally. Connect an approved email provider to transmit this batch.":"Payslips published to enabled employee portals."}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:`${status}:payslip-delivery`,entityType:"submission",entityId:String(created.id),after:JSON.stringify({taxYear,periodNumber,method,templateId:payload.template?.id||null,templateName:payload.template?.name||null,recipientCount:recipients.length,excludedCount:excluded.length,sourceChecksum,externalTransmission:payload.externalTransmission,resendOf:payload.resendOf})});
  return NextResponse.json({delivery:{...created,payload},recipientCount:recipients.length,excluded},{status:201});
}
