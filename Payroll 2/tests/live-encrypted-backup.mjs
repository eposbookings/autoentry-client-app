import assert from "node:assert/strict";
import { decryptPayrollBackup,encryptPayrollBackup,isEncryptedPayrollBackup } from "../lib/backup-encryption.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const employerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const password="PayFlow-Live-QA-2026!";
const backupPassword="PayFlow encrypted live recovery 2026!";
let cookie="";
const checks=[];

function check(condition,message){
  assert.ok(condition,message);
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
  try{body=text?JSON.parse(text):null;}catch{}
  assert.ok(expected.includes(response.status),`${method} ${path} returned ${response.status}: ${text}`);
  return body;
}

await request("/api/admin/session",{
  method:"POST",captureCookie:true,
  json:{email:"qa-live@payflow.local",password,employerId},
});
check(Boolean(cookie),"Administrator authentication established for protected-backup QA");

const backup=await request(`/api/data?employerId=${employerId}`);
check(backup.schemaVersion===7&&backup.employerId===employerId,"Complete schema-7 employer backup downloaded");

const encrypted=await encryptPayrollBackup(backup,backupPassword);
check(isEncryptedPayrollBackup(encrypted)&&!JSON.stringify(encrypted).includes(backupPassword),"Backup encrypted without storing its password");

const decrypted=await decryptPayrollBackup(encrypted,backupPassword,employerId);
check(decrypted.checksum.value===backup.checksum.value,"Protected backup decrypted to the original checksummed payload");

const verification=await request("/api/data",{method:"POST",json:{action:"verify-backup",employerId,backup:decrypted}});
check(verification.verified===true&&verification.checksum===backup.checksum.value,"Decrypted backup passed server-side tenant and relationship verification");

await assert.rejects(()=>decryptPayrollBackup(encrypted,"Wrong protected backup password",employerId),/could not be opened/);
checks.push("Wrong protected-backup password was rejected before server verification");

const tampered={...encrypted,ciphertext:`${encrypted.ciphertext.slice(0,-2)}AA`};
await assert.rejects(()=>decryptPayrollBackup(tampered,backupPassword,employerId),/could not be opened/);
checks.push("Ciphertext tampering was rejected by authenticated encryption");

console.log(JSON.stringify({baseUrl,employerId,summary:{checks:checks.length,records:Object.values(backup.counts).reduce((sum,value)=>sum+Number(value),0)},checks},null,2));
