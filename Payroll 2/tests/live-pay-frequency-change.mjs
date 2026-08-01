import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";
import { calculateAttachment } from "../lib/attachment-engine.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
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
  if(captureCookie){const value=response.headers.get("set-cookie");if(value)cookie=value.split(";")[0];}
  const text=await response.text();let body=text;
  if((response.headers.get("content-type")||"").includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for frequency-change testing");

const name=`Frequency Change QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===name)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"495/FC2026",accountsOfficeReference:"495PF12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated monthly employer is available",{employerId});

let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
if(!employees.length){
  const employee=await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,firstName:"Fiona",lastName:"Frequency",payrollId:`FC-${runId}-1`,email:`frequency-${runId}@example.test`,
    niNumber:"CC200001C",dateOfBirth:"1990-02-14",gender:"F",address:"1 Schedule Way, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:36000,payBasis:"period",
    hourlyRate:18,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
    starterEvidence:"No P45 provided",starterDeclaration:"Statement A",employeePortal:false,portalCanEditBank:false,
    reportedPayFrequency:"monthly",
  }});
  employees=[employee.body];
}
const employee=employees[0];

let orders=(await request(`/api/attachments?employerId=${employerId}`)).body.orders;
if(!orders.length){
  const order=await request("/api/attachments",{method:"POST",expected:[201],json:{
    employerId,payrollId:employee.payrollId,type:"Scottish earnings arrestment",issuingAuthority:"Sheriff officer",
    reference:`FC-${runId}`,protectedEarnings:0,deductionType:"fixed",deductionValue:0,
    calculationRule:"scottish-earnings-arrestment",payFrequency:"monthly",priority:10,arrears:0,effectiveDate:"2026-04-06",
    adminFee:1,balance:500,
  }});
  orders=[order.body];
}
check(orders[0].payFrequency==="monthly","Active attachment begins on the monthly schedule");

const monthly=scheduledPayPeriods(taxYear,"monthly")[0],gross=3000;
const record={
  employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
  grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
  studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
  noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:36000,contractedHours:37.5,
  items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
  finalDirectorPeriod:false,periodNumber:1,
};
await request("/api/pay-runs",{method:"POST",json:{
  action:"draft",source:"manual",employerId,taxYear,periodNumber:1,payDate:monthly.payDate,employees:[record],
}});
await request("/api/adjustments",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,payrollId:employee.payrollId,type:"paye-tax",amount:5,
  reason:"Frequency migration draft adjustment",
}});
check(true,"Monthly draft pay run and manual adjustment were created");

const preview=(await request("/api/pay-frequency",{method:"POST",json:{
  action:"preview",employerId,targetFrequency:"weekly",firstPayDate:"2026-04-10",
}})).body;
check(preview.allowed===true&&preview.discardedDraftPeriods===1&&preview.discardedDraftRuns===1&&preview.discardedAdjustments===1,
  "Preview identifies every disposable draft record",preview);
check(preview.updatedActiveAttachments===1&&preview.periodCount===52,
  "Preview aligns the active attachment and exposes the new 52-payday schedule");

await request("/api/pay-frequency",{method:"POST",expected:[422],json:{
  action:"apply",employerId,targetFrequency:"weekly",firstPayDate:"2026-04-10",
  fingerprint:preview.fingerprint,confirmation:"CHANGE",
}});
check(true,"Incorrect confirmation phrase cannot apply a schedule change");
const applied=(await request("/api/pay-frequency",{method:"POST",json:{
  action:"apply",employerId,targetFrequency:"weekly",firstPayDate:"2026-04-10",
  fingerprint:preview.fingerprint,confirmation:preview.confirmationPhrase,
}})).body;
check(applied.applied===true&&applied.targetFrequency==="weekly","Source-bound frequency change applied");

const [employerAfter,employeesAfter,attachmentsAfter,payrollAfter,adjustmentsAfter]=await Promise.all([
  request(`/api/employer?employerId=${employerId}`),
  request(`/api/employees?employerId=${employerId}`),
  request(`/api/attachments?employerId=${employerId}`),
  request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),
  request(`/api/adjustments?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),
]);
check(employerAfter.body.employer.payFrequency==="weekly"&&employerAfter.body.employer.firstPayDate==="2026-04-10",
  "Employer now uses the requested weekly anchor");
check(employeesAfter.body.every(item=>item.reportedPayFrequency==="weekly"),
  "Every employee RTI frequency was aligned");
check(attachmentsAfter.body.orders.find(item=>item.id===orders[0].id)?.payFrequency==="weekly",
  "Active attachment order was aligned to weekly calculation");
