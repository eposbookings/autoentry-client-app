import assert from "node:assert/strict";
import { payrollFrequencyRule, scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const taxYear="2026/27";
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"20260730-a";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const email="qa-live@payflow.local";
const password="PayFlow-Live-QA-2026!";
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
  if(!expected.includes(response.status))throw new Error(
    `${method} ${path} returned ${response.status}; expected ${expected.join("/")}. ${typeof body==="string"?body:JSON.stringify(body)}`,
  );
  return {status:response.status,body,headers:response.headers,text};
}

async function authenticate(){
  const login=await request("/api/admin/session",{
    method:"POST",captureCookie:true,
    json:{action:"login",employerId:bootstrapEmployerId,email,password},
  });
  check(login.body.authenticated===true,"Owner authentication established a multi-frequency QA session");
}

async function createEmployer(frequency,firstPayDate){
  const name=`${frequency} Payroll QA ${runId}`;
  const session=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body;
  const existing=session.memberships?.find(item=>item.employerName===name);
  if(existing)return existing.employerId;
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear,payFrequency:frequency,firstPayDate,
    payeReference:frequency==="fortnightly"?"470/FN2026":"480/FW2026",
    accountsOfficeReference:frequency==="fortnightly"?"470PF12345678":"480PF12345678",
  }});
  check(created.body.role==="owner",`${payrollFrequencyRule(frequency).label} employer was created with owner access`);
  return created.body.employer.id;
}

async function enableEmploymentAllowance(employerId,frequency){
  const current=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
  if(current.employmentAllowance)return;
  const updated=await request("/api/employer",{method:"PUT",json:{...current,employerId,employmentAllowance:true}});
  check(updated.body.employer.employmentAllowance===true,`${frequency} employer enabled Employment Allowance for EPS acceptance testing`);
}

async function createEmployees(employerId,frequency){
  const existing=(await request(`/api/employees?employerId=${employerId}`)).body;
  const rows=[
    {firstName:"Freya",lastName:"Standard",taxCode:"1257L",annualSalary:39000,starterEvidence:"No P45 provided",starterDeclaration:"Statement A"},
    {firstName:"Brendan",lastName:"Second Job",taxCode:"BR",week1Month1:true,annualSalary:52000,starterEvidence:"Secondary employment",starterDeclaration:"Statement C"},
    {firstName:"Sonia",lastName:"Student",taxCode:"1257L",week1Month1:true,studentLoanPlan:"2",postgraduateLoan:true,annualSalary:65000,starterEvidence:"Worked elsewhere this tax year",starterDeclaration:"Statement B"},
    {firstName:"Drew",lastName:"Director",taxCode:"1257L",director:true,alternativeDirectorNic:true,directorStart:"2026-04-06",annualSalary:78000,starterEvidence:"P45 provided",starterDeclaration:"Statement A",p45LeavingDate:"2026-04-06",p45PreviousPay:0,p45PreviousTax:0},
  ];
  for(let index=0;index<rows.length;index++){
    const row=rows[index];
    const payrollId=`${frequency==="fortnightly"?"FN":"FW"}-${runId}-${index+1}`;
    if(existing.some(employee=>employee.payrollId===payrollId))continue;
    const created=await request("/api/employees",{method:"POST",expected:[201],json:{
      employerId,firstName:row.firstName,lastName:row.lastName,
      payrollId,
      email:`${frequency}-${runId}-${index+1}@example.test`,
      niNumber:`BB${String(200001+index).padStart(6,"0")}B`,
      dateOfBirth:index===3?"1980-06-12":"1991-02-14",gender:index%2?"M":"F",
      address:"1 Frequency Way, London",postcode:"SW1A 1AA",
      startDate:"2026-04-06",taxCode:row.taxCode,week1Month1:Boolean(row.week1Month1),niCategory:"A",
      studentLoanPlan:row.studentLoanPlan,postgraduateLoan:Boolean(row.postgraduateLoan),
      annualSalary:row.annualSalary,payBasis:"period",hourlyRate:15,contractedHours:37.5,
      workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
      starterEvidence:row.starterEvidence,starterDeclaration:row.starterDeclaration,
      p45LeavingDate:row.p45LeavingDate,p45PreviousPay:row.p45PreviousPay,p45PreviousTax:row.p45PreviousTax,
      director:Boolean(row.director),alternativeDirectorNic:Boolean(row.alternativeDirectorNic),directorStart:row.directorStart,
      employeePortal:false,portalCanEditBank:false,reportedPayFrequency:frequency,
    }});
    check(created.body.reportedPayFrequency===frequency,`${created.body.payrollId} retained ${frequency} RTI frequency`);
  }
  return (await request(`/api/employees?employerId=${employerId}`)).body;
}

