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
  const text=await response.text(),contentType=response.headers.get("content-type")||"";
  let body=text;if(contentType.includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(
    `${method} ${path} returned ${response.status}; expected ${expected.join("/")}: ${typeof body==="string"?body:JSON.stringify(body)}`
  );
  return {status:response.status,body,text,headers:response.headers};
}

async function approve(id,employerId){
  return (await request("/api/submissions",{method:"PUT",json:{employerId,id,declarationAccepted:true}})).body;
}

async function recordResult({id,employerId,outcome,reference,submittedAt,responseCode,responseMessage}){
  return (await request("/api/submissions",{method:"PUT",json:{
    action:"record-filing-result",employerId,id,outcome,submittedAt,
    acknowledgementReference:reference,responseCode,responseMessage,evidenceSource:"external-import",
  }})).body;
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for the RTI filing-state lifecycle");

const created=(await request("/api/scenarios",{method:"POST",expected:[201],json:{
  action:"create-isolated-sample",confirmation:"CREATE ISOLATED SAMPLE",
}})).body;
const employerId=created.employerId;
const employees=(await request(`/api/employees?employerId=${employerId}`)).body;
check(employees.length===20,"RTI lifecycle uses the complete isolated employee variation set");

const schedule=scheduledPayPeriods(taxYear,"monthly","2026-04-30");
const records=()=>employees.map(employee=>{
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
for(const period of schedule.slice(0,2)){
  const result=(await request("/api/pay-runs",{method:"POST",json:{
    action:"finalise",source:"manual",employerId,taxYear,periodNumber:period.periodNumber,payDate:period.payDate,employees:records(),
  }})).body;
  check(result.status==="finalised",`RTI source period ${period.periodNumber} finalised`);
}

const withdrawnNvr=await request("/api/submissions",{method:"POST",expected:[422],json:{
  employerId,type:"NVR",taxYear,payrollId:employees[0].payrollId,
}});
check(withdrawnNvr.body.payload.serviceStatus==="withdrawn"&&withdrawnNvr.body.payload.withdrawnDate==="2025-02-03",
  "NVR is blocked with the withdrawn-service date and FPS replacement workflow");

const rejectedFpsDraft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"FPS",taxYear,periodNumber:1,finalSubmission:false,
}})).body;
const prematureResult=await request("/api/submissions",{method:"PUT",expected:[422],json:{
  action:"record-filing-result",employerId,id:rejectedFpsDraft.submission.id,outcome:"accepted",
  submittedAt:"2026-04-30T10:00:00Z",acknowledgementReference:"HMRC-FPS-P1-PREMATURE",
}});
check(/test-ready or submitted/.test(prematureResult.body.error),
  "A merely validated FPS cannot receive external HMRC evidence");
await approve(rejectedFpsDraft.submission.id,employerId);
const rejectedFps=await recordResult({
  id:rejectedFpsDraft.submission.id,employerId,outcome:"rejected",reference:"HMRC-FPS-P1-REJECTED",
  submittedAt:"2026-04-30T10:05:00Z",responseCode:"1001",responseMessage:"Demonstration schema rejection.",
});
check(rejectedFps.submission.status==="rejected"&&rejectedFps.evidence.liveTransmissionPerformedByPayFlow===false,
  "Rejected FPS evidence is retained without claiming PayFlow transmission");

const acceptedFpsDraft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"FPS",taxYear,periodNumber:1,finalSubmission:false,
}})).body;
check(acceptedFpsDraft.submission.id!==rejectedFpsDraft.submission.id,
  "A rejected FPS can be replaced by a fresh source-bound package");
await approve(acceptedFpsDraft.submission.id,employerId);
const acceptedFps=await recordResult({
  id:acceptedFpsDraft.submission.id,employerId,outcome:"accepted",reference:"HMRC-FPS-P1-ACCEPTED",
  submittedAt:"2026-04-30T10:10:00Z",responseCode:"0",responseMessage:"Accepted by the external test evidence source.",
});
check(acceptedFps.submission.status==="accepted"&&acceptedFps.submission.correlationId==="HMRC-FPS-P1-ACCEPTED",
  "Replacement FPS reaches accepted status only with a unique external acknowledgement");
