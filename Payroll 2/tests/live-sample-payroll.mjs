import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!";
const taxYear="2026/27";
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
  const text=await response.text();let body=text;
  if((response.headers.get("content-type")||"").includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,headers:response.headers};
}

await request("/api/admin/session",{
  method:"POST",captureCookie:true,json:{action:"login",employerId:bootstrapEmployerId,email,password},
});
check(Boolean(cookie),"Owner authenticated for isolated sample payroll testing");

const originalEmployees=(await request(`/api/employees?employerId=${bootstrapEmployerId}`)).body;
const rejected=await request("/api/scenarios",{
  method:"POST",expected:[422],json:{action:"create-isolated-sample",confirmation:"WRONG"},
});
check(/Confirm creation/.test(rejected.body.error),"Sample creation requires the exact non-destructive confirmation");

const created=await request("/api/scenarios",{
  method:"POST",expected:[201],json:{action:"create-isolated-sample",confirmation:"CREATE ISOLATED SAMPLE"},
});
const employerId=created.body.employerId;
check(created.body.created===true&&created.body.employees===20&&created.body.departments===5&&created.body.subcontractors===3,
  "Sample creation returned the complete isolated dataset",created.body);
check(/must never be filed externally/.test(created.body.warning),"Sample creation labels its external-filing prohibition");

const session=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body;
check(session.memberships.some(item=>item.employerId===employerId&&item.role==="owner"),"The creator received isolated owner access");

const employer=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
check(employer.cisContractor===true&&employer.payFrequency==="monthly"&&employer.reportHeaderText.includes("NOT FOR LIVE FILING"),
  "Sample employer retains conspicuous non-production PAYE, report and CIS settings");

const employees=(await request(`/api/employees?employerId=${employerId}`)).body;
check(employees.length===20&&new Set(employees.map(item=>item.payrollId)).size===20,"Twenty unique sample employee records persisted");
check(employees.every(item=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)),"Every sample employee has a deliverable-format email address");
check(employees.every(item=>["M","F"].includes(item.gender)),"Every sample employee retains a canonical HMRC gender code");
check(employees.some(item=>item.starterEvidence==="P45 provided"&&item.p45PreviousPay===7800&&item.p45LeavingDate<=item.startDate),"P45 previous-employment evidence persisted with valid chronology");
check(employees.every(item=>["Statement A – first job since 6 April","Statement B – only job now; worked since 6 April","Statement C – another job or pension","No statement – use 0T week 1 / month 1"].includes(item.starterDeclaration)),
  "Every sample starter declaration matches a supported onboarding choice");
check(employees.some(item=>item.p60ReferenceOnly&&item.week1Month1),"Reference-only P60 and non-cumulative starter evidence persisted");
check(employees.some(item=>item.director&&!item.alternativeDirectorNic)&&employees.some(item=>item.director&&item.alternativeDirectorNic),
  "Both director NIC methods persisted");
check(employees.some(item=>item.confidential&&item.employeePortal&&item.portalCanEditBank),"Confidential employee-portal permissions persisted");

const pensions=(await request(`/api/pensions?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(pensions.schemes.length===1&&pensions.schemes[0].status==="active","The demonstration pension scheme is active");
const cis=(await request(`/api/cis?employerId=${employerId}`)).body;
check(cis.subcontractors.length===3&&cis.subcontractors.map(item=>item.deductionRate).sort((a,b)=>a-b).join(",")==="0,20,30",
  "CIS sample records cover gross, standard and unmatched rates");
check(cis.subcontractors.every(item=>item.status===(item.deductionRate===0?"gross-payment-status":"verified")),
  "CIS sample lifecycle status matches its verified deduction rate");

const schedule=scheduledPayPeriods(taxYear,"monthly","2026-04-30");
const records=period=>employees.map(employee=>{
  const gross=Math.round(Number(employee.annualSalary||0)/12*100)/100;
  return {
    employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
    grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
    studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
    noSecondaryNic:employee.noSecondaryNic,directorMethod:employee.alternativeDirectorNic?"alternative":"annual",
    annualSalary:employee.annualSalary,contractedHours:employee.contractedHours,
    items:[{type:"earning",name:"Monthly salary",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
  };
});

const premature=await request("/api/pay-runs",{method:"POST",expected:[409],json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:2,payDate:schedule[1].payDate,employees:records(schedule[1]),
}});
check(/Period 1 must be completed/.test(premature.body.error),"Sample payroll preserves sequential period locking");
const afterPremature=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(afterPremature.periods.length===0&&afterPremature.runs.length===0,
  "A rejected out-of-sequence payroll leaves no period or employee-run evidence");

for(const period of schedule.slice(0,2)){
  const employeeRecords=records(period);
  const draft=await request("/api/pay-runs",{method:"POST",json:{
    action:"draft",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:employeeRecords,
  }});
  check(draft.body.calculated.length===20,`Sample period ${period.periodNumber} calculated every employee`);
  const finalised=await request("/api/pay-runs",{method:"POST",json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:employeeRecords,
  }});
  check(finalised.body.status==="finalised",`Sample period ${period.periodNumber} finalised`);
}

const payroll=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(payroll.periods.filter(item=>item.status==="finalised").length===2&&payroll.runs.filter(item=>item.status==="finalised").length===40,
  "Two finalised months retained forty immutable employee-period results");
const p11=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p11`)).body;
check(p11.rows.length===40&&new Set(p11.rows.map(row=>row[1])).size===20,
  "Sample P11 report includes both statutory rows for every employee after two months");
const payslipDelivery=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:2,method:"email",
}})).body;
check(payslipDelivery.recipientCount===20&&payslipDelivery.excluded.length===0&&payslipDelivery.delivery.status==="queued-external",
  "Every sample employee enters the source-bound email payslip batch without claiming external transmission");
const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.counts.employees===20&&backup.counts.subcontractors===3&&backup.counts.payPeriods===3,
  "Sample employer exports as a complete checksummed recovery dataset");
const verifiedBackup=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verifiedBackup.body.verified===true,"The generated sample passes complete payroll-state and relationship validation");

const originalEmployeesAfter=(await request(`/api/employees?employerId=${bootstrapEmployerId}`)).body;
check(originalEmployeesAfter.length===originalEmployees.length,"Creating and running the sample did not change the source employer");

console.log(JSON.stringify({
  baseUrl,employerId,employerName:created.body.employerName,
  summary:{checks:checks.length,employees:employees.length,finalisedPeriods:2,p11Rows:p11.rows.length,cisSubcontractors:cis.subcontractors.length},
  checks,
},null,2));
