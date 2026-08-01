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
check(Boolean(cookie),"Owner authenticated for mid-year migration testing");

const name=`Mid-year Opening QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===name)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"496/MY2026",accountsOfficeReference:"496PF12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated monthly migration employer is available",{employerId});

const payrollId=`MY-${runId}-1`;
let employee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.payrollId===payrollId);
if(!employee)employee=(await request("/api/employees",{method:"POST",expected:[201],json:{
  employerId,firstName:"Maya",lastName:"Migration",payrollId,email:`migration-${runId}@example.test`,
  niNumber:"AB200001C",dateOfBirth:"1988-08-12",gender:"F",address:"1 Migration Road, London",postcode:"SW1A 1AA",
  startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:48000,payBasis:"period",
  hourlyRate:23,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
  starterEvidence:"No P45 provided",starterDeclaration:"Statement A",employeePortal:false,portalCanEditBank:false,
  reportedPayFrequency:"monthly",
}})).body;
check(employee.payrollId===payrollId,"Migration employee was created with current-employment starter evidence");

const opening={
  employerId,taxYear,payrollId,firstPayFlowPeriod:5,
  grossPay:16000,taxablePay:16000,payeTax:2200,nicablePay:16000,
  earningsAtLel:492,earningsLelToPt:476,earningsPtToUel:15032,earningsAboveUel:0,
  employeeNic:780,employerNic:1320,studentLoan:180,postgraduateLoan:90,statutoryPay:500,
  employeePension:480,employerPension:320,netPay:11750,
  source:"prior-provider-export",notes:"Reconciled P11 export through payroll period 4.",
};
const invalidBands=await request("/api/opening-balances",{method:"POST",expected:[422],json:{
  ...opening,nicCategoryBreakdown:[{niCategory:"A",nicablePay:16000,earningsAtLel:1000,earningsLelToPt:1000,earningsPtToUel:15000,earningsAboveUel:0,employeeNic:780,employerNic:1320}],
}});
check(/bands cannot exceed/.test(invalidBands.body.error),"Opening balance rejects inconsistent NI band evidence");

const saved=await request("/api/opening-balances",{method:"POST",expected:[201],json:opening});
check(saved.body.payloadChecksum?.length===64,"Opening balance is stored with a SHA-256 evidence checksum");
const openingRows=(await request(`/api/opening-balances?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(openingRows.length===1&&openingRows[0].grossPay===16000&&JSON.parse(openingRows[0].nicCategoryBreakdown)[0].niCategory==="A",
  "Opening P11 and NI-category evidence round-trips");

const schedule=scheduledPayPeriods(taxYear,"monthly");
const gross=4000,record={
  employeeId:employee.id,payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
  grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
  studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
  noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:48000,contractedHours:37.5,
  items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
  finalDirectorPeriod:false,periodNumber:5,
};
const payrollBefore=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(payrollBefore.periods.filter(item=>item.status==="migrated").map(item=>item.periodNumber).join(",")==="1,2,3,4"&&
  payrollBefore.periods.find(item=>item.periodNumber===5)?.status==="open",
  "Periods 1 to 4 are imported history and Period 5 is the first open PayFlow period");
const migratedAttempt=await request("/api/pay-runs",{method:"POST",expected:[409],json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:schedule[0].payDate,employees:[{...record,periodNumber:1}],
}});
check(migratedAttempt.status===409&&typeof migratedAttempt.body.error==="string",
  "Imported payroll history cannot be recalculated in PayFlow",migratedAttempt.body);

const finalised=(await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:5,payDate:schedule[4].payDate,employees:[record],
}})).body;
const current=finalised.calculated[0].result;
check(finalised.status==="finalised"&&current.grossPay===4000,"First PayFlow payroll finalised in Period 5");

const fps=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"FPS",taxYear,periodNumber:5,finalSubmission:false,
}})).body;
const fpsEmployee=fps.payload.employees.find(item=>item.payrollId===payrollId);
check(fpsEmployee.ytd.grossPay===16000+current.grossPay&&fpsEmployee.ytd.taxablePay===16000+current.taxablePay&&
  fpsEmployee.ytd.payeTax===2200+current.incomeTax,
  "FPS year-to-date values combine immutable Period 5 payroll with imported P11 evidence",fpsEmployee.ytd);
check(fpsEmployee.ytd.niByCategory[0].niCategory==="A"&&fpsEmployee.ytd.niByCategory[0].nicablePay===16000+current.grossPay&&
  fpsEmployee.ytd.niByCategory[0].employeeNic===780+current.employeeNic,
  "FPS NI-category year-to-date values include imported category balances",{
    currentGrossPay:current.grossPay,niByCategory:fpsEmployee.ytd.niByCategory,
  });

const liabilities=(await request(`/api/hmrc-liabilities?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(liabilities.periods.slice(0,4).every(item=>item.status==="migrated"&&item.current.amountDue===0),
  "Prior-system periods do not invent PayFlow HMRC liabilities");
const month5=liabilities.periods.find(item=>item.periodNumber===5);
check(month5.payrollPeriods.join(",")==="5"&&month5.current.payeTax===current.incomeTax,
  "HMRC month 5 contains only the PayFlow payroll liability");

const lockedOpening=await request("/api/opening-balances",{method:"POST",expected:[409],json:{...opening,notes:"Attempted late rewrite"}});
check(/before any payroll run is saved/.test(lockedOpening.body.error),
  "Opening evidence is locked after payroll begins");

const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.counts.payrollOpeningBalances===1&&backup.counts.payRuns===1,
  "Employer backup retains both imported opening evidence and PayFlow payroll");
const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verified.body.verified===true,"Mid-year migration backup passes integrity and relationship validation");

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length},checks},null,2));
