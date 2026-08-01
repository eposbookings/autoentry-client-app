import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { employees, employerSettings, employers, payItems, payPeriods, payRuns } from "../../../../db/schema";
import { portalEmployeeId } from "../../../../lib/portal-auth";
import { p45OpeningFromFinalisedSnapshots } from "../../../../lib/p45-opening-evidence";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../../lib/pay-frequency";
import { normalisePayslipDesign, renderPayslipHtml, type PayslipRenderDocument } from "../../../../lib/payslip-design";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const money=(value:unknown)=>`£${Number(value||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const page=(title:string,body:string)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;color:#132f3a;margin:38px;max-width:820px}header{border-bottom:4px solid #087b79;padding-bottom:16px;margin-bottom:25px}h1{margin:0;font-size:25px}small{color:#64757c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 40px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #dce6e8;padding:10px 0}.total{font-size:18px;font-weight:bold;border-top:2px solid #12333d}.notice{margin-top:28px;padding:13px;background:#eef6f5}footer{margin-top:40px;font-size:11px;color:#6c7d83}@media print{body{margin:20mm}.notice{break-inside:avoid}}</style></head><body>${body}</body></html>`;

export async function GET(request:Request){
  const employeeId=await portalEmployeeId(request);
  if(!employeeId)return NextResponse.json({error:"Employee portal authentication is required."},{status:401});
  const url=new URL(request.url),type=String(url.searchParams.get("type")||""),periodNumber=Number(url.searchParams.get("period")||0),taxYear=String(url.searchParams.get("taxYear")||"2026/27"),db=getDb();
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use a valid YYYY/YY sequence."},{status:422});
  const [employee]=await db.select().from(employees).where(and(eq(employees.id,employeeId),eq(employees.employeePortal,true))).limit(1);
  if(!employee)return NextResponse.json({error:"Employee portal access is disabled."},{status:403});
  const [employer]=await db.select().from(employers).where(eq(employers.id,employee.employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const [settings]=await db.select({firstPayDate:employerSettings.firstPayDate,logoUrl:employerSettings.logoUrl,payslipDesign:employerSettings.payslipDesign}).from(employerSettings).where(eq(employerSettings.employerId,employee.employerId)).limit(1);
  let maximumPeriods=12;
  try{maximumPeriods=scheduledPayPeriods(taxYear,payrollFrequencyRule(employer.payFrequency).frequency,settings?.firstPayDate||undefined).length;}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The employer pay schedule is invalid."},{status:422});}
  if(type==="payslip"&&(!Number.isInteger(periodNumber)||periodNumber<1||periodNumber>maximumPeriods))return NextResponse.json({error:`Payslip period must be a whole number between 1 and ${maximumPeriods}.`},{status:422});
  const periods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employee.employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
  const periodIds=new Set(periods.map(p=>p.id)),runs=(await db.select().from(payRuns).where(eq(payRuns.employeeId,employeeId))).filter(run=>periodIds.has(run.payPeriodId)&&run.status==="finalised");
  const periodNumberById=new Map(periods.map(period=>[period.id,period.periodNumber]));
  const sortedRuns=[...runs].sort((a,b)=>(periodNumberById.get(a.payPeriodId)||0)-(periodNumberById.get(b.payPeriodId)||0));
  const snapshot=(run:typeof payRuns.$inferSelect|undefined)=>{try{return JSON.parse(run?.rtiSnapshot||"{}") as Record<string,unknown>;}catch{return {} as Record<string,unknown>;}};
  const lastSnapshot=snapshot(sortedRuns.at(-1));
  const p45Runs=sortedRuns.filter(run=>snapshot(run).paymentAfterLeaving!==true),p45Snapshot=snapshot(p45Runs.at(-1));
  const frozen=(evidence:Record<string,unknown>,field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(evidence,field)?evidence[field]:fallback;
  const identity=(evidence:Record<string,unknown>)=>({
    name:[String(frozen(evidence,"firstName",employee.firstName)||""),String(frozen(evidence,"middleNames",employee.middleNames)||""),String(frozen(evidence,"lastName",employee.lastName)||"")].filter(Boolean).join(" "),
    payrollId:String(frozen(evidence,"payrollId",employee.payrollId)||""),
    niNumber:String(frozen(evidence,"niNumber",employee.niNumber)||"Not recorded"),
    taxCode:String(frozen(evidence,"taxCode",employee.taxCode)||""),
    week1Month1:Boolean(frozen(evidence,"week1Month1",employee.week1Month1)),
    leavingDate:String(frozen(evidence,"leavingDate",employee.leavingDate)||""),
  });
  const {previousPay,previousTax}=p45OpeningFromFinalisedSnapshots(sortedRuns.map(snapshot),{
    previousPay:employee.p45PreviousPay,previousTax:employee.p45PreviousTax,
  });
  const finalIdentity=identity(lastSnapshot);
  const heading=(documentIdentity:ReturnType<typeof identity>)=>`<header><small>${esc(employer?.name)} · PAYE ${esc(employer?.payeReference||"")}</small><h1>${esc(documentIdentity.name)}</h1><small>Payroll ID ${esc(documentIdentity.payrollId)} · NI number ${esc(documentIdentity.niNumber)}</small></header>`;
  let html="",filename="";
  if(type==="payslip"){
    const period=periods.find(p=>p.periodNumber===periodNumber),run=runs.find(r=>r.payPeriodId===period?.id);
    if(!period||!run)return NextResponse.json({error:"That finalised payslip is not available to this employee."},{status:404});
    const runSnapshot=snapshot(run),runIdentity=identity(runSnapshot),runItems=await db.select().from(payItems).where(eq(payItems.payRunId,run.id));
    const earningItems=runItems.filter(item=>item.type==="earning"&&item.amount!==0),payments=earningItems.length?earningItems.map(item=>({label:item.name,amount:item.amount,quantity:item.quantity,rate:item.rate})):[{label:"Gross cash pay",amount:run.grossPay}];
    if(run.statutoryPay>0&&!payments.some(item=>item.label.toLowerCase().includes("statutory")))payments.push({label:"Statutory pay included",amount:run.statutoryPay});
    const payrolledBenefits=Number(runSnapshot.payrolledBenefits||0);if(payrolledBenefits>0)payments.push({label:"Payrolled benefits (non-cash)",amount:payrolledBenefits});
    const deductions=[{label:"PAYE tax",amount:run.payeTax},{label:"Employee National Insurance",amount:run.employeeNic},{label:"Pension member deduction",amount:run.employeePension},{label:"Student loan",amount:run.studentLoan},{label:"Postgraduate loan",amount:run.postgraduateLoan},{label:"Other deductions",amount:run.otherDeductions}].filter(item=>item.amount!==0);
    const eligibleRuns=sortedRuns.filter(item=>(periodNumberById.get(item.payPeriodId)||0)<=periodNumber),ytd=eligibleRuns.reduce((total,item)=>({grossPay:round(total.grossPay+item.grossPay),taxablePay:round(total.taxablePay+item.taxablePay),payeTax:round(total.payeTax+item.payeTax),employeeNic:round(total.employeeNic+item.employeeNic),employeePension:round(total.employeePension+item.employeePension),netPay:round(total.netPay+item.netPay)}),{grossPay:0,taxablePay:0,payeTax:0,employeeNic:0,employeePension:0,netPay:0});
    const document:PayslipRenderDocument={employeeName:runIdentity.name,employeeAddress:[String(runSnapshot.address||employee.address||""),String(runSnapshot.postcode||employee.postcode||"")].filter(Boolean).join(", "),payrollId:runIdentity.payrollId,niNumber:runIdentity.niNumber,taxCode:runIdentity.taxCode,niCategory:String(runSnapshot.niCategory||employee.niCategory||""),department:String(runSnapshot.departmentName||"Unassigned"),paymentMethod:String(runSnapshot.paymentMethod||employee.paymentMethod||""),periodLabel:"Period "+periodNumber,payDate:period.payDate||"",taxYear,payments,deductions,grossPay:run.grossPay,taxablePay:run.taxablePay,netPay:run.netPay,ytd,employerContributions:{employerNic:run.employerNic,employerPension:run.employerPension},paymentAfterLeaving:runSnapshot.paymentAfterLeaving===true};
    html=renderPayslipHtml([document],{employerName:employer.name,employerAddress:[employer.address,employer.postcode].filter(Boolean).join(", "),logoUrl:settings?.logoUrl||null,design:normalisePayslipDesign(settings?.payslipDesign)});
    filename="payslip-"+taxYear.replace("/","-")+"-P"+periodNumber+".html";
  }else if(type==="p60"){
    if(!periods.some(period=>period.periodNumber===maximumPeriods&&period.status==="finalised"))return NextResponse.json({error:`P60 is available only after final payroll period ${maximumPeriods} has been finalised.`},{status:409});
    const end=`${Number(taxYear.slice(0,4))+1}-04-05`;
    if(finalIdentity.leavingDate&&finalIdentity.leavingDate<end)return NextResponse.json({error:"Leavers receive a P45 rather than a P60 for this employment."},{status:409});
    if(!runs.length)return NextResponse.json({error:"No finalised payroll is available for this P60 tax year."},{status:409});
    const totals=runs.reduce((a,r)=>({pay:round(a.pay+r.taxablePay),tax:round(a.tax+r.payeTax),nic:round(a.nic+r.employeeNic)}),{pay:0,tax:0,nic:0});
    html=page(`P60 ${taxYear}`,`${heading(finalIdentity)}<h2>P60 · End of year certificate ${esc(taxYear)}</h2><div class="row"><span>Pay in this employment</span><b>${money(totals.pay)}</b></div><div class="row"><span>Tax in this employment</span><b>${money(totals.tax)}</b></div><div class="row"><span>Pay in previous employment</span><b>${money(previousPay)}</b></div><div class="row"><span>Tax in previous employment</span><b>${money(previousTax)}</b></div><div class="row total"><span>Total pay / tax</span><b>${money(totals.pay+previousPay)} / ${money(totals.tax+previousTax)}</b></div><div class="row"><span>Employee NIC</span><b>${money(totals.nic)}</b></div><div class="notice">Keep this certificate in a safe place. It records pay and tax for the tax year.</div>`);
    filename=`P60-${taxYear.replace("/","-")}.html`;
  }else if(type==="p45"){
    const p45Identity=identity(p45Snapshot);
    if(!p45Identity.leavingDate)return NextResponse.json({error:"P45 is available only after a leaving date has been recorded in finalised payroll."},{status:409});
    const start=`${Number(taxYear.slice(0,4))}-04-06`,end=`${Number(taxYear.slice(0,4))+1}-04-05`;
    if(p45Identity.leavingDate<start||p45Identity.leavingDate>end)return NextResponse.json({error:"The leaving date does not fall within the requested P45 tax year."},{status:409});
    if(!p45Runs.length)return NextResponse.json({error:"No finalised payroll is available for this P45 tax year."},{status:409});
    const totals=p45Runs.reduce((a,r)=>({pay:round(a.pay+r.taxablePay),tax:round(a.tax+r.payeTax)}),{pay:0,tax:0});
    html=page("P45 leaving statement",`${heading(p45Identity)}<h2>P45 · Details of employee leaving work</h2><div class="row"><span>Leaving date</span><b>${esc(p45Identity.leavingDate)}</b></div><div class="row"><span>Tax code</span><b>${esc(p45Identity.taxCode)}${p45Identity.week1Month1?" (week 1 / month 1)":""}</b></div><div class="row"><span>Pay in this employment</span><b>${money(totals.pay)}</b></div><div class="row"><span>Tax in this employment</span><b>${money(totals.tax)}</b></div><div class="row total"><span>Total pay / tax to date</span><b>${money(totals.pay+previousPay)} / ${money(totals.tax+previousTax)}</b></div><div class="notice">Give the appropriate parts of this statement to your next employer or benefit office. Payments made after this P45 was issued are excluded.</div>`);
    filename=`P45-${p45Identity.leavingDate}.html`;
  }else return NextResponse.json({error:"Document type must be payslip, P45 or P60."},{status:422});
  return new NextResponse(html,{headers:{"content-type":"text/html; charset=utf-8","content-disposition":`attachment; filename="${filename}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src data:"}});
}
