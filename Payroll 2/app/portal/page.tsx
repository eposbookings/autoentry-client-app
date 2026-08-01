"use client";

import { useEffect, useState } from "react";
import { formatUkDate } from "../../lib/uk-date";

type PortalData={
  profile:{firstName:string;lastName:string;email?:string;phone?:string;address?:string;postcode?:string;bankName?:string;accountName?:string;sortCode?:string;accountNumber?:string;payrollId:string;portalCanEditBank:boolean};
  payslips:Array<{periodNumber:number;taxYear:string;grossPay:number;payeTax:number;employeeNic:number;employeePension:number;otherDeductions:number;netPay:number}>;
  p60:{taxYear:string;taxablePay:number;payeTax:number;employeeNic:number;available:boolean};p45Available:boolean;p45TaxYear:string|null;
};
type ChangeRequest={id:number;requestType:string;status:string;proposedChanges:Record<string,string|null>;reviewNote?:string;createdAt:string};
const money=(value:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(value);
const retryablePortalStatus=(status:number)=>[500,502,503,504].includes(status);
async function fetchPortalResource(url:string,init?:RequestInit){
  let lastError:unknown;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",...init});
      if(!retryablePortalStatus(response.status)||attempt===2)return response;
    }catch(error){
      lastError=error;
      if(attempt===2)throw error;
    }
    await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
  }
  throw lastError instanceof Error?lastError:new Error("The employee portal did not respond.");
}
async function readPortalJson(response:Response){
  const text=await response.text();
  if(!text)return null;
  try{return JSON.parse(text);}catch{return null;}
}

