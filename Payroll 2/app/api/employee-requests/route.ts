import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employeeChangeRequests, employees } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { supersedeEmployeePaymentBatches } from "../../../lib/payment-batches";

const permitted=new Set(["email","phone","address","postcode","bankName","accountName","sortCode","accountNumber"]);
const parse=(value:string)=>{try{return JSON.parse(value) as Record<string,string|null>;}catch{return {};}};
const clean=(value:unknown)=>String(value??"").trim()||null;
const validProposal=(requestType:string,proposed:Record<string,string|null>)=>{
  const allowed=requestType==="contact"?new Set(["email","phone","address","postcode"]):requestType==="bank"?new Set(["bankName","accountName","sortCode","accountNumber"]):new Set<string>();
  if(!allowed.size||!Object.keys(proposed).length||Object.keys(proposed).some(field=>!allowed.has(field)||!permitted.has(field)))return "The request contains an unsupported employee field.";
  if(proposed.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed.email))return "The request contains an invalid email address.";
  const limits:Record<string,number>={email:254,phone:40,address:500,postcode:12,bankName:120,accountName:120};
  if(Object.entries(proposed).some(([field,value])=>value&&limits[field]&&value.length>limits[field]))return "The request contains an overlong employee value.";
  if("sortCode" in proposed&&String(proposed.sortCode||"").replace(/\D/g,"").length!==6)return "The request contains invalid bank details.";
  if("accountNumber" in proposed&&String(proposed.accountNumber||"").replace(/\D/g,"").length!==8)return "The request contains invalid bank details.";
  return null;
};

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||0);
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const rows=await getDb().select({
    id:employeeChangeRequests.id,employeeId:employeeChangeRequests.employeeId,requestType:employeeChangeRequests.requestType,
    proposedChanges:employeeChangeRequests.proposedChanges,previousValues:employeeChangeRequests.previousValues,
    status:employeeChangeRequests.status,employeeNote:employeeChangeRequests.employeeNote,reviewNote:employeeChangeRequests.reviewNote,
    createdAt:employeeChangeRequests.createdAt,reviewedAt:employeeChangeRequests.reviewedAt,
    firstName:employees.firstName,lastName:employees.lastName,payrollId:employees.payrollId,confidential:employees.confidential,
  }).from(employeeChangeRequests).innerJoin(employees,eq(employeeChangeRequests.employeeId,employees.id))
    .where(and(eq(employeeChangeRequests.employerId,employerId),eq(employees.employerId,employerId))).orderBy(desc(employeeChangeRequests.id));
  return NextResponse.json(rows.filter(row=>access.membership.canViewConfidential||!row.confidential).map(({confidential,...row})=>({...row,proposedChanges:parse(row.proposedChanges),previousValues:parse(row.previousValues)})));
}

export async function PUT(request:Request){
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON employee review object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON employee review object is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),decision=String(input.decision||"");
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(!["approved","rejected"].includes(decision))return NextResponse.json({error:"Decision must be approved or rejected."},{status:422});
  const db=getDb(),[change]=await db.select().from(employeeChangeRequests).where(and(
    eq(employeeChangeRequests.id,id),eq(employeeChangeRequests.employerId,employerId),eq(employeeChangeRequests.status,"pending"),
  )).limit(1);
  if(!change)return NextResponse.json({error:"Pending employee request was not found."},{status:404});
  const proposed=parse(change.proposedChanges);
  const proposalError=validProposal(change.requestType,proposed);
  if(proposalError)return NextResponse.json({error:proposalError},{status:422});
  const previous=parse(change.previousValues);
  const [employee]=await db.select().from(employees).where(and(eq(employees.id,change.employeeId),eq(employees.employerId,employerId))).limit(1);
  if(!employee)return NextResponse.json({error:"The employee for this request no longer exists."},{status:409});
  if(employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"You do not have permission to review requests for this confidential employee."},{status:403});
  if(decision==="approved"){
    if(!employee.employeePortal)return NextResponse.json({error:"Portal access has been disabled; reject this request or re-enable access before approval."},{status:409});
    if(change.requestType==="bank"&&!employee.portalCanEditBank)return NextResponse.json({error:"Bank-detail requests are no longer enabled for this employee."},{status:409});
    const conflicts=Object.keys(proposed).filter(field=>clean((employee as any)[field])!==clean(previous[field]));
    if(conflicts.length)return NextResponse.json({error:`Payroll has changed ${conflicts.join(", ")} since this request was submitted. Reject it and ask the employee to submit a fresh request.`},{status:409});
  }
  const now=new Date().toISOString();
  const reviewed=await db.update(employeeChangeRequests).set({status:decision,reviewedBy:access.user.userId>0?access.user.userId:null,reviewedAt:now,reviewNote:String(input.reviewNote||"").trim()||null,updatedAt:now}).where(and(
    eq(employeeChangeRequests.id,id),eq(employeeChangeRequests.employerId,employerId),eq(employeeChangeRequests.status,"pending"),
  )).returning();
  if(!reviewed.length)return NextResponse.json({error:"This employee request has already been reviewed."},{status:409});
  let supersededPaymentBatches:number[]=[];
  if(decision==="approved"){
    await db.update(employees).set({...proposed,updatedAt:now}).where(and(eq(employees.id,change.employeeId),eq(employees.employerId,employerId)));
    const paymentSourceChanged=["accountName","sortCode","accountNumber"].some(field=>field in proposed&&clean(proposed[field])!==clean((employee as any)[field]));
    if(paymentSourceChanged)supersededPaymentBatches=await supersedeEmployeePaymentBatches(db,employerId,change.employeeId,`approved portal bank-detail request ${id} changed payment instructions`);
  }
  await db.insert(auditLog).values({
    employerId,actor:access.user.displayName,action:`employee-change:${decision}`,entityType:"employee",entityId:String(change.employeeId),
    before:change.previousValues,after:JSON.stringify({requestId:id,proposed,reviewNote:String(input.reviewNote||"").trim()||null}),
  });
  if(supersededPaymentBatches.length)await db.insert(auditLog).values({
    employerId,actor:access.user.displayName,action:"superseded:bank-payment-files",entityType:"employee",entityId:String(change.employeeId),
    after:JSON.stringify({requestId:id,submissionIds:supersededPaymentBatches,reason:"approved-portal-bank-change"}),
  });
  return NextResponse.json({id,status:decision,applied:decision==="approved",supersededPaymentBatches:supersededPaymentBatches.length});
}
