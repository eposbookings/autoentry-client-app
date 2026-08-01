import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLog, employeeChangeRequests, employees } from "../../../../db/schema";
import { portalEmployeeId } from "../../../../lib/portal-auth";

const contactFields=["email","phone","address","postcode"] as const;
const bankFields=["bankName","accountName","sortCode","accountNumber"] as const;
const clean=(value:unknown)=>String(value??"").trim()||null;
const parse=(value:string)=>{try{return JSON.parse(value) as Record<string,string|null>;}catch{return {};}};

export async function GET(request:Request){
  const employeeId=await portalEmployeeId(request);
  if(!employeeId)return NextResponse.json({error:"Employee portal authentication is required."},{status:401});
  const db=getDb(),[employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,employeeId),eq(employees.employeePortal,true))).limit(1);
  if(!employee)return NextResponse.json({error:"Employee portal access is disabled."},{status:403});
  const rows=await db.select({
    id:employeeChangeRequests.id,requestType:employeeChangeRequests.requestType,status:employeeChangeRequests.status,
    proposedChanges:employeeChangeRequests.proposedChanges,employeeNote:employeeChangeRequests.employeeNote,
    reviewNote:employeeChangeRequests.reviewNote,createdAt:employeeChangeRequests.createdAt,reviewedAt:employeeChangeRequests.reviewedAt,
  }).from(employeeChangeRequests).where(eq(employeeChangeRequests.employeeId,employeeId)).orderBy(desc(employeeChangeRequests.id));
  return NextResponse.json(rows.map(row=>({...row,proposedChanges:parse(row.proposedChanges)})));
}

export async function POST(request:Request){
  const employeeId=await portalEmployeeId(request);
  if(!employeeId)return NextResponse.json({error:"Employee portal authentication is required."},{status:401});
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON employee change object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON employee change object is required."},{status:400});
  const db=getDb();
  const [employee]=await db.select().from(employees).where(and(eq(employees.id,employeeId),eq(employees.employeePortal,true))).limit(1);
  if(!employee)return NextResponse.json({error:"Employee portal access is disabled."},{status:403});
  const requestedType=String(input.requestType||"contact");
  if(!["contact","bank"].includes(requestedType))return NextResponse.json({error:"Select contact or bank details."},{status:422});
  if(requestedType==="bank"&&!employee.portalCanEditBank)return NextResponse.json({error:"Payroll has not enabled bank-detail requests for this employee."},{status:403});
  const fields=requestedType==="bank"?bankFields:contactFields,proposed:Record<string,string|null>={},previous:Record<string,string|null>={};
  for(const field of fields){const value=clean(input[field]);if(value!==clean(employee[field])){proposed[field]=value;previous[field]=clean(employee[field]);}}
  if(proposed.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed.email))return NextResponse.json({error:"Enter a valid email address."},{status:422});
  const limits:Record<string,number>={email:254,phone:40,address:500,postcode:12,bankName:120,accountName:120};
  const tooLong=Object.entries(proposed).find(([field,value])=>value&&limits[field]&&value.length>limits[field]);
  if(tooLong)return NextResponse.json({error:`${tooLong[0]} cannot exceed ${limits[tooLong[0]]} characters.`},{status:422});
  if(requestedType==="bank"){
    const sortCode=String(proposed.sortCode??employee.sortCode??"").replace(/\D/g,""),accountNumber=String(proposed.accountNumber??employee.accountNumber??"").replace(/\D/g,"");
    if(sortCode.length!==6)return NextResponse.json({error:"Sort code must contain 6 digits."},{status:422});
    if(accountNumber.length!==8)return NextResponse.json({error:"Account number must contain 8 digits."},{status:422});
    if("sortCode" in proposed)proposed.sortCode=sortCode;if("accountNumber" in proposed)proposed.accountNumber=accountNumber;
  }
  if(!Object.keys(proposed).length)return NextResponse.json({error:"No changed details were supplied."},{status:422});
  const employeeNote=clean(input.employeeNote);
  if(employeeNote&&employeeNote.length>500)return NextResponse.json({error:"Employee request notes cannot exceed 500 characters."},{status:422});
  const existing=await db.select({id:employeeChangeRequests.id}).from(employeeChangeRequests).where(and(
    eq(employeeChangeRequests.employeeId,employeeId),eq(employeeChangeRequests.requestType,requestedType),eq(employeeChangeRequests.status,"pending"),
  )).limit(1);
  if(existing.length)return NextResponse.json({error:`A ${requestedType} change request is already awaiting payroll review.`},{status:409});
  const now=new Date().toISOString(),[created]=await db.insert(employeeChangeRequests).values({
    employerId:employee.employerId,employeeId,requestType:requestedType,proposedChanges:JSON.stringify(proposed),
    previousValues:JSON.stringify(previous),employeeNote,createdAt:now,updatedAt:now,
  }).returning();
  await db.insert(auditLog).values({
    employerId:employee.employerId,actor:`Employee portal ${employee.payrollId}`,action:"employee-change:requested",
    entityType:"employee",entityId:String(employeeId),after:JSON.stringify({requestId:created.id,requestType:requestedType,fields:Object.keys(proposed)}),
  });
  return NextResponse.json({id:created.id,status:created.status,requestType:created.requestType},{status:201});
}
