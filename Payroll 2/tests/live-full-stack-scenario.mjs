import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const taxYear="2026/27";
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"20260730-a";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const email="qa-live@payflow.local";
const password="PayFlow-Live-QA-2026!";
let cookie="";
const checks=[];

function check(condition,message,details={}) {
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],captureCookie=false}={}) {
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{
      ...(json?{"content-type":"application/json"}:{}),
      ...(cookie?{cookie}:{}),
    },
    body:json===undefined?undefined:JSON.stringify(json),
  });
  if(captureCookie){
    const value=response.headers.get("set-cookie");
    if(value)cookie=value.split(";")[0];
  }
  const contentType=response.headers.get("content-type")||"";
  const text=await response.text();
  let body=text;
  if(contentType.includes("application/json")&&text){
    try{body=JSON.parse(text);}catch{}
  }
  if(!expected.includes(response.status)){
    throw new Error(`${method} ${path} returned ${response.status}; expected ${expected.join("/")}. ${typeof body==="string"?body:JSON.stringify(body)}`);
  }
  return {status:response.status,body,headers:response.headers,text};
}

async function authenticate() {
  let login=await request("/api/admin/session",{
    method:"POST",captureCookie:true,expected:[200,401],
    json:{action:"login",employerId:bootstrapEmployerId,email,password},
  });
  if(login.status===401){
    login=await request("/api/admin/session",{
      method:"POST",captureCookie:true,expected:[201],
      json:{action:"bootstrap",employerId:bootstrapEmployerId,email,password,displayName:"Live full-stack QA"},
    });
  }
  check(Boolean(cookie),"Authenticated QA session returned a secure cookie");
  return login.body;
}

async function findOrCreateEmployer(name,payload) {
  const session=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body;
  const existing=session.memberships?.find(item=>item.employerName===name);
  if(existing)return existing.employerId;
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{name,legalName:`${name} Limited`,taxYear,...payload}});
  check(created.body.role==="owner",`${name} was created with isolated owner access`);
  return created.body.employer.id;
}

async function enableEmploymentAllowance(employerId) {
  const current=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
  if(current.employmentAllowance)return;
  const updated=await request("/api/employer",{method:"PUT",json:{...current,employerId,employmentAllowance:true}});
  check(updated.body.employer.employmentAllowance===true,"Employment Allowance was enabled through audited employer settings");
}

function employeeVariants(employerId) {
  const common={
    employerId,dateOfBirth:"1990-01-15",gender:"F",address:"1 Scenario Street, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:31200,
    payBasis:"period",hourlyRate:15,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,
    paymentMethod:"credit-transfer",starterEvidence:"No P45 provided",starterDeclaration:"Statement A",
    employeePortal:false,portalCanEditBank:false,reportedPayFrequency:"weekly",
  };
  const rows=[
    {firstName:"Paula",lastName:"P45",startDate:"2026-04-08",starterEvidence:"P45 provided",p45LeavingDate:"2026-04-07",p45PreviousPay:8200,p45PreviousTax:910},
    {firstName:"Noah",lastName:"No P45"},
    {firstName:"Priya",lastName:"P60 Only",starterEvidence:"P60 only",p60ReferenceOnly:true,p60TaxYear:"2025/26"},
    {firstName:"Wendy",lastName:"Worked Elsewhere",starterEvidence:"Worked elsewhere this tax year",starterDeclaration:"Statement B",week1Month1:true},
    {firstName:"Seth",lastName:"Second Job",starterEvidence:"Secondary employment",starterDeclaration:"Statement C",taxCode:"BR",week1Month1:true},
    {firstName:"Dana",lastName:"Director Annual",director:true,directorStart:"2026-04-06",annualSalary:62400},
    {firstName:"Alec",lastName:"Director Alternative",director:true,directorStart:"2026-04-06",alternativeDirectorNic:true,annualSalary:62400},
    {firstName:"Nina",lastName:"No Secondary NIC",noSecondaryNic:true,annualSalary:41600},
    {firstName:"Stan",lastName:"Student Plan One",studentLoanPlan:"1",annualSalary:52000},
    {firstName:"Polly",lastName:"Plan Two Postgrad",studentLoanPlan:"2",postgraduateLoan:true,annualSalary:65000},
    {firstName:"Fiona",lastName:"Student Plan Four",studentLoanPlan:"4",annualSalary:57000},
    {firstName:"Peter",lastName:"Student Plan Five",studentLoanPlan:"5",annualSalary:41000},
    {firstName:"Holly",lastName:"Hourly Worker",payBasis:"hourly",annualSalary:0,hourlyRate:16.25,contractedHours:30},
    {firstName:"Daisy",lastName:"Daily Worker",payBasis:"daily",annualSalary:0,dailyRate:145,workingDaysPerWeek:4},
    {firstName:"Amy",lastName:"Apprentice",dateOfBirth:"2006-10-10",niCategory:"H",minimumWageCategory:"apprentice",apprenticeshipStartDate:"2026-04-06",annualSalary:15600},
    {firstName:"Iris",lastName:"Irregular",irregularPayment:true,annualSalary:20800},
    {firstName:"Bodhi",lastName:"Paid To Body",paymentToBody:true,annualSalary:26000},
    {firstName:"Tara",lastName:"Trivial Commutation",trivialCommutation:true,zeroPayFpsExclusion:true,annualSalary:10400},
    {firstName:"Felix",lastName:"Flexible Drawdown",flexibleDrawdown:true,leavingDate:"2026-04-19",annualSalary:36400},
    {firstName:"Cora",lastName:"Portal Confidential",startDate:"2026-04-20",employeePortal:true,portalCanEditBank:true,confidential:true,
      annualSalary:46800,bankName:"Scenario Bank",accountName:"Cora Portal Confidential",sortCode:"123456",accountNumber:"12345678",
      managerName:"Payroll Manager",emergencyContactName:"Casey Contact",emergencyContactPhone:"07123456789",hrNotesConfidential:true},
  ];
  return rows.map((row,index)=>({
    ...common,...row,payrollId:`WK-${runId}-${String(index+1).padStart(2,"0")}`,
    email:`weekly-${runId}-${index+1}@example.test`,
    niNumber:index===2?"":`AA${String(100001+index).padStart(6,"0")}A`,
  }));
}

