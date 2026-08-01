import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { departments as departmentTable, employees, expensesBenefits, payItems, payPeriods, payRuns } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { effectiveHourlyRate, minimumWageRate } from "../../../lib/national-minimum-wage";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const sum=(rows:any[],field:string)=>round(rows.reduce((total,row)=>total+Number(row[field]||0),0));
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Enter a valid tax year."},{status:422});
  const db=getDb(),allEmployeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId));
  const employeeRows=access.membership.canViewConfidential?allEmployeeRows:allEmployeeRows.filter(employee=>!employee.confidential);
  const departmentRows=await db.select().from(departmentTable).where(eq(departmentTable.employerId,employerId)),departmentById=new Map(departmentRows.map(row=>[row.id,row.name]));
  const departmentName=(employee:typeof employees.$inferSelect)=>employee.departmentId?departmentById.get(employee.departmentId)||"Unassigned":"Unassigned";
  const employeeIds=new Set(employeeRows.map(employee=>employee.id)),employeeById=new Map(employeeRows.map(employee=>[employee.id,employee]));
  const periods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
  const periodIds=new Set(periods.map(period=>period.id)),periodNumberById=new Map(periods.map(period=>[period.id,period.periodNumber])),runs=(await db.select().from(payRuns)).filter(run=>run.status==="finalised"&&periodIds.has(run.payPeriodId)&&employeeIds.has(run.employeeId));
  const runIds=new Set(runs.map(run=>run.id)),runById=new Map(runs.map(run=>[run.id,run]));
  const itemRows=(await db.select().from(payItems)).filter(item=>runIds.has(item.payRunId));
  const payElementMap=new Map<string,{type:string;name:string;occurrences:number;employeeIds:Set<number>;amount:number;taxable:boolean;nicable:boolean;pensionable:boolean}>();
  for(const item of itemRows){
    const key=`${item.type}\u0000${item.name}\u0000${item.taxable}\u0000${item.nicable}\u0000${item.pensionable}`;
    const existing=payElementMap.get(key)||{type:item.type,name:item.name,occurrences:0,employeeIds:new Set<number>(),amount:0,taxable:item.taxable,nicable:item.nicable,pensionable:item.pensionable};
    existing.occurrences+=1;existing.amount=round(existing.amount+item.amount);
    const run=runById.get(item.payRunId);if(run)existing.employeeIds.add(run.employeeId);
    payElementMap.set(key,existing);
  }
  const payElements=[...payElementMap.values()].map(item=>({
    type:item.type,name:item.name,occurrences:item.occurrences,employees:item.employeeIds.size,amount:item.amount,
    taxable:item.taxable,nicable:item.nicable,pensionable:item.pensionable,
  })).sort((left,right)=>right.amount-left.amount||left.name.localeCompare(right.name));
  const periodRows=periods.filter(period=>period.status==="finalised").map(period=>{
    const rows=runs.filter(run=>run.payPeriodId===period.id);
    const grossPay=sum(rows,"grossPay");
    return {periodNumber:period.periodNumber,payDate:period.payDate,payCount:rows.length,averagePay:rows.length?round(grossPay/rows.length):0,grossPay,payeTax:sum(rows,"payeTax"),employeeNic:sum(rows,"employeeNic"),employerNic:sum(rows,"employerNic"),employeePension:sum(rows,"employeePension"),employerPension:sum(rows,"employerPension"),netPay:sum(rows,"netPay"),employerCost:round(grossPay+sum(rows,"employerNic")+sum(rows,"employerPension"))};
  });
  const departmentNames=[...new Set(employeeRows.map(departmentName))];
  const departments=departmentNames.map(department=>{
    const ids=new Set(employeeRows.filter(employee=>departmentName(employee)===department).map(employee=>employee.id)),rows=runs.filter(run=>ids.has(run.employeeId));
    return {department,employees:ids.size,grossPay:sum(rows,"grossPay"),employerCost:round(sum(rows,"grossPay")+sum(rows,"employerNic")+sum(rows,"employerPension"))};
  }).sort((a,b)=>b.employerCost-a.employerCost);
  const employeeTotals=employeeRows.map(employee=>{
    const rows=runs.filter(run=>run.employeeId===employee.id).sort((left,right)=>(periodNumberById.get(left.payPeriodId)||0)-(periodNumberById.get(right.payPeriodId)||0));
    const grossPay=sum(rows,"grossPay");
    return {employeeId:employee.id,payrollId:employee.payrollId,name:`${employee.firstName} ${employee.lastName}`,department:departmentName(employee),periods:rows.length,grossPay,averagePay:rows.length?round(grossPay/rows.length):0,latestPay:rows.at(-1)?.grossPay||0,payeTax:sum(rows,"payeTax"),employeeNic:sum(rows,"employeeNic"),employeePension:sum(rows,"employeePension"),netPay:sum(rows,"netPay")};
  }).filter(row=>row.periods).sort((a,b)=>b.grossPay-a.grossPay);
  const referenceDate=periods.filter(period=>period.status==="finalised"&&period.payDate).at(-1)?.payDate||`${taxYear.slice(0,4)}-04-06`;
  const minimumWageWarnings=employeeRows.map(employee=>({employee,profile:minimumWageRate({
    dateOfBirth:employee.dateOfBirth,referenceDate,minimumWageCategory:employee.minimumWageCategory,
    apprenticeshipStartDate:employee.apprenticeshipStartDate,
  }),effectiveRate:effectiveHourlyRate(employee)})).filter(({effectiveRate,profile})=>effectiveRate>0&&effectiveRate<profile.rate).map(({employee,profile,effectiveRate})=>({
    employeeId:employee.id,name:`${employee.firstName} ${employee.lastName}`,hourlyRate:effectiveRate,payBasis:employee.payBasis,
    minimumRate:profile.rate,minimumWageCategory:profile.category,age:profile.age,referenceDate,
  }));
  const benefits=(await db.select().from(expensesBenefits)).filter(item=>employeeIds.has(item.employeeId)&&item.taxYear===taxYear&&item.status==="reviewed"&&item.nicTreatment!=="exempt");
  return NextResponse.json({
    taxYear,periods:periodRows,departments,employees:employeeTotals,payElements,minimumWageWarnings,
    totals:{payCount:runs.length,averagePay:runs.length?round(sum(runs,"grossPay")/runs.length):0,grossPay:sum(runs,"grossPay"),payeTax:sum(runs,"payeTax"),employeeNic:sum(runs,"employeeNic"),employerNic:sum(runs,"employerNic"),employeePension:sum(runs,"employeePension"),employerPension:sum(runs,"employerPension"),netPay:sum(runs,"netPay"),benefits:sum(benefits,"cashEquivalent"),class1aNic:sum(benefits,"class1aNic")},
  });
}
