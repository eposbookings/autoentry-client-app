import assert from "node:assert/strict";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!";
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

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{action:"login",employerId:bootstrapEmployerId,email,password}});
check(Boolean(cookie),"Owner authenticated for retained-version testing");

const name=`Payroll Version QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===name)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear:"2026/27",payFrequency:"monthly",
    payeReference:"496/PV2026",accountsOfficeReference:"496PV12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated employer is available for destructive recovery testing",{employerId});

const existingVersions=(await request(`/api/payroll-versions?employerId=${employerId}`)).body;
let version=existingVersions.find(item=>item.label===`Before employee ${runId}`);
if(!version){
  await request("/api/payroll-versions",{method:"POST",expected:[422],json:{action:"save",employerId,label:"x",notes:"Invalid"}});
  checks.push("Short version labels are rejected without storing a recovery point");
  version=(await request("/api/payroll-versions",{method:"POST",expected:[201],json:{
    action:"save",employerId,label:`Before employee ${runId}`,notes:"Empty employer baseline for live revert proof",
  }})).body;
}else checks.push("Existing retained version reused for an idempotent live rerun");
check(version.recordCount>0&&version.employeeCount===0&&version.backupChecksum.length===64&&Number.isFinite(Date.parse(version.createdAt)),"Retained version froze a complete checksummed baseline with an ISO creation time");

let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
if(!employees.length){
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,firstName:"Verity",lastName:"Version",payrollId:`PV-${runId}-1`,email:`version-${runId}@example.test`,
    niNumber:"CC300001C",dateOfBirth:"1991-03-12",gender:"F",address:"1 Recovery Lane, London",postcode:"SW1A 1AA",
    startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:30000,payBasis:"period",
    hourlyRate:15,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
    starterEvidence:"No P45 provided",starterDeclaration:"Statement A",employeePortal:false,portalCanEditBank:false,
    reportedPayFrequency:"monthly",
  }});
  employees=(await request(`/api/employees?employerId=${employerId}`)).body;
}
check(employees.length===1,"Current payroll was changed after the retained baseline");

await request("/api/payroll-versions",{method:"POST",expected:[404],json:{action:"analyse",employerId:bootstrapEmployerId,versionId:version.id}});
checks.push("A retained version cannot be addressed through another employer tenant");

let analysis=(await request("/api/payroll-versions",{method:"POST",json:{action:"analyse",employerId,versionId:version.id}})).body;
check(analysis.verified===true&&analysis.impact.current.employees===1&&analysis.impact.backup.employees===0,"Revert analysis reports the exact employee replacement impact");

await request("/api/payroll-versions",{method:"POST",json:{action:"archive",employerId,versionId:version.id}});
await request("/api/payroll-versions",{method:"POST",expected:[409],json:{
  action:"restore",employerId,versionId:version.id,confirmation:analysis.confirmationPhrase,currentFingerprint:analysis.currentFingerprint,
}});
checks.push("A payroll change after analysis invalidates the retained-version restore fingerprint");
analysis=(await request("/api/payroll-versions",{method:"POST",json:{action:"analyse",employerId,versionId:version.id}})).body;

await request("/api/payroll-versions",{method:"POST",expected:[422],json:{
  action:"restore",employerId,versionId:version.id,confirmation:"RESTORE",currentFingerprint:analysis.currentFingerprint,
}});
checks.push("An incorrect retained-version confirmation cannot trigger recovery");

const restored=(await request("/api/payroll-versions",{method:"POST",json:{
  action:"restore",employerId,versionId:version.id,confirmation:analysis.confirmationPhrase,currentFingerprint:analysis.currentFingerprint,
}})).body;
check(restored.restored===true&&restored.portalSessionsRevoked===true&&restored.administratorAccessPreserved===true,"Retained version restored through the atomic backup engine");

employees=(await request(`/api/employees?employerId=${employerId}`)).body;
check(employees.length===0,"Post-version employee was removed by the verified baseline restore");

const versionsAfter=(await request(`/api/payroll-versions?employerId=${employerId}`)).body;
const retained=versionsAfter.find(item=>item.id===version.id);
check(Boolean(retained?.restoredAt)&&retained.restoredBy,"Version history survived its own restore and records the restoring owner");

const backupAfter=(await request(`/api/data?employerId=${employerId}`)).body;
check(backupAfter.dataset.auditLog.some(item=>item.action==="restored:payroll-version"&&item.entityId===String(version.id)),"Version revert produced tenant-scoped audit evidence");

const archived=(await request("/api/payroll-versions",{method:"POST",json:{action:"archive",employerId,versionId:version.id}})).body;
check(archived.status==="archived","Retained recovery point can be archived without deleting its evidence");
const archivedAnalysis=(await request("/api/payroll-versions",{method:"POST",json:{action:"analyse",employerId,versionId:version.id}})).body;
check(archivedAnalysis.verified===true,"Archived recovery evidence remains verifiable and restorable");

console.log(JSON.stringify({baseUrl,employerId,versionId:version.id,summary:{checks:checks.length},checks},null,2));
