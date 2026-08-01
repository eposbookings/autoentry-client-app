import { isRecognisedPayeTaxCode } from "./tax-code.ts";

const starterEvidence=new Set(["P45 provided","No P45 provided","P60 only","Worked elsewhere this tax year","Secondary employment"]);
const starterDeclarations=new Set([
  "Statement A – first job since 6 April",
  "Statement B – only job now; worked since 6 April",
  "Statement C – another job or pension",
  "No statement – use 0T week 1 / month 1",
]);
const niCategories=new Set(["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"]);
const validDate=(value:unknown)=>{
  if(!value)return true;
  const text=String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)===text;
};

export function validateEmployeeStateEvidence(row:any,taxYear:string):string|null {
  const payrollId=String(row?.payrollId||"").trim(),taxCode=String(row?.taxCode||"").trim().toUpperCase();
  if(!payrollId||payrollId.length>35||/[\u0000-\u001f\u007f]/.test(payrollId)||
    !String(row?.firstName||"").trim()||!String(row?.lastName||"").trim())
    return "Employee identity or payroll ID is invalid.";
  if(row.gender&&!["M","F"].includes(String(row.gender)))
    return "Employee gender evidence must use the supported HMRC code.";
  if(!["monthly","weekly","fortnightly","four-weekly"].includes(String(row.reportedPayFrequency||""))||
    !["period","hourly","daily"].includes(String(row.payBasis||""))||
    !["credit-transfer","cash","cheque"].includes(String(row.paymentMethod||""))||
    !["active","leaver"].includes(String(row.status||"")))
    return "Employee employment or payment lifecycle is invalid.";
  if(!starterEvidence.has(String(row.starterEvidence||""))||!isRecognisedPayeTaxCode(taxCode)||!niCategories.has(String(row.niCategory||""))||
    ![null,"1","2","4","5"].includes(row.studentLoanPlan??null))
    return "Employee starter, tax, NIC or loan instruction is invalid.";
  const dates=["dateOfBirth","startDate","leavingDate","p45LeavingDate","directorStart","directorEnd","apprenticeshipStartDate"];
  if(dates.some(field=>!validDate(row[field]))||row.startDate&&row.leavingDate&&row.leavingDate<row.startDate)
    return "Employee dates are invalid or contradictory.";
  if(row.director&&(!row.directorStart||row.directorStart<row.startDate||row.directorEnd&&row.directorEnd<row.directorStart)||
    !row.director&&(row.directorStart||row.directorEnd||row.alternativeDirectorNic))
    return "Employee directorship evidence is contradictory.";
  const amounts=["annualSalary","hourlyRate","dailyRate","contractedHours","annualLeaveDays","workingDaysPerWeek","p45PreviousPay","p45PreviousTax"];
  if(amounts.some(field=>!Number.isFinite(Number(row[field]))||Number(row[field])<0)||
    Number(row.contractedHours)>168||!Number.isInteger(Number(row.workingDaysPerWeek))||Number(row.workingDaysPerWeek)>7)
    return "Employee pay, hours or leave values are outside supported bounds.";
  const hasP45Balances=Number(row.p45PreviousPay)>0||Number(row.p45PreviousTax)>0;
  if(hasP45Balances&&row.starterEvidence!=="P45 provided")return "Employee opening balances are not supported by P45 evidence.";
  if(row.starterEvidence==="P45 provided"){
    const startYear=Number(String(taxYear).slice(0,4)),start=`${startYear}-04-06`,end=`${startYear+1}-04-05`;
    if(!row.p45LeavingDate||row.p45LeavingDate<start||row.p45LeavingDate>end||row.startDate&&row.p45LeavingDate>row.startDate)
      return "Employee P45 evidence falls outside the employer tax year or employment chronology.";
  }
  const declaration=String(row.starterDeclaration||"").toUpperCase();
  if(!starterDeclarations.has(String(row.starterDeclaration||"")))
    return "Employee starter declaration is not a supported onboarding choice.";
  if(row.starterEvidence==="Worked elsewhere this tax year"&&!declaration.startsWith("STATEMENT B")||
    row.starterEvidence==="Secondary employment"&&!declaration.startsWith("STATEMENT C")||
    row.starterEvidence!=="P45 provided"&&declaration.startsWith("STATEMENT B")&&(!/^[SC]?1257L$/.test(taxCode)||!row.week1Month1)||
    row.starterEvidence!=="P45 provided"&&declaration.startsWith("STATEMENT C")&&!/^[SC]?BR$/.test(taxCode)||
    row.starterEvidence!=="P45 provided"&&declaration.startsWith("NO STATEMENT")&&(!/^[SC]?0T$/.test(taxCode)||!row.week1Month1))
    return "Employee starter declaration does not match the stored tax instruction.";
  if(row.starterEvidence==="P60 only"&&!row.p60ReferenceOnly||row.p60ReferenceOnly&&!/^\d{4}\/\d{2}$/.test(String(row.p60TaxYear||"")))
    return "Employee P60 reference evidence is incomplete.";
  const sort=String(row.sortCode||"").replace(/\D/g,""),account=String(row.accountNumber||"").replace(/\D/g,"");
  const hasBankEvidence=Boolean(row.bankName||row.accountName||row.sortCode||row.accountNumber);
  if(hasBankEvidence&&(!String(row.accountName||"").trim()||sort.length!==6||account.length!==8)||
    row.portalCanEditBank&&!row.employeePortal)
    return "Employee bank or portal permission evidence is incomplete.";
  return null;
}
