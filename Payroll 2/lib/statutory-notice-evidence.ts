const forms:Record<string,string>={
  maternity:"SMP1",paternity:"SPP1",adoption:"SAP1",sick:"SSP1",
  "shared-parental":"written statement",bereavement:"SPBP1",neonatal:"NEO1",
};
const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const bool=(value:unknown)=>value===true||value===1||String(value).toLowerCase()==="true";

export function validateStatutoryNoticeEvidence(row:any,actualChecksum:string):string|null {
  if(!forms[String(row?.statutoryType||"")]||row.formType!==forms[row.statutoryType])
    return "Statutory notice has an unsupported form or payment type.";
  if(!validIso(row.decisionDate)||!validIso(row.payStartDate)||
    row.payEndDate!==null&&row.payEndDate!==undefined&&(!validIso(row.payEndDate)||row.payEndDate<row.payStartDate))
    return "Statutory notice has invalid decision or payment dates.";
  if(!["issued","delivered","cancelled"].includes(String(row.status||""))||
    row.status==="cancelled"&&String(row.cancellationReason||"").trim().length<5)
    return "Statutory notice has an invalid lifecycle state.";
  if(!Number.isFinite(Number(row.averageWeeklyEarnings))||Number(row.averageWeeklyEarnings)<0||
    !Number.isInteger(Number(row.continuousEmploymentWeeks))||Number(row.continuousEmploymentWeeks)<0||
    !String(row.reasonCode||"").trim()||!String(row.reason||"").trim())
    return "Statutory notice has incomplete eligibility evidence.";
  let snapshot:any;
  try { snapshot=JSON.parse(String(row.employeeSnapshot||"")); }
  catch { return "Statutory notice has malformed frozen evidence."; }
  if(snapshot?.schemaVersion!=="payflow-statutory-notice-1"||
    !snapshot.employee||!String(snapshot.employee.payrollId||"").trim()||
    !String(snapshot.employee.firstName||"").trim()||!String(snapshot.employee.lastName||"").trim()||
    !snapshot.employer||!String(snapshot.employer.name||"").trim()||
    !validTimestamp(snapshot.issuedAt)||snapshot.issuedAt!==row.issuedAt||
    !/^[a-f0-9]{64}$/.test(String(row.payloadChecksum||""))||actualChecksum!==row.payloadChecksum)
    return "Statutory notice has incomplete or corrupted frozen evidence.";
  const mirrored=["formType","statutoryType","decisionDate","payStartDate","payEndDate","reasonCode","reason",
    "averageWeeklyEarnings","continuousEmploymentWeeks"];
  if(mirrored.some(field=>snapshot[field]!==row[field])||
    bool(snapshot.evidenceReceived)!==bool(row.evidenceReceived)||
    bool(snapshot.noticeReceived)!==bool(row.noticeReceived))
    return "Statutory notice no longer matches its frozen evidence.";
  return null;
}
