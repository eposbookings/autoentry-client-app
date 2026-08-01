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
  if(!expected.includes(response.status)){
    throw new Error(`${method} ${path} returned ${response.status}: ${typeof body==="string"?body:JSON.stringify(body)}`);
  }
  return {status:response.status,body,text,headers:response.headers};
}

await request("/api/admin/session",{method:"POST",captureCookie:true,json:{
  action:"login",employerId:bootstrapEmployerId,email,password,
}});
check(Boolean(cookie),"Owner authenticated for operational-controls testing");

const employerName=`Operational Controls QA ${runId}`;
const memberships=(await request(`/api/admin/session?employerId=${bootstrapEmployerId}`)).body.memberships||[];
let employerId=memberships.find(item=>item.employerName===employerName)?.employerId;
if(!employerId){
  const created=await request("/api/employer",{method:"POST",expected:[201],json:{
    name:employerName,legalName:`${employerName} Limited`,taxYear,payFrequency:"monthly",
    payeReference:"498/OC2026",accountsOfficeReference:"498PF12345678",
  }});
  employerId=created.body.employer.id;
}
check(Number.isInteger(employerId),"Isolated operational-controls employer is available",{employerId});

const operations=(await request("/api/departments",{method:"POST",expected:[201],json:{
  employerId,name:"Operations",nominalCode:"5000",costCentre:"OPS",
}})).body.department;
const duplicateDepartment=await request("/api/departments",{method:"POST",expected:[409],json:{
  employerId,name:"operations",nominalCode:"5001",costCentre:"DUP",
}});
check(/already exists/.test(duplicateDepartment.body.error),"Department names are unique without case sensitivity");
const updatedDepartment=(await request("/api/departments",{method:"PUT",json:{
  employerId,id:operations.id,name:"Site Operations",nominalCode:"5010",costCentre:"SITE",
}})).body.department;
check(updatedDepartment.name==="Site Operations"&&updatedDepartment.costCentre==="SITE","Department can be renamed with accounting codes");
const spare=(await request("/api/departments",{method:"POST",expected:[201],json:{
  employerId,name:"Temporary",nominalCode:"5099",costCentre:"TMP",
}})).body.department;
const removedSpare=await request("/api/departments",{method:"DELETE",json:{employerId,id:spare.id}});
check(removedSpare.body.deleted===true,"Unassigned department can be deleted");

const payrollId=`OC-${runId}-1`;
let employee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.payrollId===payrollId);
if(!employee)employee=(await request("/api/employees",{method:"POST",expected:[201],json:{
  employerId,firstName:"Olivia",lastName:"Operations",payrollId,email:`operations-${runId}@example.test`,
  niNumber:"AB200001C",dateOfBirth:"1990-06-15",gender:"F",address:"1 Control Road, London",postcode:"SW1A 1AA",
  startDate:"2026-04-06",taxCode:"1257L",week1Month1:false,niCategory:"A",annualSalary:23000,payBasis:"period",
  hourlyRate:11.79,contractedHours:37.5,workingDaysPerWeek:5,annualLeaveDays:28,paymentMethod:"credit-transfer",
  starterEvidence:"No P45 provided",starterDeclaration:"Statement A",employeePortal:false,portalCanEditBank:false,
  reportedPayFrequency:"monthly",departmentName:"Site Operations",
}})).body;
check(employee.departmentId===operations.id,"Employee is assigned to the renamed department");
const blockedDepartmentDelete=await request("/api/departments",{method:"DELETE",expected:[409],json:{employerId,id:operations.id}});
check(/Move employees out/.test(blockedDepartmentDelete.body.error),"Assigned department cannot be deleted");