export default function EmployeePortal(){
  const [code,setCode]=useState(""),[data,setData]=useState<PortalData|null>(null),[requests,setRequests]=useState<ChangeRequest[]>([]);
  const [message,setMessage]=useState(""),[loading,setLoading]=useState(true),[employeeNote,setEmployeeNote]=useState("");
  async function load(){
    try{
      const response=await fetchPortalResource("/api/portal/me");
      if(response.status===401){setData(null);setRequests([]);return;}
      const body=await readPortalJson(response);
      if(!response.ok||!body)throw new Error(body?.error||"The employee portal is temporarily unavailable.");
      setData(body);
      const requestResponse=await fetchPortalResource("/api/portal/requests"),requestBody=await readPortalJson(requestResponse);
      if(!requestResponse.ok||!Array.isArray(requestBody))throw new Error(requestBody?.error||"Change requests could not be loaded.");
      setRequests(requestBody);
    }catch(error){
      setMessage(error instanceof Error?error.message:"The employee portal is temporarily unavailable.");
    }finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  async function signIn(){
    setMessage("");
    try{
      const response=await fetch("/api/portal/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})}),body=await readPortalJson(response);
      if(!response.ok||!body)return setMessage(body?.error||"Secure sign-in did not return a valid response.");
      setCode("");await load();
    }catch{setMessage("Secure sign-in could not reach the employee portal. Please try again.");}
  }
  async function signOut(){await fetch("/api/portal/session",{method:"DELETE"});setData(null);setRequests([]);setMessage("Signed out.");}
  async function requestChange(requestType:"contact"|"bank"){
    if(!data)return;
    try{
      const response=await fetch("/api/portal/requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...data.profile,requestType,employeeNote})}),body=await readPortalJson(response);
      setMessage(response.ok?`${requestType==="bank"?"Bank":"Contact"} change sent to payroll for approval.`:body?.error||"The change request could not be saved.");
      if(response.ok){setEmployeeNote("");await load();}
    }catch{setMessage("The change request could not reach payroll. Please try again.");}
  }
  function document(type:"payslip"|"p45"|"p60",period?:number,taxYear?:string){window.location.assign(`/api/portal/documents?type=${type}&taxYear=${encodeURIComponent(taxYear||data?.p60.taxYear||"2026/27")}${period?`&period=${period}`:""}`);}
  if(loading)return <main className="portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Employee portal</h1><p>Checking your secure session…</p></section></main>;
  if(!data)return <main className="portal-page"><section className="portal-login"><div className="brandmark">P</div><span className="eyebrow">PAYFLOW EMPLOYEE PORTAL</span><h1>View payroll documents</h1><p>Enter the one-time invitation code supplied securely by payroll.</p><label className="field"><span>Invitation code</span><input aria-label="Invitation code" value={code} onChange={event=>setCode(event.target.value)} autoComplete="one-time-code"/></label>{message&&<div className="portal-message">{message}</div>}<button className="primary" disabled={!code} onClick={signIn}>Sign in securely</button><a href="/">Return to payroll workspace</a></section></main>;
  const profile=data.profile;
  return <main className="portal-page"><header className="portal-header"><div className="brand"><div className="brandmark">P</div><div><b>PayFlow</b><small>Employee portal</small></div></div><div><b>{profile.firstName} {profile.lastName}</b><button onClick={signOut}>Sign out</button></div></header><div className="portal-shell">
    <section className="portal-hero"><span className="eyebrow">WELCOME BACK</span><h1>{profile.firstName}’s payroll documents</h1><p>Payroll ID {profile.payrollId} · Data is restricted to this signed-in employee session.</p></section>{message&&<div className="portal-message">{message}</div>}
    <div className="portal-grid"><section className="operation-card"><div className="card-head"><div><h2>Personal and payment details</h2><p>Changes are sent to payroll for approval and are never applied silently.</p></div></div><div className="form-grid form-pad">
      <PortalField label="Email" value={profile.email||""} change={value=>setData({...data,profile:{...profile,email:value}})}/><PortalField label="Phone" value={profile.phone||""} change={value=>setData({...data,profile:{...profile,phone:value}})}/><PortalField label="Address" value={profile.address||""} change={value=>setData({...data,profile:{...profile,address:value}})}/><PortalField label="Postcode" value={profile.postcode||""} change={value=>setData({...data,profile:{...profile,postcode:value}})}/>
      <PortalField disabled={!profile.portalCanEditBank} label="Bank name" value={profile.bankName||""} change={value=>setData({...data,profile:{...profile,bankName:value}})}/><PortalField disabled={!profile.portalCanEditBank} label="Account name" value={profile.accountName||""} change={value=>setData({...data,profile:{...profile,accountName:value}})}/><PortalField disabled={!profile.portalCanEditBank} label="Sort code" value={profile.sortCode||""} change={value=>setData({...data,profile:{...profile,sortCode:value}})}/><PortalField disabled={!profile.portalCanEditBank} label="Account number" value={profile.accountNumber||""} change={value=>setData({...data,profile:{...profile,accountNumber:value}})}/><PortalField label="Note to payroll" value={employeeNote} change={setEmployeeNote}/>
    </div><div className="operation-footer"><button className="primary" onClick={()=>requestChange("contact")}>Request contact changes</button><button disabled={!profile.portalCanEditBank} onClick={()=>requestChange("bank")}>Request bank changes</button></div></section>
    <aside className="calculation-panel"><span>Tax year summary</span><h2>{data.p60.taxYear||"No finalised pay"}</h2><Summary label="Taxable pay" value={data.p60.taxablePay}/><Summary label="PAYE tax" value={data.p60.payeTax}/><Summary label="Employee NIC" value={data.p60.employeeNic}/><button disabled={!data.p60.available} onClick={()=>document("p60")}>{data.p60.available?"Download P60":"P60 available after period 12"}</button>{data.p45Available&&<button onClick={()=>document("p45",undefined,data.p45TaxYear||undefined)}>Download P45</button>}</aside></div>
    <section className="operation-card portal-payslips"><div className="card-head"><div><h2>Finalised payslips</h2><p>Documents are generated from locked payroll results.</p></div></div><table><thead><tr><th>Period</th><th>Gross</th><th>PAYE</th><th>NIC</th><th>Pension</th><th>Other deductions</th><th>Net</th><th/></tr></thead><tbody>{data.payslips.map(item=><tr key={`${item.taxYear}-${item.periodNumber}`}><td><b>Period {item.periodNumber}</b><small>{item.taxYear}</small></td><td>{money(item.grossPay)}</td><td>{money(item.payeTax)}</td><td>{money(item.employeeNic)}</td><td>{money(item.employeePension)}</td><td>{money(item.otherDeductions)}</td><td><b>{money(item.netPay)}</b></td><td><button onClick={()=>document("payslip",item.periodNumber,item.taxYear)}>Download payslip</button></td></tr>)}</tbody></table>{!data.payslips.length&&<div className="empty-workflow"><p>No finalised payslips are available yet.</p></div>}</section>
    <section className="operation-card portal-payslips"><div className="card-head"><div><h2>My change requests</h2><p>Track payroll review of contact and bank amendments.</p></div></div><table><thead><tr><th>Requested</th><th>Type</th><th>Changed fields</th><th>Status</th><th>Payroll note</th></tr></thead><tbody>{requests.map(item=><tr key={item.id}><td>{formatUkDate(item.createdAt)}</td><td>{item.requestType}</td><td>{Object.keys(item.proposedChanges).join(", ")}</td><td><span className={`status ${item.status==="pending"?"amber":""}`}>{item.status}</span></td><td>{item.reviewNote||"—"}</td></tr>)}</tbody></table>{!requests.length&&<div className="empty-workflow"><p>No change requests have been submitted.</p></div>}</section>
  </div></main>;
}
function PortalField({label,value,change,disabled=false}:{label:string;value:string;change:(value:string)=>void;disabled?:boolean}){return <label className="field"><span>{label}</span><input aria-label={label} value={value} disabled={disabled} onChange={event=>change(event.target.value)}/></label>;}
function Summary({label,value}:{label:string;value:number}){return <div className="summary-line"><span>{label}</span><b>{money(value)}</b></div>;}
