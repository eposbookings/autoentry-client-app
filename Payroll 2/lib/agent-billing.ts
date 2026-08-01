export type AgentCharge={
  id:number;chargeCode:string;description:string;billingBasis:string;unitRate:number;vatRate:number;
  effectiveFrom?:string|null;effectiveTo?:string|null;status:string;
};
export type AgentBillingSource={
  periodIds:number[];payRuns:{id:number;employeeId:number;payPeriodId:number}[];
  submissions:{id:number;type:string}[];
};

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const submissionTypes=(chargeCode:string)=>{
  if(chargeCode==="rti-submission")return new Set(["FPS","EPS","Additional FPS","EXB"]);
  if(chargeCode==="cis-return")return new Set(["CIS300"]);
  if(chargeCode==="pension-file")return new Set(["PENSION-PROVIDER"]);
  if(chargeCode==="year-end")return new Set(["P60","P11D","P11D(b)"]);
  return null;
};

export function agentBillingUnits(charge:AgentCharge,source:AgentBillingSource){
  if(charge.billingBasis==="fixed")return 1;
  if(charge.billingBasis==="per-payslip")return source.payRuns.length;
  if(charge.billingBasis==="per-period")return source.periodIds.length;
  if(charge.billingBasis==="per-employee")return new Set(source.payRuns.map(run=>run.employeeId)).size;
  if(charge.billingBasis==="per-submission"){
    const allowed=submissionTypes(charge.chargeCode);
    return source.submissions.filter(item=>!allowed||allowed.has(item.type)).length;
  }
  throw new Error("Charge has an unsupported billing basis.");
}

export function calculateAgentInvoice(charges:AgentCharge[],source:AgentBillingSource,periodStart:string,periodEnd:string){
  const active=charges.filter(charge=>charge.status==="active"&&
    (!charge.effectiveFrom||charge.effectiveFrom<=periodEnd)&&(!charge.effectiveTo||charge.effectiveTo>=periodStart));
  const lines=active.map(charge=>{
    const units=agentBillingUnits(charge,source),unitRate=round(Number(charge.unitRate)),netAmount=round(units*unitRate);
    const vatRate=round(Number(charge.vatRate)),vatAmount=round(netAmount*vatRate/100);
    return {chargeId:charge.id,chargeCode:charge.chargeCode,description:charge.description,billingBasis:charge.billingBasis,units,unitRate,vatRate,netAmount,vatAmount,grossAmount:round(netAmount+vatAmount)};
  }).filter(line=>line.units>0);
  const netAmount=round(lines.reduce((sum,line)=>sum+line.netAmount,0));
  const vatAmount=round(lines.reduce((sum,line)=>sum+line.vatAmount,0));
  return {
    lines,netAmount,vatAmount,grossAmount:round(netAmount+vatAmount),
    payslipCount:source.payRuns.length,payrollPeriodCount:source.periodIds.length,
    employeeCount:new Set(source.payRuns.map(run=>run.employeeId)).size,submissionCount:source.submissions.length,
  };
}

export function validateAgentInvoiceEvidence(row:any){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.invoiceDate||""))||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(row?.periodStart||""))||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(row?.periodEnd||""))||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(row?.dueDate||""))||
    row.periodStart>row.periodEnd||!["draft","issued","voided"].includes(String(row.status||"")))
    return "Invoice contains invalid dates or lifecycle state.";
  let lines:any[],source:any;
  try{lines=JSON.parse(String(row.lineItems||"[]"));source=JSON.parse(String(row.sourceEvidence||"{}"));}catch{return "Invoice evidence is not valid JSON.";}
  if(!Array.isArray(lines)||!Array.isArray(source.periodIds)||!Array.isArray(source.payRuns)||!Array.isArray(source.submissions)||
    !Array.isArray(source.chargeLines))
    return "Invoice source evidence is incomplete.";
  const positiveUniqueIds=(values:any[])=>values.every(value=>Number.isInteger(value)&&value>0)&&new Set(values).size===values.length;
  if(source.periodStart!==row.periodStart||source.periodEnd!==row.periodEnd||
    !positiveUniqueIds(source.periodIds)||!positiveUniqueIds(source.payRuns.map((run:any)=>run?.id))||
    !positiveUniqueIds(source.submissions.map((submission:any)=>submission?.id))||
    source.payRuns.some((run:any)=>!Number.isInteger(run.employeeId)||run.employeeId<1||
      !Number.isInteger(run.payPeriodId)||!source.periodIds.includes(run.payPeriodId))||
    source.submissions.some((submission:any)=>typeof submission.type!=="string"||!submission.type.trim()))
    return "Invoice source evidence contains invalid or inconsistent identifiers.";
  if(JSON.stringify(source.chargeLines)!==JSON.stringify(lines))
    return "Invoice charge lines do not match its immutable source evidence.";
  const total=(key:string)=>round(lines.reduce((sum,line)=>sum+Number(line[key]||0),0));
  if(lines.some(line=>!Number.isInteger(line.units)||line.units<1||Number(line.unitRate)<0||Number(line.vatRate)<0||Number(line.vatRate)>100||
    Math.abs(round(line.units*line.unitRate)-Number(line.netAmount))>=.005||
    Math.abs(round(line.netAmount*line.vatRate/100)-Number(line.vatAmount))>=.005)||
    Math.abs(total("netAmount")-Number(row.netAmount))>=.005||Math.abs(total("vatAmount")-Number(row.vatAmount))>=.005||
    Math.abs(round(Number(row.netAmount)+Number(row.vatAmount))-Number(row.grossAmount))>=.005)
    return "Invoice totals do not reconcile to its immutable line items.";
  if(Number(row.payslipCount)!==source.payRuns.length||Number(row.payrollPeriodCount)!==source.periodIds.length||
    Number(row.employeeCount)!==new Set(source.payRuns.map((run:any)=>run.employeeId)).size||
    Number(row.submissionCount)!==source.submissions.length)
    return "Invoice counts do not reconcile to its immutable source evidence.";
  if(row.status==="issued"&&!row.issuedAt||row.status==="draft"&&row.issuedAt)return "Invoice issue evidence contradicts its status.";
  if(row.status==="voided"&&(!row.voidedAt||String(row.voidReason||"").trim().length<5)||row.status!=="voided"&&(row.voidedAt||row.voidReason))
    return "Invoice void evidence contradicts its status.";
  return null;
}
