import assert from "node:assert/strict";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const taxYear="2026/27";
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"20260730-compliance-a";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const ownerEmail="qa-live@payflow.local";
const ownerPassword="PayFlow-Live-QA-2026!";
let ownerCookie="";
let employeePortalCookie="";
let leaverPortalCookie="";
const checks=[];

function check(condition,message,details={}) {
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],cookie=ownerCookie,captureCookie=false}={}) {
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
    body:json===undefined?undefined:JSON.stringify(json),
  });
  const setCookie=response.headers.get("set-cookie");
  const contentType=response.headers.get("content-type")||"";
  const text=await response.text();
  let body=text;
  if(contentType.includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(
    `${method} ${path} returned ${response.status}; expected ${expected.join("/")}. ${typeof body==="string"?body:JSON.stringify(body)}`
  );
  return {status:response.status,body,text,headers:response.headers,cookie:captureCookie&&setCookie?setCookie.split(";")[0]:""};
}

async function authenticateOwner() {
  const login=await request("/api/admin/session",{
    method:"POST",captureCookie:true,expected:[200],
    cookie:"",json:{action:"login",employerId:bootstrapEmployerId,email:ownerEmail,password:ownerPassword},
  });
  ownerCookie=login.cookie;
  check(Boolean(ownerCookie),"Owner authentication established an isolated administrator session");
}

async function createEmployer() {
  const name=`Compliance Lifecycle QA ${runId}`;
  const session=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body;
  const existing=session.memberships?.find(item=>item.employerName===name);
  if(existing)return existing.employerId;
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"777/QA026",accountsOfficeReference:"777PQ12345678",
    address:"1 Compliance Way, London",postcode:"EC1A 1AA",smallEmployersRelief:true,
  }});
  check(created.body.role==="owner","Compliance employer was created with owner access");
  return created.body.employer.id;
}

function employeeRows(employerId) {
  const common={
    employerId,dateOfBirth:"1990-01-15",gender:"F",address:"1 Worker Road, London",postcode:"E1 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:36000,
    payBasis:"period",hourlyRate:15,dailyRate:150,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,
    paymentMethod:"credit-transfer",starterEvidence:"No P45 provided",starterDeclaration:"Statement A",
    employeePortal:false,portalCanEditBank:false,reportedPayFrequency:"monthly",
  };
  const variants=[
    {firstName:"Sally",lastName:"Sick"},
    {firstName:"Maya",lastName:"Maternity"},
    {firstName:"Patrick",lastName:"Paternity",gender:"M"},
    {firstName:"Nia",lastName:"Neonatal"},
    {firstName:"Derek",lastName:"Deduction"},
    {firstName:"Bella",lastName:"Benefit"},
    {firstName:"Clara",lastName:"Class One"},
    {firstName:"Poppy",lastName:"Portal",employeePortal:true,portalCanEditBank:true,confidential:true,
      bankName:"Original Bank",accountName:"Poppy Portal",sortCode:"112233",accountNumber:"12345678"},
    {firstName:"Lenny",lastName:"Leaver",leavingDate:"2026-06-05",employeePortal:true},
  ];
  return variants.map((row,index)=>({
    ...common,...row,payrollId:`CMP-${runId}-${index+1}`,email:`cmp-${runId}-${index+1}@example.test`,
    niNumber:`BB${String(200001+index).padStart(6,"0")}B`,
  }));
}

function recordsForPeriod(employees,periodNumber) {
  return employees.filter(employee=>!employee.leavingDate||periodNumber<=2).map(employee=>{
    const statutory=periodNumber===2&&["Sick","Maternity","Paternity","Neonatal"].includes(employee.lastName);
    const gross=statutory?0:3000;
    return {
      employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
      grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
      studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
      noSecondaryNic:employee.noSecondaryNic,directorMethod:employee.alternativeDirectorNic?"alternative":"annual",
      annualSalary:employee.annualSalary,hourlyRate:employee.hourlyRate,contractedHours:employee.contractedHours,
      items:gross?[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}]:[],
    };
  });
}

