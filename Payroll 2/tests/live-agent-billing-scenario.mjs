import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
const ownerEmail="qa-live@payflow.local",ownerPassword="PayFlow-Live-QA-2026!";
const viewerEmail=`agent-viewer-${runId}@example.test`;
const viewerPassword=`Agent-viewer-${runId}-Pass!`;
const taxYear="2026/27";
let employerId=0;
let ownerCookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);checks.push(message);
}
async function request(path,{method="GET",json,expected=[200],cookie=ownerCookie,captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{method,headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},body:json===undefined?undefined:JSON.stringify(json)});
  const text=await response.text(),contentType=response.headers.get("content-type")||"";let body=text;
  if(contentType.includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,text,cookie:captureCookie?(response.headers.get("set-cookie")||"").split(";")[0]:"",contentType};
}

const ownerLogin=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{action:"login",employerId:bootstrapEmployerId,email:ownerEmail,password:ownerPassword}});
ownerCookie=ownerLogin.cookie;check(Boolean(ownerCookie),"Owner authenticated for isolated agent-billing testing");
const sample=await request("/api/scenarios",{method:"POST",expected:[201],json:{action:"create-isolated-sample",confirmation:"CREATE ISOLATED SAMPLE"}});
employerId=sample.body.employerId;
check(sample.body.created===true&&sample.body.employees===20,"A fresh demonstration employer was created for repeatable billing evidence");
const employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const schedule=scheduledPayPeriods(taxYear,"monthly","2026-04-30");
const payrollRecords=employees.map(employee=>{
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
for(const period of schedule.slice(0,2))await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:payrollRecords,
}});
check(true,"Two complete payroll periods established the invoice source evidence");
await request("/api/admin/users",{method:"POST",expected:[201],json:{
  employerId,email:viewerEmail,temporaryPassword:viewerPassword,displayName:"Agent billing restricted viewer",role:"viewer",canViewConfidential:false,
}});
check(true,"A restricted employer viewer was created for the billing-access boundary");
const initial=await request(`/api/agent?employerId=${employerId}`);
check(initial.body.employer?.taxYear==="2026/27","Agent billing is scoped to the selected employer");

const profile=await request("/api/agent",{method:"POST",expected:[201],json:{
  action:"save-profile",employerId,firmName:"EPOS Accountancy",contactName:"Live QA Agent",email:"agent@example.test",
  phone:"020 7946 0999",address:"10 Agent Square, London",postcode:"EC1A 1AA",agentReference:"AGT-2026",
  vatRegistrationNumber:"GB123456789",defaultVatRate:20,paymentTermsDays:14,invoicePrefix:"QA",nextInvoiceNumber:1,
  bankPaymentDetails:"Sort code 12-34-56 · account ending 6789",payslipFooter:"Prepared by EPOS Accountancy",
}});
check(profile.body.nextInvoiceNumber===1,"Agent identity and sequential invoice settings persisted");

for(const charge of [
  {chargeCode:"payroll-service",description:"Annual payroll service",billingBasis:"fixed",unitRate:100,vatRate:20},
  {chargeCode:"payslip",description:"Payslip processing",billingBasis:"per-payslip",unitRate:1.5,vatRate:20},
  {chargeCode:"payroll-period",description:"Payroll period completion",billingBasis:"per-period",unitRate:10,vatRate:20},
  {chargeCode:"rti-submission",description:"RTI filing preparation",billingBasis:"per-submission",unitRate:5,vatRate:20},
])await request("/api/agent",{method:"POST",expected:[201],json:{action:"save-charge",employerId,effectiveFrom:"2026-04-06",...charge}});
check(true,"Fixed, per-payslip, per-period and RTI charge bases were configured");

const preview=await request("/api/agent",{method:"POST",json:{action:"preview-invoice",employerId,periodStart:"2026-04-06",periodEnd:"2027-04-05"}});
check(preview.body.payrollPeriodCount===2&&preview.body.payslipCount===40&&preview.body.employeeCount===20,
  "Payslip count reconciles every employee in both finalised payroll periods",preview.body);
check(preview.body.lines.find(line=>line.chargeCode==="payslip").units===preview.body.payslipCount,
  "Per-payslip charge uses each finalised employee-period record");
check(preview.body.lines.find(line=>line.chargeCode==="payroll-period").units===2,
  "Per-period charge uses the two finalised pay dates");
