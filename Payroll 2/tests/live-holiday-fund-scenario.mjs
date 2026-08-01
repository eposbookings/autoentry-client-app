import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||Date.now().toString(36);
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!",taxYear="2026/27";
let cookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{
    method,headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
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
  if(!expected.includes(response.status))
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for holiday-pay lifecycle testing");

const employerName=`Holiday Fund QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"497/HF2026",accountsOfficeReference:"497PH12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated holiday-pay employer is available",{employerId});

const profiles=[
  {key:"rolled",firstName:"Iris",lastName:"Irregular",annualSalary:12000,niNumber:"EE500001C"},
  {key:"fund",firstName:"Freya",lastName:"Fund",annualSalary:12000,niNumber:"EE500002C"},
  {key:"savings",firstName:"Sam",lastName:"Savings",annualSalary:12000,niNumber:"EE500003C"},
];
let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
for(const profile of profiles){
  const payrollId=`HF-${runId}-${profile.key}`;
  if(employees.some(item=>item.payrollId===payrollId))continue;
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,...profile,payrollId,email:`${profile.key}-${runId}@example.test`,
    dateOfBirth:"1990-01-15",gender:"F",address:"1 Holiday Street, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",payBasis:"period",
    hourlyRate:12.5,contractedHours:20,workingDaysPerWeek:5,annualLeaveDays:28,
    starterEvidence:"No P45 provided",starterDeclaration:"Statement A",reportedPayFrequency:"monthly",
  }});
}
employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const selected=Object.fromEntries(profiles.map(profile=>[profile.key,employees.find(item=>item.payrollId===`HF-${runId}-${profile.key}`)]));
check(Object.values(selected).every(Boolean),"Three holiday-pay treatment employees were created");

const invalidRolled=await request("/api/holiday-funds",{method:"POST",expected:[422],json:{
  employerId,employeeId:selected.rolled.id,action:"configure",schemeType:"rolled-up",workerType:"regular-hours",
  accrualRate:12.07,openingBalance:0,contractConfirmed:true,startDate:"2026-04-06",
}});
check(/irregular-hours or part-year/.test(invalidRolled.body.error),"Regular-hours worker cannot use rolled-up holiday pay");

await request("/api/holiday-funds",{method:"POST",expected:[201],json:{
  employerId,employeeId:selected.rolled.id,action:"configure",schemeType:"rolled-up",workerType:"irregular-hours",
  accrualRate:12.07,openingBalance:0,contractConfirmed:true,startDate:"2026-04-06",
}});
await request("/api/holiday-funds",{method:"POST",expected:[201],json:{
  employerId,employeeId:selected.fund.id,action:"configure",schemeType:"employer-accrual",workerType:"regular-hours",
  accrualRate:10,openingBalance:75,contractConfirmed:false,startDate:"2026-04-06",
}});
const correctedOpening=(await request("/api/holiday-funds",{method:"POST",expected:[200],json:{
  employerId,employeeId:selected.fund.id,action:"configure",schemeType:"employer-accrual",workerType:"regular-hours",
  accrualRate:10,openingBalance:100,contractConfirmed:false,startDate:"2026-04-06",
}})).body.setting;
check(correctedOpening.currentBalance===100,"Changing an unused opening balance updates the current fund balance");
await request("/api/holiday-funds",{method:"POST",expected:[201],json:{
  employerId,employeeId:selected.savings.id,action:"configure",schemeType:"employee-savings",workerType:"regular-hours",
  accrualRate:0,openingBalance:50,contractConfirmed:false,startDate:"2026-04-06",
}});
check(true,"All three holiday-pay arrangements were configured");

async function setPeriod(employeeId,periodNumber,manualAdded,requestedPaid){
  await request("/api/holiday-funds",{method:"POST",expected:[201,200],json:{
    employerId,employeeId,action:"set-period",taxYear,periodNumber,manualAdded,requestedPaid,referencePayOverride:null,
  }});
}
await setPeriod(selected.fund.id,1,0,20);
await setPeriod(selected.savings.id,1,100,30);

const schedule=scheduledPayPeriods(taxYear,"monthly");
function payRecords(periodNumber){
  return Object.values(selected).map(employee=>({
    employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
    grossPay:1000,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
    studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
    noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:12000,contractedHours:20,periodNumber,
    items:[{type:"earning",name:"Monthly salary",quantity:1,rate:1000,amount:1000,taxable:true,nicable:true,pensionable:true}],
  }));
}
async function finalise(periodNumber){
  return (await request("/api/pay-runs",{method:"POST",json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber,payDate:schedule[periodNumber-1].payDate,
    employees:payRecords(periodNumber),
  }})).body;
}

const period1=await finalise(1);
const p1=Object.fromEntries(period1.calculated.map(item=>[item.employee.payrollId,item]));
check(p1[selected.rolled.payrollId].holidayFund.paidAmount===120.7&&p1[selected.rolled.payrollId].result.grossPay===1120.7,
  "Rolled-up pay is a separate taxable and NIC-able earning");
check(p1[selected.fund.payrollId].holidayFund.addedAmount===100&&p1[selected.fund.payrollId].holidayFund.balanceAfter===180&&p1[selected.fund.payrollId].result.grossPay===1020,
  "Employer fund accrues and taxable withdrawal increases gross pay");
check(p1[selected.savings.payrollId].holidayFund.postTaxDeduction===100&&p1[selected.savings.payrollId].holidayFund.balanceAfter===120&&p1[selected.savings.payrollId].result.grossPay===1030&&p1[selected.savings.payrollId].result.taxablePay===1000,
  "Employee saving is post-tax while its withdrawal is not taxed again");

const futurePeriod=await request("/api/holiday-funds",{method:"POST",expected:[409],json:{
  employerId,employeeId:selected.fund.id,action:"set-period",taxYear,periodNumber:3,manualAdded:0,requestedPaid:10,referencePayOverride:null,
}});
check(/open Period 2/.test(futurePeriod.body.error),"Holiday instructions cannot bypass the next open payroll period");

await setPeriod(selected.fund.id,2,0,50);
await setPeriod(selected.savings.id,2,60,20);
await request("/api/pay-runs",{method:"POST",json:{
  action:"draft",source:"manual",employerId,taxYear,periodNumber:2,payDate:schedule[1].payDate,employees:payRecords(2),
}});
await setPeriod(selected.savings.id,2,60,20);
const draftBackup=(await request(`/api/data?employerId=${employerId}`)).body;
const verifiedDraft=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup:draftBackup}});
check(verifiedDraft.body.verified===true,"Editing holiday instructions after a draft calculation clears stale calculated evidence");
const period2=await finalise(2);
const p2=Object.fromEntries(period2.calculated.map(item=>[item.employee.payrollId,item]));
check(p2[selected.fund.payrollId].holidayFund.balanceBefore===180&&p2[selected.fund.payrollId].holidayFund.balanceAfter===230,
  "Employer fund carries its exact first-period balance");
check(p2[selected.savings.payrollId].holidayFund.balanceBefore===120&&p2[selected.savings.payrollId].holidayFund.balanceAfter===160,
  "Employee savings carry their exact first-period balance");

const frozenChange=await request("/api/holiday-funds",{method:"POST",expected:[409],json:{
  employerId,employeeId:selected.fund.id,action:"configure",schemeType:"employee-savings",workerType:"regular-hours",
  accrualRate:0,openingBalance:100,contractConfirmed:false,startDate:"2026-04-06",
}});
check(/frozen after the first finalised/.test(frozenChange.body.error),"Finalised scheme classification and opening balance cannot be rewritten");

await request("/api/pay-runs",{method:"PUT",json:{action:"reopen",employerId,taxYear,periodNumber:2}});
let ledger=(await request(`/api/holiday-funds?employerId=${employerId}`)).body;
const fundSetting=ledger.settings.find(item=>item.employeeId===selected.fund.id);
const savingsSetting=ledger.settings.find(item=>item.employeeId===selected.savings.id);
check(fundSetting.currentBalance===180&&savingsSetting.currentBalance===120,
  "Reopening the latest period restores both pre-period balances");
check(ledger.entries.filter(item=>item.periodNumber===2).every(item=>item.status==="draft"),
  "Reopened holiday-fund rows remain as editable draft evidence");

await finalise(2);
ledger=(await request(`/api/holiday-funds?employerId=${employerId}`)).body;
check(ledger.settings.find(item=>item.employeeId===selected.fund.id).currentBalance===230&&
  ledger.settings.find(item=>item.employeeId===selected.savings.id).currentBalance===160,
  "Refinalising reproduces the same closing balances without duplication");
check(ledger.entries.filter(item=>item.status==="finalised").length===6,
  "Two periods produce exactly one finalised ledger row per arrangement");

const report=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=holiday-fund`)).body;
check(report.rows.length===6&&report.columns.includes("Post-tax deduction"),
  "Holiday-pay ledger report reconciles all finalised treatments");

const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.schemaVersion===7&&backup.dataset.holidayFundSettings.length===3&&backup.dataset.holidayFundEntries.length===6,
  "Schema 7 backup contains every holiday-pay setting and ledger entry");
const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verified.body.verified===true,"Untampered holiday-pay backup passes complete validation");

const tampered=structuredClone(backup);
tampered.dataset.holidayFundEntries[0].addedAmount+=1;
const unsigned=Object.fromEntries(Object.entries(tampered).filter(([key])=>key!=="checksum"));
tampered.checksum.value=createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const rejected=await request("/api/data",{method:"POST",expected:[422],json:{action:"verify-backup",employerId,backup:tampered}});
check(rejected.status===422&&rejected.body.table==="holidayFundEntries",
  "Backup verification rejects recalculated outer checksums when holiday-fund evidence is altered",rejected.body);

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length},checks},null,2));
