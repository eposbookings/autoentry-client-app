const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validDate=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const taxMonthBounds=(taxYear:string,taxMonth:number)=>{
  const startYear=Number(taxYear.slice(0,4)),start=Date.UTC(startYear,3+taxMonth-1,6),end=Date.UTC(startYear,3+taxMonth,5,23,59,59,999);
  return {start,end};
};

export function validateCisPaymentEvidence(row:any):string|null {
  if(!validTaxYear(row?.taxYear)||!Number.isInteger(Number(row?.taxMonth))||Number(row.taxMonth)<1||Number(row.taxMonth)>12)
    return "CIS payment has an invalid tax year or tax month.";
  const month=taxMonthBounds(String(row.taxYear),Number(row.taxMonth)),paymentTime=Date.parse(`${row.paymentDate}T00:00:00Z`);
  if(!validDate(row.paymentDate)||paymentTime<month.start||paymentTime>month.end)return "CIS payment date is outside its recorded tax month.";
  if(!["draft","calculated","voided"].includes(String(row.status||"")))return "CIS payment has an unsupported lifecycle status.";
  const amounts=["labour","materials","vat","retention","deduction","netPayment"].map(field=>Number(row[field]));
  if(amounts.some(value=>!Number.isFinite(value)||value<0))return "CIS payment amounts must be finite and non-negative.";
  const [labour,materials,vat,retention,deduction,netPayment]=amounts,rate=Number(row.deductionRate);
  if(![0,20,30].includes(rate)||retention>labour)return "CIS payment has an invalid deduction rate or labour retention.";
  if(deduction!==round(Math.max(0,labour-retention)*rate/100)||netPayment!==round(labour+materials+vat-deduction-retention))
    return "CIS payment deduction or net amount does not reconcile.";
  const type=String(row.subcontractorType||""),utr=String(row.subcontractorUtr||"").replace(/\s/g,"");
  if(!String(row.subcontractorName||"").trim()||!["sole-trader","partnership","company"].includes(type)||!/^\d{10}$/.test(utr))
    return "CIS payment is missing frozen subcontractor identity evidence.";
  if(type==="sole-trader"&&!/^[A-Z]{2}\d{6}[A-D]$/i.test(String(row.subcontractorNiNumber||"").replace(/\s/g,"")))
    return "CIS sole-trader payment is missing a valid frozen National Insurance number.";
  if(type==="company"&&!/^[A-Z0-9]{8}$/i.test(String(row.subcontractorCompanyNumber||"").replace(/\s/g,"")))
    return "CIS company payment is missing a valid frozen company number.";
  if(type==="partnership"&&!/^\d{10}$/.test(String(row.subcontractorPartnerUtr||"").replace(/\s/g,"")))
    return "CIS partnership payment is missing a valid frozen partner UTR.";
  if(rate!==0&&!String(row.verificationNumber||"").trim())return "Deducted CIS payment is missing frozen verification evidence.";
  if(row.replacesPaymentId!==null&&row.replacesPaymentId!==undefined&&(!Number.isInteger(Number(row.replacesPaymentId))||Number(row.replacesPaymentId)<=0))
    return "CIS payment has an invalid replacement reference.";
  if(row.status==="voided"&&String(row.voidReason||"").trim().length<5)return "Voided CIS payment is missing its correction reason.";
  return null;
}