async function createEmployees(employerId) {
  let rows=(await request(`/api/employees?employerId=${employerId}`)).body;
  if(!rows.length)for(const employee of employeeRows(employerId)){
    await request("/api/employees",{method:"POST",expected:[201],json:employee});
  }
  rows=(await request(`/api/employees?employerId=${employerId}`)).body;
  check(rows.length===9,"Nine compliance employees cover statutory pay, deductions, benefits, portal and leaver workflows");
  return rows;
}

async function createPrePayrollEvidence(employerId,employees) {
  const benefitEmployee=employees.find(employee=>employee.lastName==="Benefit");
  const car=await request("/api/benefits",{method:"POST",expected:[201],json:{
    employerId,payrollId:benefitEmployee.payrollId,taxYear,category:"Company car",description:"Electric company car",
    nicTreatment:"class-1a",payrolled:true,status:"reviewed",benefitEvent:"provided",availableFrom:"2026-04-06",
    vehicleRegistration:"QA26CAR",makeModel:"QA Electric",fuelType:"Electric",firstRegistered:"2026-04-06",
    co2Emissions:0,zeroEmissionMileage:300,listPrice:30000,capitalContributions:0,privateUseContribution:0,
  }});
  check(car.body.cashEquivalent>0&&car.body.class1aNic>0,"Company-car cash equivalent and Class 1A NIC were calculated from structured evidence");

  const orderEmployee=employees.find(employee=>employee.lastName==="Deduction");
  const order=await request("/api/attachments",{method:"POST",expected:[201],json:{
    employerId,payrollId:orderEmployee.payrollId,type:"Direct earnings attachment",issuingAuthority:"DWP",
    reference:`DEA-${runId}`,effectiveDate:"2026-05-06",calculationRule:"dea-standard",payFrequency:"monthly",
    deductionType:"fixed",deductionValue:0,protectedEarnings:0,balance:2500,adminFee:1,priority:50,
  }});
  check(order.body.status==="active","Direct Earnings Attachment was activated for the second payroll period");
}

async function finalisePeriod(employerId,employees,periodNumber) {
  const records=recordsForPeriod(employees,periodNumber);
  const result=await request("/api/pay-runs",{method:"POST",json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber,
    payDate:`${periodNumber===1?"2026-05-05":periodNumber===2?"2026-06-05":periodNumber===3?"2026-07-05":periodNumber===4?"2026-08-05":periodNumber===5?"2026-09-05":periodNumber===6?"2026-10-05":periodNumber===7?"2026-11-05":periodNumber===8?"2026-12-05":periodNumber===9?"2027-01-05":periodNumber===10?"2027-02-05":periodNumber===11?"2027-03-05":"2027-04-05"}`,
    employees:records,
  }});
  check(result.body.status==="finalised",`Monthly payroll period ${periodNumber} finalised`);
  return result.body;
}

