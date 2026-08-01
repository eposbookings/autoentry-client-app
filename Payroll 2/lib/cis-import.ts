export type CisSubcontractorImport = {
  name: string;
  tradingName: string | null;
  type: "sole-trader" | "partnership" | "company";
  utr: string;
  niNumber: string | null;
  companyNumber: string | null;
  partnerUtr: string | null;
  address: string | null;
  postcode: string | null;
  email: string | null;
  phone: string | null;
  deductionRate: number;
  verificationNumber: string | null;
  verificationMethod: string | null;
  verificationResponse: string | null;
  verifiedAt: string | null;
  status: "unverified" | "verified" | "gross-payment-status";
};

type ImportResult = { values: CisSubcontractorImport[]; errors: string[] };

const clean=(value:unknown)=>String(value??"").trim();
const compact=(value:unknown)=>clean(value).replace(/\s/g,"");
const validNino=(value:string)=>/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/i.test(value);
const validIsoDate=(value:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const parsed=Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value
    ?new Date(parsed).toISOString():null;
};

export function validateCisImportRows(rows:unknown):ImportResult {
  if(!Array.isArray(rows))return {values:[],errors:["CIS import rows must be supplied as an array."]};
  if(rows.length<1)return {values:[],errors:["CIS import must contain at least one subcontractor row."]};
  if(rows.length>500)return {values:[],errors:["CIS import is limited to 500 subcontractors per file."]};
  const values:CisSubcontractorImport[]=[],errors:string[]=[],seenUtrs=new Map<string,number>();
  rows.forEach((unknownRow,index)=>{
    const number=index+2,prefix=`Row ${number}:`;
    if(!unknownRow||typeof unknownRow!=="object"||Array.isArray(unknownRow)){
      errors.push(`${prefix} subcontractor data must be an object.`);
      return;
    }
    const row=unknownRow as Record<string,unknown>;
    const name=clean(row.name).replace(/\s+/g," "),tradingName=clean(row.tradingName).replace(/\s+/g," ");
    const rawType=clean(row.type).toLowerCase().replace(/[_\s]+/g,"-");
    const type=rawType==="sole-trader"||rawType==="partnership"||rawType==="company"?rawType:null;
    const utr=compact(row.utr),niNumber=compact(row.niNumber).toUpperCase();
    const companyNumber=compact(row.companyNumber).toUpperCase(),partnerUtr=compact(row.partnerUtr);
    const address=clean(row.address),postcode=clean(row.postcode).toUpperCase();
    const email=clean(row.email).toLowerCase(),phone=clean(row.phone);
    const rateText=clean(row.deductionRate),deductionRate=rateText===""?30:Number(rateText);
    const verificationNumber=clean(row.verificationNumber),verificationDate=clean(row.verificationDate);
    const verifiedAt=verificationDate?validIsoDate(verificationDate):null;

    if(name.length<2||name.length>150)errors.push(`${prefix} legal name must contain 2 to 150 characters.`);
    if(tradingName.length>150)errors.push(`${prefix} trading name must be 150 characters or fewer.`);
    if(!/^\d{10}$/.test(utr))errors.push(`${prefix} a valid 10-digit UTR is required.`);
    if(!type)errors.push(`${prefix} business type must be sole-trader, partnership or company.`);
    if(type==="sole-trader"&&!validNino(niNumber))errors.push(`${prefix} a valid National Insurance number is required for a sole trader.`);
    if(type==="company"&&!/^[A-Z0-9]{8}$/.test(companyNumber))errors.push(`${prefix} a valid 8-character company registration number is required for a company.`);
    if(type==="partnership"&&!/^\d{10}$/.test(partnerUtr))errors.push(`${prefix} the nominated partner's valid 10-digit UTR is required for a partnership.`);
    if(address.length>500)errors.push(`${prefix} address must be 500 characters or fewer.`);
    if(postcode.length>10)errors.push(`${prefix} postcode must be 10 characters or fewer.`);
    if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))errors.push(`${prefix} email address is invalid.`);
    if(phone.length>30)errors.push(`${prefix} phone number must be 30 characters or fewer.`);
    if(![0,20,30].includes(deductionRate))errors.push(`${prefix} deduction rate must be 0, 20 or 30.`);
    if(Boolean(verificationNumber)!==Boolean(verificationDate))errors.push(`${prefix} verification number and verification date must be supplied together.`);
    if(verificationDate&&!verifiedAt)errors.push(`${prefix} verification date must be a valid date in YYYY-MM-DD format.`);
    if(verifiedAt&&Date.parse(verifiedAt)>Date.now())errors.push(`${prefix} verification date cannot be in the future.`);
    if([0,20].includes(deductionRate)&&(!verificationNumber||!verifiedAt))
      errors.push(`${prefix} a 0% or 20% rate requires imported verification evidence.`);
    if(verificationNumber&&(verificationNumber.length<3||verificationNumber.length>100))
      errors.push(`${prefix} verification number must contain 3 to 100 characters.`);
    const earlier=seenUtrs.get(utr);
    if(/^\d{10}$/.test(utr)&&earlier)errors.push(`${prefix} UTR duplicates row ${earlier}.`);
    else if(/^\d{10}$/.test(utr))seenUtrs.set(utr,number);

    if(!type)return;
    const hasVerification=Boolean(verificationNumber&&verifiedAt);
    values.push({
      name,tradingName:tradingName||null,type,utr,
      niNumber:type==="sole-trader"?niNumber:null,
      companyNumber:type==="company"?companyNumber:null,
      partnerUtr:type==="partnership"?partnerUtr:null,
      address:address||null,postcode:postcode||null,email:email||null,phone:phone||null,
      deductionRate,
      verificationNumber:verificationNumber||null,
      verificationMethod:hasVerification?"imported-evidence":null,
      verificationResponse:hasVerification?JSON.stringify({
        rate:deductionRate,reference:verificationNumber,source:"CSV import",
        liveVerificationPerformed:false,
      }):null,
      verifiedAt:hasVerification?verifiedAt:null,
      status:hasVerification?(deductionRate===0?"gross-payment-status":"verified"):"unverified",
    });
  });
  return {values,errors};
}
