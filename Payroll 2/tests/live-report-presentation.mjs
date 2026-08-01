import assert from "node:assert/strict";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const employerId=Number(process.env.PAYFLOW_REPORT_EMPLOYER_ID||41);
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
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{action:"login",employerId,email,password}});
check(Boolean(cookie),"Owner authenticated for report-presentation testing");
const current=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
check(Boolean(current?.name),"Finalised payroll employer settings loaded");

const invalid=await request("/api/employer",{method:"PUT",expected:[422],json:{
  ...current,employerId,reportAccentColour:"#fff;body{display:none}",reportStationeryMode:"standard",
}});
check(/accent colour/.test(invalid.body.error),"CSS injection cannot enter the report colour setting");

const configured=(await request("/api/employer",{method:"PUT",json:{
  ...current,employerId,reportAccentColour:"#6B3FA0",reportHeaderText:"EPOS Accountancy Payroll Services",
  reportFooterText:"Private and confidential - keep securely",reportStationeryMode:"preprinted",
}})).body.employer;
check(configured.reportAccentColour==="#6B3FA0"&&configured.reportStationeryMode==="preprinted",
  "Employer report presentation settings persisted");

const preprinted=await request("/api/reports",{method:"POST",json:{
  employerId,taxYear:configured.taxYear,type:"p60",format:"html",
}});
check(preprinted.text.includes('class="page preprinted"')&&preprinted.text.includes(".page.preprinted{padding-top:42mm"),
  "Pre-printed stationery reserves a clear 42 mm letterhead area");
check(preprinted.text.includes("EPOS Accountancy Payroll Services")&&preprinted.text.includes("Private and confidential - keep securely"),
  "Custom report header and footer are escaped into the private document");
check(preprinted.headers.get("content-security-policy")==="default-src 'none'; style-src 'unsafe-inline'",
  "Branded HTML retains the restrictive private-document content policy");

const standard=(await request("/api/employer",{method:"PUT",json:{
  ...configured,employerId,reportStationeryMode:"standard",
}})).body.employer;
const headed=await request("/api/reports",{method:"POST",json:{
  employerId,taxYear:standard.taxYear,type:"p60",format:"html",
}});
check(headed.text.includes('class="page standard"')&&headed.text.includes("border-top:7px solid #6B3FA0"),
  "Standard stationery uses the saved employer accent colour");
const backup=(await request(`/api/data?employerId=${employerId}`)).body;
check(backup.dataset.employerSettings[0].reportAccentColour==="#6B3FA0"&&backup.dataset.employerSettings[0].reportStationeryMode==="standard",
  "Report presentation settings are included in complete backup evidence");
const verified=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup}});
check(verified.body.verified===true,"Branded employer settings pass backup verification");

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length},checks},null,2));
