const validIsoDate=(value:unknown)=>{
  const text=String(value||"");
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)===text;
};

export function validatePensionDeclarationEvidence(
  row:any,
  payload:any,
  actualChecksum:string,
  scheme:any,
):string|null {
  if(row?.type!=="PENSION-DECLARATION"||row?.status!=="recorded"||
    !/^[a-f0-9]{64}$/.test(String(row?.payloadChecksum||""))||row.payloadChecksum!==actualChecksum)
    return "Pension declaration acknowledgement has invalid lifecycle or checksum evidence.";
  if(payload?.schemaVersion!=="payflow-pension-declaration-1"||Number(payload.schemeId)!==Number(scheme?.id)||
    payload.externalFiling!==true||!validIsoDate(payload.declarationDate)||
    String(payload.reference||"").trim().length<3||!Number.isFinite(Date.parse(String(payload.recordedAt||"")))||
    !String(payload.recordedBy||"").trim())
    return "Pension declaration acknowledgement is incomplete or belongs to another scheme.";
  if(row.submittedAt!==payload.declarationDate||row.dueDate!==(scheme.declarationDueDate||null)||
    payload.provider!==scheme.provider||payload.schemeName!==scheme.schemeName||
    payload.declarationDueDate!==(scheme.declarationDueDate||null))
    return "Pension declaration acknowledgement does not match the restored scheme.";
  return null;
}
