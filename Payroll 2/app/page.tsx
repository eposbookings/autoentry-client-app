"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { calculateMonthlyPayroll, calculateStatutoryPay, p45OpeningBalances, solveGrossForTargetNet } from "../lib/payroll-engine";
import { attachmentPriority, calculateAttachment } from "../lib/attachment-engine";
import { employeeActiveInRange, statutoryPayAllocationForRange } from "../lib/pay-periods";
import { assessStatutoryEligibility } from "../lib/statutory-eligibility";
import { assessNeonatalCareClaim } from "../lib/neonatal-care";
import { assessFamilyPayClaim, assessMaternityAdoptionPayClaim } from "../lib/family-pay";
import { assessStatutoryTouchDays, type StatutoryTouchDay } from "../lib/statutory-touch-days";
import { assessStatutoryWorkedWeeks, type StatutoryWorkedWeek } from "../lib/statutory-work-weeks";
import { automaticStatutoryPayEndDate, automaticStatutoryPayWeeks } from "../lib/statutory-schedule";
import { countWorkingDays, defaultWorkingWeekdays } from "../lib/working-days";
import { leaveEntitlementBalance } from "../lib/leave-entitlement";
import { calculateCompanyCarBenefit, type CompanyCarFuel } from "../lib/company-car-benefit";
import { calculateCompanyVanBenefit, type CompanyVanUse } from "../lib/company-van-benefit";
import { calculateBeneficialLoan } from "../lib/beneficial-loan";
import { calculateLivingAccommodation } from "../lib/living-accommodation";
import { benefitCategories, classifyBenefit, class1aForBenefit, type BenefitNicTreatment } from "../lib/benefit-classification";
import { cisVerificationDecision } from "../lib/cis-verification";
import { addCalendarMonths } from "../lib/calendar-months";
import { allocateEmployeeLoanRecoveries } from "../lib/employee-loans";
import { calculateMileageAllowance, type MileageVehicle } from "../lib/mileage-allowance";
import { calculateChildcareVoucher, childcareVoucherLimit, childcareVoucherName, type ChildcareTaxBand } from "../lib/childcare-vouchers";
import { applyCashPayRounding } from "../lib/pay-rounding";
import { totalPayrolledBenefitsForRange } from "../lib/payrolled-benefits";
import { assessPension, assessPensionAtDate } from "../lib/pension-engine";
import { validatePayDetailsImportRows, type PreparedPayDetail } from "../lib/pay-details-import";
import { annualPayPeriodDivisor, payrollFrequencyRule, scheduledPayPeriods, type PayrollFrequency, type ScheduledPayPeriod } from "../lib/pay-frequency";
import { decryptPayrollBackup, encryptPayrollBackup, isEncryptedPayrollBackup } from "../lib/backup-encryption";
import { formatUkDate, formatUkDateTime } from "../lib/uk-date";
import { defaultPayslipDesign, normalisePayslipDesign, type PayslipDesign } from "../lib/payslip-design";

type Employee = {
  id: number; payrollId?:string; name: string; role: string; department: string; taxCode: string;
  title?:string;firstName?:string;middleNames?:string;lastName?:string;
  ni: string; pay: number; hours: number; rate: number; email: string; status: string;
  dateOfBirth?:string;gender?:string;address?:string;postcode?:string;
  startDate?: string; leavingDate?: string; starterEvidence?: string; starterDeclaration?: string;
  p45LeavingDate?: string; p45PreviousPay?: number; p45PreviousTax?: number; p45ReceivedAfterPayroll?:boolean;p60TaxYear?: string;p60ReferenceOnly?:boolean;
  week1Month1?: boolean; niNumber?: string; director?: boolean; directorStart?:string;directorEnd?:string;alternativeDirectorNic?: boolean;
  noSecondaryNic?: boolean; studentLoanPlan?: "1" | "2" | "4" | "5" | null; postgraduateLoan?: boolean;
  statutoryPayPreview?:number;
  worksNumber?:string;contractedHours?:number;minimumWageCategory?:"age-based"|"apprentice";apprenticeshipStartDate?:string;annualLeaveDays?:number;paymentMethod?:string;bankName?:string;accountName?:string;sortCode?:string;accountNumber?:string;
  annualSalary?:number;payBasis?:"period"|"hourly"|"daily";dailyRate?:number;workingDaysPerWeek?:number;
  irregularPayment?:boolean;zeroPayFpsExclusion?:boolean;reportedPayFrequency?:string;workplacePostcode?:string;previousPayrollId?:string;paymentToBody?:boolean;trivialCommutation?:boolean;flexibleDrawdown?:boolean;employeePortal?:boolean;confidential?:boolean;nationality?:string;passportNumber?:string;maritalStatus?:string;
  portalCanEditBank?:boolean;managerName?:string;emergencyContactName?:string;emergencyContactPhone?:string;emergencyContactRelationship?:string;medicalInformation?:string;hrNotes?:string;hrNotesConfidential?:boolean;
  postLeavingPayment?:boolean;
  postLeavingNicBasis?:"usual"|"weekly";
  postLeavingP45Issued?:boolean;
  pensionStatus?:string;pensionEmployeeRate?:number;pensionEmployerRate?:number;pensionBasis?:"qualifying"|"gross";pensionTaxRelief?:"relief-at-source"|"net-pay";
  payItems?: PayLine[];
};
type PayLine={id:number;type:"earning"|"benefit"|"pre-tax-deduction"|"post-tax-deduction"|"salary-sacrifice"|"payroll-giving"|"childcare-voucher";name:string;amount:number;taxable:boolean;nicable:boolean;pensionable:boolean;quantity?:number;rate?:number;recurringItemId?:number|null};
type PayrollEntryDraft=Partial<Pick<Employee,"pay"|"hours"|"rate"|"payItems"|"postLeavingPayment"|"postLeavingNicBasis"|"postLeavingP45Issued">>;
type PersistedPeriod={id:number;periodNumber:number;status:string;payDate?:string|null};
type PersistedRun={id:number;payPeriodId:number;employeeId:number;grossPay:number;taxablePay:number;nicablePay:number;payeTax:number;employeeNic:number;employerNic:number;employeePension:number;employerPension:number;statutoryPay:number;netPay:number;payrollNote?:string|null;rtiSnapshot?:string|null;pensionSnapshot?:string|null;status:string};
type PersistedItem={id:number;payRunId:number;type:PayLine["type"];name:string;quantity:number;rate:number;amount:number;taxable:boolean;nicable:boolean;pensionable:boolean;recurringItemId?:number|null};
type RtiWorkflowTask={type:"FPS"|"EPS_NO_PAYMENT";periodNumber:number;taxMonth:number;reason:string};
type PayrollWorkflowStatus={rti:{count:number;periods:number[];tasks:RtiWorkflowTask[]};pensions:{count:number;periods:number[]}};
const emptyPayrollWorkflowStatus:PayrollWorkflowStatus={rti:{count:0,periods:[],tasks:[]},pensions:{count:0,periods:[]}};
type PayrollOpeningBalance={id:number;employeeId:number;taxYear:string;firstPayFlowPeriod:number;grossPay:number;taxablePay:number;payeTax:number;nicablePay:number;employeeNic:number;employerNic:number;studentLoan:number;postgraduateLoan:number;statutoryPay:number;employeePension:number;employerPension:number;netPay:number;nicCategoryBreakdown?:string;source?:string;notes?:string|null;payloadChecksum?:string};
type CalculationHistory={ytdTaxablePay:number;ytdTaxPaid:number;ytdNicablePay:number;ytdEmployeeNic:number;ytdEmployerNic:number};

const tabs = ["Payroll", "Analysis", "Employees", "Employer", "HMRC", "RTI", "CIS", "Pensions", "Reports", "Clients", "Tools"];
const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const formTabs = ["Personal", "Employment", "Starter / leaver", "Payment", "Tax & NICs", "RTI", "HR"];
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const deductionMoney = (n: number) => n > 0 ? `−${money(n)}` : money(0);
const roundMoney=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const formatTimestamp=(value:unknown)=>formatUkDateTime(value,"Date unavailable");
const downloadClientBlob=(blob:Blob,filename:string)=>{const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);};
const retryableWorkspaceStatus=(status:number)=>[500,502,503,504].includes(status);
const fetchWorkspaceResource=async(url:string,init?:RequestInit)=>{
  let lastError:unknown;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",...init});
      if(!retryableWorkspaceStatus(response.status)||attempt===2)return response;
    }catch(error){
      lastError=error;
      if(attempt===2)throw error;
    }
    await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
  }
  throw lastError instanceof Error?lastError:new Error("Payroll service did not respond.");
};
const readJsonResponse=async(response:Response)=>{
  const text=await response.text();
  if(!text)return null;
  try{return JSON.parse(text);}catch{return null;}
};
const periodicBasePay=(employee:Pick<Employee,"payBasis"|"annualSalary"|"rate"|"contractedHours"|"dailyRate"|"workingDaysPerWeek"|"pay">,frequency:PayrollFrequency="monthly")=>{
  const divisor=annualPayPeriodDivisor(frequency);
  if(employee.payBasis==="hourly")return Math.round((employee.rate||0)*(employee.contractedHours||0)*52/divisor*100)/100;
  if(employee.payBasis==="daily")return Math.round((employee.dailyRate||0)*(employee.workingDaysPerWeek||0)*52/divisor*100)/100;
  return Math.round(Number(employee.annualSalary??employee.pay*divisor)/divisor*100)/100;
};
const employeeRecordNeedsAttention=(employee:Partial<Employee>)=>
  !employee.payrollId?.trim()||!employee.firstName?.trim()||!employee.lastName?.trim()||
  !employee.dateOfBirth||!employee.gender||!employee.address?.trim()||!employee.postcode?.trim()||!employee.startDate;
type EmployerId=number;
const EmployerContext=createContext<EmployerId>(1);
const useEmployerId=()=>useContext(EmployerContext);
const TaxYearContext=createContext("2026/27");
const useTaxYear=()=>useContext(TaxYearContext);
const PayFrequencyContext=createContext<PayrollFrequency>("monthly");
const usePayFrequency=()=>useContext(PayFrequencyContext);
const FirstPayDateContext=createContext("");
const useFirstPayDate=()=>useContext(FirstPayDateContext);
const taxYearStartYear=(taxYear:string)=>Number(taxYear.slice(0,4));
const taxYearSlug=(taxYear:string)=>taxYear.replace("/","-");
const fallbackPayrollId=(employee:Pick<Employee,"id">,taxYear:string)=>`PAY-${employee.id}-${taxYearStartYear(taxYear)}`;
const nextOpenPeriod=(finalised:number[],maximum=12)=>Array.from({length:maximum},(_,index)=>index+1).find(number=>!finalised.includes(number))||maximum;
const latestContiguousPeriod=(finalised:number[],maximum=12)=>{
  let latest=0;
  while(latest<maximum&&finalised.includes(latest+1))latest++;
  return latest;
};
function periodPayDate(period:number,taxYear="2026/27"){
  const startYear=Number(taxYear.slice(0,4)),monthIndex=(period+2)%12,year=period<=9?startYear:startYear+1,date=new Date(Date.UTC(year,monthIndex+1,0));
  return {iso:date.toISOString().slice(0,10),label:new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(date)};
}
const isoDay=(value:string)=>Date.parse(`${value}T00:00:00Z`);
function previousMonthlyPayDate(payDate:string){
  const current=new Date(`${payDate}T00:00:00Z`),year=current.getUTCFullYear(),month=current.getUTCMonth(),day=current.getUTCDate();
  const previousMonthLastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  return new Date(Date.UTC(year,month-1,Math.min(day,previousMonthLastDay))).toISOString().slice(0,10);
}
const elapsedPayDays=(fromDate:string,toDate:string)=>Math.max(1,Math.round((isoDay(toDate)-isoDay(fromDate))/86_400_000));
function rtiEpsDeadline(period:number,taxYear="2026/27"){
  const date=new Date(Date.UTC(taxYearStartYear(taxYear),3+period,19));
  return {iso:date.toISOString().slice(0,10),label:new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(date)};
}
function cisTaxMonthDates(taxMonth:number,taxYear="2026/27"){
  const startYear=Number(taxYear.slice(0,4));
  const start=new Date(Date.UTC(startYear,3+taxMonth-1,6)),end=new Date(Date.UTC(startYear,3+taxMonth,5)),due=new Date(Date.UTC(startYear,3+taxMonth,19));
  const label=(date:Date)=>new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(date);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),due:due.toISOString().slice(0,10),range:`${label(start)} to ${label(end)}`,endLabel:label(end)};
}
function currentCisTaxMonth(taxYear:string){
  const today=new Date().toISOString().slice(0,10);
  const matched=Array.from({length:12},(_,index)=>index+1).find(month=>{
    const range=cisTaxMonthDates(month,taxYear);
    return today>=range.start&&today<=range.end;
  });
  if(matched)return matched;
  return today<cisTaxMonthDates(1,taxYear).start?1:12;
}
function parseCsvRecords(text:string,requiredHeaders=["payrollId","firstName","lastName"],recordName="employee"){
  const table:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='"'&&quoted&&text[index+1]==='"'){cell+='"';index++;continue;}
    if(char==='"'){quoted=!quoted;continue;}
    if(char===","&&!quoted){row.push(cell);cell="";continue;}
    if((char==="\n"||char==="\r")&&!quoted){
      if(char==="\r"&&text[index+1]==="\n")index++;
      row.push(cell);if(row.some(value=>value.trim()))table.push(row);row=[];cell="";continue;
    }
    cell+=char;
  }
  if(quoted)throw new Error("CSV contains an unclosed quoted value.");
  row.push(cell);if(row.some(value=>value.trim()))table.push(row);
  if(table.length<2)throw new Error(`CSV must contain a header and at least one ${recordName} row.`);
  const headers=table[0].map((value,index)=>index===0?value.replace(/^\uFEFF/,"").trim():value.trim());
  if(headers.some(value=>!value)||new Set(headers).size!==headers.length)throw new Error("CSV headers must be present and unique.");
  for(const required of requiredHeaders)if(!headers.includes(required))throw new Error(`CSV is missing required header ${required}.`);
  return table.slice(1).map((values,rowIndex)=>{
    if(values.length!==headers.length)throw new Error(`CSV row ${rowIndex+2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header,index)=>[header,values[index].trim()]));
  });
}
function calculateEmployeePeriod(employee:Employee,period:number,taxYear="2026/27",history?:CalculationHistory,automaticLoanDeduction=0,automaticPayrolledBenefits=0,automaticClass1Benefits=0,frequency:PayrollFrequency="monthly",scheduled?:ScheduledPayPeriod,allScheduled?:ScheduledPayPeriod[]) {
  const schedule=scheduled||scheduledPayPeriods(taxYear,frequency)[period-1],range={start:isoDay(schedule.periodStart),end:isoDay(schedule.periodEnd)};
  const active=employeeActiveInRange(employee.startDate,employee.leavingDate,schedule.periodStart,schedule.periodEnd);
  const postLeaving=Boolean(employee.postLeavingPayment&&employee.leavingDate&&Date.parse(`${employee.leavingDate}T00:00:00Z`)<range.start);
  if(!active&&!postLeaving)return {gross:0,tax:0,employeeNic:0,employerNic:0,pension:0,employerPension:0,net:0,employerCost:0,warnings:["Employee is outside their recorded employment dates for this period."]};
  const baseLines:PayLine[]=[{id:-1,type:"earning",name:`${payrollFrequencyRule(frequency).label} salary`,amount:employee.pay,taxable:true,nicable:true,pensionable:true},{id:-2,type:"earning",name:"Additional hours",amount:employee.hours*employee.rate,taxable:true,nicable:true,pensionable:true}];
  const lines=[...baseLines,...(employee.payItems||[])],earnings=lines.filter(line=>line.type==="earning"),salarySacrifice=lines.filter(line=>line.type==="salary-sacrifice"),childcareVouchers=lines.filter(line=>line.type==="childcare-voucher"),preTaxLines=lines.filter(line=>["pre-tax-deduction","payroll-giving"].includes(line.type));
  const sacrifice=salarySacrifice.reduce((sum,line)=>sum+line.amount,0),childcareSacrifice=childcareVouchers.reduce((sum,line)=>sum+line.amount,0),cashSacrifice=sacrifice+childcareSacrifice,gross=Math.max(0,earnings.reduce((sum,line)=>sum+line.amount,0)-cashSacrifice),taxableGross=Math.max(0,earnings.filter(line=>line.taxable).reduce((sum,line)=>sum+line.amount,0)-cashSacrifice),nicableGross=Math.max(0,earnings.filter(line=>line.nicable).reduce((sum,line)=>sum+line.amount,0)-cashSacrifice-preTaxLines.filter(line=>line.nicable).reduce((sum,line)=>sum+line.amount,0)+lines.filter(line=>line.type==="benefit"&&line.nicable).reduce((sum,line)=>sum+line.amount,0)),pensionableGross=Math.max(0,earnings.filter(line=>line.pensionable).reduce((sum,line)=>sum+line.amount,0)-salarySacrifice.filter(line=>!line.pensionable).reduce((sum,line)=>sum+line.amount,0)-childcareVouchers.filter(line=>!line.pensionable).reduce((sum,line)=>sum+line.amount,0)-preTaxLines.filter(line=>line.pensionable).reduce((sum,line)=>sum+line.amount,0));
  const preTaxDeductions=preTaxLines.reduce((sum,line)=>sum+line.amount,0),taxablePreTaxDeductions=preTaxLines.filter(line=>line.taxable).reduce((sum,line)=>sum+line.amount,0);
  const taxableBenefits=lines.filter(line=>line.type==="benefit"&&line.taxable).reduce((sum,line)=>sum+line.amount,0),postTaxDeductions=lines.filter(line=>line.type==="post-tax-deduction").reduce((sum,line)=>sum+line.amount,0)+automaticLoanDeduction;
  const pensionActive=employee.pensionStatus==="active"&&!postLeaving;
  const postLeavingTaxCode=/^S/i.test(employee.taxCode)?"S0T":/^C/i.test(employee.taxCode)?"C0T":"0T";
  const fullSchedule=allScheduled||scheduledPayPeriods(taxYear,frequency);
  const directorStartPeriod=employee.directorStart?fullSchedule.find(item=>employee.directorStart!>=item.periodStart&&employee.directorStart!<=item.periodEnd)?.periodNumber||1:1;
  const directorEarningsPeriodWeeks=employee.directorStart?Math.max(1,Math.min(52,Math.ceil((Date.UTC(taxYearStartYear(taxYear)+1,3,5)-Date.parse(`${employee.directorStart}T00:00:00Z`))/604_800_000))):52;
  const finalDirectorPeriod=Boolean(employee.director&&employee.alternativeDirectorNic&&(period===fullSchedule.length||[employee.directorEnd,employee.leavingDate].filter(Boolean).some(value=>String(value)>=schedule.periodStart&&String(value)<=schedule.periodEnd)));
  const result=calculateMonthlyPayroll({grossPay:gross,taxableGrossPay:taxableGross,nicableGrossPay:nicableGross+automaticClass1Benefits,pensionableGrossPay:pensionableGross,taxableBenefits:taxableBenefits+automaticPayrolledBenefits,preTaxDeductions,taxablePreTaxDeductions,postTaxDeductions,employerPensionAdditional:sacrifice,statutoryPay:postLeaving?0:employee.statutoryPayPreview||0,taxCode:postLeaving?postLeavingTaxCode:employee.taxCode,week1Month1:postLeaving?true:employee.week1Month1,niCategory:employee.ni,noSecondaryNic:employee.noSecondaryNic,studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,directorMethod:employee.alternativeDirectorNic?"alternative":"annual",directorStartPeriod,directorEarningsPeriodWeeks,finalDirectorPeriod,earningsPeriod:postLeaving&&employee.postLeavingNicBasis!=="usual"?"weekly":frequency==="monthly"?"monthly":"weekly",payFrequency:frequency,taxWeekNumber:schedule.taxWeekNumber,pensionEmployeeRate:pensionActive?employee.pensionEmployeeRate||0:0,pensionEmployerRate:pensionActive?employee.pensionEmployerRate||0:0,pensionBasis:employee.pensionBasis||"qualifying",pensionTaxRelief:employee.pensionTaxRelief||"relief-at-source",contractedHours:employee.contractedHours,periodNumber:period,...history});
  return {gross:result.grossPay,tax:result.incomeTax,employeeNic:result.employeeNic,employerNic:result.employerNic,pension:result.employeePension,employerPension:result.employerPension,net:result.netPay,employerCost:result.employerCost,warnings:result.warnings};
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function EmployerSwitcher({memberships,activeEmployerId,onChange}:{memberships:any[];activeEmployerId:EmployerId;onChange:(id:EmployerId)=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const activeMembership=memberships.find(membership=>membership.employerId===activeEmployerId)||memberships[0];
  const normalised=query.trim().toLowerCase();
  const filtered=normalised?memberships.filter(membership=>
    [membership.employerName,membership.taxYear,membership.role,String(membership.employerId),`Employer #${membership.employerId}`]
      .some(value=>String(value||"").toLowerCase().includes(normalised)),
  ):memberships;
  const choose=(id:number)=>{setQuery("");setOpen(false);if(id!==activeEmployerId)onChange(id);};
  return <div className={`employer-switcher ${open?"open":""}`}>
    <span>Employer</span>
    <button type="button" className="employer-switcher-trigger" aria-label={`Active employer: ${activeMembership?.employerName||"Select employer"}`} aria-haspopup="listbox" aria-expanded={open} disabled={memberships.length<2} onClick={()=>setOpen(current=>!current)}>
      <b>{activeMembership?.employerName||"Select employer"}</b>
      <i aria-hidden="true">{memberships.length>1?"⌄":""}</i>
    </button>
    {open&&<div className="employer-switcher-menu" role="dialog" aria-label="Switch employer payroll">
      <div className="employer-switcher-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search employer payrolls" placeholder="Search employer, tax year, role or ID…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{
        if(event.key==="Escape"){setOpen(false);setQuery("");}
        if(event.key==="Enter"&&filtered.length===1)choose(filtered[0].employerId);
      }}/><button type="button" aria-label="Close employer switcher" onClick={()=>{setOpen(false);setQuery("");}}>×</button></div>
      <div className="employer-switcher-results" role="listbox" aria-label="Available employer payrolls">
        {filtered.map(membership=><button type="button" role="option" aria-selected={membership.employerId===activeEmployerId} key={membership.employerId} onClick={()=>choose(membership.employerId)}>
          <span><b>{membership.employerName}</b><small>Employer #{membership.employerId} · {membership.taxYear} · {membership.role}</small></span>
          {membership.employerId===activeEmployerId&&<i aria-hidden="true">✓</i>}
        </button>)}
        {!filtered.length&&<div className="employer-switcher-empty">No accessible payrolls match “{query.trim()}”.</div>}
      </div>
      <small className="employer-switcher-count">{filtered.length} of {memberships.length} accessible payroll{memberships.length===1?"":"s"}</small>
    </div>}
  </div>;
}

const requestedEmployerIdFromLocation=()=>new URLSearchParams(window.location.search).get("employerId")||"";

export default function Home(){
  const [session,setSession]=useState<any>(null),[loading,setLoading]=useState(true);
  const [activeEmployerId,setActiveEmployerId]=useState<EmployerId>(1);
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[displayName,setDisplayName]=useState("");
  const [error,setError]=useState("");
  async function refresh(){
    setError("");
    try{
      const response=await fetchWorkspaceResource("/api/admin/session?employerId=1");
      const body=await readJsonResponse(response);
      if(!response.ok||!body)throw new Error(body?.error||body?.detail||"Payroll sign-in service is temporarily unavailable.");
      setSession(body);
      if(body.memberships?.length){
        const requestedEmployerId=requestedEmployerIdFromLocation();
        const requestedMembership=body.memberships.find((membership:any)=>String(membership.employerId)===requestedEmployerId);
        setActiveEmployerId((current:number)=>requestedMembership?.employerId??(body.memberships.some((membership:any)=>membership.employerId===current)?current:body.memberships[0].employerId));
      }
    }catch(error){
      setSession({authenticated:false,setupRequired:false});
      setError(error instanceof Error?error.message:"Payroll sign-in service is temporarily unavailable.");
    }finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  async function authenticate(action:"login"|"bootstrap"){
    setError("");
    try{
      const response=await fetch("/api/admin/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,employerId:1,email,password,displayName})}),body=await readJsonResponse(response);
      if(!response.ok||!body)return setError(body?.error||"Sign-in failed. The service did not return a valid response.");
      setSession(body);
    }catch{
      setError("Sign-in could not reach the payroll service. Please try again.");
    }
  }
  async function signOut(){
    await fetch("/api/admin/session",{method:"DELETE"});setSession({authenticated:false,setupRequired:false});
  }
  function switchEmployer(id:EmployerId){
    if(!session?.memberships?.some((membership:any)=>membership.employerId===id))return;
    setActiveEmployerId(id);
    const url=new URL(window.location.href);
    url.searchParams.set("employerId",String(id));
    window.history.replaceState({},"",url);
  }
  if(loading)return <main className="portal-page"><section className="portal-login"><div className="brandmark">P</div><h1>Securing payroll workspace…</h1></section></main>;
  if(!session?.authenticated)return <main className="portal-page"><section className="portal-login"><div className="brandmark">P</div><span className="eyebrow">PAYFLOW ADMINISTRATION</span><h1>{session?.setupRequired?"Create the first administrator":"Sign in to payroll"}</h1><p>{session?.setupRequired?"This owner account controls employer access, payroll roles and confidential employee records.":"Use your payroll administrator account."}</p>{session?.setupRequired&&<label className="field"><span>Your name</span><input value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name"/></label>}<label className="field"><span>Email</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label className="field"><span>Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={session?.setupRequired?"new-password":"current-password"}/></label>{error&&<div className="portal-message">{error}</div>}<button className="primary" disabled={!email||password.length<10||(session?.setupRequired&&!displayName)} onClick={()=>authenticate(session?.setupRequired?"bootstrap":"login")}>{session?.setupRequired?"Create owner account":"Sign in securely"}</button><a href="/portal">Employee portal</a></section></main>;
  const memberships=session.memberships||[],activeMembership=memberships.find((membership:any)=>membership.employerId===activeEmployerId)||memberships[0];
  const frequency=payrollFrequencyRule(activeMembership?.payFrequency||"monthly").frequency;
  return <EmployerContext.Provider value={activeMembership?.employerId||activeEmployerId}><TaxYearContext.Provider value={activeMembership?.taxYear||"2026/27"}><PayFrequencyContext.Provider value={frequency}><FirstPayDateContext.Provider value={activeMembership?.firstPayDate||""}><PayrollApp key={`${activeMembership?.employerId||activeEmployerId}:${activeMembership?.taxYear||"2026/27"}:${frequency}:${activeMembership?.firstPayDate||""}`} admin={session.user} memberships={memberships} activeEmployerId={activeMembership?.employerId||activeEmployerId} setActiveEmployerId={switchEmployer} signOut={signOut}/></FirstPayDateContext.Provider></PayFrequencyContext.Provider></TaxYearContext.Provider></EmployerContext.Provider>;
}

export type PayrollAppProps={admin:any;memberships:any[];activeEmployerId:EmployerId;setActiveEmployerId:(id:EmployerId)=>void;signOut:()=>void};

export function PayrollApp({admin,memberships,activeEmployerId,setActiveEmployerId,signOut}:PayrollAppProps) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const scheduleRule=payrollFrequencyRule(payFrequency),maximumPeriods=paySchedule.length;
  const payrollRulesAvailable=taxYear==="2026/27";
  const activeMembership=memberships.find(membership=>membership.employerId===activeEmployerId);
  const role=String(activeMembership?.role||"viewer"),employerName=String(activeMembership?.employerName||"Employer");
  const canPayrollWrite=["owner","admin","payroll"].includes(role),canEmployeeWrite=canPayrollWrite||role==="manager",canEmployerAdmin=["owner","admin"].includes(role);
  const visibleTabs=tabs.filter(tab=>{
    if(["Employer","Clients","Tools"].includes(tab))return canEmployerAdmin;
    if(["HMRC","RTI","CIS","Pensions"].includes(tab))return canPayrollWrite;
    return true;
  });
  const [active, setActive] = useState("Payroll");
  const [period, setPeriod] = useState(1);
  const currentScheduledPeriod=paySchedule.find(item=>item.periodNumber===period)||paySchedule[0];
  const [finalised, setFinalised] = useState<number[]>([]);
  const [persistedPeriods,setPersistedPeriods]=useState<PersistedPeriod[]>([]);
  const [persistedRuns,setPersistedRuns]=useState<PersistedRun[]>([]);
  const [persistedItems,setPersistedItems]=useState<PersistedItem[]>([]);
  const [openingBalanceRecords,setOpeningBalanceRecords]=useState<PayrollOpeningBalance[]>([]);
  const [employeeLoanRecords,setEmployeeLoanRecords]=useState<any[]>([]);
  const [employeeLoanHistory,setEmployeeLoanHistory]=useState<any[]>([]);
  const [payRoundingRecords,setPayRoundingRecords]=useState<any[]>([]);
  const [attachmentOrderRecords,setAttachmentOrderRecords]=useState<any[]>([]);
  const [attachmentHistoryRecords,setAttachmentHistoryRecords]=useState<any[]>([]);
  const [payrollAdjustmentRecords,setPayrollAdjustmentRecords]=useState<any[]>([]);
  const [leaveRecords,setLeaveRecords]=useState<any[]>([]);
  const [benefitRecords,setBenefitRecords]=useState<any[]>([]);
  const [recurringPayItemRecords,setRecurringPayItemRecords]=useState<any[]>([]);
  const [pensionSchemeRecords,setPensionSchemeRecords]=useState<any[]>([]);
  const [pensionMembershipRecords,setPensionMembershipRecords]=useState<any[]>([]);
  const [workflowStatus,setWorkflowStatus]=useState<PayrollWorkflowStatus>(emptyPayrollWorkflowStatus);
  const [dirtyRuns,setDirtyRuns]=useState<Set<string>>(new Set());
  const [periodEntryDrafts,setPeriodEntryDrafts]=useState<Record<string,PayrollEntryDraft>>({});
  const [payrollNotes,setPayrollNotes]=useState<Record<string,string>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeDefaults,setEmployeeDefaults]=useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [employeeSearch,setEmployeeSearch]=useState("");
  const [summaryBasis,setSummaryBasis]=useState<"period"|"ytd">("period");
  const [modal, setModal] = useState<"employee" | "calendar" | "benefit" | "benefit-register" | "attachment" | "loan" | "pay-rounding" | "holiday-fund" | "mileage" | "childcare" | "payitem" | "pay-details-import" | "schedules" | "adjustments" | "email-payslips" | "payslip-deliveries" | "requests" | null>(null);
  const [formTab, setFormTab] = useState("Personal");
  const [notice, setNotice] = useState("");
  const [noticeError,setNoticeError]=useState(false);
  const employee = employees.find(e => e.id === selectedId) || employees[0];
  async function loadEmployeeLoanRecords(){
    const response=await fetchWorkspaceResource(`/api/employee-loans?employerId=${employerId}`),body:any=await readJsonResponse(response);
    if(!response.ok||!body)throw new Error(body?.error||"Employee loan ledgers could not be loaded.");
    setEmployeeLoanRecords(body.loans||[]);
    setEmployeeLoanHistory(body.history||[]);
  }
  async function loadPayRoundingRecords(){
    const response=await fetchWorkspaceResource(`/api/pay-rounding?employerId=${employerId}`),body:any=await readJsonResponse(response);
    if(!response.ok||!body)throw new Error(body?.error||"Cash-rounding ledgers could not be loaded.");
    setPayRoundingRecords(body.settings||[]);
  }
  async function loadAttachmentRecords(){
    const response=await fetchWorkspaceResource(`/api/attachments?employerId=${employerId}`),body:any=await readJsonResponse(response);
    if(!response.ok||!body)throw new Error(body?.error||"Attachment orders could not be loaded.");
    setAttachmentOrderRecords(body.orders||[]);
    setAttachmentHistoryRecords(body.history||[]);
  }
  async function loadAdjustmentRecords(){
    const response=await fetchWorkspaceResource(`/api/adjustments?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body:any=await readJsonResponse(response);
    if(!response.ok||!body)throw new Error(body?.error||"Payroll corrections could not be loaded.");
    setPayrollAdjustmentRecords(Array.isArray(body)?body:[]);
  }
  async function loadLeaveRecords(){
    const response=await fetchWorkspaceResource(`/api/leave?employerId=${employerId}`),rows:any=await readJsonResponse(response);
    if(!response.ok||!Array.isArray(rows))throw new Error("Leave and statutory-pay records could not be loaded.");
    setLeaveRecords(rows);
    setEmployees(current=>current.map(person=>({
      ...person,
      statutoryPayPreview:roundMoney(rows.filter(row=>row.payrollId===(person.payrollId||fallbackPayrollId(person,taxYear))&&row.status==="calculated").reduce((sum,row)=>sum+statutoryPayAllocationForRange(row,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd).pay,0)),
    })));
  }
  async function loadBenefitRecords(){
    const response=await fetchWorkspaceResource(`/api/benefits?employerId=${employerId}`),body:any=await readJsonResponse(response);
    if(!response.ok||!body)throw new Error(body?.error||"Employee benefits could not be loaded.");
    setBenefitRecords(Array.isArray(body)?body:[]);
  }
  async function loadPayrollRecords(){
    const [employeeResponse,payrollResponse,loanResponse,roundingResponse,attachmentResponse,adjustmentResponse,benefitResponse,recurringResponse]=await Promise.all([
      fetchWorkspaceResource(`/api/employees?employerId=${employerId}`),
      fetchWorkspaceResource(`/api/pay-runs?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),
      fetchWorkspaceResource(`/api/employee-loans?employerId=${employerId}`),
      fetchWorkspaceResource(`/api/pay-rounding?employerId=${employerId}`),
      fetchWorkspaceResource(`/api/attachments?employerId=${employerId}`),
      fetchWorkspaceResource(`/api/adjustments?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),
      fetchWorkspaceResource(`/api/benefits?employerId=${employerId}`),
      fetchWorkspaceResource(`/api/recurring-items?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),
    ]);
    if(!employeeResponse.ok||!payrollResponse.ok||!loanResponse.ok||!roundingResponse.ok||!attachmentResponse.ok||!adjustmentResponse.ok||!benefitResponse.ok||!recurringResponse.ok)throw new Error("Payroll workspace could not be loaded.");
    const [employeeRows,payrollBody,loanBody,roundingBody,attachmentBody,adjustmentBody,benefitBody,recurringBody]:any[]=await Promise.all([
      readJsonResponse(employeeResponse),readJsonResponse(payrollResponse),readJsonResponse(loanResponse),readJsonResponse(roundingResponse),
      readJsonResponse(attachmentResponse),readJsonResponse(adjustmentResponse),readJsonResponse(benefitResponse),readJsonResponse(recurringResponse),
    ]);
    if(!Array.isArray(employeeRows)||!payrollBody||!loanBody||!roundingBody||!attachmentBody||!Array.isArray(adjustmentBody)||!Array.isArray(benefitBody)||!Array.isArray(recurringBody))throw new Error("Payroll workspace returned incomplete data. Please retry.");
    setEmployeeLoanRecords(loanBody.loans||[]);
    setEmployeeLoanHistory(loanBody.history||[]);
    setPayRoundingRecords(roundingBody.settings||[]);
    setAttachmentOrderRecords(attachmentBody.orders||[]);
    setAttachmentHistoryRecords(attachmentBody.history||[]);
    setPayrollAdjustmentRecords(Array.isArray(adjustmentBody)?adjustmentBody:[]);
    setBenefitRecords(Array.isArray(benefitBody)?benefitBody:[]);
    setRecurringPayItemRecords(Array.isArray(recurringBody)?recurringBody:[]);
    if(Array.isArray(employeeRows)&&employeeRows.length){
      const mapped:Employee[]=employeeRows.map((row:any)=>({
        id:row.id,payrollId:row.payrollId,title:row.title,firstName:row.firstName,middleNames:row.middleNames,lastName:row.lastName,
        name:[row.firstName,row.middleNames,row.lastName].filter(Boolean).join(" "),role:row.jobTitle||"Employee",
        department:row.departmentName||"Unassigned",taxCode:row.taxCode||"1257L",ni:row.niCategory||"A",annualSalary:Number(row.annualSalary||0),
        pay:row.payBasis==="hourly"?Math.round(Number(row.hourlyRate||0)*Number(row.contractedHours||0)*52/scheduleRule.periodsPerYear*100)/100:row.payBasis==="daily"?Math.round(Number(row.dailyRate||0)*Number(row.workingDaysPerWeek||0)*52/scheduleRule.periodsPerYear*100)/100:Number(row.annualSalary||0)/scheduleRule.periodsPerYear,
        hours:0,rate:Number(row.hourlyRate||0),email:row.email||"",
        status:employeeRecordNeedsAttention(row)?"Review":row.leavingDate?"Leaver":"Ready",
        dateOfBirth:row.dateOfBirth,gender:row.gender,address:row.address,postcode:row.postcode,startDate:row.startDate,
        leavingDate:row.leavingDate,starterEvidence:row.starterEvidence,starterDeclaration:row.starterDeclaration,
        p45LeavingDate:row.p45LeavingDate,p45PreviousPay:row.p45PreviousPay,p45PreviousTax:row.p45PreviousTax,p45ReceivedAfterPayroll:row.p45ReceivedAfterPayroll,p60TaxYear:row.p60TaxYear,p60ReferenceOnly:row.p60ReferenceOnly,
        week1Month1:row.week1Month1,niNumber:row.niNumber,director:row.director,directorStart:row.directorStart,
        directorEnd:row.directorEnd,alternativeDirectorNic:row.alternativeDirectorNic,noSecondaryNic:row.noSecondaryNic,
        studentLoanPlan:row.studentLoanPlan,postgraduateLoan:row.postgraduateLoan,
        worksNumber:row.worksNumber,contractedHours:row.contractedHours,payBasis:row.payBasis,dailyRate:row.dailyRate,workingDaysPerWeek:row.workingDaysPerWeek,minimumWageCategory:row.minimumWageCategory,apprenticeshipStartDate:row.apprenticeshipStartDate,annualLeaveDays:row.annualLeaveDays,paymentMethod:row.paymentMethod,
        bankName:row.bankName,accountName:row.accountName,sortCode:row.sortCode,accountNumber:row.accountNumber,
        irregularPayment:row.irregularPayment,zeroPayFpsExclusion:row.zeroPayFpsExclusion,reportedPayFrequency:row.reportedPayFrequency,
        workplacePostcode:row.workplacePostcode,previousPayrollId:row.previousPayrollId,paymentToBody:row.paymentToBody,
        trivialCommutation:row.trivialCommutation,flexibleDrawdown:row.flexibleDrawdown,employeePortal:row.employeePortal,confidential:row.confidential,
        nationality:row.nationality,passportNumber:row.passportNumber,maritalStatus:row.maritalStatus,
        portalCanEditBank:row.portalCanEditBank,managerName:row.managerName,emergencyContactName:row.emergencyContactName,
        emergencyContactPhone:row.emergencyContactPhone,emergencyContactRelationship:row.emergencyContactRelationship,
        medicalInformation:row.medicalInformation,hrNotes:row.hrNotes,hrNotesConfidential:row.hrNotesConfidential,
      }));
      setEmployees(current=>mapped.map(person=>{
        const existing=current.find(item=>item.id===person.id);
        return existing?{
          ...person,
          pensionStatus:existing.pensionStatus,
          pensionEmployeeRate:existing.pensionEmployeeRate,
          pensionEmployerRate:existing.pensionEmployerRate,
          pensionBasis:existing.pensionBasis,
          pensionTaxRelief:existing.pensionTaxRelief,
        }:person;
      }));
      setEmployeeDefaults(mapped);
      setSelectedId(current=>mapped.some(item=>item.id===current)?current:mapped[0].id);
    } else {setEmployees([]);setEmployeeDefaults([]);}
    const periods=(payrollBody.periods||[]) as PersistedPeriod[],runs=(payrollBody.runs||[]) as PersistedRun[];
    setPersistedPeriods(periods);setPersistedRuns(runs);setPersistedItems((payrollBody.items||[]) as PersistedItem[]);
    setOpeningBalanceRecords((payrollBody.openingBalances||[]) as PayrollOpeningBalance[]);
    setWorkflowStatus(payrollBody.workflowStatus||emptyPayrollWorkflowStatus);
    const periodById=new Map(periods.map(item=>[item.id,item.periodNumber]));
    setPayrollNotes(Object.fromEntries(runs.filter(run=>run.payrollNote).map(run=>[`${periodById.get(run.payPeriodId)}:${run.employeeId}`,String(run.payrollNote)])));
    setDirtyRuns(new Set());
    const finalisedPeriods=periods.filter(item=>item.status==="finalised").map(item=>item.periodNumber);
    const completed=periods.filter(item=>["finalised","migrated"].includes(item.status)).map(item=>item.periodNumber);
    setFinalised(finalisedPeriods);
    const firstOpen=Array.from({length:maximumPeriods},(_,index)=>index+1).find(number=>!completed.includes(number))||maximumPeriods;
    setPeriod(current=>current===1&&completed.length?firstOpen:Math.min(current,firstOpen));
  }
  useEffect(()=>{loadPayrollRecords().catch(error=>setNotice(error instanceof Error?error.message:"Payroll workspace could not be loaded."));},[]);
  useEffect(()=>{
    const selectedPeriod=persistedPeriods.find(item=>item.periodNumber===period);
    setEmployees(current=>current.map(person=>{
      const defaults=employeeDefaults.find(item=>item.id===person.id)||person;
      const run=persistedRuns.find(item=>item.payPeriodId===selectedPeriod?.id&&item.employeeId===person.id);
      const entryDraft=periodEntryDrafts[`${period}:${person.id}`];
      if(!run){const base={...person,pay:defaults.pay,hours:0,rate:defaults.rate,payItems:[],postLeavingPayment:false,postLeavingNicBasis:"weekly" as const,postLeavingP45Issued:false};return entryDraft?{...base,...entryDraft}:base;}
      const items=persistedItems.filter(item=>item.payRunId===run.id);
      let rtiEvidence:Record<string,unknown>={};try{rtiEvidence=JSON.parse(run.rtiSnapshot||"{}");}catch{}
      const salary=items.find(item=>item.type==="earning"&&item.name===`${scheduleRule.label} salary`);
      const hours=items.find(item=>item.type==="earning"&&item.name==="Additional hours");
      const legacyBasePay=Math.max(0,run.grossPay-(run.statutoryPay||0));
      const base={...person,pay:salary?.amount??(items.length?defaults.pay:legacyBasePay),hours:hours?.quantity??0,rate:hours?.rate??defaults.rate,postLeavingPayment:rtiEvidence.paymentAfterLeaving===true,postLeavingNicBasis:rtiEvidence.postLeavingNicBasis==="usual"?"usual" as const:"weekly" as const,postLeavingP45Issued:rtiEvidence.postLeavingP45Issued===true,
        payItems:items.filter(item=>!(item.type==="earning"&&(item.name===`${scheduleRule.label} salary`||item.name==="Monthly salary"||item.name==="Additional hours")))
          .map(item=>({id:item.id,type:item.type,name:item.name,amount:item.amount,quantity:item.quantity,rate:item.rate,taxable:item.taxable,nicable:item.nicable,pensionable:item.pensionable,recurringItemId:item.recurringItemId}))};
      return entryDraft?{...base,...entryDraft}:base;
    }));
  },[period,persistedPeriods,persistedRuns,persistedItems,employeeDefaults,periodEntryDrafts]);
  useEffect(()=>{loadLeaveRecords().catch(()=>undefined);},[period,employees.length,employerId,taxYear]);
  useEffect(()=>{
    fetchWorkspaceResource(`/api/pensions?employerId=${employerId}`).then(async response=>{
      const body=await readJsonResponse(response);
      if(!response.ok||!body)throw new Error(body?.error||"Pension records could not be loaded.");
      return body;
    }).then(body=>{
      const scheme=(body.schemes||[]).find((item:any)=>item.status==="active");
      setPensionSchemeRecords(body.schemes||[]);
      setPensionMembershipRecords(body.memberships||[]);
      setEmployees(current=>current.map(person=>{
        const membership=(body.memberships||[]).find((item:any)=>item.payrollId===(person.payrollId||fallbackPayrollId(person,taxYear)));
        return {...person,pensionStatus:membership?.membershipStatus||"not-assessed",pensionEmployeeRate:scheme?.employeeRate||0,pensionEmployerRate:membership?.employerContributionRequired===false?0:scheme?.employerRate||0,pensionBasis:scheme?.earningsBasis==="gross"?"gross":"qualifying",pensionTaxRelief:scheme?.taxRelief==="net-pay"?"net-pay":"relief-at-source"};
      }));
    }).catch(()=>undefined);
  },[employees.length]);

  const persistedPeriod=persistedPeriods.find(item=>item.periodNumber===period);
  const persistedRun=persistedRuns.find(item=>item.payPeriodId===persistedPeriod?.id&&item.employeeId===employee?.id);
  const completedPeriods=useMemo(()=>persistedPeriods.filter(item=>["finalised","migrated"].includes(item.status)).map(item=>item.periodNumber),[persistedPeriods]);
  const migrationOpening=openingBalanceRecords.find(item=>item.employeeId===employee?.id&&item.taxYear===taxYear);
  const runDirty=employee?dirtyRuns.has(`${period}:${employee.id}`):false;
  const calculationHistory=useMemo<CalculationHistory>(()=>{
    if(!employee)return {ytdTaxablePay:0,ytdTaxPaid:0,ytdNicablePay:0,ytdEmployeeNic:0,ytdEmployerNic:0};
    const prior=persistedRuns.filter(run=>run.employeeId===employee.id&&run.status==="finalised"&&persistedPeriods.some(row=>row.id===run.payPeriodId&&row.periodNumber<period));
    const opening=p45OpeningBalances({previousPay:employee.p45PreviousPay,previousTax:employee.p45PreviousTax,receivedAfterFirstPayroll:employee.p45ReceivedAfterPayroll,priorFinalisedRuns:prior.length});
    return prior.reduce((total,run)=>({
      ytdTaxablePay:total.ytdTaxablePay+run.taxablePay,ytdTaxPaid:total.ytdTaxPaid+run.payeTax,
      ytdNicablePay:total.ytdNicablePay+run.nicablePay,ytdEmployeeNic:total.ytdEmployeeNic+run.employeeNic,
      ytdEmployerNic:total.ytdEmployerNic+run.employerNic,
    }),{
      ytdTaxablePay:roundMoney(opening.taxablePay+Number(migrationOpening?.taxablePay||0)),
      ytdTaxPaid:roundMoney(opening.taxPaid+Number(migrationOpening?.payeTax||0)),
      ytdNicablePay:Number(migrationOpening?.nicablePay||0),
      ytdEmployeeNic:Number(migrationOpening?.employeeNic||0),
      ytdEmployerNic:Number(migrationOpening?.employerNic||0),
    });
  },[employee,period,persistedRuns,persistedPeriods,migrationOpening]);
  const payrollCalculationDate=persistedPeriod?.payDate||currentScheduledPeriod.payDate;
  const activeEmployeeLoans=employee?employeeLoanRecords.filter(loan=>loan.employeeId===employee.id&&loan.status==="active"&&loan.startDate<=payrollCalculationDate):[];
  const scheduledPayItems:PayLine[]=employee?recurringPayItemRecords.filter(item=>item.employeeId===employee.id&&item.startPeriod<=period&&item.endPeriod>=period&&!(employee.payItems||[]).some(line=>line.recurringItemId===item.id)).map(item=>({
    id:-1_000_000-item.id,type:item.type,name:item.name,amount:Number(item.amount||0),quantity:1,rate:Number(item.amount||0),
    taxable:Boolean(item.taxable),nicable:Boolean(item.nicable),pensionable:Boolean(item.pensionable),recurringItemId:item.id,
  })):[];
  const effectivePayItems=[...(employee?.payItems||[]),...scheduledPayItems];
  const activePensionScheme=pensionSchemeRecords.find(item=>item.status==="active");
  const pensionMembership=employee?pensionMembershipRecords.find(item=>item.employeeId===employee.id):null;
  let projectedPensionStatus=employee?.pensionStatus||"not-assessed";
  if(employee&&!pensionMembership&&activePensionScheme&&employee.dateOfBirth){
    const scheduledGross=Math.max(0,employee.pay+employee.hours*employee.rate+effectivePayItems.filter(item=>item.type==="earning").reduce((sum,item)=>sum+item.amount,0)-effectivePayItems.filter(item=>["salary-sacrifice","childcare-voucher"].includes(item.type)).reduce((sum,item)=>sum+item.amount,0)+(employee.statutoryPayPreview||0));
    projectedPensionStatus=assessPensionAtDate({dateOfBirth:employee.dateOfBirth,assessmentDate:payrollCalculationDate,earnings:scheduledGross,payFrequency,employeeRate:activePensionScheme.employeeRate,employerRate:activePensionScheme.employerRate}).action==="enrol"?"active":"not-enrolled";
  }
  const calculationEmployee=employee?{
    ...employee,payItems:effectivePayItems,pensionStatus:projectedPensionStatus,
    pensionEmployeeRate:activePensionScheme?.employeeRate||employee.pensionEmployeeRate||0,
    pensionEmployerRate:pensionMembership?.employerContributionRequired===false?0:activePensionScheme?.employerRate||employee.pensionEmployerRate||0,
    pensionBasis:activePensionScheme?.earningsBasis==="gross"?"gross":employee.pensionBasis||"qualifying",
    pensionTaxRelief:activePensionScheme?.taxRelief==="net-pay"?"net-pay":employee.pensionTaxRelief||"relief-at-source",
  }:null;
  const reviewedEmployeeBenefits=employee?benefitRecords.filter(item=>item.employeeId===employee.id&&item.taxYear===taxYear&&item.status==="reviewed"):[];
  const automaticPayrolledBenefits=totalPayrolledBenefitsForRange(reviewedEmployeeBenefits.filter(item=>item.payrolled&&item.nicTreatment!=="exempt"),taxYear,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd);
  const automaticClass1Benefits=totalPayrolledBenefitsForRange(reviewedEmployeeBenefits.filter(item=>item.nicTreatment==="class-1"),taxYear,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd);
  const calculatedPayrollBase=useMemo(()=>calculationEmployee?calculateEmployeePeriod(calculationEmployee,period,taxYear,calculationHistory,0,automaticPayrolledBenefits,automaticClass1Benefits,payFrequency,currentScheduledPeriod,paySchedule):({gross:0,tax:0,employeeNic:0,employerNic:0,pension:0,employerPension:0,net:0,employerCost:0,warnings:[]}),[calculationEmployee,period,taxYear,calculationHistory,automaticPayrolledBenefits,automaticClass1Benefits,payFrequency,currentScheduledPeriod,paySchedule]);
  const activePayrollAdjustments=employee?payrollAdjustmentRecords.filter(item=>item.employeeId===employee.id&&item.periodNumber===period&&item.status==="active"):[];
  const adjustmentTotals=activePayrollAdjustments.reduce((totals,item)=>{
    if(item.type==="paye-tax")totals.payeTax+=Number(item.amount||0);
    if(item.type==="employee-nic")totals.employeeNic+=Number(item.amount||0);
    if(item.type==="employer-nic")totals.employerNic+=Number(item.amount||0);
    if(item.type==="student-loan")totals.studentLoan+=Number(item.amount||0);
    if(item.type==="postgraduate-loan")totals.postgraduateLoan+=Number(item.amount||0);
    return totals;
  },{payeTax:0,employeeNic:0,employerNic:0,studentLoan:0,postgraduateLoan:0});
  const adjustedNetBeforeClamp=roundMoney(calculatedPayrollBase.net-adjustmentTotals.payeTax-adjustmentTotals.employeeNic-adjustmentTotals.studentLoan-adjustmentTotals.postgraduateLoan);
  const calculatedPayrollAdjusted={
    ...calculatedPayrollBase,
    tax:roundMoney(calculatedPayrollBase.tax+adjustmentTotals.payeTax),
    employeeNic:roundMoney(calculatedPayrollBase.employeeNic+adjustmentTotals.employeeNic),
    employerNic:roundMoney(calculatedPayrollBase.employerNic+adjustmentTotals.employerNic),
    net:Math.max(0,adjustedNetBeforeClamp),
    employerCost:roundMoney(calculatedPayrollBase.employerCost+adjustmentTotals.employerNic),
    warnings:adjustedNetBeforeClamp<0?[...calculatedPayrollBase.warnings,"Manual adjustments exceeded available net pay and take-home pay was capped at zero."]:calculatedPayrollBase.warnings,
  };
  const nonAttachableStatutoryPay=employee?roundMoney(leaveRecords.filter(row=>row.payrollId===(employee.payrollId||fallbackPayrollId(employee,taxYear))&&row.status==="calculated"&&row.subtype!=="sick").reduce((sum,row)=>sum+statutoryPayAllocationForRange(row,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd).pay,0)):0;
  const previousPayDate=persistedPeriods.find(item=>item.periodNumber===period-1)?.payDate||new Date(isoDay(currentScheduledPeriod.periodStart)-86_400_000).toISOString().slice(0,10);
  const activeAttachmentOrders=employee?attachmentOrderRecords.filter(order=>order.employeeId===employee.id&&order.status==="active"&&(!order.effectiveDate||order.effectiveDate<=payrollCalculationDate))
    .sort((left,right)=>attachmentPriority(left.type,left.priority)-attachmentPriority(right.type,right.priority)||left.id-right.id):[];
  const attachmentNetPay=Math.max(0,calculatedPayrollAdjusted.net-nonAttachableStatutoryPay);
  let priorAttachmentDeductions=0;
  const attachmentCalculations=activeAttachmentOrders.map(order=>{
    const maintenanceDays=["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(order.calculationRule)
      ?elapsedPayDays(order.effectiveDate&&order.effectiveDate>previousPayDate?order.effectiveDate:previousPayDate,payrollCalculationDate):undefined;
    const calculation=calculateAttachment({
      netPay:attachmentNetPay,type:order.type,deductionType:order.deductionType==="percentage"?"percentage":"fixed",
      calculationRule:order.calculationRule,payFrequency:order.payFrequency,
      deductionValue:order.deductionValue,protectedEarnings:order.protectedEarnings,balance:order.balance,
      adminFee:order.adminFee,existingDeductions:priorAttachmentDeductions,arrears:order.arrears,
      periodDays:maintenanceDays,ordinaryDebtBalance:order.ordinaryDebtBalance,maintenanceDailyRate:order.maintenanceDailyRate,
    });
    priorAttachmentDeductions=roundMoney(priorAttachmentDeductions+calculation.totalFromPay);
    return {order,calculation};
  });
  const attachmentDeduction=roundMoney(attachmentCalculations.reduce((sum,item)=>sum+item.calculation.totalFromPay,0));
  const calculatedPayrollAfterAttachments=attachmentDeduction?{...calculatedPayrollAdjusted,net:roundMoney(Math.max(0,calculatedPayrollAdjusted.net-attachmentDeduction))}:calculatedPayrollAdjusted;
  const employeeLoanCalculations=allocateEmployeeLoanRecoveries(activeEmployeeLoans,calculatedPayrollAfterAttachments.net);
  const employeeLoanDeduction=roundMoney(employeeLoanCalculations.reduce((sum,item)=>sum+item.amount,0));
  const calculatedPayrollUnrounded=employeeLoanDeduction?{...calculatedPayrollAfterAttachments,net:roundMoney(Math.max(0,calculatedPayrollAfterAttachments.net-employeeLoanDeduction))}:calculatedPayrollAfterAttachments;
  const priorMileageMiles=employee?persistedItems.filter(item=>{
    const run=persistedRuns.find(value=>value.id===item.payRunId),periodRow=run&&persistedPeriods.find(value=>value.id===run.payPeriodId);
    return run?.employeeId===employee.id&&run.status==="finalised"&&Number(periodRow?.periodNumber)<period&&item.name.startsWith("Mileage allowance ·")&&item.name.endsWith("· approved");
  }).reduce((totals,item)=>{const vehicle=item.name.split("·")[1]?.trim()||"car-van";totals[vehicle]=(totals[vehicle]||0)+item.quantity;return totals;},{} as Record<string,number>):{};
  const activeCashRounding=employee?.paymentMethod==="cash"&&!employee.postLeavingPayment?payRoundingRecords.find(item=>item.employeeId===employee.id&&item.status==="active"):null;
  const cashRoundingPreview=activeCashRounding?applyCashPayRounding({netPay:calculatedPayrollUnrounded.net,openingCarry:activeCashRounding.carry,unit:activeCashRounding.unit}):null;
  const calculatedPayroll=cashRoundingPreview?{...calculatedPayrollUnrounded,net:cashRoundingPreview.roundedNet}:calculatedPayrollUnrounded;
  let frozenCashRounding:any=null,frozenPensionEvidence:any=null,frozenPayrolledBenefits=0,frozenClass1Benefits=0;
  if(persistedRun&&!runDirty)try{
    const evidence=JSON.parse(persistedRun.rtiSnapshot||"{}");
    frozenCashRounding=evidence.cashRounding||null;
    frozenPayrolledBenefits=Number(evidence.payrolledBenefits||0);
    frozenClass1Benefits=Number(evidence.class1Benefits||0);
  }catch{}
  if(persistedRun&&!runDirty)try{frozenPensionEvidence=JSON.parse(persistedRun.pensionSnapshot||"null");}catch{}
  const displayedCashRounding=persistedRun&&!runDirty?frozenCashRounding:cashRoundingPreview;
  const displayedPayrolledBenefits=persistedRun&&!runDirty?frozenPayrolledBenefits:automaticPayrolledBenefits;
  const displayedClass1Benefits=persistedRun&&!runDirty?frozenClass1Benefits:automaticClass1Benefits;
  const displayedPension=persistedRun&&!runDirty?{
    status:frozenPensionEvidence?"active":"not-assessed",
    basis:frozenPensionEvidence?.earningsBasis||"qualifying",
    employeeRate:Number(frozenPensionEvidence?.employeeRate||0),
    employerRate:Number(frozenPensionEvidence?.employerRate||0),
  }:{
    status:calculationEmployee?.pensionStatus||"not-assessed",
    basis:calculationEmployee?.pensionBasis||"qualifying",
    employeeRate:calculationEmployee?.pensionEmployeeRate||0,
    employerRate:calculationEmployee?.pensionEmployerRate||0,
  };
  const displayedAttachmentCalculations=persistedRun&&!runDirty&&persistedRun.status==="finalised"
    ?attachmentHistoryRecords.filter(item=>item.payRunId===persistedRun.id).map(item=>({
      order:attachmentOrderRecords.find(order=>order.id===item.attachmentOrderId),
      calculation:{...item,totalFromPay:roundMoney(Number(item.deduction||0)+Number(item.adminFee||0)),protectedEarnings:item.protectedEarningsApplied},
    }))
    :attachmentCalculations;
  const displayedEmployeeLoanCalculations=persistedRun&&!runDirty&&persistedRun.status==="finalised"
    ?employeeLoanHistory.filter(item=>item.payRunId===persistedRun.id).map(item=>({
      loan:employeeLoanRecords.find(loan=>loan.id===item.employeeLoanId),amount:item.amount,balanceAfter:item.balanceAfter,
    }))
    :employeeLoanCalculations;
  const periodEmploymentActive=employee?employeeActiveInRange(employee.startDate,employee.leavingDate,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd):false;
  const periodRange={start:isoDay(currentScheduledPeriod.periodStart),end:isoDay(currentScheduledPeriod.periodEnd)};
  const eligiblePostLeavingPayment=Boolean(employee?.leavingDate&&Date.parse(`${employee.leavingDate}T00:00:00Z`)<periodRange.start);
  const payrollEntryEnabled=periodEmploymentActive||Boolean(employee?.postLeavingPayment&&eligiblePostLeavingPayment);
  const periodMigrated=persistedPeriod?.status==="migrated";
  const payroll=persistedRun&&!runDirty?{
    gross:persistedRun.grossPay,tax:persistedRun.payeTax,employeeNic:persistedRun.employeeNic,employerNic:persistedRun.employerNic,
    pension:persistedRun.employeePension,employerPension:persistedRun.employerPension,net:persistedRun.netPay,employerCost:persistedRun.grossPay+persistedRun.employerNic+persistedRun.employerPension,warnings:[],
  }:periodMigrated?{gross:0,tax:0,employeeNic:0,employerNic:0,pension:0,employerPension:0,net:0,employerCost:0,warnings:[]}:calculatedPayroll;
  const ytdPayroll=persistedRuns.filter(run=>run.employeeId===employee?.id&&run.status==="finalised"&&
    persistedPeriods.some(periodRow=>periodRow.id===run.payPeriodId&&periodRow.periodNumber<=period)).reduce((total,run)=>({
      gross:total.gross+run.grossPay,tax:total.tax+run.payeTax,employeeNic:total.employeeNic+run.employeeNic,
      employerNic:total.employerNic+run.employerNic,pension:total.pension+run.employeePension,employerPension:total.employerPension+run.employerPension,net:total.net+run.netPay,
      employerCost:total.employerCost+run.grossPay+run.employerNic+run.employerPension,warnings:[] as string[],
    }),{
      gross:Number(migrationOpening?.grossPay||0),tax:Number(migrationOpening?.payeTax||0),
      employeeNic:Number(migrationOpening?.employeeNic||0),employerNic:Number(migrationOpening?.employerNic||0),
      pension:Number(migrationOpening?.employeePension||0),employerPension:Number(migrationOpening?.employerPension||0),net:Number(migrationOpening?.netPay||0),
      employerCost:roundMoney(Number(migrationOpening?.grossPay||0)+Number(migrationOpening?.employerNic||0)+Number(migrationOpening?.employerPension||0)),
      warnings:[] as string[],
    });
  const summaryPayroll=summaryBasis==="ytd"?ytdPayroll:payroll;
  const periodLocked=finalised.includes(period)||periodMigrated;

  function toast(message: string, success?:boolean) {
    const failed=success===false||(success===undefined&&/(could not|failed|not permit|\b(?:requires? (?:an? |the |you\b)|(?:is|are) required\b|required (?:before|to|for|by|from)\b)|must |cannot|only |not ready|unsupported|invalid|before |earlier periods|no employees|no .* (?:exist|available|found))/i.test(message));
    setNotice(message);
    setNoticeError(failed);
    setTimeout(() => setNotice(""), 2600);
  }

  function updateEmployee(patch: Partial<Employee>) {
    if(!employee)return;
    setEmployees(list => list.map(e => e.id === employee.id ? { ...e, ...patch } : e));
    const entryKeys:Array<keyof PayrollEntryDraft>=["pay","hours","rate","payItems","postLeavingPayment","postLeavingNicBasis","postLeavingP45Issued"];
    const entryPatch=Object.fromEntries(entryKeys.filter(key=>Object.prototype.hasOwnProperty.call(patch,key)).map(key=>[key,patch[key]])) as PayrollEntryDraft;
    if(Object.keys(entryPatch).length)setPeriodEntryDrafts(current=>{const key=`${period}:${employee.id}`;return {...current,[key]:{...current[key],...entryPatch}};});
    setDirtyRuns(current=>new Set(current).add(`${period}:${employee.id}`));
  }

  function addEmployee() {
    const id = Math.max(0,...employees.map(e => e.id)) + 1;
    const draft: Employee = { id, payrollId:`PAY-${Date.now()}`,name: "New employee", role: "Employee", department: "Unassigned", taxCode: "1257L", ni: "A", pay: 0, hours: 0, rate: 12.71, email: "", status: "Review" };
    setEmployees(list => [...list, draft]);
    setSelectedId(id);
    setFormTab("Personal");
    setModal("employee");
  }

  function closeEmployeeEditor() {
    if(employee&&!employeeDefaults.some(item=>item.id===employee.id)){
      setEmployees(list=>list.filter(item=>item.id!==employee.id));
      setSelectedId(employeeDefaults[0]?.id||0);
    }
    setModal(null);
  }

  async function processPayroll(action:"draft"|"finalise",sourceEmployees=employees,operationSource:"manual"|"pay-details-csv"="manual") {
    if(action==="draft"&&!sourceEmployees.length)return toast("Add at least one employee before saving a payroll draft.");
    const firstOpen=nextOpenPeriod(completedPeriods,maximumPeriods);
    if (period !== firstOpen) return toast("Earlier periods must be finalised first.");
    const activeEmployees=sourceEmployees.filter(e=>employeeActiveInRange(e.startDate,e.leavingDate,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd)||(e.postLeavingPayment&&e.leavingDate&&Date.parse(`${e.leavingDate}T00:00:00Z`)<isoDay(currentScheduledPeriod.periodStart)));
    if(action==="draft"&&!activeEmployees.length)return toast("No employees are active within this payroll period.");
    const hasEnteredEmployeePayments=activeEmployees.some(employee=>{
      const enteredLines=[...(employee.payItems||[]),...recurringPayItemRecords.filter(item=>item.employeeId===employee.id&&item.startPeriod<=period&&item.endPeriod>=period)];
      return Math.abs(Number(employee.pay||0))>=0.005||Math.abs(Number(employee.hours||0)*Number(employee.rate||0))>=0.005||
        enteredLines.some(item=>Math.abs(Number(item.amount??Number(item.quantity??1)*Number(item.rate??0)))>=0.005);
    });
    let confirmNoEmployeePayments=false;
    if(action==="finalise"&&!hasEnteredEmployeePayments){
      const rtiFollowUp=payFrequency==="monthly"
        ?"RTI will show an Employer Payment Summary task declaring no payment for this tax month."
        :"RTI will track this zero-pay period and, once every pay date in the tax month is complete, create an Employer Payment Summary task only if the whole month has no employee payments.";
      confirmNoEmployeePayments=window.confirm(`No employee payments are entered for period ${period} (tax month ${currentScheduledPeriod.taxMonth}).\n\nIf you continue, the payroll period will be finalised. ${rtiFollowUp} No FPS is required for a period without employee payment activity.\n\nContinue?`);
      if(!confirmNoEmployeePayments)return false;
    }
    const records = activeEmployees.map(e => ({
      employeeId:e.id,
      payrollId: e.payrollId||fallbackPayrollId(e,taxYear),
      firstName: e.firstName?.trim()||e.name.trim().split(/\s+/)[0] || "Employee",
      lastName: e.lastName?.trim()||e.name.trim().split(/\s+/).slice(1).join(" ") || "Unknown",
      email: e.email,
      grossPay: e.pay + e.hours * e.rate,
      taxCode: e.taxCode,
      niCategory: e.ni,
      week1Month1: e.week1Month1,
      studentLoanPlan: e.studentLoanPlan,
      postgraduateLoan: e.postgraduateLoan,
      director: e.director,
      noSecondaryNic: e.noSecondaryNic,
      directorMethod: e.alternativeDirectorNic ? "alternative" : "annual",
      pensionEmployeeRate: e.pensionStatus==="active"?e.pensionEmployeeRate||0:0,
      pensionEmployerRate: e.pensionStatus==="active"?e.pensionEmployerRate||0:0,
      pensionBasis: e.pensionBasis||"qualifying",
      pensionTaxRelief:e.pensionTaxRelief||"relief-at-source",
      annualSalary: e.pay * annualPayPeriodDivisor(payFrequency),
      hourlyRate: e.rate,
      payrollNote:payrollNotes[`${period}:${e.id}`]||"",
      postLeavingPayment:Boolean(e.postLeavingPayment&&!employeeActiveInRange(e.startDate,e.leavingDate,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd)),
      postLeavingNicBasis:e.postLeavingNicBasis||"weekly",
      postLeavingP45Issued:Boolean(e.postLeavingP45Issued),
      items:[
        {type:"earning",name:`${scheduleRule.label} salary`,quantity:1,rate:e.pay,amount:e.pay,taxable:true,nicable:true,pensionable:true},
        {type:"earning",name:"Additional hours",quantity:e.hours,rate:e.rate,amount:e.hours*e.rate,taxable:true,nicable:true,pensionable:true},
        ...(e.payItems||[]).map(item=>({type:item.type,name:item.name,quantity:item.quantity??1,rate:item.rate??item.amount,amount:item.amount,taxable:item.taxable,nicable:item.nicable,pensionable:item.pensionable,recurringItemId:item.recurringItemId})),
      ],
    }));
    try {
      const response = await fetch("/api/pay-runs", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ action,source:operationSource, employerId, taxYear, periodNumber:period, payDate:currentScheduledPeriod.payDate,confirmNoEmployeePayments,employees:records }) });
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || "Finalisation failed");
      await loadPayrollRecords();
      setPeriodEntryDrafts(current=>Object.fromEntries(Object.entries(current).filter(([key])=>!key.startsWith(`${period}:`))));
      if(action==="finalise"&&period < maximumPeriods) setPeriod(period + 1);
      const rtiDownstream=result.workflowTasks?.rtiType==="EPS_NO_PAYMENT"
        ?` RTI now has an EPS no-payment task for tax month ${result.workflowTasks.taxMonth}; review and submit it before that month can close.`
        :result.workflowTasks?.rtiType==="RTI_MONTH_REVIEW"
          ?` RTI has recorded this zero-pay period and will decide the tax-month EPS requirement when all pay dates in that month are complete.`
        :" RTI now has an FPS task ready for review and submission.";
      const downstream=action==="finalise"?`${rtiDownstream}${result.workflowTasks?.pensionReady?" Pension contributions are also ready for provider submission.":""}`:"";
      toast(action==="finalise"
        ?period<maximumPeriods?`Period ${period} finalised and saved.${downstream} Period ${period+1} is now open.`:`Period ${maximumPeriods} finalised and saved.${downstream} The payroll year is complete; finish the year-end checks before creating the next tax year.`
        :`Period ${period} draft saved.`);
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : `Payroll ${action} could not be saved.`);
      return false;
    }
  }

  async function reopenPayroll() {
    if(!periodLocked||period!==Math.max(0,...finalised))return toast("Only the latest finalised period can be reopened.");
    try {
      const response=await fetch("/api/pay-runs",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reopen",employerId,taxYear,periodNumber:period})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"The period could not be reopened.");
      await loadPayrollRecords();setPeriod(period);
      toast(`Period ${period} reopened. Any prepared RTI package was superseded and must be regenerated.`);
    } catch(error){toast(error instanceof Error?error.message:"The period could not be reopened.");}
  }

  async function saveEmployeeRecord(employee:Employee) {
    const persistedEmployee=employeeDefaults.some(item=>item.id===employee.id);
    const parts = employee.name.trim().split(/\s+/),hasStructuredName=Boolean(employee.firstName?.trim()||employee.lastName?.trim());
    const firstName=employee.firstName?.trim()||parts[0]||"Employee",lastName=employee.lastName?.trim()||parts.at(-1)||"Unknown";
    const middleNames=employee.middleNames?.trim()||(!hasStructuredName?parts.slice(1,-1).join(" ")||undefined:undefined);
    const payload = {
      ...(persistedEmployee?{id:employee.id}:{}),
      employerId,
      payrollId: employee.payrollId||fallbackPayrollId(employee,taxYear),
      title:employee.title,firstName,middleNames,lastName,
      email: employee.email,
      dateOfBirth:employee.dateOfBirth,
      gender:employee.gender,
      address:employee.address,
      postcode:employee.postcode,
      jobTitle: employee.role,
      departmentName:employee.department,
      startDate: employee.startDate,
      leavingDate: employee.leavingDate,
      starterEvidence: employee.starterEvidence,
      starterDeclaration: employee.starterDeclaration,
      p45LeavingDate: employee.p45LeavingDate,
      p45PreviousPay: employee.p45PreviousPay,
      p45PreviousTax: employee.p45PreviousTax,
      p45ReceivedAfterPayroll:employee.p45ReceivedAfterPayroll,
      p60TaxYear: employee.p60TaxYear,
      p60ReferenceOnly:employee.p60ReferenceOnly,
      taxCode: employee.taxCode,
      week1Month1: employee.week1Month1,
      niCategory: employee.ni,
      niNumber: employee.niNumber,
      director: employee.director,
      directorStart:employee.directorStart,
      directorEnd:employee.directorEnd,
      alternativeDirectorNic: employee.alternativeDirectorNic,
      noSecondaryNic: employee.noSecondaryNic,
      studentLoanPlan: employee.studentLoanPlan,
      postgraduateLoan: employee.postgraduateLoan,
      annualSalary: employee.annualSalary??employee.pay * 12,
      payBasis:employee.payBasis||"period",dailyRate:employee.dailyRate,workingDaysPerWeek:employee.workingDaysPerWeek,
      hourlyRate: employee.rate,
      worksNumber:employee.worksNumber,contractedHours:employee.contractedHours,minimumWageCategory:employee.minimumWageCategory,apprenticeshipStartDate:employee.apprenticeshipStartDate,annualLeaveDays:employee.annualLeaveDays,
      paymentMethod:employee.paymentMethod,bankName:employee.bankName,accountName:employee.accountName,sortCode:employee.sortCode,accountNumber:employee.accountNumber,
      irregularPayment:employee.irregularPayment,zeroPayFpsExclusion:employee.zeroPayFpsExclusion,
      reportedPayFrequency:employee.reportedPayFrequency,workplacePostcode:employee.workplacePostcode,
      previousPayrollId:employee.previousPayrollId,paymentToBody:employee.paymentToBody,
      trivialCommutation:employee.trivialCommutation,flexibleDrawdown:employee.flexibleDrawdown,
      employeePortal:employee.employeePortal,confidential:employee.confidential,nationality:employee.nationality,passportNumber:employee.passportNumber,maritalStatus:employee.maritalStatus,
      portalCanEditBank:employee.portalCanEditBank,managerName:employee.managerName,emergencyContactName:employee.emergencyContactName,
      emergencyContactPhone:employee.emergencyContactPhone,emergencyContactRelationship:employee.emergencyContactRelationship,
      medicalInformation:employee.medicalInformation,hrNotes:employee.hrNotes,hrNotesConfidential:employee.hrNotesConfidential,
    };
    try {
      const response = await fetch("/api/employees", { method:persistedEmployee?"PUT":"POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const saved=await response.json();
      if (!response.ok) throw new Error(saved.error||"save failed");
      const persisted={...employee,id:saved.id,payrollId:saved.payrollId,annualSalary:saved.annualSalary,payBasis:saved.payBasis,dailyRate:saved.dailyRate,workingDaysPerWeek:saved.workingDaysPerWeek,worksNumber:saved.worksNumber};
      persisted.pay=periodicBasePay(persisted,payFrequency);
      setEmployees(list=>list.map(item=>item.id===employee.id?persisted:item));
      setEmployeeDefaults(list=>list.some(item=>item.id===employee.id)?list.map(item=>item.id===employee.id?persisted:item):[...list,persisted]);
      setSelectedId(saved.id);
      setModal(null);
      toast(saved.supersededPaymentBatches
        ?`Employee record saved. ${saved.supersededPaymentBatches} prepared bank payment batch${saved.supersededPaymentBatches===1?" was":"es were"} superseded; generate a replacement file.`
        :"Employee record saved to the payroll database.");
    } catch(error) {
      toast(error instanceof Error?error.message:"Employee record could not be saved.");
    }
  }

  async function deleteEmployeeRecord(employee:Employee){
    const persisted=employeeDefaults.some(item=>item.id===employee.id);
    if(!persisted){
      setEmployees(list=>list.filter(item=>item.id!==employee.id));setSelectedId(employeeDefaults[0]?.id||0);setModal(null);return;
    }
    if(!window.confirm(`Delete ${employee.name}? This is allowed only when no payroll or compliance history exists.`))return;
    const response=await fetch("/api/employees",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:employee.id})});
    const body=await response.json();if(!response.ok)return toast(body.error||"Employee could not be deleted.",false);
    setModal(null);await loadPayrollRecords();toast(`${employee.name} was deleted.`);
  }

  async function createPortalInvite() {
    if(!employee)return;
    try {
      const response=await fetch("/api/portal/invites",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId||fallbackPayrollId(employee,taxYear)})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      await navigator.clipboard?.writeText(body.code);
      toast(`One-time portal code: ${body.code} (copied where browser permissions allow).`);
    } catch(error){toast(error instanceof Error?error.message:"Portal invitation could not be created.");}
  }

  async function downloadPaymentFile() {
    if(!persistedPeriod||persistedPeriod.status!=="finalised")return toast("Finalise this payroll period before generating the employee payment file.");
    const payable=employees.flatMap(employee=>{
      const run=persistedRuns.find(item=>item.payPeriodId===persistedPeriod.id&&item.employeeId===employee.id&&item.status==="finalised");
      return employee.paymentMethod==="credit-transfer"&&employee.sortCode&&employee.accountNumber&&run&&run.netPay>0?[{employee,run}]:[];
    });
    if(!payable.length)return toast("No employees in this finalised period have positive net pay and complete credit-transfer bank details.");
    const response = await fetch("/api/exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employerId,type:"payments",taxYear,periodNumber:period }) });
    if(!response.ok){const body=await response.json();return toast(body.error||"Employee payment file could not be generated.");}
    const batchId=response.headers.get("x-payflow-submission-id"),checksum=response.headers.get("x-payflow-checksum");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "employee-bank-payments.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    const duplicate=response.headers.get("x-payflow-duplicate")==="true";
    toast(`Bank payment batch ${batchId?`#${batchId} `:""}${duplicate?"downloaded again":"prepared"}${checksum?` · checksum ${checksum.slice(0,12)}…`:""}. Upload and authorise it in your bank; PayFlow has not transmitted payment.`);
  }
  async function downloadPayrollReport(type:string,format:"csv"|"html",filename:string,periodNumber?:number){
    const response=await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,type,format,periodNumber})});
    if(!response.ok){const body=await response.json();return toast(body.error||"Payroll document could not be generated.");}
    const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);toast(`${filename} generated from finalised payroll.`);
  }
  async function deliverPayslips(method:"email"|"portal"){
    if(!persistedPeriod||persistedPeriod.status!=="finalised")return toast("Finalise this payroll period before delivering payslips.");
    const response=await fetch("/api/payslip-deliveries",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,periodNumber:period,method})});
    const body=await response.json();
    if(!response.ok)return toast(body.error||"Payslips could not be delivered.",false);
    const excluded=body.excluded?.length?` ${body.excluded.length} employee(s) were excluded because delivery details are incomplete.`:"";
    toast(method==="email"?`${body.recipientCount} payslip email(s) queued locally; connect an approved email provider to transmit them.${excluded}`:`${body.recipientCount} payslip(s) published to employee portals.${excluded}`);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><div className="brandmark">P</div><div><b>PayFlow</b><small>Payroll workspace</small></div></div>
        <div className="company"><span>EPOS Accountancy</span><EmployerSwitcher memberships={memberships} activeEmployerId={activeEmployerId} onChange={setActiveEmployerId}/><span>{taxYear}</span></div>
        <div className="top-actions"><a href="/portal">Employee portal</a><button aria-label="Search employees" title="Search employees" onClick={()=>{setActive("Payroll");setTimeout(()=>document.querySelector<HTMLInputElement>('input[aria-label="Search employees"]')?.focus(),0);}}>⌕</button><button aria-label="Open HMRC notifications" title={canPayrollWrite?"Open HMRC notice inbox":"Payroll permission is required"} disabled={!canPayrollWrite} onClick={()=>setActive("HMRC")}>♢</button><button className="avatar" title={`Signed in as ${admin.displayName}`} onClick={signOut}>{String(admin.displayName||admin.email).split(/\s+/).map((v:string)=>v[0]).join("").slice(0,2).toUpperCase()}</button></div>
      </header>

      <nav className="mainnav" aria-label="Main navigation">
        {visibleTabs.map(t => {const pending=t==="RTI"?workflowStatus.rti.count:t==="Pensions"?workflowStatus.pensions.count:0;return <button key={t} className={active === t ? "active" : ""} onClick={() => setActive(t)}><span>{t}</span>{pending>0&&<em className="workflow-badge" aria-label={`${pending} ${t} task${pending===1?"":"s"} ready`}>{pending>99?"99+":pending}</em>}</button>;})}
      </nav>

      {active === "Payroll" && <>
        <section className="toolbar">
          <button onClick={()=>processPayroll("draft")} disabled={!canPayrollWrite||!payrollRulesAvailable||periodLocked||!employees.length}><Icon>↧</Icon>Save draft</button>
          <button className="primary-tool" onClick={()=>processPayroll("finalise")} disabled={!canPayrollWrite||!payrollRulesAvailable||periodLocked}><Icon>✓</Icon>{periodLocked?"Payslips finalised":"Finalise payslips"}</button>
          <button onClick={reopenPayroll} disabled={!canPayrollWrite||!periodLocked||period!==Math.max(0,...finalised)} title="Only payroll users can reopen the latest finalised period"><Icon>↺</Icon>Reopen payslips</button>
          <button disabled={!periodLocked} onClick={() => downloadPayrollReport("payslips","html",`payslips-${taxYear.replace("/","-")}-period-${period}.html`,period)}><Icon>↗</Icon>Create payslips</button>
          <button disabled={!canPayrollWrite||!periodLocked} onClick={()=>setModal("email-payslips")} title="Preview a tokenised message and record a validated batch; outbound transmission requires an approved email provider"><Icon>✉</Icon>Email payslips</button>
          <button disabled={!canPayrollWrite||!periodLocked} onClick={()=>deliverPayslips("portal")}><Icon>◇</Icon>Publish to portal</button>
          <button onClick={()=>setModal("payslip-deliveries")}><Icon>≡</Icon>Delivery history</button>
          <button disabled={!canPayrollWrite} onClick={downloadPaymentFile}><Icon>£</Icon>Bank payment file</button>
          <button disabled={!canPayrollWrite} onClick={()=>setModal("schedules")}><Icon>▦</Icon>Schedules</button>
          <button disabled={!canPayrollWrite||periodLocked||!employees.length} onClick={()=>setModal("pay-details-import")}><Icon>⇩</Icon>Import pay</button>
          <button disabled={!canPayrollWrite} onClick={()=>setModal("requests")}><Icon>☵</Icon>Client requests</button>
          <button onClick={() => downloadPayrollReport("journal","csv",`payroll-journal-${taxYearSlug(taxYear)}.csv`)}><Icon>▦</Icon>Journal</button>
        </section>
	      <PeriodBar period={period} taxYear={taxYear} periods={persistedPeriods} schedule={paySchedule} frequency={payFrequency} onSelect={setPeriod} />
      {!payrollRulesAvailable&&<div className="portal-message tax-year-lock">Payroll calculation is locked for {taxYear}. Install the approved PAYE, NIC, loan, statutory-pay and minimum-wage tables before processing this tax year.</div>}
        {employee?<section className="workspace">
          <aside className="employee-list">
            <div className="aside-head"><span>Employees</span><button disabled={!canEmployeeWrite} onClick={addEmployee}>＋ Add</button></div>
            <label className="search"><span>⌕</span><input aria-label="Search employees" placeholder="Search employees" value={employeeSearch} onChange={event=>setEmployeeSearch(event.target.value)} /></label>
            <div className="employee-scroll-list">
            {employees.filter(e=>`${e.name} ${e.role} ${e.department}`.toLowerCase().includes(employeeSearch.trim().toLowerCase())).map(e => <button key={e.id} onClick={() => setSelectedId(e.id)} className={e.id === employee.id ? "selected" : ""}>
              <span className="person">♙</span><span><b>{e.name}</b><small>{e.role}</small></span><i className={e.status === "Review" ? "review" : ""}>{e.status === "Review" ? "!" : "✓"}</i>
            </button>)}
            {employeeSearch&&employees.every(e=>!`${e.name} ${e.role} ${e.department}`.toLowerCase().includes(employeeSearch.trim().toLowerCase()))&&<div className="empty-workflow"><p>No employees match “{employeeSearch}”.</p></div>}
            </div>
          </aside>
          <section className="pay-editor">
	            {periodMigrated&&<div className="portal-message"><b>Imported payroll history — read only.</b><br/>This period was processed in the previous payroll system. PayFlow stores a single audited P11 year-to-date opening balance and does not invent period payslips or liabilities. Processing begins in Period {migrationOpening?.firstPayFlowPeriod||nextOpenPeriod(completedPeriods,maximumPeriods)}.</div>}
	            {!periodEmploymentActive&&eligiblePostLeavingPayment&&!periodMigrated&&<div className="portal-message"><Check text="Make an exceptional payment after leaving (uses regional 0T week 1/month 1 and reports the FPS indicator)" checked={Boolean(employee.postLeavingPayment)} disabled={!canPayrollWrite||periodLocked} onChange={checked=>updateEmployee({postLeavingPayment:checked,postLeavingP45Issued:false,postLeavingNicBasis:"weekly",pay:checked?0:employee.pay,hours:0,payItems:checked?[]:employee.payItems})}/>{employee.postLeavingPayment&&<><Check text="I confirm the employee’s P45 was already issued; another P45 must not be produced" checked={Boolean(employee.postLeavingP45Issued)} disabled={!canPayrollWrite||periodLocked} onChange={postLeavingP45Issued=>updateEmployee({postLeavingP45Issued})}/><label className="field"><span>NIC and student-loan earnings period</span><select value={employee.postLeavingNicBasis||"weekly"} onChange={event=>updateEmployee({postLeavingNicBasis:event.target.value as "usual"|"weekly"})}><option value="weekly">Weekly — irregular holiday pay, bonus or arrears</option><option value="usual">Usual monthly period — final salary or wage</option></select><small>HMRC requires a weekly earnings period for irregular payments; a final salary or wage keeps the employee’s usual period.</small></label></>}</div>}
            {!periodEmploymentActive&&!eligiblePostLeavingPayment&&<div className="portal-message">This employee is outside their recorded employment dates for Period {period}. They will not receive pay or be included in this period’s FPS.</div>}
	            {periodMigrated?<div className="pay-card migrated-opening-card"><div className="section-title"><div><h2>Imported P11 opening balance</h2><p>Consolidated year-to-date evidence immediately before Period {migrationOpening?.firstPayFlowPeriod}</p></div><span>{migrationOpening?.source?.replaceAll("-"," ")||"Prior payroll evidence"}</span></div>
	              <div className="payroll-status-strip"><div><span>Gross pay YTD</span><strong>{money(Number(migrationOpening?.grossPay||0))}</strong></div><div><span>Taxable pay YTD</span><strong>{money(Number(migrationOpening?.taxablePay||0))}</strong></div><div><span>PAYE tax YTD</span><strong>{money(Number(migrationOpening?.payeTax||0))}</strong></div><div><span>NIC-able pay YTD</span><strong>{money(Number(migrationOpening?.nicablePay||0))}</strong></div></div>
	              <div className="payroll-status-strip"><div><span>Employee NIC YTD</span><strong>{money(Number(migrationOpening?.employeeNic||0))}</strong></div><div><span>Employer NIC YTD</span><strong>{money(Number(migrationOpening?.employerNic||0))}</strong></div><div><span>Net pay YTD</span><strong>{money(Number(migrationOpening?.netPay||0))}</strong></div><div><span>Evidence checksum</span><strong>{migrationOpening?.payloadChecksum?.slice(0,12)||"—"}…</strong></div></div>
	              {migrationOpening?.notes&&<div className="portal-message">{migrationOpening.notes}</div>}<small>Per-period payslips and payment detail remain in the prior system. This consolidated evidence enters cumulative calculations, FPS year-to-date values, P11, P45, P60 and year-end reconciliation.</small>
	            </div>:<>
	            <div className="pay-card earnings-card">
              <div className="section-title"><div><h2>Pay and benefits</h2><p>Regular salary and variable earnings for this period</p></div><span>{scheduleRule.label}</span></div>
              <div className="pay-row"><div><b>{employee.postLeavingPayment&&!periodEmploymentActive?"Payment after leaving":`${scheduleRule.label} salary`}</b><small>{employee.postLeavingPayment&&!periodEmploymentActive?"Enter arrears, holiday pay or another genuine post-employment payment":`${employee.department} · Standard period pay`}</small></div><div className="amount"><span>£</span><input aria-label={`${scheduleRule.label} salary`} value={roundMoney(payrollEntryEnabled?employee.pay:0)} type="number" step=".01" disabled={!canPayrollWrite||periodLocked||!payrollEntryEnabled} onChange={e => updateEmployee({ pay: +e.target.value })} /></div></div>
              <div className="pay-row"><div><b>Additional hours</b><small>Variable pay for this period</small></div><div className="rate-line"><input aria-label="Additional hours" value={payrollEntryEnabled?employee.hours:0} type="number" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onChange={e => updateEmployee({ hours: +e.target.value })} /><span>hrs × £</span><input aria-label="Hourly rate" value={employee.rate} type="number" step=".01" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onChange={e => updateEmployee({ rate: +e.target.value })} /><b>{money(periodEmploymentActive?employee.hours * employee.rate:0)}</b></div></div>
              {effectivePayItems.map(item=><div className="pay-row" key={item.id}><div><b>{item.name}</b><small>{item.type.replaceAll("-"," ")} · {item.taxable?"PAYE":"not PAYE"} · {item.nicable?"NIC":"not NIC"}{item.recurringItemId?" · scheduled":""}</small></div><div className="rate-line"><b>{money(item.amount)}</b><button className="outline" disabled={periodLocked} onClick={()=>item.recurringItemId?setModal("schedules"):updateEmployee({payItems:(employee.payItems||[]).filter(line=>line.id!==item.id)})}>{item.recurringItemId?"Manage":"Remove"}</button></div></div>)}
              {displayedPayrolledBenefits>0&&<div className="pay-row"><div><b>Payrolled benefits</b><small>Reviewed non-cash benefits · included in PAYE taxable pay</small></div><div className="rate-line"><b>{money(displayedPayrolledBenefits)}</b></div></div>}
              {displayedClass1Benefits>0&&<div className="pay-row"><div><b>Class 1 benefits</b><small>Reviewed benefit value · included in NIC-able pay</small></div><div className="rate-line"><b>{money(displayedClass1Benefits)}</b></div></div>}
              {Boolean(employee.statutoryPayPreview)&&<div className="pay-row"><div><b>Statutory pay</b><small>Calculated leave payment · Taxable · NICable</small></div><div className="rate-line"><b>{money(employee.statutoryPayPreview||0)}</b></div></div>}
              <button className="text-button" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onClick={()=>setModal("payitem")}>＋ Add another pay item</button>
              <button className="text-button" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onClick={()=>setModal("mileage")}>＋ Add business mileage allowance</button>
              <button className="text-button" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onClick={()=>setModal("childcare")}>＋ Add legacy childcare vouchers</button>
            </div>
            <div className="payroll-secondary-grid">
            <div className="payroll-leave-column">
              <div className="pay-card compact-card leave-card">
                <div className="section-title"><div><h2>Leave and statutory pay</h2><p>Sickness, parental leave and other absences</p></div></div>
                <button className="calendar-card" disabled={!canEmployeeWrite} onClick={() => setModal("calendar")}><Icon>▦</Icon><span><b>Open leave calendar</b><small>{employee.statutoryPayPreview?`${money(employee.statutoryPayPreview)} included in this period`:"No statutory pay events recorded in this period"}</small></span><span>Manage →</span></button>
              </div>
            </div>
            <div className="pay-card compact-card deductions-card">
              <div className="section-title"><div><h2>Deductions and pension</h2><p>Workplace pension and other payroll deductions</p></div></div>
              <div className="pension-row"><div><span className="nest">N</span><span><b>Workplace pension</b><small>{displayedPension.status.replaceAll("-"," ")} · {displayedPension.basis.replaceAll("-"," ")} earnings</small></span></div><div><span>Employee</span><b>{displayedPension.status==="active"?displayedPension.employeeRate.toFixed(1):"0.0"}%</b><span>Employer</span><b>{displayedPension.status==="active"?displayedPension.employerRate.toFixed(1):"0.0"}%</b></div></div>
              {activePayrollAdjustments.map(item=><div className="pay-row" key={`adjustment-${item.id}`}><div><b>{String(item.type).replaceAll("-"," ")} correction</b><small>{item.reason} · signed audited adjustment</small></div><div className="rate-line"><b>{money(item.amount)}</b></div></div>)}
              {displayedAttachmentCalculations.map(({order,calculation}:any,index:number)=><div className="pay-row" key={`attachment-${order?.id||index}`}><div><b>{order?.type||"Attachment order"}</b><small>{order?.issuingAuthority||"Issuing authority"} · {order?.reference||"Recorded order"} · {money(calculation.deduction)} remitted{calculation.adminFee?` · ${money(calculation.adminFee)} admin fee`:""}</small></div><div className="rate-line"><b>−{money(calculation.totalFromPay)}</b>{calculation.balanceAfter!=null&&<small>{money(calculation.balanceAfter)} remaining</small>}</div></div>)}
              {displayedEmployeeLoanCalculations.map(({loan,amount,balanceAfter}:any,index:number)=><div className="pay-row" key={`loan-${loan?.id||index}`}><div><b>{loan?.type?`${String(loan.type)[0].toUpperCase()}${String(loan.type).slice(1)} recovery`:"Employee balance recovery"}</b><small>{loan?.reference||"Recorded employee balance"} · recovered after attachment orders</small></div><div className="rate-line"><b>−{money(amount)}</b>{balanceAfter!=null&&<small>{money(balanceAfter)} remaining</small>}</div></div>)}
              {displayedCashRounding&&<div className="pay-row"><div><b>Cash pay rounding</b><small>{money(displayedCashRounding.openingCarry)} brought forward · rounded down to £{displayedCashRounding.unit}</small></div><div className="rate-line"><b>{money(displayedCashRounding.roundedNet)} paid</b><small>{money(displayedCashRounding.closingCarry)} carried</small></div></div>}
              <button className="text-button" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onClick={()=>setModal("attachment")}>＋ Add attachment order</button>
              <button className="text-button" disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onClick={()=>setModal("loan")}>＋ Manage loan, advance or overpayment</button>
              <button className="text-button" disabled={!canPayrollWrite||periodLocked} onClick={()=>setModal("pay-rounding")}>＋ Manage cash pay rounding</button>
              <button className="text-button" disabled={!canPayrollWrite} onClick={()=>setModal("holiday-fund")}>＋ Manage holiday pay fund</button>
              <button className="text-button" disabled={!canPayrollWrite} onClick={()=>setModal("adjustments")}>＋ Add payroll correction</button>
              <button className="text-button" disabled={!canPayrollWrite} onClick={()=>setModal("benefit")}>＋ Declare expense or benefit</button>
              <button className="text-button" onClick={()=>setModal("benefit-register")}>View benefits register →</button>
            </div>
	            <div className="pay-card notes compact-card notes-card"><div className="section-title"><div><h2>Payroll notes</h2><p>Private notes for your payroll team, stored against this employee and period</p></div></div><textarea aria-label="Payroll note" placeholder="Add a private payroll note…" value={payrollNotes[`${period}:${employee.id}`]||""} disabled={!canPayrollWrite||periodLocked||!periodEmploymentActive} onChange={event=>{const value=event.target.value;setPayrollNotes(current=>({...current,[`${period}:${employee.id}`]:value}));setDirtyRuns(current=>new Set(current).add(`${period}:${employee.id}`));}} /></div>
            </div>
	            </>}
	            <FeatureLibrary active="Payroll" toast={toast} />
          </section>
          <aside className="summary">
            <div className="summary-heading"><div><b>Pay summary</b><small>Calculated payroll result</small></div><button className="outline summary-edit" disabled={!canEmployeeWrite} onClick={() => { setFormTab("Personal"); setModal("employee"); }}>✎ Edit employee</button></div>
            <dl><dt>Tax code</dt><dd>{employee.taxCode}</dd><dt>NI category</dt><dd>{employee.ni}</dd><dt>Department</dt><dd>{employee.department}</dd><dt>Pay method</dt><dd>{(employee.paymentMethod||"credit-transfer").replaceAll("-"," ")}</dd></dl>
	            <div className="summary-tabs"><button className={summaryBasis==="period"?"selected":""} onClick={()=>setSummaryBasis("period")}>This period</button><button className={summaryBasis==="ytd"?"selected":""} onClick={()=>setSummaryBasis("ytd")}>{periodMigrated?"Migration opening":"Year to date"}</button></div>
            <SummaryLine label="Gross pay" value={summaryPayroll.gross} strong />
            <SummaryLine label="PAYE tax" value={summaryPayroll.tax} />
            <SummaryLine label="Employee NIC" value={summaryPayroll.employeeNic} />
            <SummaryLine label="Employer NIC" value={summaryPayroll.employerNic} />
            <SummaryLine label="Employee pension" value={summaryPayroll.pension} />
            <SummaryLine label="Employer pension" value={summaryPayroll.employerPension} />
            <SummaryLine label="Net pay" value={summaryPayroll.net} strong highlight />
            <SummaryLine label="Cost to employer" value={summaryPayroll.employerCost} strong />
          </aside>
        </section>:<section className="empty-payroll"><div><span className="eyebrow">GET STARTED</span><h1>Add your first employee</h1><p>The payroll year is ready. Create an employee record to enter pay, calculate deductions and finalise Period {period}.</p><button className="primary" disabled={!canEmployeeWrite} onClick={addEmployee}>＋ Add employee</button></div></section>}
      </>}

	      {active !== "Payroll" && <ModulePage active={active} employerName={employerName} employees={employees} finalised={finalised} completed={completedPeriods} workflowStatus={workflowStatus} canEmployeeWrite={canEmployeeWrite} onOpenEmployee={(id) => {setSelectedId(id);setModal("employee");}} onAddEmployee={addEmployee} onSwitchEmployer={setActiveEmployerId} onDataChanged={loadPayrollRecords} toast={toast} />}
      {notice && <div className={`toast ${noticeError?"error":""}`}>{noticeError?"!":"✓"} {notice}</div>}
      {modal === "employee" && employee&&<EmployeeModal employee={employee} tab={formTab} setTab={setFormTab} update={updateEmployee} close={closeEmployeeEditor} save={saveEmployeeRecord} remove={deleteEmployeeRecord} invite={createPortalInvite} canInvite={employeeDefaults.some(item=>item.id===employee.id)} />}
      {modal === "calendar" && employee&&<CalendarModal employee={employee} period={period} close={() => setModal(null)} saved={(message,event,keepOpen) => { if(event)updateEmployee({statutoryPayPreview:statutoryPayAllocationForRange(event,currentScheduledPeriod.periodStart,currentScheduledPeriod.periodEnd).pay});loadLeaveRecords().catch(()=>undefined);if(!keepOpen)setModal(null);toast(message); }} />}
      {modal === "benefit" && employee&&<BenefitModal employee={employee} close={()=>setModal(null)} saved={(message,success)=>{toast(message,success);if(success!==false){loadBenefitRecords().catch(()=>undefined);setModal(null);}}}/>}
      {modal === "benefit-register" && employee&&<BenefitRegisterModal employee={employee} canWrite={canPayrollWrite} close={()=>setModal(null)} saved={(message)=>{toast(message);loadBenefitRecords().catch(()=>undefined);}}/>}
      {modal === "attachment" && employee&&<AttachmentModal employee={employee} netPay={calculatedPayrollAdjusted.net} close={()=>setModal(null)} saved={(message,success)=>{toast(message,success);if(success!==false){loadAttachmentRecords().catch(()=>undefined);setModal(null);}}}/>}
      {modal === "loan" && employee&&<EmployeeLoanModal employee={employee} close={()=>setModal(null)} saved={(message,success)=>{toast(message,success);if(success!==false)loadEmployeeLoanRecords().catch(()=>undefined);}}/>}
      {modal === "pay-rounding" && employee&&<CashPayRoundingModal employee={employee} close={()=>setModal(null)} saved={(message,success)=>{toast(message,success);if(success!==false)loadPayRoundingRecords().catch(()=>undefined);}}/>}
      {modal === "holiday-fund" && employee&&<HolidayFundModal employee={employee} period={period} periodLocked={periodLocked} periodStart={currentScheduledPeriod.periodStart} close={()=>setModal(null)} saved={(message,success)=>{toast(message,success);if(success!==false)loadPayrollRecords().catch(()=>undefined);}}/>}
      {modal === "mileage" && employee&&<MileageAllowanceModal employee={employee} priorMileageMiles={priorMileageMiles} close={()=>setModal(null)} add={items=>{updateEmployee({payItems:[...(employee.payItems||[]),...items]});setModal(null);toast(items.length===1?"Mileage allowance added to this payroll draft.":"Mileage allowance split into the correct PAYE and NIC treatments.");}}/>}
      {modal === "childcare" && employee&&<ChildcareVoucherModal close={()=>setModal(null)} add={items=>{updateEmployee({payItems:[...(employee.payItems||[]),...items]});setModal(null);toast("Legacy childcare voucher salary sacrifice added with its Class 1 excess treatment.");}}/>}
      {modal === "payitem" && <PayItemModal employee={calculationEmployee||employee} period={period} history={calculationHistory} activeLoans={activeEmployeeLoans} cashRounding={activeCashRounding} automaticPayrolledBenefits={automaticPayrolledBenefits} automaticClass1Benefits={automaticClass1Benefits} adjustmentTotals={adjustmentTotals} activeAttachmentOrders={activeAttachmentOrders} nonAttachableStatutoryPay={nonAttachableStatutoryPay} previousPayDate={previousPayDate} payrollCalculationDate={payrollCalculationDate} automaticEnrolmentScheme={activePensionScheme} hasPensionMembership={Boolean(pensionMembership)} close={()=>setModal(null)} add={items=>{updateEmployee({payItems:[...(employee.payItems||[]),...items]});setModal(null);toast("Pay item added to this payroll draft.");}} saved={(message,success)=>{toast(message,success);if(success!==false){loadPayrollRecords().catch(()=>undefined);setModal(null);}}}/>}
      {modal === "pay-details-import" && <PayDetailsImportModal employees={employees} period={period} taxYear={taxYear} scheduled={currentScheduledPeriod} maximumPeriods={maximumPeriods} close={()=>setModal(null)} save={async imported=>{setEmployees(imported);setDirtyRuns(new Set(imported.map(item=>`${period}:${item.id}`)));const saved=await processPayroll("draft",imported,"pay-details-csv");if(saved)setModal(null);return saved;}}/>}
      {modal === "schedules" && <ScheduleModal employee={employee} period={period} close={()=>setModal(null)} saved={toast} refresh={loadPayrollRecords}/>}
      {modal === "adjustments" && <AdjustmentModal employee={employee} period={period} periodLocked={periodLocked} close={()=>setModal(null)} saved={(message)=>{toast(message);loadAdjustmentRecords().catch(()=>undefined);}}/>}
      {modal === "email-payslips" && <EmailPayslipsModal period={period} close={()=>setModal(null)} saved={toast}/>}
      {modal === "payslip-deliveries" && <PayslipDeliveryModal close={()=>setModal(null)} saved={toast}/>}
      {modal === "requests" && <RequestInboxModal close={()=>setModal(null)} saved={toast} refresh={loadPayrollRecords}/>}
    </main>
  );
}

function PeriodBar({ period, taxYear, periods, schedule, frequency, onSelect }: { period: number; taxYear:string;periods:PersistedPeriod[];schedule:ScheduledPayPeriod[];frequency:PayrollFrequency; onSelect: (n: number) => void }) {
  const finalised=periods.filter(item=>item.status==="finalised").map(item=>item.periodNumber);
  const migrated=periods.filter(item=>item.status==="migrated").map(item=>item.periodNumber);
  const completed=[...finalised,...migrated],open = nextOpenPeriod(completed,schedule.length),rule=payrollFrequencyRule(frequency);
  const trackRef=useRef<HTMLDivElement>(null);
  const [scrollState,setScrollState]=useState({left:false,right:schedule.length>8});
  function updateScrollState(){
    const track=trackRef.current;if(!track)return;
    setScrollState({left:track.scrollLeft>3,right:track.scrollLeft+track.clientWidth<track.scrollWidth-3});
  }
  function scrollPeriods(direction:-1|1){
    const track=trackRef.current;if(!track)return;
    const first=track.querySelector<HTMLElement>("button"),gap=Number.parseFloat(getComputedStyle(track).gap)||0,step=(first?.offsetWidth||88)+gap;
    const visibleSteps=Math.max(3,Math.floor(track.clientWidth*.78/step));
    track.scrollBy({left:direction*visibleSteps*step,behavior:"smooth"});
    window.setTimeout(updateScrollState,350);
  }
  useEffect(()=>{
    const track=trackRef.current;if(!track)return;
    const buttons=[...track.querySelectorAll<HTMLElement>("button")],current=track.querySelector<HTMLElement>('[aria-current="true"]');
    if(current){
      const gap=Number.parseFloat(getComputedStyle(track).gap)||0,step=current.offsetWidth+gap,currentIndex=buttons.indexOf(current);
      const visibleCount=Math.max(1,Math.floor((track.clientWidth+gap)/step));
      const firstIndex=Math.max(0,Math.min(buttons.length-visibleCount,currentIndex-Math.floor(visibleCount/2)));
      const aligned=Math.max(0,buttons[firstIndex].offsetLeft-(buttons[0]?.offsetLeft||0));
      track.scrollTo({left:aligned,behavior:"smooth"});
    }
    const timer=window.setTimeout(updateScrollState,350);
    window.addEventListener("resize",updateScrollState);
    return ()=>{window.clearTimeout(timer);window.removeEventListener("resize",updateScrollState);};
  },[period,schedule.length]);
  return <div className="period-wrap"><div className="period-label"><b>{taxYear}</b><small>{rule.label} payroll</small></div><button type="button" className="period-arrow previous" aria-label="Show earlier payroll periods" disabled={!scrollState.left} onClick={()=>scrollPeriods(-1)}>‹</button><div className="periods" ref={trackRef} onScroll={updateScrollState}>
    {schedule.map(item => { const n=item.periodNumber,locked=n>open&&!completed.includes(n),date=new Date(`${item.payDate}T00:00:00Z`),shortDate=new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",timeZone:"UTC"}).format(date); return <button key={n} aria-current={n===period?"true":undefined} disabled={locked} onClick={() => onSelect(n)} className={`${n === period ? "current" : ""} ${finalised.includes(n) ? "done" : ""} ${migrated.includes(n)?"migrated":""}`} title={`${formatUkDate(item.periodStart)} to ${formatUkDate(item.periodEnd)}`}>
      <span>P{n}</span><b>{frequency==="monthly"?months[item.taxMonth-1]:shortDate}</b><i>{finalised.includes(n) ? "✓" : migrated.includes(n)?"Imported":n === open ? "Open" : "—"}</i>
    </button>; })}
  </div><button type="button" className="period-arrow next" aria-label="Show later payroll periods" disabled={!scrollState.right} onClick={()=>scrollPeriods(1)}>›</button></div>;
}

type ModulePeriodItem={value:number;prefix:string;label:string;status:string;disabled?:boolean;done?:boolean;title?:string};
function ModulePeriodBar({title,subtitle,items,value,onSelect,ariaLabel}:{title:string;subtitle:string;items:ModulePeriodItem[];value:number;onSelect:(value:number)=>void;ariaLabel:string}){
  const trackRef=useRef<HTMLDivElement>(null),[scrollState,setScrollState]=useState({left:false,right:false});
  const updateScrollState=()=>{const track=trackRef.current;if(!track)return;setScrollState({left:track.scrollLeft>2,right:track.scrollLeft+track.clientWidth<track.scrollWidth-2});};
  const scroll=(direction:-1|1)=>{const track=trackRef.current;if(!track)return;track.scrollBy({left:direction*Math.max(180,track.clientWidth*.72),behavior:"smooth"});window.setTimeout(updateScrollState,350);};
  useEffect(()=>{const track=trackRef.current;if(!track)return;const current=track.querySelector<HTMLElement>(`button[data-period-value="${value}"]`);if(current){const target=Math.max(0,current.offsetLeft-track.clientWidth/2+current.offsetWidth/2);track.scrollTo({left:target,behavior:"smooth"});}const timer=window.setTimeout(updateScrollState,350);window.addEventListener("resize",updateScrollState);return()=>{window.clearTimeout(timer);window.removeEventListener("resize",updateScrollState);};},[value,items.length]);
  return <div className="period-wrap module-period-wrap" aria-label={ariaLabel}><div className="period-label"><b>{title}</b><small>{subtitle}</small></div><button type="button" className="period-arrow previous" aria-label={`Show earlier ${subtitle.toLowerCase()}`} disabled={!scrollState.left} onClick={()=>scroll(-1)}>‹</button><div className="periods" ref={trackRef} onScroll={updateScrollState}>{items.map(item=><button type="button" key={item.value} data-period-value={item.value} aria-current={item.value===value?"true":undefined} className={`${item.value===value?"current":""} ${item.done?"done":""}`} disabled={item.disabled} title={item.title} onClick={()=>onSelect(item.value)}><span>{item.prefix}</span><b>{item.label}</b><i>{item.status}</i></button>)}</div><button type="button" className="period-arrow next" aria-label={`Show later ${subtitle.toLowerCase()}`} disabled={!scrollState.right} onClick={()=>scroll(1)}>›</button></div>;
}

function SummaryLine({ label, value, strong, highlight,format="money" }: { label: string; value: number; strong?: boolean; highlight?: boolean;format?:"money"|"number" }) {
  return <div className={`summary-line ${strong ? "strong" : ""} ${highlight ? "highlight" : ""}`}><span>{label}</span><b>{format==="number"?value.toLocaleString("en-GB"):money(value)}</b></div>;
}

function ModulePage({ active, employerName, employees, finalised,completed,workflowStatus,canEmployeeWrite,onOpenEmployee, onAddEmployee,onSwitchEmployer,onDataChanged, toast }: { active: string; employerName:string;employees: Employee[];finalised:number[];completed:number[];workflowStatus:PayrollWorkflowStatus;canEmployeeWrite:boolean; onOpenEmployee: (id:number) => void; onAddEmployee: () => void;onSwitchEmployer:(id:number)=>void;onDataChanged:()=>Promise<void>; toast: (s: string) => void }) {
  const taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const schedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]),frequencyRule=payrollFrequencyRule(payFrequency);
  const [employeeSort,setEmployeeSort]=useState("name-asc"),[historyEmployee,setHistoryEmployee]=useState<Employee|null>(null);
  const sortedEmployees=useMemo(()=>[...employees].sort((left,right)=>{
    const [field,direction]=employeeSort.split("-");
    const values:Record<string,[string,string]>={
      name:[left.name,right.name],department:[left.department||"",right.department||""],
      payroll:[left.payrollId||"",right.payrollId||""],status:[left.status||"",right.status||""],
      start:[left.startDate||"",right.startDate||""],
    };
    const comparison=(values[field]||values.name)[0].localeCompare((values[field]||values.name)[1],"en-GB",{numeric:true,sensitivity:"base"});
    return direction==="desc"?-comparison:comparison;
  }),[employees,employeeSort]);
  return <section className="module" data-module={active.toLowerCase()}>
    <div className="module-content">
    {active === "Employees" ? <><EmployerCalendarWorkspace canWrite={canEmployeeWrite} onAddEmployee={onAddEmployee} toast={toast}/><div className="data-card employee-register"><div className="register-toolbar"><div><b>Employee register</b><small>{sortedEmployees.length} visible record{sortedEmployees.length===1?"":"s"}</small></div><label><span>Order employees</span><select aria-label="Order employees" value={employeeSort} onChange={event=>setEmployeeSort(event.target.value)}><option value="name-asc">Name · A–Z</option><option value="name-desc">Name · Z–A</option><option value="department-asc">Department</option><option value="payroll-asc">Payroll ID</option><option value="status-asc">Employment status</option><option value="start-desc">Newest starters</option><option value="start-asc">Oldest starters</option></select></label></div><div className="report-table-scroll"><table><thead><tr><th>Employee</th><th>Payroll ID</th><th>Department</th><th>Tax code</th><th>Normal {frequencyRule.label.toLowerCase()} pay</th><th>Status</th><th>Actions</th></tr></thead><tbody>{sortedEmployees.map(e => <tr key={e.id}><td><b>{e.name}</b><small>{e.email}</small></td><td>{e.payrollId||"—"}<small>{e.startDate?`Started ${formatUkDate(e.startDate)}`:"Start date missing"}</small></td><td>{e.department||"Unassigned"}</td><td>{e.taxCode}</td><td>{money(periodicBasePay(e,payFrequency))}</td><td><span className={`status ${e.status === "Review" ? "amber" : ""}`}>{e.status}</span></td><td><div className="inline-actions"><button onClick={()=>setHistoryEmployee(e)}>History</button><button disabled={!canEmployeeWrite} onClick={()=>onOpenEmployee(e.id)}>{canEmployeeWrite?"Edit":"View only"}</button></div></td></tr>)}</tbody></table></div></div></> : active==="Analysis"?<AnalysisWorkspace toast={toast}/>: active === "Employer" ? <EmployerWorkspace toast={toast}/> : active === "CIS" ? <CisWorkspace toast={toast} /> : active === "RTI" ? <RtiWorkspace toast={toast} employees={employees} finalised={finalised} migrated={completed.filter(periodNumber=>!finalised.includes(periodNumber))} onDataChanged={onDataChanged}/> : active === "HMRC" ? <HmrcWorkspace toast={toast} onDataChanged={onDataChanged} /> : active === "Pensions" ? <PensionsWorkspace toast={toast} employees={employees} finalised={finalised} onDataChanged={onDataChanged}/> : active === "Reports" ? <ReportsWorkspace toast={toast} employerName={employerName} employees={employees} finalised={finalised}/> : active === "Clients" ? <><AccessWorkspace toast={toast} onSwitchEmployer={onSwitchEmployer}/><AgentWorkspace toast={toast}/></> : active === "Tools" ? <><UtilitiesWorkspace/><MidYearStartWorkspace toast={toast} employees={employees} completed={completed} finalised={finalised} onDataChanged={onDataChanged}/><DataToolsWorkspace toast={toast}/><ScenarioWorkspace toast={toast}/></> : <ModuleContent active={active} toast={toast} />}
    <FeatureLibrary active={active} toast={toast} />
    </div>
    {historyEmployee&&<EmployeeHistoryModal employee={historyEmployee} close={()=>setHistoryEmployee(null)} toast={toast}/>}
  </section>;
}

function EmployerCalendarWorkspace({canWrite,onAddEmployee,toast}:{canWrite:boolean;onAddEmployee:()=>void;toast:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [open,setOpen]=useState(false),[days,setDays]=useState<any[]>([]),[date,setDate]=useState(""),[name,setName]=useState(""),[type,setType]=useState("national-holiday"),[saving,setSaving]=useState(false);
  async function load(){
    const response=await fetch(`/api/calendar-days?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{cache:"no-store"}),body=await response.json();
    if(!response.ok)throw new Error(body.error||"Employer calendar could not be loaded.");setDays(body.days||[]);
  }
  useEffect(()=>{load().catch(error=>toast(error instanceof Error?error.message:"Employer calendar could not be loaded.",false));},[employerId,taxYear]);
  async function create(){
    setSaving(true);
    try{const response=await fetch("/api/calendar-days",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,date,name,type})}),body=await response.json();if(!response.ok)throw new Error(body.error);setDate("");setName("");await load();toast("Employer calendar day saved. New annual-leave bookings will exclude it automatically.");}
    catch(error){toast(error instanceof Error?error.message:"Employer calendar day could not be saved.",false);}finally{setSaving(false);}
  }
  async function update(item:any,action:"cancel"|"restore"){
    const response=await fetch("/api/calendar-days",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:item.id,action})}),body=await response.json();
    if(!response.ok)return toast(body.error||"Employer calendar day could not be updated.",false);
    await load();toast(`${item.name} ${action==="cancel"?"cancelled":"restored"}.${body.frozenLeaveEvents?` ${body.frozenLeaveEvents} existing leave record(s) retain the original exclusion evidence.`:""}`);
  }
  const activeDays=days.filter(item=>item.status==="active");
  return <section className="operation-card employer-calendar-card"><div className="card-head"><div><h2>Employer calendar and national holidays</h2><p>{taxYear} · company-wide non-working days used by annual-leave calculations.</p></div><div className="inline-actions"><span className="status">{activeDays.length} active</span><button className="primary" disabled={!canWrite} onClick={onAddEmployee}>＋ Add employee</button><button onClick={()=>setOpen(value=>!value)}>{open?"Hide calendar":"Manage calendar"}</button></div></div>{open&&<div className="employer-calendar-body"><div className="form-grid"><Field label="Date" value={date} type="date" onChange={setDate}/><Field label="Name" value={name} onChange={setName}/><label className="field"><span>Calendar-day type</span><select value={type} onChange={event=>setType(event.target.value)}><option value="national-holiday">National or bank holiday</option><option value="company-closure">Company closure</option></select></label><div className="field calendar-add-action"><span>Save date</span><button className="primary" disabled={!canWrite||saving||!date||name.trim().length<2} onClick={create}>{saving?"Saving…":"Add calendar day"}</button></div></div>{days.length?<div className="report-table-scroll"><table><thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Status</th><th>Action</th></tr></thead><tbody>{days.map(item=><tr key={item.id}><td><b>{formatUkDate(item.date)}</b></td><td>{item.name}</td><td>{String(item.type).replaceAll("-"," ")}</td><td><span className={`status ${item.status==="active"?"":"amber"}`}>{item.status}</span></td><td>{item.status==="active"?<button disabled={!canWrite} onClick={()=>update(item,"cancel")}>Cancel</button>:<button disabled={!canWrite} onClick={()=>update(item,"restore")}>Restore</button>}</td></tr>)}</tbody></table></div>:<div className="empty-workflow"><p>No employer-wide holiday or closure dates have been recorded for {taxYear}.</p></div>}<small>Only annual leave and other work-pattern absences exclude these dates. SSP qualifying days remain driven by the employee’s actual contractual work pattern. Existing leave records retain the exact calendar dates used when they were saved.</small></div>}</section>;
}

function UtilitiesWorkspace(){
  const [mode,setMode]=useState<"gross"|"target">("gross"),[gross,setGross]=useState(3000),[targetNet,setTargetNet]=useState(2400);
  const [taxCode,setTaxCode]=useState("1257L"),[niCategory,setNiCategory]=useState("A"),[studentLoanPlan,setStudentLoanPlan]=useState<Employee["studentLoanPlan"]>(null);
  const [postgraduateLoan,setPostgraduateLoan]=useState(false),[pensionEmployeeRate,setPensionEmployeeRate]=useState(0),[pensionEmployerRate,setPensionEmployerRate]=useState(0),[hours,setHours]=useState(173.33);
  const calculation=useMemo(()=>{
    try{
      const base={taxCode,week1Month1:true,niCategory,studentLoanPlan,postgraduateLoan,pensionEmployeeRate,pensionEmployerRate,pensionBasis:"qualifying" as const,pensionTaxRelief:"relief-at-source" as const,contractedHours:hours,periodNumber:1};
      const target=mode==="target"?solveGrossForTargetNet(base,targetNet):null;
      const calculatedGross=target?.requiredGrossPay??Math.max(0,gross);
      return {gross:calculatedGross,target,result:calculateMonthlyPayroll({...base,grossPay:calculatedGross}),error:""};
    }catch(error){return {gross:0,target:null,result:null,error:error instanceof Error?error.message:"The estimate could not be calculated."};}
  },[mode,gross,targetNet,taxCode,niCategory,studentLoanPlan,postgraduateLoan,pensionEmployeeRate,pensionEmployerRate,hours]);
  return <section className="operation-card utilities-card"><div className="card-head"><div><h2>Payroll calculator and 2026/27 rates</h2><p>Run an isolated single-period estimate through the same PAYE, NIC, loan and pension engine used by payroll.</p></div><span className="status">Shared engine</span></div><div className="utilities-grid"><div><div className="subnav"><button className={mode==="gross"?"active":""} onClick={()=>setMode("gross")}>Gross to net</button><button className={mode==="target"?"active":""} onClick={()=>setMode("target")}>Target net to gross</button></div><div className="form-grid form-pad">{mode==="gross"?<Field label="Monthly gross pay" value={String(gross)} type="number" onChange={value=>setGross(Number(value))}/>:<Field label="Target monthly net pay" value={String(targetNet)} type="number" onChange={value=>setTargetNet(Number(value))}/>}<Field label="Tax code" value={taxCode} onChange={value=>setTaxCode(value.toUpperCase())}/><label className="field"><span>NI category</span><select value={niCategory} onChange={event=>setNiCategory(event.target.value)}>{["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"].map(value=><option key={value}>{value}</option>)}</select></label><label className="field"><span>Student loan</span><select value={studentLoanPlan||""} onChange={event=>setStudentLoanPlan((event.target.value||null) as Employee["studentLoanPlan"])}><option value="">None</option><option value="1">Plan 1</option><option value="2">Plan 2</option><option value="4">Plan 4</option><option value="5">Plan 5</option></select></label><Field label="Employee pension %" value={String(pensionEmployeeRate)} type="number" onChange={value=>setPensionEmployeeRate(Number(value))}/><Field label="Employer pension %" value={String(pensionEmployerRate)} type="number" onChange={value=>setPensionEmployerRate(Number(value))}/><Field label="Paid hours this month" value={String(hours)} type="number" onChange={value=>setHours(Number(value))}/><Check text="Postgraduate loan" checked={postgraduateLoan} onChange={setPostgraduateLoan}/></div>{calculation.error?<div className="portal-message benefit-error" role="alert">{calculation.error}</div>:calculation.result&&<div className="calculator-result"><div><span>Gross pay</span><strong>{money(calculation.result.grossPay)}</strong></div><div><span>PAYE</span><strong>{money(calculation.result.incomeTax)}</strong></div><div><span>Employee NIC</span><strong>{money(calculation.result.employeeNic)}</strong></div><div><span>Loans</span><strong>{money(calculation.result.studentLoan+calculation.result.postgraduateLoan)}</strong></div><div><span>Employee pension</span><strong>{money(calculation.result.employeePension)}</strong></div><div className="highlight"><span>Estimated net pay</span><strong>{money(calculation.result.netPay)}</strong></div><div><span>Employer NIC</span><strong>{money(calculation.result.employerNic)}</strong></div><div><span>Employer cost</span><strong>{money(calculation.result.employerCost)}</strong></div>{calculation.target&&<small>Target difference {money(calculation.target.difference)} after {calculation.target.iterations} solver iterations.</small>}{calculation.result.warnings.map(warning=><small key={warning}>! {warning}</small>)}</div>}<small>This is a non-cumulative W1/M1 estimate and does not change payroll. Final calculations use the employee’s stored year-to-date evidence, pay period and statutory records.</small></div><div className="rates-panel"><h3>2026/27 monthly reference</h3><table><thead><tr><th>Rule</th><th>Threshold / rate</th></tr></thead><tbody><tr><td>Standard personal allowance</td><td>£12,570 a year</td></tr><tr><td>PAYE basic / higher / additional</td><td>20% / 40% / 45%</td></tr><tr><td>Employee NIC category A</td><td>8% from £1,048 to £4,189; 2% above</td></tr><tr><td>Employer NIC category A</td><td>15% above £417</td></tr><tr><td>Plan 1 / 2 / 4 / 5</td><td>9% above £2,241.66 / £2,448.75 / £2,816.25 / £2,083.33</td></tr><tr><td>Postgraduate loan</td><td>6% above £1,750</td></tr><tr><td>Qualifying earnings pension band</td><td>£520 to £4,189</td></tr><tr><td>National Living Wage</td><td>£12.71 an hour</td></tr><tr><td>Statutory family-pay cap</td><td>£194.32 a week</td></tr><tr><td>SSP maximum</td><td>£123.25 a week</td></tr></tbody></table><div className="portal-message">Rates are the software’s locked 2026/27 calculation basis. A tax-year rollover must load and verify the next year’s statutory rate pack before payroll can be processed.</div></div></div></section>;
}

type ScenarioReport = {
  summary: { employees:number; periods:number; payrollChecks:number; passed:number; failed:number; cisCases:number };
  payroll: { id:string; employee:string; case:string; status:string; failures:string[]; months:{grossPay:number;incomeTax:number;employeeNic:number;netPay:number}[] }[];
  cis: { subcontractor:string; rate:number; gross:number; deduction:number; netPayment:number; status:string }[];
  remainingImplementation: string[];
};

type OpeningNicLine={niCategory:string;nicablePay:number;earningsAtLel:number;earningsLelToPt:number;earningsPtToUel:number;earningsAboveUel:number;employeeNic:number;employerNic:number};
type OpeningBalanceDraft={
  grossPay:number;taxablePay:number;payeTax:number;nicablePay:number;earningsAtLel:number;earningsLelToPt:number;
  earningsPtToUel:number;earningsAboveUel:number;employeeNic:number;employerNic:number;studentLoan:number;
  postgraduateLoan:number;statutoryPay:number;employeePension:number;employerPension:number;netPay:number;
  nicCategoryBreakdown:OpeningNicLine[];source:string;notes:string;
};
const emptyOpeningNicLine=(niCategory="A"):OpeningNicLine=>({niCategory,nicablePay:0,earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0,employeeNic:0,employerNic:0});
const openingNicLines=(row:any,defaultCategory:string):OpeningNicLine[]=>{
  try{
    const parsed=JSON.parse(row?.nicCategoryBreakdown||"[]");
    if(Array.isArray(parsed)&&parsed.length)return parsed.map(line=>({...emptyOpeningNicLine(defaultCategory),...line,niCategory:String(line.niCategory||defaultCategory)}));
  }catch{}
  return [{...emptyOpeningNicLine(defaultCategory),nicablePay:Number(row?.nicablePay||0),earningsAtLel:Number(row?.earningsAtLel||0),
    earningsLelToPt:Number(row?.earningsLelToPt||0),earningsPtToUel:Number(row?.earningsPtToUel||0),
    earningsAboveUel:Number(row?.earningsAboveUel||0),employeeNic:Number(row?.employeeNic||0),employerNic:Number(row?.employerNic||0)}];
};
const emptyOpeningBalance=(niCategory="A"):OpeningBalanceDraft=>({
  grossPay:0,taxablePay:0,payeTax:0,nicablePay:0,earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,
  earningsAboveUel:0,employeeNic:0,employerNic:0,studentLoan:0,postgraduateLoan:0,statutoryPay:0,
  employeePension:0,employerPension:0,netPay:0,nicCategoryBreakdown:[emptyOpeningNicLine(niCategory)],source:"prior-payroll-p11",notes:"",
});

function MidYearStartWorkspace({toast,employees,completed,finalised,onDataChanged}:{toast:(message:string,success?:boolean)=>void;employees:Employee[];completed:number[];finalised:number[];onDataChanged:()=>Promise<void>}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const [open,setOpen]=useState(false),[firstPayFlowPeriod,setFirstPayFlowPeriod]=useState(2),[records,setRecords]=useState<any[]>([]);
  const [drafts,setDrafts]=useState<Record<number,OpeningBalanceDraft>>({}),[savingId,setSavingId]=useState(0),[loading,setLoading]=useState(false);
  const payrollStarted=finalised.length>0;
  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/opening-balances?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{cache:"no-store"}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setRecords(body);
      if(body.length)setFirstPayFlowPeriod(Number(body[0].firstPayFlowPeriod));
      setDrafts(Object.fromEntries(employees.map(employee=>{
        const row=body.find((item:any)=>item.employeeId===employee.id);
        return [employee.id,row?{...emptyOpeningBalance(employee.ni),...row,nicCategoryBreakdown:openingNicLines(row,employee.ni),notes:row.notes||""}:emptyOpeningBalance(employee.ni)];
      })));
    }catch(error){toast(error instanceof Error?error.message:"Mid-year opening balances could not be loaded.",false);}
    finally{setLoading(false);}
  }
  useEffect(()=>{load().catch(()=>undefined);},[employees.length,employerId,taxYear]);
  const setValue=(employeeId:number,key:keyof OpeningBalanceDraft,value:string|number)=>setDrafts(current=>({
    ...current,[employeeId]:{...(current[employeeId]||emptyOpeningBalance()),[key]:typeof value==="number"?value:value},
  }));
  const setNicLines=(employeeId:number,lines:OpeningNicLine[])=>setDrafts(current=>{
    const draft=current[employeeId]||emptyOpeningBalance(),sum=(key:keyof Omit<OpeningNicLine,"niCategory">)=>roundMoney(lines.reduce((total,line)=>total+Number(line[key]||0),0));
    return {...current,[employeeId]:{...draft,nicCategoryBreakdown:lines,nicablePay:sum("nicablePay"),earningsAtLel:sum("earningsAtLel"),
      earningsLelToPt:sum("earningsLelToPt"),earningsPtToUel:sum("earningsPtToUel"),earningsAboveUel:sum("earningsAboveUel"),
      employeeNic:sum("employeeNic"),employerNic:sum("employerNic")}};
  });
  async function save(employee:Employee){
    const draft=drafts[employee.id]||emptyOpeningBalance();setSavingId(employee.id);
    try{
      const response=await fetch("/api/opening-balances",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        employerId,taxYear,firstPayFlowPeriod,payrollId:employee.payrollId||fallbackPayrollId(employee,taxYear),...draft,
      })}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      await Promise.all([load(),onDataChanged()]);
      toast(`${employee.name} opening balance saved. Periods 1–${firstPayFlowPeriod-1} are locked as migrated history.`);
    }catch(error){toast(error instanceof Error?error.message:"Opening balance could not be saved.",false);}
    finally{setSavingId(0);}
  }
  const importedIds=new Set(records.map(item=>item.employeeId));
  return <section className="operation-card mid-year-start"><div className="card-head"><div><h2>Mid-year payroll start</h2><p>Carry audited P11 year-to-date values from a previous payroll system into PayFlow.</p></div><span className={`status ${records.length?"":"amber"}`}>{records.length?`${records.length} imported`:"Not configured"}</span></div>
    <div className="portal-message"><b>Opening balances are this employer’s earlier payroll history.</b><br/>They are separate from P45 previous-employment figures. Earlier periods become read-only “Imported” periods; PayFlow starts calculations and submissions at the selected period without recreating old HMRC liabilities or payslips.</div>
    <div className="operation-footer mid-year-controls"><label className="field"><span>First period processed in PayFlow</span><select value={firstPayFlowPeriod} disabled={payrollStarted||records.length>0} onChange={event=>setFirstPayFlowPeriod(Number(event.target.value))}>{paySchedule.slice(1).map(item=><option key={item.periodNumber} value={item.periodNumber}>Period {item.periodNumber} · pay date {item.payDate}</option>)}</select><small>All employees use one migration boundary.</small></label><button onClick={()=>setOpen(value=>!value)}>{open?"Hide opening-balance editor":"Open opening-balance editor"}</button></div>
    {open&&(loading?<div className="empty-workflow"><p>Loading opening balances…</p></div>:!employees.length?<div className="empty-workflow"><p>Add employees before importing their opening balances.</p></div>:<div className="opening-balance-list">{employees.map(employee=>{
      const draft=drafts[employee.id]||emptyOpeningBalance(employee.ni),imported=importedIds.has(employee.id);
      const numberField=(key:keyof OpeningBalanceDraft,label:string)=><label className="field" key={key}><span>{label}</span><input aria-label={`${employee.name} ${label}`} type="number" min="0" step="0.01" disabled={payrollStarted} value={Number(draft[key]||0)} onChange={event=>setValue(employee.id,key,Number(event.target.value))}/></label>;
      return <article className="opening-balance-employee" key={employee.id}><div className="card-head"><div><h3>{employee.name}</h3><p>{employee.payrollId||fallbackPayrollId(employee,taxYear)} · values immediately before Period {firstPayFlowPeriod}</p></div><span className={`status ${imported?"":"amber"}`}>{imported?"Imported":"Not imported"}</span></div>
        <div className="form-grid">
          {numberField("grossPay","Gross pay YTD")}{numberField("taxablePay","Taxable pay YTD")}{numberField("payeTax","PAYE tax YTD")}
          {numberField("studentLoan","Student loan YTD")}{numberField("postgraduateLoan","Postgraduate loan YTD")}
          {numberField("statutoryPay","Statutory pay YTD")}{numberField("employeePension","Employee pension YTD")}{numberField("employerPension","Employer pension YTD")}{numberField("netPay","Net pay YTD")}
          <label className="field"><span>Evidence source</span><select value={draft.source} disabled={payrollStarted} onChange={event=>setValue(employee.id,"source",event.target.value)}><option value="prior-payroll-p11">Prior payroll P11</option><option value="prior-provider-export">Prior provider export</option><option value="accountant-confirmation">Accountant-confirmed balance</option></select></label>
          <label className="field"><span>Evidence notes</span><input value={draft.notes} disabled={payrollStarted} maxLength={500} onChange={event=>setValue(employee.id,"notes",event.target.value)} placeholder="Report date, file reference or reconciliation note"/></label>
        </div>
        <section className="nic-opening-editor"><div className="card-head"><div><h4>National Insurance opening totals by category</h4><p>Keep a separate row for every NI letter used before migration. FPS year-to-date earnings bands are reported under the original category.</p></div><button disabled={payrollStarted} onClick={()=>setNicLines(employee.id,[...draft.nicCategoryBreakdown,emptyOpeningNicLine(employee.ni)])}>＋ Add NI category</button></div>
          {draft.nicCategoryBreakdown.map((line,index)=><div className="nic-opening-row" key={`${index}-${line.niCategory}`}>
            <label className="field"><span>NI category</span><select aria-label={`${employee.name} NI category row ${index+1}`} value={line.niCategory} disabled={payrollStarted} onChange={event=>setNicLines(employee.id,draft.nicCategoryBreakdown.map((item,itemIndex)=>itemIndex===index?{...item,niCategory:event.target.value}:item))}>{["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"].map(category=><option key={category}>{category}</option>)}</select></label>
            {(["nicablePay","earningsAtLel","earningsLelToPt","earningsPtToUel","earningsAboveUel","employeeNic","employerNic"] as const).map(key=><label className="field" key={key}><span>{{nicablePay:"NIC-able pay",earningsAtLel:"At LEL",earningsLelToPt:"LEL to PT",earningsPtToUel:"PT to UEL",earningsAboveUel:"Above UEL",employeeNic:"Employee NIC",employerNic:"Employer NIC"}[key]}</span><input aria-label={`${employee.name} ${line.niCategory} ${key}`} type="number" min="0" step="0.01" disabled={payrollStarted} value={line[key]} onChange={event=>setNicLines(employee.id,draft.nicCategoryBreakdown.map((item,itemIndex)=>itemIndex===index?{...item,[key]:Number(event.target.value)}:item))}/></label>)}
            <button className="danger-button" disabled={payrollStarted||draft.nicCategoryBreakdown.length===1} onClick={()=>setNicLines(employee.id,draft.nicCategoryBreakdown.filter((_,itemIndex)=>itemIndex!==index))}>Remove</button>
          </div>)}
          <small>NI totals: {money(draft.nicablePay)} NIC-able pay · {money(draft.employeeNic)} employee NIC · {money(draft.employerNic)} employer NIC.</small>
        </section>
        <div className="operation-footer"><small>{imported?`Checksum ${String(records.find(item=>item.employeeId===employee.id)?.payloadChecksum||"").slice(0,12)}…`:"No opening balance is currently included for this employee."}</small><button className="primary" disabled={savingId>0||payrollStarted} onClick={()=>save(employee)}>{savingId===employee.id?"Saving…":imported?"Update opening balance":"Save opening balance"}</button></div>
      </article>;
    })}</div>)}
    {payrollStarted&&<div className="portal-message benefit-error">Mid-year balances are locked because PayFlow payroll records already exist. They can only be entered before the first draft is saved.</div>}
    {!payrollStarted&&completed.length>0&&records.length>0&&<small>Imported periods: {completed.filter(value=>value<firstPayFlowPeriod).map(value=>`P${value}`).join(", ")}. The first operational period is P{firstPayFlowPeriod}.</small>}
  </section>;
}

function PayDetailsImportModal({employees,period,taxYear,scheduled,maximumPeriods,close,save}:{employees:Employee[];period:number;taxYear:string;scheduled:ScheduledPayPeriod;maximumPeriods:number;close:()=>void;save:(employees:Employee[])=>Promise<boolean|void>}) {
  const payFrequency=usePayFrequency();
  const [prepared,setPrepared]=useState<PreparedPayDetail[]>([]),[errors,setErrors]=useState<string[]>([]);
  const [filename,setFilename]=useState(""),[saving,setSaving]=useState(false);
  const activeEmployees=employees.filter(employee=>employeeActiveInRange(employee.startDate,employee.leavingDate,scheduled.periodStart,scheduled.periodEnd));
  function downloadTemplate(){
    const headers=["period","payrollId","type","description","quantity","rate","amount","taxable","nicable","pensionable"];
    const example=activeEmployees[0];
    const payrollId=example?.payrollId||"PAY-001";
    const rows=[
      [String(period),payrollId,"period-pay","Period pay","","",String(roundMoney(example?.pay||2500)),"true","true","true"],
      [String(period),payrollId,"additional-hours","Additional hours","8",String(roundMoney(example?.rate||12.71)),"","true","true","true"],
      [String(period),payrollId,"earning","Performance bonus","","","250","true","true","true"],
      [String(period),payrollId,"post-tax-deduction","Staff purchase repayment","","","40","false","false","false"],
    ];
    const csvLine=(values:string[])=>values.map(value=>`"${value.replaceAll('"','""')}"`).join(",");
    downloadClientBlob(new Blob(["\uFEFF",csvLine(headers),"\r\n",rows.map(csvLine).join("\r\n")],{type:"text/csv;charset=utf-8"}),`payflow-pay-details-period-${period}.csv`);
  }
  async function loadFile(file?:File){
    if(!file)return;
    setFilename(file.name);setPrepared([]);setErrors([]);
    try{
      if(file.size>2_000_000)throw new Error("Pay-detail CSV must be 2 MB or smaller.");
      const rows=parseCsvRecords(await file.text(),["period","payrollId","type","description","quantity","rate","amount","taxable","nicable","pensionable"],"pay-detail");
      const result=validatePayDetailsImportRows(rows,period,activeEmployees.map(employee=>employee.payrollId||fallbackPayrollId(employee,taxYear)),maximumPeriods,payFrequency);
      setPrepared(result.prepared);setErrors(result.errors);
    }catch(error){setErrors([error instanceof Error?error.message:"Pay-detail CSV could not be read."]);}
  }
  async function applyImport(){
    if(errors.length||!prepared.length||saving)return;
    setSaving(true);
    const affected=new Set(prepared.map(row=>row.payrollId.toLowerCase()));
    const imported=employees.map(employee=>{
      const payrollId=(employee.payrollId||fallbackPayrollId(employee,taxYear)).toLowerCase();
      if(!affected.has(payrollId))return employee;
      const rows=prepared.filter(row=>row.payrollId.toLowerCase()===payrollId);
      const salary=rows.find(row=>["period-pay","monthly-salary"].includes(row.type)),hours=rows.find(row=>row.type==="additional-hours");
      const items:PayLine[]=rows.filter(row=>!["period-pay","monthly-salary","additional-hours"].includes(row.type)).map(row=>({
        id:-2_000_000-row.rowNumber,
        type:row.type as PayLine["type"],name:row.description,quantity:row.quantity,rate:row.rate,amount:row.amount,
        taxable:row.taxable,nicable:row.nicable,pensionable:row.pensionable,
      }));
      return {
        ...employee,pay:salary?.amount??employee.pay,hours:hours?.quantity??employee.hours,rate:hours?.rate??employee.rate,
        payItems:[...(employee.payItems||[]).filter(item=>item.recurringItemId),...items],
      };
    });
    const saved=await save(imported);
    if(saved!==true)setErrors(["The imported values were validated, but the payroll draft was not saved. Resolve the payroll message and try again."]);
    setSaving(false);
  }
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Import pay details"><div className="modal pay-details-import-modal"><header><div><span className="eyebrow">PERIOD {period} PAY INPUT</span><h2>Import pay details</h2><small>Validated employee earnings and deductions feed the standard payroll calculation engine.</small></div><button aria-label="Close pay-details import" onClick={close}>×</button></header><div className="form-body"><div className="tool-actions"><article><span>1 · Download template</span><b>Period-bound payroll lines</b><p>Use monthly salary, additional hours, earnings, deductions, salary sacrifice, Payroll Giving or legacy childcare vouchers.</p><button onClick={downloadTemplate}>Download pay-detail template</button></article><article><span>2 · Validate file</span><b>All rows or no rows</b><p>Only employees active in Period {period} may be included. The file cannot write to another period or a finalised payroll.</p><label className="primary file-action">Choose pay-detail CSV<input type="file" accept="text/csv,.csv" disabled={saving} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void loadFile(file);}}/></label></article></div>{filename&&<div className="portal-message"><b>{filename}</b><br/>{prepared.length} row{prepared.length===1?"":"s"} parsed · {new Set(prepared.map(row=>row.payrollId)).size} employee{new Set(prepared.map(row=>row.payrollId)).size===1?"":"s"} · {errors.length?`${errors.length} issue(s)`:"ready to save"}</div>}{errors.length>0&&<div className="validation-list">{errors.slice(0,50).map((error,index)=><div className="warning" key={`${index}-${error}`}><span>!</span><p><b>Import error</b><small>{error}</small></p></div>)}</div>}{!errors.length&&prepared.length>0&&<div className="report-table-scroll"><table><thead><tr><th>Row</th><th>Employee</th><th>Type</th><th>Description</th><th>Quantity × rate</th><th>Amount</th><th>PAYE / NIC / pension</th></tr></thead><tbody>{prepared.slice(0,50).map(row=><tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.payrollId}</td><td>{row.type.replaceAll("-"," ")}</td><td>{row.description}</td><td>{row.quantity} × {money(row.rate)}</td><td>{money(row.amount)}</td><td>{row.taxable?"Yes":"No"} / {row.nicable?"Yes":"No"} / {row.pensionable?"Yes":"No"}</td></tr>)}</tbody></table></div>}<div className="portal-message">For each employee present in the file, existing non-scheduled variable lines are replaced. Recurring schedules are preserved. Monthly salary and hours change only when their row types are included.</div></div><footer><button disabled={saving} onClick={close}>Cancel</button><button className="primary" disabled={saving||errors.length>0||!prepared.length} onClick={applyImport}>{saving?"Saving draft…":"Apply and save payroll draft"}</button></footer></div></div>;
}

function DataToolsWorkspace({toast}:{toast:(message:string)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [verification,setVerification]=useState<any>(null),[lastBackup,setLastBackup]=useState<any>(null),[busy,setBusy]=useState(false);
  const [restoreBackup,setRestoreBackup]=useState<any>(null),[restoreAnalysis,setRestoreAnalysis]=useState<any>(null),[restoreConfirmation,setRestoreConfirmation]=useState("");
  const [showBackupTools,setShowBackupTools]=useState(false),[importErrors,setImportErrors]=useState<string[]>([]),[benefitCopy,setBenefitCopy]=useState<any>(null);
  const [protectBackup,setProtectBackup]=useState(true),[backupPassword,setBackupPassword]=useState(""),[backupPasswordConfirmation,setBackupPasswordConfirmation]=useState(""),[importBackupPassword,setImportBackupPassword]=useState("");
  const [versions,setVersions]=useState<any[]>([]),[versionLabel,setVersionLabel]=useState("Manual recovery point"),[versionNotes,setVersionNotes]=useState(""),[versionAnalysis,setVersionAnalysis]=useState<any>(null),[versionConfirmation,setVersionConfirmation]=useState("");
  const sourceBenefitTaxYear=`${Number(taxYear.slice(0,4))-1}/${String(Number(taxYear.slice(0,4))%100).padStart(2,"0")}`;
  async function loadVersions(){
    const response=await fetch(`/api/payroll-versions?employerId=${employerId}`),body=await response.json();
    if(response.ok)setVersions(body);
  }
  useEffect(()=>{void loadVersions();},[employerId]);
  function downloadEmployeeTemplate(){
    const headers=["payrollId","firstName","lastName","email","dateOfBirth","startDate","starterEvidence","starterDeclaration","p45LeavingDate","p45PreviousPay","p45PreviousTax","p60TaxYear","p60ReferenceOnly","taxCode","week1Month1","niCategory","niNumber","studentLoanPlan","postgraduateLoan","payBasis","annualSalary","hourlyRate","dailyRate","contractedHours","workingDaysPerWeek","paymentMethod","bankName","accountName","sortCode","accountNumber"];
    const example=["PAY-001","Alex","Example","alex@example.co.uk","1990-01-15","2026-04-06","No P45 provided","Statement A","","0","0","","false","1257L","false","A","","","false","period","30000","0","0","37.5","5","credit-transfer","Example Bank","Alex Example","123456","12345678"];
    downloadClientBlob(new Blob(["\uFEFF",headers.join(","),"\r\n",example.map(value=>`"${value.replaceAll('"','""')}"`).join(",")],{type:"text/csv;charset=utf-8"}),"payflow-employee-import-template.csv");
  }
  function downloadEmployerTemplate(){
    const headers=["name","legalName","address","postcode","payeReference","accountsOfficeReference","companyNumber","taxYear","cisContractor","cisUtr","smallEmployersRelief","employmentAllowance","apprenticeshipLevy","typicalPayBasis","typicalAnnualLeaveDays","typicalWeeklyHours","minimumHourlyRate","autoWorksNumber","nextWorksNumber","clientStatus","managedBy","colourReference","primaryContactName","primaryContactEmail","primaryContactPhone","documentPasswordStrategy"];
    const example=["Example Trading Ltd","Example Trading Limited","1 High Street, London","SW1A 1AA","123/AB456","123PA12345678","12345678","2026/27","false","","false","true","false","period","28","37.5","12.71","true","1","onboarding","Payroll Team","#087b79","Alex Owner","alex@example.co.uk","020 7946 0000","employee-postcode"];
    downloadClientBlob(new Blob(["\uFEFF",headers.join(","),"\r\n",example.map(value=>`"${value.replaceAll('"','""')}"`).join(",")],{type:"text/csv;charset=utf-8"}),"payflow-employer-import-template.csv");
  }
  async function importEmployeeCsv(file?:File){
    if(!file)return;setBusy(true);setImportErrors([]);
    try{
      if(file.size>2_000_000)throw new Error("Employee CSV must be 2 MB or smaller.");
      const rows=parseCsvRecords(await file.text());
      const response=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"import-employees",employerId,rows})}),body=await response.json();
      if(!response.ok){setImportErrors(Array.isArray(body.errors)?body.errors:[body.error||"Employee import failed."]);throw new Error(body.error||"Employee import failed.");}
      toast(`${body.imported} employee${body.imported===1?"":"s"} imported after complete-file validation. Reloading payroll…`);window.location.reload();
    }catch(error){toast(error instanceof Error?error.message:"Employee CSV import failed.");}finally{setBusy(false);}
  }
  async function importEmployerCsv(file?:File){
    if(!file)return;setBusy(true);setImportErrors([]);
    try{
      if(file.size>2_000_000)throw new Error("Employer CSV must be 2 MB or smaller.");
      const rows=parseCsvRecords(await file.text(),["name"],"employer");
      const response=await fetch("/api/employer",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"import-employers",rows})}),body=await response.json();
      if(!response.ok){setImportErrors(Array.isArray(body.errors)?body.errors:[body.error||"Employer import failed."]);throw new Error(body.error||"Employer import failed.");}
      toast(`${body.imported} employer client${body.imported===1?"":"s"} imported with owner access. Reloading the client portfolio…`);window.location.reload();
    }catch(error){toast(error instanceof Error?error.message:"Employer CSV import failed.");}finally{setBusy(false);}
  }
  async function downloadBackup(){
    setBusy(true);
    try{
      if(protectBackup&&(backupPassword.length<12||backupPassword!==backupPasswordConfirmation))
        throw new Error(backupPassword.length<12?"Enter a backup password containing at least 12 characters.":"The backup passwords do not match.");
      const response=await fetch(`/api/data?employerId=${employerId}`);
      if(!response.ok){const body=await response.json();throw new Error(body.error);}
      const backup=await response.json();setLastBackup(backup);
      const analysisResponse=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"analyse-restore",employerId,backup})});
      if(analysisResponse.ok){setRestoreBackup(backup);setRestoreAnalysis(await analysisResponse.json());setRestoreConfirmation("");}
      const downloadPayload=protectBackup?await encryptPayrollBackup(backup,backupPassword):backup;
      const extension=protectBackup?"payflow":"json";
      downloadClientBlob(new Blob([JSON.stringify(downloadPayload,null,2)],{type:"application/json"}),`payflow-backup-${new Date().toISOString().slice(0,10)}.${extension}`);
      if(protectBackup){setBackupPassword("");setBackupPasswordConfirmation("");}
      toast(protectBackup?"Encrypted employer backup downloaded. Its AES-256-GCM password is not stored by PayFlow.":"Complete employer backup downloaded with a SHA-256 verification checksum.");
    }catch(error){toast(error instanceof Error?error.message:"Backup could not be generated.");}finally{setBusy(false);}
  }
  async function readBackupFile(file:File){
    if(file.size>25_000_000)throw new Error("Payroll backup files must be 25 MB or smaller.");
    const parsed=JSON.parse(await file.text());
    if(!isEncryptedPayrollBackup(parsed))return parsed;
    if(importBackupPassword.length<12)throw new Error("Enter the encrypted backup password before choosing the file.");
    return decryptPayrollBackup(parsed,importBackupPassword,employerId);
  }
  async function verifyBackup(file?:File){
    if(!file)return;
    setBusy(true);
    try{
      const backup=await readBackupFile(file);
      await verifyPayload(backup);
      setImportBackupPassword("");
    }catch(error){setVerification(null);toast(error instanceof Error?error.message:"Backup verification failed.");}finally{setBusy(false);}
  }
  async function verifyPayload(backup:any){
    const response=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"verify-backup",employerId,backup})}),body=await response.json();
    if(!response.ok)throw new Error(`${body.error}${body.table?` Affected dataset: ${body.table}.`:""}`);setVerification(body);toast("Backup checksum and table counts verified.");
  }
  async function verifyCreatedBackup(){if(!lastBackup)return;setBusy(true);try{await verifyPayload(lastBackup);}catch(error){setVerification(null);toast(error instanceof Error?error.message:"Backup verification failed.");}finally{setBusy(false);}}
  async function analyseRestore(file?:File){
    if(!file)return;setBusy(true);setRestoreAnalysis(null);setRestoreConfirmation("");
    try{
      const backup=await readBackupFile(file),response=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"analyse-restore",employerId,backup})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);setRestoreBackup(backup);setRestoreAnalysis(body);setImportBackupPassword("");toast("Recovery file verified. Review the replacement impact before restoring.");
    }catch(error){setRestoreBackup(null);toast(error instanceof Error?error.message:"Recovery analysis failed.");}finally{setBusy(false);}
  }
  async function restore(){
    if(!restoreBackup||!restoreAnalysis)return;setBusy(true);
    try{
      const response=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore-backup",employerId,backup:restoreBackup,confirmation:restoreConfirmation,currentFingerprint:restoreAnalysis.currentFingerprint})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);setRestoreBackup(null);setRestoreAnalysis(null);setRestoreConfirmation("");setVerification(null);setLastBackup(null);toast(`Backup restored: ${Object.values(body.counts||{}).reduce((sum:any,value:any)=>sum+Number(value),0)} records recovered. Reloading payroll…`);window.location.reload();
    }catch(error){toast(error instanceof Error?error.message:"Backup restore failed; existing data was left unchanged.");}finally{setBusy(false);}
  }
  async function saveVersion(){
    setBusy(true);
    try{
      const response=await fetch("/api/payroll-versions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save",employerId,label:versionLabel,notes:versionNotes})}),body=await response.json();
      if(!response.ok)throw new Error(body.error||"Payroll version could not be saved.");
      setVersionLabel("Manual recovery point");setVersionNotes("");await loadVersions();
      toast(`Payroll version “${body.label}” retained with ${body.recordCount} verified records.`);
    }catch(error){toast(error instanceof Error?error.message:"Payroll version could not be saved.");}finally{setBusy(false);}
  }
  async function analyseVersion(versionId:number){
    setBusy(true);setVersionAnalysis(null);setVersionConfirmation("");
    try{
      const response=await fetch("/api/payroll-versions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"analyse",employerId,versionId})}),body=await response.json();
      if(!response.ok)throw new Error(body.error||"Payroll version could not be analysed.");
      setVersionAnalysis(body);toast(`Version “${body.version.label}” verified. Review the replacement impact before reverting.`);
    }catch(error){toast(error instanceof Error?error.message:"Payroll version could not be analysed.");}finally{setBusy(false);}
  }
  async function restoreVersion(){
    if(!versionAnalysis?.version?.id)return;setBusy(true);
    try{
      const response=await fetch("/api/payroll-versions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore",employerId,versionId:versionAnalysis.version.id,confirmation:versionConfirmation,currentFingerprint:versionAnalysis.currentFingerprint})}),body=await response.json();
      if(!response.ok)throw new Error(body.error||"Payroll version could not be restored.");
      toast(`Payroll reverted to “${body.versionLabel}”. Employee portal sessions were revoked; reloading payroll…`);window.location.reload();
    }catch(error){toast(error instanceof Error?error.message:"Version restore failed; current payroll data was left unchanged.");}finally{setBusy(false);}
  }
  async function archiveVersion(version:any){
    if(!window.confirm(`Archive the recovery point “${version.label}”? It will remain retained and auditable.`))return;
    setBusy(true);
    try{
      const response=await fetch("/api/payroll-versions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"archive",employerId,versionId:version.id})}),body=await response.json();
      if(!response.ok)throw new Error(body.error||"Payroll version could not be archived.");
      if(versionAnalysis?.version?.id===version.id){setVersionAnalysis(null);setVersionConfirmation("");}
      await loadVersions();toast(`Payroll version “${version.label}” archived.`);
    }catch(error){toast(error instanceof Error?error.message:"Payroll version could not be archived.");}finally{setBusy(false);}
  }
  async function copyBenefits(){
    if(!window.confirm(`Copy reviewed ${sourceBenefitTaxYear} expenses and benefits into ${taxYear} as drafts? Copied values must be reviewed before they affect payroll or reporting.`))return;
    setBusy(true);setBenefitCopy(null);
    try{
      let copied=0,skipped:any[]=[],remaining=0,batches=0;
      do{
        const response=await fetch("/api/benefits",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"copy-tax-year",employerId,sourceTaxYear:sourceBenefitTaxYear,targetTaxYear:taxYear})}),body=await response.json();
        if(!response.ok)throw new Error(body.error||"Expenses and benefits could not be copied.");
        copied+=Number(body.copied||0);skipped=[...skipped,...(body.skipped||[])];remaining=Number(body.remaining||0);batches++;
      }while(remaining>0&&batches<20);
      setBenefitCopy({copied,skipped,remaining});
      toast(`${copied} benefit${copied===1?"":"s"} copied into ${taxYear} as draft${copied===1?"":"s"}. Review each record before marking it reviewed.`);
    }catch(error){toast(error instanceof Error?error.message:"Expenses and benefits could not be copied.");}finally{setBusy(false);}
  }
  if(!showBackupTools)return <section className="operation-card data-tools"><div className="card-head"><div><h2>Validated data transfer</h2><p>Bulk-create records or carry reviewed benefit details into the active tax year without accepting partial payroll inputs.</p></div><span className={`status ${importErrors.length?"amber":""}`}>{importErrors.length?"Needs correction":"Ready"}</span></div><div className="tool-actions"><article><span>Employer clients</span><b>Portfolio onboarding</b><p>Imports registration, CIS, relief, payroll-default, contact and tracking fields. Every imported client grants the current administrator owner access.</p><button disabled={busy} onClick={downloadEmployerTemplate}>Download employer template</button><label className="primary file-action">Choose employer CSV<input type="file" accept="text/csv,.csv" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void importEmployerCsv(file);}}/></label></article><article><span>Employees</span><b>Payroll-critical onboarding</b><p>Imports starter evidence, tax/NIC, pay basis, loans and bank details for the active employer. A file with any invalid row inserts no employees.</p><button disabled={busy} onClick={downloadEmployeeTemplate}>Download employee template</button><label className="primary file-action">Choose employee CSV<input type="file" accept="text/csv,.csv" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void importEmployeeCsv(file);}}/></label></article><article><span>Annual benefits</span><b>Copy {sourceBenefitTaxYear} into {taxYear}</b><p>Copies reviewed continuing benefits as drafts, carries loan balances, rolls Class 1 dates forward and recalculates supported statutory values.</p><button className="primary" disabled={busy} onClick={copyBenefits}>{busy?"Working…":"Copy reviewed benefits"}</button><small>Leavers and vehicles that ended before {taxYear} are skipped. Existing destination records block duplicates.</small></article><article><span>Payroll files and recovery</span><b>Open a verified PayFlow payroll</b><p>Open a tenant-bound .payflow or JSON payroll file, verify every checksum and relationship, then review its replacement impact before importing.</p><Field label="Encrypted file password (if used)" value={importBackupPassword} type="password" onChange={setImportBackupPassword}/><label className="primary file-action">Open payroll file<input type="file" accept="application/json,.json,.payflow" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";setShowBackupTools(true);void analyseRestore(file);}}/></label><button disabled={busy} onClick={()=>setShowBackupTools(true)}>Backup and version tools</button><small>Moneysoft or other proprietary files must first be exported through a supported conversion format; PayFlow never guesses at opaque statutory data.</small></article></div>{benefitCopy&&<div className="portal-message"><b>{benefitCopy.copied} draft benefit{benefitCopy.copied===1?"":"s"} created for review.</b><br/>{benefitCopy.skipped.length?`${benefitCopy.skipped.length} source record(s) were skipped because the employee or benefit did not continue into ${taxYear}.`:"Every eligible source record was copied."}{benefitCopy.remaining?` ${benefitCopy.remaining} eligible record(s) remain; run the copy again.`:""}</div>}{importErrors.length>0&&<div className="validation-list">{importErrors.slice(0,50).map((error,index)=><div className="warning" key={`${index}-${error}`}><span>!</span><p><b>Import error</b><small>{error}</small></p></div>)}{importErrors.length>50&&<small>Showing the first 50 of {importErrors.length} errors.</small>}</div>}</section>;
  const backupRecordCount=Object.values(lastBackup?.counts||{}).reduce((sum:any,value:any)=>sum+Number(value),0);
  return <section className="operation-card data-tools"><div className="card-head"><div><h2>Backup, verification and recovery</h2><p>Create a complete tenant-bound payroll backup, verify its integrity or restore an owner-approved recovery point.</p></div><span className={`status ${verification||lastBackup?"":"amber"}`}>{verification?"Verified":lastBackup?"Created":"Not verified"}</span></div><div className="backup-security-bar"><Field label="Password for encrypted files" value={importBackupPassword} type="password" onChange={setImportBackupPassword}/><small>Enter this only before verifying or analysing an encrypted .payflow file. The password stays in this browser and is never sent to the server.</small></div><div className="tool-actions"><article><span>Complete employer backup</span><b>Payroll, PAYE, RTI, CIS, pensions and audit history</b><p>Authentication secrets and active portal sessions are deliberately excluded.</p><Check text="Encrypt this download with a password" checked={protectBackup} onChange={setProtectBackup}/>{protectBackup&&<div className="backup-password-fields"><Field label="New backup password" value={backupPassword} type="password" onChange={setBackupPassword}/><Field label="Confirm password" value={backupPasswordConfirmation} type="password" onChange={setBackupPasswordConfirmation}/><small>Use 12–200 characters. Lost passwords cannot be recovered.</small></div>}<button className="primary" disabled={busy||protectBackup&&(backupPassword.length<12||backupPassword!==backupPasswordConfirmation)} onClick={downloadBackup}>{protectBackup?"Download encrypted backup":"Download verified backup"}</button>{lastBackup&&<><small>Schema {lastBackup.schemaVersion} · {Object.keys(lastBackup.counts||{}).length} datasets · {backupRecordCount} records · SHA-256 {String(lastBackup.checksum?.value||"").slice(0,12)}…</small><button disabled={busy} onClick={verifyCreatedBackup}>Verify created backup</button></>}</article><article><span>Verify backup file</span><b>SHA-256 checksum and relationship checks</b><p>Read-only verification checks tenant ownership, completeness and stored references.</p><label className="outline file-action">Choose backup to verify<input type="file" accept="application/json,.json,.payflow" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void verifyBackup(file);}}/></label></article><article className="restore-action"><span>Guarded recovery</span><b>Replace this employer from a verified backup</b><p>Owner-only. Administrator access is preserved; employee portal sessions are revoked.</p><label className="outline file-action">Analyse recovery file<input type="file" accept="application/json,.json,.payflow" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void analyseRestore(file);}}/></label></article></div><div className="version-history"><div className="card-head"><div><h3>Retained payroll versions</h3><p>Save a labelled recovery point inside this employer, then verify its impact before reverting.</p></div><span>{versions.filter(version=>version.status==="active").length} active</span></div><div className="version-create"><Field label="Version label" value={versionLabel} onChange={setVersionLabel}/><Field label="Notes" value={versionNotes} onChange={setVersionNotes}/><button className="primary" disabled={busy||versionLabel.trim().length<3||versionLabel.trim().length>80||versionNotes.length>500} onClick={saveVersion}>Save current version</button></div><div className="report-table-scroll"><table><thead><tr><th>Version</th><th>Evidence</th><th>Payroll state</th><th>Last restored</th><th>Actions</th></tr></thead><tbody>{versions.map(version=><tr key={version.id}><td><b>{version.label}</b><small>{formatTimestamp(version.createdAt)} · {version.createdBy}</small>{version.notes&&<small>{version.notes}</small>}</td><td>Schema {version.schemaVersion}<small>{version.recordCount} records · {String(version.backupChecksum).slice(0,12)}…</small></td><td>{version.employeeCount} employees<small>{version.finalisedPeriodCount}/{version.payPeriodCount} periods finalised</small></td><td>{version.restoredAt?<>{formatTimestamp(version.restoredAt)}<small>{version.restoredBy}</small></>:"Never"}</td><td><div className="inline-actions"><span className={`status ${version.status==="active"?"":"amber"}`}>{version.status}</span><button disabled={busy} onClick={()=>analyseVersion(version.id)}>Analyse revert</button>{version.status==="active"&&<button disabled={busy} onClick={()=>archiveVersion(version)}>Archive</button>}</div></td></tr>)}</tbody></table>{!versions.length&&<div className="empty-workflow"><p>No retained versions yet. Save a recovery point before a substantial payroll change.</p></div>}</div>{versionAnalysis&&<div className="restore-confirmation version-revert"><div className="portal-message"><b>Revert to “{versionAnalysis.version.label}”?</b><br/>Employees: {versionAnalysis.impact.current.employees} → {versionAnalysis.impact.backup.employees} · pay periods: {versionAnalysis.impact.current.payPeriods} → {versionAnalysis.impact.backup.payPeriods} · finalised periods: {versionAnalysis.impact.current.finalisedPeriods} → {versionAnalysis.impact.backup.finalisedPeriods}. Employee portal sessions will be revoked.</div><label className="field"><span>Type the exact confirmation phrase</span><input aria-label="Version revert confirmation" value={versionConfirmation} onChange={event=>setVersionConfirmation(event.target.value)} placeholder={versionAnalysis.confirmationPhrase}/><small>{versionAnalysis.confirmationPhrase}</small></label><button className="danger-button" disabled={busy||versionConfirmation!==versionAnalysis.confirmationPhrase} onClick={restoreVersion}>{busy?"Reverting…":"Revert to retained version"}</button><small>The same checksum, relationship and atomic-restore validation used for file recovery is applied again immediately before replacement.</small></div>}</div>{verification&&<div className="validation-list"><div><span>✓</span><p><b>Backup integrity confirmed</b><small>Schema {verification.schemaVersion} · Exported {formatUkDateTime(verification.exportedAt)} · {Object.values(verification.counts||{}).reduce((sum:any,value:any)=>sum+Number(value),0)} stored records</small></p></div></div>}{restoreAnalysis&&<div className="restore-confirmation"><div className="portal-message"><b>Recovery will replace this employer’s operational data.</b><br/>Employees: {restoreAnalysis.impact.current.employees} → {restoreAnalysis.impact.backup.employees} · Pay periods: {restoreAnalysis.impact.current.payPeriods} → {restoreAnalysis.impact.backup.payPeriods} · Finalised periods: {restoreAnalysis.impact.current.finalisedPeriods} → {restoreAnalysis.impact.backup.finalisedPeriods} · {restoreAnalysis.impact.backup.totalRecords} backup records.</div><label className="field"><span>Type the exact confirmation phrase</span><input aria-label="Restore confirmation" value={restoreConfirmation} onChange={event=>setRestoreConfirmation(event.target.value)} placeholder={restoreAnalysis.confirmationPhrase}/><small>{restoreAnalysis.confirmationPhrase}</small></label><button className="danger-button" disabled={busy||restoreConfirmation!==restoreAnalysis.confirmationPhrase} onClick={restore}>{busy?"Restoring…":"Restore verified backup"}</button><small>The restore is atomic. If any record fails, existing employer data remains unchanged.</small></div>}</section>;
}

function AgentWorkspace({toast}:{toast:(message:string,success?:boolean)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),taxYearStart=`${taxYear.slice(0,4)}-04-06`,taxYearEnd=`${Number(taxYear.slice(0,4))+1}-04-05`;
  const [view,setView]=useState("Profile"),[data,setData]=useState<any>(null),[busy,setBusy]=useState(false);
  const [profile,setProfile]=useState<any>({
    firmName:"",contactName:"",email:"",phone:"",address:"",postcode:"",agentReference:"",vatRegistrationNumber:"",
    defaultVatRate:20,paymentTermsDays:14,invoicePrefix:"PAY",nextInvoiceNumber:1,bankPaymentDetails:"",payslipFooter:"",
  });
  const [charge,setCharge]=useState<any>({chargeCode:"payslip",description:"Payslip processing",billingBasis:"per-payslip",unitRate:1.5,vatRate:20,effectiveFrom:taxYearStart,effectiveTo:""});
  const [periodStart,setPeriodStart]=useState(taxYearStart),[periodEnd,setPeriodEnd]=useState(taxYearEnd),[preview,setPreview]=useState<any>(null);
  async function load(){
    const response=await fetch(`/api/agent?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
    if(!response.ok){toast(body.error||"Agent administration could not be loaded.");return;}
    setData(body);if(body.profile)setProfile(body.profile);
  }
  useEffect(()=>{setPeriodStart(taxYearStart);setPeriodEnd(taxYearEnd);setPreview(null);void load();},[employerId,taxYear]);
  async function operation(json:any,success:string){
    setBusy(true);
    try{
      const response=await fetch("/api/agent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,...json})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();toast(success,true);return body;
    }catch(error){toast(error instanceof Error?error.message:"Agent operation failed.");return null;}finally{setBusy(false);}
  }
  async function saveProfile(){await operation({action:"save-profile",...profile},"Agent profile and invoice defaults saved.");}
  async function saveCharge(){
    const saved=await operation({action:"save-charge",...charge},"Agent charge schedule saved.");
    if(saved)setCharge({...charge,chargeCode:"",description:"",unitRate:0});
  }
  async function archiveCharge(id:number){if(!window.confirm("Archive this charge? Existing invoices retain their frozen line item."))return;await operation({action:"archive-charge",id},"Agent charge archived.");}
  async function previewInvoice(){
    const result=await operation({action:"preview-invoice",periodStart,periodEnd},"Payslip counts and invoice charges recalculated.");
    if(result)setPreview(result);
  }
  async function createInvoice(){
    const result=await operation({action:"create-invoice",periodStart,periodEnd,invoiceDate:new Date().toISOString().slice(0,10)},"Draft agent invoice created from frozen payroll evidence.");
    if(result){setPreview(null);setView("Invoices");}
  }
  async function invoiceAction(id:number,action:"issue"|"void"){
    const reason=action==="void"?window.prompt("Enter the reason for voiding this invoice:","Created in error"):"";
    if(action==="void"&&!reason)return;
    setBusy(true);
    try{
      const response=await fetch("/api/agent",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id,action,reason})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();toast(action==="issue"?"Invoice issued and locked.":"Invoice voided with an audit reason.",true);
    }catch(error){toast(error instanceof Error?error.message:"Invoice status could not be changed.");}finally{setBusy(false);}
  }
  const charges=data?.charges||[],invoices=data?.invoices||[];
  return <section className="operation-card agent-workspace"><div className="card-head"><div><h2>Agent administration and billing</h2><p>Agent contact details, client charge schedules, payslip counts and source-bound invoices for this employer.</p></div><span className={`status ${data?.profile?"":"amber"}`}>{data?.profile?"Configured":"Profile required"}</span></div>
    <div className="subnav agent-subnav">{["Profile","Charges","Billing","Invoices"].map(item=><button key={item} className={view===item?"active":""} onClick={()=>setView(item)}>{item}</button>)}</div>
    {view==="Profile"&&<div className="agent-panel"><div className="form-grid"><Field label="Agent firm name" value={profile.firmName||""} onChange={value=>setProfile({...profile,firmName:value})}/><Field label="Primary contact" value={profile.contactName||""} onChange={value=>setProfile({...profile,contactName:value})}/><Field label="Email" value={profile.email||""} type="email" onChange={value=>setProfile({...profile,email:value})}/><Field label="Telephone" value={profile.phone||""} onChange={value=>setProfile({...profile,phone:value})}/><Field label="Address" value={profile.address||""} onChange={value=>setProfile({...profile,address:value})}/><Field label="Postcode" value={profile.postcode||""} onChange={value=>setProfile({...profile,postcode:value.toUpperCase()})}/><Field label="HMRC agent reference" value={profile.agentReference||""} onChange={value=>setProfile({...profile,agentReference:value})}/><Field label="VAT registration number" value={profile.vatRegistrationNumber||""} onChange={value=>setProfile({...profile,vatRegistrationNumber:value})}/><Field label="Default VAT rate %" value={String(profile.defaultVatRate??20)} type="number" onChange={value=>setProfile({...profile,defaultVatRate:Number(value)})}/><Field label="Payment terms (days)" value={String(profile.paymentTermsDays??14)} type="number" onChange={value=>setProfile({...profile,paymentTermsDays:Number(value)})}/><Field label="Invoice prefix" value={profile.invoicePrefix||"PAY"} onChange={value=>setProfile({...profile,invoicePrefix:value.toUpperCase()})}/><Field label="Next invoice number" value={String(profile.nextInvoiceNumber??1)} type="number" onChange={value=>setProfile({...profile,nextInvoiceNumber:Number(value)})}/></div><label className="field full"><span>Bank payment details shown on invoices</span><textarea value={profile.bankPaymentDetails||""} onChange={event=>setProfile({...profile,bankPaymentDetails:event.target.value})}/></label><label className="field full"><span>Payslip footer / agent message</span><textarea value={profile.payslipFooter||""} onChange={event=>setProfile({...profile,payslipFooter:event.target.value})}/></label><div className="operation-footer inset-footer"><a className="outline" href="https://www.gov.uk/government/collections/tax-agents-and-advisors-authorisation-forms" target="_blank" rel="noreferrer">Open current HMRC agent authorisation</a><button className="primary" disabled={busy} onClick={saveProfile}>Save agent profile</button></div><div className="portal-message"><b>FBI2 is retired.</b><br/>HMRC removed the old FBI2 link; use the current online authorisation process or form 64-8. PayFlow does not store Government Gateway passwords in this profile.</div></div>}
    {view==="Charges"&&<div className="agent-panel"><div className="operation-grid"><section><div className="report-table-scroll"><table><thead><tr><th>Code</th><th>Description</th><th>Basis</th><th>Rate</th><th>VAT</th><th>Status</th><th/></tr></thead><tbody>{charges.map((item:any)=><tr key={item.id}><td>{item.chargeCode}</td><td><b>{item.description}</b><small>{item.effectiveFrom||"Immediately"}{item.effectiveTo?` to ${item.effectiveTo}`:""}</small></td><td>{String(item.billingBasis).replaceAll("-"," ")}</td><td>{money(item.unitRate)}</td><td>{item.vatRate}%</td><td><span className={`status ${item.status==="active"?"":"amber"}`}>{item.status}</span></td><td>{item.status==="active"&&<button disabled={busy} onClick={()=>archiveCharge(item.id)}>Archive</button>}</td></tr>)}</tbody></table></div>{!charges.length&&<div className="empty-workflow"><p>No agent charge schedule has been added.</p></div>}</section><aside className="calculation-panel"><span>Add or replace charge code</span><Field label="Charge code" value={charge.chargeCode} onChange={value=>setCharge({...charge,chargeCode:value.toLowerCase().replace(/\s+/g,"-")})}/><Field label="Invoice description" value={charge.description} onChange={value=>setCharge({...charge,description:value})}/><label className="field"><span>Billing basis</span><select value={charge.billingBasis} onChange={event=>setCharge({...charge,billingBasis:event.target.value})}><option value="fixed">Fixed per invoice</option><option value="per-payslip">Per finalised payslip</option><option value="per-period">Per finalised payroll period</option><option value="per-employee">Per distinct paid employee</option><option value="per-submission">Per prepared/issued submission</option></select></label><Field label="Unit rate" value={String(charge.unitRate)} type="number" onChange={value=>setCharge({...charge,unitRate:Number(value)})}/><Field label="VAT rate %" value={String(charge.vatRate)} type="number" onChange={value=>setCharge({...charge,vatRate:Number(value)})}/><Field label="Effective from" value={charge.effectiveFrom||""} type="date" onChange={value=>setCharge({...charge,effectiveFrom:value})}/><Field label="Effective to" value={charge.effectiveTo||""} type="date" onChange={value=>setCharge({...charge,effectiveTo:value})}/><button className="primary" disabled={busy||!charge.chargeCode||!charge.description} onClick={saveCharge}>Save charge</button><small>Use rti-submission, cis-return or pension-file with “per submission” to count only that service family.</small></aside></div></div>}
    {view==="Billing"&&<div className="agent-panel"><div className="report-controls"><Field label="Billing period start" value={periodStart} type="date" onChange={value=>{setPeriodStart(value);setPreview(null);}}/><Field label="Billing period end" value={periodEnd} type="date" onChange={value=>{setPeriodEnd(value);setPreview(null);}}/></div><div className="operation-footer"><button disabled={busy} onClick={previewInvoice}>Recalculate payslip count</button><button className="primary" disabled={busy||!data?.profile||!charges.some((item:any)=>item.status==="active")} onClick={createInvoice}>Create next draft invoice</button></div>{preview&&<><div className="metric-grid agent-metrics"><article><span>Finalised payslips</span><strong>{preview.payslipCount}</strong><small>Employee-period records</small></article><article><span>Payroll periods</span><strong>{preview.payrollPeriodCount}</strong><small>Finalised pay dates</small></article><article><span>Distinct employees</span><strong>{preview.employeeCount}</strong><small>In selected period</small></article><article><span>Invoice total</span><strong>{money(preview.grossAmount)}</strong><small>{money(preview.vatAmount)} VAT</small></article></div><div className="report-table-scroll"><table><thead><tr><th>Service</th><th>Basis</th><th>Units</th><th>Rate</th><th>Net</th><th>VAT</th><th>Total</th></tr></thead><tbody>{preview.lines.map((line:any)=><tr key={line.chargeId}><td><b>{line.description}</b><small>{line.chargeCode}</small></td><td>{line.billingBasis.replaceAll("-"," ")}</td><td>{line.units}</td><td>{money(line.unitRate)}</td><td>{money(line.netAmount)}</td><td>{money(line.vatAmount)}</td><td><b>{money(line.grossAmount)}</b></td></tr>)}</tbody></table></div></>}</div>}
    {view==="Invoices"&&<div className="agent-panel"><div className="report-table-scroll"><table><thead><tr><th>Invoice</th><th>Billing period</th><th>Evidence</th><th>Net</th><th>VAT</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>{invoices.map((invoice:any)=><tr key={invoice.id}><td><b>{invoice.invoiceNumber}</b><small>{formatUkDate(invoice.invoiceDate)} · due {formatUkDate(invoice.dueDate)}</small></td><td>{formatUkDate(invoice.periodStart)}<small>to {formatUkDate(invoice.periodEnd)}</small></td><td>{invoice.payslipCount} payslips<small>{invoice.payrollPeriodCount} periods · {invoice.employeeCount} employees</small></td><td>{money(invoice.netAmount)}</td><td>{money(invoice.vatAmount)}</td><td><b>{money(invoice.grossAmount)}</b></td><td><span className={`status ${invoice.status==="voided"?"amber":""}`}>{invoice.status}</span></td><td><div className="inline-actions"><button onClick={()=>window.open(`/api/agent?employerId=${employerId}&invoiceId=${invoice.id}&format=html`,"_blank","noopener,noreferrer")}>Open / print</button>{invoice.status==="draft"&&<button disabled={busy} onClick={()=>invoiceAction(invoice.id,"issue")}>Issue</button>}{invoice.status!=="voided"&&<button disabled={busy} onClick={()=>invoiceAction(invoice.id,"void")}>Void</button>}</div></td></tr>)}</tbody></table></div>{!invoices.length&&<div className="empty-workflow"><p>No agent invoices have been created for this employer.</p></div>}</div>}
  </section>;
}

function AccessWorkspace({toast,onSwitchEmployer}:{toast:(message:string)=>void;onSwitchEmployer:(id:number)=>void}) {
  const employerId=useEmployerId();
  const [users,setUsers]=useState<any[]>([]),[email,setEmail]=useState(""),[displayName,setDisplayName]=useState(""),[temporaryPassword,setTemporaryPassword]=useState(""),[role,setRole]=useState("viewer"),[canViewConfidential,setCanViewConfidential]=useState(false),[busy,setBusy]=useState(false);
  const [employeeRequests,setEmployeeRequests]=useState<any[]>([]),[reviewNotes,setReviewNotes]=useState<Record<number,string>>({});
  const [portfolios,setPortfolios]=useState<any[]>([]),[portfolioLoaded,setPortfolioLoaded]=useState(false),[clientSearch,setClientSearch]=useState(""),[clientName,setClientName]=useState(""),[clientLegalName,setClientLegalName]=useState(""),[clientTaxYear,setClientTaxYear]=useState("2026/27"),[clientFrequency,setClientFrequency]=useState<PayrollFrequency>("monthly"),[clientFirstPayDate,setClientFirstPayDate]=useState(""),[clientPaye,setClientPaye]=useState(""),[clientAccountsOffice,setClientAccountsOffice]=useState(""),[clientCis,setClientCis]=useState(false),[clientUtr,setClientUtr]=useState("");
  async function load(){
    const [response,requestsResponse,sessionResponse]=await Promise.all([fetch(`/api/admin/users?employerId=${employerId}`),fetch(`/api/employee-requests?employerId=${employerId}`),fetch(`/api/admin/session?employerId=${employerId}`)]);
    const body=await response.json(),requestBody=await requestsResponse.json(),sessionBody=await sessionResponse.json();
    if(response.ok)setUsers(body);else toast(body.error||"Employer users could not be loaded.");
    if(requestsResponse.ok)setEmployeeRequests(requestBody);
    if(sessionResponse.ok){
      const memberships=sessionBody.memberships||[];
      setPortfolios(memberships);
      setPortfolioLoaded(true);
      const enriched=await Promise.all(memberships.map(async(client:any)=>{
        try{
          const yearEndResponse=await fetch(`/api/year-end?employerId=${client.employerId}&taxYear=${encodeURIComponent(client.taxYear)}`);
          return {...client,yearEnd:yearEndResponse.ok?await yearEndResponse.json():null};
        }catch{return {...client,yearEnd:null};}
      }));
      setPortfolios(enriched);
    }else setPortfolioLoaded(true);
  }
  useEffect(()=>{load();},[]);
  async function add(){
    setBusy(true);
    try{const response=await fetch("/api/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,email,displayName,temporaryPassword,role,canViewConfidential})}),body=await response.json();if(!response.ok)throw new Error(body.error);setEmail("");setDisplayName("");setTemporaryPassword("");await load();toast("Employer user added with an audited role assignment.");}catch(error){toast(error instanceof Error?error.message:"Employer user could not be added.");}finally{setBusy(false);}
  }
  async function addClient(){
    setBusy(true);
    try{
      const response=await fetch("/api/employer",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        name:clientName,legalName:clientLegalName,taxYear:clientTaxYear,payFrequency:clientFrequency,payeReference:clientPaye,
        firstPayDate:clientFirstPayDate,accountsOfficeReference:clientAccountsOffice,cisContractor:clientCis,cisUtr:clientUtr,
      })}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      toast(`${body.employer.name} created as an isolated employer client. Reloading the portfolio…`);
      window.location.reload();
    }catch(error){toast(error instanceof Error?error.message:"Employer client could not be created.");}finally{setBusy(false);}
  }
  async function update(user:any,changes:Record<string,unknown>){
    const response=await fetch("/api/admin/users",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,membershipId:user.membershipId,role:user.role,status:user.status,canViewConfidential:user.canViewConfidential,...changes})}),body=await response.json();
    if(!response.ok)return toast(body.error||"Employer access could not be updated.");await load();toast(changes.status==="revoked"?"Employer access revoked.":"Employer access updated.");
  }
  async function review(request:any,decision:"approved"|"rejected"){setBusy(true);try{const response=await fetch("/api/employee-requests",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:request.id,decision,reviewNote:reviewNotes[request.id]||""})}),body=await response.json();if(!response.ok)throw new Error(body.error);await load();toast(decision==="approved"?"Employee change approved and applied.":"Employee change rejected; no employee data was changed.");}catch(error){toast(error instanceof Error?error.message:"Employee request could not be reviewed.");}finally{setBusy(false);}}
  const normalisedClientSearch=clientSearch.trim().toLowerCase(),filteredPortfolios=normalisedClientSearch?portfolios.filter(client=>
    [client.employerName,client.taxYear,client.managedBy,client.clientStatus,client.employerStatus,String(client.employerId),`Employer #${client.employerId}`].some(value=>String(value||"").toLowerCase().includes(normalisedClientSearch)),
  ):portfolios;
  return <div className="operational-workspace"><section className="operation-card portfolio-card"><div className="card-head"><div><h2>Client tracking and year end</h2><p>Portfolio status, ownership, compliance dates and completion checks from each isolated employer.</p></div><span>{portfolioLoaded?`${filteredPortfolios.length} of ${portfolios.length} tracked`:"Loading payrolls…"}</span></div><div className="portfolio-search"><span>⌕</span><input aria-label="Search payrolls" value={clientSearch} onChange={event=>setClientSearch(event.target.value)} placeholder="Search employer, tax year, manager, status or ID…"/>{clientSearch&&<button onClick={()=>setClientSearch("")}>Clear</button>}</div><div className="report-table-scroll"><table><thead><tr><th>Employer</th><th>Tracking</th><th>Compliance dates</th><th>Year end</th><th>Access</th><th>Workspace</th></tr></thead><tbody>{filteredPortfolios.map(client=>{const checks=client.yearEnd?.checks||[],passed=checks.filter((check:any)=>check.passed).length;return <tr key={client.employerId}><td><div className="portfolio-employer"><i style={{backgroundColor:client.colourReference||"#087b79"}}/><span><b>{client.employerName}</b><small>Employer #{client.employerId} · {client.taxYear}</small></span></div></td><td><span className={`status ${["inactive","archived"].includes(client.clientStatus)?"amber":""}`}>{client.clientStatus||client.employerStatus||"active"}</span><small>Managed by {client.managedBy||"unassigned"}</small></td><td><small>Final FPS {client.finalFpsDue||"—"}</small><small>EPS {client.epsDue||"—"} · P60 {client.p60Due||"—"}</small><small>P11D {client.p11dDue||"—"}</small></td><td><span className={`status ${client.yearEnd?.ready?"":"amber"}`}>{client.yearEnd?.ready?"Ready":checks.length?`${passed}/${checks.length} checks`:"Assessing…"}</span><small>{checks.find((check:any)=>!check.passed)?.name||(client.yearEnd?"All local checks passed":"Loading year-end checks")}</small></td><td>{client.role}<small>{client.canViewConfidential?"Confidential HR permitted":"Confidential HR restricted"}</small></td><td>{client.employerId===employerId?<span className="status">Current</span>:<button onClick={()=>onSwitchEmployer(client.employerId)}>Open employer</button>}</td></tr>})}</tbody></table>{portfolioLoaded&&!filteredPortfolios.length&&<div className="empty-workflow"><p>{clientSearch?`No payrolls match “${clientSearch}”.`:"No employer payrolls are available to this account."}</p></div>}</div></section><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>Employer portfolio access</h2><p>Every client has isolated payroll, CIS, pension, RTI and audit records.</p></div><span>{portfolioLoaded?`${filteredPortfolios.length} client${filteredPortfolios.length===1?"":"s"}`:"Loading…"}</span></div><table><thead><tr><th>Employer</th><th>Role</th><th>Confidential HR</th><th>Workspace</th></tr></thead><tbody>{filteredPortfolios.map(client=><tr key={client.employerId}><td><b>{client.employerName}</b><small>Employer #{client.employerId}</small></td><td>{client.role}</td><td>{client.canViewConfidential?"Permitted":"Restricted"}</td><td>{client.employerId===employerId?<span className="status">Current</span>:<button onClick={()=>onSwitchEmployer(client.employerId)}>Open employer</button>}</td></tr>)}</tbody></table></section><aside className="calculation-panel"><span>Add employer client</span><Field label="Trading name" value={clientName} onChange={setClientName}/><Field label="Legal name" value={clientLegalName} onChange={setClientLegalName}/><div className="form-grid"><Field label="Tax year" value={clientTaxYear} onChange={setClientTaxYear}/><label className="field"><span>Pay frequency</span><select value={clientFrequency} onChange={event=>setClientFrequency(event.target.value as PayrollFrequency)}><option value="monthly">Monthly · 12 PAYE periods</option><option value="weekly">Weekly · up to 53 periods</option><option value="fortnightly">Every 2 weeks · up to 27 periods</option><option value="four-weekly">Every 4 weeks · up to 14 periods</option></select><small>Non-monthly schedules use an anchored first payday and include any genuine extra payday in the tax year.</small></label>{clientFrequency!=="monthly"&&<Field label="First pay date in tax year" value={clientFirstPayDate} type="date" onChange={setClientFirstPayDate}/>}<Field label="PAYE reference" value={clientPaye} onChange={setClientPaye}/><Field label="Accounts Office reference" value={clientAccountsOffice} onChange={setClientAccountsOffice}/></div><Check text="Construction Industry Scheme contractor" checked={clientCis} onChange={value=>{setClientCis(value);if(!value)setClientUtr("");}}/>{clientCis&&<Field label="Contractor UTR" value={clientUtr} onChange={setClientUtr}/>}<button className="primary" disabled={busy||!clientName.trim()||(clientFrequency!=="monthly"&&!clientFirstPayDate)||(clientCis&&!/^\d{10}$/.test(clientUtr.replace(/\s/g,"")))} onClick={addClient}>Create isolated client</button><small>The signed-in administrator becomes the initial owner. PAYE and Accounts Office references may be completed during onboarding.</small></aside></div><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>Employer access</h2><p>Tenant-bound administrators, payroll staff, managers and read-only users.</p></div><span>{users.filter(user=>user.status==="active").length} active</span></div><table><thead><tr><th>User</th><th>Role</th><th>Confidential HR</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.membershipId}><td><b>{user.displayName}</b><small>{user.email}</small></td><td><select value={user.role} disabled={user.status!=="active"} onChange={event=>update(user,{role:event.target.value})}><option value="owner">Owner</option><option value="admin">Administrator</option><option value="payroll">Payroll</option><option value="manager">Manager</option><option value="viewer">Viewer</option></select></td><td><input aria-label={`Confidential access for ${user.displayName}`} type="checkbox" checked={Boolean(user.canViewConfidential)} disabled={user.status!=="active"} onChange={event=>update(user,{canViewConfidential:event.target.checked})}/></td><td><span className={`status ${user.status==="active"?"":"amber"}`}>{user.status}</span></td><td>{user.status==="active"?<button onClick={()=>update(user,{status:"revoked"})}>Revoke</button>:<button onClick={()=>update(user,{status:"active"})}>Restore</button>}</td></tr>)}</tbody></table></section><aside className="calculation-panel"><span>Add employer user</span><Field label="Display name" value={displayName} onChange={setDisplayName}/><Field label="Email" value={email} type="email" onChange={setEmail}/><Field label="Temporary password" value={temporaryPassword} type="password" onChange={setTemporaryPassword}/><label className="field"><span>Role</span><select value={role} onChange={event=>setRole(event.target.value)}><option value="admin">Administrator</option><option value="payroll">Payroll</option><option value="manager">Manager</option><option value="viewer">Viewer</option></select></label><Check text="Can view confidential HR information" checked={canViewConfidential} onChange={setCanViewConfidential}/><button className="primary" disabled={busy||!email||temporaryPassword.length<10} onClick={add}>Add user</button><small>The last active owner or administrator cannot be demoted or revoked. Every access change is retained in the employer audit history.</small></aside></div>
    <section className="operation-card request-review-card"><div className="card-head"><div><h2>Employee portal requests</h2><p>Review contact and bank changes before they alter payroll master data.</p></div><span>{employeeRequests.filter(item=>item.status==="pending").length} pending</span></div><table><thead><tr><th>Employee</th><th>Type</th><th>Requested changes</th><th>Employee note</th><th>Status</th><th>Review</th></tr></thead><tbody>{employeeRequests.map(request=><tr key={request.id}><td><b>{request.firstName} {request.lastName}</b><small>{request.payrollId}</small></td><td>{request.requestType}</td><td>{Object.entries(request.proposedChanges).map(([field,value])=><small key={field}><b>{field}</b>: {field==="accountNumber"?`••••${String(value||"").slice(-4)}`:String(value||"Blank")}</small>)}</td><td>{request.employeeNote||"—"}</td><td><span className={`status ${request.status==="pending"?"amber":""}`}>{request.status}</span></td><td>{request.status==="pending"?<><input aria-label={`Review note for ${request.id}`} placeholder="Optional review note" value={reviewNotes[request.id]||""} onChange={event=>setReviewNotes(current=>({...current,[request.id]:event.target.value}))}/><div className="inline-actions"><button disabled={busy} onClick={()=>review(request,"approved")}>Approve</button><button disabled={busy} onClick={()=>review(request,"rejected")}>Reject</button></div></>:request.reviewNote||"Reviewed"}</td></tr>)}</tbody></table>{!employeeRequests.length&&<div className="empty-workflow"><p>No employee portal changes have been requested.</p></div>}</section>
  </div>;
}

function ScenarioWorkspace({toast}:{toast:(message:string,success?:boolean)=>void}) {
  const [report, setReport] = useState<ScenarioReport | null>(null);
  const [error, setError] = useState(""),[creatingSample,setCreatingSample]=useState(false);
  useEffect(() => {
    fetch("/api/scenarios").then(r => {
      if (!r.ok) throw new Error("Scenario API unavailable");
      return r.json();
    }).then(setReport).catch(e => setError(e.message));
  }, []);
  async function createSample(){
    if(!window.confirm("Create a separate demonstration employer with 20 varied employees, a pension scheme and three CIS subcontractors? No current payroll data will be changed."))return;
    setCreatingSample(true);
    try{
      const response=await fetch("/api/scenarios",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create-isolated-sample",confirmation:"CREATE ISOLATED SAMPLE"})}),body=await readJsonResponse(response);
      if(!response.ok||!body)throw new Error(body?.error||"The sample payroll could not be created.");
      toast(`${body.employerName} created with ${body.employees} employees and ${body.subcontractors} CIS subcontractors. Opening the isolated payroll…`);
      window.location.assign(`/?employerId=${body.employerId}`);
    }catch(reason){toast(reason instanceof Error?reason.message:"The sample payroll could not be created.",false);setCreatingSample(false);}
  }
  if (error) return <section className="operation-card scenario-loading"><h2>Scenario suite could not run</h2><p>{error}</p></section>;
  if (!report) return <section className="operation-card scenario-loading"><h2>Running payroll acceptance suite…</h2><p>Checking two periods, starter variations, NIC categories, statutory pay and CIS.</p></section>;
  return <div className="scenario-workspace">
    <section className="operation-card sample-payroll-card"><div className="card-head"><div><h2>Isolated demonstration payroll</h2><p>Reinstate sample data without replacing or mixing it into the employer currently open.</p></div><span className="status">Owner-only</span></div><div className="sample-payroll-body"><div><b>20 employee variations · active pension scheme · 3 CIS deduction rates</b><p>The new employer uses conspicuous non-production identifiers, starts at Period 1 and is kept in its own tenant. You can run pay periods, test reports and remove its data later without touching a client payroll.</p></div><button className="primary" disabled={creatingSample} onClick={createSample}>{creatingSample?"Creating isolated payroll…":"Create fresh sample payroll"}</button></div><div className="portal-message">Demonstration data must never be submitted to HMRC, a pension provider, a bank or an email delivery service.</div></section>
    <div className="scenario-summary">
      <article><span>Employee profiles</span><strong>{report.summary.employees}</strong><small>Across {report.summary.periods} pay periods</small></article>
      <article><span>Profiles passed</span><strong>{report.summary.passed}</strong><small>{report.summary.failed ? `${report.summary.failed} need attention` : "All automated checks passed"}</small></article>
      <article><span>Payroll calculations</span><strong>{report.summary.payrollChecks}</strong><small>Month 1 and month 2</small></article>
      <article><span>CIS variations</span><strong>{report.summary.cisCases}</strong><small>0%, 20% and 30%</small></article>
    </div>
    <section className="data-card">
      <div className="card-head"><div><h2>Two-period employee simulation</h2><p>Starter evidence, tax basis, NIC categories, loans, statutory pay and deductions.</p></div><span className={`status ${report.summary.failed ? "amber" : ""}`}>{report.summary.failed ? "Review failures" : "All passed"}</span></div>
      <div className="scenario-table"><table><thead><tr><th>Profile</th><th>Variation</th><th>Month 1 net</th><th>Month 2 net</th><th>Status</th></tr></thead><tbody>{report.payroll.map(item=><tr key={item.id}><td><b>{item.employee}</b><small>{item.id}</small></td><td>{item.case}{item.failures.map(f=><small key={f} className="failure">{f}</small>)}</td><td>{money(item.months[0].netPay)}</td><td>{money(item.months[1].netPay)}</td><td><span className={`status ${item.status==="failed"?"amber":""}`}>{item.status}</span></td></tr>)}</tbody></table></div>
    </section>
    <div className="scenario-lower">
      <section className="data-card"><div className="card-head"><div><h2>Construction company CIS run</h2><p>Deduction excludes materials and VAT; retention is withheld from payment.</p></div></div><table><thead><tr><th>Subcontractor</th><th>Rate</th><th>Gross</th><th>Deduction</th><th>Net paid</th></tr></thead><tbody>{report.cis.map(item=><tr key={item.subcontractor}><td><b>{item.subcontractor}</b></td><td>{item.rate}%</td><td>{money(item.gross)}</td><td>{money(item.deduction)}</td><td>{money(item.netPayment)}</td></tr>)}</tbody></table></section>
      <aside className="operation-card implementation-gaps"><div className="card-head"><div><h2>External dependencies</h2><p>Required before production filing.</p></div></div><ul>{report.remainingImplementation.map(item=><li key={item}>{item}</li>)}</ul></aside>
    </div>
  </div>;
}

function AnalysisWorkspace({toast}:{toast:(message:string)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),[data,setData]=useState<any>(null),[view,setView]=useState("Periods");
  async function load(){
    const response=await fetch(`/api/analysis?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`,{cache:"no-store"}),body=await response.json();
    if(!response.ok)return toast(body.error||"Payroll analysis could not be loaded.");
    setData(body);
  }
  useEffect(()=>{load();},[]);
  if(!data)return <section className="operation-card scenario-loading"><h2>Loading reconciled payroll analysis…</h2><p>Reading finalised pay runs and employee master data.</p></section>;
  return <div className="operational-workspace">
    <div className="subnav">{["Periods","Departments","Employees","Pay elements","Compliance"].map(item=><button key={item} className={view===item?"active":""} onClick={()=>setView(item)}>{item}</button>)}</div>
    {view==="Periods"&&<section className="operation-card"><div className="card-head"><div><h2>Finalised period totals</h2><p>Payroll cost, pay count and deductions from stored results.</p></div></div><div className="report-table-scroll"><table><thead><tr><th>Period</th><th>Pay date</th><th>Pay count</th><th>Average gross</th><th>Gross</th><th>PAYE</th><th>Employee NIC</th><th>Employer NIC</th><th>Net</th><th>Employer cost</th></tr></thead><tbody>{data.periods.map((row:any)=><tr key={row.periodNumber}><td><b>Period {row.periodNumber}</b></td><td>{row.payDate||"—"}</td><td>{row.payCount}</td><td>{money(row.averagePay)}</td><td>{money(row.grossPay)}</td><td>{money(row.payeTax)}</td><td>{money(row.employeeNic)}</td><td>{money(row.employerNic)}</td><td>{money(row.netPay)}</td><td>{money(row.employerCost)}</td></tr>)}</tbody></table></div></section>}
    {view==="Departments"&&<section className="operation-card"><div className="card-head"><div><h2>Departmental analysis</h2><p>Finalised gross pay and employer cost by current department.</p></div></div><table><thead><tr><th>Department</th><th>Employees</th><th>Gross pay</th><th>Employer cost</th></tr></thead><tbody>{data.departments.map((row:any)=><tr key={row.department}><td><b>{row.department}</b></td><td>{row.employees}</td><td>{money(row.grossPay)}</td><td>{money(row.employerCost)}</td></tr>)}</tbody></table></section>}
    {view==="Employees"&&<section className="operation-card"><div className="card-head"><div><h2>Employee year-to-date totals</h2><p>PAYE, NIC, average gross and net pay across finalised periods.</p></div></div><div className="report-table-scroll"><table><thead><tr><th>Employee</th><th>Department</th><th>Periods</th><th>Gross</th><th>Average gross</th><th>Latest gross</th><th>PAYE</th><th>NIC</th><th>Pension</th><th>Net</th></tr></thead><tbody>{data.employees.map((row:any)=><tr key={row.employeeId}><td><b>{row.name}</b><small>{row.payrollId}</small></td><td>{row.department}</td><td>{row.periods}</td><td>{money(row.grossPay)}</td><td>{money(row.averagePay)}</td><td>{money(row.latestPay)}</td><td>{money(row.payeTax)}</td><td>{money(row.employeeNic)}</td><td>{money(row.employeePension)}</td><td>{money(row.netPay)}</td></tr>)}</tbody></table></div></section>}
    {view==="Pay elements"&&<section className="operation-card"><div className="card-head"><div><h2>Pay-element analysis</h2><p>Every finalised earning, benefit, sacrifice and deduction grouped by its frozen payroll classification.</p></div><span>{data.payElements.length} element{data.payElements.length===1?"":"s"}</span></div><div className="report-table-scroll"><table><thead><tr><th>Pay element</th><th>Type</th><th>Occurrences</th><th>Employees</th><th>Amount</th><th>PAYE</th><th>NIC</th><th>Pension</th></tr></thead><tbody>{data.payElements.map((row:any)=><tr key={`${row.type}-${row.name}-${row.taxable}-${row.nicable}-${row.pensionable}`}><td><b>{row.name}</b></td><td>{row.type.replaceAll("-"," ")}</td><td>{row.occurrences}</td><td>{row.employees}</td><td>{money(row.amount)}</td><td>{row.taxable?"Included":"Excluded"}</td><td>{row.nicable?"Included":"Excluded"}</td><td>{row.pensionable?"Included":"Excluded"}</td></tr>)}</tbody></table>{!data.payElements.length&&<div className="empty-workflow"><p>No finalised pay elements are available for this tax year.</p></div>}</div></section>}
    {view==="Compliance"&&<section className="operation-card"><div className="card-head"><div><h2>Compliance analysis</h2><p>Minimum wage and benefits checks requiring payroll review.</p></div><span className={`status ${data.minimumWageWarnings.length?"amber":""}`}>{data.minimumWageWarnings.length?`${data.minimumWageWarnings.length} warning(s)`:"No pay-rate warnings"}</span></div><div className="validation-list">{data.minimumWageWarnings.map((warning:any)=><div className="warning" key={warning.employeeId}><span>!</span><p><b>{warning.name} is below the {warning.minimumWageCategory} minimum</b><small>{money(warning.hourlyRate)} recorded · {money(warning.minimumRate)} minimum at {warning.referenceDate}</small></p></div>)}{!data.minimumWageWarnings.length&&<div><span>✓</span><p><b>Recorded hourly rates meet the configured minimum</b><small>Review salaried-worker effective rates separately where hours vary.</small></p></div>}</div><div className="metric-grid"><article><span>Benefits cash equivalent</span><strong>{money(data.totals.benefits)}</strong><small>Selected tax year</small></article><article><span>Class 1A NIC</span><strong>{money(data.totals.class1aNic)}</strong><small>Benefits liability</small></article></div></section>}
  </div>;
}

function ModuleContent({ active, toast }: { active: string; toast: (s: string) => void }) {
  const rows: Record<string, string[][]> = {
    Analysis: [["Apr","£20,814","£4,108","£2,714","£23,998"],["May","£21,142","£4,199","£2,755","£24,385"],["Jun","£21,336","£4,224","£2,781","£24,609"],["Jul","£21,341","£4,229","£2,784","£24,618"],["Aug","£21,937","£4,371","£2,893","£24,881"]],
    HMRC: [["PAYE income tax","£2,843.71","£13,482.92","Due"],["Employee NIC","£1,061.09","£5,122.18","Due"],["Employer NIC","£1,489.69","£7,241.41","Due"],["Employment Allowance","−£428.60","−£2,143.00","Applied"]],
    RTI: [["FPS – Period 4","31 Jul 2026 16:42","Accepted","IRmark 895721"],["EPS – Period 4","08 Aug 2026 09:14","Accepted","IRmark 895990"],["FPS – Period 5","Not submitted","Draft","Validate"],["NINO matching","Use FPS","HMRC service suspended","Review identity"]],
    CIS: [["Archway Joinery Ltd","20%","£8,440","£1,688"],["Brown & Sons Groundworks","20%","£12,800","£2,560"],["Northline Electrical","30%","£3,580","£1,074"],["Peak Roofing Ltd","20%","£9,000","£1,800"]],
    Pensions: [["NEST","7 active","£1,091.86","Ready"],["Postponed workers","1 employee","Ends 01 Sep","Review"],["Re-enrolment","01 Mar 2027","Not due","Scheduled"],["Declaration of compliance","Completed","05 Apr 2026","Filed"]],
    Reports: [["P11 deductions working sheet","Employee / period","Printable HTML, CSV","Generate"],["P45 / P60 employee forms","Employee","Printable HTML","Generate"],["P11D and PBIK","Employee / tax year","Printable HTML, CSV","Generate"],["Statutory pay schedule","Employee / leave","Printable HTML, CSV","Generate"],["Attachment order summary","All employees","Printable HTML, CSV","Generate"],["Annual leave entitlement","All employees","Printable HTML, CSV","Generate"]],
    Employer: [["Company details","Gotts Golf Club CIC","Complete","Edit"],["PAYE registration","123/AB456","Configured locally","Edit"],["Payroll defaults","Monthly · Period rate","Active","Edit"],["RTI credentials","Government Gateway","External integration required","Review dependency"],["Document security","Default password enabled","Active","Edit"]],
    Clients: [["Gotts Golf Club CIC","Monthly","RTI ready","Open"],["Airedale Events Ltd","Weekly","Payroll due","Open"],["Northline Services Ltd","Monthly","2 warnings","Open"],["Hillside Construction Ltd","Monthly + CIS","CIS300 due","Open"]],
    Tools: [["HMRC coding notices","4 notices","Downloaded today","Open"],["Employee CSV import","Template ready","Validated","Open"],["Payroll data export","All modules","CSV / JSON","Open"],["Backup verification","Last backup today","Verified","Open"]],
  };
  const headers = active === "Analysis" ? ["Period","Gross pay","PAYE","NIC","Employer cost"] : ["Item","Details","Position","Action"];
  const data = rows[active] || rows.Employer;
  return <div className="data-card"><div className="card-head"><h2>{active === "RTI" ? "Submission history" : active === "Reports" ? "Report library" : "Current period detail"}</h2><button onClick={() => toast(active === "RTI" ? "Submission validated. No blocking errors found." : "Export prepared.")}>{active === "RTI" ? "Validate draft" : "Export"}</button></div><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.map((r,i) => <tr key={i}>{r.map((v,j) => <td key={j}>{j === 0 ? <b>{v}</b> : v}{j === r.length-1 && (v === "Generate" || v === "Edit" || v === "Manage" || v === "Open" || v === "Validate") && <button onClick={() => toast(`${r[0]} opened.`)}>{v}</button>}</td>)}</tr>)}</tbody></table></div>;
}

function PayslipDesignEditor({form,update,toast}:{form:any;update:(key:string,value:unknown)=>void;toast:(message:string)=>void}){
  const design=normalisePayslipDesign(form.payslipDesign),change=(key:keyof PayslipDesign,value:unknown)=>update("payslipDesign",{...design,[key]:value});
  function uploadLogo(file?:File){
    if(!file)return;
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))return toast("Choose a PNG, JPEG or WebP logo.");
    if(file.size>500_000)return toast("The payslip logo must be no larger than 500 KB.");
    const reader=new FileReader();reader.onload=()=>update("logoUrl",String(reader.result||""));reader.onerror=()=>toast("The logo could not be read.");reader.readAsDataURL(file);
  }
  return <div className="payslip-designer full">
    <aside className="payslip-design-controls">
      <section><div className="form-title"><h3>Brand and layout</h3><p>Saved only for payslips. Other payroll and HMRC reports keep their own design.</p></div>
        <label className="field"><span>Payslip layout</span><select aria-label="Payslip layout" value={design.layout} onChange={event=>change("layout",event.target.value)}><option value="modern">Modern</option><option value="classic">Classic</option><option value="compact">Compact</option></select></label>
        <label className="field report-colour-field"><span>Accent colour</span><div><input aria-label="Payslip accent colour picker" type="color" value={design.accentColour} onChange={event=>change("accentColour",event.target.value)}/><input aria-label="Payslip accent hex value" value={design.accentColour} maxLength={7} onChange={event=>change("accentColour",event.target.value)}/></div></label>
        <label className="field"><span>Font</span><select aria-label="Payslip font" value={design.font} onChange={event=>change("font",event.target.value)}><option value="arial">Arial</option><option value="verdana">Verdana</option><option value="georgia">Georgia</option></select></label>
        <Field label="Document title" value={design.documentTitle} onChange={value=>change("documentTitle",value)}/>
        <label className="field"><span>Employer logo</span><input aria-label="Upload payslip logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{uploadLogo(event.target.files?.[0]);event.target.value="";}}/><small>PNG, JPEG or WebP, maximum 500 KB.</small></label>
        <label className="field"><span>Logo alignment</span><select value={design.logoAlignment} onChange={event=>change("logoAlignment",event.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label>
        {form.logoUrl&&<button type="button" onClick={()=>update("logoUrl","")}>Remove logo</button>}
      </section>
      <section><div className="form-title"><h3>Footer and support</h3><p>Shown on every employer and employee-portal payslip.</p></div>
        <label className="field"><span>Footer message</span><textarea maxLength={240} value={design.footerText} onChange={event=>change("footerText",event.target.value)}/><small>{design.footerText.length}/240</small></label>
        <label className="field"><span>Payroll contact message</span><textarea maxLength={160} value={design.contactText} onChange={event=>change("contactText",event.target.value)}/><small>{design.contactText.length}/160</small></label>
      </section>
      <section><div className="form-title"><h3>Payslip content</h3><p>Core payments, deductions, period, pay date and net pay always remain visible.</p></div>
        <div className="payslip-content-switches">
          <Check text="Employer address" checked={design.showEmployerAddress} onChange={value=>change("showEmployerAddress",value)}/><Check text="Employee address" checked={design.showEmployeeAddress} onChange={value=>change("showEmployeeAddress",value)}/>
          <Check text="Department" checked={design.showDepartment} onChange={value=>change("showDepartment",value)}/><Check text="National Insurance number" checked={design.showNiNumber} onChange={value=>change("showNiNumber",value)}/>
          <Check text="Tax code" checked={design.showTaxCode} onChange={value=>change("showTaxCode",value)}/><Check text="Payment method" checked={design.showPayMethod} onChange={value=>change("showPayMethod",value)}/>
          <Check text="Hours and rates" checked={design.showHoursAndRates} onChange={value=>change("showHoursAndRates",value)}/><Check text="Year-to-date totals" checked={design.showYearToDate} onChange={value=>change("showYearToDate",value)}/>
          <Check text="Employer NIC and pension" checked={design.showEmployerContributions} onChange={value=>change("showEmployerContributions",value)}/>
        </div>
      </section>
    </aside>
    <section className="payslip-preview-panel"><div className="card-head"><div><span className="eyebrow">LIVE SAMPLE</span><h3>Employee payslip preview</h3></div><span className="status">{design.layout}</span></div>
      <div className={`payslip-editor-preview ${design.layout} font-${design.font}`} style={{"--payslip-accent":design.accentColour} as CSSProperties}>
        <header className={design.logoAlignment==="right"?"logo-right":""}>{form.logoUrl&&<img src={form.logoUrl} alt="Employer logo preview"/>}<div><strong>{form.name||"Employer name"}</strong>{design.showEmployerAddress&&<small>{[form.address,form.postcode].filter(Boolean).join(", ")||"Employer address"}</small>}</div><aside><b>{design.documentTitle}</b><small>Period 4 · 31/07/2026</small></aside></header>
        <div className="preview-identity"><div><span>Employee</span><b>Alex Morgan</b>{design.showEmployeeAddress&&<small>24 Market Street, Leeds, LS1 2AB</small>}<small>{[design.showNiNumber?"NI QQ 12 34 56 C":"",design.showTaxCode?"Tax code 1257L":"","NI category A"].filter(Boolean).join(" · ")}</small></div><div><span>Payroll details</span><b>Payroll ID PAY-0042</b>{design.showDepartment&&<small>Operations</small>}<small>Tax year 2026/27</small></div><div><span>Payment</span><b>31/07/2026</b>{design.showPayMethod&&<small>Credit transfer</small>}</div></div>
        <div className="preview-pay-columns"><section><h4>Payments</h4><p><span>Basic salary{design.showHoursAndRates&&<small>160 × £18.75</small>}</span><b>£3,000.00</b></p><p><span>Overtime{design.showHoursAndRates&&<small>8 × £28.13</small>}</span><b>£225.04</b></p><p><span>Statutory pay</span><b>£194.32</b></p><strong><span>Gross pay</span><b>£3,419.36</b></strong></section><section><h4>Deductions</h4><p><span>PAYE tax</span><b>£430.20</b></p><p><span>Employee NIC</span><b>£188.54</b></p><p><span>Employee pension</span><b>£120.00</b></p><strong><span>Total deductions</span><b>£738.74</b></strong></section></div>
        <div className="preview-net"><span>Net pay</span><b>£2,680.62</b><small>Taxable pay £3,419.36</small></div>
        {design.showYearToDate&&<div className="preview-ytd"><b>Year to date</b><span>Gross <strong>£13,677.44</strong></span><span>PAYE <strong>£1,720.80</strong></span><span>NIC <strong>£754.16</strong></span><span>Pension <strong>£480.00</strong></span></div>}
        {design.showEmployerContributions&&<div className="preview-employer-cost"><span>Employer contributions (not deducted)</span><b>NIC £465.03 · Pension £102.58</b></div>}
        <footer><p>{design.footerText}</p><small>{design.contactText}</small></footer>
      </div>
      <div className="portal-message"><b>Required content is protected.</b><br/>Employee identity, period, pay date, payment lines, deductions, gross pay and net pay cannot be hidden. The generated document uses immutable finalised payroll values.</div>
    </section>
  </div>;
}

function EmployerWorkspace({toast}:{toast:(message:string)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),activeFrequency=usePayFrequency(),activeFirstPayDate=useFirstPayDate();
  const defaults:any={employerId,name:"Employer",legalName:"",address:"",postcode:"",payeReference:"",accountsOfficeReference:"",companyNumber:"",cisUtr:"",payFrequency:"monthly",firstPayDate:"",taxYear,smallEmployersRelief:false,employmentAllowance:false,apprenticeshipLevy:false,apprenticeshipLevyAllowance:15000,cisContractor:false,typicalPayBasis:"period",typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,minimumHourlyRate:12.71,autoWorksNumber:true,nextWorksNumber:1,withholdTaxRefundZeroPay:false,noSspAlternateScheme:false,optOutCreditChecks:false,preferredCredentialLabel:"",primaryContactName:"",primaryContactEmail:"",primaryContactPhone:"",alternateContactName:"",alternateContactEmail:"",bankName:"",bankAccountName:"",bankSortCode:"",bankAccountNumber:"",employerNotes:"",managedBy:"",clientStatus:"active",colourReference:"#087b79",finalFpsDue:"",epsDue:"",p60Due:"",p11dDue:"",documentPasswordStrategy:"employee-postcode",reportAccentColour:"#087b79",reportHeaderText:"",reportFooterText:"",reportStationeryMode:"standard",logoUrl:"",payslipDesign:defaultPayslipDesign,accountingDefaultWagesCode:"WAGES",accountingControlCode:"CTRL",accountingPayeCode:"TAX",accountingNicCode:"NIC",accountingPensionCode:"PENS",accountingOtherDeductionsCode:"OTHER",accountingEmployerNicExpenseCode:"ERNIC",accountingEmployerPensionExpenseCode:"ERPENS"};
  const [section,setSection]=useState("Business"),[form,setForm]=useState<any>(defaults),[warnings,setWarnings]=useState<string[]>([]),[saving,setSaving]=useState(false);
  const [frequencyPlan,setFrequencyPlan]=useState<any>(null),[frequencyConfirmation,setFrequencyConfirmation]=useState(""),[changingFrequency,setChangingFrequency]=useState(false);
  const [departments,setDepartments]=useState<any[]>([]),[newDepartment,setNewDepartment]=useState({name:"",nominalCode:"",costCentre:""});
  const [editingDepartmentId,setEditingDepartmentId]=useState(0),[departmentDraft,setDepartmentDraft]=useState({name:"",nominalCode:"",costCentre:""});
  useEffect(()=>{fetch(`/api/employer?employerId=${employerId}`).then(r=>r.json()).then(body=>{if(body.employer)setForm({...defaults,...body.employer,payslipDesign:normalisePayslipDesign(body.employer.payslipDesign)});setWarnings(body.warnings||[]);}).catch(()=>toast("Employer settings could not be loaded."));},[]);
  async function loadDepartments(){const response=await fetch(`/api/departments?employerId=${employerId}`),body=await response.json();if(response.ok)setDepartments(body.departments||[]);}
  useEffect(()=>{loadDepartments().catch(()=>toast("Departments could not be loaded."));},[]);
  const targetFirstPayDate=form.payFrequency==="monthly"?"":String(form.firstPayDate||""),frequencyEdited=form.payFrequency!==activeFrequency||targetFirstPayDate!==activeFirstPayDate;
  const update=(key:string,value:unknown)=>{if(key==="payFrequency"||key==="firstPayDate"){setFrequencyPlan(null);setFrequencyConfirmation("");}setForm((current:any)=>({...current,[key]:value}));};
  async function save(){if(frequencyEdited)return toast("Preview and apply the pay-frequency change first. This protects existing payroll evidence.");setSaving(true);try{const response=await fetch("/api/employer",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const body=await response.json();if(!response.ok)throw new Error(body.error);setForm({...form,...body.employer});setWarnings(body.warnings||[]);const superseded=(body.supersededRtiPackages||0)+(body.supersededCisArtifacts||0);toast(superseded?`Employer settings saved. ${superseded} prepared RTI/CIS package${superseded===1?" was":"s were"} superseded; regenerate before filing.`:"Employer settings saved and added to the audit history.");}catch(error){toast(error instanceof Error?error.message:"Employer settings could not be saved.");}finally{setSaving(false);}}
  async function previewFrequencyChange(){setChangingFrequency(true);try{const response=await fetch("/api/pay-frequency",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"preview",employerId,targetFrequency:form.payFrequency,firstPayDate:targetFirstPayDate})}),body=await response.json();if(!response.ok)throw new Error(body.error);setFrequencyPlan(body);setFrequencyConfirmation("");toast(body.allowed?"Frequency-change preview is ready. Review the discarded drafts and confirmation phrase.":"The preview found payroll evidence that must be resolved before changing frequency.");}catch(error){setFrequencyPlan(null);toast(error instanceof Error?error.message:"Pay-frequency change could not be previewed.");}finally{setChangingFrequency(false);}}
  async function applyFrequencyChange(){if(!frequencyPlan)return;setChangingFrequency(true);try{const response=await fetch("/api/pay-frequency",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"apply",employerId,targetFrequency:form.payFrequency,firstPayDate:targetFirstPayDate,fingerprint:frequencyPlan.fingerprint,confirmation:frequencyConfirmation})}),body=await response.json();if(!response.ok)throw new Error(body.error);toast("Pay frequency changed with an audited schedule reset. Reloading the new payroll periods…");setTimeout(()=>window.location.reload(),500);}catch(error){toast(error instanceof Error?error.message:"Pay-frequency change could not be applied.");}finally{setChangingFrequency(false);}}
  async function addDepartment(){const response=await fetch("/api/departments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...newDepartment,employerId})}),body=await response.json();if(!response.ok)return toast(body.error);setNewDepartment({name:"",nominalCode:"",costCentre:""});await loadDepartments();toast("Department created and audited.");}
  function editDepartment(row:any){setEditingDepartmentId(row.id);setDepartmentDraft({name:row.name||"",nominalCode:row.nominalCode||"",costCentre:row.costCentre||""});}
  async function saveDepartment(){const response=await fetch("/api/departments",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({...departmentDraft,employerId,id:editingDepartmentId})}),body=await response.json();if(!response.ok)return toast(body.error);setEditingDepartmentId(0);await loadDepartments();toast("Department details updated and audited.");}
  async function removeDepartment(id:number){const response=await fetch("/api/departments",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id})}),body=await response.json();if(!response.ok)return toast(body.error);await loadDepartments();toast("Unused department deleted.");}
  const sectionStatus=section==="Email templates"?"Template library":section==="Payslip editor"?"Live preview":section==="Departments"?"Department register":warnings.length?`${warnings.length} warning${warnings.length===1?"":"s"}`:"Validated";
  return <div className="operational-workspace"><div className="subnav">{["Business","Payroll defaults","Reports and printing","Payslip editor","Email templates","Accounting","Contacts","Bank and notes","Compliance dates","Departments"].map(item=><button key={item} className={section===item?"active":""} onClick={()=>setSection(item)}>{item}</button>)}</div><section className="operation-card"><div className="card-head"><div><h2>{section}</h2><p>Persistent employer configuration used by payroll, documents and compliance workflows.</p></div><span className={`status ${warnings.length&&!["Email templates","Departments"].includes(section)?"amber":""}`}>{sectionStatus}</span></div><div className="form-grid form-pad">
    {section==="Business"&&<><Field label="Trading name" value={form.name||""} onChange={v=>update("name",v)}/><Field label="Legal name" value={form.legalName||""} onChange={v=>update("legalName",v)}/><Field label="Address" value={form.address||""} onChange={v=>update("address",v)}/><Field label="Postcode" value={form.postcode||""} onChange={v=>update("postcode",v)}/><Field label="Company number" value={form.companyNumber||""} onChange={v=>update("companyNumber",v)}/><Field label="PAYE reference" value={form.payeReference||""} onChange={v=>update("payeReference",v)}/><Field label="Accounts Office reference" value={form.accountsOfficeReference||""} onChange={v=>update("accountsOfficeReference",v)}/><Field label="Tax year" value={form.taxYear||taxYear} onChange={v=>update("taxYear",v)}/><label className="field"><span>Pay frequency</span><select value={form.payFrequency||"monthly"} onChange={event=>update("payFrequency",event.target.value)}><option value="monthly">Monthly · 12 PAYE periods</option><option value="weekly">Weekly · up to 53 periods</option><option value="fortnightly">Every 2 weeks · up to 27 periods</option><option value="four-weekly">Every 4 weeks · up to 14 periods</option></select><small>Changes are previewed and blocked once finalised, migrated or opening-balance evidence exists.</small></label>{form.payFrequency!=="monthly"&&<Field label="First pay date in tax year" value={form.firstPayDate||""} type="date" onChange={v=>update("firstPayDate",v)}/>}<Check text="Employer qualifies for Small Employers’ Relief" checked={Boolean(form.smallEmployersRelief)} onChange={v=>update("smallEmployersRelief",v)}/><Check text="Claim Employment Allowance" checked={Boolean(form.employmentAllowance)} onChange={v=>update("employmentAllowance",v)}/><Check text="Employer is liable for Apprenticeship Levy" checked={Boolean(form.apprenticeshipLevy)} onChange={v=>update("apprenticeshipLevy",v)}/>{form.apprenticeshipLevy&&<Field label="Annual levy allowance allocated to this PAYE scheme" value={String(form.apprenticeshipLevyAllowance??15000)} type="number" onChange={v=>update("apprenticeshipLevyAllowance",+v)}/>}<Check text="Employer operates as a CIS contractor" checked={Boolean(form.cisContractor)} onChange={v=>update("cisContractor",v)}/>{form.cisContractor&&<Field label="CIS contractor UTR" value={form.cisUtr||""} onChange={v=>update("cisUtr",v)}/>}</>}
    {section==="Payroll defaults"&&<><label className="field"><span>Typical pay basis</span><select value={form.typicalPayBasis||"period"} onChange={event=>update("typicalPayBasis",event.target.value)}><option value="period">Period salary</option><option value="hourly">Hourly rate</option><option value="daily">Daily rate</option></select></label><Field label="Typical annual leave days" value={String(form.typicalAnnualLeaveDays??28)} type="number" onChange={v=>update("typicalAnnualLeaveDays",+v)}/><Field label="Typical weekly hours" value={String(form.typicalWeeklyHours??37.5)} type="number" onChange={v=>update("typicalWeeklyHours",+v)}/><Field label="Default minimum hourly rate" value={String(form.minimumHourlyRate??12.71)} type="number" onChange={v=>update("minimumHourlyRate",+v)}/><Field label="Next works number" value={String(form.nextWorksNumber??1)} type="number" onChange={v=>update("nextWorksNumber",+v)}/><label className="field"><span>Document password strategy</span><select value={form.documentPasswordStrategy||"employee-postcode"} onChange={event=>update("documentPasswordStrategy",event.target.value)}><option value="employee-postcode">Employee postcode</option><option value="employee-ni-last4">Last four NI characters</option><option value="manual-per-document">Set per document</option></select></label><Check text="Automatically generate works numbers" checked={Boolean(form.autoWorksNumber)} onChange={v=>update("autoWorksNumber",v)}/><Check text="Withhold tax refunds where pay is zero" checked={Boolean(form.withholdTaxRefundZeroPay)} onChange={v=>update("withholdTaxRefundZeroPay",v)}/><Check text="Do not pay SSP when using an alternate scheme" checked={Boolean(form.noSspAlternateScheme)} onChange={v=>update("noSspAlternateScheme",v)}/><Check text="Opt out of reporting payment information to credit-check providers" checked={Boolean(form.optOutCreditChecks)} onChange={v=>update("optOutCreditChecks",v)}/></>}
    {section==="Reports and printing"&&<><label className="field report-colour-field"><span>Report accent colour</span><div><input aria-label="Report accent colour picker" type="color" value={form.reportAccentColour||"#087b79"} onChange={event=>update("reportAccentColour",event.target.value)}/><input aria-label="Report accent hex value" value={form.reportAccentColour||"#087b79"} maxLength={7} onChange={event=>update("reportAccentColour",event.target.value)}/></div></label><label className="field"><span>Stationery layout</span><select value={form.reportStationeryMode||"standard"} onChange={event=>update("reportStationeryMode",event.target.value)}><option value="standard">PayFlow headed document</option><option value="preprinted">Reserve space for pre-printed letterhead</option><option value="plain">Plain document</option></select><small>Pre-printed mode leaves a 42 mm clear header area on every printed page.</small></label><Field label="Report header text" value={form.reportHeaderText||""} onChange={v=>update("reportHeaderText",v)}/><label className="field"><span>Report footer text</span><textarea maxLength={240} value={form.reportFooterText||""} onChange={event=>update("reportFooterText",event.target.value)} placeholder="Accountant contact, document instructions or confidentiality notice…"/></label><div className="report-style-preview full" style={{"--report-accent":form.reportAccentColour||"#087b79"} as CSSProperties}><span>{form.reportStationeryMode==="preprinted"?"PRE-PRINTED LETTERHEAD SPACE":form.reportHeaderText||form.name||"PayFlow report"}</span><h3>Payroll report preview</h3><p>{form.reportFooterText||"Generated from reconciled payroll records."}</p></div></>}
    {section==="Payslip editor"&&<PayslipDesignEditor form={form} update={update} toast={toast}/>}
    {section==="Email templates"&&<EmailTemplateSettings toast={toast}/>}
    {section==="Accounting"&&<><Field label="Default wages nominal code" value={form.accountingDefaultWagesCode||"WAGES"} onChange={v=>update("accountingDefaultWagesCode",v.toUpperCase())}/><Field label="Net wages control code" value={form.accountingControlCode||"CTRL"} onChange={v=>update("accountingControlCode",v.toUpperCase())}/><Field label="PAYE liability code" value={form.accountingPayeCode||"TAX"} onChange={v=>update("accountingPayeCode",v.toUpperCase())}/><Field label="NIC liability code" value={form.accountingNicCode||"NIC"} onChange={v=>update("accountingNicCode",v.toUpperCase())}/><Field label="Pension liability code" value={form.accountingPensionCode||"PENS"} onChange={v=>update("accountingPensionCode",v.toUpperCase())}/><Field label="Other deductions code" value={form.accountingOtherDeductionsCode||"OTHER"} onChange={v=>update("accountingOtherDeductionsCode",v.toUpperCase())}/><Field label="Employer NIC expense code" value={form.accountingEmployerNicExpenseCode||"ERNIC"} onChange={v=>update("accountingEmployerNicExpenseCode",v.toUpperCase())}/><Field label="Employer pension expense code" value={form.accountingEmployerPensionExpenseCode||"ERPENS"} onChange={v=>update("accountingEmployerPensionExpenseCode",v.toUpperCase())}/><div className="portal-message full"><b>Department allocation</b><br/>Set each department’s cost centre and wages nominal code under Departments. Finalised payroll freezes that allocation so later department changes cannot rewrite an exported accounting period.</div></>}
    {section==="Contacts"&&<><Field label="Primary contact name" value={form.primaryContactName||""} onChange={v=>update("primaryContactName",v)}/><Field label="Primary contact email" value={form.primaryContactEmail||""} onChange={v=>update("primaryContactEmail",v)}/><Field label="Primary contact phone" value={form.primaryContactPhone||""} onChange={v=>update("primaryContactPhone",v)}/><Field label="Alternative contact name" value={form.alternateContactName||""} onChange={v=>update("alternateContactName",v)}/><Field label="Alternative contact email" value={form.alternateContactEmail||""} onChange={v=>update("alternateContactEmail",v)}/><Field label="Managed by" value={form.managedBy||""} onChange={v=>update("managedBy",v)}/><label className="field"><span>Client status</span><select value={form.clientStatus||"active"} onChange={event=>update("clientStatus",event.target.value)}><option value="active">Active</option><option value="onboarding">Onboarding</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label><Field label="Tracking colour" value={form.colourReference||"#087b79"} onChange={v=>update("colourReference",v)}/><Field label="Preferred credential label" value={form.preferredCredentialLabel||""} onChange={v=>update("preferredCredentialLabel",v)}/></>}
    {section==="Bank and notes"&&<><Field label="Bank name" value={form.bankName||""} onChange={v=>update("bankName",v)}/><Field label="Account name" value={form.bankAccountName||""} onChange={v=>update("bankAccountName",v)}/><Field label="Sort code" value={form.bankSortCode||""} onChange={v=>update("bankSortCode",v)}/><Field label="Account number" value={form.bankAccountNumber||""} onChange={v=>update("bankAccountNumber",v)}/><label className="field full"><span>Employer notes</span><textarea maxLength={4000} value={form.employerNotes||""} onChange={event=>update("employerNotes",event.target.value)} placeholder="Internal employer notes, payroll instructions or references…"/></label><div className="portal-message full">Bank details are stored against this employer only. Account evidence must include an account name, six-digit sort code and eight-digit account number.</div></>}
    {section==="Compliance dates"&&<><Field label="Final FPS due" value={form.finalFpsDue||""} type="date" onChange={v=>update("finalFpsDue",v)}/><Field label="EPS due" value={form.epsDue||""} type="date" onChange={v=>update("epsDue",v)}/><Field label="P60s due" value={form.p60Due||""} type="date" onChange={v=>update("p60Due",v)}/><Field label="P11Ds due" value={form.p11dDue||""} type="date" onChange={v=>update("p11dDue",v)}/></>}
    {section==="Departments"&&<><Field label="Department name" value={newDepartment.name} onChange={name=>setNewDepartment({...newDepartment,name})}/><Field label="Nominal code" value={newDepartment.nominalCode} onChange={nominalCode=>setNewDepartment({...newDepartment,nominalCode})}/><Field label="Cost centre" value={newDepartment.costCentre} onChange={costCentre=>setNewDepartment({...newDepartment,costCentre})}/></>}
  </div>{section==="Business"&&frequencyEdited&&<div className="frequency-change-panel"><div><span className="eyebrow">CONTROLLED SCHEDULE CHANGE</span><h3>Preview {payrollFrequencyRule(form.payFrequency||"monthly").label.toLowerCase()} payroll</h3><p>Draft periods can be discarded only after a source-bound preview. Finalised payroll, migrated history, opening balances and period-based recurring schedules are never rewritten.</p></div><button className="outline" disabled={changingFrequency||form.payFrequency!=="monthly"&&!targetFirstPayDate} onClick={previewFrequencyChange}>{changingFrequency?"Checking…":"Preview schedule change"}</button>{frequencyPlan&&<><div className="frequency-change-summary"><article><span>New periods</span><strong>{frequencyPlan.periodCount}</strong><small>{frequencyPlan.firstPeriod?.payDate} to {frequencyPlan.lastPeriod?.payDate}</small></article><article><span>Draft pay runs discarded</span><strong>{frequencyPlan.discardedDraftRuns}</strong><small>{frequencyPlan.discardedDraftPeriods} open/future period record(s)</small></article><article><span>Employees aligned</span><strong>All</strong><small>{frequencyPlan.updatedActiveAttachments} active order(s) updated</small></article></div>{frequencyPlan.blockers?.length>0?<div className="validation-list">{frequencyPlan.blockers.map((blocker:string)=><div className="warning" key={blocker}><span>!</span><p><b>Change blocked</b><small>{blocker}</small></p></div>)}</div>:<div className="frequency-confirm"><label className="field"><span>Type the confirmation phrase</span><input aria-label="Frequency change confirmation" value={frequencyConfirmation} onChange={event=>setFrequencyConfirmation(event.target.value)} placeholder={frequencyPlan.confirmationPhrase}/><small>{frequencyPlan.confirmationPhrase}</small></label><button className="primary" disabled={changingFrequency||frequencyConfirmation!==frequencyPlan.confirmationPhrase} onClick={applyFrequencyChange}>Apply and rebuild schedule</button></div>}</>}</div>}{section==="Departments"&&<><div className="operation-footer"><button className="primary" disabled={!newDepartment.name.trim()} onClick={addDepartment}>Add department</button></div><div className="report-table-scroll"><table><thead><tr><th>Department</th><th>Nominal code</th><th>Cost centre</th><th>Actions</th></tr></thead><tbody>{departments.map(row=>editingDepartmentId===row.id?<tr key={row.id}><td><input aria-label={`Department name ${row.id}`} value={departmentDraft.name} onChange={event=>setDepartmentDraft(current=>({...current,name:event.target.value}))}/></td><td><input aria-label={`Department nominal code ${row.id}`} value={departmentDraft.nominalCode} onChange={event=>setDepartmentDraft(current=>({...current,nominalCode:event.target.value}))}/></td><td><input aria-label={`Department cost centre ${row.id}`} value={departmentDraft.costCentre} onChange={event=>setDepartmentDraft(current=>({...current,costCentre:event.target.value}))}/></td><td><div className="inline-actions"><button className="primary" disabled={!departmentDraft.name.trim()} onClick={saveDepartment}>Save</button><button onClick={()=>setEditingDepartmentId(0)}>Cancel</button></div></td></tr>:<tr key={row.id}><td><b>{row.name}</b></td><td>{row.nominalCode||"—"}</td><td>{row.costCentre||"—"}</td><td><div className="inline-actions"><button onClick={()=>editDepartment(row)}>Edit</button><button onClick={()=>removeDepartment(row.id)}>Delete</button></div></td></tr>)}</tbody></table></div></>}{warnings.length>0&&!["Departments","Email templates"].includes(section)&&<div className="validation-list">{warnings.map(warning=><div className="warning" key={warning}><span>!</span><p><b>Review setting</b><small>{warning}</small></p></div>)}</div>}{!["Departments","Email templates"].includes(section)&&<div className="operation-footer"><button className="primary" disabled={saving||frequencyEdited} onClick={save}>{saving?"Saving…":frequencyEdited?"Apply schedule change first":"Save employer settings"}</button></div>}</section></div>;
}

function CisWorkspace({ toast }: { toast: (s: string,success?:boolean) => void }) {
  const employerId=useEmployerId(),activeTaxYear=useTaxYear();
  const [view, setView] = useState("Payments");
  const initialTaxMonth=currentCisTaxMonth(activeTaxYear);
  const [taxYear,setTaxYear]=useState(activeTaxYear),[taxMonth,setTaxMonth]=useState(initialTaxMonth),[paymentDate,setPaymentDate]=useState(cisTaxMonthDates(initialTaxMonth,activeTaxYear).end);
  const [labour, setLabour] = useState(0),[materials, setMaterials] = useState(0),[vat, setVat] = useState(0),[retention,setRetention]=useState(0),[savingPayment,setSavingPayment]=useState(false);
  const [subcontractors,setSubcontractors]=useState<Array<{id:number;name:string;utr:string;type:string;niNumber?:string;companyNumber?:string;partnerUtr?:string;status:string;deductionRate:number;verificationNumber?:string;verificationMethod?:string;verifiedAt?:string}>>([]);
  const [cisPayments,setCisPayments]=useState<Array<{id:number;subcontractorId:number;taxYear:string;taxMonth:number;paymentDate:string;invoiceNumber?:string;paymentRecipient?:string;materialsEvidence?:string;subcontractorName?:string;subcontractorUtr?:string;deductionRate:number;verificationNumber?:string;verificationMethod?:string;verifiedAt?:string;labour:number;materials:number;vat:number;retention:number;deduction:number;netPayment:number;replacesPaymentId?:number|null;voidReason?:string|null;status:string}>>([]);
  const [filingHistory,setFilingHistory]=useState<Array<{id:number;type:string;status:string;dueDate?:string;preparedAt?:string;submittedAt?:string;response?:string;correlationId?:string;irMark?:string;payloadChecksum?:string;amendsSubmissionId?:number|null;replacesSubmissionId?:number|null;duplicatesSubmissionId?:number|null}>>([]);
  const [selectedSub,setSelectedSub]=useState(0),[returnData,setReturnData]=useState<{totals:Record<string,number>;statements:Array<Record<string,unknown>>;validation:{valid:boolean;errors:string[]}}|null>(null);
  const [verificationUtr,setVerificationUtr]=useState(""),[verificationRate,setVerificationRate]=useState(20),[verificationNumber,setVerificationNumber]=useState("");
  const [correctionReason,setCorrectionReason]=useState(""),[replacesPaymentId,setReplacesPaymentId]=useState<number|null>(null);
  const [employmentStatus,setEmploymentStatus]=useState(false),[notEmployees,setNotEmployees]=useState(false),[allVerified,setAllVerified]=useState(false),[declaration,setDeclaration]=useState(false);
  const [nilReturn,setNilReturn]=useState(false),[inactivityRequest,setInactivityRequest]=useState(false);
  const [newName,setNewName]=useState(""),[newUtr,setNewUtr]=useState("");
  const [newType,setNewType]=useState("sole-trader"),[newNiNumber,setNewNiNumber]=useState(""),[newCompanyNumber,setNewCompanyNumber]=useState(""),[newPartnerUtr,setNewPartnerUtr]=useState("");
  const [cisImporting,setCisImporting]=useState(false),[cisImportErrors,setCisImportErrors]=useState<string[]>([]);
  const [invoiceNumber,setInvoiceNumber]=useState(""),[paymentRecipient,setPaymentRecipient]=useState(""),[materialsEvidence,setMaterialsEvidence]=useState("");
  const [contractorSettings,setContractorSettings]=useState<any>(null);
  const [cisResultId,setCisResultId]=useState(0),[cisOutcome,setCisOutcome]=useState("accepted"),[cisAcknowledgement,setCisAcknowledgement]=useState(""),[cisResponseCode,setCisResponseCode]=useState(""),[cisResponseMessage,setCisResponseMessage]=useState(""),[cisSubmittedAt,setCisSubmittedAt]=useState("");
  const selected=subcontractors.find(s=>s.id===selectedSub);
  const selectedVerification=selected?cisVerificationDecision(taxYear,paymentDate,{
    status:selected.status,deductionRate:selected.deductionRate,verificationNumber:selected.verificationNumber||null,
    verificationMethod:selected.verificationMethod||null,verifiedAt:selected.verifiedAt||null,
  },cisPayments.filter(payment=>payment.subcontractorId===selected.id).map(payment=>({
    ...payment,verificationNumber:payment.verificationNumber||null,verificationMethod:payment.verificationMethod||null,
    verifiedAt:payment.verifiedAt||null,
  }))):null;
  const rate=selectedVerification?.evidence?.deductionRate??selected?.deductionRate??30;
  const deductibleLabour=Math.max(0,labour-retention),deduction = deductibleLabour * rate / 100;
  const net = labour + materials + vat - deduction-retention;
  const currentMonthPayments=cisPayments.filter(payment=>payment.taxYear===taxYear&&payment.taxMonth===taxMonth);
  async function loadCis() {
    const [response,employerResponse]=await Promise.all([fetch(`/api/cis?employerId=${employerId}`),fetch(`/api/employer?employerId=${employerId}`)]),body=await response.json(),employerBody=await employerResponse.json();
    const loadedSubcontractors=body.subcontractors||[];
    setSubcontractors(loadedSubcontractors);setCisPayments(body.payments||[]);setFilingHistory(body.filingHistory||[]);
    setSelectedSub(current=>loadedSubcontractors.some((item:{id:number})=>item.id===current)?current:(loadedSubcontractors[0]?.id||0));
    if(employerResponse.ok)setContractorSettings(employerBody.employer);
  }
  useEffect(()=>{
    setSelectedSub(0);setReturnData(null);setContractorSettings(null);setCisImportErrors([]);
    setInvoiceNumber("");setPaymentRecipient("");setMaterialsEvidence("");setReplacesPaymentId(null);
    loadCis().catch(()=>toast("CIS records could not be loaded."));
  },[employerId]);
  async function loadReturn(){const response=await fetch(`/api/cis?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&taxMonth=${taxMonth}`),body=await response.json();if(response.ok)setReturnData(body);}
  useEffect(()=>{if(view==="CIS300 return"||view==="Statements")loadReturn().catch(()=>toast("CIS return could not be loaded."));},[view,taxYear,taxMonth]);
  async function saveCisPayment() {
    if(savingPayment)return;
    setSavingPayment(true);
    try {
      const response = await fetch("/api/cis", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ kind:"payment", employerId, subcontractorId:selectedSub, taxYear,taxMonth, paymentDate,invoiceNumber,paymentRecipient:paymentRecipient||selected?.name,materialsEvidence, labour, materials, vat, retention,replacesPaymentId }) });
      const body=await response.json();if (!response.ok) throw new Error(body.error);
      setLabour(0);setMaterials(0);setVat(0);setRetention(0);setInvoiceNumber("");setPaymentRecipient("");setMaterialsEvidence("");
      setReplacesPaymentId(null);setCorrectionReason("");
      await Promise.all([loadCis(),loadReturn()]);toast(replacesPaymentId?`Corrected CIS payment saved with a link to voided payment #${replacesPaymentId}.`:`CIS payment calculated, validated and added to tax month ${taxMonth}.`);
    } catch(error) { toast(error instanceof Error?error.message:"CIS payment could not be saved."); }
    finally{setSavingPayment(false);}
  }
  async function verifySubcontractor(){if(!selected)return toast("Select a subcontractor first.");const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"verify",employerId,subcontractorId:selected.id,utr:verificationUtr||selected.utr,niNumber:selected.niNumber,companyNumber:selected.companyNumber,partnerUtr:selected.partnerUtr,deductionRate:verificationRate,verificationNumber:verificationNumber||`TEST-${selected.id}-${taxYear.replace("/","")}`,verificationMethod:"manual-or-test"})});const body=await response.json();if(!response.ok)return toast(body.error);await loadCis();setVerificationNumber("");toast(`${verificationRate}% manual/test verification result saved. No live HMRC verification was performed.`);}
  async function addSubcontractor(){const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,name:newName,utr:newUtr,type:newType,niNumber:newType==="sole-trader"?newNiNumber:undefined,companyNumber:newType==="company"?newCompanyNumber:undefined,partnerUtr:newType==="partnership"?newPartnerUtr:undefined})});const body=await response.json();if(!response.ok)return toast(body.error);await loadCis();setSelectedSub(body.id);setNewName("");setNewUtr("");setNewNiNumber("");setNewCompanyNumber("");setNewPartnerUtr("");toast("Subcontractor saved with an unverified 30% default status.");}
  function downloadCisTemplate(){
    const headers=["name","tradingName","type","utr","niNumber","companyNumber","partnerUtr","address","postcode","email","phone","deductionRate","verificationNumber","verificationDate"];
    const examples=[
      ["Alex Builder","","sole-trader","1000000001","AB123456C","","","1 Site Road, London","SW1A 1AA","alex@example.co.uk","07123456789","30","",""],
      ["Example Scaffolding Ltd","","company","1000000002","","SC123456","","2 Yard Lane, Leeds","LS1 1AA","accounts@example.co.uk","01131234567","20","V-EXAMPLE-20","2026-07-01"],
      ["Example Roofing Partnership","","partnership","1000000003","","","2000000003","3 Roof Street, Bristol","BS1 1AA","office@example.co.uk","01171234567","0","V-EXAMPLE-GROSS","2026-07-01"],
    ];
    const line=(values:string[])=>values.map(value=>`"${value.replaceAll('"','""')}"`).join(",");
    downloadClientBlob(new Blob(["\uFEFF",line(headers),"\r\n",examples.map(line).join("\r\n")],{type:"text/csv;charset=utf-8"}),"payflow-cis-subcontractor-import-template.csv");
  }
  async function importCisCsv(file?:File){
    if(!file)return;
    setCisImporting(true);setCisImportErrors([]);
    try{
      if(file.size>2_000_000)throw new Error("CIS CSV must be 2 MB or smaller.");
      const rows=parseCsvRecords(await file.text(),["name","type","utr"],"subcontractor");
      const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"import-subcontractors",employerId,rows})}),body=await response.json();
      if(!response.ok){const errors=Array.isArray(body.errors)?body.errors:[body.error||"CIS import failed."];setCisImportErrors(errors);throw new Error(body.error||"CIS import failed.");}
      await loadCis();toast(`${body.imported} subcontractor${body.imported===1?"":"s"} imported after complete-file validation.`);
    }catch(error){toast(error instanceof Error?error.message:"CIS CSV import failed.");}
    finally{setCisImporting(false);}
  }
  async function prepareReturn(){
    const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"prepare-return",employerId,taxYear,taxMonth,nilReturn,inactivityRequest,employmentStatusConsidered:employmentStatus,allSubcontractorsNotEmployees:notEmployees,allRequiredVerified:allVerified,declarationAccepted:declaration})});
    const body=await response.json();setReturnData(body.payload||returnData);if(!response.ok)return toast(body.validation?.errors?.join(" ")||body.error);
    setCisResultId(Number(body.submission?.id)||0);await loadCis();toast(body.reused?"The unchanged CIS300 package was reused and selected; no duplicate filing package was created.":"CIS300 package is test-ready and selected for external-result recording; live HMRC transmission requires the CIS adapter.",true);
  }
  async function recordCisFilingResult(){const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"record-filing-result",employerId,submissionId:cisResultId,outcome:cisOutcome,submittedAt:cisSubmittedAt,acknowledgementReference:cisAcknowledgement,responseCode:cisResponseCode,responseMessage:cisResponseMessage,evidenceSource:"external-import"})});const body=await response.json();if(!response.ok)return toast(body.error);setCisAcknowledgement("");setCisResponseCode("");setCisResponseMessage("");await loadCis();toast(`External HMRC ${cisOutcome} evidence recorded. PayFlow did not transmit this return.`);}
  async function issueStatement(subcontractorId:number,deduction:number){
    const response=await fetch("/api/cis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"issue-statement",employerId,taxYear,taxMonth,subcontractorId,issueGrossStatement:deduction<=0,deliveryMethod:"download"})});
    const body=await response.json();if(!response.ok)return toast(body.error);
    const statementId=Number(body.submission?.id),documentResponse=await fetch(`/api/cis?employerId=${employerId}&action=statement-document&id=${statementId}&format=html`);
    if(!documentResponse.ok){await loadCis();const documentError=await documentResponse.json().catch(()=>({}));return toast(documentError.error||`Statement #${statementId} was recorded but its printable document could not be downloaded.`);}
    const blob=await documentResponse.blob(),url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=`CIS-statement-${statementId}-${taxYear.replace("/","-")}-M${taxMonth}.html`;anchor.click();URL.revokeObjectURL(url);
    await loadCis();toast(`Statement #${statementId} downloaded and its issue recorded.`);
  }
  async function saveContractorSettings(){if(!contractorSettings)return;const response=await fetch("/api/employer",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({...contractorSettings,employerId})}),body=await response.json();if(!response.ok)return toast(body.error);setContractorSettings({...contractorSettings,...body.employer});toast("CIS contractor registration saved and audited.");}
  async function voidPayment(paymentId:number){const original=cisPayments.find(payment=>payment.id===paymentId);const response=await fetch("/api/cis",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({action:"void-payment",employerId,paymentId,reason:correctionReason})});const body=await response.json();if(!response.ok)return toast(body.error);if(original){setReplacesPaymentId(paymentId);setSelectedSub(original.subcontractorId);setTaxYear(original.taxYear);setTaxMonth(original.taxMonth);setPaymentDate(original.paymentDate);setInvoiceNumber(original.invoiceNumber||"");setPaymentRecipient(original.paymentRecipient||"");setMaterialsEvidence(original.materialsEvidence||"");setLabour(original.labour);setMaterials(original.materials);setVat(original.vat);setRetention(original.retention);setView("Payments");}await Promise.all([loadCis(),loadReturn()]);toast(`Payment #${paymentId} voided. Review the prefilled correction and save it to preserve the replacement chain.`);}
  const cisPeriodViews=new Set(["Payments","Corrections","CIS300 return","Statements"]);
  const cisPeriodSelector=cisPeriodViews.has(view)?<ModulePeriodBar title={taxYear} subtitle="CIS tax months" ariaLabel="CIS tax month" value={taxMonth} items={Array.from({length:12},(_,index)=>{const value=index+1,count=cisPayments.filter(payment=>payment.taxYear===taxYear&&payment.taxMonth===value&&payment.status!=="voided").length;return{value,prefix:`M${value}`,label:months[index],status:count?`${count} payment${count===1?"":"s"}`:"No payments",done:count>0,title:cisTaxMonthDates(value,taxYear).range};})} onSelect={month=>{setTaxMonth(month);setPaymentDate(cisTaxMonthDates(month,taxYear).end);setReturnData(null);}}/>:null;
  return <div className="operational-workspace cis-workspace">
    <div className="subnav cis-section-nav">{["Subcontractors","Verification","Payments","Corrections","CIS300 return","Statements"].map(v=><button key={v} className={view===v?"active":""} onClick={()=>{setView(v);if(v==="CIS300 return"||v==="Statements")void loadReturn();}}>{v}</button>)}<label className="inline-select"><span>Tax year</span><select value={taxYear} onChange={e=>{const year=e.target.value;setTaxYear(year);setPaymentDate(cisTaxMonthDates(taxMonth,year).end);setReturnData(null);}}><option>2025/26</option><option>2026/27</option><option>2027/28</option></select></label></div>
    {cisPeriodSelector}
    {view==="Subcontractors"&&contractorSettings&&<section className="operation-card"><div className="card-head"><div><h2>Contractor registration</h2><p>Required on CIS300 alongside the Accounts Office reference.</p></div><span className={`status ${contractorSettings.cisContractor&&/^\d{10}$/.test(contractorSettings.cisUtr||"")?"":"amber"}`}>{contractorSettings.cisContractor?"CIS contractor":"Not enabled"}</span></div><div className="form-grid form-pad"><Field label="Contractor UTR" value={contractorSettings.cisUtr||""} onChange={value=>setContractorSettings({...contractorSettings,cisUtr:value})}/><Field label="Accounts Office reference" value={contractorSettings.accountsOfficeReference||""} onChange={value=>setContractorSettings({...contractorSettings,accountsOfficeReference:value})}/><Check text="Employer operates as a CIS contractor" checked={Boolean(contractorSettings.cisContractor)} onChange={value=>setContractorSettings({...contractorSettings,cisContractor:value})}/></div><div className="operation-footer"><button className="primary" onClick={saveContractorSettings}>Save contractor registration</button></div></section>}
    {view==="Subcontractors"&&<section className="operation-card data-tools"><div className="card-head"><div><h2>Bulk subcontractor import</h2><p>Import legal identity and prior verification evidence for up to 500 subcontractors. Validation is all-or-nothing.</p></div><span className={`status ${cisImportErrors.length?"amber":""}`}>{cisImportErrors.length?"Needs correction":"Ready"}</span></div><div className="tool-actions"><article><span>1 · Download template</span><b>Sole trader, company and partnership examples</b><p>The template documents every supported identity, contact and verification field.</p><button disabled={cisImporting} onClick={downloadCisTemplate}>Download CIS CSV template</button></article><article><span>2 · Validate and import</span><b>No partial imports</b><p>Duplicate UTRs, incomplete legal identities and unsupported deduction evidence block the whole file.</p><label className="primary file-action">Choose CIS CSV<input type="file" accept="text/csv,.csv" disabled={cisImporting} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void importCisCsv(file);}}/></label></article></div>{cisImportErrors.length>0&&<div className="validation-list">{cisImportErrors.slice(0,50).map((error,index)=><div className="warning" key={`${index}-${error}`}><span>!</span><p><b>Import error</b><small>{error}</small></p></div>)}</div>}</section>}
    {view==="Subcontractors"&&<section className="operation-card"><div className="card-head"><div><h2>Verification identity</h2><p>Capture the identifiers HMRC uses for the selected legal form.</p></div></div><div className="form-grid form-pad"><label className="field"><span>Business type</span><select value={newType} onChange={event=>setNewType(event.target.value)}><option value="sole-trader">Sole trader</option><option value="partnership">Partnership</option><option value="company">Company</option></select></label>{newType==="sole-trader"&&<Field label="National Insurance number" value={newNiNumber} onChange={setNewNiNumber}/>} {newType==="company"&&<Field label="Company registration number" value={newCompanyNumber} onChange={setNewCompanyNumber}/>} {newType==="partnership"&&<Field label="Nominated partner UTR" value={newPartnerUtr} onChange={setNewPartnerUtr}/>}</div></section>}
    {view==="Payments"&&<section className="operation-card"><div className="card-head"><div><h2>Invoice evidence</h2><p>Legal identity and verification details are frozen when the payment is saved.</p></div>{replacesPaymentId&&<span className="status amber">Replacing payment #{replacesPaymentId}</span>}</div><div className="form-grid form-pad"><Field label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber}/><Field label="Payment recipient" value={paymentRecipient||selected?.name||""} onChange={setPaymentRecipient}/><Field label="Materials evidence / estimate note" value={materialsEvidence} onChange={setMaterialsEvidence}/></div>{replacesPaymentId&&<div className="operation-footer"><button onClick={()=>setReplacesPaymentId(null)}>Cancel replacement link</button></div>}</section>}
    {view==="CIS300 return"&&<><section className="operation-card"><div className="card-head"><div><h2>Statutory CIS300 declarations</h2><p>Tax month ending {cisTaxMonthDates(taxMonth,taxYear).endLabel}; filing deadline {cisTaxMonthDates(taxMonth,taxYear).due}.</p></div></div><div className="return-checklist">{!returnData?.totals.payments&&<><Check text="File a nil return for this tax month" checked={nilReturn} onChange={value=>{setNilReturn(value);if(value)setInactivityRequest(false);}}/><Check text="Request CIS inactivity (up to six months)" checked={inactivityRequest} onChange={value=>{setInactivityRequest(value);if(value)setNilReturn(false);}}/></>}<Check text="Every listed subcontractor is not an employee" checked={notEmployees} onChange={setNotEmployees}/><Check text="Every subcontractor requiring verification has been verified" checked={allVerified} onChange={setAllVerified}/></div></section><section className="operation-card"><div className="card-head"><div><h2>Record external HMRC result</h2><p>Use this only after an accredited adapter or HMRC filing service has transmitted the exact package. This records evidence; PayFlow does not claim transmission.</p></div><span className="status amber">External evidence</span></div><div className="form-grid form-pad"><label className="field"><span>Test-ready CIS300 package</span><select value={cisResultId} onChange={event=>setCisResultId(Number(event.target.value))}><option value={0}>Select package…</option>{filingHistory.filter(item=>["test-ready","submitted"].includes(item.status)).map(item=><option value={item.id} key={item.id}>#{item.id} · {item.status}</option>)}</select></label><label className="field"><span>HMRC result</span><select value={cisOutcome} onChange={event=>setCisOutcome(event.target.value)}><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label><Field label="External submission date and time" value={cisSubmittedAt} type="datetime-local" onChange={setCisSubmittedAt}/><Field label="Acknowledgement / correlation reference" value={cisAcknowledgement} onChange={setCisAcknowledgement}/><Field label="HMRC response code" value={cisResponseCode} onChange={setCisResponseCode}/><Field label={cisOutcome==="rejected"?"Rejection message":"HMRC response message"} value={cisResponseMessage} onChange={setCisResponseMessage}/></div><div className="operation-footer"><button className="primary" disabled={!cisResultId||cisAcknowledgement.trim().length<6||!cisSubmittedAt||(cisOutcome==="rejected"&&cisResponseMessage.trim().length<3)} onClick={recordCisFilingResult}>Record external result</button></div></section></>}
    {view==="Statements"&&<section className="operation-card"><div className="card-head"><div><h2>Issue payment and deduction statements</h2><p>Statements with deductions must be issued by {cisTaxMonthDates(taxMonth,taxYear).due}. Each issue is checksummed and audited.</p></div></div><table><thead><tr><th>Subcontractor</th><th>UTR</th><th>Materials</th><th>Deduction</th><th /></tr></thead><tbody>{(returnData?.statements||[]).map((statement:any)=><tr key={statement.subcontractorId}><td>{statement.name}</td><td>{statement.utr}</td><td>{money(statement.materials)}</td><td>{money(statement.deduction)}</td><td><button onClick={()=>issueStatement(statement.subcontractorId,statement.deduction)}>{statement.deduction>0?"Issue statement":"Issue optional gross statement"}</button></td></tr>)}</tbody></table></section>}
    <div className="subnav">{["Subcontractors","Verification","Payments","Corrections","CIS300 return","Statements"].map(v=><button key={v} className={view===v?"active":""} onClick={()=>{setView(v);if(v==="CIS300 return"||v==="Statements")loadReturn();}}>{v}</button>)}<label className="inline-select"><span>Tax year</span><select value={taxYear} onChange={e=>{const year=e.target.value;setTaxYear(year);setPaymentDate(cisTaxMonthDates(taxMonth,year).end);setReturnData(null);}}><option>2025/26</option><option>2026/27</option><option>2027/28</option></select></label><label className="inline-select"><span>Tax month</span><select value={taxMonth} onChange={e=>{const month=+e.target.value;setTaxMonth(month);setPaymentDate(cisTaxMonthDates(month,taxYear).end);setReturnData(null);}}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>Month {index+1}</option>)}</select></label></div>
    {view === "Payments" ? <><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>Record subcontractor payment</h2><p>{taxYear} · Tax month {taxMonth} · {cisTaxMonthDates(taxMonth,taxYear).range}</p></div><span className={`status ${!selectedVerification?.valid?"amber":""}`}>{selectedVerification?.valid?`${selectedVerification.reason} · ${rate}%`:"Verification required"}</span></div>{selected&&!selectedVerification?.valid&&<div className="portal-message">Verify this subcontractor before payment. There is no complete result or continuing payment history in the current or previous two tax years.</div>}<div className="form-grid form-pad"><label className="field"><span>Subcontractor</span><select value={selectedSub} onChange={e=>setSelectedSub(+e.target.value)}><option value={0}>Select…</option>{subcontractors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Field label="Payment date" value={paymentDate} type="date" onChange={setPaymentDate}/><Field label="Labour before retention" value={String(labour)} type="number" onChange={v=>setLabour(+v)}/><Field label="Materials paid" value={String(materials)} type="number" onChange={v=>setMaterials(+v)}/><Field label="VAT paid" value={String(vat)} type="number" onChange={v=>setVat(+v)}/><Field label="Labour retention withheld" value={String(retention)} type="number" onChange={v=>setRetention(+v)}/><Field label="Applicable deduction rate %" value={String(rate)}/></div><div className="operation-footer"><button className="primary" disabled={savingPayment||!selectedSub||!selectedVerification?.valid||invoiceNumber.trim().length<3||labour+materials+vat<=0||retention>labour||(materials>0&&materialsEvidence.trim().length<3)} onClick={saveCisPayment}>{savingPayment?"Saving…":"Calculate & save payment"}</button></div></section><aside className="calculation-panel"><span>CIS calculation</span><SummaryLine label="Payment before VAT" value={labour+materials-retention}/><SummaryLine label="Non-deductible materials" value={materials}/><SummaryLine label="Deductible labour after retention" value={deductibleLabour}/><SummaryLine label={`CIS deduction (${rate}%)`} value={deduction}/><SummaryLine label="Retention withheld" value={retention}/><SummaryLine label="Net payment including VAT" value={net} strong highlight/><small>VAT and qualifying materials are excluded. A withheld labour retention is deducted only when it is later paid.</small></aside></div><section className="operation-card"><div className="card-head"><div><h2>Payments recorded this tax month</h2><p>Saved payment evidence and totals are visible here immediately. Use payment history and corrections to void and replace an entry.</p></div><button onClick={()=>setView("Corrections")}>Open payment history & corrections</button></div>{currentMonthPayments.length?<div className="report-table-scroll"><table><thead><tr><th>Date</th><th>Invoice</th><th>Subcontractor</th><th>Labour</th><th>Materials</th><th>CIS deduction</th><th>Net paid</th><th>Status</th></tr></thead><tbody>{currentMonthPayments.map(payment=><tr key={payment.id}><td>{formatUkDate(payment.paymentDate)}</td><td><b>{payment.invoiceNumber||"Legacy record"}</b></td><td>{payment.subcontractorName||subcontractors.find(sub=>sub.id===payment.subcontractorId)?.name||`#${payment.subcontractorId}`}</td><td>{money(payment.labour)}</td><td>{money(payment.materials)}</td><td>{money(payment.deduction)}</td><td>{money(payment.netPayment)}</td><td><span className={`status ${payment.status==="voided"?"amber":""}`}>{payment.status}</span></td></tr>)}</tbody></table></div>:<div className="empty-workflow"><p>No subcontractor payments are recorded for this tax month.</p></div>}</section></>
    : view === "Subcontractors" ? <section className="operation-card"><div className="card-head"><div><h2>Add subcontractor</h2><p>New records remain unverified at 30% until a verification result is saved.</p></div></div><div className="form-grid form-pad"><Field label="Legal name" value={newName} onChange={setNewName}/><Field label="Unique Taxpayer Reference" value={newUtr} onChange={setNewUtr}/><Field label="Business type" value={newType==="sole-trader"?"Sole trader":newType==="partnership"?"Partnership":"Company"}/></div><div className="operation-footer"><button className="primary" onClick={addSubcontractor}>Save subcontractor</button></div></section>
    : view === "Verification" ? <section className="operation-card"><div className="card-head"><div><h2>Subcontractor verification</h2><p>Record the exact HMRC response or use a clearly identified test reference.</p></div><span className="status amber">Live adapter unavailable</span></div><div className="form-grid form-pad"><label className="field"><span>Subcontractor</span><select value={selectedSub} onChange={e=>{const id=+e.target.value;setSelectedSub(id);setVerificationUtr(subcontractors.find(s=>s.id===id)?.utr||"");}}>{subcontractors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Field label="UTR" value={verificationUtr||selected?.utr||""} onChange={setVerificationUtr}/><Field label="Current status" value={selected?.status||"Unverified"}/><label className="field"><span>HMRC deduction result</span><select value={verificationRate} onChange={event=>setVerificationRate(Number(event.target.value))}><option value={0}>0% gross payment status</option><option value={20}>20% verified</option><option value={30}>30% unmatched</option></select></label><Field label="Verification number / test reference" value={verificationNumber} onChange={setVerificationNumber}/></div><div className="operation-footer"><button className="primary" onClick={verifySubcontractor}>Save verification result</button></div></section>
    : view === "Corrections" ? <section className="operation-card"><div className="card-head"><div><h2>Payment corrections</h2><p>Void an incorrect entry, retain its payment-time identity and verification evidence, then save the prefilled replacement.</p></div></div><div className="form-grid form-pad"><Field label="Correction reason" value={correctionReason} onChange={setCorrectionReason}/></div><table><thead><tr><th>Date</th><th>Invoice</th><th>Subcontractor / recipient</th><th>Rate / verification</th><th>Labour / materials</th><th>Deduction</th><th>Net payment</th><th>Status / lineage</th><th /></tr></thead><tbody>{cisPayments.filter(payment=>payment.taxYear===taxYear&&payment.taxMonth===taxMonth).map(payment=><tr key={payment.id}><td>{formatUkDate(payment.paymentDate)}</td><td><b>{payment.invoiceNumber||"Legacy record"}</b></td><td>{payment.subcontractorName||subcontractors.find(sub=>sub.id===payment.subcontractorId)?.name||`#${payment.subcontractorId}`}<small>{payment.paymentRecipient||"Recipient not recorded"}</small></td><td>{payment.deductionRate}%<small>{payment.verificationNumber||"No verification reference"} · {payment.verificationMethod||"Legacy method"} · {formatUkDate(payment.verifiedAt,"Legacy date")}</small></td><td>{money(payment.labour)}<small>Materials {money(payment.materials)} · {payment.materialsEvidence||"No materials evidence"}</small></td><td>{money(payment.deduction)}</td><td>{money(payment.netPayment)}</td><td>{payment.status}<small>{payment.replacesPaymentId?`Replaces #${payment.replacesPaymentId}`:payment.voidReason||"Original payment"}</small></td><td>{payment.status!=="voided"&&<button disabled={correctionReason.trim().length<5} onClick={()=>voidPayment(payment.id)}>Void & replace</button>}</td></tr>)}</tbody></table></section>
    : view === "CIS300 return" ? <section className="operation-card"><div className="card-head"><div><h2>CIS300 monthly return</h2><p>{taxYear} · Tax month {taxMonth} · return ending {cisTaxMonthDates(taxMonth,taxYear).endLabel}</p></div><span className={`status ${returnData?.validation.valid?"":"amber"}`}>{returnData?.validation.valid?"Validated":"Needs validation"}</span></div><div className="return-checklist"><Check text={`${returnData?.totals.payments||0} payments and ${returnData?.totals.subcontractors||0} subcontractors included`} checked={Boolean(returnData?.totals.payments)}/><Check text="Employment status of subcontractors has been considered" checked={employmentStatus} onChange={setEmploymentStatus}/><Check text="Verification details and deduction rates are correct" checked={Boolean(returnData?.validation.valid)}/><Check text="Information is complete and accurate" checked={declaration} onChange={setDeclaration}/></div><div className="operation-footer"><button onClick={loadReturn}>Validate return</button><button className="primary" disabled={!(returnData?.validation.valid||(!returnData?.totals.payments&&(nilReturn||inactivityRequest)))||!employmentStatus||!notEmployees||!allVerified||!declaration} onClick={prepareReturn}>Prepare filing package</button></div></section>
    : <section className="operation-card"><div className="card-head"><div><h2>Monthly deduction statements</h2><p>{taxYear} · Tax month {taxMonth} totals generated from recorded payments.</p></div></div><table><thead><tr><th>Subcontractor</th><th>Payments</th><th>Labour</th><th>Deduction</th><th>Net payment</th></tr></thead><tbody>{(returnData?.statements||[]).map((s:any)=><tr key={s.subcontractorId}><td><b>{s.name}</b></td><td>{s.payments}</td><td>{money(s.labour)}</td><td>{money(s.deduction)}</td><td>{money(s.netPayment)}</td></tr>)}</tbody></table></section>}
    {view==="Subcontractors"&&<section className="operation-card"><div className="card-head"><div><h2>Subcontractor register</h2><p>Tenant-bound CIS identities and the latest locally recorded verification status.</p></div><span>{subcontractors.length} records</span></div>{subcontractors.length?<div className="report-table-scroll"><table><thead><tr><th>Legal name</th><th>Business type</th><th>UTR</th><th>Verification identity</th><th>Rate</th><th>Status</th></tr></thead><tbody>{subcontractors.map(item=><tr key={item.id}><td><b>{item.name}</b></td><td>{item.type.replaceAll("-"," ")}</td><td>{item.utr}</td><td>{item.niNumber||item.companyNumber||item.partnerUtr||"Incomplete"}</td><td>{item.deductionRate}%</td><td><span className={`status ${item.status==="unverified"?"amber":""}`}>{item.status.replaceAll("-"," ")}</span></td></tr>)}</tbody></table></div>:<div className="empty-workflow"><p>No subcontractors have been added for this employer.</p></div>}</section>}
    <section className="operation-card"><div className="card-head"><div><h2>CIS filing and statement history</h2><p>Prepared packages, issued statements and superseded evidence. Test-ready is not an HMRC submission.</p></div><span>{filingHistory.length} records</span></div><table><thead><tr><th>ID</th><th>Document and lineage</th><th>Status</th><th>Due date</th><th>Prepared / issued</th><th>HMRC submitted / document</th></tr></thead><tbody>{filingHistory.slice(0,25).map(item=><tr key={item.id}><td>#{item.id}</td><td><b>{item.type==="CIS-PDS"?"Payment statement":"CIS300"}</b>{item.amendsSubmissionId&&<small>Amends accepted return #{item.amendsSubmissionId}</small>}{item.replacesSubmissionId&&(item.type==="CIS-PDS"?<small>Corrected replacement of statement #{item.replacesSubmissionId}</small>:<small>Replaces package #{item.replacesSubmissionId}</small>)}{item.duplicatesSubmissionId&&<small>Duplicate of statement #{item.duplicatesSubmissionId}</small>}{item.correlationId&&<small>Acknowledgement {item.correlationId}</small>}</td><td><span className={`status ${["superseded","rejected"].includes(item.status)?"amber":""}`}>{item.status}</span></td><td>{formatUkDate(item.dueDate)}</td><td>{formatUkDate(item.preparedAt)}</td><td>{item.type==="CIS-PDS"?<span className="row-actions"><a className="button-link" target="_blank" rel="noreferrer" href={`/api/cis?employerId=${employerId}&action=statement-document&id=${item.id}&format=html`}>Open printable</a><a href={`/api/cis?employerId=${employerId}&action=statement-document&id=${item.id}&format=csv`}>CSV</a></span>:(formatUkDate(item.submittedAt,"Not transmitted"))}</td></tr>)}</tbody></table>{!filingHistory.length&&<div className="empty-workflow"><p>No CIS packages or statements have been prepared.</p></div>}</section>
  </div>;
}

type RtiDraftPreview={id:number;status:string;periodNumber:number;totals:Record<string,number>;recoveries:Record<string,number>;employeeCount:number;noPaymentForPeriod:boolean;reportingWindow?:{start:string;end:string;deadline:string};payroll?:{payRecords:number;employeePayments:number;employeesWithPayments:number;unfinalisedPayrollPeriods:number[]};payload:any;payloadChecksum?:string;createdAt?:string};

function rtiHoursBand(hours:unknown){const value=Number(hours||0);return value>=30?"30 or more hours":value>=24?"24 to 29.99 hours":value>=16?"16 to 23.99 hours":value>0?"Less than 16 hours":"Not reported";}
function rtiFrequencyLabel(value:unknown){const text=String(value||"");return text?text.charAt(0).toUpperCase()+text.slice(1).replaceAll("-"," "):"Not reported";}

function RtiSubmissionPreview({draft,onClose}:{draft:RtiDraftPreview;onClose:()=>void}){
  const [tab,setTab]=useState<"summary"|"payload">("summary"),[employeeIndex,setEmployeeIndex]=useState(0);
  const payload=draft.payload||{},employer=payload.employer||{},employeeRows=Array.isArray(payload.employees)?payload.employees:[],employee=employeeRows[employeeIndex]||null;
  const ytd=employee?.ytd||{},niRows=Array.isArray(ytd.niByCategory)?ytd.niByCategory:[],addressParts=String(employee?.address||"").split(/\r?\n|,\s*/).filter(Boolean);
  const periodsCovered=employee?.reportedPayFrequency==="four-weekly"?4:employee?.reportedPayFrequency==="fortnightly"?2:1;
  const Row=({label,value}:{label:string;value:ReactNode})=><div className="rti-preview-row"><span>{label}</span><strong>{value??"—"}</strong></div>;
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label={`${payload.type||"RTI"} submission preview`}><div className="modal rti-preview-modal"><header><div><span className="eyebrow">RTI submission preview</span><h2>{payload.type||"RTI"} · {payload.taxYear} · {payload.type==="EPS"?`Tax month ${payload.periodNumber}`:`Payroll period ${payload.periodNumber}`}</h2><p>Review the frozen local package before approval. This preview does not mean it has been sent to HMRC.</p></div><button onClick={onClose}>Close</button></header><div className="rti-preview-tabs"><button className={tab==="summary"?"active":""} onClick={()=>setTab("summary")}>Submission summary</button><button className={tab==="payload"?"active":""} onClick={()=>setTab("payload")}>Frozen payload</button></div>{tab==="payload"?<pre className="rti-payload-preview">{JSON.stringify(payload,null,2)}</pre>:<div className="rti-preview-body"><section><h3>Employer details</h3><Row label="Name" value={employer.name||"Not recorded"}/><Row label="PAYE reference" value={employer.payeReference||"Not recorded"}/><Row label="Accounts Office reference" value={employer.accountsOfficeReference||"Not recorded"}/><Row label="Company number" value={employer.companyNumber||"Not recorded"}/><Row label="Corporation Tax reference" value={employer.corporationTaxReference||"Not held in payroll"}/></section>{payload.type==="EPS"?<><section><h3>EPS declarations</h3><Row label="No payment for period" value={payload.noPaymentForPeriod?"Yes":"No"}/><Row label="Tax month" value={payload.periodNumber}/><Row label="Period covered" value={payload.reportingWindow?`${formatUkDate(payload.reportingWindow.start)} to ${formatUkDate(payload.reportingWindow.end)}`:"Not available"}/><Row label="Submission deadline" value={formatUkDate(payload.reportingWindow?.deadline)}/><Row label="Employment Allowance indicator" value={payload.employmentAllowance?"Included":"Not included"}/><Row label="Final submission indicator" value={payload.finalSubmission?"Included":"Not included"}/><Row label="PAYE scheme ceased" value={payload.ceasedIndicator?`Yes · ${formatUkDate(payload.cessationDate)}`:"No"}/></section><section><h3>Recoverable amounts and adjustments</h3><Row label="Statutory pay recovered" value={money(payload.recoveries?.statutoryPayRecovered||0)}/><Row label="CIS deductions suffered" value={money(payload.recoveries?.cisDeductionsSuffered||0)}/><Row label="Apprenticeship Levy" value={money(payload.recoveries?.apprenticeshipLevy||0)}/><Row label="Employees with payment activity" value={payload.payroll?.employeesWithPayments||0}/></section></>:employee&&<><section><div className="rti-preview-title"><h3>Employee details</h3>{employeeRows.length>1&&<select aria-label="Preview employee" value={employeeIndex} onChange={event=>setEmployeeIndex(Number(event.target.value))}>{employeeRows.map((row:any,index:number)=><option value={index} key={row.employeeId||index}>{row.firstName} {row.lastName} · {row.payrollId}</option>)}</select>}</div><h4>{[employee.title,employee.firstName,employee.middleNames,employee.lastName].filter(Boolean).join(" ")}</h4><Row label="National Insurance number" value={employee.niNumber||"Not supplied"}/><Row label="Address line 1" value={addressParts[0]||"Not recorded"}/><Row label="Address line 2" value={addressParts.slice(1).join(", ")||"—"}/><Row label="Postcode" value={employee.postcode||"Not recorded"}/><Row label="Date of birth" value={formatUkDate(employee.dateOfBirth)}/><Row label="Gender" value={employee.gender==="M"?"Male":employee.gender==="F"?"Female":employee.gender||"Not recorded"}/><Row label="Director's NIC calculation method" value={employee.director?(employee.directorMethod==="alternative"?"Alternative":"Annual"):"Not a director"}/><Row label="Payroll ID" value={employee.payrollId}/></section><section><h3>Payment</h3><Row label="Payment frequency" value={rtiFrequencyLabel(employee.reportedPayFrequency)}/><Row label="Payment date" value={formatUkDate(payload.payDate)}/><Row label="HMRC month number" value={payload.taxMonth||"—"}/><Row label="Number of periods covered" value={periodsCovered}/><Row label="Contracted hours per week" value={rtiHoursBand(employee.contractedHours)}/><Row label="Tax code" value={employee.taxCode}/><Row label="Taxable pay" value={money(employee.taxablePay||0)}/><Row label="Pay after statutory deductions" value={money(employee.netPay||0)}/><Row label="Tax" value={money(employee.payeTax||0)}/><Row label="NIC table letter" value={employee.niCategory}/><Row label="Gross earnings for NICs" value={money(employee.nicablePay||0)}/><Row label="Employer NICs" value={money(employee.employerNic||0)}/><Row label="Employee NICs" value={money(employee.employeeNic||0)}/></section><section><h3>Year to date</h3><Row label="Taxable pay" value={money(ytd.taxablePay||0)}/><Row label="Tax" value={money(ytd.payeTax||0)}/><Row label="Gross pay" value={money(ytd.grossPay||0)}/><Row label="Employee NICs" value={money(ytd.employeeNic||0)}/><Row label="Employer NICs" value={money(ytd.employerNic||0)}/></section><section className="rti-ni-section"><h3>NI letters and values (year to date)</h3><div className="report-table-scroll"><table><thead><tr><th>Table</th><th>Gross earnings</th><th>At LEL</th><th>From LEL to PT</th><th>From PT to UEL</th><th>Employer NICs</th><th>Employee NICs</th></tr></thead><tbody>{niRows.length?niRows.map((row:any,index:number)=><tr key={`${row.niCategory}-${index}`}><td><b>{row.niCategory}</b></td><td>{money(row.nicablePay||0)}</td><td>{money(row.earningsAtLel||0)}</td><td>{money(row.earningsLelToPt||0)}</td><td>{money(row.earningsPtToUel||0)}</td><td>{money(row.employerNic||0)}</td><td>{money(row.employeeNic||0)}</td></tr>):<tr><td colSpan={7}>No cumulative NI category values are present.</td></tr>}</tbody></table></div></section></>}<section><h3>Submission information</h3><Row label="Sender ID" value="Assigned by the HMRC transport adapter"/><Row label="Draft transaction ID" value={draft.payloadChecksum?.toUpperCase()||"Not available"}/><Row label="Created" value={formatUkDateTime(draft.createdAt,"Not available")}/><Row label="Current status" value={draft.status==="test-ready"?"Ready for external adapter":draft.status}/><Row label="HMRC submission status" value="Not transmitted"/></section></div>}<footer><button onClick={onClose}>Close preview</button></footer></div></div>;
}

function RtiWorkspace({ toast,employees,finalised,migrated,onDataChanged }: { toast: (s: string,success?:boolean) => void;employees:Employee[];finalised:number[];migrated:number[];onDataChanged:()=>Promise<void> }) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const [selected, setSelected] = useState("FPS");
  const [filing, setFiling] = useState(false);
  const [declaration,setDeclaration]=useState(false);
  const [correctionReason,setCorrectionReason]=useState("");
  const [lateReason,setLateReason]=useState("");
  const [epsNoPayment,setEpsNoPayment]=useState(false),[epsEmploymentAllowance,setEpsEmploymentAllowance]=useState(false);
  const [epsCisSuffered,setEpsCisSuffered]=useState(0),[finalSubmission,setFinalSubmission]=useState(false),[ceasedIndicator,setCeasedIndicator]=useState(false),[cessationDate,setCessationDate]=useState(`${taxYearStartYear(taxYear)+1}-04-05`);
  const [draft,setDraft]=useState<RtiDraftPreview|null>(null),[previewOpen,setPreviewOpen]=useState(false);
  const [history,setHistory]=useState<Array<{id:number;type:string;status:string;dueDate?:string;createdAt?:string;preparedAt?:string;submittedAt?:string;correlationId?:string;irMark?:string;response?:string;payloadChecksum?:string;payload?:string}>>([]);
  const [historyLoaded,setHistoryLoaded]=useState(false),[autoPositioned,setAutoPositioned]=useState(false);
  const [rtiResultId,setRtiResultId]=useState(0),[rtiOutcome,setRtiOutcome]=useState("accepted"),[rtiAcknowledgement,setRtiAcknowledgement]=useState(""),[rtiResponseCode,setRtiResponseCode]=useState(""),[rtiResponseMessage,setRtiResponseMessage]=useState(""),[rtiSubmittedAt,setRtiSubmittedAt]=useState("");
  const [employerIdentity,setEmployerIdentity]=useState({name:"Selected employer",payeReference:"Not configured"});
  const latestFinalisedPeriod=finalised.length?Math.max(...finalised):1;
  const latestFinalisedTaxMonth=paySchedule.find(item=>item.periodNumber===latestFinalisedPeriod)?.taxMonth||1;
  const [submissionPeriod,setSubmissionPeriod]=useState(latestFinalisedPeriod);
  const [epsTaxMonth,setEpsTaxMonth]=useState(latestFinalisedTaxMonth);
  const activeSubmissionPeriod=selected==="EPS"?epsTaxMonth:submissionPeriod;
  useEffect(()=>{setSubmissionPeriod(latestFinalisedPeriod);setEpsTaxMonth(latestFinalisedTaxMonth);},[latestFinalisedPeriod,latestFinalisedTaxMonth]);
  useEffect(()=>{
    const validFinal=selected==="EPS"?epsTaxMonth===12:["FPS","Additional FPS"].includes(selected)&&submissionPeriod===paySchedule.length;
    if(!validFinal)setFinalSubmission(false);
  },[selected,submissionPeriod,epsTaxMonth,paySchedule.length]);
  const filingResponse=(item:typeof history[number])=>{
    if(!item.response)return {code:"",message:""};
    try{
      const evidence=JSON.parse(item.response) as {responseCode?:string|null;responseMessage?:string|null;evidenceSource?:string|null};
      return {code:evidence.responseCode||"",message:evidence.responseMessage||"",source:evidence.evidenceSource||""};
    }catch{return {code:"",message:item.response};}
  };
  const rtiHistory=history
    .filter(item=>["FPS","EPS","NVR","Additional FPS","EXB"].includes(item.type)&&item.status!=="invalid")
    .map(item=>{
      const response=filingResponse(item),responseSummary=[response.code,response.message].filter(Boolean).join(" · ");
      return {...item,correlationId:[item.correlationId,responseSummary].filter(Boolean).join(" · ")||undefined};
    });
  const submissionPayload=(item:typeof rtiHistory[number])=>{try{return JSON.parse(item.payload||"{}") as Record<string,unknown>;}catch{return {} as Record<string,unknown>;}};
  const latestSubmission=(type:string)=>rtiHistory.find(item=>item.type===type&&(!["FPS","EPS","Additional FPS"].includes(type)||
    Number(submissionPayload(item).periodNumber)===(type==="EPS"?epsTaxMonth:submissionPeriod)));
  const latestStatus=(type:string,fallback:string)=>latestSubmission(type)?.status||fallback;
  const acceptedEpsForMonth=(taxMonth:number)=>rtiHistory.find(item=>item.type==="EPS"&&item.status==="accepted"&&Number(submissionPayload(item).periodNumber)===taxMonth);
  const acceptedNoPaymentEpsForMonth=(taxMonth:number)=>{
    const accepted=acceptedEpsForMonth(taxMonth);
    return accepted&&Boolean(submissionPayload(accepted).noPaymentForPeriod)?accepted:undefined;
  };
  const acceptedFpsForPeriod=(periodNumber:number)=>rtiHistory.find(item=>item.type==="FPS"&&item.status==="accepted"&&Number(submissionPayload(item).periodNumber)===periodNumber);
  const allFpsCompleteForMonth=(taxMonth:number)=>{
    const scheduled=paySchedule.filter(item=>item.taxMonth===taxMonth);
    return scheduled.length>0&&scheduled.every(item=>Boolean(acceptedFpsForPeriod(item.periodNumber))||migrated.includes(item.periodNumber));
  };
  const selectedPayrollTaxMonth=paySchedule.find(item=>item.periodNumber===submissionPeriod)?.taxMonth||1;
  const selectedNoPaymentClosure=acceptedNoPaymentEpsForMonth(selectedPayrollTaxMonth);
  const selectedAcceptedFps=acceptedFpsForPeriod(submissionPeriod);
  const submissions = [
    ["FPS","Full Payment Submission",`Period ${submissionPeriod}`,selectedNoPaymentClosure?"Not required · no-payment EPS accepted":latestStatus("FPS","Draft")],
    ["EPS","Employer Payment Summary",`Tax month ${epsTaxMonth}`,latestStatus("EPS",allFpsCompleteForMonth(epsTaxMonth)?"Not required unless adjustments · FPS complete":"Available")],
    ["NVR","NINO verification request","Withdrawn 3 February 2025","HMRC suspended"],
    ["Additional FPS","Additional FPS",`Period ${submissionPeriod} · correction only`,selectedNoPaymentClosure?"Not applicable · no FPS required":selectedAcceptedFps?latestStatus("Additional FPS","Not required · correction only"):latestStatus("Additional FPS","Awaiting HMRC baseline")],
    ["EXB","Expenses & benefits",taxYear,latestStatus("EXB","Available")],
  ];
  async function loadHistory(){const response=await fetch(`/api/submissions?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body=await response.json();if(response.ok){setHistory(body);setHistoryLoaded(true);}}
  useEffect(()=>{loadHistory().catch(()=>toast("RTI submission history could not be loaded."));},[]);
  useEffect(()=>{
    if(!historyLoaded||autoPositioned)return;
    const firstOutstandingFps=paySchedule.find(item=>!acceptedFpsForPeriod(item.periodNumber)&&!acceptedNoPaymentEpsForMonth(item.taxMonth));
    const firstOutstandingEps=Array.from({length:12},(_,index)=>index+1).find(taxMonth=>!acceptedEpsForMonth(taxMonth)&&!allFpsCompleteForMonth(taxMonth));
    if(firstOutstandingFps)setSubmissionPeriod(firstOutstandingFps.periodNumber);
    else if(paySchedule.length)setSubmissionPeriod(paySchedule.at(-1)!.periodNumber);
    if(firstOutstandingEps)setEpsTaxMonth(firstOutstandingEps);
    else setEpsTaxMonth(12);
    setAutoPositioned(true);
  },[historyLoaded,autoPositioned,history,paySchedule]);
  useEffect(()=>{
    const existing=latestSubmission(selected);
    if(!existing||!["validated","test-ready","accepted"].includes(existing.status)){setDraft(null);setDeclaration(false);setPreviewOpen(false);return;}
    const payload:any=submissionPayload(existing);
    setDraft({id:existing.id,status:existing.status,periodNumber:Number(payload.periodNumber||0),totals:payload.totals||{},recoveries:payload.recoveries||{},employeeCount:payload.employees?.length||payload.benefits?.length||(payload.employee?1:0),noPaymentForPeriod:Boolean(payload.noPaymentForPeriod),reportingWindow:payload.reportingWindow,payroll:payload.payroll,payload,payloadChecksum:existing.payloadChecksum,createdAt:existing.createdAt});
    setDeclaration(["test-ready","accepted"].includes(existing.status));
  },[selected,history,activeSubmissionPeriod]);
  useEffect(()=>{fetch(`/api/employer?employerId=${employerId}`).then(response=>response.json()).then(body=>{if(body.employer)setEmployerIdentity({name:body.employer.name,payeReference:body.employer.payeReference||"Not configured"});}).catch(()=>toast("RTI employer identity could not be loaded."));},[]);
  async function validateSubmission() {
    if(selected==="NVR")return toast("HMRC withdrew NINO Verification Requests on 3 February 2025. Complete the employee's date of birth, gender and address, leave the NINO blank, and report them on the FPS.");
    if(["FPS","Additional FPS"].includes(selected)&&!finalised.includes(submissionPeriod))return toast(`Finalise payroll period ${submissionPeriod} before generating its RTI package.`);
    if(selected==="FPS"&&draft?.status==="accepted")return toast("This FPS already has accepted HMRC evidence. Use Additional FPS for a later correction; the accepted package must remain unchanged.");
    setFiling(true);
    try {
      const response = await fetch("/api/submissions", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ employerId, type:selected, taxYear, periodNumber:activeSubmissionPeriod, noPaymentForPeriod:selected==="EPS"&&epsNoPayment, employmentAllowance:selected==="EPS"&&epsEmploymentAllowance, cisDeductionsSuffered:selected==="EPS"?epsCisSuffered:0, correctionReason:selected==="Additional FPS"?correctionReason:undefined,lateReason:(selected==="FPS"||selected==="Additional FPS")?(selected==="Additional FPS"?"H":lateReason):undefined, finalSubmission:(selected==="FPS"||selected==="Additional FPS"||selected==="EPS")&&finalSubmission,ceasedIndicator:selected==="EPS"&&ceasedIndicator,cessationDate:selected==="EPS"&&ceasedIndicator?cessationDate:undefined }) });
      const body=await response.json();
      if(!response.ok) throw new Error(body.validation?.errors?.join(" ")||body.error||"Validation failed.");
      setDraft({id:body.submission.id,status:body.submission.status,periodNumber:Number(body.payload.periodNumber||0),totals:body.payload.totals||{},recoveries:body.payload.recoveries||{},employeeCount:body.payload.employees?.length||body.payload.benefits?.length||(body.payload.employee?1:0),noPaymentForPeriod:Boolean(body.payload.noPaymentForPeriod),reportingWindow:body.payload.reportingWindow,payroll:body.payload.payroll,payload:body.payload,payloadChecksum:body.submission.payloadChecksum,createdAt:body.submission.createdAt});setPreviewOpen(true);
      await loadHistory();
      toast(body.reused?`The unchanged ${selected} package was reused; no duplicate RTI draft was created.`:`${selected} draft generated with its required declarations and validated.`,true);
    } catch(error) {
      toast(error instanceof Error?error.message:`${selected} could not be validated.`);
    } finally { setFiling(false); }
  }
  async function prepareFiling() {
    if(!draft) return toast("Generate and validate the submission first.");
    try {
      const response=await fetch("/api/submissions",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id:draft.id,employerId,declarationAccepted:declaration})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error);
      setDraft({...draft,status:body.status});setRtiResultId(Number(body.id)||draft.id);await loadHistory();toast("Submission is test-ready and selected for external-result recording. Live transmission requires the HMRC transport adapter.",true);
    } catch(error){toast(error instanceof Error?error.message:"The filing package could not be prepared.");}
  }
  async function recordRtiFilingResult(){
    const resultPackage=rtiHistory.find(item=>item.id===rtiResultId);
    const response=await fetch("/api/submissions",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"record-filing-result",id:rtiResultId,employerId,outcome:rtiOutcome,submittedAt:rtiSubmittedAt,
      acknowledgementReference:rtiAcknowledgement,responseCode:rtiResponseCode,responseMessage:rtiResponseMessage,evidenceSource:"external-import",
    })}),body=await response.json();
    if(!response.ok)return toast(body.error);
    setRtiAcknowledgement("");setRtiResponseCode("");setRtiResponseMessage("");await loadHistory();await onDataChanged();
    if(body.submission?.status==="accepted"&&resultPackage){
      const payload:any=submissionPayload(resultPackage),completedPeriod=Number(payload.periodNumber||0);
      setDraft(null);setDeclaration(false);setPreviewOpen(false);setRtiResultId(0);
      if(resultPackage.type==="EPS"){
        setEpsNoPayment(false);setEpsEmploymentAllowance(false);setEpsCisSuffered(0);setFinalSubmission(false);setCeasedIndicator(false);
        if(completedPeriod>=1&&completedPeriod<12)setEpsTaxMonth(completedPeriod+1);
      }else if(["FPS","Additional FPS"].includes(resultPackage.type)&&completedPeriod>=1&&completedPeriod<paySchedule.length){
        setSubmissionPeriod(completedPeriod+1);
        if(resultPackage.type==="Additional FPS")setSelected("FPS");
      }
      toast("External HMRC acceptance recorded. The completed RTI requirement is closed and the workspace moved to the next period. PayFlow did not transmit this return.",true);
      return;
    }
    toast(`External HMRC ${rtiOutcome} evidence recorded. The RTI period remains open because PayFlow did not receive an accepted result.`);
  }
  const totals=draft?.totals||{},recoveries=draft?.recoveries||{};
  const acceptedFpsLocked=selected==="FPS"&&draft?.status==="accepted";
  const fallbackEpsWindow=cisTaxMonthDates(epsTaxMonth,taxYear);
  const epsReviewWindow=draft?.reportingWindow||{start:fallbackEpsWindow.start,end:fallbackEpsWindow.end,deadline:fallbackEpsWindow.due};
  const rtiScheduleBase=paySchedule.map(scheduled=>{
    const periodNumber=scheduled.periodNumber,payDate={iso:scheduled.payDate,label:new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${scheduled.payDate}T00:00:00Z`))},epsDue=rtiEpsDeadline(scheduled.taxMonth,taxYear);
    const payrollFinalised=finalised.includes(periodNumber);
    const payrollMigrated=migrated.includes(periodNumber);
    const fps=rtiHistory.find(item=>item.type==="FPS"&&Number(submissionPayload(item).periodNumber)===periodNumber);
    const eps=rtiHistory.find(item=>item.type==="EPS"&&Number(submissionPayload(item).periodNumber)===scheduled.taxMonth);
    const noPaymentEps=acceptedNoPaymentEpsForMonth(scheduled.taxMonth);
    const rawFpsStatus=fps?.status||(payrollFinalised?"Not prepared":payrollMigrated?"Processed in prior system":"Awaiting payroll");
    const fpsStatus=noPaymentEps?"Not required · no-payment EPS accepted":rawFpsStatus;
    const fpsRequirementComplete=Boolean(noPaymentEps)||rawFpsStatus==="accepted"||payrollMigrated;
    const fpsNeedsAction=payrollFinalised&&!fpsRequirementComplete;
    return {...scheduled,periodNumber,payDate,epsDue,payrollFinalised,payrollMigrated,rawFpsStatus,fpsStatus,fpsRequirementComplete,fpsNeedsAction,epsSubmissionStatus:eps?.status};
  });
  const rtiSchedule=rtiScheduleBase.map(item=>{
    const monthRows=rtiScheduleBase.filter(row=>row.taxMonth===item.taxMonth);
    const noPaymentClosed=Boolean(acceptedNoPaymentEpsForMonth(item.taxMonth));
    const allFpsComplete=monthRows.length>0&&monthRows.every(row=>row.rawFpsStatus==="accepted"||row.payrollMigrated);
    const monthClosed=noPaymentClosed||allFpsComplete;
    const epsStatus=item.epsSubmissionStatus==="accepted"
      ?noPaymentClosed?"Accepted · no-payment month closed":"Accepted"
      :allFpsComplete?"Only if required · FPS complete":item.epsSubmissionStatus||(item.payrollMigrated?"Prior system":"Only if required");
    return {...item,monthClosed,epsStatus};
  });
  const unpreparedFpsPeriods=rtiSchedule.filter(item=>item.payrollFinalised&&item.fpsStatus==="Not prepared");
  const filingOptions=<div className="form-grid form-pad">
    {previewOpen&&draft&&<RtiSubmissionPreview draft={draft} onClose={()=>setPreviewOpen(false)}/>} 
    {draft&&<button type="button" className="rti-preview-open" onClick={()=>setPreviewOpen(true)}>Open detailed submission preview</button>}
    {draft&&<div className="validation-list"><div><span>✓</span><p><b>Submission summary — review before approval</b><small>{selected} · {taxYear} · {selected==="EPS"?`tax month ${draft.periodNumber}`:`payroll period ${draft.periodNumber}`}</small></p></div>{selected==="EPS"&&<><div><span>{draft.noPaymentForPeriod?"✓":"·"}</span><p><b>{draft.noPaymentForPeriod?"No payment for period declared":"No no-payment declaration"}</b><small>{formatUkDate(epsReviewWindow.start)} to {formatUkDate(epsReviewWindow.end)} · HMRC deadline {formatUkDate(epsReviewWindow.deadline)}</small></p></div><div><span>{draft.payroll?.employeePayments?"!":"✓"}</span><p><b>{draft.payroll?.employeesWithPayments||0} employees with payments</b><small>{draft.payroll?.payRecords||0} payroll records checked · PAYE {money(totals.payeTax||0)} · employee NIC {money(totals.employeeNic||0)} · employer NIC {money(totals.employerNic||0)}</small></p></div><div><span>✓</span><p><b>Other EPS values</b><small>Statutory recovery {money(recoveries.statutoryPayRecovered||0)} · CIS suffered {money(recoveries.cisDeductionsSuffered||0)} · levy {money(recoveries.apprenticeshipLevy||0)}</small></p></div></>}</div>}
    {acceptedFpsLocked&&<div className="portal-message"><b>This FPS has accepted HMRC evidence.</b> Keep it unchanged and use Additional FPS for any later correction to this period.</div>}
    {selected==="NVR"&&<div className="portal-message">HMRC withdrew the NINO Verification Request service on 3 February 2025. For an employee whose NINO is unknown, complete their legal name, date of birth, gender, home address and postcode; leave the NINO blank; then report them on the FPS. Action any NINO returned through HMRC notices.</div>}
    {selected==="Additional FPS"&&<><div className="portal-message">Use this only after HMRC has accepted an earlier FPS for this period. A validated or test-ready local package must be replaced with a normal FPS instead.</div><Field label="Correction reason" value={correctionReason} onChange={setCorrectionReason}/></>}
    {(selected==="FPS"||selected==="Additional FPS")&&<label className="field"><span>Late reporting reason</span><select value={selected==="Additional FPS"?"H":lateReason} disabled={selected==="Additional FPS"} onChange={event=>setLateReason(event.target.value)}><option value="">Not late / not applicable</option><option value="A">A · Expat notional payment</option><option value="B">B · Employment-related security</option><option value="C">C · Other notional payment</option><option value="D">D · Class 1 NIC / benefit timing</option><option value="F">F · Impractical to report on the day</option><option value="G">G · Reasonable excuse</option><option value="H">H · Correction to earlier submission</option></select></label>}
    {selected==="EPS"&&<><Check text="No employee payments were made in this tax month" checked={epsNoPayment} onChange={setEpsNoPayment}/><Check text="Claim Employment Allowance" checked={epsEmploymentAllowance} onChange={setEpsEmploymentAllowance}/><Field label="CIS deductions suffered year to date" value={String(epsCisSuffered)} type="number" onChange={value=>setEpsCisSuffered(Number(value))}/><Check text="This EPS is the final submission for the tax year" checked={finalSubmission} disabled={epsTaxMonth!==12} onChange={value=>{setFinalSubmission(value);if(value)setCeasedIndicator(false);}}/><Check text="This PAYE scheme has ceased" checked={ceasedIndicator} onChange={value=>{setCeasedIndicator(value);if(value)setFinalSubmission(false);}}/>{ceasedIndicator&&<Field label="PAYE scheme cessation date" value={cessationDate} type="date" onChange={setCessationDate}/>}</>}
    {(selected==="FPS"||selected==="Additional FPS")&&<Check text="This is the final submission for the tax year" checked={finalSubmission} disabled={submissionPeriod!==paySchedule.length} onChange={setFinalSubmission}/>}
    <div className="embedded-evidence-form"><h3>Record external RTI result</h3><p>Use this only after an accredited adapter or HMRC filing service transmitted the exact package. This imports evidence; PayFlow does not claim transmission.</p><label className="field"><span>Test-ready RTI package</span><select value={rtiResultId} onChange={event=>setRtiResultId(Number(event.target.value))}><option value={0}>Select package…</option>{rtiHistory.filter(item=>["test-ready","submitted"].includes(item.status)&&item.type!=="NVR").map(item=><option key={item.id} value={item.id}>#{item.id} · {item.type}</option>)}</select></label><label className="field"><span>HMRC result</span><select value={rtiOutcome} onChange={event=>setRtiOutcome(event.target.value)}><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label><Field label="External submission date and time" value={rtiSubmittedAt} type="datetime-local" onChange={setRtiSubmittedAt}/><Field label="Acknowledgement / correlation reference" value={rtiAcknowledgement} onChange={setRtiAcknowledgement}/><Field label="HMRC response code" value={rtiResponseCode} onChange={setRtiResponseCode}/><Field label={rtiOutcome==="rejected"?"Rejection message":"HMRC response message"} value={rtiResponseMessage} onChange={setRtiResponseMessage}/><button className="primary" disabled={!rtiResultId||rtiAcknowledgement.trim().length<6||!rtiSubmittedAt||(rtiOutcome==="rejected"&&rtiResponseMessage.trim().length<3)} onClick={recordRtiFilingResult}>Record external result</button></div>
  </div>;
  const rtiPeriodSelector=selected==="EPS"?<ModulePeriodBar title={taxYear} subtitle="RTI tax months" ariaLabel="RTI tax month" value={epsTaxMonth} items={Array.from({length:12},(_,index)=>{const value=index+1,existing=rtiHistory.find(item=>item.type==="EPS"&&Number(submissionPayload(item).periodNumber)===value),fpsComplete=allFpsCompleteForMonth(value),status=existing?.status||(fpsComplete?"Not required unless adjustments · FPS complete":"Only if required");return{value,prefix:`M${value}`,label:months[index],status,done:status==="accepted"||fpsComplete};})} onSelect={value=>{setEpsTaxMonth(value);setDraft(null);setDeclaration(false);}}/>:["FPS","Additional FPS"].includes(selected)?<ModulePeriodBar title={taxYear} subtitle={`${payrollFrequencyRule(payFrequency).label} RTI periods`} ariaLabel="RTI payroll period" value={submissionPeriod} items={rtiSchedule.map(item=>({value:item.periodNumber,prefix:`P${item.periodNumber}`,label:payFrequency==="monthly"?months[item.taxMonth-1]:new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${item.payDate.iso}T00:00:00Z`)),status:item.fpsStatus,done:item.fpsRequirementComplete,title:`Pay date ${item.payDate.label}`}))} onSelect={value=>{setSubmissionPeriod(value);setDraft(null);setDeclaration(false);}}/>:null;
  const selectionOptions={map:(_render:unknown)=>rtiPeriodSelector};
  return <div className="operational-workspace"><div className="subnav" aria-label={selected==="EPS"?"RTI tax month":"RTI payroll period"}>{selectionOptions.map(value=><button key={value} className={activeSubmissionPeriod===value?"active":""} onClick={()=>{if(selected==="EPS")setEpsTaxMonth(value);else setSubmissionPeriod(value);setDraft(null);setDeclaration(false);}}>{selected==="EPS"?`Tax month ${value}`:`Period ${value}`}</button>)}</div>{unpreparedFpsPeriods.length>0&&<div className="portal-message"><b>{unpreparedFpsPeriods.length} finalised payroll {unpreparedFpsPeriods.length===1?"period has":"periods have"} no FPS package.</b> Prepare each outstanding period ({unpreparedFpsPeriods.map(item=>item.periodNumber).join(", ")}) and record the correct late-reporting reason where required. Later periods remain available so catch-up work can be completed in the correct order.</div>}<div className="submission-cards">{submissions.map(([code,name,period,status])=><button key={code} className={selected===code?"selected":""} onClick={()=>{setSelected(code);setDraft(null);setDeclaration(false);}}><span>{code}</span><b>{name}</b><small>{period}</small><i>{status}</i></button>)}</div><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>{submissions.find(s=>s[0]===selected)?.[1]}</h2><p>{employerIdentity.name} · PAYE {employerIdentity.payeReference}</p></div><span className={`status ${draft?.status==="validated"?"":"amber"}`}>{selected==="NVR"?"HMRC suspended":draft?.status||"Not generated"}</span></div><div className="validation-list"><div><span>✓</span><p><b>Employer identifiers</b><small>Checked when the draft is generated</small></p></div><div><span>{draft?"✓":"·"}</span><p><b>Employee records</b><small>{draft?`${draft.employeeCount} records loaded from finalised payroll`:"Awaiting generation"}</small></p></div><div><span>{draft?"✓":"·"}</span><p><b>Period and year-to-date values</b><small>{draft?"Totals reconcile to immutable finalised pay runs and imported opening balances":"Awaiting reconciliation"}</small></p></div><div className="warning"><span>!</span><p><b>External gateway</b><small>Live transmission is disabled until HMRC recognition and credentials are configured</small></p></div></div>{filingOptions}{selected!=="NVR"&&<Check text="I confirm this return is complete and correct" checked={declaration} onChange={setDeclaration}/>}<div className="operation-footer"><button disabled={selected==="NVR"} onClick={()=>toast(draft?JSON.stringify(selected==="EPS"?recoveries:totals):"Generate the draft first.")}>Preview totals</button><button disabled={filing||selected==="NVR"} onClick={validateSubmission}>{filing?"Validating…":"Generate & validate"}</button><button className="primary" disabled={selected==="NVR"||filing||!draft||draft.status!=="validated"||!declaration} onClick={prepareFiling}>Prepare filing package</button></div></section><aside className="calculation-panel"><span>{selected==="EPS"?"EPS recovery and levy":"Submission totals"}</span>{selected==="EPS"?<><SummaryLine label="Statutory pay recovered" value={recoveries.statutoryPayRecovered||0}/><SummaryLine label="CIS deductions suffered" value={recoveries.cisDeductionsSuffered||0}/><SummaryLine label="Apprenticeship Levy" value={recoveries.apprenticeshipLevy||0} strong highlight/></>:<><SummaryLine label="Employees" value={draft?.employeeCount||0} format="number"/><SummaryLine label="Gross pay" value={totals.grossPay||0}/><SummaryLine label="PAYE tax" value={totals.payeTax||0}/><SummaryLine label="Employee NIC" value={totals.employeeNic||0}/><SummaryLine label="Employer NIC" value={totals.employerNic||0}/><SummaryLine label="Net pay" value={totals.netPay||0} strong highlight/></>}<small>{selected==="NVR"?"Use FPS identity matching for employees whose NINO is unknown.":selected==="EPS"?"Values are reconciled from statutory leave, CIS records and the cumulative levy calculation.":"Displayed totals are for the selected finalised payroll period; FPS year-to-date values also include audited migration openings."}</small></aside></div><section className="operation-card"><div className="card-head"><div><h2>RTI submission schedule</h2><p>FPS is due on or before each pay date processed in PayFlow. Imported periods were processed in the previous payroll system and do not create PayFlow filing tasks.</p></div><span>{finalised.length} PayFlow periods finalised · {migrated.length} imported</span></div><div className="report-table-scroll"><table><thead><tr><th>Payroll period</th><th>Payroll</th><th>Pay date / FPS deadline</th><th>FPS filing state</th><th>EPS tax month / deadline</th><th>EPS filing state</th></tr></thead><tbody>{rtiSchedule.map(item=><tr key={item.periodNumber}><td><button onClick={()=>{if(item.payrollFinalised){setSubmissionPeriod(item.periodNumber);setSelected("FPS");setDraft(null);setDeclaration(false);}}}>Period {item.periodNumber} · {payFrequency==="monthly"?months[item.taxMonth-1]:`week ${item.taxWeekNumber}`}</button></td><td><span className={`status ${item.payrollFinalised||item.payrollMigrated?"":"amber"}`}>{item.payrollFinalised?"Finalised":item.payrollMigrated?"Imported history":"Awaiting payroll"}</span></td><td>{item.payDate.label}</td><td><span className={`status ${item.fpsNeedsAction?"amber":""}`}>{item.fpsStatus}</span>{item.fpsNeedsAction&&<small>External filing evidence required</small>}</td><td>Month {item.taxMonth} · {item.epsDue.label}</td><td>{item.epsStatus}</td></tr>)}</tbody></table></div></section><section className="operation-card"><div className="card-head"><div><h2>RTI submission history</h2><p>Validated, superseded and adapter-ready packages retained for this employer. “Prepared” is not an HMRC submission.</p></div><span>{rtiHistory.length} records</span></div><table><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Due / pay date</th><th>Prepared</th><th>HMRC submitted</th><th>Correlation</th></tr></thead><tbody>{rtiHistory.slice(0,25).map(item=><tr key={item.id}><td>#{item.id}</td><td><b>{item.type}</b></td><td><span className={`status ${item.status==="invalid"?"amber":""}`}>{item.status}</span></td><td>{formatUkDate(item.dueDate)}</td><td>{formatUkDate(item.preparedAt)}</td><td>{formatUkDate(item.submittedAt,"Not transmitted")}</td><td>{item.correlationId||"Local draft"}</td></tr>)}</tbody></table></section></div>;
}

function HmrcWorkspace({ toast,onDataChanged }: { toast: (s: string) => void;onDataChanged:()=>Promise<void> }) {
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [workspace,setWorkspace]=useState<"Liabilities"|"Notices">("Liabilities");
  const [taxMonth, setTaxMonth] = useState(5);
  const [liabilitiesLoaded,setLiabilitiesLoaded]=useState(false);
  const [periods,setPeriods]=useState<Array<{periodNumber:number;status:string;payDate?:string;dueDate:string;postalDueDate:string;reconciliationStatus:string;current:Record<string,number>;ytd:Record<string,number>;payments?:any[]}>>([]);
  const [notices,setNotices]=useState<any[]>([]),[noticeEmployees,setNoticeEmployees]=useState<any[]>([]);
  const [noticeType,setNoticeType]=useState("coding"),[noticePayrollId,setNoticePayrollId]=useState(""),[noticeValue,setNoticeValue]=useState("1257L");
  const [noticeIssuedDate,setNoticeIssuedDate]=useState(new Date().toISOString().slice(0,10)),[noticeEffectiveDate,setNoticeEffectiveDate]=useState(""),[noticeMessage,setNoticeMessage]=useState("");
  const [paymentAmount,setPaymentAmount]=useState(""),[paymentDate,setPaymentDate]=useState(`${taxYearStartYear(taxYear)}-05-22`),[paymentReference,setPaymentReference]=useState(""),[paymentKind,setPaymentKind]=useState("payment"),[paymentCategory,setPaymentCategory]=useState("paye-payment");
  async function loadLiabilities(){
    const response=await fetch(`/api/hmrc-liabilities?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body=await response.json();
    if(!response.ok)throw new Error(body.error||"HMRC liabilities could not be loaded.");
    const loaded=body.periods||[];setPeriods(loaded);
    const firstOpen=loaded.find((item:any)=>item.status==="open");
    if(!noticeEffectiveDate&&firstOpen)setNoticeEffectiveDate(firstOpen.payDate||periodPayDate(firstOpen.periodNumber,taxYear).iso);
    const completed=loaded.filter((item:any)=>item.status==="finalised");if(!liabilitiesLoaded&&completed.length){const latest=Math.max(...completed.map((item:any)=>item.periodNumber)),period=loaded.find((item:any)=>item.periodNumber===latest);setTaxMonth(latest);if(period?.dueDate)setPaymentDate(period.dueDate);}setLiabilitiesLoaded(true);
  }
  useEffect(()=>{loadLiabilities().catch(()=>toast("HMRC liabilities could not be loaded."));},[]);
  async function loadNotices(){
    const [noticeResponse,employeeResponse]=await Promise.all([fetch(`/api/hmrc-notices?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),fetch(`/api/employees?employerId=${employerId}`)]);
    const noticeBody=await noticeResponse.json(),employeeBody=await employeeResponse.json();
    if(!noticeResponse.ok)throw new Error(noticeBody.error||"HMRC notices could not be loaded.");
    setNotices(noticeBody.notices||[]);setNoticeEmployees(Array.isArray(employeeBody)?employeeBody:[]);
    if(!noticePayrollId&&employeeBody?.[0]?.payrollId)setNoticePayrollId(employeeBody[0].payrollId);
  }
  useEffect(()=>{loadNotices().catch(error=>toast(error instanceof Error?error.message:"HMRC notices could not be loaded."));},[]);
  const selected=periods.find(p=>p.periodNumber===taxMonth);
  const current=selected?.current||{}, ytd=selected?.ytd||{};
  async function exportRecord(format:"csv"|"html"){
    const response=await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,type:"p32",format,periodNumber:taxMonth})});
    if(!response.ok){const body=await response.json();return toast(body.error||"Employer payment record could not be generated.");}
    const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=`p32-${taxYear.replace("/","-")}.${format}`;anchor.click();URL.revokeObjectURL(url);
    toast(`${format==="html"?"Printable P32":"P32 CSV"} generated from finalised payroll.`);
  }
  function downloadNotices(){
    const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
    const headings=["Notice ID","Type","Identifier","Payroll ID","Employee","Issued","Effective","Instruction","Status","Applied","Ignored"];
    const rows=notices.map(item=>[
      item.id,item.type,item.noticeIdentifier,item.payrollId||"",item.payrollId?`${item.firstName||""} ${item.lastName||""}`.trim():"Employer",
      formatUkDate(item.issuedDate,""),formatUkDate(item.effectiveDate,""),item.taxCode||item.niNumber||item.loanAction||item.message||"",item.status,formatUkDateTime(item.appliedAt,""),formatUkDateTime(item.ignoredAt,""),
    ]);
    const csv=[headings,...rows].map(row=>row.map(cell).join(",")).join("\r\n");
    downloadClientBlob(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}),`hmrc-notices-${taxYear.replace("/","-")}.csv`);
    toast(`${rows.length} HMRC notice${rows.length===1?"":"s"} exported with lifecycle history.`);
  }
  async function createNotice(){
    const payload:any={employerId,type:noticeType,payrollId:noticeType==="generic"?undefined:noticePayrollId,taxYear,issuedDate:noticeIssuedDate,effectiveDate:noticeEffectiveDate,message:noticeMessage};
    if(noticeType==="coding"){payload.taxCode=noticeValue;payload.week1Month1=/W1|M1/i.test(noticeValue);payload.taxCode=noticeValue.replace(/\s*(W1|M1)$/i,"");}
    if(noticeType==="nino")payload.niNumber=noticeValue;
    if(noticeType==="student-loan"){payload.loanAction=noticeValue.startsWith("stop-")?noticeValue:"start";payload.studentLoanPlan=["1","2","4","5"].includes(noticeValue)?noticeValue:null;payload.postgraduateLoan=noticeValue==="postgraduate";if(noticeValue.startsWith("stop-")&&!payload.message)payload.message=noticeValue==="stop-student"?"Stop student loan":noticeValue==="stop-postgraduate"?"Stop postgraduate loan":"Stop all loan deductions";}
    const response=await fetch("/api/hmrc-notices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}),body=await response.json();
    if(!response.ok)return toast(body.error||"Notice could not be saved.");await loadNotices();toast("HMRC notice saved for review.");
  }
  async function updateNotice(id:number,action:"apply"|"ignore"){
    const response=await fetch("/api/hmrc-notices",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id,action})}),body=await response.json();
    if(!response.ok)return toast(body.error||"Notice could not be updated.");await loadNotices();if(action==="apply")await onDataChanged();toast(action==="apply"?"Notice applied to the employee record.":"Notice retained in history as ignored.");
  }
  async function recordPayment(){
    const response=await fetch("/api/hmrc-payments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,taxMonth,paymentDate,kind:paymentKind,category:paymentCategory,amount:Number(paymentAmount),reference:paymentReference,method:paymentKind==="payment"?"bank-transfer":"journal"})}),body=await response.json();
    if(!response.ok)return toast(body.error||"HMRC payment could not be recorded.");setPaymentAmount("");setPaymentReference("");await loadLiabilities();toast("HMRC payment or adjustment recorded and reconciled.");
  }
  async function voidPayment(id:number){
    const reason=window.prompt("Why is this HMRC payment or adjustment being voided?","Incorrect payment record")?.trim();if(!reason)return;
    const response=await fetch("/api/hmrc-payments",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id,reason})}),body=await response.json();
    if(!response.ok)return toast(body.error||"HMRC payment could not be voided.");await loadLiabilities();toast("HMRC payment voided with its audit history retained.");
  }
  const noticeValueOptions=noticeType==="student-loan"?<select value={noticeValue} onChange={event=>setNoticeValue(event.target.value)}><option value="1">Start plan 1</option><option value="2">Start plan 2</option><option value="4">Start plan 4</option><option value="5">Start plan 5</option><option value="postgraduate">Start postgraduate loan</option><option value="stop-student">Stop student loan only</option><option value="stop-postgraduate">Stop postgraduate loan only</option><option value="stop-all">Stop all loan deductions</option></select>:<input value={noticeValue} onChange={event=>setNoticeValue(event.target.value)} placeholder={noticeType==="coding"?"1257L or BR M1":noticeType==="nino"?"QQ123456C":"Reference or message"}/>;
  if(workspace==="Notices")return <div className="operational-workspace"><div className="subnav"><button onClick={()=>setWorkspace("Liabilities")}>Liabilities</button><button className="active">HMRC notices</button></div><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>HMRC notice inbox and history</h2><p>Review notices before controlled application to employee records.</p></div><div className="inline-actions"><span>{notices.filter(item=>item.status==="new").length} new</span><button onClick={downloadNotices}>Download notices CSV</button></div></div>{notices.length?<table><thead><tr><th>Notice</th><th>Employee</th><th>Issued</th><th>Effective</th><th>Instruction</th><th>Status</th><th>Action</th></tr></thead><tbody>{notices.map(item=><tr key={item.id}><td><b>{item.type}</b><small>{item.noticeIdentifier}</small></td><td>{item.payrollId?`${item.firstName} ${item.lastName}`:"Employer"}</td><td>{formatUkDate(item.issuedDate)}</td><td>{formatUkDate(item.effectiveDate)}</td><td>{item.taxCode||item.niNumber||(item.loanAction==="stop"?"Stop loans":item.postgraduateLoan?"Start postgraduate":item.studentLoanPlan?`Start plan ${item.studentLoanPlan}`:item.message)||"Review notice"}</td><td>{item.status}</td><td>{item.status==="new"?<><button onClick={()=>updateNotice(item.id,"apply")}>Apply</button><button onClick={()=>updateNotice(item.id,"ignore")}>Ignore</button></>:formatUkDateTime(item.appliedAt||item.ignoredAt,"Recorded")}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No HMRC notices have been recorded.</p></div>}</section><aside className="calculation-panel"><span>Record notice</span><label className="field"><span>Notice type</span><select value={noticeType} onChange={event=>{setNoticeType(event.target.value);setNoticeValue(event.target.value==="coding"?"1257L":event.target.value==="student-loan"?"2":"");}}><option value="coding">Tax code</option><option value="student-loan">Student loan</option><option value="nino">NINO</option><option value="generic">Generic notice</option></select></label>{noticeType!=="generic"&&<label className="field"><span>Employee</span><select value={noticePayrollId} onChange={event=>setNoticePayrollId(event.target.value)}>{noticeEmployees.map(employee=><option key={employee.id} value={employee.payrollId}>{employee.firstName} {employee.lastName}</option>)}</select></label>}{noticeType!=="generic"&&<label className="field"><span>Instruction</span>{noticeValueOptions}</label>}<Field label="Issued date" value={noticeIssuedDate} type="date" onChange={setNoticeIssuedDate}/><Field label="Effective date" value={noticeEffectiveDate} type="date" onChange={setNoticeEffectiveDate}/><Field label={noticeType==="generic"?"Notice message":"Message / reference"} value={noticeMessage} onChange={setNoticeMessage}/><button className="primary" disabled={!noticeIssuedDate||!noticeEffectiveDate||(noticeType==="generic"?noticeMessage.trim().length<3:!noticePayrollId)} onClick={createNotice}>Save for review</button><small>Automatic retrieval from HMRC is disabled until recognized transport credentials and fraud-prevention headers are configured.</small></aside></div></div>;
  const hmrcMonthFinalised=selected?.status==="finalised",hmrcMonthMigrated=selected?.status==="migrated";
  return <div className="operational-workspace"><div className="subnav"><button className="active">Liabilities</button><button onClick={()=>setWorkspace("Notices")}>HMRC notices</button>{[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><button key={n} className={taxMonth===n?"active":""} onClick={()=>{setTaxMonth(n);const period=periods.find(item=>item.periodNumber===n);if(period?.dueDate)setPaymentDate(period.dueDate);}}>Month {n}</button>)}</div><div className="operation-grid"><section className="operation-card"><div className="card-head"><div><h2>P32 Employer Payment Record</h2><p>Tax month {taxMonth} · Electronic payment due {formatUkDate(selected?.dueDate)} · Postal deadline {formatUkDate(selected?.postalDueDate)}</p></div><span className={`status ${selected?.reconciliationStatus==="reconciled"||hmrcMonthMigrated?"":"amber"}`}>{selected?.reconciliationStatus?.replaceAll("-"," ")||"No payroll"}</span></div>{hmrcMonthMigrated?<div className="portal-message"><b>Processed in the previous payroll system.</b><br/>Opening balances carry employee year-to-date figures into PayFlow, but prior-system HMRC liabilities, payments and P32 records are not recreated here.</div>:!hmrcMonthFinalised&&<div className="portal-message">Finalise this payroll tax month before exporting its P32 or recording HMRC payments and adjustments.</div>}<table><thead><tr><th>Liability</th><th>This month</th><th>Year to date</th></tr></thead><tbody><tr><td><b>PAYE income tax</b></td><td>{money(current.payeTax||0)}</td><td>{money(ytd.payeTax||0)}</td></tr><tr><td><b>Employee National Insurance</b></td><td>{money(current.employeeNic||0)}</td><td>{money(ytd.employeeNic||0)}</td></tr><tr><td><b>Employer National Insurance</b></td><td>{money(current.employerNic||0)}</td><td>{money(ytd.employerNic||0)}</td></tr><tr><td><b>Student and postgraduate loans</b></td><td>{money(current.studentLoans||0)}</td><td>{money(ytd.studentLoans||0)}</td></tr><tr><td><b>Apprenticeship Levy</b><small>Pay bill {money(current.payBill||0)}</small></td><td>{money(current.apprenticeshipLevy||0)}</td><td>{money(ytd.apprenticeshipLevy||0)}</td></tr><tr><td><b>Statutory payment recovery</b></td><td>{deductionMoney(current.statutoryRecovery||0)}</td><td>{deductionMoney(ytd.statutoryRecovery||0)}</td></tr><tr><td><b>Employment Allowance</b></td><td>{deductionMoney(current.employmentAllowance||0)}</td><td>{deductionMoney(ytd.employmentAllowance||0)}</td></tr><tr><td><b>Payments and credits recorded</b></td><td>{deductionMoney(current.settled||0)}</td><td>—</td></tr><tr><td><b>Unpaid / (overpaid)</b></td><td><b>{money(current.balance??current.amountDue??0)}</b></td><td>—</td></tr></tbody></table>{selected?.payments?.length?<div className="validation-list">{selected.payments.map(payment=><div key={payment.id}><span>{payment.status==="void"?"×":"✓"}</span><p><b>{String(payment.category||payment.kind).replaceAll("-"," ")} · {money(payment.amount)}</b><small>{formatUkDate(payment.paymentDate)} · {payment.reference} · {payment.status}</small></p>{payment.status!=="void"&&<button onClick={()=>voidPayment(payment.id)}>Void</button>}</div>)}</div>:<div className="empty-workflow"><p>{hmrcMonthMigrated?"No PayFlow HMRC records are expected for this imported month.":"No HMRC payments or adjustments are recorded for this tax month."}</p></div>}<div className="operation-footer"><button disabled={!hmrcMonthFinalised} onClick={()=>exportRecord("html")}>Printable P32</button><button disabled={!hmrcMonthFinalised} onClick={()=>exportRecord("csv")}>Export P32 CSV</button></div></section><aside className="calculation-panel"><span>Record payment or adjustment</span><label className="field"><span>Record type</span><select value={paymentKind} onChange={event=>{const kind=event.target.value;setPaymentKind(kind);setPaymentCategory(kind==="payment"?"paye-payment":kind==="credit"?"tax-refund-funding":"class1a-adjustment");}}><option value="payment">Payment to HMRC</option><option value="credit">HMRC credit</option><option value="charge">Additional charge</option></select></label><label className="field"><span>Funding category</span><select value={paymentCategory} onChange={event=>setPaymentCategory(event.target.value)}>{paymentKind==="payment"?<option value="paye-payment">PAYE / NIC payment</option>:paymentKind==="credit"?<><option value="tax-refund-funding">Tax refund funding</option><option value="previous-overpayment">Previous HMRC overpayment</option><option value="other-credit">Other HMRC credit</option></>:<><option value="class1a-adjustment">Class 1A NIC adjustment</option><option value="other-charge">Other HMRC charge</option></>}</select></label><Field label="Amount" value={paymentAmount} type="number" onChange={setPaymentAmount}/><Field label="Date" value={paymentDate} type="date" onChange={setPaymentDate}/><Field label="Reference" value={paymentReference} onChange={setPaymentReference}/><button className="primary" disabled={!hmrcMonthFinalised||Number(paymentAmount)<=0||paymentReference.trim().length<3} onClick={recordPayment}>Record and reconcile</button><div className="liability-total"><strong>{money(current.balance??current.amountDue??0)}</strong><small>Outstanding balance<br/>Electronic due {formatUkDate(selected?.dueDate)}</small></div><SummaryLine label="Year-to-date liability" value={ytd.amountDue||0}/><small>Bank confirmation and HMRC account matching require banking/HMRC integrations. These records provide the payroll-side reconciliation.</small></aside></div></div>;
}

function PensionsWorkspace({ toast,employees,finalised,onDataChanged }: { toast: (s: string,success?:boolean) => void;employees:Employee[];finalised:number[];onDataChanged:()=>Promise<void> }) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const [section, setSection] = useState("Assessment");
  const [provider,setProvider]=useState("NEST"),[schemeName,setSchemeName]=useState("Workplace pension"),[employeeRate,setEmployeeRate]=useState(5),[employerRate,setEmployerRate]=useState(3),[earningsBasis,setEarningsBasis]=useState<"qualifying"|"gross">("qualifying"),[taxRelief,setTaxRelief]=useState<"relief-at-source"|"net-pay">("relief-at-source");
  const [schemeId,setSchemeId]=useState(0),[schemeEffectiveDate,setSchemeEffectiveDate]=useState(`${taxYearStartYear(taxYear)}-04-06`);
  const [dutiesStartDate,setDutiesStartDate]=useState(""),[nextReenrolmentDate,setNextReenrolmentDate]=useState(""),[declarationDueDate,setDeclarationDueDate]=useState(""),[contributionDueDay,setContributionDueDay]=useState(22);
  const [automaticEnrolmentScheme,setAutomaticEnrolmentScheme]=useState(true),[certificationDate,setCertificationDate]=useState(`${taxYearStartYear(taxYear)}-04-06`),[declarationStatus,setDeclarationStatus]=useState("not-filed");
  const [declarationFiledDate,setDeclarationFiledDate]=useState(""),[declarationReference,setDeclarationReference]=useState(""),[declarationConfirmed,setDeclarationConfirmed]=useState(false);
  const [pensionData,setPensionData]=useState<{schemes:any[];memberships:any[];contributions:any[];events:any[];filingHistory:any[]}>({schemes:[],memberships:[],contributions:[],events:[],filingHistory:[]});
  const [contributionPeriod,setContributionPeriod]=useState(0);
  const [optOutNoticeDate,setOptOutNoticeDate]=useState(""),[optOutNoticeValid,setOptOutNoticeValid]=useState(false),[lifecycleDate,setLifecycleDate]=useState(""),[postponementNoticeDate,setPostponementNoticeDate]=useState("");
  async function loadPensions(){
    const response=await fetch(`/api/pensions?employerId=${employerId}`),body=await response.json();
    if(!response.ok)throw new Error(body.error||"Pension records could not be loaded.");
    setPensionData({schemes:body.schemes||[],memberships:body.memberships||[],contributions:body.contributions||[],events:body.events||[],filingHistory:body.filingHistory||[]});
    const active=(body.schemes||[]).find((item:any)=>item.status==="active");
    if(active){setSchemeId(active.id);setProvider(active.provider);setSchemeName(active.schemeName);setEmployeeRate(active.employeeRate);setEmployerRate(active.employerRate);setEarningsBasis(active.earningsBasis);setTaxRelief(active.taxRelief);setDutiesStartDate(active.dutiesStartDate||"");setNextReenrolmentDate(active.nextReenrolmentDate||"");setDeclarationDueDate(active.declarationDueDate||"");setDeclarationStatus(active.declarationStatus||"not-filed");setContributionDueDay(active.contributionDueDay||22);setAutomaticEnrolmentScheme(active.automaticEnrolmentScheme!==false);setCertificationDate(active.certificationDate||"");}
  }
  useEffect(()=>{loadPensions().catch(error=>toast(error instanceof Error?error.message:"Pension records could not be loaded."));},[]);
  async function saveScheme() {
    try {
      const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save-scheme",employerId,schemeId:schemeId||undefined,effectiveDate:schemeEffectiveDate,provider,schemeName,employeeRate,employerRate,earningsBasis,taxRelief,automaticEnrolmentScheme,certificationDate,dutiesStartDate,nextReenrolmentDate,declarationDueDate,contributionDueDay})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);await loadPensions();await onDataChanged();toast(body.transferredMemberships?`${body.schemeName} activated; ${body.transferredMemberships} membership(s) transferred.`:`${body.schemeName} saved as the active payroll scheme.`);
    } catch(error){toast(error instanceof Error?error.message:"Pension scheme could not be saved.");}
  }
  async function recordDeclaration(){
    try{
      const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"record-declaration",employerId,schemeId,declarationDate:declarationFiledDate,reference:declarationReference,confirmed:declarationConfirmed})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);setDeclarationConfirmed(false);await loadPensions();toast(`External declaration acknowledgement ${body.reference} recorded with checksum ${body.payloadChecksum.slice(0,12)}…`);
    }catch(error){toast(error instanceof Error?error.message:"Pension declaration evidence could not be recorded.",false);}
  }
  const [rows,setRows]=useState<string[][]>([]);
  const latestFinalisedPensionPeriod=latestContiguousPeriod(finalised,paySchedule.length);
  const assessmentPeriod=contributionPeriod||latestFinalisedPensionPeriod,assessmentDate=(paySchedule.find(item=>item.periodNumber===(assessmentPeriod||1))||paySchedule[0]).payDate;
  const contributionPeriods=[...new Set(pensionData.contributions.filter(item=>Number(item.totalContribution)!==0).map(item=>Number(item.periodNumber)))].sort((a,b)=>a-b);
  const preparedContributionPeriods=new Set(pensionData.filingHistory.filter(item=>item.type==="PENSION-PROVIDER"&&["prepared","submitted","accepted"].includes(item.status)).map(item=>Number(item.periodNumber)));
  const pendingContributionPeriods=contributionPeriods.filter(value=>!preparedContributionPeriods.has(value));
  useEffect(()=>{
    const preferred=pendingContributionPeriods.at(-1)||contributionPeriods.at(-1)||latestFinalisedPensionPeriod||0;
    if(!finalised.includes(contributionPeriod)&&preferred)setContributionPeriod(preferred);
  },[pensionData.contributions,pensionData.filingHistory,latestFinalisedPensionPeriod,finalised,contributionPeriod]);
  const pensionPeriodSections=new Set(["Assessment","Contributions","Submissions"]);
  const pensionPeriodSelector=pensionPeriodSections.has(section)?<ModulePeriodBar title={taxYear} subtitle={`${payrollFrequencyRule(payFrequency).label} pension periods`} ariaLabel="Pension payroll period" value={assessmentPeriod} items={paySchedule.map(item=>{const finalisedPeriod=finalised.includes(item.periodNumber),funded=contributionPeriods.includes(item.periodNumber),prepared=preparedContributionPeriods.has(item.periodNumber);return{value:item.periodNumber,prefix:`P${item.periodNumber}`,label:payFrequency==="monthly"?months[item.taxMonth-1]:new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${item.payDate}T00:00:00Z`)),status:prepared?"Prepared":funded?"Ready":finalisedPeriod?"Finalised":"—",disabled:!finalisedPeriod,done:prepared,title:`Pay date ${formatUkDate(item.payDate)}`};})} onSelect={setContributionPeriod}/>:null;
  const selectedPensionContributions=pensionData.contributions.filter(row=>Number(row.periodNumber)===assessmentPeriod);
  const assessmentDateLabel=new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${assessmentDate}T00:00:00Z`));
  async function runAssessment() {
    if(!assessmentPeriod)return toast("Finalise a payroll period before running pension assessment.");
    const assessable=employees.filter(item=>item.dateOfBirth&&item.payrollId);
    if(!assessable.length)return toast("Add employee dates of birth before running pension assessment.");
    try {
      const outcomes=await Promise.all(assessable.map(async person=>{
        const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:person.payrollId,taxYear,periodNumber:assessmentPeriod,assessmentDate})});
        const body=await response.json();
        return response.ok?{person,body,error:""}:{person,body:null,error:String(body.error||"Assessment failed")};
      }));
      const successful=outcomes.filter(result=>result.body),failed=outcomes.filter(result=>result.error);
      setRows(successful.map(({person,body})=>{const birth=new Date(`${person.dateOfBirth}T00:00:00Z`),at=new Date(`${assessmentDate}T00:00:00Z`),age=at.getUTCFullYear()-birth.getUTCFullYear()-(at.getUTCMonth()<birth.getUTCMonth()||(at.getUTCMonth()===birth.getUTCMonth()&&at.getUTCDate()<birth.getUTCDate())?1:0);return [person.name,String(age),money(body.assessment.qualifyingEarnings),body.assessment.category.replaceAll("-"," "),body.membership.membershipStatus];}));
      await loadPensions();
      await onDataChanged();
      if(failed.length)toast(`${successful.length} assessment(s) saved; ${failed.length} could not be processed. ${failed[0].person.name}: ${failed[0].error}`,false);
      else toast("Worker assessment saved; eligible jobholders were enrolled.");
    } catch(error) { toast(error instanceof Error?error.message:"Pension assessment could not be saved."); }
  }
  async function membershipAction(payrollId:string,action:string){
    if(action==="opt-in"&&pensionData.memberships.find(member=>member.payrollId===payrollId)?.assessmentStatus==="entitled-worker")action="join";
    const postponementEnd=addCalendarMonths(assessmentDate,3);
    try{
      const actionDate=action==="postpone"?assessmentDate:action==="opt-out"?optOutNoticeDate:lifecycleDate;
      const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,employerId,payrollId,taxYear,periodNumber:assessmentPeriod,assessmentDate:actionDate,optOutNoticeDate,optOutNoticeValid,postponementEnd,postponementNoticeDate})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);await loadPensions();await onDataChanged();toast(`Membership updated to ${body.membership.membershipStatus}.`);
    }catch(error){toast(error instanceof Error?error.message:"Membership could not be updated.");}
  }
  function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);}
  async function downloadContributions(){
    const targetPeriod=contributionPeriod||assessmentPeriod;
    if(!targetPeriod)return toast("Finalise a period before creating a contribution file.");
    const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"export-contributions",employerId,taxYear,periodNumber:targetPeriod})});
    if(!response.ok){const body=await response.json();return toast(body.error||"Contribution file could not be generated.");}
    const contributionFile=await response.blob();
    downloadBlob(contributionFile,`pension-contributions-period-${targetPeriod}.csv`);
    await loadPensions();await onDataChanged();
    toast(`Period ${targetPeriod} provider contribution file generated.`);
  }
  async function downloadLetter(payrollId:string,letterType:string){
    const response=await fetch("/api/pensions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"letter",employerId,payrollId,letterType})});
    if(!response.ok){const body=await response.json();return toast(body.error||"Pension letter could not be generated.");}
    const submissionId=response.headers.get("x-payflow-submission-id");
    downloadBlob(await response.blob(),`${letterType}-${payrollId}.html`);await loadPensions();toast(`Pension communication${submissionId?` #${submissionId}`:""} generated and recorded from the stored membership.`);
  }
  function exportAssessment(){
    const content=[["Employee","Age","Qualifying earnings","Category","Membership"],...rows].map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n");
    downloadBlob(new Blob(["\uFEFF",content],{type:"text/csv;charset=utf-8"}),"pension-assessment.csv");toast("Pension assessment report exported.");
  }
  const navigation=<><div className="subnav">{["Assessment","Memberships","Contributions","Schemes","Letters","History","Submissions"].map(v=><button key={v} className={section===v?"active":""} onClick={()=>setSection(v)}>{v}</button>)}</div>{pensionPeriodSelector}{section==="Assessment"&&<section className="operation-card"><div className="card-head"><div><h2>Automatic-enrolment compliance</h2><p>Duties, re-enrolment, declaration and contribution deadlines.</p></div><span className={`status ${declarationStatus==="overdue"?"amber":""}`}>{declarationStatus.replaceAll("-"," ")}</span></div><div className="form-grid form-pad"><Check text="Scheme is certified for automatic enrolment" checked={automaticEnrolmentScheme} onChange={setAutomaticEnrolmentScheme}/><Field label="Certification date" value={certificationDate} type="date" onChange={setCertificationDate}/><Field label="Duties start date" value={dutiesStartDate} type="date" onChange={setDutiesStartDate}/><Field label="Next re-enrolment date" value={nextReenrolmentDate} type="date" onChange={setNextReenrolmentDate}/><Field label="Re-declaration due date" value={declarationDueDate} type="date" onChange={setDeclarationDueDate}/><Field label="Contribution due day" value={String(contributionDueDay)} type="number" onChange={value=>setContributionDueDay(Number(value))}/></div><div className="operation-footer"><button className="primary" onClick={saveScheme}>Save scheme compliance</button></div><div className="form-grid form-pad"><Field label="External filing date" value={declarationFiledDate} type="date" onChange={setDeclarationFiledDate}/><Field label="Acknowledgement reference" value={declarationReference} onChange={setDeclarationReference}/><Check text="I checked the external declaration acknowledgement" checked={declarationConfirmed} onChange={setDeclarationConfirmed}/></div><div className="operation-footer"><small>PayFlow records evidence only; declaration transmission remains external.</small><button disabled={!schemeId||!declarationFiledDate||declarationReference.trim().length<3||!declarationConfirmed} onClick={recordDeclaration}>Record external declaration</button></div></section>}{section==="Memberships"&&<section className="operation-card"><div className="card-head"><div><h2>Membership notice dates</h2><p>Postponement communications must be issued within six weeks and one day.</p></div></div><div className="form-grid form-pad"><Field label="Postponement notice issued" value={postponementNoticeDate} type="date" onChange={setPostponementNoticeDate}/></div></section>}</>;
  if(section==="History")return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Membership lifecycle history</h2><p>Immutable assessment, enrolment, postponement, opt-out, cessation and re-enrolment events.</p></div><span>{pensionData.events.length} events</span></div>{pensionData.events.length?<table><thead><tr><th>Date</th><th>Employee</th><th>Event</th><th>Previous</th><th>New status</th></tr></thead><tbody>{pensionData.events.slice().reverse().map(event=><tr key={event.id}><td>{formatUkDate(event.effectiveDate)}</td><td>{employees.find(employee=>employee.id===event.employeeId)?.name||`#${event.employeeId}`}</td><td>{event.eventType}</td><td>{event.previousStatus||"—"}</td><td>{event.newStatus}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No pension membership events have been recorded yet.</p></div>}</section></div>;
  if(section==="Schemes")return <div className="operational-workspace"><div className="subnav">{["Assessment","Memberships","Contributions","Schemes","Letters","History","Submissions"].map(v=><button key={v} className={section===v?"active":""} onClick={()=>setSection(v)}>{v}</button>)}</div><section className="operation-card"><div className="card-head"><div><h2>Workplace pension scheme</h2><p>{schemeId?"The active scheme controls contributions in payroll.":"Create and activate a scheme before assessing or enrolling workers."}</p></div><span className={`status ${schemeId?"":"amber"}`}>{schemeId?"Active":"Not configured"}</span></div><div className="form-grid form-pad"><Field label="Provider" value={provider} onChange={setProvider}/><Field label="Scheme name" value={schemeName} onChange={setSchemeName}/><Field label="Employee contribution %" value={String(employeeRate)} type="number" onChange={v=>setEmployeeRate(+v)}/><Field label="Employer contribution %" value={String(employerRate)} type="number" onChange={v=>setEmployerRate(+v)}/><label className="field"><span>Earnings basis</span><select value={earningsBasis} onChange={e=>setEarningsBasis(e.target.value as "qualifying"|"gross")}><option value="qualifying">Qualifying earnings</option><option value="gross">Gross pensionable earnings</option></select></label><label className="field"><span>Tax relief method</span><select value={taxRelief} onChange={e=>setTaxRelief(e.target.value as "relief-at-source"|"net-pay")}><option value="relief-at-source">Relief at source</option><option value="net-pay">Net pay arrangement</option></select></label><Field label="Scheme effective / switch date" value={schemeEffectiveDate} type="date" onChange={setSchemeEffectiveDate}/></div><div className="operation-footer">{Boolean(schemeId)&&<button onClick={()=>{setSchemeId(0);setProvider("");setSchemeName("");}}>Create replacement scheme</button>}<button className="primary" onClick={saveScheme}>{schemeId?"Update active scheme":"Create and activate scheme"}</button></div></section></div>;
  if(section==="Memberships")return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Pension memberships</h2><p>Assessment outcome, membership state and refund position from stored records.</p></div><span>{pensionData.memberships.length} records</span></div><div className="form-grid form-pad"><Field label="Opt-out notice received" value={optOutNoticeDate} type="date" onChange={setOptOutNoticeDate}/><Field label="Membership action effective date" value={lifecycleDate} type="date" onChange={setLifecycleDate}/><Check text="Provider-issued opt-out notice is valid and personally submitted" checked={optOutNoticeValid} onChange={setOptOutNoticeValid}/></div>{pensionData.memberships.length?<table><thead><tr><th>Employee</th><th>Assessment</th><th>Status</th><th>Effective date</th><th>Refund due</th><th>Actions</th></tr></thead><tbody>{pensionData.memberships.map(member=>{const active=member.membershipStatus==="active",canActivate=!active,canPostpone=!active&&member.assessmentStatus==="eligible-jobholder",canReenrol=["opted-out","ceased","not-enrolled"].includes(member.membershipStatus);return <tr key={member.id}><td><b>{member.employeeName} {member.employeeLastName}</b><small>{member.payrollId}</small></td><td>{String(member.assessmentStatus).replaceAll("-"," ")}</td><td>{member.membershipStatus}</td><td>{member.enrolmentDate||member.postponementEnd||member.optOutDate||"—"}</td><td>{money((member.employeeRefundDue||0)+(member.employerRefundDue||0))}</td><td><button disabled={!canActivate||!lifecycleDate} onClick={()=>membershipAction(member.payrollId,"opt-in")}>Activate</button><button disabled={!canPostpone||!postponementNoticeDate} title={active?"Active memberships cannot be postponed":undefined} onClick={()=>membershipAction(member.payrollId,"postpone")}>Postpone</button><button disabled={!optOutNoticeDate||!optOutNoticeValid||!active} onClick={()=>membershipAction(member.payrollId,"opt-out")}>Opt out</button><button disabled={!active||!lifecycleDate} onClick={()=>membershipAction(member.payrollId,"cease")}>Cease</button><button disabled={!canReenrol||!lifecycleDate} onClick={()=>membershipAction(member.payrollId,"re-enrol")}>Re-enrol</button></td></tr>})}</tbody></table>:<div className="empty-workflow"><p>Run automatic enrolment assessment to create membership records.</p></div>}</section></div>;
  if(section==="Contributions")return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Finalised pension contributions</h2><p>Net member deduction, provider tax relief and gross contribution come from immutable finalised evidence.</p></div><button onClick={downloadContributions}>Export period {assessmentPeriod||"—"}</button></div>{selectedPensionContributions.length?<table><thead><tr><th>Period</th><th>Employee</th><th>Scheme</th><th>Pensionable pay</th><th>Method</th><th>Member deducted</th><th>Tax relief</th><th>Gross member</th><th>Employer</th><th>Total funded</th></tr></thead><tbody>{selectedPensionContributions.map(row=><tr key={row.payRunId}><td>{row.periodNumber}</td><td><b>{row.employeeName}</b></td><td>{row.schemeName||"Not recorded"}</td><td>{money(row.pensionablePay)}</td><td>{row.taxReliefMethod}</td><td>{money(row.employeeContribution)}</td><td>{money(row.employeeTaxRelief)}</td><td>{money(row.employeeGrossContribution)}</td><td>{money(row.employerContribution)}</td><td><b>{money(row.totalContribution)}</b></td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No pension contributions exist in finalised payroll.</p></div>}</section></div>;
  if(section==="Letters")return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Employee pension communications</h2><p>Create printable communications from each employee’s stored membership. Only letters valid for the current lifecycle state are available.</p></div></div>{pensionData.memberships.length?<table><thead><tr><th>Employee</th><th>Current status</th><th>Available letters</th></tr></thead><tbody>{pensionData.memberships.map(member=>{const active=member.membershipStatus==="active";return <tr key={member.id}><td><b>{member.employeeName} {member.employeeLastName}</b></td><td>{member.membershipStatus}</td><td><button disabled={!active} onClick={()=>downloadLetter(member.payrollId,"enrolment")}>Enrolment</button><button disabled={member.membershipStatus!=="postponed"} onClick={()=>downloadLetter(member.payrollId,"postponement")}>Postponement</button><button disabled={!active} onClick={()=>downloadLetter(member.payrollId,"opt-in")}>Opt-in</button><button disabled={member.membershipStatus!=="opted-out"} onClick={()=>downloadLetter(member.payrollId,"opt-out")}>Opt-out</button><button disabled={member.membershipStatus!=="ceased"} onClick={()=>downloadLetter(member.payrollId,"cessation")}>Cessation</button><button disabled={!active} onClick={()=>downloadLetter(member.payrollId,"re-enrolment")}>Re-enrolment</button></td></tr>})}</tbody></table>:<div className="empty-workflow"><p>Assess workers before generating statutory communications.</p></div>}</section></div>;
  if(section==="Submissions")return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Provider submission preparation</h2><p>Generate a source-bound contribution file for each finalised period with pension funding.</p></div><span className={`status ${pendingContributionPeriods.length?"amber":""}`}>{pendingContributionPeriods.length?`${pendingContributionPeriods.length} ready`:"Up to date"}</span></div>{contributionPeriods.length>0&&<div className="form-grid form-pad"><label className="field"><span>Contribution period</span><select aria-label="Contribution period" value={contributionPeriod||contributionPeriods.at(-1)} onChange={event=>setContributionPeriod(Number(event.target.value))}>{contributionPeriods.map(value=><option key={value} value={value}>Period {value}{preparedContributionPeriods.has(value)?" · provider file prepared":" · ready for submission"}</option>)}</select></label></div>}<div className="validation-list"><div><span>✓</span><p><b>Payroll source</b><small>Finalised period {contributionPeriod||assessmentPeriod||"—"} stored contribution records</small></p></div><div><span>✓</span><p><b>Provider-neutral CSV</b><small>Payroll ID, NINO, pensionable earnings and contribution values</small></p></div><div className="warning"><span>!</span><p><b>Provider transmission</b><small>Prepared means downloaded only. NEST and other provider APIs require provider credentials and conformance outside this application.</small></p></div></div><div className="operation-footer"><button className="primary" disabled={!contributionPeriods.length} onClick={downloadContributions}>Generate provider file for period {contributionPeriod||assessmentPeriod||"—"}</button></div></section><section className="operation-card"><div className="card-head"><div><h2>Provider files and communications</h2><p>Prepared files are superseded when their source changes. External declaration records retain the checked acknowledgement and checksum.</p></div><span>{pensionData.filingHistory.length} records</span></div>{pensionData.filingHistory.length?<table><thead><tr><th>ID</th><th>Document</th><th>Source / reference</th><th>Records</th><th>Status</th><th>Due date</th><th>Prepared / recorded</th><th>External date</th></tr></thead><tbody>{pensionData.filingHistory.slice().reverse().slice(0,25).map(item=><tr key={item.id}><td>#{item.id}</td><td><b>{item.type==="PENSION-PROVIDER"?"Provider contribution file":item.type==="PENSION-DECLARATION"?"Declaration acknowledgement":"Employee communication"}</b></td><td>{item.declarationReference|| (item.periodNumber?`${item.taxYear||taxYear} · Period ${item.periodNumber}`:"Employee lifecycle")}</td><td>{item.records??"—"}</td><td><span className={`status ${item.status==="superseded"?"amber":""}`}>{item.status}</span></td><td>{formatUkDate(item.dueDate)}</td><td>{formatUkDate(item.preparedAt)}</td><td>{formatUkDate(item.declarationDate||item.submittedAt,"Not transmitted")}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No pension provider files, communications or declaration evidence have been recorded.</p></div>}</section></div>;
  return <div className="operational-workspace">{navigation}<section className="operation-card"><div className="card-head"><div><h2>Automatic enrolment assessment</h2><p>{assessmentPeriod?`Period ${assessmentPeriod} · Assessment date ${assessmentDateLabel}`:"Finalise payroll to establish the assessment date"}</p></div></div>{rows.length?<table><thead><tr><th>Employee</th><th>Age</th><th>Qualifying earnings</th><th>Category</th><th>Membership</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}>{r.map((v,i)=><td key={i}>{i===0?<b>{v}</b>:v}</td>)}</tr>)}</tbody></table>:<div className="empty-workflow"><p>Assessment will use stored dates of birth and gross earnings from the latest finalised pay run. {employees.filter(item=>!item.dateOfBirth).length} employee record(s) need a date of birth.</p></div>}<div className="operation-footer"><button disabled={!rows.length} onClick={exportAssessment}>Export assessment</button><button className="primary" onClick={runAssessment}>Run assessment & enrol eligible workers</button></div></section></div>;
}

function ReportsWorkspace({ toast,employerName,employees,finalised }: { toast: (s: string,success?:boolean) => void;employerName:string;employees:Employee[];finalised:number[] }) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const [report, setReport] = useState("P11 deductions working sheet");
  const [preview,setPreview]=useState<{columns:string[];rows:unknown[][]}|null>(null);
  const [format,setFormat]=useState<"csv"|"html">("csv");
  const [employeeId,setEmployeeId]=useState(0),[periodNumber,setPeriodNumber]=useState(0);
  const [yearEnd,setYearEnd]=useState<any>(null);
  const reportTypes:Record<string,string>={"P11 deductions working sheet":"p11","P45 leaving statement":"p45","P60 certificate":"p60","P11D expenses and benefits":"p11d","P11D(b) employer declaration":"p11db","P46(Car) company-car events":"p46car","Payrolled benefits (PBIK)":"pbik","P30 HMRC payment schedule":"p30","P32 employer payments":"p32","Employee payslips":"payslips","Payment summary":"payments","Cash makeup schedule":"cash-payments","Bank cash request":"cash-request","Cash wage receipt sheet":"cash-receipt","Cash rounding and carried balances":"cash-rounding","Holiday-pay fund ledger":"holiday-fund","Cheque payment schedule":"cheque-payments","Employee loan and overpayment ledger":"employee-loans","Payroll accounting journal":"journal","Nominal-ledger accounting import":"accounting-file","Payroll Giving summary":"payroll-giving","Statutory pay schedule":"statutory-pay","Annual leave entitlement":"leave-summary","Employee calendar":"calendar","All statutory non-payment notices":"statutory-notices","SMP1 maternity non-payment notices":"smp1","SPP1 paternity non-payment notices":"spp1","SAP1 adoption non-payment notices":"sap1","SSP1 sick-pay notices":"ssp1","SPBP1 bereavement-pay notices":"spbp1","NEO1 neonatal-care-pay notices":"neo1","Attachment order summary":"attachments","Attachment payment schedule":"attachment-payments","Child maintenance payment export":"child-support-payments","Employee detail register":"employee-details","Employee list":"employee-list","Joiners and leavers":"joiners-leavers","Employee joining statement":"starter-statement","Blank new-employee form":"blank-joiner-form","Employee count":"employee-count","Pension contribution summary":"pensions","CIS deduction statements":"cis"};
  const reports = Object.keys(reportTypes);
  const periodReportTypes=new Set(["p11","p30","p32","payslips","payments","cash-payments","cash-request","cash-receipt","cash-rounding","holiday-fund","cheque-payments","employee-loans","journal","accounting-file","payroll-giving","attachments","attachment-payments","child-support-payments","pensions","cis"]);
  const employerReportTypes=new Set(["p30","p32","p11db","blank-joiner-form","employee-count","cis"]);
  async function refreshYearEnd(){
    const response=await fetch(`/api/year-end?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body=await response.json();
    if(response.ok)setYearEnd(body);
  }
  useEffect(()=>{refreshYearEnd();},[]);
  async function rollover(){
    const response=await fetch("/api/year-end",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,action:"rollover"})}),body=await response.json();
    if(!response.ok)return toast(body.error||"Tax-year rollover is not ready.",false);
    toast(`Tax year ${body.toTaxYear} created with period 1 open.`);window.location.reload();
  }
  async function previewReport() {
    try {
      const response=await fetch(`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=${reportTypes[report]}${employeeId?`&employeeId=${employeeId}`:""}${periodNumber?`&periodNumber=${periodNumber}`:""}`);
      const body=await response.json(); if(!response.ok)throw new Error(body.error);
      setPreview({columns:body.columns,rows:body.rows}); toast(`${report} reconciled from finalised payroll.`);
    } catch(error){toast(error instanceof Error?error.message:"Report preview failed.",false);}
  }
  async function generateReport() {
    const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employerId,taxYear,type:reportTypes[report],format,employeeId:employeeId||undefined,periodNumber:periodNumber||undefined }) });
    if(!response.ok){const body=await response.json();return toast(body.error||"Report generation failed.",false);}
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${reportTypes[report]}-${taxYearSlug(taxYear)}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`${report} generated.`);
  }
  async function openPrintView(){
    const response=await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      employerId,taxYear,type:reportTypes[report],format:"html",employeeId:employeeId||undefined,periodNumber:periodNumber||undefined,
    })});
    if(!response.ok){const body=await response.json();return toast(body.error||"Print view could not be generated.");}
    const url=URL.createObjectURL(await response.blob()),opened=window.open(url,"_blank");
    if(!opened){URL.revokeObjectURL(url);return toast("The browser blocked the print view. Allow pop-ups for this local payroll preview and try again.");}
    opened.opener=null;
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast(`${report} opened in a private print view. Use the browser Print command to save as PDF.`);
  }
  const selectedReportType=reportTypes[report],usesPeriod=periodReportTypes.has(selectedReportType),usesEmployee=!employerReportTypes.has(selectedReportType),taxMonthSelection=["cis","p30","p32"].includes(selectedReportType);
  const selectablePeriods=taxMonthSelection?Array.from({length:12},(_,index)=>index+1):paySchedule.map(item=>item.periodNumber);
  const enabledPeriods=taxMonthSelection?selectablePeriods:finalised;
  return <div className="operational-workspace report-builder"><section className="operation-card"><div className="card-head"><div><h2>Report builder</h2><p>Generate statutory and management reports from finalised payroll data.</p></div></div><div className="report-controls"><label><span>Report</span><select value={report} onChange={e=>{const next=e.target.value,type=reportTypes[next];setReport(next);if(!periodReportTypes.has(type))setPeriodNumber(0);if(employerReportTypes.has(type))setEmployeeId(0);setPreview(null);}}>{reports.map(r=><option key={r}>{r}</option>)}</select></label><label><span>Tax year</span><select value={taxYear} disabled><option>{taxYear}</option></select></label><label><span>{taxMonthSelection?"Tax month":"Payroll period"}</span><select disabled={!usesPeriod} value={periodNumber} onChange={event=>{setPeriodNumber(Number(event.target.value));setPreview(null);}}><option value={0}>All {taxMonthSelection?"tax months":"finalised periods"}</option>{selectablePeriods.map(value=><option key={value} value={value} disabled={!enabledPeriods.includes(value)}>{taxMonthSelection?"Tax month":"Period"} {value}</option>)}</select></label><label><span>Employee</span><select disabled={!usesEmployee} value={employeeId} onChange={event=>{setEmployeeId(Number(event.target.value));setPreview(null);}}><option value={0}>{usesEmployee?"All employees":"Employer-level report"}</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label><span>Export format</span><select value={format} onChange={e=>setFormat(e.target.value as "csv"|"html")}><option value="csv">CSV data</option><option value="html">Print-ready document</option></select></label></div><div className="report-preview"><span>RECONCILED PREVIEW</span><h3>{report}</h3><p>{employerName} · {taxYear}</p><div><span>Rows</span><b>{preview?.rows.length??"Not loaded"}</b><span>Columns</span><b>{preview?.columns.length??"—"}</b><span>Status</span><b>{preview?"Reconciled":"Generate preview"}</b></div>{preview&&<><div className="report-table-scroll"><table><thead><tr>{preview.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{preview.rows.slice(0,25).map((row,rowIndex)=><tr key={rowIndex}>{row.map((value,columnIndex)=><td key={`${rowIndex}-${columnIndex}`}>{String(value??"")}</td>)}</tr>)}</tbody></table></div>{preview.rows.length>25&&<small>Showing the first 25 of {preview.rows.length} rows. The download contains every row.</small>}</>}</div><div className="operation-footer"><button onClick={previewReport}>Preview reconciled data</button><button onClick={openPrintView}>Open print / PDF view</button><button className="primary" onClick={generateReport}>Download {format==="csv"?"CSV":"document"}</button></div></section>
    <section className="operation-card"><div className="card-head"><div><h2>Tax-year completion</h2><p>Close {taxYear} only after payroll, RTI and employee documents reconcile.</p></div><span className={`status ${yearEnd?.ready?"":"amber"}`}>{yearEnd?.ready?"Ready to roll over":"Checks required"}</span></div><div className="year-end-checks">{yearEnd?.checks?.map((check:any)=><div className="summary-line" key={check.name}><span>{check.passed?"✓":"!"} {check.name}<small>{check.detail}</small></span><b>{check.passed?"Passed":"Review"}</b></div>)}</div><div className="operation-footer"><button onClick={refreshYearEnd}>Refresh checks</button><button className="primary" disabled={!yearEnd?.ready} onClick={rollover}>Create {yearEnd?.nextTaxYear||"next tax year"}</button></div></section>
  </div>;
}

const featureGroups: Record<string, { title: string; items: string[] }[]> = {
  Payroll: [
    { title: "Pay entry", items: ["Basic pay", "Hourly pay", "Additions", "Deductions", "Holiday pay fund", "Copy future periods", "Delete pay details", "Lock periods", "Employee payslip"] },
    { title: "Deductions and adjustments", items: ["Pension contributions", "Student loan", "Postgraduate loan", "Attachment orders", "Payroll giving", "Childcare", "Loans and advances", "Overpayments"] },
    { title: "Advanced calculations", items: ["Target net pay", "Salary sacrifice", "Mileage allowance", "Pay rounding", "Previous pay and tax adjustment", "NIC adjustment", "Statutory pay adjustment", "Loan adjustment"] },
    { title: "Payments", items: ["Employer period summary", "Employer tax summary", "P30 payslip", "Year-to-date figures", "Payments summary", "Cash makeup", "Cash request", "Cash receipt sheet", "Cheque payments", "Bank payment file"] },
    { title: "Outputs", items: ["BACS hash code", "Child support export", "Attachment payments", "Payroll giving summary", "Accounting export", "Print and post", "Email payslips", "Multi-period payslips"] },
  ],
  Analysis: [
    { title: "Payroll analysis", items: ["Employee pay detail", "Employee totals", "Period totals", "Departmental analysis", "Pay elements", "Pay count", "Annual and average pay"] },
    { title: "Deductions analysis", items: ["Attachment summary", "Pension contributions", "Pension summary", "Payroll giving", "Accounts reconciliation"] },
    { title: "Compliance checks", items: ["National Minimum Wage check", "Statutory pay recovery", "HMRC funding", "Employer NIC allowance", "Apprenticeship Levy"] },
    { title: "Benefits analysis", items: ["Expenses and benefits calculation", "Class 1A NIC summary", "PBIK summary", "Printable document review", "Payroll data validation", "RTI validation"] },
  ],
  Employees: [
    { title: "Employee record", items: ["Add employee", "Personal details", "Work details", "Payment details", "Starter data", "Employee history", "Contacts", "Delete employee"] },
    { title: "Workforce administration", items: ["Sort employee list", "Print employee details", "Employee list", "Employee count", "Joiners and leavers", "Change pay frequency"] },
    { title: "Calendar", items: ["Calendar views", "Sick leave", "Maternity leave", "Paternity leave", "Adoption leave", "Holiday leave", "Working days", "National holidays"] },
    { title: "Benefits and documents", items: ["Expenses and benefits", "Payrolled benefits (PBIK)", "Employee notes", "Joining statement", "Leaving statement P45", "Blank joiner form", "Calendar reports"] },
  ],
  Employer: [
    { title: "Employer record", items: ["Company details", "Tax office details", "Bank details", "Departments", "Pay dates", "Employer notes", "Document passwords"] },
    { title: "Funding and reliefs", items: ["Statutory pay funding", "Tax refund funding", "CIS deductions suffered", "Previous HMRC overpayment", "Class 1A NIC adjustments", "Employment Allowance", "Small Employers’ Relief"] },
    { title: "Payroll defaults", items: ["Monthly pay frequency", "Weekly and multi-week frequencies", "Pay basis", "Working hours", "Annual leave", "Minimum wage", "Automatic works numbers", "Pay schedule", "New employee form"] },
  ],
  HMRC: [
    { title: "Liabilities", items: ["Employer tax summary", "P30 employer payslip", "P32 employer payments", "PAYE and NIC paid", "Employment Allowance", "Apprenticeship Levy", "Statutory recovery", "Funding position"] },
    { title: "Notices", items: ["Tax code notices", "Student loan notices", "NINO notices", "Generic notices", "Download HMRC notices", "Apply coding notice", "Notice history"] },
    { title: "Year end", items: ["Final submission indicator", "P60 certificates", "P11 deductions", "End-of-year summary", "P11D(b)", "Class 1A NIC", "Tax-year rollover"] },
  ],
  RTI: [
    { title: "Submissions", items: ["Full Payment Submission", "Employer Payment Summary", "NINO verification request", "Earlier Year Update", "Additional FPS", "Expenses and Benefits", "CIS300 return"] },
    { title: "RTI operations", items: ["Submission schedule", "Due dates", "Pre-submit validation", "Correct an RTI mistake", "Replacement submission", "Late reason", "Final submission"] },
    { title: "Online filing", items: ["Government Gateway credentials", "Agent credentials", "Connection test", "File return", "Poll response", "Submission receipt", "Submission log", "Batch processor"] },
  ],
  CIS: [
    { title: "Subcontractors", items: ["Add subcontractor", "Subcontractor details", "Online verification", "Manual verification", "Verification statement", "Subcontractor list"] },
    { title: "Payments", items: ["Basic payments", "Hourly payments", "Materials", "VAT", "Retentions", "CIS deduction", "Subcontractor payslip", "Subcontractor invoice"] },
    { title: "Returns and reports", items: ["CIS300 monthly return", "Monthly deduction statement", "Annual deduction statement", "Subcontractor pay details", "Subcontractor totals", "CIS deductions suffered"] },
  ],
  Pensions: [
    { title: "Automatic enrolment", items: ["Worker assessment", "Enrol employee", "Postponement", "Opt in", "Opt out", "Cease membership", "Re-enrolment", "Declaration of compliance"] },
    { title: "Schemes and contributions", items: ["Add pension scheme", "Qualifying earnings", "Pensionable pay", "Salary sacrifice", "Employee contribution", "Employer contribution", "Contribution adjustment"] },
    { title: "Provider operations", items: ["Enrolment export", "Contribution export", "NEST", "The People’s Pension", "Smart Pension", "Legal & General", "Aviva", "PAPDIS"] },
    { title: "Communication", items: ["Assessment letters", "Enrolment letter", "Postponement letter", "Opt-in confirmation", "Opt-out confirmation", "Contribution report", "Membership history"] },
  ],
  Reports: [
    { title: "Statutory forms", items: ["P11 worksheet", "P45 leaving statement", "P60 certificate", "P11D", "P11D(b)", "P46(Car)", "P32 employer payments"] },
    { title: "Payroll reports", items: ["Employee payslips", "Employer summary", "Period totals", "Year-to-date", "Department analysis", "Payment summary", "Employee count"] },
    { title: "Leave and deductions", items: ["Calendar report", "Holiday entitlement", "Holiday-pay fund ledger", "Statutory pay schedule", "Attachment summary", "Pension summary", "Payroll giving"] },
    { title: "Report delivery", items: ["Print-ready HTML", "Browser print to PDF", "External email integration", "External document encryption", "Pre-printed stationery", "Report colours", "CSV export"] },
  ],
  Clients: [
    { title: "Employer portfolio", items: ["Employer list", "Open employer", "Employer status", "Managed by", "Due dates", "Colour reference", "Year-end checklist"] },
    { title: "Agent administration", items: ["Agent details", "Agent authority FBI2", "Agent charges", "Agent invoice", "Payslip count", "Batch RTI processor"] },
    { title: "Client forms", items: ["New employer form", "New employee form", "New subcontractor form", "Pay schedule", "Client request", "Secure document delivery"] },
  ],
  Tools: [
    { title: "Data transfer", items: ["Import payroll file", "Copy expenses and benefits", "Employer CSV import", "Employee CSV import", "CIS CSV import", "Pay details import", "Export all data"] },
    { title: "Payroll files", items: ["Create payroll", "Create next tax year", "Open payroll", "Save payroll", "Rename payroll", "Search payrolls", "Password protection"] },
    { title: "Backup and recovery", items: ["Create backup", "Verify backup", "Restore backup", "Revert version", "Reinstate sample data", "Audit history"] },
    { title: "Setup", items: ["General settings", "Reports and printing", "Toolbar", "Mid-year start", "Pay dates", "Online filing", "Email setup", "Email log"] },
    { title: "Utilities", items: ["Calculator", "Tax and NIC rates", "Close all windows", "Submission log", "Data validation", "Support diagnostics"] },
  ],
};

function FeatureLibrary({ active, toast }: { active: string; toast: (s: string) => void }) {
  const groups = featureGroups[active] || [];
  if (!groups.length) return null;
  const available=new Set([
    "Add employee","Employee record","Personal details","Employment details","Starter details","Leaver details","Payment details","Tax and NIC","RTI details","HR details","Employee calendar","Statutory pay","Attachment orders","Expenses and benefits","Payrolled benefits (PBIK)","Employee notes","Leaving statement P45","Calendar reports",
    "Company details","Tax office details","Bank details","Employer notes","Departments","Pay dates","Document passwords","Statutory pay funding","Employment Allowance","Small Employers’ Relief","Monthly pay frequency","Weekly and multi-week frequencies","Pay basis","Working hours","Annual leave","Minimum wage","Automatic works numbers",
    "Employer tax summary","P30 employer payslip","P32 employer payments","PAYE and NIC paid","Apprenticeship Levy","Statutory recovery","Tax refund funding","Previous HMRC overpayment","Class 1A NIC adjustments","Funding position","Tax code notices","Student loan notices","NINO notices","Generic notices","Download HMRC notices","Apply coding notice","Notice history","Final submission indicator","P60 certificates","P11 deductions","End-of-year summary","P11D(b)","Class 1A NIC","Tax-year rollover",
    "Full Payment Submission","Employer Payment Summary","NINO verification request","Additional FPS","Expenses and Benefits","CIS300 return","Submission schedule","Due dates","Pre-submit validation","Correct an RTI mistake","Replacement submission","Late reason","Final submission","Submission receipt","Submission log",
    "Add subcontractor","Subcontractor details","Manual verification","Verification statement","Subcontractor list","Basic payments","Hourly payments","Materials","VAT","Retentions","CIS deduction","Subcontractor invoice","CIS300 monthly return","Monthly deduction statement","Annual deduction statement","Subcontractor pay details","Subcontractor totals",
    "Worker assessment","Enrol employee","Postponement","Opt in","Opt out","Cease membership","Re-enrolment","Declaration of compliance","Add pension scheme","Qualifying earnings","Pensionable pay","Employee contribution","Employer contribution","Contribution adjustment","Enrolment export","Contribution export","Assessment letters","Enrolment letter","Postponement letter","Opt-in confirmation","Opt-out confirmation","Contribution report","Membership history",
    "P11 worksheet","P45 leaving statement","P60 certificate","P11D","P11D(b)","P46(Car)","P32 employer payments","Employee payslips","Employer summary","Period totals","Year-to-date","Payment summary","Employee count","Calendar report","Holiday entitlement","Holiday-pay fund ledger","Statutory pay schedule","Attachment summary","Pension summary","Print report","Print-ready HTML","Browser print to PDF","Pre-printed stationery","Report colours","CSV export",
    "Import payroll file","Employer CSV import","Employee CSV import","Pay details import","Copy expenses and benefits","Export all data","Create payroll","Create next tax year","Open payroll","Save payroll","Rename payroll","Search payrolls","Password protection","Create backup","Verify backup","Restore backup","Revert version","Reinstate sample data","Audit history","General settings","Reports and printing","Toolbar","Mid-year start","Pay dates","Email setup","Email log","Calculator","Tax and NIC rates","Submission log","Data validation","Support diagnostics",
    "Employee pay detail","Employee totals","Period totals","Departmental analysis","Pay elements","Pay count","Annual and average pay","Attachment summary","Pension contributions","Pension summary","Payroll giving","Accounts reconciliation","National Minimum Wage check","Statutory pay recovery","HMRC funding","Employer NIC allowance","Apprenticeship Levy","Expenses and benefits calculation","Class 1A NIC summary","PBIK summary","Payroll data validation","RTI validation","Salary sacrifice","Payroll Giving summary","Target net pay","Mileage allowance","Childcare","Pay rounding","Payments summary","Payment summary","Cash makeup","Cash request","Cash receipt sheet","Cheque payments","Bank payment file","Loans and advances","Overpayments",
    "Basic pay","Hourly pay","Additions","Deductions","Holiday pay fund","Copy future periods","Delete pay details","Lock periods","Employee payslip","Student loan","Postgraduate loan","Previous pay and tax adjustment","NIC adjustment","Statutory pay adjustment","Loan adjustment","Employer period summary","P30 payslip","Year-to-date figures","Child support export","Attachment payments","Payroll giving summary","Accounting export","Multi-period payslips",
    "Work details","Starter data","Employee history","Contacts","Delete employee","Sort employee list","Print employee details","Employee list","Joiners and leavers","Change pay frequency","Calendar views","Sick leave","Maternity leave","Paternity leave","Adoption leave","Holiday leave","Working days","National holidays","Joining statement","Blank joiner form",
    "Employer list","Open employer","Employer status","Managed by","Colour reference","Year-end checklist","Agent details","Agent charges","Agent invoice","Payslip count","New employer form","New employee form","New subcontractor form","Pay schedule","Client request","CIS deductions suffered","Subcontractor payslip","Department analysis","Printable document review","CIS CSV import",
  ]);
  const external=/External|Online|Government Gateway|Agent credentials|Connection test|File return|Poll response|Batch|NEST|People’s Pension|Smart Pension|Legal & General|Aviva|PAPDIS|Email|Secure document|Save PDF|Password-protect PDF|Print and post/i;
  const coverage=(item:string)=>item==="Close all windows"?"Not applicable":item==="NINO verification request"?"HMRC suspended":["Earlier Year Update","BACS hash code","Agent authority FBI2"].includes(item)?"HMRC retired":available.has(item)?"Available":external.test(item)?"External integration":"Planned";
  return <details className={`feature-library ${active === "Payroll" ? "inside-payroll" : ""}`}><summary><span>Full {active} capability checklist</span><small>{groups.reduce((n,g)=>n+g.items.length,0)} tracked workflows</small></summary>
    <div className="feature-library-head"><div><span className="eyebrow">IMPLEMENTATION COVERAGE</span><h2>{active} tools</h2><p>This register distinguishes working local workflows, planned modules and functions that require an external provider.</p></div></div>
    <div className="feature-groups">{groups.map(group => <article key={group.title}><h3>{group.title}</h3><div>{group.items.map(item=>{const status=coverage(item);return <div className={`coverage-item ${status==="Available"?"available":status==="Planned"?"planned":status==="HMRC retired"||status==="Not applicable"?"retired":"external"}`} key={item}><span>{status==="Available"?"✓":status==="Planned"?"○":status==="HMRC retired"||status==="Not applicable"?"—":"↗"}</span><b>{item}</b><small>{status}</small></div>})}</div></article>)}</div>
  </details>;
}

function EmployeeHistoryModal({employee,close,toast}:{employee:Employee;close:()=>void;toast:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId();
  const [history,setHistory]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    setLoading(true);setError("");
    fetch(`/api/employee-history?employerId=${employerId}&employeeId=${employee.id}`,{cache:"no-store"})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Employee history could not be loaded.");if(active)setHistory(body);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Employee history could not be loaded.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[employerId,employee.id]);
  const events=history?.events||[];
  const dateLabel=(value:string|null)=>value?(value.length===10?formatUkDate(value,"Recorded time unavailable"):formatUkDateTime(value,"Recorded time unavailable")):"Recorded action";
  function downloadHistory(){
    const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
    const rows=events.map((item:any)=>[item.category,item.title,formatUkDate(item.effectiveDate,""),formatUkDateTime(item.recordedAt,""),item.status,item.detail]);
    const csv=[["Category","Event","Effective date","Recorded at","Status","Detail"],...rows].map(row=>row.map(cell).join(",")).join("\r\n");
    downloadClientBlob(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}),`employee-history-${employee.payrollId||employee.id}.csv`);
    toast(`${events.length} employee history event${events.length===1?"":"s"} exported.`);
  }
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label={`Employee history for ${employee.name}`}><div className="modal employee-history-modal"><header><div><span className="eyebrow">EMPLOYEE HISTORY</span><h2>{employee.name}</h2><small>{employee.payrollId||"Payroll ID not assigned"} · immutable payroll and compliance activity</small></div><button aria-label="Close employee history" onClick={close}>×</button></header><div className="form-body">{loading?<div className="empty-workflow"><p>Loading employee history…</p></div>:error?<div className="portal-message benefit-error" role="alert">{error}</div>:<><div className="metric-grid history-metrics"><article><span>History events</span><strong>{history.summary.total}</strong><small>Across employee modules</small></article><article><span>Payroll runs</span><strong>{history.summary.payrollRuns}</strong><small>Draft and finalised</small></article><article><span>Leave records</span><strong>{history.summary.leaveEvents}</strong><small>Including statutory pay</small></article><article><span>Compliance events</span><strong>{history.summary.notices+(history.summary.statutoryNotices||0)+history.summary.pensionEvents}</strong><small>HMRC, statutory notices and pension</small></article></div>{events.length?<div className="employee-timeline">{events.map((item:any)=>{const recorded=dateLabel(item.recordedAt);return <article key={item.id}><i className={`timeline-dot ${item.category}`}/><div><div className="timeline-head"><span>{item.category}</span><small>{dateLabel(item.effectiveDate)}</small></div><h3>{item.title}</h3><p>{item.detail}</p><small>{recorded==="Recorded time unavailable"?"Legacy record · exact stored time unavailable":`Recorded ${recorded}`} · <b>{String(item.status).replaceAll("-"," ")}</b></small></div></article>;})}</div>:<div className="empty-workflow"><p>No employee history has been recorded yet.</p></div>}</>}</div><footer><button disabled={loading||Boolean(error)||!events.length} onClick={downloadHistory}>Download history CSV</button><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function EmployeeModal({ employee, tab, setTab, update, close, save, remove, invite, canInvite }: { employee: Employee; tab: string; setTab: (s:string)=>void; update:(p:Partial<Employee>)=>void; close:()=>void; save:(employee:Employee)=>void; remove:(employee:Employee)=>void; invite:()=>void; canInvite:boolean }) {
  const taxYear=useTaxYear(),payFrequency=usePayFrequency(),frequencyRule=payrollFrequencyRule(payFrequency),periodDivisor=annualPayPeriodDivisor(payFrequency);
  return <div className="modal-bg" role="dialog" aria-modal="true"><div className="modal employee-modal"><header><div><span className="eyebrow">EMPLOYEE RECORD</span><h2>{employee.name}</h2></div><button onClick={close}>×</button></header><nav>{formTabs.map(t => <button key={t} className={t===tab?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</nav><div className="form-body">
    {employee.reportedPayFrequency&&employee.reportedPayFrequency!==payFrequency&&<div className="portal-message benefit-error" role="alert">This employee’s RTI frequency does not match the employer’s {frequencyRule.label.toLowerCase()} schedule. Saving will align it to the employer schedule.</div>}
    {tab === "Personal" && <><FormTitle title="Personal details" text="Identity and contact information used on payroll documents and FPS identity matching."/><div className="form-grid"><Field label="Title" value={employee.title||""} onChange={v=>update({title:v})}/><Field label="First name" value={employee.firstName||employee.name.split(" ")[0]||""} onChange={v=>update({firstName:v,name:[v,employee.middleNames,employee.lastName].filter(Boolean).join(" ")})}/><Field label="Middle names" value={employee.middleNames||""} onChange={v=>update({middleNames:v,name:[employee.firstName||employee.name.split(" ")[0],v,employee.lastName].filter(Boolean).join(" ")})}/><Field label="Last name" value={employee.lastName||employee.name.split(" ").at(-1)||""} onChange={v=>update({lastName:v,name:[employee.firstName||employee.name.split(" ")[0],employee.middleNames,v].filter(Boolean).join(" ")})}/><Field label="Email address" value={employee.email} onChange={v=>update({email:v})}/><Field label="Date of birth" value={employee.dateOfBirth||""} type="date" onChange={v=>update({dateOfBirth:v})}/><label className="field"><span>Gender for HMRC reporting</span><select value={employee.gender||""} onChange={event=>update({gender:event.target.value})}><option value="">Select…</option><option value="M">Male</option><option value="F">Female</option></select></label><Field label="Home address" value={employee.address||""} onChange={v=>update({address:v})}/><Field label="Postcode" value={employee.postcode||""} onChange={v=>update({postcode:v.toUpperCase()})}/></div></>}
    {tab === "Employment" && <><FormTitle title="Employment" text="Work pattern, department, leave and minimum wage monitoring."/><div className="form-grid"><Field label="Works number" value={employee.worksNumber||""} onChange={v=>update({worksNumber:v})}/><Field label="Job title" value={employee.role} onChange={v=>update({role:v})}/><Field label="Department" value={employee.department} onChange={v=>update({department:v})}/><Field label="Contracted hours per week" value={String(employee.contractedHours??37.5)} type="number" onChange={v=>update({contractedHours:+v})}/><Field label="Annual leave entitlement" value={String(employee.annualLeaveDays??28)} type="number" onChange={v=>update({annualLeaveDays:+v})}/><label className="field"><span>Minimum wage category</span><select value={employee.minimumWageCategory||"age-based"} onChange={event=>update({minimumWageCategory:event.target.value as Employee["minimumWageCategory"]})}><option value="age-based">Automatic from date of birth</option><option value="apprentice">Apprentice</option></select></label>{employee.minimumWageCategory==="apprentice"&&<Field label="Apprenticeship start date" value={employee.apprenticeshipStartDate||""} type="date" onChange={v=>update({apprenticeshipStartDate:v})}/>}</div><Check text="Automatically flag pay below National Minimum Wage" checked/></>}
    {tab === "Starter / leaver" && <><FormTitle title="Starter and leaver" text="Employment dates, evidence and starter declaration used to establish the PAYE basis."/><div className="form-grid"><Field label="Start date" value={employee.startDate || ""} type="date" onChange={v=>update({startDate:v})}/><Field label="Leaving date" value={employee.leavingDate || ""} type="date" onChange={v=>update({leavingDate:v})}/><label className="field"><span>Starter evidence</span><select value={employee.starterEvidence||"No P45 provided"} onChange={event=>{const starterEvidence=event.target.value;if(starterEvidence==="Secondary employment")update({starterEvidence,starterDeclaration:"Statement C – another job or pension",taxCode:"BR",week1Month1:false});else if(starterEvidence==="Worked elsewhere this tax year")update({starterEvidence,starterDeclaration:"Statement B – only job now; worked since 6 April",taxCode:"1257L",week1Month1:true});else update({starterEvidence})}}><option>P45 provided</option><option>No P45 provided</option><option>P60 only</option><option>Worked elsewhere this tax year</option><option>Secondary employment</option></select></label><label className="field"><span>Starter declaration</span><select value={employee.starterDeclaration||"Statement A – first job since 6 April"} onChange={event=>{const starterDeclaration=event.target.value;if(starterDeclaration.startsWith("Statement B"))update({starterDeclaration,taxCode:"1257L",week1Month1:true});else if(starterDeclaration.startsWith("Statement C"))update({starterDeclaration,taxCode:"BR",week1Month1:false});else if(starterDeclaration.startsWith("No statement"))update({starterDeclaration,taxCode:"0T",week1Month1:true});else update({starterDeclaration,taxCode:"1257L",week1Month1:false})}}><option>Statement A – first job since 6 April</option><option>Statement B – only job now; worked since 6 April</option><option>Statement C – another job or pension</option><option>No statement – use 0T week 1 / month 1</option></select></label><Field label="P45 leaving date" value={employee.p45LeavingDate || ""} type="date" onChange={v=>update({p45LeavingDate:v})}/><Field label="P45 previous pay" value={String(employee.p45PreviousPay || 0)} type="number" onChange={v=>update({p45PreviousPay:+v})}/><Field label="P45 previous tax" value={String(employee.p45PreviousTax || 0)} type="number" onChange={v=>update({p45PreviousTax:+v})}/><Field label="P60 tax year" value={employee.p60TaxYear || ""} onChange={v=>update({p60TaxYear:v})}/></div><Check text="P45 received after first payroll – apply values from the next open period" checked={Boolean(employee.p45ReceivedAfterPayroll)} onChange={checked=>update({p45ReceivedAfterPayroll:checked})}/><Check text="P60 supplied for reference only (not a substitute for a current P45)" checked={Boolean(employee.p60ReferenceOnly)} onChange={checked=>update({p60ReferenceOnly:checked})}/></>}
    {tab === "Payment" && <><FormTitle title="Payment details" text="Pay basis, rates, bank details and payment method."/><div className="form-grid"><Field label="Payroll frequency" value={`${frequencyRule.label} (${frequencyRule.periodsPerYear} regular periods)`}/><label className="field"><span>Pay basis</span><select value={employee.payBasis||"period"} onChange={event=>{const payBasis=event.target.value as Employee["payBasis"];update({payBasis,pay:periodicBasePay({...employee,payBasis},payFrequency)})}}><option value="period">Annual / period salary</option><option value="hourly">Contracted hourly</option><option value="daily">Contracted daily</option></select></label>{(employee.payBasis||"period")==="period"&&<Field label="Annual salary" value={String(employee.annualSalary??employee.pay*periodDivisor)} type="number" onChange={v=>update({annualSalary:+v,pay:+v/periodDivisor})}/>} {employee.payBasis==="hourly"&&<><Field label="Hourly rate" value={String(employee.rate)} type="number" onChange={v=>{const rate=+v;update({rate,pay:periodicBasePay({...employee,rate},payFrequency)})}}/><Field label="Contracted hours per week" value={String(employee.contractedHours||0)} type="number" onChange={v=>{const contractedHours=+v;update({contractedHours,pay:periodicBasePay({...employee,contractedHours},payFrequency)})}}/></>} {employee.payBasis==="daily"&&<><Field label="Daily rate" value={String(employee.dailyRate||0)} type="number" onChange={v=>{const dailyRate=+v;update({dailyRate,pay:periodicBasePay({...employee,dailyRate},payFrequency)})}}/><Field label="Working days per week" value={String(employee.workingDaysPerWeek??5)} type="number" onChange={v=>{const workingDaysPerWeek=+v;update({workingDaysPerWeek,pay:periodicBasePay({...employee,workingDaysPerWeek},payFrequency)})}}/><Field label="Contracted hours per week" value={String(employee.contractedHours||0)} type="number" onChange={v=>update({contractedHours:+v})}/></>}<Field label={`Calculated ${frequencyRule.label.toLowerCase()} basic pay`} value={money(periodicBasePay(employee,payFrequency))}/><label className="field"><span>Payment method</span><select value={employee.paymentMethod||"credit-transfer"} onChange={event=>update({paymentMethod:event.target.value})}><option value="credit-transfer">Credit transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></label><Field label="Bank name" value={employee.bankName||""} onChange={v=>update({bankName:v})}/><Field label="Account name" value={employee.accountName||""} onChange={v=>update({accountName:v})}/><Field label="Sort code" value={employee.sortCode||""} onChange={v=>update({sortCode:v})}/><Field label="Account number" value={employee.accountNumber||""} onChange={v=>update({accountNumber:v})}/></div></>}
    {tab === "Tax & NICs" && <><FormTitle title="Tax and National Insurance" text="PAYE basis, NIC treatment, directorship and loan deductions."/><div className="form-grid"><Field label="Tax code" value={employee.taxCode} onChange={v=>update({taxCode:v.toUpperCase()})}/><Field label="NI number" value={employee.niNumber || ""} onChange={v=>update({niNumber:v.toUpperCase()})}/><label className="field"><span>NI category</span><select value={employee.ni} onChange={event=>update({ni:event.target.value})}>{["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"].map(value=><option key={value}>{value}</option>)}</select></label><label className="field"><span>Student loan plan</span><select value={employee.studentLoanPlan||""} onChange={event=>update({studentLoanPlan:(event.target.value||null) as Employee["studentLoanPlan"]})}><option value="">No student loan</option><option value="1">Plan 1</option><option value="2">Plan 2</option><option value="4">Plan 4</option><option value="5">Plan 5</option></select></label>{employee.director&&<><Field label="Directorship start" value={employee.directorStart||""} type="date" onChange={v=>update({directorStart:v})}/><Field label="Directorship end" value={employee.directorEnd||""} type="date" onChange={v=>update({directorEnd:v})}/></>}</div><Check text="Deduct postgraduate loan" checked={employee.postgraduateLoan} onChange={v=>update({postgraduateLoan:v})}/><Check text="Use week 1 / month 1 basis" checked={employee.week1Month1} onChange={v=>update({week1Month1:v})}/><Check text="Employee is a director during this tax year" checked={employee.director} onChange={v=>update(v?{director:true}:{director:false,directorStart:undefined,directorEnd:undefined,alternativeDirectorNic:false})}/><Check text="Use alternative method for director NICs" checked={employee.alternativeDirectorNic} disabled={!employee.director} onChange={v=>update({alternativeDirectorNic:v})}/><Check text="Secondary Class 1 NICs are not due" checked={employee.noSecondaryNic} onChange={v=>update({noSecondaryNic:v})}/></>}
    {tab === "RTI" && <><FormTitle title="RTI and FPS declarations" text="Employee data included in Real Time Information submissions. Changing the payroll ID automatically retains the current ID as the previous identifier for the next FPS."/><div className="form-grid"><Field label="Payroll ID" value={employee.payrollId||fallbackPayrollId(employee,taxYear)} onChange={v=>update({payrollId:v})}/><Field label="Previous payroll ID (automatic)" value={employee.previousPayrollId||""}/><Field label="Reported pay frequency" value={frequencyRule.label}/><Field label="Contracted hours per week" value={String(employee.contractedHours??0)} type="number" onChange={v=>update({contractedHours:+v})}/><Field label="Workplace postcode" value={employee.workplacePostcode||employee.postcode||""} onChange={v=>update({workplacePostcode:v})}/></div><Check text="Do not include on FPS if pay is zero" checked={employee.zeroPayFpsExclusion} onChange={v=>update({zeroPayFpsExclusion:v})}/><Check text="Employee is on an irregular payment pattern" checked={employee.irregularPayment} onChange={v=>update({irregularPayment:v})}/><Check text="Payment is being made to a personal representative, trustee or corporate body" checked={employee.paymentToBody} onChange={v=>update({paymentToBody:v})}/><Check text="Individual trivial commutation payment declaration" checked={employee.trivialCommutation} onChange={v=>update({trivialCommutation:v})}/><Check text="Include flexible drawdown payment declaration" checked={employee.flexibleDrawdown} onChange={v=>update({flexibleDrawdown:v})}/></>}
    {tab === "HR" && <><FormTitle title="HR and employee portal" text="Portal access, management, emergency information and privacy."/><Check text="Enable employee portal" checked={employee.employeePortal} onChange={v=>update(v?{employeePortal:true}:{employeePortal:false,portalCanEditBank:false})}/><Check text="Allow employee to update bank details" checked={employee.portalCanEditBank} disabled={!employee.employeePortal} onChange={v=>update({portalCanEditBank:v})}/><button type="button" className="outline" disabled={!employee.employeePortal||!canInvite} onClick={invite}>Create one-time portal invitation</button>{employee.employeePortal&&!canInvite&&<small>Save the employee record before creating a portal invitation.</small>}<div className="form-grid"><Field label="Manager" value={employee.managerName||""} onChange={v=>update({managerName:v})}/><Field label="Nationality" value={employee.nationality||""} onChange={v=>update({nationality:v})}/><Field label="Passport number" value={employee.passportNumber||""} onChange={v=>update({passportNumber:v})}/><Field label="Marital status" value={employee.maritalStatus||""} onChange={v=>update({maritalStatus:v})}/><Field label="Emergency contact name" value={employee.emergencyContactName||""} onChange={v=>update({emergencyContactName:v})}/><Field label="Emergency contact phone" value={employee.emergencyContactPhone||""} onChange={v=>update({emergencyContactPhone:v})}/><Field label="Emergency contact relationship" value={employee.emergencyContactRelationship||""} onChange={v=>update({emergencyContactRelationship:v})}/><Field label="Medical information" value={employee.medicalInformation||""} onChange={v=>update({medicalInformation:v})}/></div><label className="field full"><span>HR notes</span><textarea value={employee.hrNotes||""} onChange={event=>update({hrNotes:event.target.value})}/></label><Check text="Mark HR notes as confidential" checked={employee.hrNotesConfidential??true} onChange={v=>update({hrNotesConfidential:v})}/><Check text="Hide employee from users without the required permission" checked={employee.confidential} onChange={v=>update({confidential:v})}/></>}
  </div><footer><button onClick={()=>remove(employee)}>Delete employee</button><button onClick={close}>Cancel</button><button className="primary" onClick={()=>save(employee)}>Save employee</button></footer></div></div>;
}

function LeaveRangeCalendar({startDate,endDate,workingDays,excludedDates,events,onChange,selectionMode="range"}:{startDate:string;endDate:string;workingDays:Set<number>;excludedDates:Set<string>;events:any[];onChange:(start:string,end:string)=>void;selectionMode?:"range"|"start"}) {
  const [visibleMonth,setVisibleMonth]=useState(startDate.slice(0,7));
  const [choosingEnd,setChoosingEnd]=useState(false);
  useEffect(()=>{if(startDate&&!choosingEnd)setVisibleMonth(startDate.slice(0,7));},[startDate]);
  const [year,monthNumber]=visibleMonth.split("-").map(Number),monthIndex=monthNumber-1;
  const firstOffset=(new Date(Date.UTC(year,monthIndex,1)).getUTCDay()+6)%7;
  const daysInMonth=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate();
  const cellCount=Math.ceil((firstOffset+daysInMonth)/7)*7;
  const monthLabel=new Intl.DateTimeFormat("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,monthIndex,1)));
  function shiftMonth(amount:number){
    const next=new Date(Date.UTC(year,monthIndex+amount,1));
    setVisibleMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}`);
  }
  function chooseDate(date:string){
    if(selectionMode==="start"){onChange(date,date);setChoosingEnd(false);return;}
    if(!choosingEnd){onChange(date,date);setChoosingEnd(true);return;}
    onChange(date<startDate?date:startDate,date<startDate?startDate:date);
    setChoosingEnd(false);
  }
  return <section className="leave-range-calendar" aria-label={selectionMode==="start"?"Statutory pay start-date calendar":"Leave date range calendar"}>
    <div className="leave-calendar-nav"><button type="button" aria-label="Previous calendar month" onClick={()=>shiftMonth(-1)}>‹</button><div><b>{monthLabel}</b><small>{selectionMode==="start"?"Select the statutory pay start date":choosingEnd?"Select the last day":"Select the first day"}</small></div><button type="button" aria-label="Next calendar month" onClick={()=>shiftMonth(1)}>›</button></div>
    <div className="leave-calendar-weekdays">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=><span key={day}>{day}</span>)}</div>
    <div className="leave-calendar-days">{Array.from({length:cellCount},(_,index)=>{
      const day=index-firstOffset+1;
      if(day<1||day>daysInMonth)return <span className="leave-calendar-blank" key={`blank-${index}`}/>;
      const date=`${year}-${String(monthIndex+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const weekday=new Date(`${date}T00:00:00Z`).getUTCDay()||7,isWorking=workingDays.has(weekday),excluded=excludedDates.has(date);
      const inRange=date>=startDate&&date<=endDate;
      const activeEvent=events.find(event=>event.status!=="cancelled"&&date>=event.startDate&&date<=event.endDate);
      const eventType=String(activeEvent?.type||"").toLowerCase(),eventClass=!activeEvent?"":
        eventType.includes("annual")?"event-annual":eventType.includes("sick")?"event-sick":
        ["maternity","paternity","adoption","parental","neonatal"].some(value=>eventType.includes(value))?"event-family":"event-other";
      const dateLabel=new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${date}T00:00:00Z`));
      return <button type="button" key={date} aria-label={`${dateLabel}${activeEvent?`; recorded ${activeEvent.type}`:""}`} data-event-type={activeEvent?.type||undefined} aria-pressed={inRange} onClick={()=>chooseDate(date)} className={`${inRange?"in-range ":""}${date===startDate?"range-start ":""}${date===endDate?"range-end ":""}${!isWorking?"non-working ":""}${excluded?"excluded ":""}${activeEvent?`has-event ${eventClass}`:""}`}><span>{day}</span>{activeEvent&&<i aria-hidden="true"/>}</button>;
    })}</div>
    <div className="leave-calendar-legend"><span><i className="selected"/>{selectionMode==="start"?"Statutory schedule":"Selected range"}</span><span><i className="working"/>Working day</span><span><i className="excluded"/>Employer holiday</span><span><i className="event annual"/>Annual leave</span><span><i className="event family"/>Family leave</span><span><i className="event sick"/>Sickness</span><span><i className="event other"/>Other leave</span></div>
  </section>;
}

function CalendarModal({ employee, period, close, saved }: { employee:Employee; period:number; close:()=>void; saved:(message:string,event?:any,keepOpen?:boolean)=>void }) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate(),statutoryRulesAvailable=taxYear==="2026/27";
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]);
  const initialPeriodRange=paySchedule.find(item=>item.periodNumber===period)||paySchedule[0];
  const initialStartDate=initialPeriodRange.periodStart;
  const initialEndDate=initialPeriodRange.periodEnd;
  const [leaveType, setLeaveType] = useState("Annual leave");
  const [awe, setAwe] = useState(0);
  const [startDate,setStartDate]=useState(initialStartDate);
  const [endDate,setEndDate]=useState(initialEndDate);
  const [endDateManuallyEdited,setEndDateManuallyEdited]=useState(false);
  const [aweRelevantDate,setAweRelevantDate]=useState("");
  const initialWorkingWeekdays=defaultWorkingWeekdays(employee.workingDaysPerWeek??5).join(",");
  const [qualifyingDaysPerWeek,setQualifyingDaysPerWeek]=useState(initialWorkingWeekdays.split(",").length);
  const [qualifyingWeekdays,setQualifyingWeekdays]=useState(initialWorkingWeekdays);
  const [smallEmployer,setSmallEmployer]=useState(false);
  const [saving,setSaving]=useState(false);
  const [serviceWeeks,setServiceWeeks]=useState(26);
  const [evidenceReceived,setEvidenceReceived]=useState(true);
  const [noticeReceived,setNoticeReceived]=useState(true);
  const [inLegalCustody,setInLegalCustody]=useState(false);
  const [sspEnding,setSspEnding]=useState(false);
  const [childBirthDate,setChildBirthDate]=useState(""),[neonatalCareStartDate,setNeonatalCareStartDate]=useState(""),[neonatalCareEndDate,setNeonatalCareEndDate]=useState("");
  const [neonatalTier,setNeonatalTier]=useState<"tier-1"|"tier-2">("tier-2"),[relationshipDeclaration,setRelationshipDeclaration]=useState(false),[caringResponsibilityDeclaration,setCaringResponsibilityDeclaration]=useState(false);
  const [familyEventReference,setFamilyEventReference]=useState(""),[familyEventDate,setFamilyEventDate]=useState(""),[familyEventKind,setFamilyEventKind]=useState("birth"),[sharedPayWeeksAvailable,setSharedPayWeeksAvailable]=useState(37);
  const [touchDayDate,setTouchDayDate]=useState(""),[statutoryTouchDays,setStatutoryTouchDays]=useState<StatutoryTouchDay[]>([]);
  const [ordinaryWorkDate,setOrdinaryWorkDate]=useState(""),[ordinaryWorkDates,setOrdinaryWorkDates]=useState<string[]>([]);
  const [leaveNotes,setLeaveNotes]=useState("Eligibility evidence reviewed.");
  const [aweBasis,setAweBasis]=useState<any>({averageWeeklyEarningsSource:"manual"});
  const [events,setEvents]=useState<any[]>([]),[employerCalendarDays,setEmployerCalendarDays]=useState<any[]>([]),[cancellationReasons,setCancellationReasons]=useState<Record<number,string>>({});
  const leaveBalance=leaveEntitlementBalance(employee.annualLeaveDays??28,employee.startDate,employee.leavingDate,events,taxYear);
  const statutoryWeekly = 194.32;
  const ninetyPercent = awe * .9;
  const statutoryTypes:Record<string,string>={"Maternity leave":"maternity","Adoption leave":"adoption","Sick leave":"sick","Paternity leave":"paternity","Shared parental leave":"shared-parental","Shared parental leave (adoption)":"shared-parental","Parental bereavement leave":"bereavement","Neonatal care leave":"neonatal"};
  const statutoryType = statutoryTypes[leaveType] || "none";
  const automaticScheduleWeeks=automaticStatutoryPayWeeks(statutoryType);
  const automaticScheduleEnd=automaticStatutoryPayEndDate(statutoryType,startDate);
  useEffect(()=>{
    if(automaticScheduleEnd&&!endDateManuallyEdited)setEndDate(automaticScheduleEnd);
  },[automaticScheduleEnd,endDateManuallyEdited]);
  useEffect(()=>{if(statutoryType==="bereavement"&&!["death","stillbirth","miscarriage"].includes(familyEventKind))setFamilyEventKind("death");if(statutoryType==="maternity")setFamilyEventKind("birth");if(statutoryType==="adoption")setFamilyEventKind("adoption");if(["paternity","shared-parental"].includes(statutoryType)&&!["birth","adoption"].includes(familyEventKind))setFamilyEventKind("birth");},[statutoryType]);
  const startMs=Date.parse(`${startDate}T00:00:00Z`),endMs=Date.parse(`${endDate}T00:00:00Z`);
  const calendarDays=Number.isFinite(startMs)&&Number.isFinite(endMs)&&endMs>=startMs?Math.floor((endMs-startMs)/86_400_000)+1:0;
  const qualifyingWeekdaySet=new Set(qualifyingWeekdays.split(",").map(Number));
  const workPatternLeave=statutoryType==="none"&&["Annual leave","Unpaid leave","Absent","On strike","Parental leave (unpaid)"].includes(leaveType);
  const calendarExclusions=workPatternLeave&&calendarDays?employerCalendarDays.filter(item=>item.status==="active"&&item.date>=startDate&&item.date<=endDate):[];
  const scheduledWorkingDays=calendarDays?countWorkingDays(startDate,endDate,qualifyingWeekdaySet,calendarExclusions.map(item=>item.date)):0;
  const payableDays=statutoryType==="sick"||workPatternLeave?scheduledWorkingDays:calendarDays;
  const weeks=payableDays/(statutoryType==="sick"?qualifyingDaysPerWeek:7);
  const neonatalClaim=statutoryType==="neonatal"?assessNeonatalCareClaim({childBirthDate,careStartDate:neonatalCareStartDate,careEndDate:neonatalCareEndDate,payStartDate:startDate,payEndDate:endDate,tier:neonatalTier,relationshipDeclaration,caringResponsibilityDeclaration}):null;
  async function loadEvents(){const response=await fetch(`/api/leave?employerId=${employerId}`),body=await response.json();if(response.ok)setEvents(body.filter((event:any)=>event.payrollId===(employee.payrollId||`PAY-${employee.id}-${taxYear.slice(0,4)}`)));}
  useEffect(()=>{
    fetch(`/api/employer?employerId=${employerId}`).then(response=>response.json()).then(body=>setSmallEmployer(Boolean(body.employer?.smallEmployersRelief))).catch(()=>undefined);
    fetch(`/api/calendar-days?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`).then(response=>response.json()).then(body=>setEmployerCalendarDays(body.days||[])).catch(()=>undefined);
    loadEvents().catch(()=>undefined);
  },[]);
  const groupedFamilyType=["maternity","adoption","paternity","shared-parental","bereavement"].includes(statutoryType);
  const priorFamilyClaims=groupedFamilyType?events.filter(event=>event.status!=="cancelled"&&event.subtype===statutoryType&&event.familyEventReference===familyEventReference):[];
  const touchDayType=["maternity","adoption","shared-parental"].includes(statutoryType);
  const priorTouchDays:StatutoryTouchDay[]=touchDayType?priorFamilyClaims.flatMap(event=>{try{const parsed=JSON.parse(event.statutoryTouchDays||"[]");return Array.isArray(parsed)?parsed:[];}catch{return [];}}):[];
  const priorWorkedWeeks:StatutoryWorkedWeek[]=touchDayType?priorFamilyClaims.flatMap(event=>{try{const parsed=JSON.parse(event.statutoryWorkedWeeks||"[]");return Array.isArray(parsed)?parsed:[];}catch{return [];}}):[];
  const familyClaim=["paternity","shared-parental","bereavement"].includes(statutoryType)?assessFamilyPayClaim({statutoryType:statutoryType as "paternity"|"shared-parental"|"bereavement",familyEventReference,familyEventDate,startDate,endDate,previousClaimedWeeks:priorFamilyClaims.reduce((sum,event)=>sum+event.qualifyingDays/7,0),previousBlocks:priorFamilyClaims.length,sharedPayWeeksAvailable}):null;
  const maternityAdoptionClaim=["maternity","adoption"].includes(statutoryType)?assessMaternityAdoptionPayClaim({
    statutoryType:statutoryType as "maternity"|"adoption",familyEventReference,familyEventDate,startDate,endDate,
    payPeriodStart:[startDate,...priorFamilyClaims.map(event=>event.statutoryPayPeriodStart||event.startDate)].sort()[0],
    previousClaimedDays:priorFamilyClaims.reduce((sum,event)=>sum+event.qualifyingDays,0),
  }):null;
  const touchDayAssessment=touchDayType?assessStatutoryTouchDays({
    statutoryType:statutoryType as "maternity"|"adoption"|"shared-parental",startDate,endDate,
    days:statutoryTouchDays,previousDays:priorTouchDays,
  }):null;
  const workedWeekAssessment=touchDayType?assessStatutoryWorkedWeeks({
    statutoryType,startDate,endDate,payPeriodStart:maternityAdoptionClaim?.payPeriodStart||startDate,
    workDates:ordinaryWorkDates,protectedDates:statutoryTouchDays.map(day=>day.date),previousWeeks:priorWorkedWeeks,
  }):null;
  const priorExcludedWeeks=priorFamilyClaims.filter(event=>event.endDate<startDate).reduce((sum,event)=>{try{const parsed=JSON.parse(event.statutoryWorkedWeeks||"[]");return sum+(Array.isArray(parsed)?parsed.length:0);}catch{return sum;}},0);
  const statutoryResult = calculateStatutoryPay(statutoryType, awe, weeks, smallEmployer,{payableDays,qualifyingDaysPerWeek,payPeriodDayOffset:maternityAdoptionClaim?.payPeriodDayOffset,excludedWeekOffsets:workedWeekAssessment?.excludedWeekOffsets,priorExcludedWeeks});
  const assessment=statutoryType==="none"?null:assessStatutoryEligibility({statutoryType,averageWeeklyEarnings:awe,continuousEmploymentWeeks:serviceWeeks,evidenceReceived,noticeReceived,inLegalCustody,sspEnding});
  const eligible=statutoryResult.eligible&&Boolean(assessment?.eligible)&&(!neonatalClaim||neonatalClaim.valid)&&(!familyClaim||familyClaim.valid)&&(!maternityAdoptionClaim||maternityAdoptionClaim.valid)&&(!touchDayAssessment||touchDayAssessment.valid)&&(!workedWeekAssessment||workedWeekAssessment.valid);
  const estimated = statutoryResult.total;
  const selectedRangeLabel=calendarDays?`${formatUkDate(startDate)} – ${formatUkDate(endDate)}`:"Select a valid date range";
  async function save(status:"draft"|"calculated") {
    setSaving(true);
    try {
      const response=await fetch("/api/leave",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId||`PAY-${employee.id}-${taxYear.slice(0,4)}`,type:leaveType,statutoryType,startDate,endDate,averageWeeklyEarnings:awe,averageWeeklyEarningsSource:aweBasis.averageWeeklyEarningsSource||"manual",aweRelevantDate,qualifyingDays:payableDays,qualifyingDaysPerWeek,qualifyingWeekdays:[...qualifyingWeekdaySet],status,continuousEmploymentWeeks:serviceWeeks,evidenceReceived,noticeReceived,inLegalCustody,sspEnding,childBirthDate,neonatalCareStartDate,neonatalCareEndDate,neonatalTier,relationshipDeclaration,caringResponsibilityDeclaration,familyEventReference,familyEventDate,familyEventKind,sharedPayWeeksAvailable,statutoryTouchDays,ordinaryWorkDates,notes:leaveNotes})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error||"Leave could not be saved.");
      saved(status==="draft"?"Leave event saved as a draft.":`Leave saved; statutory pay ${money(body.calculation.total)} and recovery ${money(body.calculation.recoverable)} calculated.`,status==="calculated"?body:undefined);
    } catch(error) { saved(error instanceof Error?error.message:"Leave could not be saved.",undefined,true); } finally { setSaving(false); }
  }
  async function calculateAwe(){
    setSaving(true);
    try{const response=await fetch(`/api/leave?employerId=${employerId}&action=calculate-awe&payrollId=${encodeURIComponent(employee.payrollId||`PAY-${employee.id}-${taxYear.slice(0,4)}`)}&relevantDate=${aweRelevantDate}`),body=await response.json();if(!response.ok)throw new Error(body.error);setAwe(body.averageWeeklyEarnings);setAweBasis({...body,averageWeeklyEarningsSource:"finalised-payroll"});saved(body.warning||`AWE ${money(body.averageWeeklyEarnings)} calculated from ${body.paymentCount} finalised payment${body.paymentCount===1?"":"s"}.`,undefined,true);}catch(error){saved(error instanceof Error?error.message:"AWE could not be calculated.",undefined,true);}finally{setSaving(false);}
  }
  async function cancelEvent(event:any){
    const response=await fetch("/api/leave",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:event.id,action:"cancel",reason:cancellationReasons[event.id]||""})}),body=await response.json();
    if(!response.ok)return saved(body.error||"Leave could not be cancelled.",undefined,true);await loadEvents();saved("Leave event cancelled with an audit record.",undefined,true);
  }
  async function issueNotice(){
    setSaving(true);
    try{
      const response=await fetch("/api/statutory-notices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId||`PAY-${employee.id}-${taxYear.slice(0,4)}`,statutoryType,payStartDate:startDate,payEndDate:endDate,averageWeeklyEarnings:awe,continuousEmploymentWeeks:serviceWeeks,evidenceReceived,noticeReceived,inLegalCustody,sspEnding})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      saved(`${body.formType} non-payment notice issued and retained in payroll records.`);
    }catch(error){saved(error instanceof Error?error.message:"Notice could not be issued.",undefined,true);}finally{setSaving(false);}
  }
  return <div className="modal-bg"><div className="modal calendar-modal leave-calendar-modal"><header><div><span className="eyebrow">LEAVE & STATUTORY PAY</span><h2>Add and calculate leave</h2></div><button onClick={close}>×</button></header><div className="form-body">
    <div className="leave-calendar-type-row"><label className="field"><span>Leave type</span><select value={leaveType} onChange={e=>{setLeaveType(e.target.value);setEndDateManuallyEdited(false);}}><option>Working day</option><option>Non-work day</option><option>Annual leave</option><option>Unpaid leave</option><option>Absent</option><option>On strike</option><option>Parental leave (unpaid)</option><option>Sick leave</option><option>Maternity leave</option><option>Paternity leave</option><option>Adoption leave</option><option>Shared parental leave</option><option>Shared parental leave (adoption)</option><option>Parental bereavement leave</option><option>Neonatal care leave</option></select></label><div><b>{automaticScheduleWeeks?"Select the statutory pay start date":"Select a date range"}</b><small>{automaticScheduleWeeks?`Choose one date. The ${automaticScheduleWeeks}-week statutory schedule and end date will be selected automatically.`:"Choose the first day, then the last day. You can move between months without losing the selection."}</small></div></div>
    <div className="leave-calendar-layout">
      <LeaveRangeCalendar startDate={startDate} endDate={endDate} selectionMode={automaticScheduleWeeks?"start":"range"} workingDays={qualifyingWeekdaySet} excludedDates={new Set(employerCalendarDays.filter(item=>item.status==="active").map(item=>item.date))} events={events} onChange={(rangeStart,rangeEnd)=>{setStartDate(rangeStart);if(automaticScheduleWeeks){setEndDateManuallyEdited(false);setEndDate(automaticStatutoryPayEndDate(statutoryType,rangeStart)||rangeStart);}else{setEndDate(rangeEnd);}}}/>
      <aside className="leave-calculation-summary"><span className="eyebrow">LIVE CALCULATION</span><h3>{selectedRangeLabel}</h3><div className="leave-calculation-state"><span className={`status ${statutoryType!=="none"&&!eligible?"amber":""}`}>{statutoryType==="none"?"Leave booking":eligible?"Eligible":"Review eligibility"}</span></div>
        {automaticScheduleWeeks&&<div className="leave-calculation-line"><span>Automatic statutory schedule</span><b>{automaticScheduleWeeks} weeks · ends {formatUkDate(endDate)}</b></div>}
        <div className="leave-calculation-line"><span>{automaticScheduleWeeks?"Calendar days scheduled":"Calendar days selected"}</span><b>{calendarDays}</b></div>
        <div className="leave-calculation-line"><span>{statutoryType==="sick"?"SSP qualifying days":"Scheduled working days"}</span><b>{payableDays}</b></div>
        <div className="leave-calculation-line"><span>Employer holidays excluded</span><b>{calendarExclusions.length}</b></div>
        {leaveType==="Annual leave"&&<div className="leave-calculation-line"><span>Projected entitlement remaining</span><b>{Math.max(0,leaveBalance.remaining-payableDays)} days</b></div>}
        <div className="leave-calculation-line"><span>90% of AWE</span><b>{money(ninetyPercent)} / week</b></div>
        <div className="leave-calculation-line"><span>Statutory rate</span><b>{money(statutoryWeekly)} / week</b></div>
        <div className="leave-calculation-line total"><span>Estimated statutory pay</span><strong>{money(eligible?estimated:0)}</strong></div>
        <div className="leave-calculation-line"><span>Recoverable from HMRC</span><b>{money(eligible?statutoryResult.recoverable:0)}</b></div>
        <small>{eligible?(leaveType==="Maternity leave"?`First ${Math.min(payableDays,42)} payable days use 90% of AWE; later eligible days use the lower statutory rate.`:`${payableDays} payable day${payableDays===1?"":"s"} currently feed the payroll calculation.`):assessment?.reason||"Select the dates and complete the evidence below."} The working-day total is derived from the recorded date range, working pattern and employer calendar.</small>
      </aside>
    </div>
    <div className="form-grid leave-supporting-fields"><label className="field"><span>Average weekly earnings</span><input aria-label="Average weekly earnings" type="number" value={awe} onChange={event=>{setAwe(Number(event.target.value));setAweBasis({averageWeeklyEarningsSource:"manual"});}}/><small>{aweBasis.averageWeeklyEarningsSource==="finalised-payroll"?`${aweBasis.method} · ${formatUkDate(aweBasis.relevantPeriodStart)} to ${formatUkDate(aweBasis.relevantPeriodEnd)} · ${money(aweBasis.relevantPayTotal)}`:"Manual value — retain supporting evidence"}</small><button type="button" disabled={saving||!aweRelevantDate} onClick={calculateAwe}>Calculate from finalised pay</button></label><Field label="AWE relevant date / first SSP day" value={aweRelevantDate} type="date" onChange={setAweRelevantDate}/><Field label={automaticScheduleWeeks?"Statutory pay start date":"Start date"} value={startDate} type="date" onChange={value=>{setStartDate(value);if(automaticScheduleWeeks)setEndDateManuallyEdited(false);}}/>{automaticScheduleWeeks?<label className="field"><span>Calculated statutory pay end</span><input aria-label="Calculated statutory pay end" type="date" value={endDate} onChange={event=>{setEndDate(event.target.value);setEndDateManuallyEdited(true);}}/><small>{endDateManuallyEdited?"Manual end-date override — the statutory maximum and complete-week checks still apply.":`Automatically set to ${automaticScheduleWeeks} weeks from the selected start date.`}</small>{endDateManuallyEdited&&<button type="button" className="text-button" onClick={()=>{setEndDateManuallyEdited(false);if(automaticScheduleEnd)setEndDate(automaticScheduleEnd);}}>Restore automatic end date</button>}</label>:<Field label="Expected / end date" value={endDate} type="date" onChange={setEndDate}/>}<Field label={statutoryType==="sick"?"Qualifying sickness days":workPatternLeave?"Scheduled leave days":"Calendar payable days"} value={String(payableDays)}/>{(statutoryType==="sick"||workPatternLeave)&&<label className="field"><span>{statutoryType==="sick"?"SSP qualifying work pattern":"Scheduled working pattern"}</span><select value={qualifyingWeekdays} onChange={event=>{const value=event.target.value;setQualifyingWeekdays(value);setQualifyingDaysPerWeek(value.split(",").length);}}><option value="1,2,3,4,5">Monday to Friday</option><option value="1,2,3,4">Monday to Thursday</option><option value="2,3,4,5,6">Tuesday to Saturday</option><option value="5,6,7">Friday to Sunday</option><option value="1,2,3,4,5,6,7">Every day</option></select></label>}<Field label="Continuous service at qualifying week" value={String(serviceWeeks)} type="number" onChange={v=>setServiceWeeks(+v)}/></div>{calendarExclusions.length>0&&<div className="portal-message valid"><b>{calendarExclusions.length} employer calendar day{calendarExclusions.length===1?" is":"s are"} excluded from this booking.</b><br/>{calendarExclusions.map(item=>`${formatUkDate(item.date)} · ${item.name}`).join(" · ")}. The excluded dates are frozen into the leave record.</div>}
    {groupedFamilyType&&<section className="neonatal-evidence"><div className="form-title"><h3>Family-pay entitlement</h3><p>Use the same reference and event details for every related record so the remaining entitlement and statutory-rate timeline are enforced cumulatively.</p></div><div className="form-grid"><Field label="Family-event reference" value={familyEventReference} onChange={setFamilyEventReference}/><Field label={statutoryType==="bereavement"?"Death, stillbirth or miscarriage date":statutoryType==="maternity"?"Expected or actual birth date":"Birth or placement date"} value={familyEventDate} type="date" onChange={setFamilyEventDate}/><label className="field"><span>Family-event type</span><select value={familyEventKind} disabled={["maternity","adoption"].includes(statutoryType)} onChange={event=>setFamilyEventKind(event.target.value)}>{statutoryType==="bereavement"?<><option value="death">Death of child</option><option value="stillbirth">Stillbirth</option><option value="miscarriage">Miscarriage from 6 April 2026</option></>:statutoryType==="maternity"?<option value="birth">Birth</option>:statutoryType==="adoption"?<option value="adoption">Adoption placement</option>:<><option value="birth">Birth</option><option value="adoption">Adoption placement</option></>}</select></label>{statutoryType==="shared-parental"&&<Field label="ShPP weeks made available" value={String(sharedPayWeeksAvailable)} type="number" onChange={value=>setSharedPayWeeksAvailable(Number(value))}/>}</div>{statutoryType==="bereavement"&&<div className="portal-message">For events from 6 April 2026, Statutory Parental Bereavement Pay is a day-one right. Use actual or reasonably expected weekly earnings and retain the employee’s written self-declaration; medical evidence is not required for miscarriage.</div>}{familyClaim&&<div className={`portal-message ${familyClaim.valid?"valid":""}`}>{familyClaim.valid?`Block ${familyClaim.blockNumber}: ${familyClaim.claimedWeeks} week(s), leaving ${familyClaim.remainingWeeks} week(s) for this family event.`:familyClaim.error}</div>}{maternityAdoptionClaim&&<div className={`portal-message ${maternityAdoptionClaim.valid?"valid":""}`}>{maternityAdoptionClaim.valid?`${maternityAdoptionClaim.claimedDays/7} week(s) in this record; ${maternityAdoptionClaim.remainingDays/7} payable week(s) remain before the pay period ends on ${formatUkDate(maternityAdoptionClaim.payPeriodEnd)}.`:maternityAdoptionClaim.error}</div>}</section>}
    {touchDayType&&<section className="neonatal-evidence"><div className="form-title"><h3>{statutoryType==="shared-parental"?"SPLIT":"KIT"} work days</h3><p>Any amount of agreed work counts as one full protected day. These days do not reduce statutory pay, but the cumulative legal limit is enforced across every related record.</p></div><div className="form-grid"><Field label={`New ${statutoryType==="shared-parental"?"SPLIT":"KIT"} day`} value={touchDayDate} type="date" onChange={setTouchDayDate}/><button type="button" disabled={!touchDayDate||touchDayDate<startDate||touchDayDate>endDate||statutoryTouchDays.some(day=>day.date===touchDayDate)||priorTouchDays.some(day=>day.date===touchDayDate)} onClick={()=>{const kind:StatutoryTouchDay["kind"]=statutoryType==="shared-parental"?"split":"kit";setStatutoryTouchDays(current=>[...current,{date:touchDayDate,kind}].sort((a,b)=>a.date.localeCompare(b.date)));setTouchDayDate("");}}>Add protected work day</button></div>{statutoryTouchDays.length>0&&<div className="validation-list">{statutoryTouchDays.map(day=><div key={day.date}><span>✓</span><p><b>{day.kind.toUpperCase()} · {formatUkDate(day.date)}</b><small>Agreed work or training; counts as one full protected day.</small></p><button type="button" onClick={()=>setStatutoryTouchDays(current=>current.filter(item=>item.date!==day.date))}>Remove</button></div>)}</div>}{touchDayAssessment&&<div className={`portal-message ${touchDayAssessment.valid?"valid":""}`}>{touchDayAssessment.valid?`${touchDayAssessment.usedDays} of ${touchDayAssessment.limit} protected ${touchDayAssessment.kind.toUpperCase()} days used for this family event; ${touchDayAssessment.remainingDays} remain.`:touchDayAssessment.error}</div>}<small>Contractual pay for work must be entered separately as a payroll earning. Further work after the protected limit belongs in the ordinary worked-week exclusion workflow.</small></section>}
    {statutoryType==="neonatal"&&<section className="neonatal-evidence"><div className="form-title"><h3>Neonatal care evidence</h3><p>Pay accrues as one week for every 7 consecutive full days in neonatal care, up to 12 weeks.</p></div><div className="form-grid"><Field label="Baby’s date of birth" value={childBirthDate} type="date" onChange={setChildBirthDate}/><Field label="First full day in neonatal care" value={neonatalCareStartDate} type="date" onChange={setNeonatalCareStartDate}/><Field label="Last full day in neonatal care" value={neonatalCareEndDate} type="date" onChange={setNeonatalCareEndDate}/><label className="field"><span>Claim tier</span><select value={neonatalTier} onChange={event=>setNeonatalTier(event.target.value as "tier-1"|"tier-2")}><option value="tier-1">Tier 1 · care or first week after discharge</option><option value="tier-2">Tier 2 · later continuous block</option></select></label></div><Check text="Employee has the required parental or partner relationship to the baby" checked={relationshipDeclaration} onChange={setRelationshipDeclaration}/><Check text="Employee has caring responsibility and is taking leave to care for the baby" checked={caringResponsibilityDeclaration} onChange={setCaringResponsibilityDeclaration}/>{neonatalClaim&&<div className={`portal-message ${neonatalClaim.valid?"valid":""}`}>{neonatalClaim.valid?`${neonatalClaim.accruedWeeks} week(s) accrued from ${neonatalClaim.careDays} recorded care days; this claim uses ${neonatalClaim.claimedWeeks} week(s).`:neonatalClaim.error}</div>}</section>}
    <div className="eligibility-checks"><Check text={statutoryType==="bereavement"?"Day-one bereavement-pay service rule applies":"Employee meets continuity of employment test"} checked={statutoryType==="sick"||statutoryType==="bereavement"||serviceWeeks>=26}/><Check text="Average earnings meet the applicable test" checked={statutoryResult.eligible}/><Check text="Required notice received" checked={noticeReceived} onChange={setNoticeReceived}/><Check text={statutoryType==="bereavement"?"Written self-declaration received":"Required evidence received"} checked={evidenceReceived} onChange={setEvidenceReceived}/>{statutoryType!=="none"&&<Check text="Employee is in legal custody during the statutory-pay period" checked={inLegalCustody} onChange={setInLegalCustody}/>} {statutoryType==="sick"&&<Check text="SSP entitlement is ending; issue SSP1" checked={sspEnding} onChange={setSspEnding}/>}</div>
    {touchDayType&&<section className="neonatal-evidence"><div className="form-title"><h3>Ordinary work and unpaid statutory weeks</h3><p>Record work that is not an agreed protected {statutoryType==="shared-parental"?"SPLIT":"KIT"} day. Any day or part-day removes statutory pay for its whole statutory-pay week; the original pay-period end date does not move.</p></div><div className="form-grid"><Field label="Ordinary work date" value={ordinaryWorkDate} type="date" onChange={setOrdinaryWorkDate}/><button type="button" disabled={!ordinaryWorkDate||ordinaryWorkDate<startDate||ordinaryWorkDate>endDate||ordinaryWorkDates.includes(ordinaryWorkDate)||statutoryTouchDays.some(day=>day.date===ordinaryWorkDate)} onClick={()=>{setOrdinaryWorkDates(current=>[...current,ordinaryWorkDate].sort());setOrdinaryWorkDate("");}}>Exclude affected pay week</button></div>{workedWeekAssessment&&workedWeekAssessment.weeks.length>0&&<div className="validation-list">{workedWeekAssessment.weeks.map(week=><div key={week.weekStart}><span>!</span><p><b>Week beginning {formatUkDate(week.weekStart)}</b><small>Ordinary work recorded on {formatUkDate(week.workDate)}; no statutory pay is due for this week.</small></p><button type="button" onClick={()=>setOrdinaryWorkDates(current=>current.filter(date=>date!==week.workDate))}>Remove</button></div>)}</div>}{workedWeekAssessment&&<div className={`portal-message ${workedWeekAssessment.valid?"valid":""}`}>{workedWeekAssessment.valid?`${workedWeekAssessment.excludedWeeks} statutory-pay week(s) excluded in this record. The entitlement period still ends on ${formatUkDate(maternityAdoptionClaim?.payPeriodEnd||endDate)}.`:workedWeekAssessment.error}</div>}<small>Enter contractual earnings for the worked time separately. Statutory pay and HMRC recovery exclude these weeks automatically.</small></section>}
    {!statutoryRulesAvailable&&statutoryType!=="none"&&<div className="portal-message">Statutory payment rates for {taxYear} are not installed. Record leave as a draft only; calculation and non-payment forms remain locked to prevent use of 2026/27 rates.</div>}
    {assessment&&!assessment.eligible&&<div className="portal-message">{assessment.reason} A {assessment.formType} non-payment notice is required.</div>}
    <label className="field full"><span>Notes and evidence</span><textarea value={leaveNotes} onChange={event=>setLeaveNotes(event.target.value)} /></label>
    <section className="operation-card"><div className="card-head"><div><h3>Employee leave register</h3><p>Cancelled events remain in the audit history. Events affecting finalised payroll must be corrected through the payroll reopening workflow.</p></div><span>{leaveBalance.remaining} days remaining</span></div><div className="payroll-status-strip"><div><span>Contractual annual</span><strong>{leaveBalance.contractual} days</strong></div><div><span>Prorated entitlement</span><strong>{leaveBalance.entitlement} days</strong></div><div><span>Approved annual leave</span><strong>{leaveBalance.used} days</strong></div></div><table><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>AWE basis</th><th>Statutory pay</th><th>Status</th><th>Action</th></tr></thead><tbody>{events.map(event=><tr key={event.id}><td>{event.type}</td><td>{formatUkDate(event.startDate)} to {formatUkDate(event.endDate)}</td><td>{event.qualifyingDays}</td><td>{money(event.averageWeeklyEarnings)}<small>{event.averageWeeklyEarningsSource||"manual"}</small></td><td>{money(event.statutoryAmount)}</td><td>{event.status}</td><td>{event.status!=="cancelled"&&<><input aria-label={`Cancellation reason for ${event.id}`} placeholder="Cancellation reason" value={cancellationReasons[event.id]||""} onChange={change=>setCancellationReasons(current=>({...current,[event.id]:change.target.value}))}/><button disabled={(cancellationReasons[event.id]||"").trim().length<5} onClick={()=>cancelEvent(event)}>Cancel event</button></>}</td></tr>)}</tbody></table>{!events.length&&<div className="empty-workflow"><p>No leave events have been recorded for this employee.</p></div>}</section>
  </div><footer><button onClick={close}>Cancel</button><button disabled={saving||calendarDays<=0} onClick={()=>save("draft")}>Save draft</button>{assessment&&!assessment.eligible&&statutoryType!=="none"?<button disabled={saving||calendarDays<=0||!statutoryRulesAvailable} className="primary" onClick={issueNotice}>Issue {assessment.formType}</button>:<button disabled={saving||calendarDays<=0||(!eligible&&statutoryType!=="none")||(statutoryType!=="none"&&!statutoryRulesAvailable)} className="primary" onClick={()=>save("calculated")}>{saving?"Saving…":statutoryType==="none"?"Save leave event":"Save leave & add statutory pay"}</button>}</footer></div></div>;
}

function EmployeeLoanModal({employee,close,saved}:{employee:Employee;close:()=>void;saved:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId();
  const [loans,setLoans]=useState<any[]>([]),[history,setHistory]=useState<any[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [type,setType]=useState("loan"),[reference,setReference]=useState(""),[originalAmount,setOriginalAmount]=useState(0),[regularDeduction,setRegularDeduction]=useState(0),[startDate,setStartDate]=useState(new Date().toISOString().slice(0,10));
  async function load(){
    setLoading(true);
    try{const response=await fetch(`/api/employee-loans?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error);setLoans((body.loans||[]).filter((item:any)=>item.payrollId===employee.payrollId));setHistory(body.history||[]);}
    catch(error){saved(error instanceof Error?error.message:"Employee loan ledgers could not be loaded.",false);}finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  async function create(){
    setSaving(true);
    try{const response=await fetch("/api/employee-loans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId,type,reference,originalAmount,regularDeduction,startDate})}),body=await response.json();if(!response.ok)throw new Error(body.error);setReference("");setOriginalAmount(0);setRegularDeduction(0);await load();saved(`${type.replace("-"," ")} ledger created. The deduction starts with the first eligible finalised payroll.`);}
    catch(error){saved(error instanceof Error?error.message:"Employee loan ledger could not be created.",false);}finally{setSaving(false);}
  }
  async function update(id:number,action:"suspend"|"resume"|"stop"){
    const response=await fetch("/api/employee-loans",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id,action})}),body=await response.json();
    if(!response.ok)return saved(body.error||"Employee loan ledger could not be updated.",false);
    await load();saved(`Employee loan ledger ${action==="stop"?"stopped":`${action}d`}.`);
  }
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">EMPLOYEE RECOVERIES</span><h2>{employee.name}</h2></div><button onClick={close}>×</button></header><div className="form-body"><section className="operation-card"><div className="card-head"><div><h3>Create balance ledger</h3><p>Recover a loan, wage advance or payroll overpayment from available take-home pay.</p></div></div><div className="form-grid"><label className="field"><span>Recovery type</span><select value={type} onChange={event=>setType(event.target.value)}><option value="loan">Employee loan</option><option value="advance">Wage advance</option><option value="overpayment">Overpayment recovery</option></select></label><Field label="Reference" value={reference} onChange={setReference}/><Field label="Original amount" value={String(originalAmount)} type="number" onChange={value=>setOriginalAmount(Number(value))}/><Field label="Regular monthly deduction" value={String(regularDeduction)} type="number" onChange={value=>setRegularDeduction(Number(value))}/><Field label="Recovery starts" value={startDate} type="date" onChange={setStartDate}/></div><button className="primary" disabled={saving||reference.trim().length<3||originalAmount<=0||regularDeduction<=0||!startDate} onClick={create}>{saving?"Saving…":"Create recovery ledger"}</button></section>{loading?<div className="empty-workflow"><p>Loading recovery ledgers…</p></div>:loans.length?<table><thead><tr><th>Type / reference</th><th>Original</th><th>Regular</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>{loans.map(loan=><tr key={loan.id}><td><b>{loan.type}</b><small>{loan.reference} · starts {formatUkDate(loan.startDate)}</small></td><td>{money(loan.originalAmount)}</td><td>{money(loan.regularDeduction)}</td><td>{money(loan.balance)}</td><td>{loan.status}</td><td>{loan.status==="active"?<><button onClick={()=>update(loan.id,"suspend")}>Suspend</button><button onClick={()=>update(loan.id,"stop")}>Stop</button></>:loan.status==="suspended"?<button onClick={()=>update(loan.id,"resume")}>Resume</button>:null}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No loan, advance or overpayment ledger exists for this employee.</p></div>}{history.some(item=>loans.some(loan=>loan.id===item.employeeLoanId))&&<div className="validation-list">{history.filter(item=>loans.some(loan=>loan.id===item.employeeLoanId)).slice(0,12).map(item=><div key={item.id}><span>✓</span><p><b>{money(item.amount)} recovered</b><small>Balance {money(item.balanceBefore)} → {money(item.balanceAfter)} · finalised pay run #{item.payRunId}</small></p></div>)}</div>}<small>Legal or contractual consent and minimum-wage implications must be reviewed by the employer. Court orders belong in the attachment-order workflow.</small></div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function CashPayRoundingModal({employee,close,saved}:{employee:Employee;close:()=>void;saved:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId();
  const [setting,setSetting]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[unit,setUnit]=useState(1),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/pay-rounding?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      const current=(body.settings||[]).find((item:any)=>item.payrollId===employee.payrollId)||null;
      setSetting(current);setUnit(current?.unit||1);setHistory((body.history||[]).filter((item:any)=>item.employeePayRoundingId===current?.id));
    }catch(error){saved(error instanceof Error?error.message:"Cash-rounding ledger could not be loaded.",false);}finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  async function create(){
    setSaving(true);
    try{
      const response=await fetch("/api/pay-rounding",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId,unit})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();saved(`Cash pay will be rounded down to £${unit}; each unpaid remainder will carry into the next eligible payroll.`);
    }catch(error){saved(error instanceof Error?error.message:"Cash rounding could not be enabled.",false);}finally{setSaving(false);}
  }
  async function update(action:"suspend"|"resume"|"stop"|"change-unit"){
    if(!setting)return;setSaving(true);
    try{
      const response=await fetch("/api/pay-rounding",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:setting.id,action,unit})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();saved(action==="change-unit"?`Cash rounding unit changed to £${unit}.`:`Cash rounding ${action}d.`);
    }catch(error){saved(error instanceof Error?error.message:"Cash-rounding ledger could not be updated.",false);}finally{setSaving(false);}
  }
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">CASH PAYMENTS</span><h2>{employee.name}</h2></div><button onClick={close}>×</button></header><div className="form-body">{employee.paymentMethod!=="cash"&&<div className="portal-message">Set this employee’s payment method to cash before enabling or resuming pay rounding.</div>}<section className="operation-card"><div className="card-head"><div><h3>Round cash paid and carry the remainder</h3><p>The employee’s exact statutory net is retained as evidence. Physical cash is rounded down and the unpaid balance carries forward.</p></div><span className={`status ${setting?.status==="active"?"":"amber"}`}>{setting?.status||"Not enabled"}</span></div><div className="form-grid"><label className="field"><span>Round cash down to</span><select value={unit} onChange={event=>setUnit(Number(event.target.value))}><option value={1}>Nearest £1</option><option value={5}>Nearest £5</option><option value={10}>Nearest £10</option></select></label><Field label="Current carried balance" value={money(setting?.carry||0)}/></div>{!loading&&!setting?<button className="primary" disabled={saving||employee.paymentMethod!=="cash"} onClick={create}>Enable cash rounding</button>:setting&&<div className="tool-actions"><button disabled={saving||setting.status!=="active"} onClick={()=>update("suspend")}>Suspend</button><button disabled={saving||setting.status!=="suspended"||employee.paymentMethod!=="cash"} onClick={()=>update("resume")}>Resume</button><button disabled={saving||Number(setting.carry)>.005||setting.status==="stopped"} onClick={()=>update("stop")}>Stop</button><button disabled={saving||Number(setting.carry)>.005||Number(unit)===Number(setting.unit)} onClick={()=>update("change-unit")}>Change unit</button></div>}</section>{history.length>0&&<div className="validation-list">{history.slice(0,12).map(item=><div key={item.id}><span>£</span><p><b>{money(item.roundedNet)} cash paid</b><small>{money(item.unroundedNet)} current net + {money(item.openingCarry)} opening carry → {money(item.closingCarry)} carried</small></p></div>)}</div>}<div className="portal-message">Rounding does not change gross pay, PAYE, NIC, pension, attachment orders or loan recovery. A payment after leaving is deliberately excluded from automatic cash rounding.</div></div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function HolidayFundModal({employee,period,periodLocked,periodStart,close,saved}:{employee:Employee;period:number;periodLocked:boolean;periodStart:string;close:()=>void;saved:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [setting,setSetting]=useState<any>(null),[entries,setEntries]=useState<any[]>([]),[retentionNotice,setRetentionNotice]=useState("");
  const [schemeType,setSchemeType]=useState<"employer-accrual"|"employee-savings"|"rolled-up">("employer-accrual");
  const [workerType,setWorkerType]=useState<"regular-hours"|"irregular-hours"|"part-year">("regular-hours");
  const [accrualRate,setAccrualRate]=useState(0),[openingBalance,setOpeningBalance]=useState(0),[contractConfirmed,setContractConfirmed]=useState(false),[startDate,setStartDate]=useState(periodStart);
  const [manualAdded,setManualAdded]=useState(0),[requestedPaid,setRequestedPaid]=useState(0),[referencePayOverride,setReferencePayOverride]=useState("");
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/holiday-funds?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      const current=(body.settings||[]).find((item:any)=>Number(item.employeeId)===employee.id)||null;
      const employeeEntries=(body.entries||[]).filter((item:any)=>Number(item.employeeId)===employee.id);
      setSetting(current);setEntries(employeeEntries);setRetentionNotice(body.retentionNotice||"");
      if(current){
        setSchemeType(current.schemeType);setWorkerType(current.workerType);setAccrualRate(Number(current.accrualRate));
        setOpeningBalance(Number(current.openingBalance));setContractConfirmed(Boolean(current.contractConfirmed));setStartDate(current.startDate);
      }
      const currentEntry=employeeEntries.find((item:any)=>item.taxYear===taxYear&&Number(item.periodNumber)===period);
      setManualAdded(Number(currentEntry?.manualAdded||0));setRequestedPaid(Number(currentEntry?.requestedPaid||0));
      setReferencePayOverride(currentEntry?.referencePayOverride===null||currentEntry?.referencePayOverride===undefined?"":String(currentEntry.referencePayOverride));
    }catch(error){saved(error instanceof Error?error.message:"Holiday-pay records could not be loaded.",false);}finally{setLoading(false);}
  }
  useEffect(()=>{load();},[employee.id,period,taxYear]);
  async function configure(){
    setBusy(true);
    try{
      const response=await fetch("/api/holiday-funds",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        employerId,employeeId:employee.id,action:"configure",schemeType,workerType,accrualRate,openingBalance,contractConfirmed,startDate,
      })}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();saved("Holiday-pay arrangement saved. Payroll will preserve a period-by-period fund ledger.");
    }catch(error){saved(error instanceof Error?error.message:"Holiday-pay arrangement could not be saved.",false);}finally{setBusy(false);}
  }
  async function savePeriod(){
    setBusy(true);
    try{
      const response=await fetch("/api/holiday-funds",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        employerId,employeeId:employee.id,action:"set-period",taxYear,periodNumber:period,manualAdded,requestedPaid,
        referencePayOverride:referencePayOverride===""?null:Number(referencePayOverride),
      })}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();saved(`Holiday-pay values saved for period ${period}. Save payroll to calculate the frozen ledger entry.`);
    }catch(error){saved(error instanceof Error?error.message:"Holiday-pay period values could not be saved.",false);}finally{setBusy(false);}
  }
  async function changeStatus(action:"suspend"|"restore"){
    if(!setting)return;setBusy(true);
    try{
      const response=await fetch("/api/holiday-funds",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:setting.id,action})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();saved(`Holiday-pay arrangement ${action==="restore"?"restored":"suspended"}.`);
    }catch(error){saved(error instanceof Error?error.message:"Holiday-pay arrangement could not be updated.",false);}finally{setBusy(false);}
  }
  const currentEntry=entries.find(item=>item.taxYear===taxYear&&Number(item.periodNumber)===period);
  return <div className="modal-bg"><div className="modal calendar-modal holiday-fund-modal"><header><div><span className="eyebrow">HOLIDAY PAY &amp; FUNDS</span><h2>{employee.name}</h2><p>Period {period} · {taxYear}</p></div><button onClick={close}>×</button></header><div className="form-body">
    <div className="portal-message">Rolled-up holiday pay is limited to irregular-hours and part-year workers. It must be separately identified on the payslip and paid alongside ordinary earnings; regular-hours workers must receive holiday pay when leave is taken.</div>
    <section className="operation-card"><div className="card-head"><div><h3>Arrangement</h3><p>Choose whether the employer accrues a taxable fund, the employee saves from net pay, or eligible holiday pay is rolled up.</p></div><span className={`status ${setting?.status==="active"?"":"amber"}`}>{loading?"Loading…":setting?.status||"Not configured"}</span></div>
      <div className="form-grid"><label className="field"><span>Scheme</span><select value={schemeType} disabled={busy} onChange={event=>{const value=event.target.value as typeof schemeType;setSchemeType(value);if(value==="rolled-up"){setAccrualRate(accrualRate||12.07);setOpeningBalance(0);}}}><option value="employer-accrual">Employer holiday fund</option><option value="employee-savings">Employee holiday savings</option><option value="rolled-up">Rolled-up holiday pay</option></select></label>
      <label className="field"><span>Working pattern</span><select value={workerType} disabled={busy} onChange={event=>setWorkerType(event.target.value as typeof workerType)}><option value="regular-hours">Regular hours</option><option value="irregular-hours">Irregular hours</option><option value="part-year">Part-year</option></select></label>
      <Field label={schemeType==="employee-savings"?"Automatic saving rate (%)":"Holiday-pay rate (%)"} value={String(accrualRate)} type="number" onChange={value=>setAccrualRate(Number(value))}/>
      <Field label="Opening fund balance" value={String(openingBalance)} type="number" onChange={schemeType==="rolled-up"?undefined:value=>setOpeningBalance(Number(value))}/>
      <Field label="Arrangement starts" value={startDate} type="date" onChange={setStartDate}/>
      <Field label="Current reconciled balance" value={money(setting?.currentBalance??openingBalance)}/></div>
      {schemeType==="rolled-up"&&<Check text="The contract permits separately identified rolled-up holiday pay" checked={contractConfirmed} onChange={setContractConfirmed}/>}
      <div className="tool-actions"><button className="primary" disabled={busy||!startDate||accrualRate<0||openingBalance<0||(schemeType==="rolled-up"&&(!["irregular-hours","part-year"].includes(workerType)||!contractConfirmed||accrualRate<=0))} onClick={configure}>{setting?"Update arrangement":"Create arrangement"}</button>{setting?.status==="active"&&<button disabled={busy} onClick={()=>changeStatus("suspend")}>Suspend</button>}{setting?.status==="suspended"&&<button disabled={busy} onClick={()=>changeStatus("restore")}>Restore</button>}</div>
    </section>
    {setting&&<section className="operation-card"><div className="card-head"><div><h3>Period {period} instructions</h3><p>{schemeType==="rolled-up"?"Payroll calculates the percentage from eligible earnings. Supply reference pay only when statutory absence replaces current earnings.":schemeType==="employee-savings"?"Contributions are deducted after tax; withdrawals are not taxed or NICed again.":"Fund withdrawals are employer-funded holiday pay and will be subject to PAYE and NIC."}</p></div><span className={`status ${periodLocked?"amber":currentEntry?.status==="finalised"?"":"blue"}`}>{periodLocked?"Period locked":currentEntry?.status||"Not entered"}</span></div>
      <div className="form-grid">{schemeType!=="rolled-up"&&<Field label={accrualRate>0?"Manual amount (used when rate is 0%)":"Amount added this period"} value={String(manualAdded)} type="number" onChange={periodLocked?undefined:value=>setManualAdded(Number(value))}/>}
      {schemeType!=="rolled-up"&&<Field label={schemeType==="employee-savings"?"Savings withdrawn":"Holiday fund paid"} value={String(requestedPaid)} type="number" onChange={periodLocked?undefined:value=>setRequestedPaid(Number(value))}/>}
      {schemeType==="rolled-up"&&<Field label="52-week average reference pay (only during statutory absence)" value={referencePayOverride} type="number" onChange={periodLocked?undefined:setReferencePayOverride}/>}</div>
      <button className="primary" disabled={busy||periodLocked||setting.status!=="active"||manualAdded<0||requestedPaid<0||Number(referencePayOverride||0)<0} onClick={savePeriod}>Save period instructions</button>
    </section>}
    {entries.length>0&&<section className="operation-card"><div className="card-head"><div><h3>Holiday-pay ledger</h3><p>Each processed period freezes the inputs, tax treatment and reconciled balance.</p></div></div><div className="report-table-scroll"><table><thead><tr><th>Period</th><th>Scheme</th><th>Base</th><th>Added</th><th>Paid</th><th>Balance</th><th>Treatment</th><th>Status</th></tr></thead><tbody>{entries.slice().reverse().map(item=><tr key={item.id}><td>{item.periodNumber} · {item.taxYear}</td><td>{String(item.schemeType).replaceAll("-"," ")}</td><td>{money(Number(item.accrualBase||0))}</td><td>{money(Number(item.addedAmount||0))}</td><td>{money(Number(item.paidAmount||0))}</td><td>{money(Number(item.balanceAfter||0))}</td><td>{Number(item.taxablePay)>0?"PAYE & NIC":Number(item.postTaxDeduction)>0?"Net-pay saving":"No new tax"}</td><td>{item.status}</td></tr>)}</tbody></table></div></section>}
    <small>{retentionNotice||"Retain the contract, leave and holiday-pay calculation evidence for the statutory record period."}</small>
  </div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function ChildcareVoucherModal({close,add}:{close:()=>void;add:(items:PayLine[])=>void}){
  const payFrequency=usePayFrequency();
  const [amount,setAmount]=useState(()=>childcareVoucherLimit("basic",payFrequency)),[taxBand,setTaxBand]=useState<ChildcareTaxBand>("basic"),[legacyMember,setLegacyMember]=useState(false),[qualifyingChildcare,setQualifyingChildcare]=useState(false),[schemeAvailable,setSchemeAvailable]=useState(false),[error,setError]=useState("");
  let calculation:ReturnType<typeof calculateChildcareVoucher>|null=null;
  try{if(legacyMember&&qualifyingChildcare&&schemeAvailable)calculation=calculateChildcareVoucher({amount,taxBand,eligibleLegacyMember:true,payFrequency});}catch{}
  function save(){
    setError("");
    if(!qualifyingChildcare||!schemeAvailable){setError("Confirm registered or approved childcare and the employer-wide qualifying scheme conditions.");return;}
    let result;
    try{result=calculateChildcareVoucher({amount,taxBand,eligibleLegacyMember:legacyMember,payFrequency});}catch(caught){setError(caught instanceof Error?caught.message:"Childcare voucher could not be calculated.");return;}
    const base=Date.now(),lines:PayLine[]=[{id:base,type:"childcare-voucher",name:childcareVoucherName(taxBand),amount:result.amount,taxable:false,nicable:false,pensionable:true}];
    if(result.class1Excess>0)lines.push({id:base+1,type:"benefit",name:"Childcare voucher excess · Class 1 NIC and P11D",amount:result.class1Excess,taxable:false,nicable:true,pensionable:false});
    add(lines);
  }
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">LEGACY CHILDCARE</span><h2>Childcare voucher salary sacrifice</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="portal-message">Childcare voucher schemes closed to new applicants on 4 October 2018. Do not use this workflow for Tax-Free Childcare, a cash childcare allowance or an employee who has left the legacy scheme.</div><div className="form-grid"><Field label={`${payFrequency.replace("-"," ")} voucher amount`} value={String(amount)} type="number" onChange={value=>setAmount(Number(value))}/><label className="field"><span>Basic earnings assessment</span><select value={taxBand} onChange={event=>{const band=event.target.value as ChildcareTaxBand;setTaxBand(band);setAmount(childcareVoucherLimit(band,payFrequency));}}><option value="basic">Basic rate · {money(childcareVoucherLimit("basic",payFrequency))} per period</option><option value="higher">Higher rate · {money(childcareVoucherLimit("higher",payFrequency))} per period</option><option value="additional">Additional rate · {money(childcareVoucherLimit("additional",payFrequency))} per period</option></select></label></div><Check text="Employee remains eligible in this employer’s pre-4 October 2018 scheme" checked={legacyMember} onChange={setLegacyMember}/><Check text="Voucher is for registered or approved qualifying childcare" checked={qualifyingChildcare} onChange={setQualifyingChildcare}/><Check text="Scheme satisfies the all-employees or qualifying-location availability condition" checked={schemeAvailable} onChange={setSchemeAvailable}/>{error&&<div className="portal-message">{error}</div>}{calculation&&<div className="statutory-breakdown"><div><span>Salary sacrificed</span><b>{money(calculation.amount)}</b></div><div><span>Tax and NIC exempt</span><b>{money(calculation.exempt)}</b></div><div><span>Class 1 NIC and P11D excess</span><strong>{money(calculation.class1Excess)}</strong></div><small>The excess is not subjected to PAYE through payroll, but attracts Class 1 NIC and must be included in benefits reporting. The exempt limit is applied for this employer&apos;s {payFrequency.replace("-"," ")} pay interval.</small></div>}</div><footer><button onClick={close}>Cancel</button><button className="primary" disabled={!calculation||!legacyMember||!qualifyingChildcare||!schemeAvailable} onClick={save}>Add childcare vouchers</button></footer></div></div>;
}

function MileageAllowanceModal({employee,priorMileageMiles,close,add}:{employee:Employee;priorMileageMiles:Record<string,number>;close:()=>void;add:(items:PayLine[])=>void}){
  const taxYear=useTaxYear();
  const [vehicle,setVehicle]=useState<MileageVehicle>("car-van"),[miles,setMiles]=useState(0),[paidRate,setPaidRate]=useState(.55),[error,setError]=useState("");
  const currentMiles=(employee.payItems||[]).filter(item=>item.name===`Mileage allowance · ${vehicle} · approved`).reduce((sum,item)=>sum+Number(item.quantity||0),0);
  const ytdMiles=Number(priorMileageMiles[vehicle]||0)+currentMiles;
  let calculation:ReturnType<typeof calculateMileageAllowance>|null=null;
  try{if(miles>0)calculation=calculateMileageAllowance({vehicle,miles,ytdMiles,paidRate,taxYear});}catch{}
  function save(){
    setError("");
    let result;
    try{result=calculateMileageAllowance({vehicle,miles,ytdMiles,paidRate,taxYear});}catch(caught){setError(caught instanceof Error?caught.message:"Mileage allowance could not be calculated.");return;}
    const base=Date.now(),lines:PayLine[]=[];
    if(result.exempt>0)lines.push({id:base,type:"earning",name:`Mileage allowance · ${vehicle} · approved`,amount:result.exempt,quantity:miles,rate:paidRate,taxable:false,nicable:false,pensionable:false});
    if(result.taxOnlyExcess>0)lines.push({id:base+1,type:"earning",name:`Mileage allowance · ${vehicle} · tax excess`,amount:result.taxOnlyExcess,quantity:0,rate:0,taxable:true,nicable:false,pensionable:false});
    if(result.taxAndNicExcess>0)lines.push({id:base+2,type:"earning",name:`Mileage allowance · ${vehicle} · PAYE and NIC excess`,amount:result.taxAndNicExcess,quantity:0,rate:0,taxable:true,nicable:true,pensionable:false});
    if(!lines.length){setError("The entered rate produces no employer payment.");return;}
    add(lines);
  }
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">BUSINESS TRAVEL</span><h2>Private-vehicle mileage allowance</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="form-grid"><label className="field"><span>Vehicle</span><select value={vehicle} onChange={event=>{const value=event.target.value as MileageVehicle;setVehicle(value);setPaidRate(value==="car-van"?.55:value==="motorcycle"?.24:.20);}}><option value="car-van">Employee car or van</option><option value="motorcycle">Motorcycle</option><option value="cycle">Cycle</option></select></label><Field label="Business miles this period" value={String(miles)} type="number" onChange={value=>setMiles(Number(value))}/><Field label="Employer rate per mile" value={String(paidRate)} type="number" onChange={value=>setPaidRate(Number(value))}/><Field label="Prior business miles this tax year" value={String(ytdMiles)}/></div>{error&&<div className="portal-message">{error}</div>}{calculation&&<div className="statutory-breakdown"><div><span>Employer payment</span><b>{money(calculation.paid)}</b></div><div><span>Approved tax-free amount</span><b>{money(calculation.exempt)}</b></div><div><span>PAYE-only excess</span><b>{money(calculation.taxOnlyExcess)}</b></div><div><span>PAYE and NIC excess</span><strong>{money(calculation.taxAndNicExcess)}</strong></div><small>{calculation.mileageReliefShortfall?`${money(calculation.mileageReliefShortfall)} potential Mileage Allowance Relief shortfall for the employee. `:""}After this claim, recorded {vehicle.replace("-","/")} mileage is {calculation.ytdMilesAfter.toLocaleString("en-GB")} miles.</small></div>}<div className="portal-message">For 2026/27, cars and vans use 55p for the first 10,000 miles and 25p thereafter for PAYE; NIC uses 55p for all business miles. Motorcycles use 24p and cycles 20p. Retain journey dates, purpose and start/end postcodes.</div></div><footer><button onClick={close}>Cancel</button><button className="primary" disabled={!calculation||miles<=0||paidRate<0} onClick={save}>Add calculated mileage</button></footer></div></div>;
}

function PayItemModal({employee,period,history,activeLoans,cashRounding,automaticPayrolledBenefits,automaticClass1Benefits,adjustmentTotals,activeAttachmentOrders,nonAttachableStatutoryPay,previousPayDate,payrollCalculationDate,automaticEnrolmentScheme,hasPensionMembership,close,add,saved}:{employee:Employee;period:number;history:CalculationHistory;activeLoans:any[];cashRounding?:any;automaticPayrolledBenefits:number;automaticClass1Benefits:number;adjustmentTotals:{payeTax:number;employeeNic:number;employerNic:number;studentLoan:number;postgraduateLoan:number};activeAttachmentOrders:any[];nonAttachableStatutoryPay:number;previousPayDate:string;payrollCalculationDate:string;automaticEnrolmentScheme?:any;hasPensionMembership:boolean;close:()=>void;add:(items:PayLine[])=>void;saved:(message:string,success?:boolean)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency(),firstPayDate=useFirstPayDate();
  const paySchedule=useMemo(()=>scheduledPayPeriods(taxYear,payFrequency,firstPayDate||undefined),[taxYear,payFrequency,firstPayDate]),scheduledPeriod=paySchedule[period-1];
  const [type,setType]=useState<PayLine["type"]>("earning"),[name,setName]=useState(""),[amount,setAmount]=useState(0),[taxable,setTaxable]=useState(true),[nicable,setNicable]=useState(true),[pensionable,setPensionable]=useState(true);
  const [scope,setScope]=useState<"once"|"recurring">("once"),[endPeriod,setEndPeriod]=useState(period),[saving,setSaving]=useState(false);
  const [targetNet,setTargetNet]=useState(0),[targetMessage,setTargetMessage]=useState("");
  useEffect(()=>{
    if(type==="earning"){setTaxable(true);setNicable(true);setPensionable(true);}
    if(type==="benefit"){setTaxable(true);setNicable(false);setPensionable(false);}
    if(type==="post-tax-deduction"){setTaxable(false);setNicable(false);setPensionable(false);}
    if(type==="salary-sacrifice"){setName("Pension salary sacrifice");setTaxable(true);setNicable(true);setPensionable(true);}
    if(type==="payroll-giving"){setName("Payroll Giving donation");setTaxable(true);setNicable(false);setPensionable(false);}
  },[type]);
  async function save(){
    if(scope==="once")return add([{id:Date.now(),type,name:name.trim(),amount,taxable,nicable,pensionable}]);
    setSaving(true);
    try{
      const response=await fetch("/api/recurring-items",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId,taxYear,type,name:name.trim(),amount,taxable,nicable,pensionable,startPeriod:period,endPeriod})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      saved(`${name.trim()} scheduled from period ${period} to ${endPeriod}. It will be included when each payroll is saved.`,true);
    }catch(error){saved(error instanceof Error?error.message:"The schedule could not be saved.",false);}finally{setSaving(false);}
  }
  function calculateTargetNet(){
    const netWithLoans=(candidate:Employee)=>{
      let assessedCandidate=candidate;
      if(automaticEnrolmentScheme&&!hasPensionMembership&&candidate.dateOfBirth){
        const withoutPension={...candidate,pensionStatus:"not-enrolled",pensionEmployeeRate:0,pensionEmployerRate:0};
        const preAssessment=calculateEmployeePeriod(withoutPension,period,taxYear,history,0,automaticPayrolledBenefits,automaticClass1Benefits,payFrequency,scheduledPeriod,paySchedule);
        const assessment=assessPensionAtDate({dateOfBirth:candidate.dateOfBirth,assessmentDate:payrollCalculationDate,earnings:preAssessment.gross,payFrequency,employeeRate:automaticEnrolmentScheme.employeeRate,employerRate:automaticEnrolmentScheme.employerRate});
        assessedCandidate={...candidate,pensionStatus:assessment.action==="enrol"?"active":"not-enrolled",pensionEmployeeRate:automaticEnrolmentScheme.employeeRate||0,pensionEmployerRate:automaticEnrolmentScheme.employerRate||0,pensionBasis:automaticEnrolmentScheme.earningsBasis==="gross"?"gross":"qualifying",pensionTaxRelief:automaticEnrolmentScheme.taxRelief==="net-pay"?"net-pay":"relief-at-source"};
      }
      const base=calculateEmployeePeriod(assessedCandidate,period,taxYear,history,0,automaticPayrolledBenefits,automaticClass1Benefits,payFrequency,scheduledPeriod,paySchedule);
      const correctedNet=Math.max(0,roundMoney(base.net-adjustmentTotals.payeTax-adjustmentTotals.employeeNic-adjustmentTotals.studentLoan-adjustmentTotals.postgraduateLoan));
      const attachableNet=Math.max(0,correctedNet-nonAttachableStatutoryPay);
      let existingDeductions=0;
      for(const order of activeAttachmentOrders){
        const maintenanceDays=["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(order.calculationRule)
          ?elapsedPayDays(order.effectiveDate&&order.effectiveDate>previousPayDate?order.effectiveDate:previousPayDate,payrollCalculationDate):undefined;
        const calculation=calculateAttachment({netPay:attachableNet,type:order.type,deductionType:order.deductionType==="percentage"?"percentage":"fixed",calculationRule:order.calculationRule,payFrequency:order.payFrequency,deductionValue:order.deductionValue,protectedEarnings:order.protectedEarnings,balance:order.balance,adminFee:order.adminFee,existingDeductions,arrears:order.arrears,periodDays:maintenanceDays,ordinaryDebtBalance:order.ordinaryDebtBalance,maintenanceDailyRate:order.maintenanceDailyRate});
        existingDeductions=roundMoney(existingDeductions+calculation.totalFromPay);
      }
      const afterAttachments=Math.max(0,roundMoney(correctedNet-existingDeductions));
      const deduction=allocateEmployeeLoanRecoveries(activeLoans,afterAttachments).reduce((sum,item)=>sum+item.amount,0);
      const unrounded=Math.max(0,roundMoney(afterAttachments-deduction));
      return cashRounding?applyCashPayRounding({netPay:unrounded,openingCarry:cashRounding.carry,unit:cashRounding.unit}).roundedNet:unrounded;
    };
    const currentNet=netWithLoans(employee),current={net:currentNet};
    if(targetNet<=current.net){setTargetMessage(`The current net pay is already ${money(current.net)}. Target net can add gross pay but cannot create a negative earning.`);return;}
    const netFor=(adjustment:number)=>netWithLoans({...employee,payItems:[...(employee.payItems||[]),{id:-999,type:"earning",name:"Target net pay adjustment",amount:adjustment,taxable:true,nicable:true,pensionable:true}]});
    let lower=0,upper=Math.max(100,(targetNet-current.net)*2),iterations=0;
    while(netFor(upper)<targetNet&&upper<10_000_000){upper*=2;iterations++;}
    while(upper-lower>.005&&iterations<100){const midpoint=(lower+upper)/2;if(netFor(midpoint)<targetNet)lower=midpoint;else upper=midpoint;iterations++;}
    const candidates=[Math.floor(lower*100)/100,Math.ceil(upper*100)/100];
    const adjustment=candidates.reduce((best,value)=>Math.abs(netFor(value)-targetNet)<Math.abs(netFor(best)-targetNet)?value:best,candidates[0]);
    const achievedNetPay=netFor(adjustment);
    setType("earning");setName("Target net pay adjustment");setAmount(adjustment);setTaxable(true);setNicable(true);setPensionable(true);setScope("once");
    setTargetMessage(`${money(adjustment)} additional gross produces approximately ${money(achievedNetPay)} net. Review the calculation before adding it.`);
  }
  const taxableLabel=type==="earning"||type==="benefit"?"Included in PAYE taxable pay":"Reduces PAYE taxable pay";
  const nicableLabel=type==="earning"||type==="benefit"?"Included in National Insurance pay":"Reduces National Insurance pay";
  const pensionableLabel=type==="earning"?"Included in pensionable pay":type==="salary-sacrifice"?"Retain pre-sacrifice pensionable reference pay":"Reduces pensionable pay";
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">PAY ITEM</span><h2>Add earning, benefit or deduction</h2></div><button onClick={close}>×</button></header><div className="form-body"><section className="operation-card"><div className="card-head"><div><h3>Target net pay</h3><p>Reverse-calculate the taxable gross earning needed to reach a requested take-home amount.</p></div></div><div className="form-grid"><Field label="Requested net pay" value={String(targetNet)} type="number" onChange={value=>setTargetNet(Number(value))}/><button type="button" disabled={targetNet<=0} onClick={calculateTargetNet}>Calculate gross adjustment</button></div>{targetMessage&&<div className="portal-message">{targetMessage}</div>}</section><div className="form-grid"><label className="field"><span>Item type</span><select value={type} onChange={e=>setType(e.target.value as PayLine["type"])}><option value="earning">Cash earning</option><option value="benefit">Taxable non-cash benefit</option><option value="pre-tax-deduction">Pre-tax deduction</option><option value="post-tax-deduction">Post-tax deduction</option><option value="salary-sacrifice">Pension salary sacrifice</option><option value="payroll-giving">Payroll Giving donation</option></select></label><Field label="Description" value={name} onChange={setName}/><Field label="Amount" value={String(amount)} type="number" onChange={v=>setAmount(+v)}/><label className="field"><span>Apply</span><select value={scope} onChange={event=>setScope(event.target.value as "once"|"recurring")}><option value="once">This period only</option><option value="recurring">This and future periods</option></select></label>{scope==="recurring"&&<label className="field"><span>Final period</span><select value={endPeriod} onChange={event=>setEndPeriod(Number(event.target.value))}>{Array.from({length:paySchedule.length-period+1},(_,index)=>period+index).map(value=><option key={value} value={value}>Period {value}</option>)}</select></label>}</div><Check text={taxableLabel} checked={taxable} onChange={setTaxable}/><Check text={nicableLabel} checked={nicable} onChange={setNicable}/><Check text={pensionableLabel} checked={pensionable} onChange={setPensionable}/><div className="statutory-breakdown"><div><span>Cash gross effect</span><b>{money(type==="earning"?amount:type==="salary-sacrifice"?-amount:0)}</b></div><div><span>Taxable-pay effect</span><b>{money(type==="benefit"&&taxable?amount:type==="earning"&&taxable?amount:["pre-tax-deduction","payroll-giving","salary-sacrifice"].includes(type)&&taxable?-amount:0)}</b></div><div><span>{type==="salary-sacrifice"?"Employer pension effect":"Net deduction effect"}</span><strong>{money(type==="salary-sacrifice"?amount:["pre-tax-deduction","post-tax-deduction","payroll-giving"].includes(type)?amount:0)}</strong></div><small>Salary sacrifice reduces reported cash, PAYE and NIC pay and becomes an additional employer pension contribution. Payroll Giving reduces taxable pay but not NIC-able pay.</small></div></div><footer><button onClick={close}>Cancel</button><button className="primary" disabled={saving||!name.trim()||amount<=0||endPeriod<period} onClick={save}>{saving?"Saving…":scope==="recurring"?"Create schedule":"Add pay item"}</button></footer></div></div>;
}

function ScheduleModal({employee,period,close,saved,refresh}:{employee:Employee;period:number;close:()=>void;saved:(message:string)=>void;refresh:()=>Promise<void>}) {
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [items,setItems]=useState<any[]>([]),[loading,setLoading]=useState(true);
  async function load(){const response=await fetch(`/api/recurring-items?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body=await response.json();setItems(Array.isArray(body)?body.filter(item=>item.payrollId===employee.payrollId):[]);setLoading(false);}
  useEffect(()=>{load();},[]);
  async function stop(item:any){const response=await fetch("/api/recurring-items",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:item.id,action:"stop",endPeriod:period-1})}),body=await response.json();if(!response.ok)return saved(body.error||"The schedule could not be stopped.");await Promise.all([load(),refresh()]);saved(`${item.name} stopped. ${body.removedDraftOccurrences||0} future occurrence(s) removed and ${body.invalidatedDraftRuns||0} affected employee draft(s) cleared; finalised history remains unchanged.`);}
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">PAY SCHEDULES</span><h2>{employee.name}</h2></div><button onClick={close}>×</button></header><div className="form-body">{loading?<div className="empty-workflow"><p>Loading schedules…</p></div>:items.length?<table><thead><tr><th>Item</th><th>Amount</th><th>Periods</th><th>Status</th><th /></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.name}</b><small>{String(item.type).replaceAll("-"," ")}</small></td><td>{money(item.amount)}</td><td>{item.startPeriod}–{item.endPeriod}</td><td>{item.status}</td><td>{item.status==="active"&&<button onClick={()=>stop(item)}>Stop</button>}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No recurring pay items exist for this employee.</p></div>}<small>Stopping a schedule prevents future inclusion. Finalised and previously saved periods retain their item history.</small></div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function RequestInboxModal({close,saved,refresh}:{close:()=>void;saved:(message:string,success?:boolean)=>void;refresh:()=>Promise<void>}){
  const employerId=useEmployerId();
  const [items,setItems]=useState<any[]>([]),[notes,setNotes]=useState<Record<number,string>>({}),[loading,setLoading]=useState(true),[busy,setBusy]=useState<number|null>(null);
  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/employee-requests?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems(Array.isArray(body)?body:[]);
    }catch(error){saved(error instanceof Error?error.message:"Employee requests could not be loaded.",false);}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  async function review(item:any,decision:"approved"|"rejected"){
    setBusy(item.id);
    try{
      const response=await fetch("/api/employee-requests",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:item.id,decision,reviewNote:notes[item.id]||""})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      await Promise.all([load(),decision==="approved"?refresh():Promise.resolve()]);
      saved(decision==="approved"
        ?body.supersededPaymentBatches
          ?`Employee change approved. ${body.supersededPaymentBatches} prepared bank payment batch${body.supersededPaymentBatches===1?" was":"es were"} superseded; generate a replacement file.`
          :"Employee change approved and applied to payroll master data."
        :"Employee change rejected; payroll master data was not changed.");
    }catch(error){saved(error instanceof Error?error.message:"Employee request could not be reviewed.",false);}
    finally{setBusy(null);}
  }
  const pending=items.filter(item=>item.status==="pending");
  return <div className="modal-bg"><div className="modal request-modal"><header><div><span className="eyebrow">CLIENT REQUESTS</span><h2>Employee portal request inbox</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="portal-message">Approvals update payroll master data only when the values have not changed since the employee submitted the request. Bank requests also require employee-level bank-edit permission.</div>{loading?<div className="empty-workflow"><p>Loading employee requests…</p></div>:items.length?<table><thead><tr><th>Employee</th><th>Type</th><th>Proposed changes</th><th>Employee note</th><th>Status</th><th>Review</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.firstName} {item.lastName}</b><small>{item.payrollId}</small></td><td>{item.requestType}</td><td>{Object.entries(item.proposedChanges||{}).map(([field,value])=><small key={field}><b>{field}</b>: {field==="accountNumber"?`••••${String(value||"").slice(-4)}`:String(value||"Blank")}</small>)}</td><td>{item.employeeNote||"—"}</td><td><span className={`status ${item.status==="pending"?"amber":""}`}>{item.status}</span></td><td>{item.status==="pending"?<><input aria-label={`Review note for request ${item.id}`} placeholder="Optional review note" value={notes[item.id]||""} onChange={event=>setNotes(current=>({...current,[item.id]:event.target.value}))}/><div className="inline-actions"><button disabled={busy!==null} onClick={()=>review(item,"approved")}>Approve</button><button disabled={busy!==null} onClick={()=>review(item,"rejected")}>Reject</button></div></>:item.reviewNote||"Reviewed"}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No employee portal changes have been requested.</p></div>}</div><footer><span>{pending.length} pending request{pending.length===1?"":"s"}</span><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function EmailTemplateSettings({toast}:{toast:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId();
  const blank={name:"Payslip email",reportType:"payslip",subject:"<employer> payslip - <period>",body:"Hello <forename>,\n\nYour <report+period> is ready.\n\nRegards,\n<employer>",isDefault:true};
  const [items,setItems]=useState<any[]>([]),[form,setForm]=useState<any>(blank),[editingId,setEditingId]=useState(0),[busy,setBusy]=useState(false);
  async function load(){
    const response=await fetch(`/api/email-templates?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
    if(!response.ok)throw new Error(body.error);setItems(body.templates||[]);
  }
  useEffect(()=>{load().catch(error=>toast(error instanceof Error?error.message:"Email templates could not be loaded.",false));},[]);
  function edit(item:any){setEditingId(item.id);setForm({name:item.name,reportType:item.reportType,subject:item.subject,body:item.body,isDefault:item.isDefault});}
  function reset(){setEditingId(0);setForm(blank);}
  async function saveTemplate(){
    setBusy(true);
    try{
      const response=await fetch("/api/email-templates",{method:editingId?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,employerId,...(editingId?{id:editingId}:{})})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();reset();toast(editingId?"Email template updated.":"Email template created.");
    }catch(error){toast(error instanceof Error?error.message:"Email template could not be saved.",false);}finally{setBusy(false);}
  }
  async function archive(item:any){
    if(!window.confirm(`Archive email template “${item.name}”? Historical delivery messages will remain unchanged.`))return;
    setBusy(true);try{
      const response=await fetch("/api/email-templates",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:item.id,action:"archive"})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await load();if(editingId===item.id)reset();toast("Email template archived; delivery history was preserved.");
    }catch(error){toast(error instanceof Error?error.message:"Email template could not be archived.",false);}finally{setBusy(false);}
  }
  const active=items.filter(item=>item.status==="recorded");
  return <div className="email-template-settings full"><div className="operation-grid"><section className="calculation-panel"><span>{editingId?"Edit email template":"Add email template"}</span><Field label="Template name" value={form.name} onChange={name=>setForm({...form,name})}/><label className="field"><span>Report type</span><select value={form.reportType} onChange={event=>setForm({...form,reportType:event.target.value})}><option value="payslip">Employee payslip</option><option value="p60">P60 certificate</option><option value="general">General payroll report</option></select></label><Field label="Email subject" value={form.subject} onChange={subject=>setForm({...form,subject})}/><label className="field"><span>Email message</span><textarea rows={8} maxLength={4000} value={form.body} onChange={event=>setForm({...form,body:event.target.value})}/></label><Check text="Use as the default template for this report type" checked={Boolean(form.isDefault)} onChange={isDefault=>setForm({...form,isDefault})}/><div className="inline-actions"><button className="primary" disabled={busy||!form.name.trim()||!form.subject.trim()||!form.body.trim()} onClick={saveTemplate}>{busy?"Saving…":editingId?"Save changes":"Create template"}</button>{editingId>0&&<button disabled={busy} onClick={reset}>Cancel</button>}</div></section><section className="operation-card inset-card"><div className="card-head"><div><h3>Reusable templates</h3><p>Messages are rendered separately for each employee when a delivery batch is prepared.</p></div><span>{active.length} active</span></div>{active.length?<table><thead><tr><th>Template</th><th>Report</th><th>Subject</th><th>Actions</th></tr></thead><tbody>{active.map(item=><tr key={item.id}><td><b>{item.name}</b>{item.isDefault&&<small>Default</small>}</td><td>{item.reportType}</td><td>{item.subject}</td><td><div className="inline-actions"><button disabled={busy} onClick={()=>edit(item)}>Edit</button><button disabled={busy} onClick={()=>archive(item)}>Archive</button></div></td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No custom email templates exist. The safe PayFlow standard template remains available.</p></div>}<div className="portal-message"><b>Supported tokens</b><br/>&lt;name&gt;, &lt;forename&gt;, &lt;surname&gt;, &lt;employee id&gt;, &lt;report&gt;, &lt;period&gt;, &lt;report+period&gt;, &lt;employer&gt;, &lt;payeref&gt;, &lt;accountsref&gt; and employer-contact tokens.</div></section></div></div>;
}

function EmailPayslipsModal({period,close,saved}:{period:number;close:()=>void;saved:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [templates,setTemplates]=useState<any[]>([]),[selectedId,setSelectedId]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  useEffect(()=>{fetch(`/api/email-templates?employerId=${employerId}`,{cache:"no-store"}).then(async response=>({response,body:await response.json()})).then(({response,body})=>{
    if(!response.ok)throw new Error(body.error);const active=(body.templates||[]).filter((item:any)=>item.status==="recorded"&&["payslip","general"].includes(item.reportType));
    const all=[body.systemDefault,...active];setTemplates(all);setSelectedId(active.find((item:any)=>item.isDefault)?.id||0);
  }).catch(error=>saved(error instanceof Error?error.message:"Email templates could not be loaded.",false)).finally(()=>setLoading(false));},[]);
  const selected=templates.find(item=>item.id===selectedId)||templates[0];
  async function queue(){
    setBusy(true);try{
      const response=await fetch("/api/payslip-deliveries",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,periodNumber:period,method:"email",...(selectedId?{templateId:selectedId}:{})})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);const excluded=body.excluded?.length?` ${body.excluded.length} employee(s) were excluded because their email address is missing.`:"";
      saved(`${body.recipientCount} personalised payslip email(s) queued locally using “${body.delivery.payload.template.name}”. Connect an approved email provider to transmit them.${excluded}`);close();
    }catch(error){saved(error instanceof Error?error.message:"Payslip emails could not be queued.",false);}finally{setBusy(false);}
  }
  return <div className="modal-bg"><div className="modal email-delivery-modal"><header><div><span className="eyebrow">PAYSLIP EMAILS · PERIOD {period}</span><h2>Preview and queue email messages</h2></div><button onClick={close}>×</button></header><div className="form-body">{loading?<div className="empty-workflow"><p>Loading email templates…</p></div>:<><label className="field"><span>Email template</span><select aria-label="Payslip email template" value={selectedId} onChange={event=>setSelectedId(Number(event.target.value))}>{templates.map(item=><option key={item.id} value={item.id}>{item.name}{item.isDefault?" · default":""}</option>)}</select></label>{selected&&<div className="email-message-preview"><span>SUBJECT</span><b>{selected.subject}</b><span>MESSAGE</span><pre>{selected.body}</pre></div>}<div className="portal-message">Tokens are personalised from each employee’s immutable finalised payroll identity. This action records a source-bound local queue only; it does not claim external transmission or delivery.</div></>}</div><footer><button disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy||loading||!selected} onClick={queue}>{busy?"Queuing…":"Queue personalised emails"}</button></footer></div></div>;
}

function PayslipDeliveryModal({close,saved}:{close:()=>void;saved:(message:string,success?:boolean)=>void}){
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [items,setItems]=useState<any[]>([]),[loading,setLoading]=useState(true),[resending,setResending]=useState<number|null>(null);
  async function load(){
    setLoading(true);
    try{
      const response=await fetch(`/api/payslip-deliveries?employerId=${employerId}`,{cache:"no-store"}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setItems((Array.isArray(body)?body:[]).filter(item=>item.payload?.taxYear===taxYear).sort((a,b)=>String(b.preparedAt||b.createdAt).localeCompare(String(a.preparedAt||a.createdAt))));
    }catch(error){saved(error instanceof Error?error.message:"Payslip delivery history could not be loaded.",false);}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  async function resend(item:any){
    if(!window.confirm(`Create another ${item.payload.method} delivery batch for period ${item.payload.periodNumber}?`))return;
    setResending(item.id);
    try{
      const response=await fetch("/api/payslip-deliveries",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,periodNumber:item.payload.periodNumber,method:item.payload.method,resend:true})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      await load();
      saved(`${body.recipientCount} payslip(s) added to a recorded ${item.payload.method} resend batch.`);
    }catch(error){saved(error instanceof Error?error.message:"Payslips could not be resent.",false);}
    finally{setResending(null);}
  }
  return <div className="modal-bg"><div className="modal delivery-modal"><header><div><span className="eyebrow">PAYSLIP DELIVERY</span><h2>Delivery and email log · {taxYear}</h2></div><button onClick={close}>×</button></header><div className="form-body">{loading?<div className="empty-workflow"><p>Loading delivery history…</p></div>:items.length?<table><thead><tr><th>Period</th><th>Method / template</th><th>Recipients</th><th>Excluded</th><th>Status</th><th>Prepared</th><th /></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>Period {item.payload.periodNumber}</b>{item.payload.resendOf&&<small>Resend of batch #{item.payload.resendOf}</small>}</td><td>{item.payload.method==="email"?"Email":"Employee portal"}{item.payload.template?.name&&<small>{item.payload.template.name}</small>}{item.payload.recipients?.[0]?.emailSubject&&<small>{item.payload.recipients[0].emailSubject}</small>}</td><td>{item.payload.recipients?.length||0}</td><td>{item.payload.excluded?.length||0}{item.payload.excluded?.length>0&&<small>{item.payload.excluded.map((entry:any)=>entry.name).join(", ")}</small>}</td><td><span className={`status ${item.status==="queued-external"?"amber":""}`}>{item.status}</span>{item.status==="queued-external"&&<small>Awaiting approved email provider</small>}</td><td>{item.preparedAt?new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.preparedAt)):"—"}</td><td><button disabled={resending!==null} title={item.payload.method==="email"?"Create a fresh batch using the current default email template":"Create another portal publication batch"} onClick={()=>resend(item)}>{resending===item.id?"Recording…":"Resend"}</button></td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No payslip delivery batches have been recorded for {taxYear}.</p></div>}<div className="portal-message">Portal publication is immediate for enabled employees. Email batches retain the selected template and each personalised subject/message, but remain “queued-external” until an approved outbound email provider is configured. A resend uses the current default template and records a new immutable batch.</div></div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

function AdjustmentModal({employee,period,periodLocked,close,saved}:{employee:Employee;period:number;periodLocked:boolean;close:()=>void;saved:(message:string)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [items,setItems]=useState<any[]>([]),[type,setType]=useState("paye-tax"),[amount,setAmount]=useState(0),[reason,setReason]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState("");
  async function load(){const response=await fetch(`/api/adjustments?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`),body=await response.json();setItems(Array.isArray(body)?body.filter(item=>item.payrollId===employee.payrollId&&item.periodNumber===period):[]);}
  useEffect(()=>{load();},[]);
  async function create(){setSaving(true);setError("");const response=await fetch("/api/adjustments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,taxYear,periodNumber:period,payrollId:employee.payrollId,type,amount,reason})}),body=await response.json();setSaving(false);if(!response.ok){setError(body.error||"The correction could not be saved.");return;}setAmount(0);setReason("");await load();saved(body.epsRequired?"HMRC statutory recovery corrected. Prepare and validate an EPS for the affected tax month.":body.additionalFpsRequired?"Finalised values corrected. Prepare and validate an Additional FPS against the accepted baseline.":"Correction saved. Save the payroll draft to recalculate authoritative net pay.");}
  async function reverse(item:any){setError("");const response=await fetch("/api/adjustments",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id:item.id,action:"reverse"})}),body=await response.json();if(!response.ok){setError(body.error||"The correction could not be reversed.");return;}await load();saved(body.epsRequired?"HMRC statutory recovery correction reversed. Prepare a replacement EPS.":body.additionalFpsRequired?"Finalised correction reversed. Generate a new Additional FPS for the changed values.":"Correction reversed. Save the payroll draft to recalculate authoritative net pay.");}
  const labels:Record<string,string>={...(periodLocked?{"gross-pay":"Gross cash pay","taxable-pay":"Taxable pay","nicable-pay":"NIC-able pay","statutory-pay":"Statutory pay","statutory-recovery":"HMRC statutory-pay recovery","net-pay":"Net pay"}:{}),"paye-tax":"PAYE tax","employee-nic":"Employee NIC","employer-nic":"Employer NIC","student-loan":"Student loan","postgraduate-loan":"Postgraduate loan"};
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">PAYROLL CORRECTIONS</span><h2>{employee.name} · Period {period}</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="portal-message">{periodLocked?"This period is finalised. A direct correction requires an HMRC-accepted FPS baseline and must target the latest finalised period so later year-to-date evidence cannot become stale. Pay-value changes require an Additional FPS; statutory-recovery changes require an EPS.":"Use signed amounts: a positive value increases the deduction or liability; a negative value refunds or reduces it. Every correction is retained in the audit trail."}</div>{error&&<div className="portal-message benefit-error" role="alert">{error}</div>}<div className="form-grid"><label className="field"><span>Correction type</span><select value={type} onChange={event=>setType(event.target.value)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Field label="Signed amount" value={String(amount)} type="number" onChange={value=>setAmount(Number(value))}/><Field label="Reason" value={reason} onChange={setReason}/></div><button className="primary" disabled={saving||amount===0||!reason.trim()} onClick={create}>{saving?"Saving…":"Add correction"}</button>{items.length?<table><thead><tr><th>Type</th><th>Amount</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{labels[item.type]||item.type}</td><td>{money(item.amount)}</td><td>{item.reason}</td><td>{item.status}</td><td>{item.status==="active"&&<button onClick={()=>reverse(item)}>Reverse</button>}</td></tr>)}</tbody></table>:<div className="empty-workflow"><p>No manual corrections exist for this employee and period.</p></div>}<small>Open-period corrections are recalculated when the draft is saved. Accepted-period pay corrections use Additional FPS; HMRC statutory-recovery corrections use EPS. Live transmission still requires an HMRC-recognised transport adapter.</small></div><footer><button className="primary" onClick={close}>Done</button></footer></div></div>;
}

type BenefitRegisterItem={id:number;employeeId:number;taxYear:string;category:string;p11dSection?:string|null;nicTreatment:BenefitNicTreatment;providedDate?:string|null;description?:string|null;cashEquivalent:number;class1aNic:number;payrolled:boolean;status:string;voidReason?:string|null;voidedAt?:string|null;replacesBenefitId?:number|null};

function BenefitRegisterModal({employee,canWrite,close,saved}:{employee:Employee;canWrite:boolean;close:()=>void;saved:(message:string)=>void}) {
  const employerId=useEmployerId(),[items,setItems]=useState<BenefitRegisterItem[]>([]),[loading,setLoading]=useState(true),[correcting,setCorrecting]=useState<number|null>(null),[reason,setReason]=useState(""),[working,setWorking]=useState(false),[operationError,setOperationError]=useState("");
  async function load(){
    setLoading(true);
    try{const response=await fetch(`/api/benefits?employerId=${employerId}`),body=await response.json();if(!response.ok)throw new Error(body.error);setItems((body as BenefitRegisterItem[]).filter(item=>item.employeeId===employee.id));}
    catch(error){saved(error instanceof Error?error.message:"Benefits register could not be loaded.");}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[employerId,employee.id]);
  async function voidBenefit(id:number){
    setWorking(true);setOperationError("");
    try{
      const response=await fetch("/api/benefits",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,id,action:"void",reason})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setCorrecting(null);setReason("");await load();
      saved("Benefit voided with a permanent audit reason. Finalised payroll snapshots were preserved.");
    }catch(error){const message=error instanceof Error?error.message:"Benefit could not be voided.";setOperationError(message);saved(message);}finally{setWorking(false);}
  }
  return <div className="modal-bg"><div className="modal benefit-register-modal"><header><div><span className="eyebrow">EXPENSES & BENEFITS</span><h2>{employee.name} · benefits register</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="portal-message">Reviewed records feed P11D or payrolled-benefit reporting. Voiding a mistake removes it from current reports, retains the correction trail, and never rewrites a finalised payroll snapshot.</div>{operationError&&<div className="portal-message benefit-error" role="alert">{operationError}</div>}{loading?<p>Loading benefit records…</p>:items.length===0?<p>No benefits have been declared for this employee.</p>:<div className="report-table-scroll"><table><thead><tr><th>Tax year</th><th>Section</th><th>Benefit</th><th>Cash equivalent</th><th>NIC treatment</th><th>Class 1A</th><th>Reporting</th><th>Status</th><th>Correction</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.taxYear}</td><td>{item.p11dSection||"—"}</td><td><b>{item.category}</b><small>{item.description}{item.providedDate?` · provided ${item.providedDate}`:""}{item.replacesBenefitId?` · replaces #${item.replacesBenefitId}`:""}</small></td><td>{money(item.cashEquivalent)}</td><td>{item.nicTreatment==="class-1a"?"Class 1A":item.nicTreatment==="class-1"?"Class 1":"Exempt"}</td><td>{money(item.class1aNic)}</td><td>{item.nicTreatment==="exempt"?"Register only":item.payrolled?"Payrolled":"P11D"}</td><td><span className={`status ${item.status==="draft"?"amber":""}`}>{item.status}</span>{item.voidReason&&<small>{item.voidReason}</small>}</td><td>{item.status!=="voided"&&canWrite&&(correcting===item.id?<div className="correction-editor"><input aria-label={`Correction reason for benefit ${item.id}`} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Why is this record wrong?"/><button disabled={working||reason.trim().length<5} onClick={()=>voidBenefit(item.id)}>Confirm void</button><button disabled={working} onClick={()=>{setCorrecting(null);setReason("");}}>Cancel</button></div>:<button onClick={()=>setCorrecting(item.id)}>Void incorrect record</button>)}</td></tr>)}</tbody></table></div>}</div><footer><button onClick={close}>Close</button></footer></div></div>;
}

function BenefitModal({employee,close,saved}:{employee:Employee;close:()=>void;saved:(message:string,success?:boolean)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear();
  const [category,setCategory]=useState("Private medical insurance"),[nicTreatment,setNicTreatment]=useState<BenefitNicTreatment>("class-1a"),[providedDate,setProvidedDate]=useState(`${taxYear.slice(0,4)}-04-06`),[description,setDescription]=useState(""),[cash,setCash]=useState(0),[payrolled,setPayrolled]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [benefitEvent,setBenefitEvent]=useState("provided"),[availableFrom,setAvailableFrom]=useState(""),[availableTo,setAvailableTo]=useState("");
  const [vehicleRegistration,setVehicleRegistration]=useState(""),[makeModel,setMakeModel]=useState(""),[fuelType,setFuelType]=useState("Electric");
  const [firstRegistered,setFirstRegistered]=useState(""),[co2Emissions,setCo2Emissions]=useState(0),[zeroEmissionMileage,setZeroEmissionMileage]=useState(0);
  const [listPrice,setListPrice]=useState(0),[capitalContributions,setCapitalContributions]=useState(0),[privateUseContribution,setPrivateUseContribution]=useState(0);
  const [vanUseType,setVanUseType]=useState<CompanyVanUse>("taxable-private-use"),[vanFuelProvided,setVanFuelProvided]=useState(false),[vanFuelRepaid,setVanFuelRepaid]=useState(false),[vanSharedEmployees,setVanSharedEmployees]=useState(1),[zeroEmissionVan,setZeroEmissionVan]=useState(false);
  const [loanOpeningBalance,setLoanOpeningBalance]=useState(0),[loanClosingBalance,setLoanClosingBalance]=useState(0),[loanMaximumAggregateBalance,setLoanMaximumAggregateBalance]=useState(0),[loanWholeMonths,setLoanWholeMonths]=useState(12),[loanInterestPaid,setLoanInterestPaid]=useState(0),[loanSalaryForegone,setLoanSalaryForegone]=useState(0);
  const [accommodationAnnualValue,setAccommodationAnnualValue]=useState(0),[accommodationProviderRent,setAccommodationProviderRent]=useState(0),[accommodationPropertyCost,setAccommodationPropertyCost]=useState(0),[accommodationImprovements,setAccommodationImprovements]=useState(0),[accommodationEmployeeCapital,setAccommodationEmployeeCapital]=useState(0),[accommodationEmployeeRent,setAccommodationEmployeeRent]=useState(0),[accommodationAvailableDays,setAccommodationAvailableDays]=useState(365),[accommodationSharedEmployees,setAccommodationSharedEmployees]=useState(1),[accommodationSalaryForegone,setAccommodationSalaryForegone]=useState(0);
  const companyCar=category==="Company car",companyVan=category==="Company van",beneficialLoan=category==="Beneficial loan",livingAccommodation=category==="Living accommodation";
  const carCalculation=useMemo(()=>{
    if(!companyCar||!availableFrom||listPrice<=0)return null;
    try{return calculateCompanyCarBenefit({taxYear,co2Emissions,zeroEmissionMileage,listPrice,capitalContributions,privateUseContribution,availableFrom,availableTo:availableTo||null,fuelType:fuelType as CompanyCarFuel});}
    catch{return null;}
  },[companyCar,taxYear,co2Emissions,zeroEmissionMileage,listPrice,capitalContributions,privateUseContribution,availableFrom,availableTo,fuelType]);
  const vanCalculation=useMemo(()=>{
    if(!companyVan||!availableFrom)return null;
    try{return calculateCompanyVanBenefit({taxYear,availableFrom,availableTo:availableTo||null,zeroEmission:zeroEmissionVan,useType:vanUseType,sharedEmployees:vanSharedEmployees,privateUseContribution,privateFuelProvided:vanFuelProvided,privateFuelRepaid:vanFuelRepaid});}
    catch{return null;}
  },[companyVan,taxYear,availableFrom,availableTo,zeroEmissionVan,vanUseType,vanSharedEmployees,privateUseContribution,vanFuelProvided,vanFuelRepaid]);
  const loanCalculation=useMemo(()=>{
    if(!beneficialLoan)return null;
    try{return calculateBeneficialLoan({taxYear,openingBalance:loanOpeningBalance,closingBalance:loanClosingBalance,maximumAggregateBalance:loanMaximumAggregateBalance,wholeMonthsOutstanding:loanWholeMonths,interestPaid:loanInterestPaid,salaryForegone:loanSalaryForegone});}
    catch{return null;}
  },[beneficialLoan,taxYear,loanOpeningBalance,loanClosingBalance,loanMaximumAggregateBalance,loanWholeMonths,loanInterestPaid,loanSalaryForegone]);
  const accommodationCalculation=useMemo(()=>{
    if(!livingAccommodation)return null;
    try{return calculateLivingAccommodation({taxYear,annualValue:accommodationAnnualValue,providerRent:accommodationProviderRent,propertyCost:accommodationPropertyCost,improvements:accommodationImprovements,employeeCapitalContribution:accommodationEmployeeCapital,employeeRent:accommodationEmployeeRent,availableDays:accommodationAvailableDays,sharedEmployees:accommodationSharedEmployees,salaryForegone:accommodationSalaryForegone});}
    catch{return null;}
  },[livingAccommodation,taxYear,accommodationAnnualValue,accommodationProviderRent,accommodationPropertyCost,accommodationImprovements,accommodationEmployeeCapital,accommodationEmployeeRent,accommodationAvailableDays,accommodationSharedEmployees,accommodationSalaryForegone]);
  const displayedCash=companyCar?carCalculation?.cashEquivalent||0:companyVan?vanCalculation?.cashEquivalent||0:beneficialLoan?loanCalculation?.cashEquivalent||0:livingAccommodation?accommodationCalculation?.cashEquivalent||0:cash;
  const classification=classifyBenefit(category),displayedClass1a=class1aForBenefit(displayedCash,nicTreatment);
  function chooseBenefitCategory(value:string){setCategory(value);const next=classifyBenefit(value);if(next)setNicTreatment(next.defaultNicTreatment);if(next?.defaultNicTreatment==="exempt")setPayrolled(false);}
  const benefitTreatmentControls=<><label className="field full"><span>National Insurance treatment</span><select value={nicTreatment} onChange={event=>{const value=event.target.value as BenefitNicTreatment;setNicTreatment(value);if(value==="exempt")setPayrolled(false);setError("");}}><option value="class-1a">Class 1A · employer liability at year end</option><option value="class-1">Class 1 · include value in payroll NIC</option><option value="exempt">Exempt · register only, no statutory return</option></select></label>{nicTreatment==="class-1"&&<Field label="Date provided or paid" value={providedDate} type="date" onChange={value=>{setProvidedDate(value);setError("");}}/>}<Check text="Benefit is being payrolled for income tax" checked={payrolled} disabled={nicTreatment==="exempt"} onChange={setPayrolled}/><div className="portal-message">P11D section {classification?.section||"—"} · {classification?.label||"Unclassified"}. {nicTreatment==="class-1"?"The full value enters NIC-able earnings in the tax month it was provided. If that period is finalised, reopen and recalculate it before preparing an Additional FPS.":nicTreatment==="class-1a"?"Employer Class 1A is reconciled at year end.":"This record is retained for evidence but excluded from P11D, PBIK and P11D(b)."}</div>{error&&<div className="portal-message benefit-error" role="alert">{error}</div>}</>;
  async function save() {
    setSaving(true);setError("");
    try{const response=await fetch("/api/benefits",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId||`PAY-${employee.id}-${taxYear.slice(0,4)}`,taxYear,category,nicTreatment,providedDate,description,cashEquivalent:cash,payrolled,status:"reviewed",benefitEvent,availableFrom,availableTo,vehicleRegistration,makeModel,fuelType,firstRegistered,co2Emissions,zeroEmissionMileage,listPrice,capitalContributions,privateUseContribution,vanUseType,vanFuelProvided,vanFuelRepaid,vanSharedEmployees,zeroEmission:zeroEmissionVan,loanOpeningBalance,loanClosingBalance,loanMaximumAggregateBalance,loanWholeMonths,loanInterestPaid,loanSalaryForegone,accommodationAnnualValue,accommodationProviderRent,accommodationPropertyCost,accommodationImprovements,accommodationEmployeeCapital,accommodationEmployeeRent,accommodationAvailableDays,accommodationSharedEmployees,accommodationSalaryForegone})});const body=await response.json();if(!response.ok)throw new Error(body.error);saved(companyCar?`Company-car event saved for P46(Car); Class 1A NIC ${money(body.class1aNic)}.`:companyVan?`Company-van benefit saved; taxable van ${money(body.companyVanCalculation.vanCharge)} and fuel ${money(body.companyVanCalculation.fuelCharge)}.`:beneficialLoan?`Beneficial-loan value saved at ${money(body.cashEquivalent)} using the ${body.beneficialLoanCalculation.officialRate}% official rate.`:livingAccommodation?`Accommodation benefit saved; standard ${money(body.livingAccommodationCalculation.standardCharge)} and additional ${money(body.livingAccommodationCalculation.additionalCharge)}.`:`Benefit saved in P11D section ${body.p11dSection} with ${body.nicTreatment} treatment.`,true);}
    catch(error){setError(error instanceof Error?error.message:"Benefit could not be saved.");}finally{setSaving(false);}
  }
  if(livingAccommodation)return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">EXPENSES & BENEFITS</span><h2>Living accommodation</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="form-grid"><label className="field"><span>Category</span><select value={category} onChange={event=>chooseBenefitCategory(event.target.value)}>{benefitCategories.map(value=><option key={value}>{value}</option>)}</select></label><Field label="Description" value={description} onChange={setDescription}/><Field label="Tax year" value={taxYear}/><Field label="Annual value / gross rating value" value={String(accommodationAnnualValue)} type="number" onChange={value=>setAccommodationAnnualValue(Number(value))}/><Field label="Annual rent paid by provider" value={String(accommodationProviderRent)} type="number" onChange={value=>setAccommodationProviderRent(Number(value))}/><Field label="Acquisition or market-value basis" value={String(accommodationPropertyCost)} type="number" onChange={value=>setAccommodationPropertyCost(Number(value))}/><Field label="Qualifying improvements" value={String(accommodationImprovements)} type="number" onChange={value=>setAccommodationImprovements(Number(value))}/><Field label="Employee capital reimbursement" value={String(accommodationEmployeeCapital)} type="number" onChange={value=>setAccommodationEmployeeCapital(Number(value))}/><Field label="Rent paid by employee" value={String(accommodationEmployeeRent)} type="number" onChange={value=>setAccommodationEmployeeRent(Number(value))}/><Field label="Available days in tax year" value={String(accommodationAvailableDays)} type="number" onChange={value=>setAccommodationAvailableDays(Number(value))}/><Field label="Employees sharing accommodation" value={String(accommodationSharedEmployees)} type="number" onChange={value=>setAccommodationSharedEmployees(Number(value))}/><Field label="Salary foregone for accommodation" value={String(accommodationSalaryForegone)} type="number" onChange={value=>setAccommodationSalaryForegone(Number(value))}/></div>{benefitTreatmentControls}<div className="portal-message">{accommodationCalculation?`Standard charge ${money(accommodationCalculation.standardCharge)} · additional charge over £75,000 ${money(accommodationCalculation.additionalCharge)} · official rate ${accommodationCalculation.officialRate}%.`:"Complete valid accommodation values, availability and sharing details."}</div><div className="statutory-breakdown"><div><span>Accommodation cost basis</span><b>{money(accommodationCalculation?.accommodationCost||0)}</b></div><div><span>Calculated cash equivalent</span><b>{money(accommodationCalculation?.cashEquivalent||0)}</b></div><div><span>Calculated Class 1A NIC</span><strong>{money(displayedClass1a)}</strong></div><small>Uses the greater annual value or provider rent, availability, sharing, the £75,000 additional-charge threshold, employee payments and optional remuneration.</small></div></div><footer><button onClick={close}>Cancel</button><button className="primary" disabled={saving||description.trim().length<3||!accommodationCalculation} onClick={save}>{saving?"Saving…":"Save reviewed accommodation"}</button></footer></div></div>;
  return <div className="modal-bg"><div className="modal calendar-modal"><header><div><span className="eyebrow">EXPENSES & BENEFITS</span><h2>Declare employee benefit</h2></div><button onClick={close}>×</button></header><div className="form-body"><div className="form-grid"><label className="field"><span>Category</span><select value={category} onChange={event=>chooseBenefitCategory(event.target.value)}>{benefitCategories.map(value=><option key={value}>{value}</option>)}</select></label><Field label="Description" value={description} onChange={setDescription}/>{!companyCar&&!companyVan&&!beneficialLoan&&<Field label="Cash equivalent" value={String(cash)} type="number" onChange={v=>setCash(+v)}/>}<Field label="Tax year" value={taxYear}/></div>{companyCar&&<><div className="form-grid"><label className="field"><span>Company-car event</span><select value={benefitEvent} onChange={event=>setBenefitEvent(event.target.value)}><option value="provided">Car provided</option><option value="withdrawn">Car withdrawn</option><option value="additional">Additional car provided</option></select></label><Field label="Available from" value={availableFrom} type="date" onChange={setAvailableFrom}/><Field label="Available to / withdrawn" value={availableTo} type="date" onChange={setAvailableTo}/><Field label="Vehicle registration" value={vehicleRegistration} onChange={setVehicleRegistration}/><Field label="Make and model" value={makeModel} onChange={setMakeModel}/><label className="field"><span>Fuel and emissions standard</span><select value={fuelType} onChange={event=>setFuelType(event.target.value)}><option>Electric</option><option>Petrol</option><option>Hybrid</option><option>Diesel (RDE2)</option><option>Diesel (not RDE2)</option></select></label><Field label="First registered" value={firstRegistered} type="date" onChange={setFirstRegistered}/><Field label="CO2 emissions g/km" value={String(co2Emissions)} type="number" onChange={value=>setCo2Emissions(Number(value))}/><Field label="Zero-emission mileage" value={String(zeroEmissionMileage)} type="number" onChange={value=>setZeroEmissionMileage(Number(value))}/><Field label="List price and accessories" value={String(listPrice)} type="number" onChange={value=>setListPrice(Number(value))}/><Field label="Capital contributions" value={String(capitalContributions)} type="number" onChange={value=>setCapitalContributions(Number(value))}/><Field label="Private-use contribution" value={String(privateUseContribution)} type="number" onChange={value=>setPrivateUseContribution(Number(value))}/></div><div className="portal-message">{carCalculation?`HMRC rate ${carCalculation.percentage}% · ${carCalculation.availableDays}/${carCalculation.taxYearDays} available days · taxable price ${money(carCalculation.priceForTax)}.`:"Complete the price and availability details to calculate the statutory cash equivalent."} P46(Car) events are retained as HMRC working data.</div></>}{companyVan&&<><div className="form-grid"><Field label="Available from" value={availableFrom} type="date" onChange={setAvailableFrom}/><Field label="Available to" value={availableTo} type="date" onChange={setAvailableTo}/><Field label="Vehicle registration" value={vehicleRegistration} onChange={setVehicleRegistration}/><Field label="Make and model" value={makeModel} onChange={setMakeModel}/><label className="field"><span>Private-use treatment</span><select value={vanUseType} onChange={event=>setVanUseType(event.target.value as CompanyVanUse)}><option value="taxable-private-use">More than insignificant private use</option><option value="restricted-private-use">Restricted private use condition met</option><option value="insignificant-private-use">Nil or insignificant private use</option><option value="pool-van">Qualifying pool van</option></select></label><Field label="Employees sharing van" value={String(vanSharedEmployees)} type="number" onChange={value=>setVanSharedEmployees(Number(value))}/><Field label="Private-use payments" value={String(privateUseContribution)} type="number" onChange={value=>setPrivateUseContribution(Number(value))}/></div><Check text="Zero-emission van" checked={zeroEmissionVan} onChange={setZeroEmissionVan}/><Check text="Employer provides fuel for private journeys" checked={vanFuelProvided} onChange={setVanFuelProvided}/>{vanFuelProvided&&<Check text="Employee repays all private fuel" checked={vanFuelRepaid} onChange={setVanFuelRepaid}/>}<div className="portal-message">{vanCalculation?`${vanCalculation.exempt?"Van charge exempt":"Taxable van charge"} ${money(vanCalculation.vanCharge)} · private fuel ${money(vanCalculation.fuelCharge)} · ${vanCalculation.availableDays}/${vanCalculation.taxYearDays} available days.`:"Complete the availability details to calculate the company-van benefit."}</div></>}{beneficialLoan&&<><div className="form-grid"><Field label="Opening / advance balance" value={String(loanOpeningBalance)} type="number" onChange={value=>setLoanOpeningBalance(Number(value))}/><Field label="Closing / discharge balance" value={String(loanClosingBalance)} type="number" onChange={value=>setLoanClosingBalance(Number(value))}/><Field label="Maximum aggregate employee loans" value={String(loanMaximumAggregateBalance)} type="number" onChange={value=>setLoanMaximumAggregateBalance(Number(value))}/><Field label="Whole months outstanding" value={String(loanWholeMonths)} type="number" onChange={value=>setLoanWholeMonths(Number(value))}/><Field label="Interest paid by employee" value={String(loanInterestPaid)} type="number" onChange={value=>setLoanInterestPaid(Number(value))}/><Field label="Salary foregone for loan" value={String(loanSalaryForegone)} type="number" onChange={value=>setLoanSalaryForegone(Number(value))}/></div><div className="portal-message">{loanCalculation?`${loanCalculation.smallLoanExempt?"Exempt: aggregate balance does not exceed £10,000":"Taxable beneficial loan"} · official rate ${loanCalculation.officialRate}% · average balance ${money(loanCalculation.averageBalance)} · official interest ${money(loanCalculation.officialInterest)}.`:"Complete valid beneficial-loan balances and whole months."}</div></>}{benefitTreatmentControls}<div className="statutory-breakdown"><div><span>Calculated cash equivalent</span><b>{money(displayedCash)}</b></div><div><span>Calculated Class 1A NIC</span><strong>{money(displayedClass1a)}</strong></div><small>{companyCar?"Calculated from HMRC company-car rates, capped employee capital contribution, availability and private-use payment.":companyVan?"Calculated from the statutory van and private-fuel charges, exemptions, sharing, availability and employee payments.":beneficialLoan?"Normal averaging method using the official interest rate, whole months, employee interest and optional-remuneration amount.":"Treatment follows the selected P11D section and contractual arrangement."}</small></div></div><footer><button onClick={close}>Cancel</button><button className="primary" disabled={saving||(!companyCar&&!companyVan&&!beneficialLoan&&cash<0)||(companyCar&&(!vehicleRegistration.trim()||!availableFrom||!carCalculation))||(companyVan&&(!vehicleRegistration.trim()||!availableFrom||!vanCalculation))||(beneficialLoan&&!loanCalculation)||(nicTreatment==="class-1"&&!providedDate)} onClick={save}>{saving?"Saving…":"Save reviewed benefit"}</button></footer></div></div>;
}

function AttachmentModal({employee,netPay,close,saved}:{employee:Employee;netPay:number;close:()=>void;saved:(message:string,success?:boolean)=>void}) {
  const employerId=useEmployerId(),taxYear=useTaxYear(),payFrequency=usePayFrequency();
  const [rule,setRule]=useState("dea-standard"),[type,setType]=useState("Direct Earnings Attachment"),[authority,setAuthority]=useState("DWP"),[reference,setReference]=useState(""),[deduction,setDeduction]=useState(0),[balance,setBalance]=useState(0),[saving,setSaving]=useState(false);
  const [protectedEarnings,setProtectedEarnings]=useState(0),[priority,setPriority]=useState(30),[arrears,setArrears]=useState(0),[effectiveDate,setEffectiveDate]=useState(""),[periodDays,setPeriodDays]=useState(30);
  const [ordinaryDebtBalance,setOrdinaryDebtBalance]=useState(0),[maintenanceDailyRate,setMaintenanceDailyRate]=useState(0);
  const mixedConjoinedRule=rule==="scottish-conjoined-mixed";
  const scottishMaintenanceRule=["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(rule);
  const calculation=calculateAttachment({netPay,type,deductionType:"fixed",deductionValue:deduction,calculationRule:rule as any,payFrequency,protectedEarnings,balance:scottishMaintenanceRule?null:balance,adminFee:1,arrears,periodDays:scottishMaintenanceRule?periodDays:undefined,ordinaryDebtBalance:mixedConjoinedRule?ordinaryDebtBalance:null,maintenanceDailyRate:mixedConjoinedRule?maintenanceDailyRate:0});
  function selectRule(value:string){setRule(value);if(value.startsWith("dea")){setType(value==="dea-higher"?"Direct Earnings Attachment · higher rate":"Direct Earnings Attachment");setAuthority("DWP");setPriority(30);}if(value==="child-maintenance"){setType("Child maintenance deduction from earnings order");setAuthority("Child Maintenance Service");setPriority(20);}if(value==="council-tax-england-wales"){setType("Council Tax Attachment of Earnings Order");setAuthority("Local authority");setPriority(10);}if(value==="aeo-priority"){setType("Priority Attachment of Earnings Order");setAuthority("HMCTS");setPriority(10);}if(value==="aeo-non-priority"){setType("Non-priority Attachment of Earnings Order");setAuthority("HMCTS");setPriority(40);}if(value==="scottish-earnings-arrestment"){setType("Scottish Earnings Arrestment");setAuthority("Sheriff officer / creditor");setPriority(10);}if(value==="scottish-current-maintenance"){setType("Scottish Current Maintenance Arrestment");setAuthority("Maintenance creditor");setPriority(10);}if(value==="scottish-conjoined-maintenance"){setType("Scottish Conjoined Maintenance Arrestment");setAuthority("Sheriff clerk");setPriority(10);}if(value==="scottish-conjoined-mixed"){setType("Scottish Mixed Conjoined Arrestment");setAuthority("Sheriff clerk");setPriority(10);}if(value==="ni-court-fine"){setType("Northern Ireland Court Fine AEO");setAuthority("Fine Collection and Enforcement Service");setPriority(10);}if(value==="ni-ejo"){setType("Northern Ireland EJO Attachment of Earnings");setAuthority("Enforcement of Judgments Office");setPriority(10);}if(value==="manual"){setType("Other court deduction order");setAuthority("Issuing court");setPriority(50);}}
  async function save() {
    setSaving(true);
    try{const response=await fetch("/api/attachments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employerId,payrollId:employee.payrollId||fallbackPayrollId(employee,taxYear),type,issuingAuthority:authority,reference,protectedEarnings,deductionType:"fixed",deductionValue:deduction,calculationRule:rule,payFrequency,priority,arrears,effectiveDate,adminFee:1,balance:scottishMaintenanceRule?null:balance,periodDays,ordinaryDebtBalance:mixedConjoinedRule?ordinaryDebtBalance:null,maintenanceDailyRate:mixedConjoinedRule?maintenanceDailyRate:0})});const body=await response.json();if(!response.ok)throw new Error(body.error);saved("Attachment order saved with statutory calculation, priority and protected-pay controls.",true);}
    catch(error){saved(error instanceof Error?error.message:"Attachment order could not be saved.",false);}finally{setSaving(false);}
  }
  const instructedRule=["manual","aeo-priority","aeo-non-priority","dea-fixed","child-maintenance","ni-ejo","scottish-current-maintenance","scottish-conjoined-maintenance"].includes(rule);
  const protectedRule=["manual","aeo-priority","aeo-non-priority","ni-ejo"].includes(rule);
  const carriesArrears=["aeo-priority","child-maintenance"].includes(rule);
  return <div className="modal-bg"><div className="modal calendar-modal">
    <header><div><span className="eyebrow">ATTACHMENT ORDER</span><h2>Add statutory deduction order</h2></div><button onClick={close}>×</button></header>
    <div className="form-body"><div className="form-grid">
      <label className="field"><span>Calculation rule</span><select value={rule} onChange={event=>selectRule(event.target.value)}>
        <option value="dea-standard">DWP DEA · standard bands</option><option value="dea-higher">DWP DEA · higher bands</option><option value="dea-fixed">DWP DEA · instructed fixed amount</option>
        <option value="child-maintenance">Child maintenance DEO</option><option value="council-tax-england-wales">Council Tax AEO · England and Wales</option>
        <option value="aeo-priority">Court AEO · priority (carry shortfall)</option><option value="aeo-non-priority">Court AEO · non-priority (no carry)</option>
        <option value="scottish-earnings-arrestment">Scottish earnings arrestment · statutory table</option>
        <option value="scottish-current-maintenance">Scottish current maintenance · daily rate</option>
        <option value="scottish-conjoined-maintenance">Scottish conjoined maintenance · aggregate daily rate</option>
        <option value="scottish-conjoined-mixed">Scottish conjoined · ordinary debt and maintenance</option>
        <option value="ni-court-fine">Northern Ireland court fine · statutory bands</option><option value="ni-ejo">Northern Ireland EJO · order amount and protection</option>
        <option value="manual">Other order · instructed amount and protection</option>
      </select></label>
      <Field label="Order type" value={type} onChange={setType}/><Field label="Issuing authority" value={authority} onChange={setAuthority}/>
      <Field label="Reference" value={reference} onChange={setReference}/><Field label="Effective date" value={effectiveDate} type="date" onChange={setEffectiveDate}/>
      {instructedRule&&<Field label={scottishMaintenanceRule?"Daily maintenance rate from order":"Normal deduction rate from order"} value={String(deduction)} type="number" onChange={v=>setDeduction(+v)}/>}
      {protectedRule&&<Field label="Protected earnings rate from order" value={String(protectedEarnings)} type="number" onChange={v=>setProtectedEarnings(+v)}/>}
      {scottishMaintenanceRule&&<Field label="Preview days since previous payday" value={String(periodDays)} type="number" onChange={v=>setPeriodDays(+v)}/>}
      {mixedConjoinedRule&&<><Field label="Ordinary-debt balance" value={String(ordinaryDebtBalance)} type="number" onChange={v=>setOrdinaryDebtBalance(+v)}/><Field label="Aggregate maintenance daily rate" value={String(maintenanceDailyRate)} type="number" onChange={v=>setMaintenanceDailyRate(+v)}/></>}
      {carriesArrears&&<Field label="Unpaid amount carried forward" value={String(arrears)} type="number" onChange={v=>setArrears(+v)}/>}
      {!scottishMaintenanceRule&&<Field label="Outstanding balance" value={String(balance)} type="number" onChange={v=>setBalance(+v)}/>}
      <Field label="Legal priority (lower first)" value={String(priority)} type="number" onChange={v=>setPriority(+v)}/><Field label="Administration fee" value="1.00"/>
    </div><div className="statutory-breakdown">
      <div><span>Attachable net pay</span><b>{money(netPay)}</b></div><div><span>Applied statutory rate</span><b>{calculation.rate==null?"Order amount":`${calculation.rate}%`}</b></div>
      <div><span>Protected earnings</span><b>{money(calculation.protectedEarnings)}</b></div><div><span>Deduction sent to authority</span><strong>{money(calculation.deduction)}</strong></div>
      <div><span>Administration fee</span><b>{money(calculation.adminFee)}</b></div><div><span>Expected take-home</span><strong>{money(Math.max(0,netPay-calculation.totalFromPay))}</strong></div>
      {mixedConjoinedRule&&<><div><span>Ordinary-debt allocation</span><b>{money(calculation.ordinaryDeduction)}</b></div><div><span>Current-maintenance allocation</span><b>{money(calculation.maintenanceDeduction)}</b></div></>}
      {calculation.shortfall>0&&<div><span>{carriesArrears?"Shortfall carried forward":"Shortfall this pay period"}</span><b>{money(calculation.shortfall)}</b></div>}
      <small>DEA, Council Tax and Scottish earnings-arrestment tables convert fortnightly or four-weekly net pay to a weekly amount, apply the weekly band, then multiply the rounded deduction by the number of weeks. DEA, Northern Ireland court-fine and child-maintenance deductions preserve 60% of net earnings. Court AEO and EJO orders use the instructed deduction and protected earnings printed on the order; only priority court AEO shortfalls carry forward. Scottish earnings arrestment uses the statutory weekly, monthly and daily tables effective from 6 April 2025. Scottish maintenance uses the order&apos;s daily rate and automatically counts elapsed payday days with £24.66 protected per day. Mixed conjoined deductions are split proportionally between the statutory ordinary-debt and maintenance components. Family statutory payments are excluded from attachable earnings by payroll.</small>
    </div></div>
    <footer><button onClick={close}>Cancel</button><button className="primary" disabled={saving||!effectiveDate||reference.trim().length<3||authority.trim().length<2||(!scottishMaintenanceRule&&balance<=0)||priority<1||priority>100||(instructedRule&&deduction<=0)||(protectedRule&&protectedEarnings<=0)||(scottishMaintenanceRule&&(periodDays<1||periodDays>366))||(mixedConjoinedRule&&(ordinaryDebtBalance<=0||maintenanceDailyRate<=0))} onClick={save}>{saving?"Saving…":"Save attachment order"}</button></footer>
  </div></div>;
}

function FormTitle({title,text}:{title:string;text:string}) { return <div className="form-title"><h3>{title}</h3><p>{text}</p></div>; }
function Field({label,value,type="text",onChange}:{label:string;value:string;type?:string;onChange?:(v:string)=>void}) {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={e=>onChange?.(e.currentTarget.value)} readOnly={!onChange}/></label>;
}
function Check({text,checked=false,onChange,disabled=false}:{text:string;checked?:boolean;onChange?:(checked:boolean)=>void;disabled?:boolean}) {
  return <label className="check">{onChange
    ? <input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>
    : <input type="checkbox" checked={checked} disabled={disabled} readOnly/>
  }<span><b>{text}</b></span></label>;
}
