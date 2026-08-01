import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  attachmentOrders, attachmentOrderDeductions, auditLog, cisPayments, departments, employeeLoanDeductions, employeeLoans, employeePayRounding, employees, employerSettings, employers,
  expensesBenefits, hmrcPayments, holidayFundEntries, holidayFundSettings, leaveEvents, payrollAdjustments, payrollOpeningBalances, payItems, payPeriods, payRoundingEntries, payRuns, statutoryNotices, subcontractors,
} from "../../../db/schema";
import { statutoryPayAllocation, statutoryPayAllocationForRange, taxMonthRange } from "../../../lib/pay-periods";
import { apprenticeshipLevyByMonth } from "../../../lib/apprenticeship-levy";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { nicEarningsBands } from "../../../lib/nic-bands";
import { leaveEntitlementBalance } from "../../../lib/leave-entitlement";
import { parseFrozenRtiSnapshot } from "../../../lib/rti-snapshot";
import { p45OpeningFromFinalisedSnapshots } from "../../../lib/p45-opening-evidence";
import { hasValidFrozenPensionSnapshot, parseFrozenPensionSnapshot } from "../../../lib/pension-snapshot";
import { cashDenominations, cashMakeup } from "../../../lib/cash-makeup";
import { payrollFrequencyRule, scheduledPayPeriods, taxMonthForDate } from "../../../lib/pay-frequency";
import { formatUkDate } from "../../../lib/uk-date";
import { normalisePayslipDesign, renderPayslipHtml, type PayslipRenderDocument } from "../../../lib/payslip-design";

const reportTypes=[
  "p11","p45","p60","p11d","p11db","p46car","pbik","p30","p32","payslips","statutory-pay",
  "leave-summary","calendar","statutory-notices","smp1","spp1","sap1","ssp1","spbp1","neo1",
  "attachments","attachment-payments","child-support-payments","employee-details","employee-list","joiners-leavers","starter-statement","blank-joiner-form","employee-count","pensions","cis","journal","accounting-file","payroll-giving","payments","cash-payments","cash-request","cash-receipt","cheque-payments","employee-loans","cash-rounding","holiday-fund",
];
const statutoryNoticeReportForms:Record<string,string>={
  smp1:"SMP1",spp1:"SPP1",sap1:"SAP1",ssp1:"SSP1",spbp1:"SPBP1",neo1:"NEO1",
};
const employeeIdentifyingReports=new Set([
  "p11","p45","p60","payslips","statutory-pay","leave-summary","calendar","statutory-notices",
  ...Object.keys(statutoryNoticeReportForms),
  "attachments","attachment-payments","child-support-payments","employee-details","employee-list","joiners-leavers","starter-statement","pensions","payroll-giving","p11d","p46car","pbik","employee-count","payments","cash-payments","cash-request","cash-receipt","cheque-payments","employee-loans","cash-rounding","holiday-fund","accounting-file",
]);
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const openingNicCategories=(value:string)=>{
  try{
    const parsed=JSON.parse(value||"[]");
    return Array.isArray(parsed)?parsed.filter(line=>line&&typeof line==="object"&&!Array.isArray(line)):[];
  }catch{return [];}
};
const validTaxYear=(value:string)=>/^\d{4}\/\d{2}$/.test(value)&&Number(value.slice(5))===(Number(value.slice(0,4))+1)%100;
const csvCell=(value:unknown)=>{
  const raw=String(value??""),safe=typeof value==="string"&&/^[=+\-@]/.test(raw)?`'${raw}`:raw;
  return `"${safe.replaceAll('"','""')}"`;
};
const csv=(rows:unknown[][])=>"\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const money=(value:unknown)=>`£${Number(value||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const taxDates=(taxYear:string)=>{
  const startYear=Number(taxYear.slice(0,4));
  return {start:`${startYear}-04-06`,end:`${startYear+1}-04-05`};
};
type Report={title:string;columns:string[];rows:unknown[][];notes?:string[];document?:Record<string,unknown>[];employeeIds?:number[]};
const sourceChecksum=async(data:Pick<Report,"columns"|"rows">,type:string,taxYear:string)=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type,taxYear,columns:data.columns,rows:data.rows}));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,"0")).join("");
};
const reportErrorResponse=(error:unknown)=>{
  const message=error instanceof Error?error.message:"Report failed.";
  const status=/not found|Employer was not found/i.test(message)?404:/must be finalised|only be generated after/i.test(message)?409:422;
  return NextResponse.json({error:message},{status});
};