check(preview.body.grossAmount===Math.round((preview.body.netAmount+preview.body.vatAmount)*100)/100,
  "Preview net, VAT and gross totals reconcile");

const created=await request("/api/agent",{method:"POST",expected:[201],json:{
  action:"create-invoice",employerId,periodStart:"2026-04-06",periodEnd:"2027-04-05",invoiceDate:"2027-04-06",
}});
check(created.body.invoiceNumber==="QA-000001"&&created.body.status==="draft","First invoice used the configured sequential number");
check(created.body.payslipCount===preview.body.payslipCount&&created.body.sourceChecksum.length===64,
  "Draft invoice froze its payslip evidence and SHA-256 source checksum");
const duplicate=await request("/api/agent",{method:"POST",expected:[409],json:{
  action:"create-invoice",employerId,periodStart:"2026-04-06",periodEnd:"2027-04-05",invoiceDate:"2027-04-06",
}});
check(/already bills this unchanged source period/.test(duplicate.body.error),"Unchanged payroll evidence cannot be billed twice");
const print=await request(`/api/agent?employerId=${employerId}&invoiceId=${created.body.id}&format=html`);
check(print.contentType.includes("text/html")&&print.text.includes("Print / save PDF")&&print.text.includes("QA-000001"),
  "Private print-ready invoice renders from stored line items");

const issued=await request("/api/agent",{method:"PUT",json:{employerId,id:created.body.id,action:"issue"}});
check(issued.body.status==="issued"&&issued.body.issuedAt,"Draft invoice can be issued and locked");
await request("/api/agent",{method:"PUT",expected:[409],json:{employerId,id:created.body.id,action:"issue"}});
check(true,"An issued invoice cannot be issued again");
const voided=await request("/api/agent",{method:"PUT",json:{employerId,id:created.body.id,action:"void",reason:"Live replacement invoice test"}});
check(voided.body.status==="voided"&&voided.body.issuedAt&&voided.body.voidedAt,"Voiding preserves issue history and records correction evidence");
const replacement=await request("/api/agent",{method:"POST",expected:[201],json:{
  action:"create-invoice",employerId,periodStart:"2026-04-06",periodEnd:"2027-04-05",invoiceDate:"2027-04-07",
}});
check(replacement.body.invoiceNumber==="QA-000002","A voided source may be replaced using the next invoice number");

const viewerLogin=await request("/api/admin/session",{method:"POST",cookie:"",captureCookie:true,json:{action:"login",employerId,email:viewerEmail,password:viewerPassword}});
await request(`/api/agent?employerId=${employerId}`,{cookie:viewerLogin.cookie,expected:[403]});
check(true,"Read-only employer users cannot access agent billing or payment details");

const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.schemaVersion===7&&backup.dataset.agentProfiles.length===1&&backup.dataset.agentCharges.length===4&&backup.dataset.agentInvoices.length===2,
  "Schema 7 backup includes the full agent profile, charges and invoices");
const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verified.body.verified===true,"Agent billing evidence passes complete backup verification");
const tampered=structuredClone(backup),invoice=tampered.dataset.agentInvoices[0];
invoice.sourceEvidence=invoice.sourceEvidence.replace('"periodIds":[','"periodIds":[999999,');
const unsigned=Object.fromEntries(Object.entries(tampered).filter(([key])=>key!=="checksum"));
tampered.checksum.value=createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const rejected=await request("/api/data",{method:"POST",expected:[422],json:{action:"verify-backup",employerId,backup:tampered}});
check(String(rejected.body.table||"").startsWith("agentInvoices"),"Tampered invoice source evidence is rejected even with a recomputed outer checksum",rejected.body);
const analysis=await request("/api/data",{method:"POST",json:{action:"analyse-restore",employerId,backup}});
const restored=await request("/api/data",{method:"POST",json:{action:"restore-backup",employerId,backup,confirmation:analysis.body.confirmationPhrase,currentFingerprint:analysis.body.currentFingerprint}});
check(restored.body.restored===true,"Agent billing records restore atomically with payroll");
const after=(await request(`/api/agent?employerId=${employerId}`)).body;
check(after.invoices.length===2&&after.charges.length===4&&after.profile.nextInvoiceNumber===3,
  "Invoice sequence, lifecycle and charge schedule survive restore");

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length,payslips:preview.body.payslipCount,invoices:2},checks},null,2));
