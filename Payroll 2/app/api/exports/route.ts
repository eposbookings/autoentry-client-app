import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employees, employerSettings, employers, payPeriods, payRuns, submissions } from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { readJsonObject } from "../../../lib/request-body";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";

const csvCell=(value:string|number)=>{
  const raw=String(value),safe=typeof value==="string"&&/^[=+\-@]/.test(raw)?`'${raw}`:raw;
  return `"${safe.replaceAll('"','""')}"`;
};
const csv=(rows:Array<Array<string|number>>)=>"\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;

export async function POST(request:Request){
  const input=await readJsonObject(request);if(!input)return NextResponse.json({error:"A JSON export request object is required."},{status:400});
  const employerId=Number(input.employerId),type=String(input.type||"payments");
  const access=await requireEmployerAccess(request,employerId,"payroll-write");if(!access.ok)return access.response;
  if(type!=="payments")return NextResponse.json({error:"Use the reconciled Reports or Pensions workspace for this export type."},{status:400});
  const taxYear=String(input.taxYear||""),periodNumber=Number(input.periodNumber);
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const db=getDb();
  const [employer]=await db.select({
    payFrequency:employers.payFrequency,firstPayDate:employerSettings.firstPayDate,
  }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id)).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  let maximumPeriods=12;
  try{maximumPeriods=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,employer.firstPayDate||undefined).length;}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>maximumPeriods)return NextResponse.json({error:`Payroll period must be between 1 and ${maximumPeriods}.`},{status:422});
  const [period]=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear),eq(payPeriods.periodNumber,periodNumber))).limit(1);
  if(!period)return NextResponse.json({error:"Payroll period was not found for this employer and tax year."},{status:404});
  if(period.status!=="finalised")return NextResponse.json({error:"Finalise this payroll period before generating the employee payment file."},{status:409});
  const records=await db.select({
    employeeId:employees.id,payrollId:employees.payrollId,firstName:employees.firstName,lastName:employees.lastName,
      paymentMethod:employees.paymentMethod,accountName:employees.accountName,sortCode:employees.sortCode,accountNumber:employees.accountNumber,confidential:employees.confidential,
    payRunId:payRuns.id,status:payRuns.status,netPay:payRuns.netPay,rtiSnapshot:payRuns.rtiSnapshot,
  }).from(payRuns).innerJoin(employees,eq(payRuns.employeeId,employees.id))
    .where(and(eq(payRuns.payPeriodId,period.id),eq(payRuns.status,"finalised"),eq(employees.employerId,employerId)));
  const creditTransfers=records.filter(row=>row.paymentMethod==="credit-transfer"&&row.netPay>0);
  if(!access.membership.canViewConfidential&&creditTransfers.some(row=>row.confidential))return NextResponse.json({error:"Confidential employee permission is required to generate the complete bank payment file."},{status:403});
  const incomplete=creditTransfers.filter(row=>!String(row.accountName||"").trim()||!/^\d{6}$/.test(String(row.sortCode||"").replace(/\D/g,""))||!/^\d{8}$/.test(String(row.accountNumber||"").replace(/\D/g,"")));
  if(incomplete.length)return NextResponse.json({error:`Complete account name, six-digit sort code and eight-digit account number for: ${incomplete.map(row=>row.payrollId).join(", ")}. No partial bank file was generated.`},{status:422});
  const payable=creditTransfers.filter(row=>access.membership.canViewConfidential||!row.confidential);
  if(!payable.length)return NextResponse.json({error:"No employees in this finalised period have positive net pay and complete credit-transfer bank details."},{status:422});
  const identity=(row:typeof payable[number])=>{
    let snapshot:Record<string,unknown>={};try{snapshot=JSON.parse(row.rtiSnapshot||"{}");}catch{}
    return {
      payrollId:String(snapshot.payrollId||row.payrollId),
      name:[String(snapshot.firstName||row.firstName),String(snapshot.middleNames||""),String(snapshot.lastName||row.lastName)].filter(Boolean).join(" "),
    };
  };
  const rows:Array<Array<string|number>>=[["Payment Date","Payee","Sort Code","Account Number","Reference","Amount"],
    ...payable.map(row=>{const evidence=identity(row);return[period.payDate||"",String(row.accountName).trim(),String(row.sortCode).replace(/\D/g,""),String(row.accountNumber).replace(/\D/g,""),`${evidence.payrollId}-${periodNumber}`,row.netPay.toFixed(2)];})];
  const content=csv(rows),payloadChecksum=await sha256(content),preparedAt=new Date().toISOString();
  const previous=await db.select().from(submissions).where(and(eq(submissions.employerId,employerId),eq(submissions.payPeriodId,period.id),eq(submissions.type,"BANK-PAYMENT")));
  const duplicate=previous.find(item=>item.payloadChecksum===payloadChecksum&&item.status==="generated");
  const responseHeaders={"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="employee-bank-payments-${taxYear.replace("/","-")}-P${periodNumber}.csv"`,"x-payflow-checksum":payloadChecksum,"cache-control":"private, no-store","x-content-type-options":"nosniff"};
  if(duplicate){
    await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"redownloaded:bank-payment-file",entityType:"submission",entityId:String(duplicate.id),after:JSON.stringify({taxYear,periodNumber,payloadChecksum})});
    return new Response(content,{headers:{...responseHeaders,"x-payflow-submission-id":String(duplicate.id),"x-payflow-duplicate":"true"}});
  }
  const recipients=payable.map(row=>{const evidence=identity(row),account=String(row.accountNumber).replace(/\D/g,"");return{employeeId:row.employeeId,payRunId:row.payRunId,payrollId:evidence.payrollId,name:evidence.name,accountEnding:account.slice(-4),amount:row.netPay};});
  const total=Math.round(payable.reduce((sum,row)=>sum+row.netPay,0)*100)/100;
  const [batch]=await db.insert(submissions).values({
    employerId,payPeriodId:period.id,type:"BANK-PAYMENT",payload:JSON.stringify({schemaVersion:"payflow-bank-payment-1",taxYear,periodNumber,payDate:period.payDate,recipients,total,payloadChecksum}),
    payloadChecksum,preparedAt,status:"generated",response:"Bank payment CSV generated locally. Raw bank details are present only in the downloaded file and are not retained in the batch history.",
  }).returning();
  await db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"generated:bank-payment-file",entityType:"submission",entityId:String(batch.id),after:JSON.stringify({taxYear,periodNumber,payments:payable.length,total,payloadChecksum,rawBankDetailsRetained:false})});
  return new Response(content,{headers:{...responseHeaders,"x-payflow-submission-id":String(batch.id),"x-payflow-duplicate":"false"}});
}