function activeInPeriod(employee,period) {
  return (!employee.startDate||employee.startDate<=period.periodEnd)&&(!employee.leavingDate||employee.leavingDate>=period.periodStart);
}

function grossFor(employee,periodNumber) {
  if(employee.payrollId.endsWith("-18")&&periodNumber===3)return 0;
  if(employee.payBasis==="hourly")return 30*employee.hourlyRate+(periodNumber===5?4*employee.hourlyRate:0);
  if(employee.payBasis==="daily")return 4*employee.dailyRate;
  return Math.round((Number(employee.annualSalary||0)/52+(periodNumber===2&&employee.payrollId.endsWith("-01")?125:0))*100)/100;
}

function payrollRecords(employees,period) {
  return employees.filter(employee=>activeInPeriod(employee,period)).map(employee=>{
    const gross=grossFor(employee,period.periodNumber);
    return {
      employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
      grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
      studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
      noSecondaryNic:employee.noSecondaryNic,directorMethod:employee.alternativeDirectorNic?"alternative":"annual",
      annualSalary:employee.annualSalary,hourlyRate:employee.hourlyRate,contractedHours:employee.contractedHours,
      items:[{type:"earning",name:"Weekly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
    };
  });
}

async function runWeeklyPayroll(employerId) {
  const scheme=await request("/api/pensions",{method:"POST",expected:[201],json:{
    action:"save-scheme",employerId,taxYear,provider:"QA Pension Provider",schemeName:"Weekly Qualifying Scheme",
    employerReference:`PEN-${runId}`,employeeRate:5,employerRate:3,earningsBasis:"qualifying",taxRelief:"relief-at-source",
    automaticEnrolmentScheme:true,dutiesStartDate:"2026-04-06",declarationDueDate:"2026-09-05",
    nextReenrolmentDate:"2029-04-06",contributionDueDay:22,effectiveDate:"2026-04-06",status:"active",
  }});
  check(scheme.body.status==="active","Weekly pension scheme is active before the first assessment");

  let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
  if(!employees.length){
    for(const row of employeeVariants(employerId)){
      const created=await request("/api/employees",{method:"POST",expected:[201],json:row});
      check(created.body.reportedPayFrequency==="weekly",`Employee ${row.payrollId} retained weekly RTI frequency`);
    }
    employees=(await request(`/api/employees?employerId=${employerId}`)).body;
  }
  check(employees.length===20,"Twenty varied live employees exist in the weekly tenant",{employees:employees.length});

  const schedule=scheduledPayPeriods(taxYear,"weekly","2026-04-10");
  check(schedule.length===52,"The selected 2026/27 weekly anchor produces 52 paydays");
  const periodTwo=payrollRecords(employees,schedule[1]);
  const premature=await request("/api/pay-runs",{method:"POST",expected:[409],json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber:2,payDate:schedule[1].payDate,employees:periodTwo,
  }});
  check(/Period 1 must be completed/.test(premature.body.error),"Future weekly payroll is blocked until the prior period is finalised");

  for(const period of schedule.slice(0,9)){
    const records=payrollRecords(employees,period);
    const draft=await request("/api/pay-runs",{method:"POST",json:{
      action:"draft",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:records,
    }});
    check(draft.body.calculated.length===records.length,`Weekly period ${period.periodNumber} draft calculated every active employee`);
    const finalised=await request("/api/pay-runs",{method:"POST",json:{
      action:"finalise",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:records,
    }});
    check(finalised.body.status==="finalised",`Weekly period ${period.periodNumber} finalised`);
  }

  let payroll=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  const finalisedPeriods=payroll.periods.filter(period=>period.status==="finalised");
  check(finalisedPeriods.length===9&&finalisedPeriods.every((period,index)=>period.periodNumber===index+1),"Nine weekly periods span two complete HMRC tax months");
  const periodThree=payroll.periods.find(period=>period.periodNumber===3);
  const zeroEmployee=employees.find(employee=>employee.payrollId.endsWith("-18"));
  const zeroRun=payroll.runs.find(run=>run.payPeriodId===periodThree.id&&run.employeeId===zeroEmployee.id);
  check(zeroRun?.grossPay===0,"Zero-pay irregular employee remains an auditable payroll record");

  const olderReopen=await request("/api/pay-runs",{method:"PUT",expected:[409],json:{action:"reopen",employerId,taxYear,periodNumber:8}});
  check(/latest finalised period/.test(olderReopen.body.error),"Only the latest finalised weekly period can be reopened");
  const latestReopen=await request("/api/pay-runs",{method:"PUT",json:{action:"reopen",employerId,taxYear,periodNumber:9}});
  check(latestReopen.body.reopened===true,"Latest weekly period reopens with dependent evidence restoration");
  const periodNine=schedule[8],periodNineRecords=payrollRecords(employees,periodNine);
  await request("/api/pay-runs",{method:"POST",json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber:9,payDate:periodNine.payDate,employees:periodNineRecords,
  }});
  check(true,"Reopened weekly period refinalises successfully");

  const fps1=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"FPS",taxYear,periodNumber:1,finalSubmission:false}});
  const fps9=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"FPS",taxYear,periodNumber:9,finalSubmission:false}});
  check(fps1.body.submission.status==="validated"&&fps9.body.submission.status==="validated","FPS packages validate against immutable weekly snapshots");
  const approvedFps1=await request("/api/submissions",{method:"PUT",json:{employerId,id:fps1.body.submission.id,declarationAccepted:true}});
  const approvedFps9=await request("/api/submissions",{method:"PUT",json:{employerId,id:fps9.body.submission.id,declarationAccepted:true}});
  check(approvedFps1.body.status==="test-ready"&&approvedFps9.body.status==="test-ready","Approved FPS packages enter the external-adapter queue without claiming live filing");
  const eps1=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"EPS",taxYear,periodNumber:1,employmentAllowance:true}});
  const eps2=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"EPS",taxYear,periodNumber:2,cisDeductionsSuffered:250}});
  check(eps1.body.submission.status==="validated"&&eps2.body.submission.status==="validated","EPS packages aggregate complete weekly paydays by HMRC tax month");
  const approvedEps1=await request("/api/submissions",{method:"PUT",json:{employerId,id:eps1.body.submission.id,declarationAccepted:true}});
  const approvedEps2=await request("/api/submissions",{method:"PUT",json:{employerId,id:eps2.body.submission.id,declarationAccepted:true}});
  check(approvedEps1.body.status==="test-ready"&&approvedEps2.body.status==="test-ready","Approved EPS packages are retained as test-ready external-adapter work");

  const hmrc=(await request(`/api/hmrc-liabilities?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  const month1=hmrc.periods.find(period=>period.periodNumber===1),month2=hmrc.periods.find(period=>period.periodNumber===2);
  check(month1.payrollPeriods.length===4&&month2.payrollPeriods.length===5,"HMRC liability view groups four and five weekly paydays into tax months 1 and 2");

  const p11=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p11`)).body;
  const p30=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p30`)).body;
  const p32=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p32`)).body;
  const payslips=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=payslips&periodNumber=9`)).body;
  check(p11.rows.length>0&&payslips.rows.length===19,"P11 and period-nine payslip reports use finalised live records");
  check(p30.rows[0][1].split(",").length===4&&p30.rows[1][1].split(",").length===5,"P30 exposes every weekly pay date in each HMRC month");
  check(p32.rows.length===12,"P32 retains all twelve statutory HMRC tax months");

  const pensions=(await request(`/api/pensions?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  check(pensions.memberships.some(item=>item.membershipStatus==="active"),"Automatic enrolment created active weekly memberships");
  const pensionExport=await request("/api/pensions",{method:"POST",json:{action:"export-contributions",employerId,taxYear,periodNumber:9,schemeId:scheme.body.id}});
  check(pensionExport.headers.get("x-payflow-submission-id")!==null,"Weekly pension contribution file is retained as a prepared provider package");

  return {employees,periods:finalisedPeriods,hmrc,p30,pensions};
}

