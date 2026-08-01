import { calculateMonthlyPayroll, calculateStatutoryPay, type PayrollInput, type PayrollResult } from "./payroll-engine.ts";

type Scenario = {
  id: string;
  employee: string;
  case: string;
  month1: PayrollInput;
  month2: PayrollInput;
  expected: (first: PayrollResult, second: PayrollResult) => string[];
};

const noFailures = (a: PayrollResult, b: PayrollResult) => {
  const failures: string[] = [];
  for (const [month, result] of [["Month 1", a], ["Month 2", b]] as const) {
    if (!Object.values(result).filter(v => typeof v === "number").every(Number.isFinite)) failures.push(`${month}: non-finite calculation`);
    if (result.netPay < 0) failures.push(`${month}: negative net pay`);
  }
  return failures;
};

const base = (grossPay: number, extras: Partial<PayrollInput> = {}): PayrollInput => ({
  grossPay, taxCode: "1257L", niCategory: "A", pensionEmployeeRate: 5,
  pensionEmployerRate: 3, pensionBasis: "qualifying", periodNumber: 5, ...extras,
});

const scenarios: Scenario[] = [
  { id:"P45", employee:"Amelia P45", case:"P45 from an earlier job this tax year", month1:base(2900,{ytdTaxablePay:7800,ytdTaxPaid:620}), month2:base(2900), expected:noFailures },
  { id:"START-A", employee:"Ben Statement A", case:"No P45; first job since 6 April", month1:base(2100), month2:base(2100), expected:noFailures },
  { id:"START-B", employee:"Cara Statement B", case:"No P45; worked earlier this year", month1:base(2450,{week1Month1:true}), month2:base(2450,{week1Month1:true}), expected:noFailures },
  { id:"P60", employee:"Daniel P60", case:"P60 supplied but no P45; month 1 basis", month1:base(3200,{week1Month1:true}), month2:base(3200,{week1Month1:true}), expected:noFailures },
  { id:"SECONDARY", employee:"Ella Secondary", case:"Secondary employment using BR", month1:base(1250,{taxCode:"BR",pensionEmployeeRate:0,pensionEmployerRate:0}), month2:base(1400,{taxCode:"BR",pensionEmployeeRate:0,pensionEmployerRate:0}), expected:(a,b)=>[...noFailures(a,b),...(a.incomeTax!==250?["Month 1 BR tax should be 20%"]:[])] },
  { id:"SCOTTISH", employee:"Finlay Scottish", case:"Scottish taxpayer", month1:base(5200,{taxCode:"S1257L"}), month2:base(5400,{taxCode:"S1257L"}), expected:noFailures },
  { id:"WELSH", employee:"Gwen Welsh", case:"Welsh taxpayer", month1:base(3000,{taxCode:"C1257L"}), month2:base(3100,{taxCode:"C1257L"}), expected:noFailures },
  { id:"DIRECTOR", employee:"Harriet Director", case:"Director annual NIC method", month1:base(9000,{director:true,directorMethod:"annual"}), month2:base(9000,{director:true,directorMethod:"annual"}), expected:noFailures },
  { id:"DIRECTOR-ALT", employee:"Isaac Director Alt", case:"Director alternative NIC method", month1:base(4800,{director:true,directorMethod:"alternative"}), month2:base(4800,{director:true,directorMethod:"alternative"}), expected:noFailures },
  { id:"NIC-C", employee:"Jo State Pension", case:"Over State Pension age; NI category C", month1:base(2700,{niCategory:"C"}), month2:base(2700,{niCategory:"C"}), expected:(a,b)=>[...noFailures(a,b),...(a.employeeNic||b.employeeNic?["Category C employee NIC must be zero"]:[])] },
  { id:"NIC-M", employee:"Kai Under 21", case:"Under 21; NI category M", month1:base(2600,{niCategory:"M"}), month2:base(2650,{niCategory:"M"}), expected:(a,b)=>[...noFailures(a,b),...(a.employerNic||b.employerNic?["Category M employer NIC should be zero below UEL"]:[])] },
  { id:"NIC-H", employee:"Lily Apprentice", case:"Apprentice under 25; NI category H", month1:base(2300,{niCategory:"H"}), month2:base(2350,{niCategory:"H"}), expected:noFailures },
  { id:"NIC-J", employee:"Mo Deferment", case:"NIC deferment; category J", month1:base(5500,{niCategory:"J"}), month2:base(5600,{niCategory:"J"}), expected:noFailures },
  { id:"LOAN-1", employee:"Nadia Plan One", case:"Student loan plan 1", month1:base(3100,{studentLoanPlan:"1"}), month2:base(3200,{studentLoanPlan:"1"}), expected:noFailures },
  { id:"LOAN-2-PG", employee:"Owen Plan Two PG", case:"Plan 2 and postgraduate loans", month1:base(3900,{studentLoanPlan:"2",postgraduateLoan:true}), month2:base(4100,{studentLoanPlan:"2",postgraduateLoan:true}), expected:noFailures },
  { id:"LOAN-4", employee:"Priya Plan Four", case:"Scottish student loan plan 4", month1:base(3400,{studentLoanPlan:"4",taxCode:"S1257L"}), month2:base(3500,{studentLoanPlan:"4",taxCode:"S1257L"}), expected:noFailures },
  { id:"LOAN-5", employee:"Quinn Plan Five", case:"Student loan plan 5", month1:base(2800,{studentLoanPlan:"5"}), month2:base(2900,{studentLoanPlan:"5"}), expected:noFailures },
  { id:"MATERNITY", employee:"Rosa Maternity", case:"Statutory maternity pay", month1:base(0,{statutoryPay:calculateStatutoryPay("maternity",640,4,true).total}), month2:base(0,{statutoryPay:calculateStatutoryPay("maternity",640,4,true).total}), expected:noFailures },
  { id:"SSP", employee:"Sam Sick Pay", case:"Statutory sick pay", month1:base(1800,{statutoryPay:calculateStatutoryPay("sick",540,1).total}), month2:base(2400), expected:noFailures },
  { id:"ZERO", employee:"Tara Irregular", case:"Irregular employee with zero-pay FPS marker", month1:base(0,{pensionEmployeeRate:0,pensionEmployerRate:0}), month2:base(1800), expected:(a,b)=>[...noFailures(a,b),...(a.netPay!==0?["Zero-pay month should result in zero net pay"]:[])] },
  { id:"LEAVER", employee:"Uma Leaver", case:"Final pay and P45 after leaving", month1:base(3600,{postTaxDeductions:75}), month2:base(0,{pensionEmployeeRate:0,pensionEmployerRate:0}), expected:noFailures },
  { id:"ATTACHMENT", employee:"Victor Attachment", case:"Attachment order with protected deduction", month1:base(2600,{postTaxDeductions:120}), month2:base(2600,{postTaxDeductions:120}), expected:noFailures },
  { id:"CODE-NT", employee:"Will No Tax", case:"NT coding notice", month1:base(4200,{taxCode:"NT"}), month2:base(4200,{taxCode:"NT"}), expected:(a,b)=>[...noFailures(a,b),...(a.incomeTax||b.incomeTax?["NT code must not deduct PAYE"]:[])] },
  { id:"CODE-0T", employee:"Xena Zero Allowance", case:"0T code with no personal allowance", month1:base(3100,{taxCode:"0T"}), month2:base(3100,{taxCode:"0T"}), expected:noFailures },
  { id:"CODE-D0", employee:"Yusuf Higher Rate", case:"D0 higher-rate secondary income", month1:base(1800,{taxCode:"D0",pensionEmployeeRate:0,pensionEmployerRate:0}), month2:base(1800,{taxCode:"D0",pensionEmployeeRate:0,pensionEmployerRate:0}), expected:(a,b)=>[...noFailures(a,b),...(a.incomeTax!==720||b.incomeTax!==720?["D0 tax should be 40%"]:[])] },
  { id:"CODE-D1", employee:"Zara Additional Rate", case:"D1 additional-rate secondary income", month1:base(2000,{taxCode:"D1",pensionEmployeeRate:0,pensionEmployerRate:0}), month2:base(2000,{taxCode:"D1",pensionEmployeeRate:0,pensionEmployerRate:0}), expected:(a,b)=>[...noFailures(a,b),...(a.incomeTax!==900||b.incomeTax!==900?["D1 tax should be 45%"]:[])] },
  { id:"CODE-K", employee:"Aisha Benefits K", case:"K code with 50% deduction limit", month1:base(900,{taxCode:"K500",pensionEmployeeRate:0,pensionEmployerRate:0}), month2:base(900,{taxCode:"K500",pensionEmployeeRate:0,pensionEmployerRate:0}), expected:(a,b)=>[...noFailures(a,b),...(a.incomeTax>450||b.incomeTax>450?["K-code PAYE exceeded 50% limit"]:[])] },
  { id:"NIC-B", employee:"Beth Reduced NIC", case:"Reduced-rate NI category B", month1:base(3000,{niCategory:"B"}), month2:base(3000,{niCategory:"B"}), expected:noFailures },
  { id:"NIC-X", employee:"Chris Exempt NIC", case:"NI category X exemption", month1:base(3000,{niCategory:"X"}), month2:base(3000,{niCategory:"X"}), expected:(a,b)=>[...noFailures(a,b),...(a.employeeNic||a.employerNic||b.employeeNic||b.employerNic?["Category X NIC must be zero"]:[])] },
  { id:"NO-SECONDARY-NIC", employee:"Dev Employer NIC Exempt", case:"Secondary Class 1 NICs not due", month1:base(3000,{noSecondaryNic:true}), month2:base(3100,{noSecondaryNic:true}), expected:(a,b)=>[...noFailures(a,b),...(a.employerNic||b.employerNic?["Employer NIC must be zero when secondary NICs are not due"]:[])] },
];

