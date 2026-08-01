export type SampleEmployeeProfile={
  payrollId:string;
  firstName:string;
  lastName:string;
  dateOfBirth:string;
  gender:string;
  address:string;
  postcode:string;
  email:string;
  jobTitle:string;
  department:string;
  startDate:string;
  starterEvidence:string;
  starterDeclaration:string;
  p45LeavingDate?:string;
  p45PreviousPay?:number;
  p45PreviousTax?:number;
  p60TaxYear?:string;
  p60ReferenceOnly?:boolean;
  taxCode:string;
  week1Month1?:boolean;
  niCategory:string;
  director?:boolean;
  directorStart?:string;
  alternativeDirectorNic?:boolean;
  noSecondaryNic?:boolean;
  studentLoanPlan?:"1"|"2"|"4"|"5";
  postgraduateLoan?:boolean;
  annualSalary:number;
  contractedHours:number;
  minimumWageCategory?:"age-based"|"apprentice";
  apprenticeshipStartDate?:string;
  irregularPayment?:boolean;
  zeroPayFpsExclusion?:boolean;
  paymentToBody?:boolean;
  trivialCommutation?:boolean;
  flexibleDrawdown?:boolean;
  confidential?:boolean;
  employeePortal?:boolean;
  portalCanEditBank?:boolean;
};

const base=(payrollId:string,firstName:string,lastName:string,extras:Partial<SampleEmployeeProfile>={}):SampleEmployeeProfile=>({
  payrollId,firstName,lastName,dateOfBirth:"1990-06-15",gender:"F",
  address:"1 Demonstration Way, London",postcode:"EC1A 1AA",
  email:`${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g,".").replace(/^\.+|\.+$/g,"")+"@demo.payflow.local",
  jobTitle:"Employee",department:"Operations",startDate:"2026-04-06",
  starterEvidence:"No P45 provided",starterDeclaration:"Statement A – first job since 6 April",taxCode:"1257L",niCategory:"A",
  annualSalary:36000,contractedHours:37.5,...extras,
});

export function sampleEmployeeProfiles():SampleEmployeeProfile[]{
  return [
    base("DEMO-001","Amelia","P45",{starterEvidence:"P45 provided",starterDeclaration:"Statement B – only job now; worked since 6 April",startDate:"2026-05-04",p45LeavingDate:"2026-05-01",p45PreviousPay:7800,p45PreviousTax:620,annualSalary:34800}),
    base("DEMO-002","Ben","First Job",{starterDeclaration:"Statement A – first job since 6 April",annualSalary:25200}),
    base("DEMO-003","Cara","Earlier Employment",{starterEvidence:"Worked elsewhere this tax year",starterDeclaration:"Statement B – only job now; worked since 6 April",week1Month1:true,annualSalary:29400}),
    base("DEMO-004","Daniel","P60 Reference",{starterEvidence:"P60 only",starterDeclaration:"Statement B – only job now; worked since 6 April",p60TaxYear:"2025/26",p60ReferenceOnly:true,week1Month1:true,annualSalary:38400}),
    base("DEMO-005","Ella","Secondary Job",{starterEvidence:"Secondary employment",starterDeclaration:"Statement C – another job or pension",taxCode:"BR",week1Month1:true,annualSalary:16800,contractedHours:18}),
    base("DEMO-006","Finlay","Scottish",{gender:"M",taxCode:"S1257L",annualSalary:62400,department:"Finance"}),
    base("DEMO-007","Gwen","Welsh",{taxCode:"C1257L",annualSalary:37200,department:"Finance"}),
    base("DEMO-008","Harriet","Director Annual",{jobTitle:"Director",department:"Board",director:true,directorStart:"2026-04-06",annualSalary:108000}),
    base("DEMO-009","Isaac","Director Alternative",{gender:"M",jobTitle:"Director",department:"Board",director:true,directorStart:"2026-04-06",alternativeDirectorNic:true,annualSalary:57600}),
    base("DEMO-010","Jo","State Pension Age",{dateOfBirth:"1955-01-10",niCategory:"C",annualSalary:32400}),
    base("DEMO-011","Kai","Under Twenty One",{gender:"M",dateOfBirth:"2007-09-12",niCategory:"M",annualSalary:31200}),
    base("DEMO-012","Lily","Apprentice",{dateOfBirth:"2004-11-21",niCategory:"H",annualSalary:27600,minimumWageCategory:"apprentice",apprenticeshipStartDate:"2026-04-06",department:"Apprentices"}),
    base("DEMO-013","Mo","NIC Deferment",{gender:"M",niCategory:"J",annualSalary:66000}),
    base("DEMO-014","Nadia","Plan One",{studentLoanPlan:"1",annualSalary:37200}),
    base("DEMO-015","Owen","Plan Two PG",{gender:"M",studentLoanPlan:"2",postgraduateLoan:true,annualSalary:46800}),
    base("DEMO-016","Priya","Plan Four",{taxCode:"S1257L",studentLoanPlan:"4",annualSalary:40800}),
    base("DEMO-017","Quinn","Plan Five",{studentLoanPlan:"5",annualSalary:33600}),
    base("DEMO-018","Tara","Irregular",{irregularPayment:true,zeroPayFpsExclusion:false,annualSalary:0,contractedHours:0}),
    base("DEMO-019","Bodhi","Paid To Body",{gender:"M",paymentToBody:true,trivialCommutation:true,annualSalary:30000}),
    base("DEMO-020","Cora","Portal Confidential",{confidential:true,employeePortal:true,portalCanEditBank:true,annualSalary:43200,department:"People"}),
  ];
}

export const sampleDepartments=[
  {name:"Operations",nominalCode:"5000",costCentre:"OPS"},
  {name:"Finance",nominalCode:"5100",costCentre:"FIN"},
  {name:"Board",nominalCode:"5200",costCentre:"BOARD"},
  {name:"Apprentices",nominalCode:"5300",costCentre:"APP"},
  {name:"People",nominalCode:"5400",costCentre:"HR"},
];

export const sampleSubcontractors=[
  {name:"Demo Unmatched Partnership",tradingName:"Demo Unmatched Partnership",type:"partnership",utr:"1000000001",partnerUtr:"1000000002",deductionRate:30,status:"verified",verificationMethod:"manual",verificationResponse:"unmatched",verificationNumber:"DEMO-30-2026",verifiedAt:"2026-04-06"},
  {name:"Demo Standard Scaffolding Ltd",tradingName:"Demo Standard Scaffolding",type:"company",utr:"1000000003",companyNumber:"00000001",deductionRate:20,status:"verified",verificationMethod:"manual",verificationResponse:"matched",verificationNumber:"DEMO-20-2026",verifiedAt:"2026-04-06"},
  {name:"Demo Gross Groundworks",tradingName:"Demo Gross Groundworks",type:"sole-trader",utr:"1000000004",niNumber:"AB000000A",deductionRate:0,status:"gross-payment-status",verificationMethod:"manual",verificationResponse:"gross",verificationNumber:"DEMO-00-2026",verifiedAt:"2026-04-06"},
];