const terminalReplay=await request("/api/submissions",{method:"PUT",expected:[422],json:{
  action:"record-filing-result",employerId,id:acceptedFpsDraft.submission.id,outcome:"accepted",
  submittedAt:"2026-04-30T10:11:00Z",acknowledgementReference:"HMRC-FPS-P1-REPLAY",
}});
check(/test-ready or submitted/.test(terminalReplay.body.error),"Terminal RTI evidence cannot be replayed");
const duplicateFps=await request("/api/submissions",{method:"POST",expected:[422],json:{
  employerId,type:"FPS",taxYear,periodNumber:1,finalSubmission:false,
}});
check(/accepted FPS already exists/.test(duplicateFps.body.validation.errors.join(" ")),
  "An accepted FPS forces later corrections through Additional FPS");

const fps2Draft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"FPS",taxYear,periodNumber:2,finalSubmission:false,
}})).body;
await approve(fps2Draft.submission.id,employerId);
await recordResult({
  id:fps2Draft.submission.id,employerId,outcome:"accepted",reference:"HMRC-FPS-P2-ACCEPTED",
  submittedAt:"2026-05-29T10:00:00Z",responseCode:"0",responseMessage:"Accepted.",
});
check(true,"Period 2 FPS established the accepted baseline for correction testing");

const adjustment=(await request("/api/adjustments",{method:"POST",expected:[201],json:{
  employerId,taxYear,periodNumber:2,payrollId:employees[0].payrollId,type:"paye-tax",amount:10,
  reason:"External filing lifecycle correction test.",
}})).body;
check(adjustment.finalisedCorrection===true&&adjustment.additionalFpsRequired===true,
  "An audited finalised PAYE correction explicitly requires Additional FPS");

const additionalDraft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"Additional FPS",taxYear,periodNumber:2,lateReason:"H",
  correctionReason:"Correct PAYE deducted after the original accepted FPS.",
}})).body;
check(additionalDraft.payload.correctionOfSubmissionId===fps2Draft.submission.id&&
  additionalDraft.payload.employees.some(employee=>employee.payrollId===employees[0].payrollId&&employee.payeTax===10),
  "Additional FPS reports the delta against the accepted period-2 baseline");
await approve(additionalDraft.submission.id,employerId);
const rejectedAdditional=await recordResult({
  id:additionalDraft.submission.id,employerId,outcome:"rejected",reference:"HMRC-AFPS-P2-REJECTED",
  submittedAt:"2026-06-01T09:00:00Z",responseCode:"2002",responseMessage:"Demonstration correction rejection.",
});
check(rejectedAdditional.submission.status==="rejected","Rejected Additional FPS retains its correction lineage");

const replacementAdditional=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"Additional FPS",taxYear,periodNumber:2,lateReason:"H",
  correctionReason:"Resubmit the corrected PAYE deduction after rejection.",
}})).body;
await approve(replacementAdditional.submission.id,employerId);
const acceptedAdditional=await recordResult({
  id:replacementAdditional.submission.id,employerId,outcome:"accepted",reference:"HMRC-AFPS-P2-ACCEPTED",
  submittedAt:"2026-06-01T09:10:00Z",responseCode:"0",responseMessage:"Accepted.",
});
check(acceptedAdditional.submission.status==="accepted","Replacement Additional FPS records accepted external evidence");
const unchangedAdditional=await request("/api/submissions",{method:"POST",expected:[422],json:{
  employerId,type:"Additional FPS",taxYear,periodNumber:2,lateReason:"H",
  correctionReason:"Attempt a correction without any new changed values.",
}});
check(/no changed period values/.test(unchangedAdditional.body.validation.errors.join(" ")),
  "Additional FPS cannot be generated when no values changed after the accepted correction");