const invalidCalendar=await request("/api/calendar-days",{method:"POST",expected:[422],json:{
  employerId,taxYear:"2026/99",date:"2026-04-15",name:"Invalid year",type:"national-holiday",
}});
check(/selected tax year/.test(invalidCalendar.body.error),"Employer calendar rejects a non-consecutive tax year");
const holiday=(await request("/api/calendar-days",{method:"POST",expected:[201],json:{
  employerId,taxYear,date:"2026-04-15",name:"Regional site holiday",type:"national-holiday",
}})).body;
const duplicateHoliday=await request("/api/calendar-days",{method:"POST",expected:[409],json:{
  employerId,taxYear,date:"2026-04-15",name:"Duplicate site holiday",type:"national-holiday",
}});
check(/already exists/.test(duplicateHoliday.body.error),"Duplicate active employer calendar day is rejected");
const leave=(await request("/api/leave",{method:"POST",expected:[201],json:{
  employerId,payrollId,type:"Annual leave",statutoryType:"none",startDate:"2026-04-13",endDate:"2026-04-17",
  averageWeeklyEarningsSource:"manual",averageWeeklyEarnings:0,continuousEmploymentWeeks:0,
  evidenceReceived:true,noticeReceived:true,qualifyingDays:5,qualifyingWeekdays:[1,2,3,4,5],status:"calculated",
}})).body;
check(leave.qualifyingDays===4&&JSON.parse(leave.excludedCalendarDates).includes("2026-04-15"),
  "Annual leave excludes the active employer holiday and freezes that date");
const cancelledHoliday=(await request("/api/calendar-days",{method:"PUT",json:{
  employerId,id:holiday.id,action:"cancel",
}})).body;
check(cancelledHoliday.status==="cancelled"&&cancelledHoliday.frozenLeaveEvents===1,
  "Cancelling a calendar day preserves and reports existing frozen leave evidence");
const cancelledDuplicate=await request("/api/calendar-days",{method:"POST",expected:[409],json:{
  employerId,taxYear,date:"2026-04-15",name:"Recreated site holiday",type:"national-holiday",
}});
check(/Restore it instead/.test(cancelledDuplicate.body.error),"Cancelled calendar history must be restored rather than recreated");
const restoredHoliday=(await request("/api/calendar-days",{method:"PUT",json:{
  employerId,id:holiday.id,action:"restore",
}})).body;
check(restoredHoliday.status==="active"&&restoredHoliday.frozenLeaveEvents===1,
  "Employer holiday can be restored without rewriting frozen leave");

const olderCoding=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId,type:"coding",noticeIdentifier:`P9-OLD-${runId}`,
  issuedDate:"2026-04-07",effectiveDate:"2026-04-06",taxCode:"1100L",week1Month1:false,source:"hmrc",
}})).body;
const duplicateCoding=await request("/api/hmrc-notices",{method:"POST",expected:[409],json:{
  employerId,taxYear,payrollId,type:"coding",noticeIdentifier:`P9-DUP-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",taxCode:"1100L",week1Month1:false,source:"hmrc",
}});
check(/equivalent active HMRC notice/.test(duplicateCoding.body.error),"Equivalent active HMRC instruction is rejected");
const newerCoding=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId,type:"coding",noticeIdentifier:`P9-NEW-${runId}`,
  issuedDate:"2026-04-21",effectiveDate:"2026-04-20",taxCode:"1185L",week1Month1:true,source:"hmrc",
}})).body;
const appliedCoding=(await request("/api/hmrc-notices",{method:"PUT",json:{
  employerId,id:newerCoding.id,action:"apply",
}})).body;
check(appliedCoding.status==="applied","HMRC coding notice can be applied before the employer’s first payroll run");
const codingRows=(await request(`/api/hmrc-notices?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body.notices;
check(codingRows.find(item=>item.id===olderCoding.id)?.status==="superseded",
  "Applying the later coding instruction supersedes the older new notice");

const ninoNotice=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId,type:"nino",noticeIdentifier:`NINO-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",niNumber:"AB 200099 C",source:"hmrc",
}})).body;
await request("/api/hmrc-notices",{method:"PUT",json:{employerId,id:ninoNotice.id,action:"apply"}});
const loanNotice=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,payrollId,type:"student-loan",noticeIdentifier:`SL1-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",loanAction:"start",studentLoanPlan:"2",source:"hmrc",
}})).body;
await request("/api/hmrc-notices",{method:"PUT",json:{employerId,id:loanNotice.id,action:"apply"}});
const genericNotice=(await request("/api/hmrc-notices",{method:"POST",expected:[201],json:{
  employerId,taxYear,type:"generic",noticeIdentifier:`GEN-${runId}`,
  issuedDate:"2026-04-08",effectiveDate:"2026-04-06",message:"Manual HMRC contact note",source:"manual",
}})).body;
const ignoredGeneric=(await request("/api/hmrc-notices",{method:"PUT",json:{employerId,id:genericNotice.id,action:"ignore"} })).body;
check(ignoredGeneric.status==="ignored","Generic HMRC notice can be explicitly ignored with audit evidence");

