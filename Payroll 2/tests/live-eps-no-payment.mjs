import assert from "node:assert/strict";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://127.0.0.1:3102";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!",taxYear="2026/27";
let cookie="";

async function request(path,{method="GET",json,expected=[200],captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{method,headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},body:json===undefined?undefined:JSON.stringify(json)});
  if(captureCookie){const value=response.headers.get("set-cookie");if(value)cookie=value.split(";")[0];}
  const text=await response.text(),body=text&&response.headers.get("content-type")?.includes("application/json")?JSON.parse(text):text;
  assert.ok(expected.includes(response.status),`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return body;
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{action:"login",employerId:bootstrapEmployerId,email,password}});
assert.ok(cookie,"administrator session was created");

const created=await request("/api/scenarios",{method:"POST",expected:[201],json:{action:"create-isolated-sample",confirmation:"CREATE ISOLATED SAMPLE"}});
const employerId=created.employerId;
const employees=await request(`/api/employees?employerId=${employerId}`);
for(const employee of employees)await request("/api/employees",{method:"DELETE",json:{employerId,id:employee.id}});
assert.equal((await request(`/api/employees?employerId=${employerId}`)).length,0,"test employer has no employees");

const missingDeclaration=await request("/api/submissions",{method:"POST",expected:[422],json:{employerId,type:"EPS",taxYear,periodNumber:1}});
assert.match(missingDeclaration.validation.errors.join(" "),/EPS requires a no-payment declaration/);

const prepared=await request("/api/submissions",{method:"POST",expected:[201],json:{employerId,type:"EPS",taxYear,periodNumber:1,noPaymentForPeriod:true}});
assert.equal(prepared.payload.noPaymentForPeriod,true);
assert.equal(prepared.payload.payroll.payRecords,0);
assert.equal(prepared.payload.payroll.employeesWithPayments,0);
assert.deepEqual(prepared.payload.reportingWindow,{start:"2026-04-06",end:"2026-05-05",deadline:"2026-05-19"});
assert.equal(prepared.submission.payPeriodId,null);
assert.equal(prepared.submission.dueDate,"2026-05-19");

const undeclaredApproval=await request("/api/submissions",{method:"PUT",expected:[422],json:{employerId,id:prepared.submission.id,declarationAccepted:false}});
assert.match(undeclaredApproval.error,/accuracy declaration must be accepted/);
const approved=await request("/api/submissions",{method:"PUT",json:{employerId,id:prepared.submission.id,declarationAccepted:true}});
assert.equal(approved.status,"test-ready");

console.log(JSON.stringify({baseUrl,employerId,employees:0,submissionId:approved.id,status:approved.status,dueDate:approved.dueDate,reportingWindow:prepared.payload.reportingWindow},null,2));
