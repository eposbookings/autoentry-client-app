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
  if(!expected.includes(response.status))
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for email-template delivery testing");

const employerName=`Email Template QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"497/EM2026",accountsOfficeReference:"497PE12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated email-template employer is available",{employerId});

const employer=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
await request("/api/employer",{method:"PUT",json:{...employer,primaryContactName:"Priya Payroll"}});

const invalid=await request("/api/email-templates",{method:"POST",expected:[422],json:{
  employerId,name:"Unsafe token",reportType:"payslip",subject:"Hello <unknown token>",body:"Body",isDefault:false,
}});
check(/unsupported token <unknown token>/.test(invalid.body.error),"Unsupported email-template tokens are rejected");

const p60=(await request("/api/email-templates",{method:"POST",expected:[201],json:{
  employerId,name:"Year-end P60",reportType:"p60",subject:"Your <report> from <employer>",
  body:"Hello <forename>, your <report+period> is ready.",isDefault:true,
}})).body.template;
const firstPayslip=(await request("/api/email-templates",{method:"POST",expected:[201],json:{
  employerId,name:"First payslip default",reportType:"payslip",subject:"First <period>",
  body:"Hello <name>, your <report> is ready.",isDefault:true,
}})).body.template;
const secondPayslip=(await request("/api/email-templates",{method:"POST",expected:[201],json:{
  employerId,name:"Detailed payslip",reportType:"payslip",
  subject:"<employer> · <employee id> · <period>",
  body:"Dear <title> <surname>,\n\nYour <report+period> is ready from <employer>.\nPAYE <payeref> · Accounts <accountsref> · Contact <contact forename> <contact surname>.",
  isDefault:true,
}})).body.template;

let templates=(await request(`/api/email-templates?employerId=${employerId}`)).body;
const storedP60=templates.templates.find(item=>item.id===p60.id);
const storedFirst=templates.templates.find(item=>item.id===firstPayslip.id);
const storedSecond=templates.templates.find(item=>item.id===secondPayslip.id);
check(storedP60.isDefault===true&&storedFirst.isDefault===false&&storedSecond.isDefault===true,
  "Defaults are exclusive within a report type without displacing the P60 default");
check(templates.systemDefault.isDefault===false,"A custom payslip default supersedes the system default");

const duplicateName=await request("/api/email-templates",{method:"POST",expected:[409],json:{
  employerId,name:"detailed PAYSLIP",reportType:"payslip",subject:"Duplicate",body:"Duplicate",isDefault:false,
}});
check(/already uses this name/.test(duplicateName.body.error),"Active email-template names are case-insensitively unique");

const crossTenant=await request("/api/email-templates",{method:"PUT",expected:[404],json:{
  employerId:bootstrapEmployerId,id:secondPayslip.id,action:"archive",
}});
check(/not found for this employer/.test(crossTenant.body.error),"Email templates cannot be changed through another employer tenant");

let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const payrollId=`EM-${runId}`;
if(!employees.some(item=>item.payrollId===payrollId)){
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,title:"Ms",firstName:"Amina",lastName:"Template",payrollId,
    email:`amina-${runId}@example.test`,dateOfBirth:"1992-03-14",gender:"F",
    address:"1 Message Street, London",postcode:"SW1A 1AA",startDate:"2026-04-06",
    taxCode:"1257L",week1Month1:false,niNumber:"EE400001C",niCategory:"A",
    annualSalary:36000,payBasis:"period",hourlyRate:18,contractedHours:37.5,
    workingDaysPerWeek:5,annualLeaveDays:28,starterEvidence:"No P45 provided",
    starterDeclaration:"Statement A",reportedPayFrequency:"monthly",employeePortal:true,
  }});
}
employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const employee=employees.find(item=>item.payrollId===payrollId);
check(Boolean(employee),"Employee with a deliverable email address was created");

const period=scheduledPayPeriods(taxYear,"monthly")[0];
await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:period.payDate,
  employees:[{
    employeeId:employee.id,payrollId:employee.payrollId,title:employee.title,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
    grossPay:3000,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
    studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
    noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:36000,contractedHours:37.5,periodNumber:1,
    items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:3000,amount:3000,taxable:true,nicable:true,pensionable:true}],
  }],
}});
check(true,"Source payroll period was finalised before delivery");

const p60ForPayslip=await request("/api/payslip-deliveries",{method:"POST",expected:[422],json:{
  employerId,taxYear,periodNumber:1,method:"email",templateId:p60.id,
}});
check(/cannot be used for payslips/.test(p60ForPayslip.body.error),"P60-only templates cannot be selected for payslip delivery");

const delivery=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"email",templateId:secondPayslip.id,
}})).body;
const payload=delivery.delivery.payload,recipient=payload.recipients[0];
check(payload.schemaVersion==="payflow-payslip-delivery-2"&&payload.template.id===secondPayslip.id,
  "Email delivery freezes the selected template and schema");
check(recipient.emailSubject===`${employerName} · ${payrollId} · Period 1`,
  "Subject tokens are rendered from immutable payroll and employer identity",{subject:recipient.emailSubject});
check(recipient.emailBody.includes("Dear Ms Template")&&recipient.emailBody.includes("PAYE 497/EM2026")&&
  recipient.emailBody.includes("Accounts 497PE12345678")&&recipient.emailBody.includes("Contact Priya Payroll")&&!/<[^<>]+>/.test(recipient.emailBody),
  "Message tokens are personalised without unresolved placeholders",{body:recipient.emailBody});
check(delivery.delivery.status==="queued-external"&&payload.externalTransmission===false,
  "Email batch is recorded locally without claiming external transmission");

const duplicate=await request("/api/payslip-deliveries",{method:"POST",expected:[409],json:{
  employerId,taxYear,periodNumber:1,method:"email",templateId:secondPayslip.id,
}});
check(duplicate.body.deliveryId===delivery.delivery.id,"Exact personalised duplicate requires explicit resend");

await request("/api/email-templates",{method:"PUT",json:{employerId,id:secondPayslip.id,action:"archive"}});
templates=(await request(`/api/email-templates?employerId=${employerId}`)).body;
check(templates.templates.find(item=>item.id===secondPayslip.id)?.status==="superseded"&&templates.systemDefault.isDefault===true,
  "Archiving the payslip default preserves history and restores the safe system default");

const resend=(await request("/api/payslip-deliveries",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:1,method:"email",resend:true,
}})).body;
check(resend.delivery.payload.resendOf===delivery.delivery.id&&resend.delivery.payload.template.id===null,
  "Historical resend succeeds with the current default after its original template is archived");

const history=(await request(`/api/payslip-deliveries?employerId=${employerId}`)).body;
const original=history.find(item=>item.id===delivery.delivery.id);
check(original.payload.template.name==="Detailed payslip"&&original.payload.recipients[0].emailBody===recipient.emailBody,
  "Archived-template delivery evidence remains immutable in the email log");

const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.schemaVersion===7&&backup.dataset.submissions.some(item=>item.type==="EMAIL-TEMPLATE"),
  "Complete backup includes email templates and delivery evidence");
const verified=(await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}})).body;
check(verified.verified===true,"Email-template backup passes checksum and relationship validation");

const tampered=structuredClone(backup);
const row=tampered.dataset.submissions.find(item=>item.type==="EMAIL-TEMPLATE");
row.payload=row.payload.replace("Year-end P60","Tampered P60");
const {checksum,...unsigned}=tampered;
tampered.checksum={...checksum,value:createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")};
const rejected=await request("/api/data",{method:"POST",expected:[422],json:{action:"verify-backup",employerId,backup:tampered}});
check(/email-template evidence is malformed/.test(rejected.body.error),"Backup verification rejects a template whose evidence checksum is stale");

console.log(JSON.stringify({
  baseUrl,employerId,
  summary:{checks:checks.length,templateCount:templates.templates.length,deliveryCount:history.length},
  checks,
},null,2));