employee=(await request(`/api/employees?employerId=${employerId}`)).body.find(item=>item.id===employee.id);
check(employee.taxCode==="1185L"&&employee.week1Month1===true&&employee.niNumber==="AB200099C"&&employee.studentLoanPlan==="2",
  "Applied HMRC notices update tax code basis, NINO and student-loan plan");

const eligibleNotice=await request("/api/statutory-notices",{method:"POST",expected:[409],json:{
  employerId,payrollId,statutoryType:"maternity",decisionDate:"2026-07-20",
  payStartDate:"2026-09-01",payEndDate:"2027-03-31",averageWeeklyEarnings:700,
  continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,
}});
check(/employee is eligible/.test(eligibleNotice.body.error),"Eligible statutory-pay assessment cannot create a non-payment notice");
const statutory=(await request("/api/statutory-notices",{method:"POST",expected:[201],json:{
  employerId,payrollId,statutoryType:"maternity",decisionDate:"2026-07-20",
  payStartDate:"2026-09-01",payEndDate:"2027-03-31",averageWeeklyEarnings:100,
  continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,
}})).body;
check(statutory.formType==="SMP1"&&statutory.payloadChecksum?.length===64&&statutory.assessment.reasonCode==="earnings",
  "Ineligible maternity assessment issues a checksummed SMP1 evidence record");
const duplicateStatutory=await request("/api/statutory-notices",{method:"POST",expected:[409],json:{
  employerId,payrollId,statutoryType:"maternity",decisionDate:"2026-07-21",
  payStartDate:"2026-09-01",payEndDate:"2027-03-31",averageWeeklyEarnings:100,
  continuousEmploymentWeeks:30,evidenceReceived:true,noticeReceived:true,
}});
check(/already exists/.test(duplicateStatutory.body.error),"Duplicate issued statutory non-payment notice is rejected");
const statutoryHtml=await request(`/api/statutory-notices?employerId=${employerId}&id=${statutory.id}&format=html`);
check(statutoryHtml.headers.get("x-payflow-source-checksum")===statutory.payloadChecksum&&
  statutoryHtml.text.includes("Olivia Operations")&&!/[Ââ]/.test(statutoryHtml.text),
  "Printable SMP1 uses frozen checksummed evidence and clean UTF-8 typography");
const delivered=(await request("/api/statutory-notices",{method:"PUT",json:{
  employerId,id:statutory.id,status:"delivered",
}})).body;
check(delivered.status==="delivered","Issued statutory notice records delivery");
const shortCancellation=await request("/api/statutory-notices",{method:"PUT",expected:[422],json:{
  employerId,id:statutory.id,status:"cancelled",reason:"bad",
}});
check(/cancellation reason/.test(shortCancellation.body.error),"Statutory notice cancellation requires a meaningful reason");
const cancelled=(await request("/api/statutory-notices",{method:"PUT",json:{
  employerId,id:statutory.id,status:"cancelled",reason:"Employee evidence was corrected after issue.",
}})).body;
check(cancelled.status==="cancelled","Delivered statutory notice can be cancelled with retained reason");

