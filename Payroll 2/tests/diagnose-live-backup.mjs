import { hasValidFrozenRtiSnapshot } from "../lib/rti-snapshot.ts";
import { hasValidFrozenPensionSnapshot } from "../lib/pension-snapshot.ts";
import { validatePayItemEvidence, validatePayRunAccountingEvidence } from "../lib/pay-run-evidence.ts";
import { employeeActiveInRange } from "../lib/pay-periods.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const employerId=Number(process.env.PAYFLOW_EMPLOYER_ID);
if(!Number.isInteger(employerId))throw new Error("PAYFLOW_EMPLOYER_ID is required.");
let cookie="";
const login=await fetch(`${baseUrl}/api/admin/session`,{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({action:"login",employerId:7,email:"qa-live@payflow.local",password:"PayFlow-Live-QA-2026!"}),
});
cookie=String(login.headers.get("set-cookie")||"").split(";")[0];
if(!login.ok||!cookie)throw new Error(`Login failed: ${await login.text()}`);
const response=await fetch(`${baseUrl}/api/data?employerId=${employerId}`,{headers:{cookie}});
if(!response.ok)throw new Error(`Backup failed: ${await response.text()}`);
const backup=await response.json(),dataset=backup.dataset;
const periods=new Map(dataset.payPeriods.map(row=>[row.id,row]));
const employees=new Map(dataset.employees.map(row=>[row.id,row]));
const keys=new Set();
const diagnostics=[];
for(const run of dataset.payRuns){
  const period=periods.get(run.payPeriodId),items=dataset.payItems.filter(item=>item.payRunId===run.id);
  const key=`${run.payPeriodId}:${run.employeeId}`;
  const invalidSnapshot=run.status==="finalised"&&(!hasValidFrozenRtiSnapshot(run.rtiSnapshot)||
    Boolean(run.pensionSchemeId)&&!hasValidFrozenPensionSnapshot(run.pensionSnapshot));
  const lifecycle=period?.status==="finalised"?run.status!=="finalised":run.status!=="draft";
  const invalidItems=items.map(item=>validatePayItemEvidence(item)).filter(Boolean);
  const accounting=validatePayRunAccountingEvidence(run,items,0);
  if(invalidSnapshot||lifecycle||invalidItems.length||accounting||keys.has(key))diagnostics.push({
    runId:run.id,payPeriodId:run.payPeriodId,periodNumber:period?.periodNumber,employeeId:run.employeeId,
    employee:employees.get(run.employeeId)?.lastName,invalidSnapshot,lifecycle,invalidItems,accounting,duplicate:keys.has(key),
    financials:{grossPay:run.grossPay,taxablePay:run.taxablePay,nicablePay:run.nicablePay,payeTax:run.payeTax,
      employeeNic:run.employeeNic,employeePension:run.employeePension,otherDeductions:run.otherDeductions,netPay:run.netPay},
  });
  keys.add(key);
}
for(const period of dataset.payPeriods.filter(item=>item.status==="finalised")){
  const runs=dataset.payRuns.filter(run=>run.payPeriodId===period.id),runEmployeeIds=new Set(runs.map(run=>run.employeeId));
  for(const employee of dataset.employees){
    const active=employeeActiveInRange(employee.startDate,employee.leavingDate,period.periodStart,period.periodEnd);
    if(active&&!runEmployeeIds.has(employee.id))diagnostics.push({population:"missing",periodNumber:period.periodNumber,employee:employee.lastName});
  }
  for(const run of runs){
    const employee=employees.get(run.employeeId),active=employeeActiveInRange(employee?.startDate,employee?.leavingDate,period.periodStart,period.periodEnd);
    let postLeaving=false;try{postLeaving=JSON.parse(run.rtiSnapshot||"{}").paymentAfterLeaving===true;}catch{}
    if(!active&&!postLeaving)diagnostics.push({population:"extraneous",periodNumber:period.periodNumber,employee:employee?.lastName});
  }
}
console.log(JSON.stringify({employerId,runs:dataset.payRuns.length,diagnostics},null,2));