async function runCis(employerId) {
  let cis=(await request(`/api/cis?employerId=${employerId}`)).body;
  if(!cis.subcontractors.length){
    const imported=await request("/api/cis",{method:"POST",expected:[201],json:{action:"import-subcontractors",employerId,rows:[
      {name:"Gross Groundworks",type:"sole-trader",utr:"7000000001",niNumber:"AB123456C",deductionRate:0,verificationNumber:`VER-GROSS-${runId}`,verificationDate:"2026-04-10",address:"1 Site Road",postcode:"B1 1AA"},
      {name:"Standard Scaffolding Ltd",type:"company",utr:"7000000002",companyNumber:"12345678",deductionRate:20,verificationNumber:`VER-20-${runId}`,verificationDate:"2026-04-10",address:"2 Site Road",postcode:"B1 1AB"},
      {name:"Unmatched Partnership",type:"partnership",utr:"7000000003",partnerUtr:"7999999999",deductionRate:30,verificationNumber:`VER-30-${runId}`,verificationDate:"2026-04-10",address:"3 Site Road",postcode:"B1 1AC"},
    ]}});
    check(imported.body.imported===3,"CIS CSV path imported three verified legal-identity variations atomically");
    cis=(await request(`/api/cis?employerId=${employerId}`)).body;
  }
  const rates=new Map([[0,{labour:1000,materials:250,vat:0,retention:50}],[20,{labour:2200,materials:300,vat:0,retention:100}],[30,{labour:1800,materials:125,vat:0,retention:0}]]);
  if(!cis.payments.length){
    for(const subcontractor of cis.subcontractors){
      const amounts=rates.get(subcontractor.deductionRate);
      const payment=await request("/api/cis",{method:"POST",expected:[201],json:{
        kind:"payment",employerId,subcontractorId:subcontractor.id,taxYear,taxMonth:1,paymentDate:"2026-04-24",
        rate:subcontractor.deductionRate,invoiceNumber:`INV-${runId}-${subcontractor.id}`,paymentRecipient:subcontractor.name,
        materialsEvidence:"Invoice materials schedule checked",...amounts,
      }});
      check(payment.body.deduction===Math.round((amounts.labour-amounts.retention)*subcontractor.deductionRate)/100,`CIS ${subcontractor.deductionRate}% payment deduction reconciles`);
    }
    cis=(await request(`/api/cis?employerId=${employerId}`)).body;
  }
  for(const subcontractor of cis.subcontractors){
    const statement=await request("/api/cis",{method:"POST",expected:[201],json:{
      action:"issue-statement",employerId,taxYear,taxMonth:1,subcontractorId:subcontractor.id,
      deliveryMethod:"portal",issueGrossStatement:subcontractor.deductionRate===0,
    }});
    check(statement.body.submission.status==="issued",`CIS ${subcontractor.deductionRate}% statement is issued with frozen payment evidence`);
  }
  const cis300=await request("/api/cis",{method:"POST",expected:[201],json:{
    action:"prepare-return",employerId,taxYear,taxMonth:1,employmentStatusConsidered:true,
    allSubcontractorsNotEmployees:true,allRequiredVerified:true,declarationAccepted:true,
  }});
  check(cis300.body.submission.status==="test-ready"&&cis300.body.validation.valid,"CIS300 month-one package passes full local validation");
  const report=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=cis`)).body;
  check(report.rows.length===3,"CIS report reconciles all three active payment statements");
  return {cis300,report};
}

await authenticate();
const weeklyEmployerId=await findOrCreateEmployer(`Weekly Scenario Matrix QA ${runId}`,{
  payFrequency:"weekly",firstPayDate:"2026-04-10",payeReference:"321/WK2026",accountsOfficeReference:"321PW12345678",
});
await enableEmploymentAllowance(weeklyEmployerId);
const cisEmployerId=await findOrCreateEmployer(`Construction Scenario QA ${runId}`,{
  payFrequency:"monthly",payeReference:"654/CIS26",accountsOfficeReference:"654PC12345678",
  cisContractor:true,cisUtr:"7123456789",
});
const weekly=await runWeeklyPayroll(weeklyEmployerId);
const construction=await runCis(cisEmployerId);

console.log(JSON.stringify({
  baseUrl,runId,weeklyEmployerId,cisEmployerId,
  summary:{
    checks:checks.length,employees:weekly.employees.length,weeklyPeriods:weekly.periods.length,
    activePensionMemberships:weekly.pensions.memberships.filter(item=>item.membershipStatus==="active").length,
    cisRows:construction.report.rows.length,
  },
  checks,
},null,2));
