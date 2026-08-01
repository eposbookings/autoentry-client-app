import { isRecognisedPayeTaxCode } from "./tax-code.ts";

const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&
  Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const validNino=(value:unknown)=>/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/i.test(String(value||"").replace(/\s+/g,""));

export function validateHmrcNoticeEvidence(row:any,exportedAt?:unknown):string|null {
  const type=String(row?.type||""),taxYear=String(row?.taxYear||"");
  if(!["coding","student-loan","nino","generic"].includes(type)||!validTaxYear(taxYear)||
    String(row.noticeIdentifier||"").trim().length<3||String(row.noticeIdentifier||"").trim().length>100||
    !["manual","hmrc"].includes(String(row.source||"")))
    return "HMRC notice has invalid identity, type or source evidence.";
  if(!validIso(row.issuedDate)||!validIso(row.effectiveDate)||
    exportedAt&&validTimestamp(exportedAt)&&row.issuedDate>String(exportedAt).slice(0,10))
    return "HMRC notice has invalid or future-issued dates.";
  const yearStart=`${taxYear.slice(0,4)}-04-06`,yearEnd=`${Number(taxYear.slice(0,4))+1}-04-05`;
  if(row.effectiveDate<yearStart||row.effectiveDate>yearEnd)return "HMRC notice effective date falls outside its tax year.";
  if(type!=="generic"&&(!Number.isInteger(Number(row.employeeId))||Number(row.employeeId)<=0)||
    type==="generic"&&row.employeeId)
    return "HMRC notice has invalid employee ownership evidence.";
  if(type==="coding"){
    if(!isRecognisedPayeTaxCode(String(row.taxCode||""))||row.loanAction||row.studentLoanPlan||row.postgraduateLoan||row.niNumber)
      return "Coding notice contains invalid or contradictory instruction evidence.";
  }else if(type==="nino"){
    if(!validNino(row.niNumber)||row.taxCode||row.loanAction||row.studentLoanPlan||row.postgraduateLoan)
      return "NINO notice contains invalid or contradictory instruction evidence.";
  }else if(type==="student-loan"){
    const action=String(row.loanAction||"");
    if(!["start","stop","stop-student","stop-postgraduate","stop-all"].includes(action)||row.taxCode||row.niNumber||
      action==="start"&&!Boolean(row.postgraduateLoan)&&!["1","2","4","5"].includes(String(row.studentLoanPlan||""))||
      action!=="start"&&(row.studentLoanPlan||row.postgraduateLoan))
      return "Loan notice contains invalid or contradictory instruction evidence.";
  }else if(String(row.message||"").trim().length<3||String(row.message||"").trim().length>500||
    row.taxCode||row.loanAction||row.studentLoanPlan||row.postgraduateLoan||row.niNumber)
    return "Generic notice contains invalid or contradictory message evidence.";
  if(row.payload){
    try { const parsed=JSON.parse(String(row.payload)); if(!parsed||typeof parsed!=="object")throw new Error(); }
    catch { return "HMRC notice contains malformed source payload evidence."; }
  }
  const status=String(row.status||"");
  if(status==="new"){
    if(row.appliedAt||row.ignoredAt)return "New HMRC notice contains contradictory lifecycle evidence.";
  }else if(status==="applied"){
    if(!validTimestamp(row.appliedAt)||row.ignoredAt)return "Applied HMRC notice is missing valid application evidence.";
  }else if(["ignored","superseded"].includes(status)){
    if(!validTimestamp(row.ignoredAt)||row.appliedAt)return "Closed HMRC notice is missing valid lifecycle evidence.";
  }else return "HMRC notice has an unsupported lifecycle status.";
  return null;
}