const eps1Draft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"EPS",taxYear,periodNumber:1,employmentAllowance:true,
}})).body;
await approve(eps1Draft.submission.id,employerId);
const duplicateReference=await request("/api/submissions",{method:"PUT",expected:[409],json:{
  action:"record-filing-result",employerId,id:eps1Draft.submission.id,outcome:"accepted",
  submittedAt:"2026-05-10T11:00:00Z",acknowledgementReference:"HMRC-FPS-P1-ACCEPTED",
}});
check(/already attached/.test(duplicateReference.body.error),
  "One HMRC acknowledgement reference cannot be attached to two filing packages");
const acceptedEps=await recordResult({
  id:eps1Draft.submission.id,employerId,outcome:"accepted",reference:"HMRC-EPS-M1-ACCEPTED",
  submittedAt:"2026-05-10T11:05:00Z",responseCode:"0",responseMessage:"Accepted.",
});
check(acceptedEps.submission.status==="accepted","EPS accepted evidence is retained independently of FPS");

const benefit=(await request("/api/benefits",{method:"POST",expected:[201],json:{
  employerId,payrollId:employees[0].payrollId,taxYear,category:"Vouchers and credit cards",
  description:"Demonstration non-payrolled benefit",cashEquivalent:600,nicTreatment:"class-1a",payrolled:false,
}})).body;
await request("/api/benefits",{method:"PUT",json:{employerId,id:benefit.id,status:"reviewed"}});
const exbDraft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"EXB",taxYear,
}})).body;
check(exbDraft.payload.benefits.length===1&&exbDraft.payload.totals.cashEquivalent===600,
  "EXB reconciles only reviewed expenses-and-benefits evidence");
await approve(exbDraft.submission.id,employerId);
const acceptedExb=await recordResult({
  id:exbDraft.submission.id,employerId,outcome:"accepted",reference:"HMRC-EXB-2026-ACCEPTED",
  submittedAt:"2026-07-06T09:00:00Z",responseCode:"0",responseMessage:"Accepted.",
});
check(acceptedExb.submission.status==="accepted","EXB accepts external acknowledgement evidence");

const eps2Draft=(await request("/api/submissions",{method:"POST",expected:[201],json:{
  employerId,type:"EPS",taxYear,periodNumber:2,employmentAllowance:true,
}})).body;
const preparedEps2=await approve(eps2Draft.submission.id,employerId);
check(preparedEps2.status==="test-ready","A second EPS entered the adapter-ready queue");
const employer=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
const identityUpdate=(await request("/api/employer",{method:"PUT",json:{
  ...employer,employerId,payeReference:"999/DEMO27",accountsOfficeReference:"999PD00000001",
}})).body;
check(identityUpdate.supersededRtiPackages===1,
  "Changing PAYE identifiers superseded the unfiled RTI package but preserved terminal evidence");
const staleResult=await request("/api/submissions",{method:"PUT",expected:[422],json:{
  action:"record-filing-result",employerId,id:eps2Draft.submission.id,outcome:"accepted",
  submittedAt:"2026-06-10T09:00:00Z",acknowledgementReference:"HMRC-EPS-M2-STALE",
}});
check(/test-ready or submitted/.test(staleResult.body.error),
  "A superseded package cannot receive external filing evidence");

const history=(await request(`/api/submissions?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
const statusCount=status=>history.filter(item=>item.status===status).length;
check(statusCount("accepted")===5&&statusCount("rejected")===2&&statusCount("superseded")===1,
  "RTI history retains accepted, rejected and superseded evidence without rewriting outcomes",
  {accepted:statusCount("accepted"),rejected:statusCount("rejected"),superseded:statusCount("superseded")});

console.log(JSON.stringify({
  baseUrl,employerId,employerName:created.employerName,
  summary:{checks:checks.length,employees:employees.length,history:history.length,
    accepted:statusCount("accepted"),rejected:statusCount("rejected"),superseded:statusCount("superseded")},
  checks,
},null,2));
