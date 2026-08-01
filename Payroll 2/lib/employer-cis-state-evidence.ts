const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&
  Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validDate=(value:unknown)=>{
  if(!value)return true;
  const text=String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)===text;
};

export function validateEmployerStateEvidence(row:any):string|null {
  if(!String(row?.name||"").trim()||!["monthly","weekly","fortnightly","four-weekly"].includes(String(row.payFrequency||""))||!validTaxYear(row.taxYear)||
    !["active","inactive","archived"].includes(String(row.status||"")))
    return "Employer identity, tax year or payroll lifecycle is invalid.";
  if(row.payeReference&&!/^\d{3}\/[A-Z0-9]{1,10}$/i.test(String(row.payeReference))||
    row.accountsOfficeReference&&!/^\d{3}P[A-Z0-9]\d{8}$/i.test(String(row.accountsOfficeReference))||
    row.companyNumber&&!/^(?:[A-Z]{2}\d{6}|\d{8})$/i.test(String(row.companyNumber).replace(/\s/g,""))||
    row.cisContractor&&!/^\d{10}$/.test(String(row.cisUtr||"").replace(/\s/g,"")))
    return "Employer registration identifiers are invalid or incomplete.";
  const levy=Number(row.apprenticeshipLevyAllowance);
  if(!Number.isFinite(levy)||levy<0||levy>15000)return "Employer Apprenticeship Levy allowance is outside supported bounds.";
  return null;
}

export function validateEmployerSettingsEvidence(row:any):string|null {
  if(!["hourly","daily","period"].includes(String(row?.typicalPayBasis||""))||
    !["active","inactive","onboarding","archived"].includes(String(row.clientStatus||""))||
    !["employee-postcode","employee-ni-last4","manual-per-document"].includes(String(row.documentPasswordStrategy||""))||
    !/^#[0-9a-f]{6}$/i.test(String(row.colourReference||""))||
    row.reportAccentColour!==undefined&&!/^#[0-9a-f]{6}$/i.test(String(row.reportAccentColour||""))||
    row.reportStationeryMode!==undefined&&!["standard","preprinted","plain"].includes(String(row.reportStationeryMode||"")))
    return "Employer defaults contain unsupported operating choices.";
  if(!validPayslipLogo(row.logoUrl)||row.payslipDesign&&validatePayslipDesign(row.payslipDesign))
    return "Employer payslip design evidence is invalid.";
  const bounds:[string,number,number][]=[["typicalAnnualLeaveDays",0,366],["typicalWeeklyHours",0,168],["minimumHourlyRate",0,100000]];
  if(bounds.some(([field,min,max])=>!Number.isFinite(Number(row[field]))||Number(row[field])<min||Number(row[field])>max)||
    !Number.isInteger(Number(row.nextWorksNumber))||Number(row.nextWorksNumber)<1||Number(row.nextWorksNumber)>999999999)
    return "Employer numeric defaults are outside supported bounds.";
  if(["firstPayDate","finalFpsDue","epsDue","p60Due","p11dDue"].some(field=>!validDate(row[field]))||
    ["primaryContactEmail","alternateContactEmail"].some(field=>row[field]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row[field]))))
    return "Employer contact or compliance dates are invalid.";
  const bankValues=["bankName","bankAccountName","bankSortCode","bankAccountNumber"].map(field=>String(row[field]||"").trim());
  if(bankValues.some(Boolean)&&(!bankValues[1]||!/^\d{6}$/.test(bankValues[2])||!/^\d{8}$/.test(bankValues[3])))
    return "Employer bank evidence is incomplete or malformed.";
  if(String(row.employerNotes||"").length>4000||String(row.reportHeaderText||"").length>100||String(row.reportFooterText||"").length>240)
    return "Employer notes or report presentation text exceed the supported evidence limit.";
  const accountingCodes=[
    "accountingDefaultWagesCode","accountingControlCode","accountingPayeCode","accountingNicCode",
    "accountingPensionCode","accountingOtherDeductionsCode","accountingEmployerNicExpenseCode","accountingEmployerPensionExpenseCode",
  ];
  if(accountingCodes.some(field=>row[field]!==undefined&&!/^[A-Za-z0-9._-]{1,20}$/.test(String(row[field]||""))))
    return "Employer accounting nominal codes are invalid.";
  return null;
}

export function validateSubcontractorStateEvidence(row:any):string|null {
  const type=String(row?.type||""),utr=String(row?.utr||"").replace(/\s/g,""),rate=Number(row?.deductionRate);
  if(!String(row?.name||"").trim()||!["sole-trader","partnership","company"].includes(type)||!/^\d{10}$/.test(utr)||
    ![0,20,30].includes(rate)||!["unverified","verified","gross-payment-status"].includes(String(row.status||"")))
    return "CIS subcontractor identity or lifecycle evidence is invalid.";
  const verified=row.status!=="unverified";
  if(verified&&(!String(row.verificationNumber||"").trim()||!String(row.verificationMethod||"").trim()||
    !Number.isFinite(Date.parse(String(row.verifiedAt||"")))))
    return "Verified CIS subcontractor is missing verification evidence.";
  if(verified&&type==="sole-trader"&&!/^[A-Z]{2}\d{6}[A-D]$/i.test(String(row.niNumber||"").replace(/\s/g,""))||
    verified&&type==="company"&&!/^[A-Z0-9]{8}$/i.test(String(row.companyNumber||"").replace(/\s/g,""))||
    verified&&type==="partnership"&&!/^\d{10}$/.test(String(row.partnerUtr||"").replace(/\s/g,"")))
    return "Verified CIS subcontractor is missing its type-specific identifier.";
  if(row.status==="gross-payment-status"&&rate!==0||row.status==="verified"&&![20,30].includes(rate)||
    row.status==="unverified"&&rate!==30)
    return "CIS subcontractor status contradicts its deduction rate.";
  return null;
}
import { validPayslipLogo, validatePayslipDesign } from "./payslip-design.ts";
