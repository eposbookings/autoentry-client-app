export type CisPaymentVerificationEvidence = {
  taxYear:string;
  paymentDate:string;
  deductionRate:number;
  verificationNumber:string|null;
  verificationMethod:string|null;
  verifiedAt:string|null;
  status:string;
};

export type CisCurrentVerification = {
  status:string;
  deductionRate:number;
  verificationNumber:string|null;
  verificationMethod:string|null;
  verifiedAt:string|null;
};

const taxYearStart=(taxYear:string)=>{
  if(!/^\d{4}\/\d{2}$/.test(taxYear))return null;
  const start=Number(taxYear.slice(0,4));
  return Number(taxYear.slice(5))===(start+1)%100?start:null;
};

export function cisVerificationDecision(
  taxYear:string,
  paymentDate:string,
  current:CisCurrentVerification,
  priorPayments:CisPaymentVerificationEvidence[],
){
  const start=taxYearStart(taxYear);
  if(start===null)return {valid:false as const,required:true,reason:"invalid-tax-year",evidence:null};
  const eligibleYears=new Set([start,start-1,start-2]);
  const eligible=priorPayments
    .filter(payment=>payment.status!=="voided")
    .filter(payment=>{
      const paymentStart=taxYearStart(payment.taxYear);
      return paymentStart!==null&&eligibleYears.has(paymentStart)&&payment.paymentDate<=paymentDate;
    })
    .sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate));
  const latest=eligible[0]||null;
  const currentComplete=["verified","gross-payment-status"].includes(current.status)
    &&[0,20,30].includes(current.deductionRate)
    &&Boolean(current.verificationNumber&&current.verifiedAt);
  const currentIsNewer=currentComplete&&(!latest||String(current.verifiedAt)>=String(latest.verifiedAt||latest.paymentDate));

  if(currentIsNewer)return {
    valid:true as const,required:!latest,reason:latest?"newer-verification-result":"first-payment-verification",
    evidence:{
      deductionRate:current.deductionRate,verificationNumber:current.verificationNumber!,
      verificationMethod:current.verificationMethod||"recorded",verifiedAt:current.verifiedAt!,
    },
  };
  if(latest&&latest.verificationNumber)return {
    valid:true as const,required:false,reason:"continuing-payment-history",
    evidence:{
      deductionRate:latest.deductionRate,verificationNumber:latest.verificationNumber,
      verificationMethod:latest.verificationMethod||"historic-payment",
      verifiedAt:latest.verifiedAt||latest.paymentDate,
    },
  };
  return {
    valid:false as const,required:true,
    reason:latest?"historic-payment-missing-verification-evidence":"no-return-or-payment-history-in-current-or-previous-two-tax-years",
    evidence:null,
  };
}
