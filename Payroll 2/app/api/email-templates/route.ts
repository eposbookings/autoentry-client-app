import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { parseStoredEmailTemplate, validateEmailTemplate } from "../../../lib/email-template";
import { readJsonObject } from "../../../lib/request-body";

const type="EMAIL-TEMPLATE";
const templateRows=async(employerId:number)=>{
  const rows=await getDb().select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.type,type)));
  return rows.map(row=>({row,template:parseStoredEmailTemplate(row.payload)})).filter(item=>item.template);
};

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await templateRows(employerId);
  return NextResponse.json({
    templates:rows.map(({row,template})=>({id:row.id,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,...template})),
    systemDefault:{id:0,name:"PayFlow standard payslip",reportType:"payslip",subject:"<employer> payslip - <period>",body:"Hello <forename>,\n\nYour <report+period> is ready.\n\nRegards,\n<employer>",isDefault:!rows.some(item=>item.row.status==="recorded"&&item.template?.isDefault&&["payslip","general"].includes(item.template.reportType))},
  });
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON email template is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const template={schemaVersion:"payflow-email-template-1",name:String(input.name||"").trim(),reportType:String(input.reportType||"payslip"),subject:String(input.subject||"").trim(),body:String(input.body||"").trim(),isDefault:input.isDefault===true};
  const error=validateEmailTemplate(template);if(error)return NextResponse.json({error},{status:422});
  const db=getDb(),existing=await templateRows(employerId);
  if(existing.some(item=>item.row.status==="recorded"&&item.template?.name.toLowerCase()===template.name.toLowerCase()))
    return NextResponse.json({error:"An active email template already uses this name."},{status:409});
  if(template.isDefault)for(const item of existing.filter(item=>item.row.status==="recorded"&&item.template?.isDefault&&item.template.reportType===template.reportType)){
    const payload={...item.template,isDefault:false},payloadChecksum=await sha256(JSON.stringify(payload));
    await db.update(submissions).set({payload:JSON.stringify(payload),payloadChecksum,updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,item.row.id),eq(submissions.employerId,employerId)));
  }
  const payloadChecksum=await sha256(JSON.stringify(template));
  const [created]=await db.insert(submissions).values({employerId,type,status:"recorded",payload:JSON.stringify(template),payloadChecksum,preparedAt:new Date().toISOString(),response:"Reusable local email template. No message has been transmitted."}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"created:email-template",entityType:"submission",entityId:String(created.id),after:JSON.stringify({name:template.name,reportType:template.reportType,isDefault:template.isDefault,payloadChecksum})});
  return NextResponse.json({template:{id:created.id,status:created.status,...template}},{status:201});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON email template update is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(!Number.isInteger(id)||id<1)return NextResponse.json({error:"A valid email template ID is required."},{status:422});
  const db=getDb(),rows=await templateRows(employerId),current=rows.find(item=>item.row.id===id);
  if(!current)return NextResponse.json({error:"Email template was not found for this employer."},{status:404});
  if(input.action==="archive"){
    if(current.row.status!=="recorded")return NextResponse.json({error:"Only an active email template can be archived."},{status:409});
    await db.update(submissions).set({status:"superseded",response:"Email template archived. Historical delivery evidence is unchanged.",updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,id),eq(submissions.employerId,employerId)));
    await db.insert(auditLog).values({employerId,actor:access.user.email,action:"archived:email-template",entityType:"submission",entityId:String(id),before:JSON.stringify(current.template)});
    return NextResponse.json({id,status:"superseded"});
  }
  if(current.row.status!=="recorded")return NextResponse.json({error:"Archived email templates cannot be edited."},{status:409});
  const template={schemaVersion:"payflow-email-template-1",name:String(input.name||"").trim(),reportType:String(input.reportType||"payslip"),subject:String(input.subject||"").trim(),body:String(input.body||"").trim(),isDefault:input.isDefault===true};
  const error=validateEmailTemplate(template);if(error)return NextResponse.json({error},{status:422});
  if(rows.some(item=>item.row.id!==id&&item.row.status==="recorded"&&item.template?.name.toLowerCase()===template.name.toLowerCase()))
    return NextResponse.json({error:"An active email template already uses this name."},{status:409});
  if(template.isDefault)for(const item of rows.filter(item=>item.row.id!==id&&item.row.status==="recorded"&&item.template?.isDefault&&item.template.reportType===template.reportType)){
    const payload={...item.template,isDefault:false},payloadChecksum=await sha256(JSON.stringify(payload));
    await db.update(submissions).set({payload:JSON.stringify(payload),payloadChecksum,updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,item.row.id),eq(submissions.employerId,employerId)));
  }
  const payloadChecksum=await sha256(JSON.stringify(template));
  const [updated]=await db.update(submissions).set({payload:JSON.stringify(template),payloadChecksum,updatedAt:new Date().toISOString()}).where(and(eq(submissions.id,id),eq(submissions.employerId,employerId))).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.email,action:"updated:email-template",entityType:"submission",entityId:String(id),before:JSON.stringify(current.template),after:JSON.stringify({...template,payloadChecksum})});
  return NextResponse.json({template:{id:updated.id,status:updated.status,...template}});
}
