const contactFields=new Set(["email","phone","address","postcode"]);
const bankFields=new Set(["bankName","accountName","sortCode","accountNumber"]);
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));

function parseRecord(value:unknown):Record<string,string|null>|null {
  try {
    const parsed=JSON.parse(String(value||""));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
    if(Object.values(parsed).some(item=>item!==null&&typeof item!=="string"))return null;
    return parsed;
  } catch { return null; }
}

export function validateEmployeeChangeEvidence(row:any):string|null {
  const allowed=row?.requestType==="contact"?contactFields:row?.requestType==="bank"?bankFields:null;
  const proposed=parseRecord(row?.proposedChanges),previous=parseRecord(row?.previousValues);
  if(!allowed||!proposed||!previous||!Object.keys(proposed).length||
    Object.keys(proposed).some(field=>!allowed.has(field))||
    Object.keys(previous).length!==Object.keys(proposed).length||
    Object.keys(proposed).some(field=>!(field in previous)))
    return "Employee change request contains unsupported or incomplete field evidence.";
  const limits:Record<string,number>={email:254,phone:40,address:500,postcode:12,bankName:120,accountName:120};
  if(proposed.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed.email)||
    Object.entries(proposed).some(([field,value])=>value&&limits[field]&&value.length>limits[field])||
    "sortCode" in proposed&&String(proposed.sortCode||"").replace(/\D/g,"").length!==6||
    "accountNumber" in proposed&&String(proposed.accountNumber||"").replace(/\D/g,"").length!==8)
    return "Employee change request contains invalid employee values.";
  if(String(row.employeeNote||"").length>500||String(row.reviewNote||"").length>500)
    return "Employee change request contains an overlong note.";
  const status=String(row.status||"");
  if(status==="pending"){
    if(row.reviewedBy||row.reviewedAt||row.reviewNote)return "Pending employee change request contains contradictory review evidence.";
  }else if(["approved","rejected"].includes(status)){
    if(!Number.isInteger(Number(row.reviewedBy))||Number(row.reviewedBy)<=0||!validTimestamp(row.reviewedAt))
      return "Reviewed employee change request is missing reviewer evidence.";
  }else return "Employee change request has an unsupported lifecycle status.";
  if(validTimestamp(row.createdAt)&&validTimestamp(row.reviewedAt)&&Date.parse(row.reviewedAt)<Date.parse(row.createdAt))
    return "Employee change request was reviewed before it was submitted.";
  return null;
}