async function createLeaveEvidence(employerId,employees) {
  const common={employerId,averageWeeklyEarningsSource:"manual",averageWeeklyEarnings:700,continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,status:"calculated"};
  const claims=[
    {payrollId:employees.find(e=>e.lastName==="Sick").payrollId,type:"Sick leave",statutoryType:"sick",startDate:"2026-05-06",endDate:"2026-05-19",qualifyingDays:10,qualifyingWeekdays:[1,2,3,4,5]},
    {payrollId:employees.find(e=>e.lastName==="Maternity").payrollId,type:"Maternity leave",statutoryType:"maternity",startDate:"2026-05-06",endDate:"2026-05-19",familyEventReference:`MAT-${runId}`,familyEventDate:"2026-05-10",familyEventKind:"birth"},
    {payrollId:employees.find(e=>e.lastName==="Paternity").payrollId,type:"Paternity leave",statutoryType:"paternity",startDate:"2026-05-06",endDate:"2026-05-19",familyEventReference:`PAT-${runId}`,familyEventDate:"2026-05-06",familyEventKind:"birth"},
    {payrollId:employees.find(e=>e.lastName==="Neonatal").payrollId,type:"Neonatal care leave",statutoryType:"neonatal",startDate:"2026-05-20",endDate:"2026-06-02",
      childBirthDate:"2026-05-06",neonatalCareStartDate:"2026-05-06",neonatalCareEndDate:"2026-05-19",neonatalTier:"tier-2",
      relationshipDeclaration:true,caringResponsibilityDeclaration:true},
  ];
  const created=[];
  for(const claim of claims){
    const response=await request("/api/leave",{method:"POST",expected:[201],json:{...common,...claim}});
    check(response.body.statutoryAmount>0,`${claim.type} produced an eligible statutory payment`);
    created.push(response.body);
  }
  const openLeave=await request("/api/leave",{method:"POST",expected:[201],json:{
    ...common,payrollId:employees.find(e=>e.lastName==="Portal").payrollId,type:"Annual leave",statutoryType:"none",
    startDate:"2026-05-11",endDate:"2026-05-15",averageWeeklyEarnings:0,qualifyingDays:5,qualifyingWeekdays:[1,2,3,4,5],
  }});
  check(openLeave.body.qualifyingDays===5,"Annual leave consumed scheduled working days in the open period");

  const locked=await request("/api/leave",{method:"POST",expected:[409],json:{
    ...common,payrollId:employees.find(e=>e.lastName==="Portal").payrollId,type:"Unpaid leave",statutoryType:"none",
    startDate:"2026-04-20",endDate:"2026-04-21",averageWeeklyEarnings:0,qualifyingDays:2,qualifyingWeekdays:[1,2,3,4,5],
  }});
  check(/finalised payroll period/.test(locked.body.error),"Leave overlapping a finalised monthly period is locked using the persisted date range");
  return created;
}

async function createSecondPeriodBenefit(employerId,employees) {
  const classOne=await request("/api/benefits",{method:"POST",expected:[201],json:{
    employerId,payrollId:employees.find(e=>e.lastName==="Class One").payrollId,taxYear,
    category:"Vouchers and credit cards",description:"Taxable retail vouchers",cashEquivalent:180,
    nicTreatment:"class-1",providedDate:"2026-05-10",payrolled:false,status:"reviewed",
  }});
  check(classOne.body.nicTreatment==="class-1"&&classOne.body.providedDate==="2026-05-10","Dated Class 1 benefit was accepted for the still-open payroll period");

  const locked=await request("/api/benefits",{method:"POST",expected:[409],json:{
    employerId,payrollId:employees.find(e=>e.lastName==="Portal").payrollId,taxYear,
    category:"Private medical insurance",description:"Late annual medical cover",cashEquivalent:1200,
    nicTreatment:"class-1a",payrolled:true,status:"reviewed",
  }});
  check(Array.isArray(locked.body.affectedPeriods)&&locked.body.affectedPeriods.includes(1),"A late annual payrolled benefit identifies the already-finalised period it would change");
}

