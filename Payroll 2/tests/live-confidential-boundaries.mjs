import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
const ownerEmail="qa-live@payflow.local",ownerPassword="PayFlow-Live-QA-2026!",taxYear="2026/27";
let ownerCookie="",restrictedCookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],cookie=ownerCookie,captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
    body:json===undefined?undefined:JSON.stringify(json),
  });
  const setCookie=response.headers.get("set-cookie");
  const captured=captureCookie&&setCookie?setCookie.split(";")[0]:"";
  const text=await response.text();
  let body=text;
  if((response.headers.get("content-type")||"").includes("application/json")&&text){
    try{body=JSON.parse(text);}catch{}
  }
  if(!expected.includes(response.status)){
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  }
  return {status:response.status,body,text,headers:response.headers,cookie:captured};
}

const ownerLogin=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email:ownerEmail,password:ownerPassword,
}});
ownerCookie=ownerLogin.cookie;
check(Boolean(ownerCookie),"Owner authenticated for confidential-boundary testing");

const employerName=`Confidential Boundaries QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"499/CB2026",accountsOfficeReference:"499PF12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated confidentiality employer is available",{employerId});

const employeeInputs=[
  {firstName:"Perry",lastName:"Public",payrollId:`CB-${runId}-PUBLIC`,niNumber:"AB300001C",confidential:false,annualSalary:30000},
  {firstName:"Carmen",lastName:"Confidential",payrollId:`CB-${runId}-PRIVATE`,niNumber:"AB300002C",confidential:true,annualSalary:60000},
];
let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
for(const row of employeeInputs){
  if(employees.some(item=>item.payrollId===row.payrollId))continue;
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,...row,email:`${row.payrollId.toLowerCase()}@example.test`,
    dateOfBirth:"1990-01-15",gender:"F",address:"1 Boundary Road, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",payBasis:"period",
    hourlyRate:20,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
    bankName:"QA Bank",accountName:`${row.firstName} ${row.lastName}`,sortCode:"123456",
    accountNumber:row.confidential?"87654321":"12345678",starterEvidence:"No P45 provided",starterDeclaration:"Statement A",
    employeePortal:true,portalCanEditBank:true,reportedPayFrequency:"monthly",
  }});
}
employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const publicEmployee=employees.find(item=>item.payrollId===employeeInputs[0].payrollId);
const privateEmployee=employees.find(item=>item.payrollId===employeeInputs[1].payrollId);
check(Boolean(publicEmployee&&privateEmployee),"Public and confidential employees were created");

for(const employee of [publicEmployee,privateEmployee]){
  await request("/api/recurring-items",{method:"POST",expected:[201],json:{
    employerId,taxYear,payrollId:employee.payrollId,type:"earning",name:`Boundary allowance ${employee.payrollId}`,
    amount:100,taxable:true,nicable:true,pensionable:true,startPeriod:1,endPeriod:2,
  }});
  await request("/api/employee-loans",{method:"POST",expected:[201],json:{
    employerId,payrollId:employee.payrollId,type:"loan",reference:`BOUNDARY-${employee.payrollId}`,
    originalAmount:100,regularDeduction:10,startDate:"2026-04-06",
  }});
}
const privateHmrc=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId:privateEmployee.payrollId,type:"coding",noticeIdentifier:`PRIVATE-P9-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",taxCode:"1185L",source:"hmrc",
}})).body;
await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId:publicEmployee.payrollId,type:"coding",noticeIdentifier:`PUBLIC-P9-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",taxCode:"1200L",source:"hmrc",
}});
await request("/api/statutory-notices",{method:"POST",expected:[201],json:{
  employerId,payrollId:privateEmployee.payrollId,statutoryType:"maternity",decisionDate:"2026-07-20",
  payStartDate:"2026-09-01",payEndDate:"2027-03-31",averageWeeklyEarnings:100,
  continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,
}});
await request("/api/statutory-notices",{method:"POST",expected:[201],json:{
  employerId,payrollId:publicEmployee.payrollId,statutoryType:"maternity",decisionDate:"2026-07-20",
  payStartDate:"2026-10-01",payEndDate:"2027-03-31",averageWeeklyEarnings:100,
  continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,
}});

const payPeriod=scheduledPayPeriods(taxYear,"monthly")[0];
const records=[publicEmployee,privateEmployee].map(employee=>{
  const gross=employee.confidential?5000:2500;
  return {
    employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
    grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
    studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
    noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:employee.annualSalary,
    contractedHours:37.5,periodNumber:1,
    items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
  };
});
await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:payPeriod.payDate,employees:records,
}});
check(true,"Owner finalised a mixed public/confidential payroll period");

const restrictedEmail=`restricted-${runId}@example.test`,restrictedPassword=`Restricted-${runId}-Pass!`;
await request("/api/admin/users",{method:"POST",expected:[201],json:{
  employerId,email:restrictedEmail,temporaryPassword:restrictedPassword,displayName:"Restricted Payroll QA",
  role:"payroll",canViewConfidential:false,
}});
const restrictedLogin=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{
  action:"login",employerId,email:restrictedEmail,password:restrictedPassword,
}});
restrictedCookie=restrictedLogin.cookie;
check(Boolean(restrictedCookie),"Restricted payroll user authenticated without confidential permission");

const visibleEmployees=(await request(`/api/employees?employerId=${employerId}`,{cookie:restrictedCookie})).body;
check(visibleEmployees.length===1&&visibleEmployees[0].id===publicEmployee.id,
  "Employee register hides the confidential employee");
const visibleHmrc=(await request(`/api/hmrc-notices?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{cookie:restrictedCookie})).body.notices;
check(visibleHmrc.length===1&&visibleHmrc[0].payrollId===publicEmployee.payrollId&&!JSON.stringify(visibleHmrc).includes(privateEmployee.payrollId),
  "HMRC notice inbox hides confidential employee instructions");
