import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
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
  if((response.headers.get("content-type")||"").includes("application/json")&&text)try{body=JSON.parse(text);}catch{}
  if(!expected.includes(response.status))throw new Error(
    `${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`,
  );
  return {status:response.status,body};
}

await request("/api/admin/session",{
  method:"POST",captureCookie:true,
  json:{action:"login",employerId:bootstrapEmployerId,email,password},
});
check(Boolean(cookie),"Owner authenticated for legacy recovery testing");

const name=`Legacy backup QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===name)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name,legalName:`${name} Limited`,taxYear:"2026/27",payFrequency:"monthly",firstPayDate:"2026-04-30",
    payeReference:"490/LG2026",accountsOfficeReference:"490PL12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated legacy-compatibility employer is available",{employerId});

const current=(await request(`/api/data?employerId=${employerId}`)).body;
check(current.schemaVersion===7&&Array.isArray(current.dataset.agentInvoices)&&Array.isArray(current.dataset.holidayFundEntries),"Current schema 7 backup includes agent billing and holiday-fund tables");

const schema6=structuredClone(current);
schema6.schemaVersion=6;
for(const table of ["holidayFundSettings","holidayFundEntries"]){
  delete schema6.dataset[table];
  delete schema6.counts[table];
}
delete schema6.checksum;
schema6.checksum={
  algorithm:"SHA-256",
  value:createHash("sha256").update(JSON.stringify(schema6)).digest("hex"),
};
const schema6Verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup:schema6}});
check(schema6Verified.body.verified===true&&schema6Verified.body.schemaVersion===6,
  "Schema 6 backup verifies with empty holiday-fund tables through the compatibility path");

const legacy=structuredClone(current);
legacy.schemaVersion=5;
for(const table of ["agentProfiles","agentCharges","agentInvoices","holidayFundSettings","holidayFundEntries"]){
  delete legacy.dataset[table];
  delete legacy.counts[table];
}
delete legacy.checksum;
legacy.checksum={
  algorithm:"SHA-256",
  value:createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
};

const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup:legacy}});
check(verified.body.verified===true&&verified.body.schemaVersion===5,"Schema 5 backup verifies through the compatibility path",verified.body);
const analysis=await request("/api/data",{method:"POST",json:{action:"analyse-restore",employerId,backup:legacy}});
check(Boolean(analysis.body.confirmationPhrase),"Legacy backup receives a guarded restore analysis");
const restored=await request("/api/data",{method:"POST",json:{
  action:"restore-backup",employerId,backup:legacy,confirmation:analysis.body.confirmationPhrase,currentFingerprint:analysis.body.currentFingerprint,
}});
check(restored.body.restored===true,"Schema 5 backup restores atomically into the schema 7 application");

const after=(await request(`/api/data?employerId=${employerId}`)).body;
check(after.schemaVersion===7&&after.counts.agentProfiles===0&&after.counts.agentCharges===0&&after.counts.agentInvoices===0&&after.counts.holidayFundEntries===0,
  "A restored legacy backup is re-exported as schema 7 with empty newer tables",after.counts);

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length},checks},null,2));