async function verifySecondPeriod(employerId,employees,result,leaveClaims) {
  const byLastName=new Map(result.calculated.map(row=>[row.employee.lastName,row]));
  const stored=(await request(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  const period=stored.periods.find(item=>item.periodNumber===2);
  const storedRuns=stored.runs.filter(run=>run.payPeriodId===period.id);
  const employeeByLastName=new Map(employees.map(employee=>[employee.lastName,employee]));
  const storedByLastName=new Map([...employeeByLastName].map(([lastName,employee])=>[
    lastName,storedRuns.find(run=>run.employeeId===employee.id),
  ]));
  for(const lastName of ["Sick","Maternity","Paternity","Neonatal"]){
    check(storedByLastName.get(lastName)?.statutoryPay>0,`${lastName} statutory pay flowed into the finalised pay run`);
  }
  const periodTwoTasks=stored.workflowStatus.rti.tasks.filter(task=>task.periodNumber===2);
  check(periodTwoTasks.some(task=>task.type==="FPS"),"Statutory employee payments created an FPS obligation for period two");
  const recoveryTask=periodTwoTasks.find(task=>task.type==="EPS_RECOVERY");
  check(recoveryTask?.amount>0&&recoveryTask.statutoryPayByType.maternity>0&&recoveryTask.statutoryPayByType.paternity>0&&recoveryTask.statutoryPayByType.neonatal>0,
    "Recoverable family pay created one cumulative EPS recovery obligation with a by-type explanation");
  check(!("sick" in recoveryTask.statutoryPayByType),"Statutory Sick Pay did not create an EPS recovery claim");
  const maternitySnapshot=JSON.parse(storedByLastName.get("Maternity").rtiSnapshot);
  const sickSnapshot=JSON.parse(storedByLastName.get("Sick").rtiSnapshot);
  check(maternitySnapshot.statutoryPayByType.maternity>0&&sickSnapshot.statutoryPayByType.sick>0,
    "Finalised payslip evidence retained immutable statutory-pay types for RTI");

  const fps=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"FPS",taxYear,periodNumber:2}});
  const maternityFps=fps.body.payload.employees.find(row=>row.payrollId===employeeByLastName.get("Maternity").payrollId);
  const sickFps=fps.body.payload.employees.find(row=>row.payrollId===employeeByLastName.get("Sick").payrollId);
  check(maternityFps.ytd.statutoryMaternityPay>0&&maternityFps.ytd.statutoryPayByType.maternity>0,
    "FPS payload exposed HMRC-specific SMP year-to-date values");
  check(sickFps.ytd.statutorySickPay>0&&sickFps.ytd.statutoryPayByType.sick>0,
    "FPS audit payload retained SSP year-to-date values without creating an EPS recovery");
  const eps=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"EPS",taxYear,periodNumber:2}});
  check(eps.body.payload.recoveries.statutoryPayRecovered>0&&eps.body.payload.recoveries.statutoryPayRecoveredByType.maternity>0,
    "EPS payload automatically claimed cumulative statutory-pay recovery from the calendar");
  const deduction=byLastName.get("Deduction"),deductionRun=storedByLastName.get("Deduction");
  check(deduction.attachments.length===1&&deduction.attachments[0].totalFromPay>0&&deductionRun.otherDeductions>0,"DEA statutory band deduction reduced second-period net pay");
  const classOne=storedByLastName.get("Class One");
  check(classOne.nicablePay>classOne.grossPay,"Class 1 benefit affected NIC-able pay without being payrolled for PAYE");
  check(storedRuns.filter(run=>run.statutoryPay>0).length===4,"Four statutory-pay records persisted in immutable period-two evidence");

  const cancelLocked=await request("/api/leave",{method:"PUT",expected:[409],json:{
    employerId,id:leaveClaims[0].id,action:"cancel",reason:"Live lifecycle correction test",
  }});
  check(/finalised payroll period/.test(cancelLocked.body.error),"Calculated statutory leave cannot be cancelled after its affected payroll is finalised");
}