async function reportData(employerId:number,taxYear:string,type:string,canViewConfidential:boolean,employeeId?:number,requestedPeriod?:number):Promise<Report> {
  const db=getDb(),dates=taxDates(taxYear);
  if(!validTaxYear(taxYear))throw new Error("Tax year must use the format 2026/27.");
  if(employeeId&&["p30","p32","p11db","blank-joiner-form","employee-count","cis"].includes(type))throw new Error("This is an employer-level report and cannot be filtered to one employee.");
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)throw new Error("Employer was not found.");
  const [settings]=await db.select({
    firstPayDate:employerSettings.firstPayDate,
    accountingDefaultWagesCode:employerSettings.accountingDefaultWagesCode,
    accountingControlCode:employerSettings.accountingControlCode,
    accountingPayeCode:employerSettings.accountingPayeCode,
    accountingNicCode:employerSettings.accountingNicCode,
    accountingPensionCode:employerSettings.accountingPensionCode,
    accountingOtherDeductionsCode:employerSettings.accountingOtherDeductionsCode,
    accountingEmployerNicExpenseCode:employerSettings.accountingEmployerNicExpenseCode,
    accountingEmployerPensionExpenseCode:employerSettings.accountingEmployerPensionExpenseCode,
  }).from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  const frequency=payrollFrequencyRule(employer.payFrequency).frequency;
  const paySchedule=scheduledPayPeriods(taxYear,frequency,settings?.firstPayDate||undefined);
  const maximumPeriods=paySchedule.length;
  const employeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId)).orderBy(asc(employees.id));
  const reportEmployees=employeeIdentifyingReports.has(type)&&!canViewConfidential?employeeRows.filter(e=>!e.confidential):employeeRows;
  const allowedEmployees=employeeId?reportEmployees.filter(e=>e.id===employeeId):reportEmployees;
  if(employeeId&&!allowedEmployees.length)throw new Error("Employee was not found for this employer.");
  const allowedIds=new Set(allowedEmployees.map(e=>e.id));
  const migrationOpenings=(await db.select().from(payrollOpeningBalances).where(and(
    eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,taxYear),
  ))).filter(row=>allowedIds.has(row.employeeId));
  const migrationOpeningByEmployee=new Map(migrationOpenings.map(row=>[row.employeeId,row]));
  const periods=await db.select().from(payPeriods).where(and(eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,taxYear))).orderBy(asc(payPeriods.periodNumber));
  const periodSensitive=new Set(["p11","payslips","journal","accounting-file","pensions","attachments","attachment-payments","child-support-payments","payroll-giving","payments","cash-payments","cash-request","cash-receipt","cheque-payments","employee-loans","cash-rounding","holiday-fund"]);
  const taxMonthSensitive=new Set(["p30","p32"]);
  if(requestedPeriod&&(!Number.isInteger(requestedPeriod)||requestedPeriod<1||requestedPeriod>(taxMonthSensitive.has(type)?12:maximumPeriods)))
    throw new Error(taxMonthSensitive.has(type)?"HMRC tax month must be between 1 and 12.":`Payroll period must be between 1 and ${maximumPeriods}.`);
  const reportPeriods=requestedPeriod&&periodSensitive.has(type)?periods.filter(p=>p.periodNumber===requestedPeriod):periods;
  if(requestedPeriod&&periodSensitive.has(type)&&!reportPeriods.length)throw new Error("Payroll period was not found for this employer and tax year.");
  if(requestedPeriod&&periodSensitive.has(type)&&reportPeriods[0]?.status!=="finalised")throw new Error("The selected payroll period must be finalised before this report can be generated.");
  const periodIds=new Set(reportPeriods.map(p=>p.id)),allPeriodIds=new Set(periods.map(p=>p.id));
  const employerRuns=(await db.select().from(payRuns)).filter(r=>r.status==="finalised"&&allowedIds.has(r.employeeId));
  const allRuns=employerRuns.filter(r=>allPeriodIds.has(r.payPeriodId));
  const runs=employerRuns.filter(r=>periodIds.has(r.payPeriodId));
  const frozenEvidenceReports=new Set(["p11","p45","p60","p30","p32","payslips","journal","accounting-file","pensions","payroll-giving","payments","cash-payments","cash-request","cash-receipt","cheque-payments","cash-rounding"]);
  if(frozenEvidenceReports.has(type))for(const run of allRuns)parseFrozenRtiSnapshot(run.rtiSnapshot);
  if(type==="pensions"&&allRuns.some(run=>run.pensionSchemeId&&!hasValidFrozenPensionSnapshot(run.pensionSnapshot)))
    throw new Error("A finalised contribution has invalid frozen pension evidence. Reopen and recalculate the affected payroll.");
  const rtiSnapshot=(run:typeof payRuns.$inferSelect)=>{
    try{return JSON.parse(run.rtiSnapshot||"{}") as Record<string,unknown>;}catch{return {} as Record<string,unknown>;}
  };
  const pensionEvidence=(run:typeof payRuns.$inferSelect)=>{
    if(!run.pensionSchemeId)return {method:"none",deduction:0,taxRelief:0,gross:0};
    const snapshot=parseFrozenPensionSnapshot(run.pensionSnapshot);
    return {
      method:String(snapshot.taxRelief||"legacy"),
      deduction:Number(snapshot.employeeDeduction??run.employeePension),
      taxRelief:Number(snapshot.employeeTaxRelief??0),
      gross:Number(snapshot.employeeGrossContribution??run.employeePension),
    };
  };
  const periodNumber=new Map(periods.map(p=>[p.id,p.periodNumber]));
  const name=new Map(allowedEmployees.map(e=>[e.id,`${e.firstName} ${e.lastName}`]));
  const totals=(employee:number)=>allRuns.filter(r=>r.employeeId===employee).reduce((a,r)=>({
    gross:round(a.gross+r.grossPay),taxable:round(a.taxable+r.taxablePay),tax:round(a.tax+r.payeTax),
    employeeNic:round(a.employeeNic+r.employeeNic),employerNic:round(a.employerNic+r.employerNic),
    studentLoans:round(a.studentLoans+r.studentLoan+r.postgraduateLoan),employeePension:round(a.employeePension+r.employeePension),
    employerPension:round(a.employerPension+r.employerPension),statutoryPay:round(a.statutoryPay+r.statutoryPay),net:round(a.net+r.netPay),
  }),(()=>{
    const opening=migrationOpeningByEmployee.get(employee);
    return {
      gross:Number(opening?.grossPay||0),taxable:Number(opening?.taxablePay||0),tax:Number(opening?.payeTax||0),
      employeeNic:Number(opening?.employeeNic||0),employerNic:Number(opening?.employerNic||0),
      studentLoans:round(Number(opening?.studentLoan||0)+Number(opening?.postgraduateLoan||0)),
      employeePension:Number(opening?.employeePension||0),employerPension:Number(opening?.employerPension||0),
      statutoryPay:Number(opening?.statutoryPay||0),net:Number(opening?.netPay||0),
    };
  })());
  const openingBalance=(employee:typeof employees.$inferSelect)=>{
    const snapshots=allRuns.filter(run=>run.employeeId===employee.id)
      .sort((left,right)=>(periodNumber.get(left.payPeriodId)||0)-(periodNumber.get(right.payPeriodId)||0))
      .map(rtiSnapshot);
    return p45OpeningFromFinalisedSnapshots(snapshots,{
      previousPay:employee.p45PreviousPay,previousTax:employee.p45PreviousTax,
    });
  };
  const finalisedIdentity=(employee:typeof employees.$inferSelect)=>{
    const employeeRuns=allRuns.filter(run=>run.employeeId===employee.id).sort((left,right)=>(periodNumber.get(left.payPeriodId)||0)-(periodNumber.get(right.payPeriodId)||0));
    const last=employeeRuns.at(-1),snapshot=last?rtiSnapshot(last):{};
    const frozen=(field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(snapshot,field)?snapshot[field]:fallback;
    return {
      last,snapshot,
      name:[String(frozen("firstName",employee.firstName)||""),String(frozen("middleNames",employee.middleNames)||""),String(frozen("lastName",employee.lastName)||"")].filter(Boolean).join(" "),
      payrollId:String(frozen("payrollId",employee.payrollId)||""),
      niNumber:String(frozen("niNumber",employee.niNumber)||""),
      taxCode:String(frozen("taxCode",employee.taxCode)||""),
      week1Month1:Boolean(snapshot.week1Month1??employee.week1Month1),
      startDate:String(frozen("startDate",employee.startDate)||""),
      leavingDate:String(frozen("leavingDate",employee.leavingDate)||""),
    };
  };
  const common={employer:employer.name,payeReference:employer.payeReference||"",taxYear};

  if(type==="p11"){
    const rows:unknown[][]=[];
    for(const e of allowedEmployees){
      const migrationOpening=migrationOpeningByEmployee.get(e.id);
      const p45Opening=openingBalance(e);
      let employmentTaxableToDate=Number(migrationOpening?.taxablePay||0),employmentTaxToDate=Number(migrationOpening?.payeTax||0);
      if(migrationOpening&&(!requestedPeriod||requestedPeriod===migrationOpening.firstPayFlowPeriod)){
        const parsedCategories=openingNicCategories(migrationOpening.nicCategoryBreakdown);
        const categoryRows=parsedCategories.length?parsedCategories:[{
          niCategory:e.niCategory,nicablePay:migrationOpening.nicablePay,earningsAtLel:migrationOpening.earningsAtLel,
          earningsLelToPt:migrationOpening.earningsLelToPt,earningsPtToUel:migrationOpening.earningsPtToUel,
          earningsAboveUel:migrationOpening.earningsAboveUel,employeeNic:migrationOpening.employeeNic,employerNic:migrationOpening.employerNic,
        }];
        categoryRows.forEach((category,index)=>rows.push([
          `${e.firstName} ${e.lastName}`,e.payrollId,index===0?`Opening before P${migrationOpening.firstPayFlowPeriod}`:`Opening NI category ${category.niCategory} before P${migrationOpening.firstPayFlowPeriod}`,
          e.taxCode,String(category.niCategory||e.niCategory),
          index===0?migrationOpening.grossPay:0,0,index===0?migrationOpening.taxablePay:0,index===0?round(migrationOpening.taxablePay+p45Opening.previousPay):0,
          index===0?migrationOpening.payeTax:0,index===0?round(migrationOpening.payeTax+p45Opening.previousTax):0,Number(category.nicablePay||0),
          Number(category.earningsAtLel||0),Number(category.earningsLelToPt||0),Number(category.earningsPtToUel||0),Number(category.earningsAboveUel||0),
          Number(category.employeeNic||0),Number(category.employerNic||0),index===0?migrationOpening.statutoryPay:0,index===0?migrationOpening.studentLoan:0,
          index===0?migrationOpening.postgraduateLoan:0,index===0?migrationOpening.netPay:0,
        ]));
      }
      for(const r of allRuns.filter(v=>v.employeeId===e.id).sort((a,b)=>(periodNumber.get(a.payPeriodId)||0)-(periodNumber.get(b.payPeriodId)||0))){
        const snapshot=rtiSnapshot(r),taxCode=String(snapshot.taxCode||e.taxCode),week1Month1=Boolean(snapshot.week1Month1??e.week1Month1),niCategory=String(snapshot.niCategory||e.niCategory);
        const periodName=[String(snapshot.firstName||e.firstName),String(snapshot.middleNames||e.middleNames||""),String(snapshot.lastName||e.lastName)].filter(Boolean).join(" ");
        const opening=p45OpeningFromFinalisedSnapshots([snapshot],{
          previousPay:e.p45PreviousPay,previousTax:e.p45PreviousTax,
        });
        employmentTaxableToDate=round(employmentTaxableToDate+r.taxablePay);
        employmentTaxToDate=round(employmentTaxToDate+r.payeTax);
        const taxableToDate=round(employmentTaxableToDate+opening.previousPay);
        const taxToDate=round(employmentTaxToDate+opening.previousTax);
        if(requestedPeriod&&periodNumber.get(r.payPeriodId)!==requestedPeriod)continue;
        const snapshotFrequency=String(snapshot.reportedPayFrequency||snapshot.payFrequency||"monthly");
        const periodWeeks=snapshotFrequency==="fortnightly"?2:snapshotFrequency==="four-weekly"?4:1;
        const bands=nicEarningsBands(r.nicablePay,snapshotFrequency==="monthly"?"monthly":"weekly",periodWeeks);
        rows.push([periodName,String(snapshot.payrollId||e.payrollId),periodNumber.get(r.payPeriodId),taxCode+(week1Month1?" M1":""),niCategory,
          r.grossPay,Number(snapshot.payrolledBenefits||0),r.taxablePay,taxableToDate,r.payeTax,taxToDate,r.nicablePay,bands.earningsAtLel,bands.earningsLelToPt,bands.earningsPtToUel,bands.earningsAboveUel,
          r.employeeNic,r.employerNic,r.statutoryPay,r.studentLoan,r.postgraduateLoan,r.netPay]);
      }
    }
    return {title:"P11 deductions working sheet",columns:["Employee","Payroll ID","Period","Tax code","NI letter","Gross cash pay","Payrolled benefits","Taxable pay","Taxable pay to date","PAYE this period","PAYE to date","NIC-able pay","Earnings at LEL","Earnings LEL to PT","Earnings PT to UEL","Earnings above UEL","Employee NIC","Employer NIC","Statutory pay","Student loan","Postgraduate loan","Net pay"],rows,notes:["An “Opening before P…” row is an audited P11 balance imported from the prior payroll system; it advances year-to-date calculations but does not recreate earlier payslips or HMRC liabilities.","Includes brought-forward P45 pay and tax from the first finalised period in which that evidence was available; a late P45 is not backdated into earlier P11 rows. Reviewed payrolled benefits are shown separately from gross cash pay and included in taxable pay. NIC remains a period liability and is reported in statutory earnings bands for each NI category."]};
  }
  if(type==="p45"){
    const p45Identity=(employee:typeof employees.$inferSelect)=>{
      const employmentRuns=allRuns.filter(run=>run.employeeId===employee.id&&rtiSnapshot(run).paymentAfterLeaving!==true).sort((left,right)=>(periodNumber.get(left.payPeriodId)||0)-(periodNumber.get(right.payPeriodId)||0));
      const last=employmentRuns.at(-1),snapshot=last?rtiSnapshot(last):{},frozen=(field:string,fallback:unknown)=>Object.prototype.hasOwnProperty.call(snapshot,field)?snapshot[field]:fallback;
      return {last,snapshot,employmentRuns,name:[String(frozen("firstName",employee.firstName)||""),String(frozen("middleNames",employee.middleNames)||""),String(frozen("lastName",employee.lastName)||"")].filter(Boolean).join(" "),payrollId:String(frozen("payrollId",employee.payrollId)||""),niNumber:String(frozen("niNumber",employee.niNumber)||""),taxCode:String(frozen("taxCode",employee.taxCode)||""),week1Month1:Boolean(snapshot.week1Month1??employee.week1Month1),leavingDate:String(frozen("leavingDate",employee.leavingDate)||"")};
    };
    const eligible=allowedEmployees.map(employee=>({employee,identity:p45Identity(employee)})).filter(({identity})=>identity.last&&identity.leavingDate>=dates.start&&identity.leavingDate<=dates.end);
    const values=(employee:typeof employees.$inferSelect,identity:ReturnType<typeof p45Identity>)=>({t:identity.employmentRuns.reduce((a,r)=>({taxable:round(a.taxable+r.taxablePay),tax:round(a.tax+r.payeTax)}),{taxable:Number(migrationOpeningByEmployee.get(employee.id)?.taxablePay||0),tax:Number(migrationOpeningByEmployee.get(employee.id)?.payeTax||0)}),opening:openingBalance(employee),...identity});
    return {title:"P45 leaving statement",columns:["Employee","Payroll ID","Leaving date","NI number","Tax code","Week 1 / month 1","Pay in this employment","Tax in this employment","Total pay to date","Total tax to date"],rows:eligible.map(({employee,identity})=>{const v=values(employee,identity);return[v.name,v.payrollId,formatUkDate(v.leavingDate),v.niNumber,v.taxCode,v.week1Month1?"Yes":"No",v.t.taxable,v.t.tax,round(v.t.taxable+v.opening.previousPay),round(v.t.tax+v.opening.previousTax)];}),document:eligible.map(({employee,identity})=>{const v=values(employee,identity);return{...common,form:"P45",employee:v.name,payrollId:v.payrollId,niNumber:v.niNumber,leavingDate:formatUkDate(v.leavingDate),taxCode:v.taxCode,week1Month1:v.week1Month1?"Yes":"No",payThisEmployment:v.t.taxable,taxThisEmployment:v.t.tax,totalPay:round(v.t.taxable+v.opening.previousPay),totalTax:round(v.t.tax+v.opening.previousTax)};}),notes:["Only employees whose finalised RTI leaving date falls within this tax year are included. Legal name, NI number, tax code, basis, payroll ID and previous-employment opening balances come from finalised RTI snapshots.","Payments made after the P45 was issued are deliberately excluded. Give written payment confirmation instead; do not issue another P45."]};
  }
  if(type==="p60"){
    if(!periods.some(period=>period.periodNumber===maximumPeriods&&period.status==="finalised"))throw new Error(`P60 certificates can only be generated after final payroll period ${maximumPeriods} is finalised.`);
    const eligible=allowedEmployees.map(employee=>({employee,identity:finalisedIdentity(employee)})).filter(({identity})=>identity.last&&(!identity.startDate||identity.startDate<=dates.end)&&(!identity.leavingDate||identity.leavingDate>=dates.end));
    const values=(employee:typeof employees.$inferSelect,identity:ReturnType<typeof finalisedIdentity>)=>({t:totals(employee.id),opening:openingBalance(employee),...identity});
    return {title:"P60 end-of-year certificate",columns:["Employee","Payroll ID","NI number","Tax code","Pay in this employment","Tax in this employment","Previous employment pay","Previous employment tax","Total pay","Total tax","Employee NIC"],rows:eligible.map(({employee,identity})=>{const v=values(employee,identity);return[v.name,v.payrollId,v.niNumber,v.taxCode,v.t.taxable,v.t.tax,v.opening.previousPay,v.opening.previousTax,round(v.t.taxable+v.opening.previousPay),round(v.t.tax+v.opening.previousTax),v.t.employeeNic];}),employeeIds:eligible.map(({employee})=>employee.id),document:eligible.map(({employee,identity})=>{const v=values(employee,identity);return{...common,form:"P60",employee:v.name,payrollId:v.payrollId,niNumber:v.niNumber,taxCode:v.taxCode,payThisEmployment:v.t.taxable,taxThisEmployment:v.t.tax,previousPay:v.opening.previousPay,previousTax:v.opening.previousTax,totalPay:round(v.t.taxable+v.opening.previousPay),totalTax:round(v.t.tax+v.opening.previousTax),employeeNic:v.t.employeeNic};}),notes:[`Includes employees whose finalised RTI identity shows employment on ${dates.end}. Legal name, NI number, tax code, payroll ID and previous-employment opening balances come from final RTI snapshots. P60s must be given by 31 May.`]};
  }
  if(type==="payslips"){
    const runIds=new Set(runs.map(run=>run.id));
    const payslipItems=(await db.select().from(payItems)).filter(item=>runIds.has(item.payRunId));
    const periodById=new Map(periods.map(item=>[item.id,item]));
    const documents:PayslipRenderDocument[]=runs.map(run=>{
      const employee=allowedEmployees.find(item=>item.id===run.employeeId)!,snapshot=rtiSnapshot(run),currentPeriod=periodById.get(run.payPeriodId),currentNumber=periodNumber.get(run.payPeriodId)||0;
      const identityName=[String(snapshot.firstName||employee.firstName),String(snapshot.middleNames||employee.middleNames||""),String(snapshot.lastName||employee.lastName)].filter(Boolean).join(" ");
      const employeeRuns=allRuns.filter(item=>item.employeeId===run.employeeId&&(periodNumber.get(item.payPeriodId)||0)<=currentNumber);
      const ytd=employeeRuns.reduce((total,item)=>({grossPay:round(total.grossPay+item.grossPay),taxablePay:round(total.taxablePay+item.taxablePay),payeTax:round(total.payeTax+item.payeTax),employeeNic:round(total.employeeNic+item.employeeNic),employeePension:round(total.employeePension+item.employeePension),netPay:round(total.netPay+item.netPay)}),{grossPay:0,taxablePay:0,payeTax:0,employeeNic:0,employeePension:0,netPay:0});
      const runItems=payslipItems.filter(item=>item.payRunId===run.id),earningItems=runItems.filter(item=>item.type==="earning"&&item.amount!==0);
      const payments=earningItems.length?earningItems.map(item=>({label:item.name,amount:item.amount,quantity:item.quantity,rate:item.rate})):[{label:"Gross cash pay",amount:run.grossPay}];
      if(run.statutoryPay>0&&!payments.some(item=>item.label.toLowerCase().includes("statutory")))payments.push({label:"Statutory pay included",amount:run.statutoryPay});
      const payrolledBenefits=Number(snapshot.payrolledBenefits||0);if(payrolledBenefits>0)payments.push({label:"Payrolled benefits (non-cash)",amount:payrolledBenefits});
      const deductions=[
        {label:"PAYE tax",amount:run.payeTax},{label:"Employee National Insurance",amount:run.employeeNic},
        {label:"Pension member deduction",amount:run.employeePension},{label:"Student loan",amount:run.studentLoan},
        {label:"Postgraduate loan",amount:run.postgraduateLoan},{label:"Other deductions",amount:run.otherDeductions},
      ].filter(item=>item.amount!==0);
      return {employeeName:identityName,employeeAddress:[String(snapshot.address||employee.address||""),String(snapshot.postcode||employee.postcode||"")].filter(Boolean).join(", "),payrollId:String(snapshot.payrollId||employee.payrollId||""),niNumber:String(snapshot.niNumber||employee.niNumber||""),taxCode:String(snapshot.taxCode||employee.taxCode||""),niCategory:String(snapshot.niCategory||employee.niCategory||""),department:String(snapshot.departmentName||"Unassigned"),paymentMethod:String(snapshot.paymentMethod||employee.paymentMethod||""),periodLabel:"Period "+currentNumber,payDate:currentPeriod?.payDate||"",taxYear,payments,deductions,grossPay:run.grossPay,taxablePay:run.taxablePay,netPay:run.netPay,ytd,employerContributions:{employerNic:run.employerNic,employerPension:run.employerPension},paymentAfterLeaving:snapshot.paymentAfterLeaving===true};
    });
    return {title:"Finalised payslips",columns:["Employee","Payroll ID","Period","Gross cash pay","Payrolled benefits","Taxable pay","Statutory pay","PAYE","Employee NIC","Pension","Student loans","Net pay","Payment after leaving"],rows:runs.map(run=>{const employee=allowedEmployees.find(item=>item.id===run.employeeId)!,snapshot=rtiSnapshot(run),periodName=[String(snapshot.firstName||employee.firstName),String(snapshot.middleNames||employee.middleNames||""),String(snapshot.lastName||employee.lastName)].filter(Boolean).join(" ");return[periodName,String(snapshot.payrollId||employee.payrollId),periodNumber.get(run.payPeriodId),run.grossPay,Number(snapshot.payrolledBenefits||0),run.taxablePay,run.statutoryPay,run.payeTax,run.employeeNic,run.employeePension,run.studentLoan+run.postgraduateLoan,run.netPay,snapshot.paymentAfterLeaving===true?"Yes — written confirmation; do not issue another P45":"No"];}),document:documents as unknown as Record<string,unknown>[],notes:["Employee identity, payment details and department come from each period's immutable finalised payroll evidence.","Payment lines, deductions, year-to-date totals and employer contributions reconcile to the finalised pay run. A payment-after-leaving payslip does not replace or amend the original P45."]};
  }
  if(["payments","cash-payments","cash-request","cash-receipt","cheque-payments"].includes(type)){
    const paymentRows=runs.filter(run=>run.netPay>0).map(run=>{
      const employee=allowedEmployees.find(item=>item.id===run.employeeId)!,snapshot=rtiSnapshot(run);
      return {
        run,employee,snapshot,
        method:String(snapshot.paymentMethod||employee.paymentMethod||"credit-transfer"),
        employeeName:[String(snapshot.firstName||employee.firstName),String(snapshot.middleNames||employee.middleNames||""),String(snapshot.lastName||employee.lastName)].filter(Boolean).join(" "),
        payrollId:String(snapshot.payrollId||employee.payrollId),period:periodNumber.get(run.payPeriodId),
      };
    });
    if(type==="payments")return {title:"Finalised employee payment summary",columns:["Employee","Payroll ID","Period","Payment method","Net pay"],rows:paymentRows.map(item=>[item.employeeName,item.payrollId,item.period,item.method.replaceAll("-"," "),item.run.netPay]),notes:["Uses finalised net pay only. Payment methods come from immutable period evidence where available.","Credit-transfer totals reconcile to the bank-payment workflow; cash and cheque employees are excluded from the bank file."]};
    if(type==="cheque-payments")return {title:"Cheque payment schedule",columns:["Employee","Payroll ID","Period","Cheque amount","Cheque number","Issued"],rows:paymentRows.filter(item=>item.method==="cheque").map(item=>[item.employeeName,item.payrollId,item.period,item.run.netPay,"",""]),notes:["Enter cheque numbers and issue status after printing. Amounts come from finalised net pay and cannot be edited in this report."]};
    const cashRows=paymentRows.filter(item=>item.method==="cash").map(item=>({item,makeup:cashMakeup(item.run.netPay)}));
    if(type==="cash-request"){
      const counts=cashDenominations.map((_,index)=>cashRows.reduce((sum,row)=>sum+row.makeup.counts[index],0));
      const rows:unknown[][]=cashDenominations.map((denomination,index)=>[
        denomination.label,round(denomination.pence/100),counts[index],round(counts[index]*denomination.pence/100),
      ]);
      rows.push(["TOTAL CASH REQUESTED","",counts.reduce((sum,count)=>sum+count,0),round(cashRows.reduce((sum,row)=>sum+row.item.run.netPay,0))]);
      return {title:"Bank cash request",columns:["Denomination","Unit value","Quantity required","Total value"],rows,notes:["Aggregates the minimum-note-and-coin makeup for employees whose immutable finalised payment method is cash.","The total request reconciles to finalised cash net pay. Count and secure all notes and coins independently when received from the bank."]};
    }
    if(type==="cash-receipt")return {
      title:"Cash wage receipt sheet",
      columns:["Employee","Payroll ID","National Insurance number","Period","Pay date","Employee signature","Date received"],
      rows:cashRows.map(({item})=>{
        const runPeriod=periods.find(value=>value.id===item.run.payPeriodId);
        return [item.employeeName,item.payrollId,String(item.snapshot.niNumber||item.employee.niNumber||"Not supplied"),item.period,runPeriod?.payDate||"","",""];
      }),
      notes:["Wage amounts are intentionally omitted for confidentiality. Each employee should check the cash against their payslip before signing.","Employee identity and payment method come from immutable finalised payroll evidence."],
    };
    return {title:"Cash makeup schedule",columns:["Employee","Payroll ID","Period","Net pay",...cashDenominations.map(item=>item.label)],rows:cashRows.map(({item,makeup})=>[item.employeeName,item.payrollId,item.period,item.run.netPay,...makeup.counts]),notes:["Denominations use the minimum-note-and-coin greedy breakdown for each employee's finalised penny amount.","Count and secure the physical cash independently before marking payroll payments as complete."]};
  }
  if(type==="employee-loans"){
    const ledgers=(await db.select().from(employeeLoans)).filter(loan=>loan.employerId===employerId&&allowedIds.has(loan.employeeId));
    const runIds=new Set(runs.map(run=>run.id));
    const ledgerIds=new Set(ledgers.map(loan=>loan.id));
    const deductions=(await db.select().from(employeeLoanDeductions)).filter(item=>runIds.has(item.payRunId)&&ledgerIds.has(item.employeeLoanId));
    return {title:"Employee loan, advance and overpayment ledger",columns:["Employee","Type","Reference","Original amount","Regular deduction","Period deduction","Balance after","Status"],rows:deductions.map(deduction=>{const loan=ledgers.find(item=>item.id===deduction.employeeLoanId)!;return[name.get(loan.employeeId),loan.type,loan.reference,loan.originalAmount,loan.regularDeduction,deduction.amount,deduction.balanceAfter,loan.status];}),notes:["Deductions are capped by the outstanding balance and available finalised net pay.","Reopening the latest unsubmitted payroll restores the exact pre-deduction balance and removes its ledger history."]};
  }
  if(type==="cash-rounding"){
    const settings=(await db.select().from(employeePayRounding)).filter(item=>item.employerId===employerId&&allowedIds.has(item.employeeId));
    const settingIds=new Set(settings.map(item=>item.id)),runIds=new Set(runs.map(run=>run.id));
    const entries=(await db.select().from(payRoundingEntries)).filter(item=>settingIds.has(item.employeePayRoundingId)&&runIds.has(item.payRunId));
    return {title:"Cash pay rounding and carried balances",columns:["Employee","Period","Rounding unit","Unrounded net","Opening carry","Cash paid","Closing carry","Payment adjustment"],rows:entries.map(entry=>{
      const setting=settings.find(item=>item.id===entry.employeePayRoundingId)!,run=runs.find(item=>item.id===entry.payRunId)!;
      return[name.get(setting.employeeId),periodNumber.get(run.payPeriodId),setting.unit,entry.unroundedNet,entry.openingCarry,entry.roundedNet,entry.closingCarry,entry.adjustment];
    }),notes:["Cash is rounded down to the configured £1, £5 or £10 unit. The unpaid remainder is carried to the employee’s next eligible cash payroll.","Cash rounding does not change gross pay and statutory PAYE, NIC, pension, court-order or loan calculations. Reopening restores the exact opening carry."]};
  }
  if(type==="holiday-fund"){
    const settings=(await db.select().from(holidayFundSettings)).filter(item=>item.employerId===employerId&&allowedIds.has(item.employeeId));
    const settingIds=new Set(settings.map(item=>item.id)),runIds=new Set(runs.map(run=>run.id));
    const entries=(await db.select().from(holidayFundEntries)).filter(item=>
      item.taxYear===taxYear&&item.status==="finalised"&&settingIds.has(item.holidayFundSettingId)&&item.payRunId!==null&&runIds.has(item.payRunId)
    );
    return {
      title:"Holiday-pay fund and rolled-up pay ledger",
      columns:["Employee","Payroll ID","Period","Scheme","Worker type","Rate","Accrual base","Added / contributed","Paid / withdrawn","Opening balance","Closing balance","PAYE taxable","NIC-able","Post-tax deduction","Contract confirmed","Status"],
      rows:entries.sort((left,right)=>left.periodNumber-right.periodNumber||left.employeeId-right.employeeId).map(entry=>{
        const employee=allowedEmployees.find(item=>item.id===entry.employeeId);
        return [name.get(entry.employeeId),employee?.payrollId||"",entry.periodNumber,entry.schemeType.replaceAll("-"," "),entry.workerType.replaceAll("-"," "),entry.accrualRate,
          entry.accrualBase,entry.addedAmount,entry.paidAmount,entry.balanceBefore,entry.balanceAfter,entry.taxablePay,entry.nicablePay,entry.postTaxDeduction,entry.contractConfirmed?"Yes":"No",entry.status];
      }),
      notes:[
        "Employer-funded holiday-fund payments and rolled-up holiday pay are subject to PAYE and Class 1 NIC. Employee savings are deducted from net pay, so a later withdrawal is not taxed or NICed again.",
        "Rolled-up holiday pay is available only for eligible irregular-hours or part-year workers and must be separately identified on each payslip. The employer remains responsible for ensuring statutory leave is taken.",
        "Each row is drawn from immutable finalised payroll evidence. From 6 April 2026, retain holiday entitlement and pay records for at least 6 years.",
      ],
    };
  }
  if(type==="journal"){
    const rows:unknown[][]=[];
    for(const period of reportPeriods.filter(item=>item.status==="finalised")){
      const periodRuns=runs.filter(run=>run.payPeriodId===period.id);
      const sum=(field:keyof typeof payRuns.$inferSelect)=>round(periodRuns.reduce((total,run)=>total+Number(run[field]||0),0));
      const gross=sum("grossPay"),employerNic=sum("employerNic"),employerPension=sum("employerPension");
      const debit=round(gross+employerNic+employerPension);
      const entries:Array<[string,number]>=[
        ["Net wages payable",sum("netPay")],["PAYE payable",sum("payeTax")],
        ["National Insurance payable",round(sum("employeeNic")+employerNic)],
        ["Student and postgraduate loans payable",round(sum("studentLoan")+sum("postgraduateLoan"))],
        ["Pension payable",round(sum("employeePension")+employerPension)],
      ];
      const knownCredits=round(entries.reduce((total,item)=>total+item[1],0));
      const adjustment=round(debit-knownCredits);
      rows.push([period.periodNumber,"Gross wages expense",gross,0],[period.periodNumber,"Employer National Insurance expense",employerNic,0],[period.periodNumber,"Employer pension expense",employerPension,0]);
      for(const [account,credit] of entries)if(credit!==0)rows.push([period.periodNumber,account,0,credit]);
      if(adjustment>=.01)rows.push([period.periodNumber,"Other deductions and payroll adjustments",0,adjustment]);
      if(adjustment<=-.01)rows.push([period.periodNumber,"Other deductions and payroll adjustments",-adjustment,0]);
    }
    return {title:"Payroll accounting journal",columns:["Period","Account","Debit","Credit"],rows,notes:["Each finalised period balances gross wages and employer on-costs to payroll liabilities, take-home pay and recorded adjustments.","Map the account labels to the employer's nominal ledger before posting."]};
  }
  if(type==="accounting-file"){
    const departmentRows=await db.select().from(departments).where(eq(departments.employerId,employerId));
    const currentDepartment=new Map(departmentRows.map(department=>[department.id,department]));
    const code=(value:string|null|undefined,fallback:string)=>String(value||fallback).trim().toUpperCase();
    const rows:unknown[][]=[];
    for(const period of reportPeriods.filter(item=>item.status==="finalised")){
      const periodRuns=runs.filter(run=>run.payPeriodId===period.id);
      const wages=new Map<string,{costCentre:string;nominalCode:string;department:string;amount:number}>();
      let usedLegacyAllocation=false;
      for(const run of periodRuns){
        const employee=allowedEmployees.find(item=>item.id===run.employeeId),snapshot=rtiSnapshot(run);
        const frozenDepartment=String(snapshot.departmentName||"").trim();
        const fallbackDepartment=employee?.departmentId?currentDepartment.get(employee.departmentId):undefined;
        if(!frozenDepartment)usedLegacyAllocation=true;
        const department=frozenDepartment||fallbackDepartment?.name||"Unassigned";
        const costCentre=code(String(snapshot.departmentCostCentre||fallbackDepartment?.costCentre||""),"000");
        const nominalCode=code(String(snapshot.departmentNominalCode||fallbackDepartment?.nominalCode||""),settings?.accountingDefaultWagesCode||"WAGES");
        const key=`${costCentre}\u0000${nominalCode}\u0000${department}`;
        const existing=wages.get(key)||{costCentre,nominalCode,department,amount:0};
        existing.amount=round(existing.amount+run.grossPay);wages.set(key,existing);
      }
      for(const entry of wages.values())if(entry.amount)rows.push([period.periodNumber,entry.costCentre,entry.nominalCode,`Gross wages - ${entry.department}`,entry.amount]);
      const sum=(field:keyof typeof payRuns.$inferSelect)=>round(periodRuns.reduce((total,run)=>total+Number(run[field]||0),0));
      const employerNic=sum("employerNic"),employerPension=sum("employerPension");
      if(employerNic)rows.push([period.periodNumber,"000",code(settings?.accountingEmployerNicExpenseCode,"ERNIC"),"Employer National Insurance expense",employerNic]);
      if(employerPension)rows.push([period.periodNumber,"000",code(settings?.accountingEmployerPensionExpenseCode,"ERPENS"),"Employer pension expense",employerPension]);
      const debit=round(sum("grossPay")+employerNic+employerPension);
      const credits:Array<[string,string,number]>=[
        [code(settings?.accountingControlCode,"CTRL"),"Net wages control",sum("netPay")],
        [code(settings?.accountingPayeCode,"TAX"),"PAYE liability",sum("payeTax")],
        [code(settings?.accountingNicCode,"NIC"),"National Insurance liability",round(sum("employeeNic")+employerNic)],
        [code(settings?.accountingPensionCode,"PENS"),"Pension liability",round(sum("employeePension")+employerPension)],
        [code(settings?.accountingOtherDeductionsCode,"OTHER"),"Student and postgraduate loan liability",round(sum("studentLoan")+sum("postgraduateLoan"))],
      ];
      const knownCredits=round(credits.reduce((total,item)=>total+item[2],0));
      const other=round(debit-knownCredits);
      if(Math.abs(other)>=.01)credits.push([code(settings?.accountingOtherDeductionsCode,"OTHER"),"Other deductions and payroll adjustments",other]);
      for(const [nominalCode,description,amount] of credits)if(amount)rows.push([period.periodNumber,"000",nominalCode,description,-amount]);
      const periodBalance=round(rows.filter(row=>row[0]===period.periodNumber).reduce((total,row)=>total+Number(row[4]||0),0));
      if(periodBalance!==0)throw new Error(`Accounting export for payroll period ${period.periodNumber} does not balance.`);
      if(usedLegacyAllocation)rows.push([period.periodNumber,"INFO","LEGACY","Department allocation used current employee settings because this older payroll predates frozen accounting evidence.",0]);
    }
    return {title:"Nominal-ledger accounting import",columns:["Period","Cost centre","Nominal code","Description","Signed amount"],rows,notes:["Positive amounts are payroll expenses; negative amounts are payroll liabilities and control-account credits. Every selected finalised period balances to zero.","Department, cost-centre and wages-code allocation comes from immutable finalised payroll evidence for payrolls processed after accounting export support was enabled."]};
  }
  if(type==="p32"||type==="p30"){
    const events=(await db.select().from(leaveEvents)).filter(e=>allowedIds.has(e.employeeId)&&e.status==="calculated");
    const recoveryAdjustments=await db.select().from(payrollAdjustments).where(and(
      eq(payrollAdjustments.employerId,employerId),eq(payrollAdjustments.type,"statutory-recovery"),eq(payrollAdjustments.status,"active"),
    ));
    const paymentLedger=type==="p32"
      ? await db.select().from(hmrcPayments).where(and(eq(hmrcPayments.employerId,employerId),eq(hmrcPayments.taxYear,taxYear)))
      : [];
    const periodTaxMonth=(period:typeof payPeriods.$inferSelect)=>{
      if(period.payDate)return taxMonthForDate(taxYear,period.payDate);
      return paySchedule.find(item=>item.periodNumber===period.periodNumber)?.taxMonth||0;
    };
    const scheduledByMonth=Array.from({length:12},(_,index)=>paySchedule.filter(item=>item.taxMonth===index+1));
    const liabilityPeriods=periods.filter(period=>period.status==="finalised");
    const payBills=Array.from({length:12},(_,index)=>liabilityPeriods
      .filter(period=>periodTaxMonth(period)===index+1)
      .flatMap(period=>allRuns.filter(run=>run.payPeriodId===period.id))
      .reduce((sum,run)=>sum+run.nicablePay,0));
    const levySchedule=apprenticeshipLevyByMonth(payBills,employer.apprenticeshipLevy,employer.apprenticeshipLevyAllowance);
    let allowanceUsed=0;
    const allLiabilityRows=Array.from({length:12},(_,index)=>{
      const taxMonth=index+1,monthPeriods=liabilityPeriods.filter(period=>periodTaxMonth(period)===taxMonth);
      const monthPeriodIds=new Set(monthPeriods.map(period=>period.id));
      const pr=allRuns.filter(run=>monthPeriodIds.has(run.payPeriodId));
      const paye=round(pr.reduce((n,r)=>n+r.payeTax,0)),en=round(pr.reduce((n,r)=>n+r.employeeNic,0)),ern=round(pr.reduce((n,r)=>n+r.employerNic,0)),loans=round(pr.reduce((n,r)=>n+r.studentLoan+r.postgraduateLoan,0));
      const recovery=round(
        events.reduce((n,e)=>n+statutoryPayAllocation(e,taxMonth,taxYear).recovery,0)+
        recoveryAdjustments.filter(item=>monthPeriodIds.has(item.payPeriodId)).reduce((n,item)=>n+item.amount,0)
      );
      const allowance=employer.employmentAllowance?round(Math.min(ern,10500-allowanceUsed)):0;allowanceUsed=round(allowanceUsed+allowance);
      const levy=levySchedule[index].currentDue;
      const amountPayable=round(paye+en+ern+loans+levy-recovery-allowance);
      const monthEnd=new Date(taxMonthRange(taxYear,taxMonth).end).toISOString().slice(0,10);
      const complete=scheduledByMonth[index].length
        ?scheduledByMonth[index].every(scheduled=>periods.some(period=>period.periodNumber===scheduled.periodNumber&&period.status==="finalised"))
        :new Date().toISOString().slice(0,10)>monthEnd;
      const payDates=monthPeriods.map(period=>period.payDate).filter(Boolean).join(", ");
      if(type==="p30")return[taxMonth,payDates,paye,en,ern,loans,recovery,allowance,levy,amountPayable,complete?"Finalised":"Open"];
      const recorded=paymentLedger.filter(row=>row.taxMonth===taxMonth&&row.status==="recorded");
      const payments=round(recorded.filter(row=>row.kind==="payment").reduce((sum,row)=>sum+row.amount,0));
      const credits=round(recorded.filter(row=>row.kind==="credit").reduce((sum,row)=>sum+row.amount,0));
      const charges=round(recorded.filter(row=>row.kind==="charge").reduce((sum,row)=>sum+row.amount,0));
      return[taxMonth,payDates,paye,en,ern,loans,recovery,allowance,levy,amountPayable,payments,credits,charges,round(amountPayable-payments-credits+charges),complete?"Finalised":"Open"];
    });
    const rows=requestedPeriod?allLiabilityRows.filter(row=>row[0]===requestedPeriod):allLiabilityRows;
    const liabilityColumns=["Tax month","Payroll pay dates","PAYE","Employee NIC","Employer NIC","Student and postgraduate loans","Statutory payment recovery","Employment Allowance used","Apprenticeship Levy","Amount payable"];
    return {title:type==="p30"?"P30 HMRC payment schedule":"P32 employer payment record",columns:type==="p32"?[...liabilityColumns,"Payments","Credits","Additional charges","Outstanding / (overpaid)","Payroll status"]:[...liabilityColumns,"Payroll status"],rows,notes:["All finalised payrolls are grouped into the HMRC tax month containing their pay date.","Employment Allowance is applied against employer Class 1 NIC in tax-month order, capped at £10,500 for 2026/27.","Apprenticeship Levy is calculated cumulatively at 0.5% of the Class 1 secondary-NIC pay bill, less the employer's annual allowance allocation.",type==="p32"?"Only active payment-ledger records affect the outstanding balance; voided records remain in the audit history.":"Statutory recovery is allocated by HMRC tax month. Record actual payments and HMRC adjustments separately."]};
  }
  if(type==="statutory-pay"){
    const events=(await db.select().from(leaveEvents)).filter(r=>allowedIds.has(r.employeeId)&&r.startDate<=dates.end&&r.endDate>=dates.start);
    const rows:unknown[][]=[];
    for(const event of events){
      const provenance=[event.averageWeeklyEarningsSource,event.relevantPeriodStart||"",event.relevantPeriodEnd||"",round(event.relevantPayTotal)];
      if(event.status!=="calculated"){rows.push([name.get(event.employeeId),event.type,event.subtype||"",formatUkDate(event.startDate),formatUkDate(event.endDate),"—",round(event.averageWeeklyEarnings),...provenance,0,0,event.status]);continue;}
      for(const scheduled of paySchedule){const allocation=statutoryPayAllocationForRange(event,scheduled.periodStart,scheduled.periodEnd);if(allocation.pay||allocation.recovery)rows.push([name.get(event.employeeId),event.type,event.subtype||"",formatUkDate(event.startDate),formatUkDate(event.endDate),scheduled.periodNumber,round(event.averageWeeklyEarnings),...provenance,round(allocation.pay),round(allocation.recovery),event.status]);}
    }
    return {title:"Statutory pay calculation and schedule",columns:["Employee","Type","Subtype","Start","End","Payroll period","Average weekly earnings","AWE source","Relevant period start","Relevant period end","Relevant pay total","Statutory pay","Recovery","Status"],rows,notes:["Calculated statutory pay is allocated to the employer's actual payroll-period date ranges; HMRC recovery is aggregated separately by PAYE tax month. Draft and cancelled events remain visible but contribute zero to payroll and HMRC recovery.","Payroll-derived AWE uses finalised Class 1 NIC-able earnings. Review the statutory qualifying/relevant date and any new-starter, mistimed-payment, director or irregular-pay exception before approval."]};
  }
  if(type==="calendar"||type==="leave-summary"){
    const events=(await db.select().from(leaveEvents)).filter(r=>allowedIds.has(r.employeeId)&&r.startDate<=dates.end&&r.endDate>=dates.start);
    if(type==="calendar")return {title:"Employee calendar report",columns:["Employee","Type","Subtype","Start","End","Days","Notes","Status"],rows:events.map(r=>[name.get(r.employeeId),r.type,r.subtype||"",formatUkDate(r.startDate),formatUkDate(r.endDate),r.qualifyingDays,r.notes||"",r.status])};
    return {title:"Annual leave entitlement summary",columns:["Employee","Contractual annual days","Prorated entitlement","Recorded leave days","Remaining days"],rows:allowedEmployees.map(e=>{const balance=leaveEntitlementBalance(e.annualLeaveDays,e.startDate,e.leavingDate,events.filter(v=>v.employeeId===e.id),taxYear);return[name.get(e.id),balance.contractual,balance.entitlement,balance.used,balance.remaining];}),notes:["Entitlement is prorated by recorded employment dates within the selected leave year. Only approved/calculated annual leave is deducted. Draft and cancelled events remain in history but do not use entitlement. Events crossing a tax-year boundary are allocated proportionally to the selected year."]};
  }
  if(type==="statutory-notices"||statutoryNoticeReportForms[type]){
    const requestedForm=statutoryNoticeReportForms[type];
    const notices=(await db.select().from(statutoryNotices)).filter(n=>allowedIds.has(n.employeeId)&&n.payStartDate<=dates.end&&(n.payEndDate||n.payStartDate)>=dates.start&&(!requestedForm||n.formType===requestedForm));
    return {title:requestedForm?`${requestedForm} statutory notice register`:"Statutory pay non-payment notices",columns:["Employee","Form","Statutory pay","Decision date","Pay start","Pay end","Reason","AWE","Service weeks","Status","Cancellation reason","Evidence checksum"],rows:notices.map(n=>{let frozen:any=null;try{frozen=n.employeeSnapshot?JSON.parse(n.employeeSnapshot):null;}catch{}return[`${frozen?.employee?.firstName||""} ${frozen?.employee?.lastName||""}`.trim()||name.get(n.employeeId),n.formType,n.statutoryType,n.decisionDate,n.payStartDate,n.payEndDate||"",n.reason,n.averageWeeklyEarnings,n.continuousEmploymentWeeks,n.status,n.cancellationReason||"",n.payloadChecksum||"legacy"];}),notes:["Use the current official HMRC or DWP form where one is prescribed. Issued records retain their original employee and employer evidence; the SHA-256 checksum identifies the exact frozen evidence package."]};
  }
  if(type==="attachments"){
    const attachmentCutoff=requestedPeriod?(reportPeriods[0]?.periodEnd||reportPeriods[0]?.payDate||dates.end):dates.end;
    const orders=(await db.select().from(attachmentOrders)).filter(r=>allowedIds.has(r.employeeId)&&(!r.effectiveDate||r.effectiveDate<=attachmentCutoff));
    const attachmentRuns=allRuns.filter(run=>!requestedPeriod||(periodNumber.get(run.payPeriodId)||0)<=requestedPeriod);
    const runIds=new Set(attachmentRuns.map(run=>run.id)),deductions=(await db.select().from(attachmentOrderDeductions)).filter(item=>runIds.has(item.payRunId));
    return {title:"Attachment order summary",columns:["Employee","Order","Rule","Priority","Authority","Reference","Effective date","Latest attachable net","Latest protected earnings","Ordinary debt deducted","Maintenance deducted","Total deducted","Fees to date","Shortfall","Carried arrears","Current balance","Ordinary balance","Status"],rows:orders.map(r=>{const history=deductions.filter(d=>d.attachmentOrderId===r.id),latest=history.at(-1);return[name.get(r.employeeId),r.type,r.calculationRule,r.priority,r.issuingAuthority,r.reference,formatUkDate(r.effectiveDate),latest?.attachableNetPay||0,latest?.protectedEarningsApplied||r.protectedEarnings,round(history.reduce((n,d)=>n+d.ordinaryDeduction,0)),round(history.reduce((n,d)=>n+d.maintenanceDeduction,0)),round(history.reduce((n,d)=>n+d.deduction,0)),round(history.reduce((n,d)=>n+d.adminFee,0)),round(history.reduce((n,d)=>n+d.shortfall,0)),r.arrears,r.balance,r.ordinaryDebtBalance,r.status];}),notes:["Orders are applied in legal-priority order. DEA and child-maintenance calculations preserve 60% of attachable net earnings; family statutory payments are excluded.","Mixed Scottish conjoined orders show the statutory proportional allocation between ordinary debt and current maintenance.","Administration fees are reported separately because they may affect National Minimum Wage compliance."]};
  }
  if(type==="attachment-payments"||type==="child-support-payments"){
    const runById=new Map(runs.map(run=>[run.id,run]));
    const orderRows=(await db.select().from(attachmentOrders)).filter(order=>allowedIds.has(order.employeeId));
    const orderById=new Map(orderRows.map(order=>[order.id,order]));
    const deductions=(await db.select().from(attachmentOrderDeductions)).filter(item=>runById.has(item.payRunId));
    const selected=deductions.filter(item=>{
      const order=orderById.get(item.attachmentOrderId);
      return Boolean(order)&&(type!=="child-support-payments"||order?.calculationRule==="child-maintenance");
    });
    return {
      title:type==="child-support-payments"?"Child maintenance payment export":"Attachment order payment schedule",
      columns:["Authority","Order reference","Employee","Payroll ID","Tax month","Pay date","Order type","Amount payable","Administration fee retained","Order ID"],
      rows:selected.map(item=>{
        const order=orderById.get(item.attachmentOrderId)!,run=runById.get(item.payRunId)!;
        const employee=allowedEmployees.find(value=>value.id===run.employeeId),identity=employee?finalisedIdentity(employee):null;
        const runPeriod=periods.find(value=>value.id===run.payPeriodId);
        return [order.issuingAuthority||"Issuing authority not recorded",order.reference||"",identity?.name||name.get(run.employeeId),identity?.payrollId||employee?.payrollId||"",runPeriod?.periodNumber||"",runPeriod?.payDate||"",order.type,item.deduction,item.adminFee,order.id];
      }),
      notes:["Amount payable is the statutory deduction due to the issuing authority. The separately displayed administration fee is retained by the employer and is not included in the remittance amount.",type==="child-support-payments"?"This export contains Child Maintenance Service deduction-from-earnings orders only.":"Use the authority and order reference to allocate each remittance; retain the report with the finalised payroll evidence."],
    };
  }
  if(type==="employee-details"||type==="employee-list"){
    const detailed=type==="employee-details";
    return detailed?{
      title:"Employee detail register",
      columns:["Payroll ID","Works number","Employee","Status","Job title","Start date","Leaving date","Email","Phone","Home address","Postcode","Date of birth","Gender","NI number","Tax code","Week 1 / month 1","NI category","Pay basis","Annual salary","Hourly rate","Daily rate","Contracted hours","Payment method","Employee portal","Confidential"],
      rows:allowedEmployees.map(employee=>[employee.payrollId,employee.worksNumber||"",`${employee.firstName} ${employee.middleNames||""} ${employee.lastName}`.replace(/\s+/g," ").trim(),employee.status,employee.jobTitle||"",formatUkDate(employee.startDate),formatUkDate(employee.leavingDate),employee.email||"",employee.phone||"",employee.address||"",employee.postcode||"",formatUkDate(employee.dateOfBirth),employee.gender||"",employee.niNumber||"",employee.taxCode,employee.week1Month1?"Yes":"No",employee.niCategory,employee.payBasis,employee.annualSalary,employee.hourlyRate,employee.dailyRate,employee.contractedHours,employee.paymentMethod,employee.employeePortal?"Enabled":"Disabled",employee.confidential?"Yes":"No"]),
      notes:["This payroll register excludes confidential employees unless the signed-in administrator has confidential-record permission.","HR medical notes, emergency contacts and bank account details are deliberately excluded from this general-purpose export."],
    }:{
      title:"Employee list",
      columns:["Payroll ID","Works number","Employee","Job title","Start date","Leaving date","Status"],
      rows:allowedEmployees.map(employee=>[employee.payrollId,employee.worksNumber||"",`${employee.firstName} ${employee.lastName}`.trim(),employee.jobTitle||"",formatUkDate(employee.startDate),formatUkDate(employee.leavingDate),employee.status]),
    };
  }
  if(type==="joiners-leavers"){
    const rows:unknown[][]=[];
    for(const employee of allowedEmployees){
      const employeeName=`${employee.firstName} ${employee.lastName}`.trim();
      if(employee.startDate&&employee.startDate>=dates.start&&employee.startDate<=dates.end)rows.push(["Starter",formatUkDate(employee.startDate),employeeName,employee.payrollId,employee.jobTitle||"",employee.starterEvidence||"",employee.starterDeclaration||""]);
      if(employee.leavingDate&&employee.leavingDate>=dates.start&&employee.leavingDate<=dates.end)rows.push(["Leaver",formatUkDate(employee.leavingDate),employeeName,employee.payrollId,employee.jobTitle||"","",""]);
    }
    return {title:"Joiners and leavers",columns:["Movement","Effective date","Employee","Payroll ID","Job title","Starter evidence","Starter declaration"],rows:rows.sort((left,right)=>String(left[1]).localeCompare(String(right[1]))),notes:[`Includes recorded employment starts and leaving dates from ${dates.start} to ${dates.end}.`]};
  }
  if(type==="starter-statement"){
    return {
      title:"Employee joining statement",
      columns:["Employee","Payroll ID","Start date","Starter evidence","Starter declaration","P45 leaving date","Previous pay","Previous tax","P45 received after payroll","P60 tax year","P60 reference only","Tax code","Week 1 / month 1","NI number","Payment method"],
      rows:allowedEmployees.map(employee=>[`${employee.firstName} ${employee.middleNames||""} ${employee.lastName}`.replace(/\s+/g," ").trim(),employee.payrollId,formatUkDate(employee.startDate),employee.starterEvidence||"",employee.starterDeclaration||"",formatUkDate(employee.p45LeavingDate),employee.p45PreviousPay,employee.p45PreviousTax,employee.p45ReceivedAfterPayroll?"Yes":"No",employee.p60TaxYear||"",employee.p60ReferenceOnly?"Yes":"No",employee.taxCode,employee.week1Month1?"Yes":"No",employee.niNumber||"Not supplied",employee.paymentMethod]),
      notes:["Review the employee's signed starter declaration and any P45 before using this working statement. A P60 is reference evidence only and does not replace a current P45.","Changes after a payroll is finalised take effect through the controlled late-P45 and payroll-reopening workflows; historical finalised evidence is not rewritten."],
    };
  }
  if(type==="blank-joiner-form"){
    return {
      title:"Blank new-employee payroll form",
      columns:["Section","Information required","Employee response"],
      rows:[
        ["Personal","Title, full legal name, date of birth and gender",""],["Contact","Home address, postcode, email and telephone",""],["Identity","National Insurance number, nationality and passport details where required",""],["Employment","Start date, job title, department, contracted hours and work pattern",""],["Starter","P45 supplied, previous leaving date, previous pay and tax, or starter declaration A, B or C",""],["Tax","Tax code and week 1 / month 1 basis",""],["Loans","Student loan plan and postgraduate-loan status",""],["Payment","Payment method, account name, sort code and account number",""],["RTI","Payroll ID, reported pay frequency, irregular-payment and payment-to-body declarations",""],["Pension","Existing membership, postponement, opt-in or opt-out evidence",""],["Portal and HR","Portal access, manager, emergency contact and confidentiality",""],["Declaration","Employee signature and date; payroll reviewer signature and date",""],
      ],
      notes:[`${employer.name} · ${taxYear}. Retain the completed form and supporting documents securely with the employee record.`,"Do not email an unencrypted completed form. Bank, identity and health information require appropriate access controls."],
    };
  }
  if(type==="employee-count")return {title:"Employee count",columns:["Measure","Count"],rows:[["Employees in scope",allowedEmployees.length],["Active at tax-year end",allowedEmployees.filter(e=>(!e.startDate||e.startDate<=dates.end)&&(!e.leavingDate||e.leavingDate>=dates.end)).length],["Starters in tax year",allowedEmployees.filter(e=>e.startDate&&e.startDate>=dates.start&&e.startDate<=dates.end).length],["Leavers in tax year",allowedEmployees.filter(e=>e.leavingDate&&e.leavingDate>=dates.start&&e.leavingDate<=dates.end).length],["Paid in finalised payroll",new Set(runs.map(r=>r.employeeId)).size]],notes:[`Active at tax-year end means employed on ${formatUkDate(dates.end)}; record status alone does not override recorded starter or leaver dates.`]};
  if(type==="pensions")return {title:"Pension contribution summary",columns:["Employee","Period","Contribution basis","Tax relief method","Member deducted","Provider tax relief","Gross member contribution","Employer contribution","Total pension funding"],rows:runs.map(r=>{const evidence=pensionEvidence(r);return[name.get(r.employeeId),periodNumber.get(r.payPeriodId),r.pensionablePay,evidence.method,evidence.deduction,evidence.taxRelief,evidence.gross,r.employerPension,round(evidence.gross+r.employerPension)];}),notes:["Relief-at-source member deductions are paid after PAYE. The provider claims the displayed basic-rate relief separately; net-pay contributions reduce taxable pay through payroll.","Legacy finalised records created before split contribution evidence remain labelled legacy and are not silently reinterpreted."]};
  if(type==="payroll-giving"){
    const runById=new Map(runs.map(run=>[run.id,run]));
    const donations=(await db.select().from(payItems)).filter(item=>item.type==="payroll-giving"&&runById.has(item.payRunId));
    return {
      title:"Payroll Giving summary",
      columns:["Employee","Payroll ID","Period","Donation description","Donation"],
      rows:donations.map(item=>{const run=runById.get(item.payRunId)!;const employee=allowedEmployees.find(value=>value.id===run.employeeId);return[name.get(run.employeeId),employee?.payrollId||"",periodNumber.get(run.payPeriodId),item.name,item.amount];}),
      notes:["Includes Payroll Giving deductions from finalised pay runs only. Donations reduce PAYE taxable pay but do not reduce National Insurance earnings.","Use the period total to reconcile the payment sent to the employer's approved Payroll Giving agency."],
    };
  }
  if(type==="p11d"||type==="p11db"||type==="p46car"||type==="pbik"){
    const benefits=(await db.select().from(expensesBenefits)).filter(r=>r.taxYear===taxYear&&r.status==="reviewed"&&allowedIds.has(r.employeeId));
    const reportableBenefits=benefits.filter(r=>r.nicTreatment!=="exempt");
    if(type==="p11db")return {title:"P11D(b) employer declaration working data",columns:["Tax year","Reportable benefits","Cash equivalent","Class 1A NIC"],rows:[[taxYear,reportableBenefits.length,round(reportableBenefits.reduce((n,r)=>n+r.cashEquivalent,0)),round(reportableBenefits.reduce((n,r)=>n+r.class1aNic,0))]],notes:["Class 1 items remain in the P11D working population but do not increase Class 1A NIC. Exempt records are retained in the benefits register and excluded here.","Working data only. P11D and P11D(b) returns must be filed online with HMRC."]};
    if(type==="p46car"){
      const cars=reportableBenefits.filter(r=>r.category.toLowerCase()==="company car");
      return {title:"P46(Car) company-car event working data",columns:["Employee","NI number","Event","Available from","Available to","Registration","Make and model","Fuel type","First registered","CO2 g/km","Zero-emission mileage","List price","Capital contribution","Private-use contribution","Cash equivalent","Status"],rows:cars.map(r=>{const employee=allowedEmployees.find(e=>e.id===r.employeeId);return[name.get(r.employeeId),employee?.niNumber||"",r.benefitEvent||"",r.availableFrom||"",r.availableTo||"",r.vehicleRegistration||"",r.makeModel||"",r.fuelType||"",r.firstRegistered||"",r.co2Emissions||0,r.zeroEmissionMileage||0,r.listPrice||0,r.capitalContributions||0,r.privateUseContribution||0,r.cashEquivalent,r.status];}),notes:["Use this working data to report when a company car is provided, withdrawn, or an additional car is made available.","Live P46(Car) transmission requires HMRC-recognised software and credentials. The benefit must also be included in year-end benefit reporting where required."]};
    }
    const rows:any[]=type==="pbik"?reportableBenefits.filter(r=>r.payrolled):reportableBenefits.filter(r=>!r.payrolled);
    if(type==="p11d"){
      const runById=new Map(allRuns.map(run=>[run.id,run])),childcareByEmployee=new Map<number,number>();
      for(const item of (await db.select().from(payItems)).filter(item=>item.name==="Childcare voucher excess · Class 1 NIC and P11D"&&runById.has(item.payRunId))){
        const run=runById.get(item.payRunId)!;
        childcareByEmployee.set(run.employeeId,round((childcareByEmployee.get(run.employeeId)||0)+item.amount));
      }
      for(const [employeeId,cashEquivalent] of childcareByEmployee)rows.push({
        employeeId,p11dSection:"C",category:"Vouchers and credit cards",description:"Legacy childcare voucher excess above the applicable pay-period exemption",
        cashEquivalent,providedDate:null,payrolled:false,nicTreatment:"class-1",class1aNic:0,status:"finalised payroll",
      });
    }
    return {title:type==="pbik"?"Payrolled benefits (PBIK)":"P11D expenses and benefits working data",columns:["Employee","P11D section","Category","Description","Cash equivalent","Provided / paid date","Payrolled","NIC treatment","Class 1A NIC","Van use treatment","Private van fuel provided","Private van fuel repaid","Shared employees","Loan opening balance","Loan closing balance","Maximum aggregate loans","Whole months","Employee interest paid","Salary foregone","Accommodation annual value","Provider rent","Property cost","Improvements","Employee capital","Employee rent","Available days","Shared occupants","Accommodation salary foregone","Status"],rows:rows.map(r=>[name.get(r.employeeId),r.p11dSection||"",r.category,r.description,r.cashEquivalent,r.providedDate||"",r.payrolled?"Yes":"No",r.nicTreatment,r.class1aNic,r.vanUseType||"",r.vanFuelProvided?"Yes":"",r.vanFuelRepaid?"Yes":"",r.vanSharedEmployees||"",r.loanOpeningBalance??"",r.loanClosingBalance??"",r.loanMaximumAggregateBalance??"",r.loanWholeMonths??"",r.loanInterestPaid??"",r.loanSalaryForegone??"",r.accommodationAnnualValue??"",r.accommodationProviderRent??"",r.accommodationPropertyCost??"",r.accommodationImprovements??"",r.accommodationEmployeeCapital??"",r.accommodationEmployeeRent??"",r.accommodationAvailableDays??"",r.accommodationSharedEmployees??"",r.accommodationSalaryForegone??"",r.status]),notes:[type==="pbik"?"Includes reportable benefits marked as payrolled.":"Excludes benefits already marked as payrolled.","Class 1 values use the provided or paid date and enter NIC-able earnings in that tax month. P11D sections and NIC treatments are retained for reconciliation. Exempt register entries are excluded.","Company-van values use statutory private-use, fuel, sharing, availability and zero-emission rules.","Beneficial loans use the normal averaging method and retain the £10,000 aggregate-balance, interest and optional-remuneration evidence.","Living accommodation retains annual value, provider rent, property cost, improvement, employee contribution, availability and sharing evidence.","This is reconciliation data, not an HMRC-filed return."]};
  }
  const subs=await db.select().from(subcontractors).where(eq(subcontractors.employerId,employerId)),subIds=new Set(subs.map(s=>s.id));
  const payments=(await db.select().from(cisPayments)).filter(p=>subIds.has(p.subcontractorId)&&p.taxYear===taxYear&&p.status!=="voided"&&(!requestedPeriod||p.taxMonth===requestedPeriod));
  return {title:"CIS payment and deduction statements",columns:["Subcontractor","UTR","Invoice / payment reference","Legal payment recipient","Verification number at payment","Deduction rate","Tax month","Payment date","Labour","Retention","Materials","Materials evidence","VAT","Deduction","Net payment","Replaces payment","Status"],rows:payments.map(p=>{const s=subs.find(v=>v.id===p.subcontractorId);return[p.subcontractorName||s?.name,p.subcontractorUtr||s?.utr||"",p.invoiceNumber||"",p.paymentRecipient||p.subcontractorName||s?.name||"",p.verificationNumber||"",p.deductionRate,p.taxMonth,formatUkDate(p.paymentDate),p.labour,p.retention,p.materials,p.materialsEvidence||"",p.vat,p.deduction,p.netPayment,p.replacesPaymentId||"",p.status];}),notes:["Legal identity, invoice reference, payment recipient, materials evidence, verification number and deduction rate are immutable payment-time evidence. Voided payments and other tax years are excluded.","Replacement links preserve the correction chain from a voided payment to its active replacement."]};
}

