import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, departments, employees } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";

const clean=(value:unknown)=>String(value??"").trim();

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId")||0);
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const rows=await getDb().select().from(departments).where(eq(departments.employerId,employerId)).orderBy(asc(departments.name));
  return NextResponse.json({departments:rows});
}

export async function POST(request:Request){
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON department object is required."},{status:400});
  const employerId=Number(input.employerId||0);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const name=clean(input.name),nominalCode=clean(input.nominalCode),costCentre=clean(input.costCentre);
  if(!name||name.length>100)return NextResponse.json({error:"Department name must contain between 1 and 100 characters."},{status:422});
  const db=getDb(),existing=await db.select().from(departments).where(eq(departments.employerId,employerId));
  if(existing.some(row=>row.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return NextResponse.json({error:"A department with this name already exists."},{status:409});
  const [row]=await db.insert(departments).values({employerId,name,nominalCode:nominalCode||null,costCentre:costCentre||null}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created",entityType:"department",entityId:String(row.id),after:JSON.stringify(row)});
  return NextResponse.json({department:row},{status:201});
}

export async function PUT(request:Request){
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON department object is required."},{status:400});
  const employerId=Number(input.employerId||0),id=Number(input.id||0);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  if(!Number.isInteger(id)||id<=0)return NextResponse.json({error:"A valid department is required."},{status:400});
  const name=clean(input.name),nominalCode=clean(input.nominalCode),costCentre=clean(input.costCentre);
  if(!name||name.length>100)return NextResponse.json({error:"Department name must contain between 1 and 100 characters."},{status:422});
  const db=getDb(),rows=await db.select().from(departments).where(eq(departments.employerId,employerId));
  const before=rows.find(row=>row.id===id);if(!before)return NextResponse.json({error:"Department was not found."},{status:404});
  if(rows.some(row=>row.id!==id&&row.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return NextResponse.json({error:"A department with this name already exists."},{status:409});
  const [row]=await db.update(departments).set({name,nominalCode:nominalCode||null,costCentre:costCentre||null}).where(and(eq(departments.id,id),eq(departments.employerId,employerId))).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"updated",entityType:"department",entityId:String(id),before:JSON.stringify(before),after:JSON.stringify(row)});
  return NextResponse.json({department:row});
}

export async function DELETE(request:Request){
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON department object is required."},{status:400});
  const employerId=Number(input.employerId||0),id=Number(input.id||0);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db=getDb();
  const [before]=await db.select().from(departments).where(and(eq(departments.id,id),eq(departments.employerId,employerId))).limit(1);
  if(!before)return NextResponse.json({error:"Department was not found."},{status:404});
  const assigned=await db.select({id:employees.id}).from(employees).where(and(eq(employees.employerId,employerId),eq(employees.departmentId,id))).limit(1);
  if(assigned.length)return NextResponse.json({error:"Move employees out of this department before deleting it."},{status:409});
  await db.delete(departments).where(and(eq(departments.id,id),eq(departments.employerId,employerId)));
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"deleted",entityType:"department",entityId:String(id),before:JSON.stringify(before)});
  return NextResponse.json({deleted:true});
}
