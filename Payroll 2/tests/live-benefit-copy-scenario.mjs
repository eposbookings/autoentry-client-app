import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const runId=process.env.PAYFLOW_LIVE_RUN_ID||`benefit-copy-${Date.now()}`;
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const ownerEmail="qa-live@payflow.local";
const ownerPassword="PayFlow-Live-QA-2026!";
let ownerCookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],cookie=ownerCookie,captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{
    method,headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
    body:json===undefined?undefined:JSON.stringify(json),
  });
  const text=await response.text(),contentType=response.headers.get("content-type")||"";
  let body=text;if(contentType.includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,cookie:captureCookie?(response.headers.get("set-cookie")||"").split(";")[0]:""};
}

const login=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email:ownerEmail,password:ownerPassword,
}});
ownerCookie=login.cookie;
check(Boolean(ownerCookie),"Owner session authenticated");

const employerName=`Benefit Copy QA ${runId}`;
const createdEmployer=await request("/api/employer",{method:"POST",expected:[201],json:{
  name:employerName,legalName:`${employerName} Limited`,taxYear:"2026/27",payFrequency:"monthly",
  payeReference:"745/BC026",accountsOfficeReference:"745PB12345678",
}});
const employerId=createdEmployer.body.employer.id;
check(createdEmployer.body.role==="owner","Destination employer was tenant-bound to the owner");

const employeeDefaults={
  employerId,dateOfBirth:"1988-01-15",gender:"F",address:"1 Benefits Road, London",postcode:"EC1A 1AA",
  startDate:"2025-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:36000,
  payBasis:"period",hourlyRate:15,dailyRate:150,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,
  paymentMethod:"credit-transfer",starterEvidence:"No P45 provided",starterDeclaration:"Statement A",
  employeePortal:false,portalCanEditBank:false,reportedPayFrequency:"monthly",
};
const employees=[];
for(const [index,variant] of [
  {firstName:"Casey",lastName:"ClassOne"},
  {firstName:"Cara",lastName:"Car"},
  {firstName:"Lorna",lastName:"Loan"},
  {firstName:"Liam",lastName:"Leaver",leavingDate:"2026-03-31"},
  {firstName:"Connie",lastName:"Confidential",confidential:true},
].entries()){
  const result=await request("/api/employees",{method:"POST",expected:[201],json:{
    ...employeeDefaults,...variant,payrollId:`BC-${runId}-${index+1}`,
    email:`bc-${runId}-${index+1}@example.test`,niNumber:`BC${String(300001+index).padStart(6,"0")}C`,
  }});
  employees.push(result.body);
}
check(employees.length===5,"Five source-year employees were created");
const employee=name=>employees.find(item=>item.lastName===name);

const sourceBenefits=[
  {payrollId:employee("ClassOne").payrollId,category:"Vouchers and credit cards",description:"Annual retail vouchers",
    cashEquivalent:240,nicTreatment:"class-1",providedDate:"2025-09-30",payrolled:false},
  {payrollId:employee("Car").payrollId,category:"Company car",description:"Continuing electric company car",
    nicTreatment:"class-1a",payrolled:true,benefitEvent:"provided",availableFrom:"2025-08-01",
    vehicleRegistration:"BC25CAR",makeModel:"Copy EV",fuelType:"Electric",firstRegistered:"2025-07-01",
    co2Emissions:0,zeroEmissionMileage:300,listPrice:30000,capitalContributions:0,privateUseContribution:0},
  {payrollId:employee("Loan").payrollId,category:"Beneficial loan",description:"Continuing director loan",
    nicTreatment:"class-1a",payrolled:false,loanOpeningBalance:20000,loanClosingBalance:12000,
    loanMaximumAggregateBalance:20000,loanWholeMonths:12,loanInterestPaid:0,loanSalaryForegone:0},
  {payrollId:employee("Leaver").payrollId,category:"Private medical insurance",description:"Leaver medical insurance",
    cashEquivalent:1000,nicTreatment:"class-1a",payrolled:false},
  {payrollId:employee("Confidential").payrollId,category:"Private medical insurance",description:"Confidential medical insurance",
    cashEquivalent:1500,nicTreatment:"class-1a",payrolled:true},
  {payrollId:employee("Car").payrollId,category:"Company van",description:"Returned company van",
    nicTreatment:"class-1a",payrolled:false,availableFrom:"2025-04-06",availableTo:"2026-03-31",
    vehicleRegistration:"BC25VAN",makeModel:"Returned Van",zeroEmission:false,vanUseType:"taxable-private-use",
    vanFuelProvided:false,vanFuelRepaid:false,vanSharedEmployees:1,privateUseContribution:0},
];
for(const benefit of sourceBenefits)await request("/api/benefits",{method:"POST",expected:[201],json:{
  employerId,taxYear:"2025/26",status:"reviewed",...benefit,
}});
check(sourceBenefits.length===6,"Six reviewed source-year benefit variations were stored");

