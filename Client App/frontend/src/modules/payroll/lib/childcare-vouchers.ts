export type ChildcareTaxBand="basic"|"higher"|"additional";
export type ChildcareVoucherFrequency="monthly"|"weekly"|"fortnightly"|"four-weekly";
const weeklyLimits:Record<ChildcareTaxBand,number>={basic:55,higher:28,additional:25};
const monthlyLimits:Record<ChildcareTaxBand,number>={basic:243,higher:124,additional:110};

export function childcareVoucherLimit(taxBand:ChildcareTaxBand,payFrequency:ChildcareVoucherFrequency){
  if(!["basic","higher","additional"].includes(taxBand))throw new Error("Select the basic, higher or additional earnings-assessment band.");
  if(payFrequency==="monthly")return monthlyLimits[taxBand];
  const multiplier=payFrequency==="fortnightly"?2:payFrequency==="four-weekly"?4:payFrequency==="weekly"?1:0;
  if(!multiplier)throw new Error("Childcare-voucher limits require a monthly, weekly, fortnightly or four-weekly payroll.");
  return weeklyLimits[taxBand]*multiplier;
}

export function childcareVoucherBandFromName(name:unknown):ChildcareTaxBand|null{
  const match=String(name||"").trim().match(/^Legacy childcare voucher salary sacrifice · (basic|higher|additional)$/i);
  return match?match[1].toLowerCase() as ChildcareTaxBand:null;
}

export function childcareVoucherName(taxBand:ChildcareTaxBand){
  if(!["basic","higher","additional"].includes(taxBand))throw new Error("Select the basic, higher or additional earnings-assessment band.");
  return `Legacy childcare voucher salary sacrifice · ${taxBand}`;
}

export function calculateChildcareVoucher(input:{amount:number;taxBand:ChildcareTaxBand;eligibleLegacyMember:boolean;payFrequency:ChildcareVoucherFrequency}){
  const amount=Number(input.amount);
  if(!Number.isFinite(amount)||amount<=0)throw new Error("Voucher amount must be a positive number.");
  if(!input.eligibleLegacyMember)throw new Error("Childcare vouchers are closed to new applicants; confirm continuing legacy-scheme eligibility.");
  const exemptLimit=childcareVoucherLimit(input.taxBand,input.payFrequency),exempt=Math.min(amount,exemptLimit),class1Excess=Math.max(0,amount-exempt);
  return {amount,taxBand:input.taxBand,payFrequency:input.payFrequency,exemptLimit,exempt:Math.round(exempt*100)/100,class1Excess:Math.round(class1Excess*100)/100};
}