async function verifyReportsAndYearEnd(employerId,employees) {
  for(let period=3;period<=12;period++)await finalisePeriod(employerId,employees,period);
  const p45=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p45`)).body;
  check(p45.rows.length===1&&p45.rows[0][0].includes("Lenny"),"P45 report contains the tax-year leaver and excludes continuing employees");
  const p60Export=await request("/api/reports",{method:"POST",json:{employerId,taxYear,type:"p60",format:"html"}});
  check(p60Export.headers.get("x-payflow-source-checksum")?.length===64,"P60 set was generated with source-bound evidence");
  const p11d=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=p11d`)).body;
  const pbik=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=pbik`)).body;
  const statutory=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=statutory-pay`)).body;
  const attachments=(await request(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=attachments`)).body;
  check(p11d.rows.some(row=>row[2]==="Vouchers and credit cards")&&pbik.rows.some(row=>row[2]==="Company car"),"P11D and PBIK reports separate non-payrolled and payrolled benefits");
  check(statutory.rows.length>=4&&attachments.rows.length===1,"Statutory-pay and attachment-order reports retain operational evidence");

  const finalFps=await request("/api/submissions",{method:"POST",expected:[201],json:{
    employerId,type:"FPS",taxYear,periodNumber:12,finalSubmission:true,
  }});
  await request("/api/submissions",{method:"PUT",json:{employerId,id:finalFps.body.submission.id,declarationAccepted:true}});
  const audit=(await request(`/api/year-end?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
  check(audit.ready===false&&audit.checks.filter(item=>!item.passed).length===1&&/accepted by HMRC/.test(audit.checks.find(item=>!item.passed).name),
    "Year-end audit passes all local controls and remains honestly blocked only by external HMRC acceptance");
  const rollover=await request("/api/year-end",{method:"POST",expected:[409],json:{employerId,taxYear,action:"rollover"}});
  check(/not ready/.test(rollover.body.error),"Tax-year rollover refuses a locally test-ready package without an external HMRC acceptance receipt");
}

async function verifyPortalAndIsolation(employerId,employees) {
  const portalEmployee=employees.find(employee=>employee.lastName==="Portal");
  const invite=await request("/api/portal/invites",{method:"POST",expected:[201],json:{employerId,payrollId:portalEmployee.payrollId}});
  const portalLogin=await request("/api/portal/session",{method:"POST",captureCookie:true,cookie:"",json:{code:invite.body.code}});
  employeePortalCookie=portalLogin.cookie;
  check(Boolean(portalLogin.cookie),"One-time portal invitation created an employee-only session");
  const replay=await request("/api/portal/session",{method:"POST",expected:[401],cookie:"",json:{code:invite.body.code}});
  check(/already used/.test(replay.body.error),"Employee portal invitation cannot be replayed");
  const me=await request("/api/portal/me",{cookie:portalLogin.cookie});
  check(me.body.payslips.length===12&&me.body.p60.available===true,"Employee portal exposes all finalised payslips and the year-end P60 entitlement");
  const payslip=await request(`/api/portal/documents?type=payslip&period=12&taxYear=${encodeURIComponent(taxYear)}`,{cookie:portalLogin.cookie});
  check(/Generated from the immutable finalised payroll record/.test(payslip.text),"Portal payslip is generated from immutable finalised evidence");
  const p60=await request(`/api/portal/documents?type=p60&taxYear=${encodeURIComponent(taxYear)}`,{cookie:portalLogin.cookie});
  check(/End of year certificate/.test(p60.text)&&/P60-2026-27\.html/.test(p60.headers.get("content-disposition")||""),
    "Portal P60 is downloadable only from completed year-end evidence");
  const bankRequest=await request("/api/portal/requests",{method:"POST",expected:[201],cookie:portalLogin.cookie,json:{
    requestType:"bank",bankName:"Replacement Bank",accountName:"Poppy Portal",sortCode:"445566",accountNumber:"87654321",
    employeeNote:"Please use this account from the next open payroll.",
  }});
  check(bankRequest.body.status==="pending","Employee bank change is queued for payroll review rather than overwriting master data");

  const viewerEmail=`viewer-${runId}@example.test`,viewerPassword=`View-${runId}-Pass!`;
  await request("/api/admin/users",{method:"POST",expected:[201],json:{
    employerId,email:viewerEmail,temporaryPassword:viewerPassword,displayName:"Restricted QA Viewer",
    role:"viewer",canViewConfidential:false,
  }});
  const viewerLogin=await request("/api/admin/session",{method:"POST",captureCookie:true,cookie:"",json:{
    action:"login",employerId,email:viewerEmail,password:viewerPassword,
  }});
  const visible=(await request(`/api/employees?employerId=${employerId}`,{cookie:viewerLogin.cookie})).body;
  check(!visible.some(employee=>employee.payrollId===portalEmployee.payrollId),"Viewer without confidential permission cannot enumerate the confidential employee");
  const viewerInbox=await request(`/api/employee-requests?employerId=${employerId}`,{cookie:viewerLogin.cookie,expected:[403]});
  check(/role does not permit/.test(viewerInbox.body.error),
    "Read-only viewers cannot open the payroll change-request inbox");
  const crossTenant=await request(`/api/employees?employerId=${bootstrapEmployerId}`,{cookie:viewerLogin.cookie,expected:[403]});
  check(/access/.test(crossTenant.body.error.toLowerCase()),"Tenant-scoped viewer cannot read another employer");

  const payrollEmail=`payroll-${runId}@example.test`,payrollPassword=`Payroll-${runId}-Pass!`;
  await request("/api/admin/users",{method:"POST",expected:[201],json:{
    employerId,email:payrollEmail,temporaryPassword:payrollPassword,displayName:"Restricted QA Payroll",
    role:"payroll",canViewConfidential:false,
  }});
  const payrollLogin=await request("/api/admin/session",{method:"POST",captureCookie:true,cookie:"",json:{
    action:"login",employerId,email:payrollEmail,password:payrollPassword,
  }});
  const restrictedInbox=(await request(`/api/employee-requests?employerId=${employerId}`,{cookie:payrollLogin.cookie})).body;
  check(!restrictedInbox.some(item=>item.employeeId===portalEmployee.id),
    "Payroll users without confidential permission cannot enumerate the employee's portal requests");

  const ownerInbox=(await request(`/api/employee-requests?employerId=${employerId}`)).body;
  const pendingBank=ownerInbox.find(item=>item.id===bankRequest.body.id);
  check(pendingBank?.status==="pending"&&pendingBank.proposedChanges.accountNumber==="87654321",
    "Authorised payroll users can review the exact proposed bank fields");
  const approvedBank=await request("/api/employee-requests",{method:"PUT",json:{
    employerId,id:bankRequest.body.id,decision:"approved",reviewNote:"Bank evidence checked in the QA lifecycle.",
  }});
  check(approvedBank.body.applied===true&&approvedBank.body.status==="approved",
    "Payroll approval applies the employee's bank request");
  let refreshedPortalEmployee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.id===portalEmployee.id);
  check(refreshedPortalEmployee.bankName==="Replacement Bank"&&refreshedPortalEmployee.sortCode==="445566"&&refreshedPortalEmployee.accountNumber==="87654321",
    "Approved bank details persisted on the employee master record");

  const contactEmail=`poppy-updated-${runId}@example.test`;
  const contactRequest=await request("/api/portal/requests",{method:"POST",expected:[201],cookie:portalLogin.cookie,json:{
    requestType:"contact",email:contactEmail,phone:"020 7000 2026",address:portalEmployee.address,postcode:portalEmployee.postcode,
    employeeNote:"Please update my contact record.",
  }});
  const approvedContact=await request("/api/employee-requests",{method:"PUT",json:{
    employerId,id:contactRequest.body.id,decision:"approved",reviewNote:"Contact details confirmed.",
  }});
  refreshedPortalEmployee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.id===portalEmployee.id);
  check(approvedContact.body.applied===true&&refreshedPortalEmployee.email===contactEmail&&refreshedPortalEmployee.phone==="020 7000 2026",
    "Approved contact changes persisted without ending the employee session");

  const secondBank=await request("/api/portal/requests",{method:"POST",expected:[201],cookie:portalLogin.cookie,json:{
    requestType:"bank",bankName:"Replacement Bank",accountName:"Poppy Portal",sortCode:"445566",accountNumber:"87654322",
    employeeNote:"A second bank request used to test duplicate and rejection controls.",
  }});
  const duplicateBank=await request("/api/portal/requests",{method:"POST",expected:[409],cookie:portalLogin.cookie,json:{
    requestType:"bank",bankName:"Replacement Bank",accountName:"Poppy Portal",sortCode:"445566",accountNumber:"87654322",
  }});
  check(/already awaiting payroll review/.test(duplicateBank.body.error),
    "The portal prevents two unresolved requests of the same type");
  const rejectedBank=await request("/api/employee-requests",{method:"PUT",json:{
    employerId,id:secondBank.body.id,decision:"rejected",reviewNote:"Replacement evidence was not accepted.",
  }});
  refreshedPortalEmployee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.id===portalEmployee.id);
  check(rejectedBank.body.applied===false&&refreshedPortalEmployee.accountNumber==="87654321",
    "Rejected bank changes retain the approved employee master data");
  const portalRequests=(await request("/api/portal/requests",{cookie:portalLogin.cookie})).body;
  check(portalRequests.some(item=>item.id===bankRequest.body.id&&item.status==="approved")&&
    portalRequests.some(item=>item.id===contactRequest.body.id&&item.status==="approved")&&
    portalRequests.some(item=>item.id===secondBank.body.id&&item.status==="rejected"),
  "The employee can track approved and rejected payroll review outcomes");

  const leaverEmployee=employees.find(employee=>employee.lastName==="Leaver");
  const leaverInvite=await request("/api/portal/invites",{method:"POST",expected:[201],json:{employerId,payrollId:leaverEmployee.payrollId}});
  const leaverLogin=await request("/api/portal/session",{method:"POST",captureCookie:true,cookie:"",json:{code:leaverInvite.body.code}});
  leaverPortalCookie=leaverLogin.cookie;
  const leaverMe=await request("/api/portal/me",{cookie:leaverPortalCookie});
  check(leaverMe.body.p45Available===true&&leaverMe.body.p45TaxYear===taxYear&&leaverMe.body.p60.available===false,
    "A tax-year leaver receives P45 access instead of a P60 entitlement");
  const p45=await request(`/api/portal/documents?type=p45&taxYear=${encodeURIComponent(taxYear)}`,{cookie:leaverPortalCookie});
  check(/Details of employee leaving work/.test(p45.text)&&/P45-2026-06-05\.html/.test(p45.headers.get("content-disposition")||""),
    "The leaver can download a source-bound P45 from the employee portal");
}

