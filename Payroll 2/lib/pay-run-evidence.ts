const payItemTypes=new Set(["earning","benefit","pre-tax-deduction","post-tax-deduction","salary-sacrifice","payroll-giving","childcare-voucher"]);
const bool=(value:unknown)=>value===true||value===false||value===0||value===1;
const moneyEqual=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<.005;

export function validatePayItemEvidence(item:any):string|null {
  if(!payItemTypes.has(String(item?.type||""))||!String(item.name||"").trim()||String(item.name||"").length>100||
    ["quantity","rate","amount"].some(field=>!Number.isFinite(Number(item[field]))||Number(item[field])<0)||
    !["taxable","nicable","pensionable"].every(field=>bool(item[field])))
    return "Pay item has invalid type, amount or classification evidence.";
  return null;
}

export function validatePayRunAccountingEvidence(run:any,items:any[],netPayAdjustment=0):string|null {
  const nonNegative=["grossPay","taxablePay","nicablePay","employeeNic","employerNic","studentLoan",
    "postgraduateLoan","pensionablePay","statutoryPay","otherDeductions","netPay"];
  if(nonNegative.some(field=>!Number.isFinite(Number(run?.[field]))||Number(run[field])<0)||
    !Number.isFinite(Number(run.payeTax))||
    !Number.isFinite(Number(run.employeePension))||!Number.isFinite(Number(run.employerPension))||
    Number(run.statutoryPay)>Number(run.grossPay)+.005)
    return "Pay run contains invalid or contradictory monetary values.";
  if(items.some(item=>validatePayItemEvidence(item)))return "Pay run contains an invalid pay item.";
  const postTaxItems=items.filter(item=>item.type==="post-tax-deduction").reduce((sum,item)=>sum+Number(item.amount),0);
  if(Number(run.otherDeductions)+.005<postTaxItems)return "Pay run omits an itemised post-tax deduction.";
  const preTaxItems=items.filter(item=>["pre-tax-deduction","payroll-giving"].includes(item.type)).reduce((sum,item)=>sum+Number(item.amount),0);
  const upperNet=Number(run.grossPay)-Number(run.payeTax)-Number(run.employeeNic)-Number(run.studentLoan)-
    Number(run.postgraduateLoan)-Number(run.employeePension)-Number(run.otherDeductions);
  const baselineNet=Number(run.netPay)-Number(netPayAdjustment);
  if(!Number.isFinite(baselineNet)||baselineNet<-.005||baselineNet>Math.max(0,upperNet)+.005)
    return "Pay run net pay does not reconcile to stored deductions.";
  if(baselineNet>.005){
    const inferredPreTax=upperNet-baselineNet;
    if(inferredPreTax<preTaxItems-.005)return "Pay run omits an itemised pre-tax deduction.";
  }
  return null;
}

export function pensionRunMatchesSnapshot(run:any,snapshot:any):boolean {
  return Number(snapshot.schemeId)===Number(run.pensionSchemeId)&&
    (snapshot.schemaVersion==="payflow-pension-evidence-backfill-1"||
      moneyEqual(snapshot.employeeDeduction,run.employeePension));
}