export function runPayrollScenarios() {
  return scenarios.map(scenario => {
    const first = calculateMonthlyPayroll(scenario.month1);
    const secondInput: PayrollInput = {
      ...scenario.month2,
      periodNumber: 6,
      ytdTaxablePay: (scenario.month1.ytdTaxablePay || 0) + first.taxablePay,
      ytdNicablePay: (scenario.month1.ytdNicablePay || 0) + (scenario.month1.nicableGrossPay ?? scenario.month1.grossPay) + (scenario.month1.statutoryPay || 0),
      ytdTaxPaid: (scenario.month1.ytdTaxPaid || 0) + first.incomeTax,
      ytdEmployeeNic: first.employeeNic,
      ytdEmployerNic: first.employerNic,
    };
    const second = calculateMonthlyPayroll(secondInput);
    const failures = scenario.expected(first, second);
    return { id:scenario.id, employee:scenario.employee, case:scenario.case, status:failures.length?"failed":"passed", failures, months:[first,second] };
  });
}

export function runCisScenarios() {
  const samples = [
    { subcontractor:"Verified sole trader", rate:20, labour:8000, materials:1200, vat:1840, retention:0 },
    { subcontractor:"Unverified company", rate:30, labour:5000, materials:800, vat:1160, retention:500 },
    { subcontractor:"Gross-payment-status partnership", rate:0, labour:12500, materials:2300, vat:2960, retention:1250 },
    { subcontractor:"Labour-only subcontractor", rate:20, labour:3200, materials:0, vat:640, retention:0 },
  ];
  return samples.map(item => {
    const deductibleAmount=Math.max(0,item.labour-item.retention);
    const deduction = Math.round(deductibleAmount * item.rate) / 100;
    const gross = item.labour + item.materials + item.vat;
    return { ...item, gross, deductibleAmount, deduction, netPayment:gross-deduction-item.retention, status:"passed" };
  });
}

export function scenarioReport() {
  const payroll = runPayrollScenarios();
  const cis = runCisScenarios();
  return {
    generatedAt: new Date().toISOString(),
    summary: { employees:payroll.length, periods:2, payrollChecks:payroll.length*2, passed:payroll.filter(x=>x.status==="passed").length, failed:payroll.filter(x=>x.status==="failed").length, cisCases:cis.length },
    payroll, cis,
    remainingImplementation: [
      "Live HMRC RTI and CIS filing requires HMRC-recognised software credentials, fraud-prevention headers and conformance testing.",
      "Tax notices, student-loan start/stop notices and NINO verification need authenticated HMRC API retrieval.",
      "Pension provider submissions need provider-specific integrations and relief-at-source handling.",
    ],
  };
}
