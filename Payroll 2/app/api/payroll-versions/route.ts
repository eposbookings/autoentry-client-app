import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, payrollVersions } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { GET as createBackupResponse, POST as runDataOperation } from "../data/route";

const validLabel=(value:unknown)=>{
  const label=String(value||"").trim();
  return label.length>=3&&label.length<=80?label:null;
};
const validNotes=(value:unknown)=>{
  const notes=String(value||"").trim();
  return notes.length<=500?notes:null;
};
const delegatedRequest=(request:Request,path:string,input?:Record<string,unknown>)=>{
  const headers=new Headers(request.headers);
  if(input)headers.set("content-type","application/json");
  return new Request(new URL(path,request.url),{
    method:input?"POST":"GET",headers,body:input?JSON.stringify(input):undefined,
  });
};
const responseBody=async(response:Response)=>{
  try{return await response.json();}catch{return {error:"The payroll recovery service returned an unreadable response."};}
};
const serialiseVersion=(row:any)=>({
  id:row.id,label:row.label,notes:row.notes,backupChecksum:row.backupChecksum,schemaVersion:row.schemaVersion,
  recordCount:row.recordCount,employeeCount:row.employeeCount,payPeriodCount:row.payPeriodCount,
  finalisedPeriodCount:row.finalisedPeriodCount,createdBy:row.createdBy,createdAt:row.createdAt,
  restoredAt:row.restoredAt,restoredBy:row.restoredBy,status:row.status,
});

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId"));
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const rows=await getDb().select().from(payrollVersions).where(eq(payrollVersions.employerId,employerId)).orderBy(desc(payrollVersions.createdAt),desc(payrollVersions.id)).limit(50);
  return NextResponse.json(rows.map(serialiseVersion));
}

export async function POST(request:Request){
  let input:any;
  try{input=await request.json();}catch{return NextResponse.json({error:"A JSON payroll-version operation is required."},{status:400});}
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON payroll-version operation is required."},{status:400});
  const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db=getDb();

  if(input.action==="save"){
    const label=validLabel(input.label),notes=validNotes(input.notes);
    if(!label)return NextResponse.json({error:"Version label must contain between 3 and 80 characters."},{status:422});
    if(notes===null)return NextResponse.json({error:"Version notes must contain 500 characters or fewer."},{status:422});
    const existing=await db.select({id:payrollVersions.id}).from(payrollVersions).where(eq(payrollVersions.employerId,employerId)).limit(51);
    if(existing.length>=50)return NextResponse.json({error:"This employer already has 50 retained payroll versions. Archive or export older recovery points before adding another."},{status:409});
    const backupResponse=await createBackupResponse(delegatedRequest(request,`/api/data?employerId=${employerId}`));
    const backup=await responseBody(backupResponse);
    if(!backupResponse.ok)return NextResponse.json(backup,{status:backupResponse.status});
    const payload=JSON.stringify(backup);
    if(payload.length>25_000_000)return NextResponse.json({error:"This payroll version exceeds the 25 MB retained-version limit. Download an encrypted file backup instead."},{status:413});
    const recordCount=Object.values(backup.counts||{}).reduce((sum:number,value:any)=>sum+Number(value||0),0);
    const finalisedPeriodCount=(backup.dataset?.payPeriods||[]).filter((period:any)=>period.status==="finalised").length;
    const createdAt=new Date().toISOString();
    const [created]=await db.insert(payrollVersions).values({
      employerId,label,notes:notes||null,backupPayload:payload,backupChecksum:backup.checksum.value,
      schemaVersion:backup.schemaVersion,recordCount,employeeCount:Number(backup.counts?.employees||0),
      payPeriodCount:Number(backup.counts?.payPeriods||0),finalisedPeriodCount,createdBy:access.user.displayName,createdAt,updatedAt:createdAt,
    }).returning();
    await db.insert(auditLog).values({
      employerId,actor:access.user.displayName,action:"created:payroll-version",entityType:"payroll-version",entityId:String(created.id),
      after:JSON.stringify({label,notes:notes||null,checksum:backup.checksum.value,recordCount,finalisedPeriodCount}),
    });
    return NextResponse.json(serialiseVersion(created),{status:201});
  }

  if(!["analyse","restore","archive"].includes(input.action))return NextResponse.json({error:"Unsupported payroll-version operation."},{status:400});
  if(access.membership.role!=="owner")return NextResponse.json({error:"Only an employer owner can analyse, restore or archive retained payroll versions."},{status:403});
  const versionId=Number(input.versionId);
  if(!Number.isInteger(versionId)||versionId<1)return NextResponse.json({error:"A valid payroll version is required."},{status:400});
  const [version]=await db.select().from(payrollVersions).where(and(eq(payrollVersions.id,versionId),eq(payrollVersions.employerId,employerId))).limit(1);
  if(!version)return NextResponse.json({error:"Payroll version was not found for this employer."},{status:404});
  if(input.action==="archive"){
    if(version.status==="archived")return NextResponse.json(serialiseVersion(version));
    await db.batch([
      db.update(payrollVersions).set({status:"archived",updatedAt:new Date().toISOString()}).where(and(eq(payrollVersions.id,versionId),eq(payrollVersions.employerId,employerId))),
      db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"archived:payroll-version",entityType:"payroll-version",entityId:String(versionId),before:JSON.stringify({status:version.status}),after:JSON.stringify({status:"archived"})}),
    ]);
    return NextResponse.json({...serialiseVersion(version),status:"archived"});
  }
  let backup:any;
  try{backup=JSON.parse(version.backupPayload);}catch{return NextResponse.json({error:"The retained payroll version is unreadable."},{status:422});}
  if(backup?.checksum?.value!==version.backupChecksum)return NextResponse.json({error:"The retained payroll version checksum no longer matches its stored evidence."},{status:422});
  const action=input.action==="analyse"?"analyse-restore":"restore-backup";
  const delegated=await runDataOperation(delegatedRequest(request,"/api/data",{
    action,employerId,backup,confirmation:input.confirmation,currentFingerprint:input.currentFingerprint,
  }));
  const body=await responseBody(delegated);
  if(!delegated.ok)return NextResponse.json(body,{status:delegated.status});
  if(action==="analyse-restore")return NextResponse.json({...body,version:serialiseVersion(version)});
  const restoredAt=new Date().toISOString();
  await db.batch([
    db.update(payrollVersions).set({restoredAt,restoredBy:access.user.displayName,updatedAt:restoredAt}).where(and(eq(payrollVersions.id,versionId),eq(payrollVersions.employerId,employerId))),
    db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"restored:payroll-version",entityType:"payroll-version",entityId:String(versionId),after:JSON.stringify({label:version.label,checksum:version.backupChecksum,restoredAt})}),
  ]);
  return NextResponse.json({...body,versionId,versionLabel:version.label,restoredAt});
}
