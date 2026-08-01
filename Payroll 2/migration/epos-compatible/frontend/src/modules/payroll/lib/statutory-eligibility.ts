export type StatutoryType="maternity"|"paternity"|"adoption"|"sick"|"shared-parental"|"bereavement"|"neonatal";

export type EligibilityInput={
  statutoryType:string;
  averageWeeklyEarnings:number;
  continuousEmploymentWeeks:number;
  evidenceReceived:boolean;
  noticeReceived:boolean;
  inLegalCustody?:boolean;
  sspEnding?:boolean;
};

const forms:Record<StatutoryType,string>={
  maternity:"SMP1",paternity:"SPP1",adoption:"SAP1",sick:"SSP1",
  "shared-parental":"written statement",bereavement:"SPBP1",neonatal:"NEO1",
};

export function assessStatutoryEligibility(input:EligibilityInput){
  const type=input.statutoryType as StatutoryType;
  if(!(type in forms))return {eligible:false,formType:"written statement",reasonCode:"unsupported",reason:"The selected absence is not a supported statutory-pay claim."};
  if(input.inLegalCustody)return {eligible:false,formType:forms[type],reasonCode:"legal-custody",reason:"The employee is in legal custody during the statutory pay period."};
  if(type==="sick"){
    if(input.sspEnding)return {eligible:false,formType:"SSP1",reasonCode:"ssp-ending",reason:"Statutory Sick Pay entitlement is ending."};
    return {eligible:true,formType:"SSP1",reasonCode:"eligible",reason:"The employee meets the recorded 2026/27 SSP checks; no Lower Earnings Limit or waiting days apply from 6 April 2026."};
  }
  if(type!=="bereavement"&&input.continuousEmploymentWeeks<26)return {eligible:false,formType:forms[type],reasonCode:"continuity",reason:"The employee did not have 26 weeks of continuous employment by the relevant qualifying week."};
  if(input.averageWeeklyEarnings<129)return {eligible:false,formType:forms[type],reasonCode:"earnings",reason:"Average weekly earnings were below the £129 Lower Earnings Limit."};
  if(!input.noticeReceived)return {eligible:false,formType:forms[type],reasonCode:"notice",reason:"The required statutory notice was not received in time."};
  if(!input.evidenceReceived)return {eligible:false,formType:forms[type],reasonCode:"evidence",reason:"The required evidence or declaration was not received."};
  return {eligible:true,formType:forms[type],reasonCode:"eligible",reason:type==="bereavement"?"The recorded 2026/27 day-one bereavement-pay checks passed using actual or reasonably expected weekly earnings.":"The recorded statutory-pay eligibility checks passed."};
}
