import { calculateAttachment } from "./attachment-engine.ts";

const validIso=(value:unknown)=>{
  const text=String(value||""),time=/^\d{4}-\d{2}-\d{2}$/.test(text)?Date.parse(`${text}T00:00:00Z`):NaN;
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===text;
};
const moneyEqual=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<.005;

export function validateAttachmentOrderEvidence(row:any):string|null {
  if(!["manual","aeo-priority","aeo-non-priority","dea-standard","dea-higher","dea-fixed","child-maintenance","council-tax-england-wales","scottish-earnings-arrestment","scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed","ni-court-fine","ni-ejo"].includes(String(row?.calculationRule||""))||
    !["monthly","weekly","fortnightly","four-weekly"].includes(String(row.payFrequency||""))||!["fixed","percentage"].includes(String(row.deductionType||"")))
    return "Attachment order has an unsupported calculation configuration.";
  if(!["active","suspended","completed"].includes(String(row.status||""))||
    !String(row.type||"").trim()||String(row.issuingAuthority||"").trim().length<2||
    String(row.reference||"").trim().length<3||!validIso(row.effectiveDate))
    return "Attachment order has incomplete legal or lifecycle evidence.";
  const values=["protectedEarnings","deductionValue","priority","arrears","adminFee"].map(field=>Number(row[field]));
  if(values.some(value=>!Number.isFinite(value)||value<0)||Number(row.priority)<1||Number(row.priority)>100||
    row.balance!==null&&row.balance!==undefined&&(!Number.isFinite(Number(row.balance))||Number(row.balance)<0))
    return "Attachment order contains invalid monetary or priority evidence.";
  if(["manual","aeo-priority","aeo-non-priority","dea-fixed","child-maintenance","ni-ejo","scottish-current-maintenance","scottish-conjoined-maintenance"].includes(row.calculationRule)&&Number(row.deductionValue)<=0)
    return "Attachment order calculation requires a positive instructed deduction.";
  if(["aeo-priority","aeo-non-priority","ni-ejo"].includes(row.calculationRule)&&Number(row.protectedEarnings)<=0)
    return "Court AEO evidence requires a positive protected earnings rate.";
  if(row.calculationRule==="scottish-conjoined-mixed"&&
    (!Number.isFinite(Number(row.ordinaryDebtBalance))||Number(row.ordinaryDebtBalance)<=0||
      !Number.isFinite(Number(row.maintenanceDailyRate))||Number(row.maintenanceDailyRate)<=0))
    return "Mixed Scottish conjoined evidence requires positive ordinary-debt and maintenance components.";
  return null;
}

export function validateAttachmentDeductionEvidence(order:any,row:any,existingDeductions=0):string|null {
  const numeric=["deduction","adminFee","attachableNetPay","protectedEarningsApplied","shortfall","arrearsBefore","arrearsAfter"];
  if(numeric.some(field=>!Number.isFinite(Number(row?.[field]))||Number(row[field])<0)||
    [row?.ordinaryDeduction??0,row?.maintenanceDeduction??0].some(value=>!Number.isFinite(Number(value))||Number(value)<0)||
    row.balanceAfter!==null&&row.balanceAfter!==undefined&&(!Number.isFinite(Number(row.balanceAfter))||Number(row.balanceAfter)<0)||
    row.rate!==null&&row.rate!==undefined&&(!Number.isFinite(Number(row.rate))||Number(row.rate)<0||Number(row.rate)>100))
    return "Attachment deduction contains invalid calculation evidence.";
  const balanceBefore=row.balanceAfter===null||row.balanceAfter===undefined?null:Number(row.balanceAfter)+Number(row.deduction);
  let expected:ReturnType<typeof calculateAttachment>;
  try{expected=calculateAttachment({
    netPay:Number(row.attachableNetPay),type:String(order.type),
    deductionType:order.deductionType==="percentage"?"percentage":"fixed",
    deductionValue:Number(order.deductionValue),calculationRule:order.calculationRule,
    payFrequency:order.payFrequency,protectedEarnings:Number(order.protectedEarnings),balance:balanceBefore,
    adminFee:Number(order.adminFee),existingDeductions,arrears:Number(row.arrearsBefore),
    periodDays:["scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed"].includes(order.calculationRule)
      ?Math.max(1,Math.round(Number(row.protectedEarningsApplied)/24.66)):undefined,
    ordinaryDebtBalance:row.ordinaryBalanceAfter===null||row.ordinaryBalanceAfter===undefined?null:
      Number(row.ordinaryBalanceAfter)+Number(row.ordinaryDeduction),
    maintenanceDailyRate:Number(order.maintenanceDailyRate||0),
  });}catch{return "Attachment deduction uses an unsupported statutory frequency or calculation configuration.";}
  const fields=["deduction","adminFee","balanceAfter","rate","protectedEarnings","shortfall","arrearsAfter","ordinaryDeduction","maintenanceDeduction","ordinaryBalanceAfter"] as const;
  const actual:Record<string,unknown>={...row,protectedEarnings:row.protectedEarningsApplied,
    ordinaryDeduction:Number(row.ordinaryDeduction||0),maintenanceDeduction:Number(row.maintenanceDeduction||0),
    ordinaryBalanceAfter:row.ordinaryBalanceAfter??null};
  if(fields.some(field=>{
    if(expected[field]===null)return actual[field]!==null&&actual[field]!==undefined;
    return !moneyEqual(actual[field],expected[field]);
  }))return "Attachment deduction does not reconcile to its frozen calculation inputs.";
  return null;
}
