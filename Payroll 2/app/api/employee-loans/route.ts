import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employeeLoanDeductions, employeeLoans, employees } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";

const validDate=(value:unknown)=>{
  const text=String(value||""),date=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===text;
};

export async function GET(request:Request){
  const employerId=Number(new URL(request.url).searchParams.get("employerId")),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  const joined=await db.select().from(employeeLoans).innerJoin(employees,eq(employeeLoans.employeeId,employees.id))
    .where(and(eq(employeeLoans.employerId,employerId),eq(employees.employerId,employerId))).orderBy(desc(employeeLoans.id));
  const visible=access.membership.canViewConfidential?joined:joined.filter(row=>!row.employees.confidential);
  const ids=new Set(visible.map(row=>row.employee_loans.id));
  const history=(await db.select().from(employeeLoanDeductions).orderBy(desc(employeeLoanDeductions.id))).filter(row=>ids.has(row.employeeLoanId));
  return NextResponse.json({loans:visible.map(row=>({...row.employee_loans,payrollId:row.employees.payrollId,employeeName:`${row.employees.firstName} ${row.employees.lastName}`})),history});
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON employee loan object is required."},{status:400});
  const employerId=Number(input.employerId),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [employee]=await db.select().from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"")))).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee was not found for this employer."},{status:404});
  const type=String(input.type||""),reference=String(input.reference||"").trim();
  if(!["loan","advance","overpayment"].includes(type))return NextResponse.json({error:"Type must be loan, advance or overpayment."},{status:422});
  if(reference.length<3||reference.length>80)return NextResponse.json({error:"A reference of 3 to 80 characters is required."},{status:422});
  const originalAmount=Number(input.originalAmount),regularDeduction=Number(input.regularDeduction);
  if(!Number.isFinite(originalAmount)||originalAmount<=0||!Number.isFinite(regularDeduction)||regularDeduction<=0)
    return NextResponse.json({error:"Original amount and regular deduction must be positive amounts."},{status:422});
  if(!validDate(input.startDate))return NextResponse.json({error:"Enter a valid recovery start date."},{status:422});
  const [duplicate]=await db.select({id:employeeLoans.id}).from(employeeLoans).where(and(eq(employeeLoans.employerId,employerId),eq(employeeLoans.reference,reference))).limit(1);
  if(duplicate)return NextResponse.json({error:"This employer already has a loan ledger with that reference."},{status:409});
  const [created]=await db.insert(employeeLoans).values({employerId,employeeId:employee.id,type,reference,originalAmount,balance:originalAmount,regularDeduction,startDate:String(input.startDate),status:"active"}).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"created:employee-loan",entityType:"employee-loan",entityId:String(created.id),after:JSON.stringify(created)});
  return NextResponse.json(created,{status:201});
}

export async function PUT(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON employee loan update is required."},{status:400});
  const employerId=Number(input.employerId),id=Number(input.id),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  const [joined]=await db.select().from(employeeLoans).innerJoin(employees,eq(employeeLoans.employeeId,employees.id)).where(and(eq(employeeLoans.id,id),eq(employeeLoans.employerId,employerId),eq(employees.employerId,employerId))).limit(1);
  if(!joined||joined.employees.confidential&&!access.membership.canViewConfidential)return NextResponse.json({error:"Employee loan ledger was not found."},{status:404});
  const existing=joined.employee_loans;
  const action=String(input.action||"");
  if(!["suspend","resume","stop"].includes(action))return NextResponse.json({error:"Action must be suspend, resume or stop."},{status:422});
  if(action==="resume"&&existing.status!=="suspended")return NextResponse.json({error:"Only a suspended ledger can be resumed."},{status:409});
  if(action==="suspend"&&existing.status!=="active")return NextResponse.json({error:"Only an active ledger can be suspended."},{status:409});
  const status=action==="resume"?"active":action==="suspend"?"suspended":"stopped";
  const [updated]=await db.update(employeeLoans).set({status,updatedAt:new Date().toISOString()}).where(eq(employeeLoans.id,id)).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:`${action}:employee-loan`,entityType:"employee-loan",entityId:String(id),before:JSON.stringify(existing),after:JSON.stringify(updated)});
  return NextResponse.json(updated);
}
