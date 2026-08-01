const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&
  Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validDate=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));

export function validateHmrcPaymentEvidence(row:any,exportedAt?:unknown):string|null {
  if(!validTaxYear(row?.taxYear)||!Number.isInteger(Number(row?.taxMonth))||Number(row.taxMonth)<1||Number(row.taxMonth)>12)
    return "HMRC payment has an invalid tax year or tax month.";
  if(!validDate(row.paymentDate)||exportedAt&&validTimestamp(exportedAt)&&row.paymentDate>String(exportedAt).slice(0,10))
    return "HMRC payment has an invalid or future-dated transaction date.";
  if(!["payment","credit","charge"].includes(String(row.kind||""))||
    !["bank-transfer","direct-debit","online","journal"].includes(String(row.method||"")))
    return "HMRC payment has an unsupported type or payment method.";
  const categories:Record<string,string[]>={
    payment:["paye-payment"],credit:["tax-refund-funding","previous-overpayment","other-credit"],
    charge:["class1a-adjustment","other-charge"],
  };
  if(row.category&&!categories[String(row.kind)]?.includes(String(row.category)))
    return "HMRC payment funding category contradicts its record type.";
  if(!Number.isFinite(Number(row.amount))||Number(row.amount)<=0||
    String(row.reference||"").trim().length<3||String(row.reference||"").trim().length>100||
    String(row.notes||"").length>500)
    return "HMRC payment contains invalid amount, reference or note evidence.";
  if(row.status==="recorded"){
    if(row.voidedAt||row.voidReason)return "Recorded HMRC payment contains contradictory void evidence.";
  }else if(row.status==="void"){
    if(!validTimestamp(row.voidedAt)||String(row.voidReason||"").trim().length<5||String(row.voidReason||"").trim().length>250)
      return "Voided HMRC payment is missing valid correction evidence.";
  }else return "HMRC payment has an unsupported lifecycle status.";
  return null;
}