check(payrollAfter.body.periods.length===0&&payrollAfter.body.runs.length===0&&adjustmentsAfter.body.length===0,
  "Only unfinalised payroll drafts and their adjustments were discarded");

const weeklySchedule=scheduledPayPeriods(taxYear,"weekly","2026-04-10"),weekly=weeklySchedule[0],weeklyGross=Math.round(36000/52*100)/100;
const weeklyRecord={...record,grossPay:weeklyGross,annualSalary:36000,
  items:[{type:"earning",name:"Weekly contractual pay",quantity:1,rate:weeklyGross,amount:weeklyGross,taxable:true,nicable:true,pensionable:true}]};
await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:weekly.payDate,employees:[weeklyRecord],
}});
const weeklyAttachment=(await request(`/api/attachments?employerId=${employerId}`)).body;
const weeklyDeduction=weeklyAttachment.history.find(item=>item.attachmentOrderId===orders[0].id);
const expectedWeeklyDeduction=calculateAttachment({
  netPay:weeklyDeduction?.attachableNetPay,type:"Scottish earnings arrestment",deductionType:"fixed",
  deductionValue:0,calculationRule:"scottish-earnings-arrestment",payFrequency:"weekly",
  balance:500,adminFee:1,
});
check(weeklyDeduction?.deduction===expectedWeeklyDeduction.deduction&&weeklyDeduction?.deduction>0&&weeklyDeduction?.adminFee===1,
  "Weekly Scottish statutory table produced and persisted the expected deduction",weeklyDeduction);
const voucherPeriod=weeklySchedule[1],voucherItems=[
  weeklyRecord.items[0],
  {type:"childcare-voucher",name:"Legacy childcare voucher salary sacrifice · basic",quantity:1,rate:70,amount:70,taxable:false,nicable:false,pensionable:true},
];
const missingVoucherExcess=await request("/api/pay-runs",{method:"POST",expected:[422],json:{
  action:"draft",source:"manual",employerId,taxYear,periodNumber:2,payDate:voucherPeriod.payDate,
  employees:[{...weeklyRecord,periodNumber:2,items:voucherItems}],
}});
check(/Class 1 excess must be 15\.00/.test(missingVoucherExcess.body.error),
  "Weekly voucher above £55 cannot omit its Class 1 excess");
const wrongVoucherExcess=await request("/api/pay-runs",{method:"POST",expected:[422],json:{
  action:"draft",source:"manual",employerId,taxYear,periodNumber:2,payDate:voucherPeriod.payDate,
  employees:[{...weeklyRecord,periodNumber:2,items:[...voucherItems,
    {type:"benefit",name:"Childcare voucher excess · Class 1 NIC and P11D",quantity:1,rate:14,amount:14,taxable:false,nicable:true,pensionable:false},
  ]}],
}});
check(/Class 1 excess must be 15\.00/.test(wrongVoucherExcess.body.error),
  "Weekly voucher cannot understate its Class 1 excess");
await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:2,payDate:voucherPeriod.payDate,
  employees:[{...weeklyRecord,periodNumber:2,items:[...voucherItems,
    {type:"benefit",name:"Childcare voucher excess · Class 1 NIC and P11D",quantity:1,rate:15,amount:15,taxable:false,nicable:true,pensionable:false},
  ]}],
}});
const voucherPayroll=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
const voucherRun=voucherPayroll.runs.find(item=>item.payPeriodId===voucherPayroll.periods.find(period=>period.periodNumber===2).id);
const voucherRunItems=voucherPayroll.items.filter(item=>item.payRunId===voucherRun.id);
check(voucherRunItems.some(item=>item.type==="childcare-voucher"&&item.amount===70)&&
  voucherRunItems.some(item=>item.name==="Childcare voucher excess · Class 1 NIC and P11D"&&item.amount===15),
  "Weekly voucher and its exact Class 1 excess persisted in finalised payroll");
const blocked=(await request("/api/pay-frequency",{method:"POST",json:{
  action:"preview",employerId,targetFrequency:"monthly",firstPayDate:"",
}})).body;
check(blocked.allowed===false&&blocked.blockers.some(item=>item.includes("Finalised or migrated")),
  "Finalised payroll blocks any later frequency rewrite",blocked);
await request("/api/pay-frequency",{method:"POST",expected:[409],json:{
  action:"apply",employerId,targetFrequency:"monthly",firstPayDate:"",
  fingerprint:blocked.fingerprint,confirmation:blocked.confirmationPhrase,
}});
check(true,"Blocked frequency plan cannot be forced through the apply endpoint");

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length},checks},null,2));