async function verifyBackup(employerId) {
  const backup=(await request(`/api/data?employerId=${employerId}`)).body;
  check(backup.checksum?.value?.length===64&&backup.dataset.payPeriods.length===12,"Complete backup contains the 12-period compliance lifecycle and a SHA-256 checksum");
  const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
  check(verified.body.verified===true&&verified.body.checksum===backup.checksum.value,"Backup relationship and checksum verification passed");
  const corrupted=structuredClone(backup);
  corrupted.dataset.employees[0].firstName=`${corrupted.dataset.employees[0].firstName} X`;
  const rejected=await request("/api/data",{method:"POST",expected:[422],json:{action:"verify-backup",employerId,backup:corrupted}});
  check(/verification|changed/i.test(rejected.body.error),"Tampered backup was rejected before recovery");
  const analysis=await request("/api/data",{method:"POST",json:{action:"analyse-restore",employerId,backup}});
  check(analysis.body.verified===true&&analysis.body.impact.administratorAccessPreserved===true,"Guarded recovery analysis confirms administrator access will be preserved");
  const restored=await request("/api/data",{method:"POST",json:{
    action:"restore-backup",employerId,backup,confirmation:analysis.body.confirmationPhrase,currentFingerprint:analysis.body.currentFingerprint,
  }});
  check(restored.body.restored===true&&restored.body.portalSessionsRevoked===true,"Verified backup restored atomically and revoked employee portal sessions");
  const ownerStillActive=(await request(`/api/employees?employerId=${employerId}`)).body;
  check(ownerStillActive.length===9,"Owner administrator retained access to every restored employee");
  const revokedPortal=await request("/api/portal/me",{cookie:employeePortalCookie,expected:[401]});
  check(/authentication/.test(revokedPortal.body.error),"Pre-restore employee portal session is no longer usable");
  const revokedLeaverPortal=await request("/api/portal/me",{cookie:leaverPortalCookie,expected:[401]});
  check(/authentication/.test(revokedLeaverPortal.body.error),"Backup recovery also revoked the leaver's portal session");
}

await authenticateOwner();
const employerId=await createEmployer();
const employees=await createEmployees(employerId);
await createPrePayrollEvidence(employerId,employees);
await finalisePeriod(employerId,employees,1);
const leaveClaims=await createLeaveEvidence(employerId,employees);
await createSecondPeriodBenefit(employerId,employees);
const periodTwo=await finalisePeriod(employerId,employees,2);
await verifySecondPeriod(employerId,employees,periodTwo,leaveClaims);
if(process.env.PAYFLOW_STOP_AFTER_RTI==="1"){
  console.log(JSON.stringify({baseUrl,runId,employerId,summary:{checks:checks.length,employees:employees.length,periods:2,scope:"calendar-to-payslip-to-rti"},checks},null,2));
  process.exit(0);
}
await verifyReportsAndYearEnd(employerId,employees);
await verifyPortalAndIsolation(employerId,employees);
await verifyBackup(employerId);

console.log(JSON.stringify({baseUrl,runId,employerId,summary:{checks:checks.length,employees:employees.length,periods:12},checks},null,2));