const invalidStatutory=await request("/api/calculate",{method:"POST",expected:[422],json:{
  kind:"statutory",type:"maternity",averageWeeklyEarnings:-1,weeks:2,
}});
check(/valid non-negative/.test(invalidStatutory.body.error),"Statutory calculator rejects negative earnings");
const statutoryCalculation=(await request("/api/calculate",{method:"POST",json:{
  kind:"statutory",type:"maternity",averageWeeklyEarnings:700,weeks:2,smallEmployer:true,
}})).body;
check(statutoryCalculation.total>0&&statutoryCalculation.recoverable>0,
  "Statutory calculator returns pay and small-employer recovery");
const targetNet=(await request("/api/calculate",{method:"POST",json:{
  kind:"target-net",targetNetPay:2000,taxCode:"1257L",niCategory:"A",periodNumber:1,
}})).body;
check(Math.abs(targetNet.achievedNetPay-2000)<=0.01&&targetNet.requiredGrossPay>2000,
  "Target-net calculator solves gross pay to the penny");

const period=scheduledPayPeriods(taxYear,"monthly")[0],gross=1916.67;
const finalised=(await request("/api/pay-runs",{method:"POST",json:{
  action:"finalise",source:"manual",employerId,taxYear,periodNumber:1,payDate:period.payDate,employees:[{
    employeeId:employee.id,payrollId,firstName:employee.firstName,lastName:employee.lastName,email:employee.email,
    grossPay:gross,taxCode:employee.taxCode,niCategory:employee.niCategory,week1Month1:employee.week1Month1,
    studentLoanPlan:employee.studentLoanPlan,postgraduateLoan:employee.postgraduateLoan,director:employee.director,
    noSecondaryNic:employee.noSecondaryNic,directorMethod:"annual",annualSalary:23000,contractedHours:37.5,periodNumber:1,
    items:[{type:"earning",name:"Monthly contractual pay",quantity:1,rate:gross,amount:gross,taxable:true,nicable:true,pensionable:true}],
  }],
}})).body;
const result=finalised.calculated[0].result;
check(finalised.status==="finalised"&&result.grossPay===gross,"Payroll finalises with the applied HMRC instructions");

const invalidAnalysis=await request(`/api/analysis?employerId=${employerId}&taxYear=${encodeURIComponent("2026/99")}`,{expected:[422]});
check(/valid tax year/.test(invalidAnalysis.body.error),"Analysis rejects a non-consecutive tax year");
const analysis=(await request(`/api/analysis?employerId=${employerId}&taxYear=${encodeURIComponent(taxYear)}`)).body;
check(analysis.periods.length===1&&analysis.totals.grossPay===gross&&
  analysis.departments.some(item=>item.department==="Site Operations"&&item.grossPay===gross),
  "Analysis reconciles the finalised period and renamed department");
check(analysis.totals.payCount===1&&analysis.totals.averagePay===gross&&analysis.periods[0].payCount===1&&
  analysis.payElements.some(item=>item.name==="Monthly contractual pay"&&item.amount===gross&&item.occurrences===1),
  "Analysis exposes pay counts, average pay and frozen pay-element classifications");
check(analysis.minimumWageWarnings.some(item=>item.employeeId===employee.id),
  "Analysis flags the employee’s sub-minimum effective hourly rate");

const history=(await request(`/api/employee-history?employerId=${employerId}&employeeId=${employee.id}`)).body;
const categories=new Set(history.events.map(item=>item.category));
check(["record","payroll","leave","hmrc","statutory"].every(category=>categories.has(category))&&history.summary.statutoryNotices===1,
  "Employee history combines record, payroll, leave, HMRC and statutory-notice lifecycles",history.summary);
check(!/[Ââ]/.test(JSON.stringify(history)),"Employee history text uses clean UTF-8 typography");

console.log(JSON.stringify({
  baseUrl,employerId,
  summary:{checks:checks.length,historyEvents:history.summary.total,hmrcNotices:codingRows.length,minimumWageWarnings:analysis.minimumWageWarnings.length},
  checks,
},null,2));