const blockedNoticeCreate=await request("/api/hmrc-notices",{method:"POST",cookie:restrictedCookie,expected:[404],json:{
  employerId,taxYear,payrollId:privateEmployee.payrollId,type:"nino",noticeIdentifier:`BLOCKED-NINO-${runId}`,
  issuedDate:"2026-04-09",effectiveDate:"2026-04-06",niNumber:"AB300099C",source:"manual",
}});
check(/Select an employee belonging/.test(blockedNoticeCreate.body.error),
  "Restricted payroll user cannot create a notice for a confidential employee");
const blockedNoticeUpdate=await request("/api/hmrc-notices",{method:"PUT",cookie:restrictedCookie,expected:[404],json:{
  employerId,id:privateHmrc.id,action:"ignore",
}});
check(/not found/.test(blockedNoticeUpdate.body.error),
  "Restricted payroll user cannot mutate an existing confidential HMRC notice");

const blockedHistory=await request(`/api/employee-history?employerId=${employerId}&employeeId=${privateEmployee.id}`,{
  cookie:restrictedCookie,expected:[403],
});
check(/Confidential employee access/.test(blockedHistory.body.error),
  "Employee history denies confidential access");
const statutoryRows=(await request(`/api/statutory-notices?employerId=${employerId}`,{cookie:restrictedCookie})).body;
check(statutoryRows.length===1&&statutoryRows[0].payrollId===publicEmployee.payrollId,
  "Statutory-notice register hides confidential forms");
const recurringRows=(await request(`/api/recurring-items?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{cookie:restrictedCookie})).body;
check(recurringRows.length===1&&recurringRows[0].payrollId===publicEmployee.payrollId,
  "Recurring-pay register hides confidential schedules");
const loanRows=(await request(`/api/employee-loans?employerId=${employerId}`,{cookie:restrictedCookie})).body;
check(loanRows.loans.length===1&&loanRows.loans[0].payrollId===publicEmployee.payrollId&&loanRows.history.length===1,
  "Loan ledger hides confidential balances and deduction history");

const report=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=payslips&periodNumber=1`,{
  cookie:restrictedCookie,
})).body;
check(report.rows.length===1&&report.rows[0].join(" ").includes("Perry Public")&&!JSON.stringify(report).includes("Carmen"),
  "Payslip report contains only visible employee evidence");
const analysis=(await request(`/api/analysis?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{
  cookie:restrictedCookie,
})).body;
check(analysis.employees.length===1&&analysis.employees[0].employeeId===publicEmployee.id&&analysis.totals.grossPay===2600,
  "Analysis totals exclude confidential employee pay and include visible recurring pay");

const delivery=(await request("/api/payslip-deliveries",{method:"POST",cookie:restrictedCookie,expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"email",
}})).body;
check(delivery.recipientCount===1&&delivery.delivery.payload.recipients[0].employeeId===publicEmployee.id&&delivery.excluded.length===0,
  "Restricted payslip delivery batch cannot reveal or send confidential payslips");
const deliveryHistory=(await request(`/api/payslip-deliveries?employerId=${employerId}`,{cookie:restrictedCookie})).body;
check(deliveryHistory.length===1&&deliveryHistory[0].payload.recipients.length===1,
  "Restricted delivery history retains only visible recipients");

const blockedBankFile=await request("/api/exports",{method:"POST",cookie:restrictedCookie,expected:[403],json:{
  employerId,taxYear,periodNumber:1,type:"payments",
}});
check(/Confidential employee permission/.test(blockedBankFile.body.error),
  "Bank export refuses to generate an incomplete file when confidential payments exist");

console.log(JSON.stringify({
  baseUrl,employerId,
  summary:{checks:checks.length,visibleEmployees:visibleEmployees.length,visibleGross:analysis.totals.grossPay},
  checks,
},null,2));