const restrictedEmail=`restricted-${runId}@example.test`,restrictedPassword=`Restricted-${runId}-Pass!`;
await request("/api/admin/users",{method:"POST",expected:[201],json:{
  employerId,email:restrictedEmail,temporaryPassword:restrictedPassword,displayName:"Restricted Payroll",
  role:"payroll",canViewConfidential:false,
}});
const restrictedLogin=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{
  action:"login",employerId,email:restrictedEmail,password:restrictedPassword,
}});
const confidentialBlocked=await request("/api/benefits",{method:"POST",cookie:restrictedLogin.cookie,expected:[403],json:{
  action:"copy-tax-year",employerId,sourceTaxYear:"2025/26",targetTaxYear:"2026/27",
}});
check(/Confidential employees/.test(confidentialBlocked.body.error),"A payroll user without confidential permission cannot perform an incomplete annual copy");

const copied=await request("/api/benefits",{method:"POST",expected:[201],json:{
  action:"copy-tax-year",employerId,sourceTaxYear:"2025/26",targetTaxYear:"2026/27",
}});
check(copied.body.copied===4&&copied.body.skipped.length===2&&copied.body.requiresReview===true,
  "Four continuing benefits copied as drafts while the leaver and returned vehicle were skipped",copied.body);
const allBenefits=(await request(`/api/benefits?employerId=${employerId}`)).body;
const destination=allBenefits.filter(item=>item.taxYear==="2026/27");
check(destination.length===4&&destination.every(item=>item.status==="draft"&&item.copiedFromBenefitId&&item.copiedAt),
  "Destination records retain draft isolation and source provenance");
const classOne=destination.find(item=>item.description==="Annual retail vouchers");
check(classOne.providedDate==="2026-09-30"&&classOne.class1aNic===0,"Class 1 provision date rolled forward without creating Class 1A NIC");
const car=destination.find(item=>item.category==="Company car");
check(car.availableFrom==="2026-04-06"&&car.firstRegistered==="2025-07-01"&&car.cashEquivalent===1200&&car.class1aNic===180,
  "Continuing car restarted on 6 April and recalculated at the destination-year rate");
const loan=destination.find(item=>item.category==="Beneficial loan");
check(loan.loanOpeningBalance===12000&&loan.loanClosingBalance===12000&&loan.cashEquivalent===450,
  "Beneficial-loan closing balance carried into the destination year and recalculated");
check(!destination.some(item=>item.description==="Leaver medical insurance"||item.description==="Returned company van"),
  "Non-continuing employee and vehicle benefits were not copied");

const duplicate=await request("/api/benefits",{method:"POST",expected:[409],json:{
  action:"copy-tax-year",employerId,sourceTaxYear:"2025/26",targetTaxYear:"2026/27",
}});
check(/already been copied/.test(duplicate.body.error),"A repeat annual copy is rejected rather than duplicating destination benefits");

const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.dataset.expensesBenefits.filter(item=>item.copiedFromBenefitId).length===4,"Complete backup includes annual-copy provenance");
const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verified.body.verified===true,"Backup verification accepts valid copied-benefit lineage");
const tampered=structuredClone(backup);
tampered.dataset.expensesBenefits.find(item=>item.copiedFromBenefitId).copiedFromBenefitId=999999999;
const unsignedTampered=Object.fromEntries(Object.entries(tampered).filter(([key])=>key!=="checksum"));
tampered.checksum.value=createHash("sha256").update(JSON.stringify(unsignedTampered)).digest("hex");
const tamperedResult=await request("/api/data",{method:"POST",expected:[422],json:{action:"verify-backup",employerId,backup:tampered}});
check(tamperedResult.body.table==="expensesBenefits","Tampered copy provenance cannot pass backup verification",tamperedResult.body);
const analysis=await request("/api/data",{method:"POST",json:{action:"analyse-restore",employerId,backup}});
const restored=await request("/api/data",{method:"POST",json:{
  action:"restore-backup",employerId,backup,confirmation:analysis.body.confirmationPhrase,currentFingerprint:analysis.body.currentFingerprint,
}});
check(restored.body.restored===true,"A verified copied-benefit dataset restores atomically");
const restoredBenefits=(await request(`/api/benefits?employerId=${employerId}`)).body;
check(restoredBenefits.filter(item=>item.taxYear==="2026/27"&&item.copiedFromBenefitId).length===4,
  "Annual-copy provenance survives complete backup recovery");

console.log(JSON.stringify({baseUrl,runId,employerId,summary:{checks:checks.length,sourceBenefits:6,copiedBenefits:4},checks},null,2));
