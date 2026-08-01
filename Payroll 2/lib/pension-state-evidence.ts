const assessmentStatuses=new Set(["eligible-jobholder","non-eligible-jobholder","entitled-worker","outside-scope"]);
const membershipStatuses=new Set(["active","not-enrolled","postponed","opted-out","ceased","transferred"]);
const eventTypes=new Set(["assess","postpone","opt-out","cease","opt-in","join","re-enrol","payroll-assessment",
  "postponement-ended","became-eligible","payroll-reassessment","scheme-transfer"]);
const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const optionalDatesValid=(row:any,fields:string[])=>fields.every(field=>!row[field]||validIso(row[field]));

export function validatePensionSchemeEvidence(row:any):string|null {
  const employeeRate=Number(row?.employeeRate),employerRate=Number(row?.employerRate),dueDay=Number(row?.contributionDueDay);
  if(!String(row?.provider||"").trim()||!String(row?.schemeName||"").trim()||
    !Number.isFinite(employeeRate)||employeeRate<0||employeeRate>100||
    !Number.isFinite(employerRate)||employerRate<0||employerRate>100||
    !["gross","qualifying"].includes(String(row.earningsBasis||""))||
    !["net-pay","relief-at-source"].includes(String(row.taxRelief||""))||
    !Number.isInteger(dueDay)||dueDay<1||dueDay>28)
    return "Pension scheme has invalid provider or contribution evidence.";
  if(Boolean(row.automaticEnrolmentScheme)&&(employerRate<3||employeeRate+employerRate<8))
    return "Automatic-enrolment scheme does not meet its stored minimum contribution basis.";
  if(!optionalDatesValid(row,["certificationDate","dutiesStartDate","nextReenrolmentDate","declarationDueDate"])||
    !["not-filed","filed"].includes(String(row.declarationStatus||""))||
    !["active","inactive"].includes(String(row.status||"")))
    return "Pension scheme has invalid compliance dates or lifecycle state.";
  return null;
}

export function validatePensionMembershipEvidence(row:any):string|null {
  if(!assessmentStatuses.has(String(row?.assessmentStatus||""))||!membershipStatuses.has(String(row?.membershipStatus||""))||
    !optionalDatesValid(row,["enrolmentDate","postponementEnd","postponementNoticeDate","optOutDate","enrolmentInformationDate",
      "optOutNoticeDate","ceasedDate","lastReenrolmentDate","communicationDueDate","lastCommunicationDate"])||
    ["employeeRefundDue","employerRefundDue"].some(field=>!Number.isFinite(Number(row[field]))||Number(row[field])<0))
    return "Pension membership has invalid assessment, dates or refund evidence.";
  if(row.membershipStatus==="active"&&!validIso(row.enrolmentDate))
    return "Active pension membership is missing its enrolment date.";
  if(row.membershipStatus==="postponed"&&(!validIso(row.postponementEnd)||!validIso(row.postponementNoticeDate)||
    row.postponementNoticeDate>row.postponementEnd))
    return "Postponed pension membership is missing valid notice evidence.";
  if(row.membershipStatus==="opted-out"&&(!validIso(row.optOutDate)||!validIso(row.optOutNoticeDate)||!Boolean(row.optOutNoticeValid)))
    return "Opted-out pension membership is missing provider notice evidence.";
  if(["ceased","transferred"].includes(row.membershipStatus)&&!validIso(row.ceasedDate))
    return "Closed pension membership is missing its cessation date.";
  return null;
}

export function validatePensionMembershipEventEvidence(row:any):string|null {
  if(!eventTypes.has(String(row?.eventType||""))||!validIso(row?.effectiveDate)||
    row.previousStatus&&!membershipStatuses.has(String(row.previousStatus))||
    !membershipStatuses.has(String(row.newStatus||""))||!String(row.createdBy||"").trim())
    return "Pension membership event has invalid transition evidence.";
  if(row.details){
    try { const parsed=JSON.parse(String(row.details)); if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error(); }
    catch { return "Pension membership event contains malformed details."; }
  }
  return null;
}