type ReportBranding={employerName:string;employerAddress?:string|null;logoUrl?:string|null;payslipDesign?:string|null;accentColour:string;headerText:string|null;footerText:string|null;stationeryMode:string};
function printDocument(data:Report,taxYear:string,checksum:string,branding:ReportBranding){
  const accent=/^#[0-9a-f]{6}$/i.test(branding.accentColour)?branding.accentColour:"#087b79";
  const stationery=["standard","preprinted","plain"].includes(branding.stationeryMode)?branding.stationeryMode:"standard";
  const header=branding.headerText||branding.employerName||"PayFlow";
  const footer=branding.footerText||"Generated from finalised payroll records";
  const documents=data.document?.length?data.document:data.rows.map((row,index)=>({form:data.title,taxYear,record:index+1,...Object.fromEntries(data.columns.map((c,i)=>[c,row[i]]))}));
  const pages=documents.map(doc=>`<section class="page ${stationery}"><header><b>${escapeHtml(header)}</b><span>${escapeHtml(doc.form||data.title)}</span></header><h1>${escapeHtml(data.title)}</h1><p class="year">Tax year ${escapeHtml(taxYear)}</p><dl>${Object.entries(doc).filter(([k])=>!["form","taxYear"].includes(k)).map(([k,v])=>`<div><dt>${escapeHtml(k.replace(/([A-Z])/g," $1"))}</dt><dd>${typeof v==="number"?money(v):escapeHtml(v)}</dd></div>`).join("")}</dl>${data.notes?.map(n=>`<p class="note">${escapeHtml(n)}</p>`).join("")||""}<footer>${escapeHtml(footer)} · ${escapeHtml(formatUkDate(new Date().toISOString()))}<br>Source checksum ${escapeHtml(checksum)}</footer></section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eef3f5;font:14px Arial;color:#17313b}.page{width:186mm;min-height:273mm;margin:10mm auto;padding:16mm;background:white;border-top:7px solid ${accent};page-break-after:always}.page.preprinted{padding-top:42mm;border-top:0}.page.preprinted header{display:none}.page.plain{border-top:0}header{display:flex;justify-content:space-between;color:${accent}}h1{font-size:28px;margin:26px 0 4px}.year{color:#60757d}dl{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-top:28px}dl div{border-bottom:1px solid #d8e2e5;padding:10px 0}dt{color:#60757d;text-transform:capitalize;font-size:12px}dd{font-size:16px;font-weight:700;margin:4px 0}.note{background:#f3f7f8;padding:10px}.page footer{margin-top:30px;color:#74858b;font-size:11px}@media print{body{background:white}.page{margin:0;box-shadow:none}}</style></head><body>${pages||`<section class="page ${stationery}"><h1>${escapeHtml(data.title)}</h1><p>No eligible records.</p></section>`}</body></html>`;
}

export async function GET(request:Request){
  const url=new URL(request.url),employerId=Number(url.searchParams.get("employerId")||1),taxYear=url.searchParams.get("taxYear")||"2026/27",type=url.searchParams.get("type")||"p11";
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(!reportTypes.includes(type))return NextResponse.json({error:"Unsupported report type."},{status:400});
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const employeeId=url.searchParams.get("employeeId")?Number(url.searchParams.get("employeeId")):undefined,periodNumber=url.searchParams.get("periodNumber")?Number(url.searchParams.get("periodNumber")):undefined;
  if(employeeId!==undefined&&(!Number.isInteger(employeeId)||employeeId<1))return NextResponse.json({error:"Employee ID must be a positive integer."},{status:422});
  try{return NextResponse.json({type,taxYear,...await reportData(employerId,taxYear,type,Boolean(access.membership.canViewConfidential),employeeId,periodNumber)});}
  catch(error){return reportErrorResponse(error);}
}

export async function POST(request:Request){
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON report request object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON report request object is required."},{status:400});
  const employerId=Number(input.employerId),taxYear=String(input.taxYear||""),type=String(input.type||""),format=String(input.format||"");
  const access=await requireEmployerAccess(request,employerId,"read");if(!access.ok)return access.response;
  if(!reportTypes.includes(type))return NextResponse.json({error:"Unsupported report type."},{status:400});
  if(!["csv","html"].includes(format))return NextResponse.json({error:"Export format must be csv or html."},{status:400});
  if(!validTaxYear(taxYear))return NextResponse.json({error:"Tax year must use the format 2026/27."},{status:422});
  const employeeId=input.employeeId===undefined?undefined:Number(input.employeeId),periodNumber=input.periodNumber===undefined?undefined:Number(input.periodNumber);
  if(employeeId!==undefined&&(!Number.isInteger(employeeId)||employeeId<1))return NextResponse.json({error:"Employee ID must be a positive integer."},{status:422});
  try{
    const data=await reportData(employerId,taxYear,type,Boolean(access.membership.canViewConfidential),employeeId,periodNumber);
    const checksum=await sourceChecksum(data,type,taxYear);
    const [brandingRow]=await getDb().select({
      employerName:employers.name,employerAddress:employers.address,employerPostcode:employers.postcode,logoUrl:employerSettings.logoUrl,payslipDesign:employerSettings.payslipDesign,accentColour:employerSettings.reportAccentColour,
      headerText:employerSettings.reportHeaderText,footerText:employerSettings.reportFooterText,
      stationeryMode:employerSettings.reportStationeryMode,
    }).from(employers).leftJoin(employerSettings,eq(employerSettings.employerId,employers.id))
      .where(eq(employers.id,employerId)).limit(1);
    const branding:ReportBranding={
      employerName:brandingRow?.employerName||"PayFlow",employerAddress:[brandingRow?.employerAddress,brandingRow?.employerPostcode].filter(Boolean).join(", "),logoUrl:brandingRow?.logoUrl||null,payslipDesign:brandingRow?.payslipDesign||null,accentColour:brandingRow?.accentColour||"#087b79",
      headerText:brandingRow?.headerText||null,footerText:brandingRow?.footerText||null,
      stationeryMode:brandingRow?.stationeryMode||"standard",
    };
    await getDb().insert(auditLog).values({employerId,actor:access.user.email,action:`generated:${type}`,entityType:"report",after:JSON.stringify({taxYear,format,rows:data.rows.length,employeeId:employeeId||null,employeeIds:data.employeeIds||[],periodNumber:periodNumber||null,sourceChecksum:checksum})});
    const commonHeaders={"cache-control":"private, no-store","x-content-type-options":"nosniff","x-payflow-source-checksum":checksum};
    if(format==="html"){
      const html=type==="payslips"?renderPayslipHtml((data.document||[]) as unknown as PayslipRenderDocument[],{employerName:branding.employerName,employerAddress:branding.employerAddress||"",logoUrl:branding.logoUrl,design:normalisePayslipDesign(branding.payslipDesign)},checksum):printDocument(data,taxYear,checksum,branding);
      return new Response(html,{headers:{...commonHeaders,"content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src data:","content-type":"text/html; charset=utf-8","content-disposition":`attachment; filename="${type}-${taxYear.replace("/","-")}.html"`}});
    }
    return new Response(csv([data.columns,...data.rows]),{headers:{...commonHeaders,"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="${type}-${taxYear.replace("/","-")}.csv"`}});
  }catch(error){return reportErrorResponse(error);}
}
