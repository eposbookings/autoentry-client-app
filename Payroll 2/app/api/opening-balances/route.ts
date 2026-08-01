import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, payrollOpeningBalances, payPeriods, payRuns } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const moneyFields=["grossPay","taxablePay","payeTax","nicablePay","earningsAtLel","earningsLelToPt","earningsPtToUel",
  "earningsAboveUel","employeeNic","employerNic","studentLoan","postgraduateLoan","statutoryPay","employeePension","employerPension","netPay"] as const;
const nicMoneyFields=["nicablePay","earningsAtLel","earningsLelToPt","earningsPtToUel","earningsAboveUel","employeeNic","employerNic"] as const;
const niCategories=new Set(["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"]);
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")),taxYear=String(url.searchParams.get("taxYear")||"");
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  const rows=await getDb().select({
    id:payrollOpeningBalances.id,employeeId:payrollOpeningBalances.employeeId,payrollId:employees.payrollId,
    firstName:employees.firstName,lastName:employees.lastName,confidential:employees.confidential,
    taxYear:payrollOpeningBalances.taxYear,firstPayFlowPeriod:payrollOpeningBalances.firstPayFlowPeriod,
    grossPay:payrollOpeningBalances.grossPay,taxablePay:payrollOpeningBalances.taxablePay,payeTax:payrollOpeningBalances.payeTax,
    nicablePay:payrollOpeningBalances.nicablePay,earningsAtLel:payrollOpeningBalances.earningsAtLel,
    earningsLelToPt:payrollOpeningBalances.earningsLelToPt,earningsPtToUel:payrollOpeningBalances.earningsPtToUel,
    earningsAboveUel:payrollOpeningBalances.earningsAboveUel,employeeNic:payrollOpeningBalances.employeeNic,
    employerNic:payrollOpeningBalances.employerNic,nicCategoryBreakdown:payrollOpeningBalances.nicCategoryBreakdown,
    studentLoan:payrollOpeningBalances.studentLoan,
    postgraduateLoan:payrollOpeningBalances.postgraduateLoan,statutoryPay:payrollOpeningBalances.statutoryPay,
    employeePension:payrollOpeningBalances.employeePension,employerPension:payrollOpeningBalances.employerPension,
    netPay:payrollOpeningBalances.netPay,source:payrollOpeningBalances.source,notes:payrollOpeningBalances.notes,
    payloadChecksum:payrollOpeningBalances.payloadChecksum,updatedAt:payrollOpeningBalances.updatedAt,
  }).from(payrollOpeningBalances).innerJoin(employees,eq(payrollOpeningBalances.employeeId,employees.id))
    .where(and(eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),eq(employees.employerId,employerId)))
    .orderBy(asc(employees.payrollId));
  return NextResponse.json(access.membership.canViewConfidential?rows:rows.filter(row=>!row.confidential));
}

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON mid-year opening-balance object is required."},{status:400});
  const employerId=Number(input.employerId),taxYear=String(input.taxYear||""),firstPayFlowPeriod=Number(input.firstPayFlowPeriod),db=getDb();
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const frequency=payrollFrequencyRule(employer.payFrequency).frequency;
  let schedule:ReturnType<typeof scheduledPayPeriods>;
  try{schedule=scheduledPayPeriods(taxYear,frequency,employer.firstPayDate||undefined);}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(!Number.isInteger(firstPayFlowPeriod)||firstPayFlowPeriod<2||firstPayFlowPeriod>schedule.length)
    return NextResponse.json({error:`A mid-year start must begin in payroll period 2 to ${schedule.length}.`},{status:422});
  const [employee]=await db.select().from(employees).where(and(
    eq(employees.employerId,employerId),eq(employees.payrollId,String(input.payrollId||"").trim()),
  )).limit(1);
  if(!employee||employee.confidential&&!access.membership.canViewConfidential)
    return NextResponse.json({error:"The employee was not found for this employer."},{status:404});
  const values:Record<string,number>={};
  for(const field of moneyFields){
    const value=Number(input[field]||0);
    if(!Number.isFinite(value)||value<0)return NextResponse.json({error:`${field} must be a valid non-negative amount.`},{status:422});
    values[field]=round(value);
  }
  const submittedBreakdown=Array.isArray(input.nicCategoryBreakdown)?input.nicCategoryBreakdown:null;
  let nicCategoryBreakdown:Array<{niCategory:string;nicablePay:number;earningsAtLel:number;earningsLelToPt:number;earningsPtToUel:number;earningsAboveUel:number;employeeNic:number;employerNic:number}>=[];
  try{
    nicCategoryBreakdown=(submittedBreakdown||[{
      niCategory:employee.niCategory,...Object.fromEntries(nicMoneyFields.map(field=>[field,values[field]])),
    }]).map((line,index)=>{
      if(!line||typeof line!=="object"||Array.isArray(line))throw new Error(`NI category row ${index+1} must be an object.`);
      const niCategory=String(line.niCategory||"").trim().toUpperCase();
      if(!niCategories.has(niCategory))throw new Error(`NI category row ${index+1} must use a supported category.`);
      const amounts=Object.fromEntries(nicMoneyFields.map(field=>{
        const value=Number(line[field]||0);
        if(!Number.isFinite(value)||value<0)throw new Error(`NI category ${niCategory} ${field} must be a valid non-negative amount.`);
        return [field,round(value)];
      })) as Omit<typeof nicCategoryBreakdown[number],"niCategory">;
      return {niCategory,...amounts};
    });
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"NI category opening evidence is invalid."},{status:422});
  }
  if(!nicCategoryBreakdown.length)return NextResponse.json({error:"At least one NI category opening row is required."},{status:422});
  if(new Set(nicCategoryBreakdown.map(line=>line.niCategory)).size!==nicCategoryBreakdown.length)
    return NextResponse.json({error:"Each NI category may appear only once in an employee opening balance."},{status:422});
  for(const line of nicCategoryBreakdown){
    if(line.earningsAtLel+line.earningsLelToPt+line.earningsPtToUel+line.earningsAboveUel>line.nicablePay+.005)
      return NextResponse.json({error:`NI category ${line.niCategory} earnings bands cannot exceed its NIC-able opening pay.`},{status:422});
  }
  if(submittedBreakdown)for(const field of nicMoneyFields)values[field]=round(nicCategoryBreakdown.reduce((sum,line)=>sum+Number(line[field]),0));
  if(values.taxablePay>values.grossPay+.005||values.nicablePay>values.grossPay+.005)
    return NextResponse.json({error:"Taxable and NIC-able opening pay cannot exceed opening gross pay."},{status:422});
  if(values.earningsAtLel+values.earningsLelToPt+values.earningsPtToUel+values.earningsAboveUel>values.nicablePay+.005)
    return NextResponse.json({error:"The imported NIC earnings bands cannot exceed NIC-able opening pay."},{status:422});
  const yearPeriods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear)));
  const periodIds=yearPeriods.map(period=>period.id);
  const existingRuns=periodIds.length?await db.select({id:payRuns.id}).from(payRuns).where(inArray(payRuns.payPeriodId,periodIds)):[];
  if(existingRuns.length)return NextResponse.json({error:"Mid-year opening balances must be completed before any payroll run is saved for this tax year."},{status:409});
  const existingBalances=await db.select().from(payrollOpeningBalances).where(and(
    eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),
  ));
  if(existingBalances.some(row=>row.firstPayFlowPeriod!==firstPayFlowPeriod))
    return NextResponse.json({error:`This employer already starts PayFlow in period ${existingBalances[0].firstPayFlowPeriod}. All employees must use the same migration period.`},{status:409});
  const source=String(input.source||"prior-payroll-p11").trim(),notes=String(input.notes||"").trim();
  if(!["prior-payroll-p11","prior-provider-export","accountant-confirmation"].includes(source))
    return NextResponse.json({error:"Select a recognised source for the imported year-to-date evidence."},{status:422});
  if(notes.length>500)return NextResponse.json({error:"Opening-balance notes cannot exceed 500 characters."},{status:422});
  const evidence={employerId,employeeId:employee.id,taxYear,firstPayFlowPeriod,...values,nicCategoryBreakdown,source,notes:notes||null};
  const payloadChecksum=await sha256(JSON.stringify(evidence)),now=new Date().toISOString();
  const nicCategoryBreakdownJson=JSON.stringify(nicCategoryBreakdown);
  const [existing]=existingBalances.filter(row=>row.employeeId===employee.id);
  const [saved]=existing
    ?await db.update(payrollOpeningBalances).set({...values,firstPayFlowPeriod,nicCategoryBreakdown:nicCategoryBreakdownJson,source,notes:notes||null,payloadChecksum,updatedAt:now})
      .where(and(eq(payrollOpeningBalances.id,existing.id),eq(payrollOpeningBalances.employerId,employerId))).returning()
    :await db.insert(payrollOpeningBalances).values({...evidence,nicCategoryBreakdown:nicCategoryBreakdownJson,payloadChecksum}).returning();
  for(const scheduled of schedule){
    const desiredStatus=scheduled.periodNumber<firstPayFlowPeriod?"migrated":scheduled.periodNumber===firstPayFlowPeriod?"open":"future";
    const existingPeriod=yearPeriods.find(period=>period.periodNumber===scheduled.periodNumber);
    const periodValues={frequency,status:desiredStatus,payDate:scheduled.payDate,periodStart:scheduled.periodStart,periodEnd:scheduled.periodEnd,updatedAt:now};
    if(existingPeriod)await db.update(payPeriods).set(periodValues).where(eq(payPeriods.id,existingPeriod.id));
    else await db.insert(payPeriods).values({employerId,taxYear,periodNumber:scheduled.periodNumber,...periodValues});
  }
  await db.insert(auditLog).values({
    employerId,actor:access.user.email,action:existing?"updated":"created",entityType:"payroll-opening-balance",
    entityId:String(saved.id),before:existing?JSON.stringify(existing):null,after:JSON.stringify({...saved,payloadChecksum}),
  });
  return NextResponse.json(saved,{status:existing?200:201});
}
