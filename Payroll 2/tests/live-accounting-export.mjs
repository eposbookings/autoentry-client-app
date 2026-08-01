import assert from "node:assert/strict";
import { scheduledPayPeriods } from "../lib/pay-frequency.ts";

const baseUrl=process.env.PAYFLOW_BASE_URL||"http://localhost:3001";
const bootstrapEmployerId=Number(process.env.PAYFLOW_BOOTSTRAP_EMPLOYER_ID||7);
const runId=process.env.PAYFLOW_LIVE_RUN_ID||"manual";
const email="qa-live@payflow.local",password="PayFlow-Live-QA-2026!",taxYear="2026/27";
let cookie="";
const checks=[];

function check(condition,message,details={}){
  assert.ok(condition,`${message}${Object.keys(details).length?` ${JSON.stringify(details)}`:""}`);
  checks.push(message);
}

async function request(path,{method="GET",json,expected=[200],captureCookie=false}={}){
  const response=await fetch(`${baseUrl}${path}`,{
    method,
    headers:{...(json?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{})},
    body:json===undefined?undefined:JSON.stringify(json),
  });
  if(captureCookie){
    const value=response.headers.get("set-cookie");
    if(value)cookie=value.split(";")[0];
  }
  const text=await response.text();
  let body=text;
  if((response.headers.get("content-type")||"").includes("application/json")&&text){
    try{body=JSON.parse(text);}catch{}
  }
  if(!expected.includes(response.status))
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for accounting-export testing");

const employerName=`Accounting Export QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"497/AC2026",accountsOfficeReference:"497PA12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated accounting employer is available",{employerId});

let employer=(await request(`/api/employer?employerId=${employerId}`)).body.employer;
const configured=(await request("/api/employer",{method:"PUT",json:{
  ...employer,
  accountingDefaultWagesCode:"WAGES-DEF",accountingControlCode:"NET-CTRL",
  accountingPayeCode:"PAYE-LIAB",accountingNicCode:"NIC-LIAB",accountingPensionCode:"PENS-LIAB",
  accountingOtherDeductionsCode:"OTHER-LIAB",accountingEmployerNicExpenseCode:"ERNIC-EXP",
  accountingEmployerPensionExpenseCode:"ERPENS-EXP",
}})).body.employer;
check(configured.accountingControlCode==="NET-CTRL"&&configured.accountingPayeCode==="PAYE-LIAB",
  "Tenant-scoped accounting nominal codes persist");
const invalidCode=await request("/api/employer",{method:"PUT",expected:[422],json:{...configured,accountingControlCode:"BAD CODE"}});
check(/Accounting nominal codes/.test(invalidCode.body.error),"Malformed accounting codes are rejected atomically");

let departmentRows=(await request(`/api/departments?employerId=${employerId}`)).body.departments||[];
for(const row of [
  {name:`Sales ${runId}`,nominalCode:"SALES-W",costCentre:"100"},
  {name:`Operations ${runId}`,nominalCode:"OPS-W",costCentre:"200"},
]){
  if(!departmentRows.some(item=>item.name===row.name))
    await request("/api/departments",{method:"POST",expected:[201],json:{employerId,...row}});
}
departmentRows=(await request(`/api/departments?employerId=${employerId}`)).body.departments;
const sales=departmentRows.find(item=>item.name===`Sales ${runId}`);
const operations=departmentRows.find(item=>item.name===`Operations ${runId}`);
check(Boolean(sales&&operations),"Two coded accounting departments are available");

const employeeRows=[
  {firstName:"Ada",lastName:"Sales",payrollId:`AC-${runId}-SA`,departmentName:sales.name,annualSalary:36000,gender:"F",niNumber:"EE300001C"},
  {firstName:"Owen",lastName:"Operations",payrollId:`AC-${runId}-OP`,departmentName:operations.name,annualSalary:24000,gender:"M",niNumber:"EE300002C"},
];
let employees=(await request(`/api/employees?employerId=${employerId}`)).body;
for(const row of employeeRows){
  if(employees.some(item=>item.payrollId===row.payrollId))continue;
  await request("/api/employees",{method:"POST",expected:[201],json:{
    employerId,...row,email:`${row.payrollId.toLowerCase()}@example.test`,dateOfBirth:"1990-01-15",
    address:"1 Ledger Street, London",postcode:"SW1A 1AA",startDate:"2026-04-06",
    taxCode:"1257L",week1Month1:false,niCategory:"A",payBasis:"period",
    hourlyRate:18,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,
    starterEvidence:"No P45 provided",starterDeclaration:"Statement A",reportedPayFrequency:"monthly",
  }});
}
employees=(await request(`/api/employees?employerId=${employerId}`)).body;
const ada=employees.find(item=>item.payrollId===employeeRows[0].payrollId);
const owen=employees.find(item=>item.payrollId===employeeRows[1].payrollId);
check(Boolean(ada&&owen),"Employees are assigned to separate accounting departments");

const period=scheduledPayPeriods(taxYear,"monthly")[0];
const records=[
  {employee:ada,grossPay:3000},
  {employee:owen,grossPay:2000},
].map(({employee,grossPay})=>({
  employeeId:employee.id,payrollId:employee.payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
  grossPay,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
  studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
  noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:employee.annualSalary,contractedHours:employee.contractedHours,periodNumber:1,
  items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:grossPay,amount:grossPay,taxable:true,nicable:true,pensionable:true}],
}));
await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:period.payDate,employees:records,
}});
check(true,"Multi-department payroll period finalised");

const reportPath=`/api/reports?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}&type=accounting-file&periodNumber=1`;
const accounting=(await request(reportPath)).body;
const signedTotal=accounting.rows.reduce((sum,row)=>Math.round((sum+Number(row[4]))*100)/100,0);
check(signedTotal===0,"Nominal-ledger accounting export balances exactly",{signedTotal});
check(accounting.rows.some(row=>row[1]==="100"&&row[2]==="SALES-W"&&row[4]===3000)&&
  accounting.rows.some(row=>row[1]==="200"&&row[2]==="OPS-W"&&row[4]===2000),
  "Gross wages are allocated to their finalised department codes",{rows:accounting.rows,adaDepartmentId:ada.departmentId,owenDepartmentId:owen.departmentId});
for(const required of ["NET-CTRL","PAYE-LIAB","NIC-LIAB","ERNIC-EXP"])
  check(accounting.rows.some(row=>row[2]===required),`Accounting export uses configured ${required} code`);

await request("/api/departments",{method:"PUT",json:{
  employerId,id:sales.id,name:`Renamed Sales ${runId}`,nominalCode:"CHANGED-W",costCentre:"999",
}});
const afterDepartmentChange=(await request(reportPath)).body;
check(afterDepartmentChange.rows.some(row=>row[1]==="100"&&row[2]==="SALES-W"&&String(row[3]).includes(`Sales ${runId}`))&&
  !afterDepartmentChange.rows.some(row=>row[1]==="999"||row[2]==="CHANGED-W"),
  "Finalised accounting allocation is immutable after department changes");

const csv=await request("/api/reports",{method:"POST",json:{
  employerId,taxYear,type:"accounting-file",format:"csv",periodNumber:1,
}});
check(csv.headers.get("x-payflow-source-checksum")&&csv.text.includes("SALES-W")&&csv.text.includes("NET-CTRL"),
  "Source-bound accounting CSV is downloadable");

console.log(JSON.stringify({
  baseUrl,employerId,
  summary:{checks:checks.length,rows:accounting.rows.length,signedTotal},
  checks,
},null,2));
