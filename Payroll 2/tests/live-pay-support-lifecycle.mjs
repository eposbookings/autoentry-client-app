import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!",taxYear="2026/27";
let cookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
    body:json===undefined?undefined:JSON.stringify(json),
  });
  if(captureCookie){
    const value=response.headers.get("set-cookie");
    if(value)cookie=value.split(";")[0];
  }
  const text=await response.text();
  let body=text;
  if((response.headers.get("content-type")||"").includes("application/json")&&text){
    try{body=JSON.parse(text);}catch{}
  }
  if(!expected.includes(response.status)){
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  }
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for payroll-support lifecycle testing");

const employerName=`Payroll Support QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"497/PS2026",accountsOfficeReference:"497PF12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated payroll-support employer is available",{employerId});

const employeeRows=[
  {
    firstName:"Celia",lastName:"Credit",payrollId:`PS-${runId}-CT`,email:`credit-${runId}@example.test`,
    niNumber:"EE200001C",paymentMethod:"credit-transfer",employeePortal:true,portalCanEditBank:true,
    bankName:"QA Bank",accountName:"Celia Credit",sortCode:"123456",accountNumber:"12345678",
    annualSalary:36000,
  },
  {
    firstName:"Callum",lastName:"Cash",payrollId:`PS-${runId}-CA`,email:`cash-${runId}@example.test`,
    niNumber:"EE200002C",paymentMethod:"cash",employeePortal:false,portalCanEditBank:false,
    annualSalary:27999.96,
  },
];
let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
for(const row of employeeRows){
  if(employees.some(item=>item.payrollId===row.payrollId))continue;
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,...row,dateOfBirth:"1990-01-15",gender:"F",address:"1 Support Street, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",payBasis:"period",
    hourlyRate:18,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,
    starterEvidence:"No P45 provided",starterDeclaration:"Statement A",reportedPayFrequency:"monthly",
  }});
}
employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const credit=employees.find(item=>item.payrollId===employeeRows[0].payrollId);
const cash=employees.find(item=>item.payrollId===employeeRows[1].payrollId);
check(Boolean(credit&&cash),"Credit-transfer and cash employees were created");

const schedule=(await request("/api/recurring-items",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId:credit.payrollId,type:"earning",name:"Retention allowance",amount:250,
  taxable:true,nicable:true,pensionable:true,startPeriod:1,endPeriod:3,
}})).body;
const duplicateSchedule=await request("/api/recurring-items",{method:"POST",expected:[409],json:{
  employerId,taxYear,payrollId:credit.payrollId,type:"earning",name:"Retention allowance",amount:250,
  taxable:true,nicable:true,pensionable:true,startPeriod:1,endPeriod:3,
}});
check(/identical active pay schedule/.test(duplicateSchedule.body.error),"Duplicate recurring schedule is rejected");

const loan=(await request("/api/employee-loans",{method:"POST",expected:[201],json:{
  employerId,payrollId:credit.payrollId,type:"loan",reference:`LOAN-${runId}`,
  originalAmount:200,regularDeduction:60,startDate:"2026-04-06",
}})).body;
const duplicateLoan=await request("/api/employee-loans",{method:"POST",expected:[409],json:{
  employerId,payrollId:credit.payrollId,type:"loan",reference:`LOAN-${runId}`,
  originalAmount:200,regularDeduction:60,startDate:"2026-04-06",
}});
check(/already has a loan ledger/.test(duplicateLoan.body.error),"Duplicate employee-loan reference is rejected");

const rounding=(await request("/api/pay-rounding",{method:"POST",expected:[201],json:{
  employerId,payrollId:cash.payrollId,unit:10,
}})).body;
const nonCashRounding=await request("/api/pay-rounding",{method:"POST",expected:[409],json:{
  employerId,payrollId:credit.payrollId,unit:5,
}});
check(/payment method is cash/.test(nonCashRounding.body.error),"Cash rounding cannot be enabled for a bank-paid employee");

const monthly=scheduledPayPeriods(taxYear,"monthly");
function records(periodNumber){
  return [
    {
      employeeId:credit.id,payrollId:credit.payrollId,firstName:credit.firstName,lastName:credit.lastName,email:credit.email,
      grossPay:3000,taxCode:credit.taxCode,niCategory:credit.niCategory,week1Month1:credit.week1Month1,
      studentLoanPlan:credit.studentLoanPlan,postgraduateLoan:credit.postgraduateLoan,director:credit.director,
      noSecondaryNic:credit.noSecondaryNic,directorMethod:"annual",annualSalary:36000,contractedHours:37.5,periodNumber,
      items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:3000,amount:3000,taxable:true,nicable:true,pensionable:true}],
    },
    {
      employeeId:cash.id,payrollId:cash.payrollId,firstName:cash.firstName,lastName:cash.lastName,email:cash.email,
      grossPay:2333.33,taxCode:cash.taxCode,niCategory:cash.niCategory,week1Month1:cash.week1Month1,
      studentLoanPlan:cash.studentLoanPlan,postgraduateLoan:cash.postgraduateLoan,director:cash.director,
      noSecondaryNic:cash.noSecondaryNic,directorMethod:"annual",annualSalary:27999.96,contractedHours:37.5,periodNumber,
      items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:2333.33,amount:2333.33,taxable:true,nicable:true,pensionable:true}],
    },
  ];
}

const p1=(await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:monthly[0].payDate,employees:records(1),
}})).body;
const creditP1=p1.calculated.find(item=>item.employee.payrollId===credit.payrollId);
const cashP1=p1.calculated.find(item=>item.employee.payrollId===cash.payrollId);
check(creditP1.result.grossPay===3250&&creditP1.employeeLoans[0]?.amount===60,
  "Period 1 applies the recurring allowance and loan recovery",creditP1);
check(cashP1.cashRounding?.unit===10&&cashP1.cashRounding.roundedNet%10===0,
  "Period 1 rounds cash net pay down to the selected unit",cashP1.cashRounding);

let loanState=(await request(`/api/employee-loans?employerId=${employerId}`)).body;
let roundingState=(await request(`/api/pay-rounding?employerId=${employerId}`)).body;
check(loanState.loans.find(item=>item.id===loan.id)?.balance===140&&loanState.history.length===1,
  "Loan balance and immutable Period 1 recovery history reconcile");
check(roundingState.settings.find(item=>item.id===rounding.id)?.carry===cashP1.cashRounding.closingCarry&&roundingState.history.length===1,
  "Cash carry and immutable Period 1 rounding history reconcile");

const bankFile=await request("/api/exports",{method:"POST",json:{
  employerId,taxYear,periodNumber:1,type:"payments",
}});
check(bankFile.headers.get("x-payflow-submission-id")&&bankFile.headers.get("x-payflow-duplicate")==="false"&&
  bankFile.text.includes("Celia Credit")&&!bankFile.text.includes("Callum Cash"),
  "Bank payment CSV includes only complete positive credit-transfer payments");
const bankFileAgain=await request("/api/exports",{method:"POST",json:{
  employerId,taxYear,periodNumber:1,type:"payments",
}});
check(bankFileAgain.headers.get("x-payflow-duplicate")==="true"&&bankFileAgain.text===bankFile.text,
  "Identical bank payment export is source-bound and reuses its recorded batch");

const emailDelivery=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"email",
}})).body;
check(emailDelivery.recipientCount===2&&emailDelivery.delivery.status==="queued-external"&&
  emailDelivery.delivery.payload.externalTransmission===false,
  "Email delivery records both recipients without claiming external transmission");
const duplicateEmail=await request("/api/payslip-deliveries",{method:"POST",expected:[409],json:{
  employerId,taxYear,periodNumber:1,method:"email",
}});
check(/already been recorded/.test(duplicateEmail.body.error),"Duplicate payslip delivery requires an explicit resend");
const resentEmail=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"email",resend:true,
}})).body;
check(resentEmail.delivery.payload.resendOf===emailDelivery.delivery.id,
  "Explicit payslip resend links back to the original evidence batch");
const portalDelivery=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"portal",
}})).body;
check(portalDelivery.recipientCount===1&&portalDelivery.excluded.length===1&&
  portalDelivery.excluded[0].payrollId===cash.payrollId&&portalDelivery.delivery.status==="published",
  "Portal publishing includes only enabled employees and records exclusions");
const deliveryHistory=(await request(`/api/payslip-deliveries?employerId=${employerId}`)).body;
check(deliveryHistory.length===3&&deliveryHistory.every(item=>item.payload?.sourceChecksum),
  "Payslip delivery history round-trips every source checksum");

await request("/api/pay-runs",{method:"POST",json:{
  action:"draft",source:"manual",employerId,taxYear,periodNumber:2,payDate:monthly[1].payDate,employees:records(2),
}});
const draftBefore=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
const p2Period=draftBefore.periods.find(item=>item.periodNumber===2);
const creditDraft=draftBefore.runs.find(item=>item.payPeriodId===p2Period.id&&item.employeeId===credit.id);
check(creditDraft?.grossPay===3250&&draftBefore.items.some(item=>item.payRunId===creditDraft.id&&item.recurringItemId===schedule.id),
  "Period 2 draft initially includes the active recurring occurrence");

const stoppedSchedule=(await request("/api/recurring-items",{method:"PUT",json:{
  employerId,id:schedule.id,action:"stop",endPeriod:1,
}})).body;
check(stoppedSchedule.removedDraftOccurrences===1&&stoppedSchedule.invalidatedDraftRuns===1,
  "Stopping a schedule removes its future occurrence and invalidates the affected employee draft");
const draftAfter=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(!draftAfter.runs.some(item=>item.id===creditDraft.id)&&!draftAfter.items.some(item=>item.payRunId===creditDraft.id),
  "No stale pay-run totals remain after a recurring schedule is stopped");

await request("/api/employee-loans",{method:"PUT",json:{employerId,id:loan.id,action:"suspend"}});
await request("/api/pay-rounding",{method:"PUT",json:{employerId,id:rounding.id,action:"suspend"}});
const p2=(await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:2,payDate:monthly[1].payDate,employees:records(2),
}})).body;
const creditP2=p2.calculated.find(item=>item.employee.payrollId===credit.payrollId);
const cashP2=p2.calculated.find(item=>item.employee.payrollId===cash.payrollId);
check(creditP2.result.grossPay===3000&&creditP2.employeeLoans.length===0,
  "Suspended loan and stopped recurring allowance do not affect Period 2");
check(cashP2.cashRounding===null,"Suspended cash rounding leaves Period 2 net pay unrounded");

await request("/api/employee-loans",{method:"PUT",json:{employerId,id:loan.id,action:"resume"}});
await request("/api/pay-rounding",{method:"PUT",json:{employerId,id:rounding.id,action:"resume"}});
const p3=(await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:3,payDate:monthly[2].payDate,employees:records(3),
}})).body;
const creditP3=p3.calculated.find(item=>item.employee.payrollId===credit.payrollId);
const cashP3=p3.calculated.find(item=>item.employee.payrollId===cash.payrollId);
check(creditP3.result.grossPay===3000&&creditP3.employeeLoans[0]?.amount===60,
  "Resumed loan recovery continues in Period 3 without reviving the stopped allowance");
check(cashP3.cashRounding?.openingCarry===cashP1.cashRounding.closingCarry,
  "Resumed cash rounding carries the unpaid Period 1 remainder into Period 3");

loanState=(await request(`/api/employee-loans?employerId=${employerId}`)).body;
roundingState=(await request(`/api/pay-rounding?employerId=${employerId}`)).body;
check(loanState.loans.find(item=>item.id===loan.id)?.balance===80&&loanState.history.length===2,
  "Loan ledger has two deductions and the exact remaining balance after suspension");
check(roundingState.history.length===2&&roundingState.settings.find(item=>item.id===rounding.id)?.carry===cashP3.cashRounding.closingCarry,
  "Cash rounding ledger has two entries and its latest carry");

const roundingLedger=roundingState.settings.find(item=>item.id===rounding.id);
if(roundingLedger.carry>.005){
  const blockedStop=await request("/api/pay-rounding",{method:"PUT",expected:[409],json:{
    employerId,id:rounding.id,action:"stop",
  }});
  check(/carried cash balance/.test(blockedStop.body.error),"Cash-rounding ledger cannot stop while money remains carried");
}else{
  check(roundingLedger.carry===0,"Cash-rounding carry settled exactly before stop");
}

const loanReport=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=employee-loans&periodNumber=3`)).body;
const roundingReport=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=cash-rounding&periodNumber=3`)).body;
check(loanReport.rows.some(row=>row.join(" ").includes(`LOAN-${runId}`))&&roundingReport.rows.some(row=>row.join(" ").includes("Callum Cash")),
  "Loan and cash-rounding reports expose the reconciled operational ledgers");

const cashMakeupReport=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=cash-payments&periodNumber=3`)).body;
const cashRequestReport=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=cash-request&periodNumber=3`)).body;
const cashReceiptReport=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=cash-receipt&periodNumber=3`)).body;
const requestTotal=cashRequestReport.rows.find(row=>row[0]==="TOTAL CASH REQUESTED");
check(cashMakeupReport.rows.length===1&&cashMakeupReport.rows[0][0]==="Callum Cash"&&
  requestTotal?.[3]===cashMakeupReport.rows[0][3],
  "Bank cash request aggregates denominations to the finalised cash net pay");
check(cashReceiptReport.rows.length===1&&cashReceiptReport.rows[0][0]==="Callum Cash"&&
  cashReceiptReport.rows[0][2]===cash.niNumber&&cashReceiptReport.rows[0][4]===monthly[2].payDate&&
  !cashReceiptReport.columns.some(column=>/amount|net pay|gross pay/i.test(column))&&
  !cashReceiptReport.rows[0].includes(cashMakeupReport.rows[0][3]),
  "Cash receipt sheet provides finalised identity and signature fields without disclosing wage amounts");

console.log(JSON.stringify({
  baseUrl,employerId,
  summary:{checks:checks.length,payslipDeliveries:deliveryHistory.length,loanBalance:80,cashCarry:roundingLedger.carry},
  checks,
},null,2));