function payrollRecords(employees,frequency,periodNumber){
  const divisor=payrollFrequencyRule(frequency).periodsPerYear;
  return employees.map(employee=>{
    const gross=Math.round(Number(employee.annualSalary)/divisor*100)/100;
    return {
      employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
      grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
      studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
      noSecondaryNic:employee.noSecondaryNic,directorMethod:employee.alternativeDirectorNic?"alternative":"annual",
      annualSalary:employee.annualSalary,contractedHours:employee.contractedHours,
      items:[{type:"earning",name:`${payrollFrequencyRule(frequency).label} contractual pay`,quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
      finalDirectorPeriod:false,periodNumber,
    };
  });
}

async function verifyAndRestore(employerId,frequency,expectedRuns){
  const backup=(await request(`/api/data?employerId=${employerId}`)).body;
  check(backup.counts.payRuns===expectedRuns,`${frequency} backup contains every finalised employee run`);
  const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
  check(verified.body.verified===true,`${frequency} backup passes relationship and payroll-state verification`);
  const analysed=await request("/api/data",{method:"POST",json:{action:"analyse-restore",employerId,backup}});
  const restored=await request("/api/data",{method:"POST",json:{
    action:"restore-backup",employerId,backup,confirmation:analysed.body.confirmationPhrase,currentFingerprint:analysed.body.currentFingerprint,
  }});
  check(restored.body.restored===true&&restored.body.administratorAccessPreserved===true,`${frequency} backup restores atomically without losing owner access`);
  const post=(await request(`/api/data?employerId=${employerId}`)).body;
  const postVerified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup:post}});
  check(postVerified.body.verified===true&&post.counts.payRuns===expectedRuns,`${frequency} restored state generates a valid replacement backup`);
}

async function runFrequency(frequency,firstPayDate){
  const employerId=await createEmployer(frequency,firstPayDate);
  await enableEmploymentAllowance(employerId,frequency);
  const employees=await createEmployees(employerId,frequency);
  check(employees.length===4,`${frequency} employer has four statutory onboarding variations`);
  const schedule=scheduledPayPeriods(taxYear,frequency,firstPayDate);
  const secondMonthPeriods=schedule.filter(period=>period.taxMonth<=2);
  const periodsToRun=secondMonthPeriods.at(-1).periodNumber;
  check(periodsToRun>0,`${frequency} schedule exposes complete HMRC tax months one and two`);

  const future=schedule[1];
  const premature=await request("/api/pay-runs",{method:"POST",expected:[409],json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber:future.periodNumber,payDate:future.payDate,
    employees:payrollRecords(employees,frequency,future.periodNumber),
  }});
  check(/Period 1 must be completed/.test(premature.body.error),`${frequency} payroll prevents period-order gaps`);

  for(const period of schedule.slice(0,periodsToRun)){
    const records=payrollRecords(employees,frequency,period.periodNumber);
    const draft=await request("/api/pay-runs",{method:"POST",json:{
      action:"draft",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:records,
    }});
    check(draft.body.calculated.length===employees.length,`${frequency} period ${period.periodNumber} preview calculated all employees`);
    const finalised=await request("/api/pay-runs",{method:"POST",json:{
      action:"finalise",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:records,
    }});
    check(finalised.body.status==="finalised",`${frequency} period ${period.periodNumber} finalised`);
  }

  for(const period of schedule.slice(0,periodsToRun)){
    const fps=await request("/api/submissions",{method:"POST",expected:[201],json:{
      employerId,type:"FPS",taxYear,periodNumber:period.periodNumber,finalSubmission:false,
    }});
    check(fps.body.submission.status==="validated",`${frequency} period ${period.periodNumber} FPS reconciles`);
  }
  for(const taxMonth of [1,2]){
    const eps=await request("/api/submissions",{method:"POST",expected:[201],json:{
      employerId,type:"EPS",taxYear,periodNumber:taxMonth,employmentAllowance:true,
    }});
    check(eps.body.submission.status==="validated",`${frequency} tax month ${taxMonth} EPS reconciles`);
  }

  const liabilities=(await request(`/api/hmrc-liabilities?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  for(const taxMonth of [1,2]){
    const expected=schedule.filter(period=>period.taxMonth===taxMonth).map(period=>period.periodNumber);
    const actual=liabilities.periods.find(period=>period.periodNumber===taxMonth).payrollPeriods;
    check(JSON.stringify(actual)===JSON.stringify(expected),`${frequency} HMRC month ${taxMonth} contains the scheduled payroll periods`,{expected,actual});
  }
  const payment=await request("/api/hmrc-payments",{method:"POST",expected:[201],json:{
    employerId,taxYear,taxMonth:1,paymentDate:"2026-05-22",kind:"payment",category:"paye-payment",
    amount:100,reference:`${frequency}-${runId}-HMRC`,method:"bank-transfer",
  }});
  check(payment.body.status==="recorded",`${frequency} completed tax month accepts an HMRC payment`);
  const incomplete=await request("/api/hmrc-payments",{method:"POST",expected:[409],json:{
    employerId,taxYear,taxMonth:3,paymentDate:"2026-07-22",kind:"payment",category:"paye-payment",
    amount:100,reference:`${frequency}-${runId}-EARLY`,method:"bank-transfer",
  }});
  check(incomplete.body.requiredPayrollPeriods?.length>0,`${frequency} incomplete tax month rejects an HMRC payment`);

  const p11=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p11`)).body;
  const p30=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p30`)).body;
  check(p11.rows.length===employees.length*periodsToRun,`${frequency} P11 retains every employee-period row`);
  check(p30.rows[0][1].split(",").length===schedule.filter(period=>period.taxMonth===1).length,`${frequency} P30 lists each first-month pay date`);

  await verifyAndRestore(employerId,frequency,employees.length*periodsToRun);
  return {employerId,employees:employees.length,periods:periodsToRun};
}

await authenticate();
const fortnightly=await runFrequency("fortnightly","2026-04-17");
const fourWeekly=await runFrequency("four-weekly","2026-05-01");

console.log(JSON.stringify({
  baseUrl,runId,summary:{checks:checks.length,fortnightly,fourWeekly},checks,
},null,2));
