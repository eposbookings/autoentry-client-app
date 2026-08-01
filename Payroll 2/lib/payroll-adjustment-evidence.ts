const finalisedValueTypes=new Set(["gross-pay","taxable-pay","nicable-pay","statutory-pay","net-pay"]);
const deductionTypes=new Set(["paye-tax","employee-nic","employer-nic","student-loan","postgraduate-loan"]);
const allowedTypes=new Set([...finalisedValueTypes,"statutory-recovery",...deductionTypes]);
const validTimestamp=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));

export function validatePayrollAdjustmentEvidence(row:any,periodStatus:unknown,acceptedRtiBaseline=false):string|null {
  const type=String(row?.type||""),status=String(row?.status||"");
  if(!allowedTypes.has(type))return "Payroll adjustment has an unsupported correction type.";
  if(!Number.isFinite(Number(row.amount))||Number(row.amount)===0||
    String(row.reason||"").trim().length<5||String(row.reason||"").trim().length>500||
    !String(row.createdBy||"").trim())
    return "Payroll adjustment has invalid amount or audit evidence.";
  if(!["active","reversed"].includes(status))return "Payroll adjustment has an unsupported lifecycle status.";
  if(status==="active"&&row.reversedAt)return "Active payroll adjustment contains contradictory reversal evidence.";
  if(status==="reversed"&&!validTimestamp(row.reversedAt))return "Reversed payroll adjustment is missing its reversal timestamp.";
  if(periodStatus==="finalised"){
    if(!acceptedRtiBaseline)return "Finalised payroll adjustment is missing an accepted FPS baseline.";
  }else if(["open","draft"].includes(String(periodStatus||""))){
    if(finalisedValueTypes.has(type)||type==="statutory-recovery")
      return "Open-period adjustment contains a finalised-payroll correction type.";
  }else return "Payroll adjustment targets a period that cannot accept corrections.";
  return null;
}
