import assert from "node:assert/strict";
import test from "node:test";
import { calculateMonthlyPayroll, calculateStatutoryPay, p45OpeningBalances, solveGrossForTargetNet } from "../lib/payroll-engine.ts";
import { payrolledBenefitForPeriod,payrolledBenefitForRange,totalPayrolledBenefitsForPeriod } from "../lib/payrolled-benefits.ts";
import { hasValidFrozenRtiSnapshot,parseFrozenRtiSnapshot } from "../lib/rti-snapshot.ts";
import { countWorkingDays,defaultWorkingWeekdays } from "../lib/working-days.ts";
import { annualLeaveUsed,leaveEntitlementBalance,leaveYearForDate,leaveYearsAcrossRange,proratedLeaveEntitlement } from "../lib/leave-entitlement.ts";
import { applyDeductionAdjustments } from "../lib/payroll-adjustments.ts";
import { employeeActiveInPeriod, employeeActiveInRange, statutoryPayAllocation, statutoryPayAllocationForRange } from "../lib/pay-periods.ts";
import { runCisScenarios, runPayrollScenarios } from "../lib/payroll-scenarios.ts";
import { apprenticeshipLevyByMonth } from "../lib/apprenticeship-levy.ts";
import { attachmentPriority, calculateAttachment } from "../lib/attachment-engine.ts";
import { deriveStatutoryAwe } from "../lib/statutory-awe.ts";
import { monthlyNicEarningsBands, nicEarningsBands } from "../lib/nic-bands.ts";
import { effectiveHourlyRate, minimumWageRate } from "../lib/national-minimum-wage.ts";
import { cumulativeRtiSources } from "../lib/rti-source.ts";
import { assessNeonatalCareClaim } from "../lib/neonatal-care.ts";
import { assessFamilyPayClaim, assessMaternityAdoptionPayClaim } from "../lib/family-pay.ts";
import { assessStatutoryEligibility } from "../lib/statutory-eligibility.ts";
import { assessStatutoryTouchDays } from "../lib/statutory-touch-days.ts";
import { assessStatutoryWorkedWeeks } from "../lib/statutory-work-weeks.ts";
import { automaticStatutoryPayEndDate,automaticStatutoryPayWeeks } from "../lib/statutory-schedule.ts";
import { isRecognisedPayeTaxCode } from "../lib/tax-code.ts";
import { compareHmrcNoticePriority,hmrcNoticeInstructionKey } from "../lib/hmrc-notice-order.ts";
import { calculateCompanyCarBenefit, companyCarAppropriatePercentage } from "../lib/company-car-benefit.ts";
import { calculateCompanyVanBenefit } from "../lib/company-van-benefit.ts";
import { calculateBeneficialLoan } from "../lib/beneficial-loan.ts";
import { cashDenominations,cashMakeup } from "../lib/cash-makeup.ts";
import { allocateEmployeeLoanRecoveries } from "../lib/employee-loans.ts";
import { calculateMileageAllowance } from "../lib/mileage-allowance.ts";
import { calculateChildcareVoucher } from "../lib/childcare-vouchers.ts";
import { applyCashPayRounding } from "../lib/pay-rounding.ts";
import { p45OpeningFromFinalisedSnapshots } from "../lib/p45-opening-evidence.ts";
import { calculateLivingAccommodation } from "../lib/living-accommodation.ts";
import { addCalendarMonths } from "../lib/calendar-months.ts";
import { benefitCategories,classifyBenefit,class1aForBenefit } from "../lib/benefit-classification.ts";
import { cisVerificationDecision } from "../lib/cis-verification.ts";
import { assessPensionAtDate } from "../lib/pension-engine.ts";
import { nextTaxYear,prepareBenefitCopy,shiftDateByTaxYear } from "../lib/benefit-copy.ts";
import { calculateAgentInvoice,validateAgentInvoiceEvidence } from "../lib/agent-billing.ts";
import { assessPayFrequencyChange,frequencyChangeConfirmation } from "../lib/pay-frequency-change.ts";
import { backupKdfIterations,decryptPayrollBackup,encryptPayrollBackup,isEncryptedPayrollBackup } from "../lib/backup-encryption.ts";
import { sampleDepartments,sampleEmployeeProfiles,sampleSubcontractors } from "../lib/sample-payroll.ts";
import { calculateHolidayFundPeriod } from "../lib/holiday-fund.ts";
import { formatUkDate,formatUkDateTime } from "../lib/uk-date.ts";
import { defaultPayslipDesign,normalisePayslipDesign,renderPayslipHtml,validPayslipLogo,validatePayslipDesign } from "../lib/payslip-design.ts";
import { epsTaxMonthWindow,hasEmployeePaymentActivity } from "../lib/eps-no-payment.ts";

test("EPS no-payment evidence recognises an empty period and HMRC tax-month dates",()=>{
  assert.equal(hasEmployeePaymentActivity({}),false);
  assert.equal(hasEmployeePaymentActivity({grossPay:0,netPay:0,payeTax:0}),false);
  assert.deepEqual(epsTaxMonthWindow("2026/27",1),{start:"2026-04-06",end:"2026-05-05",deadline:"2026-05-19"});
  assert.deepEqual(epsTaxMonthWindow("2026/27",10),{start:"2027-01-06",end:"2027-02-05",deadline:"2027-02-19"});
});

test("EPS no-payment evidence rejects all material employee payment activity",()=>{
  for(const evidence of [
    {grossPay:100},{netPay:100},{statutoryPay:20},{payeTax:-15},{employeeNic:5},{employerNic:6},
    {studentLoan:10},{postgraduateLoan:10},{employeePension:12},{employerPension:8},{otherDeductions:5},
  ])assert.equal(hasEmployeePaymentActivity(evidence),true,JSON.stringify(evidence));
});

test("payslip designs validate branding, optional content and UK dates",()=>{
  const design=normalisePayslipDesign({...defaultPayslipDesign,layout:"classic",accentColour:"#6B3FA0",documentTitle:"Salary statement",showYearToDate:false});
  assert.equal(design.layout,"classic");assert.equal(design.accentColour,"#6B3FA0");assert.equal(design.showYearToDate,false);
  assert.match(validatePayslipDesign({...design,accentColour:"red"}),/six-digit hexadecimal/);
  assert.equal(validPayslipLogo("data:image/png;base64,iVBORw0KGgo="),true);
  assert.equal(validPayslipLogo("data:image/svg+xml;base64,PHN2Zz4="),false);
  const html=renderPayslipHtml([{employeeName:"Alex <Morgan>",employeeAddress:"Leeds",payrollId:"PAY-1",niNumber:"QQ123456C",taxCode:"1257L",niCategory:"A",department:"Operations",paymentMethod:"credit-transfer",periodLabel:"Period 4",payDate:"2026-07-31",taxYear:"2026/27",payments:[{label:"Basic salary",amount:3000,quantity:160,rate:18.75}],deductions:[{label:"PAYE tax",amount:400}],grossPay:3000,taxablePay:3000,netPay:2600,employerContributions:{employerNic:410,employerPension:90}}],{employerName:"Example Ltd",logoUrl:"data:image/png;base64,iVBORw0KGgo=",design});
  assert.match(html,/Salary statement/);assert.match(html,/31\/07\/2026/);assert.match(html,/Alex &lt;Morgan&gt;/);
  assert.match(html,/Employer contributions \(not deducted from pay\)/);assert.doesNotMatch(html,/Year to date/);
  assert.match(html,/<img class="logo" src="data:image\/png;base64/);
});

test("UK date presentation keeps ISO storage values out of user-facing output",()=>{
  assert.equal(formatUkDate("2026-07-31"),"31/07/2026");
  assert.equal(formatUkDate("2026-07-31T22:15:00Z"),"31/07/2026");
  assert.equal(formatUkDate(null),"—");
  assert.equal(formatUkDate("2026-02-31","Invalid"),"Invalid");
  assert.match(formatUkDateTime("2026-07-31T18:45:00Z"),/^31\/07\/2026, 19:45$/);
});

test("holiday funds keep employer pay, employee savings and rolled-up pay tax treatments separate",()=>{
  const rolled=calculateHolidayFundPeriod({
    schemeType:"rolled-up",workerType:"irregular-hours",contractConfirmed:true,accrualRate:12.07,
    openingBalance:0,basicAndHourlyPay:1000,totalPay:1000,manualAdded:0,requestedPaid:0,
  });
  assert.equal(rolled.paidAmount,120.7);
  assert.equal(rolled.taxablePay,120.7);
  assert.equal(rolled.nicablePay,120.7);
  assert.equal(rolled.balanceAfter,0);
  assert.equal(rolled.payslipLine,"rolled-up-holiday-pay");
  assert.throws(()=>calculateHolidayFundPeriod({
    schemeType:"rolled-up",workerType:"regular-hours",contractConfirmed:true,accrualRate:12.07,
    openingBalance:0,basicAndHourlyPay:1000,totalPay:1000,manualAdded:0,requestedPaid:0,
  }),/irregular-hours or part-year/);
  assert.throws(()=>calculateHolidayFundPeriod({
    schemeType:"rolled-up",workerType:"part-year",contractConfirmed:true,accrualRate:12.07,
    openingBalance:0,basicAndHourlyPay:0,totalPay:0,manualAdded:0,requestedPaid:0,hasStatutoryAbsence:true,
  }),/52-week average reference pay/);
  assert.equal(calculateHolidayFundPeriod({
    schemeType:"rolled-up",workerType:"part-year",contractConfirmed:true,accrualRate:12.07,
    openingBalance:0,basicAndHourlyPay:0,totalPay:0,manualAdded:0,requestedPaid:0,hasStatutoryAbsence:true,referencePayOverride:600,
  }).paidAmount,72.42);

  const employerFund=calculateHolidayFundPeriod({
    schemeType:"employer-accrual",workerType:"regular-hours",contractConfirmed:false,accrualRate:12.07,
    openingBalance:100,basicAndHourlyPay:1000,totalPay:1000,manualAdded:0,requestedPaid:70,
  });
  assert.equal(employerFund.addedAmount,120.7);
  assert.equal(employerFund.balanceAfter,150.7);
  assert.equal(employerFund.taxablePay,70);
  assert.equal(employerFund.nicablePay,70);

  const savings=calculateHolidayFundPeriod({
    schemeType:"employee-savings",workerType:"regular-hours",contractConfirmed:false,accrualRate:0,
    openingBalance:0,basicAndHourlyPay:1000,totalPay:1000,manualAdded:100,requestedPaid:40,
  });
  assert.equal(savings.balanceAfter,60);
  assert.equal(savings.postTaxDeduction,100);
  assert.equal(savings.taxablePay,0);
  assert.equal(savings.nicablePay,0);
  assert.equal(savings.payslipLine,"non-taxable-savings-withdrawal");
  assert.throws(()=>calculateHolidayFundPeriod({
    schemeType:"employee-savings",workerType:"regular-hours",contractConfirmed:false,accrualRate:0,
    openingBalance:20,basicAndHourlyPay:1000,totalPay:1000,manualAdded:0,requestedPaid:20.01,
  }),/cannot exceed/);
});

test("automatic enrolment assessment uses age on the pay date and reacts to target-net gross changes",()=>{
  const base={dateOfBirth:"1990-08-01",assessmentDate:"2026-07-31",employeeRate:5,employerRate:3};
  assert.equal(assessPensionAtDate({...base,monthlyEarnings:832.99}).action,"offer-opt-in");
  const enrolled=assessPensionAtDate({...base,monthlyEarnings:833});
  assert.equal(enrolled.action,"enrol");
  assert.equal(enrolled.qualifyingEarnings,313);
  assert.equal(enrolled.employeeContribution,15.65);
  assert.equal(assessPensionAtDate({...base,dateOfBirth:"2004-08-01",monthlyEarnings:1200}).action,"offer-opt-in");
  assert.equal(assessPensionAtDate({...base,dateOfBirth:"2004-07-31",monthlyEarnings:1200}).action,"enrol");
});

test("isolated sample payroll covers starter, regional, director, loan, portal and CIS variations",()=>{
  const employees=sampleEmployeeProfiles(),ids=new Set(employees.map(employee=>employee.payrollId));
  assert.equal(employees.length,20);
  assert.equal(ids.size,20);
  assert.ok(employees.some(employee=>employee.starterEvidence==="P45 provided"&&employee.p45PreviousPay>0&&employee.p45LeavingDate<=employee.startDate));
  assert.ok(employees.some(employee=>employee.p60ReferenceOnly&&employee.week1Month1));
  assert.ok(employees.some(employee=>employee.taxCode==="BR"&&employee.starterEvidence==="Secondary employment"&&employee.starterDeclaration==="Statement C – another job or pension"));
  assert.ok(employees.some(employee=>employee.taxCode.startsWith("S")));
  assert.ok(employees.some(employee=>employee.taxCode.startsWith("C")));
  assert.ok(employees.some(employee=>employee.director&&!employee.alternativeDirectorNic));
  assert.ok(employees.some(employee=>employee.director&&employee.alternativeDirectorNic));
  assert.deepEqual(new Set(employees.map(employee=>employee.studentLoanPlan).filter(Boolean)),new Set(["1","2","4","5"]));
  assert.ok(employees.some(employee=>employee.postgraduateLoan));
  assert.ok(employees.some(employee=>employee.irregularPayment));
  assert.ok(employees.some(employee=>employee.paymentToBody));
  assert.ok(employees.some(employee=>employee.confidential&&employee.employeePortal&&employee.portalCanEditBank));
  assert.ok(employees.every(employee=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)));
  assert.ok(employees.every(employee=>["M","F"].includes(employee.gender)));
  assert.equal(sampleDepartments.length,5);
  assert.deepEqual(sampleSubcontractors.map(item=>item.deductionRate).sort((a,b)=>a-b),[0,20,30]);
  assert.ok(sampleSubcontractors.every(item=>item.name.startsWith("Demo ")));
  assert.ok(sampleSubcontractors.every(item=>item.status===(item.deductionRate===0?"gross-payment-status":"verified")));
});

test("payroll backups support authenticated password encryption without storing the password",async()=>{
  const backup={schemaVersion:6,employerId:45,employerName:"Construction QA",dataset:{employees:[{id:1}]},checksum:{algorithm:"SHA-256",value:"a".repeat(64)}};
  const password="Correct horse battery staple 45";
  const encrypted=await encryptPayrollBackup(backup,password);
  assert.equal(isEncryptedPayrollBackup(encrypted),true);
  assert.equal(encrypted.employerId,45);
  assert.equal(encrypted.kdf.iterations,backupKdfIterations);
  assert.equal(JSON.stringify(encrypted).includes(password),false);
  assert.deepEqual(await decryptPayrollBackup(encrypted,password,45),backup);
  await assert.rejects(()=>decryptPayrollBackup(encrypted,"Wrong password for this file",45),/could not be opened/);
  await assert.rejects(()=>decryptPayrollBackup(encrypted,password,44),/another employer/);
  const tampered={...encrypted,ciphertext:`A${encrypted.ciphertext.slice(1)}`};
  await assert.rejects(()=>decryptPayrollBackup(tampered,password,45),/could not be opened/);
});
import { validateCisFilingResult } from "../lib/cis-filing-result.ts";
import { validateRtiFilingResult } from "../lib/rti-filing-result.ts";
import { validateCisPaymentEvidence } from "../lib/cis-payment-evidence.ts";
import { validateCisImportRows } from "../lib/cis-import.ts";
import { validatePayDetailsImportRows } from "../lib/pay-details-import.ts";
import { validateEmployerImportRows } from "../lib/employer-import.ts";
import { annualPayPeriodDivisor, cumulativeTaxFraction, periodDateSequence, rtiPeriodNumberForPayDate, rtiTaxWeekNumber, scheduledPayPeriods, taxMonthForDate, taxWeekForDate, validatePayrollPeriod } from "../lib/pay-frequency.ts";
import { validateStatutoryEventEvidence } from "../lib/statutory-event-evidence.ts";
import { validateStatutoryNoticeEvidence } from "../lib/statutory-notice-evidence.ts";
import { validateHmrcPaymentEvidence } from "../lib/hmrc-payment-evidence.ts";
import { validatePayrollAdjustmentEvidence } from "../lib/payroll-adjustment-evidence.ts";
import { validateAttachmentDeductionEvidence,validateAttachmentOrderEvidence } from "../lib/attachment-evidence.ts";
import { validateBenefitEvidence } from "../lib/benefit-evidence.ts";
import { validateRecurringOccurrenceEvidence,validateRecurringPayEvidence } from "../lib/recurring-pay-evidence.ts";
import { validateEmployeeChangeEvidence } from "../lib/employee-change-evidence.ts";
import { validateHmrcNoticeEvidence } from "../lib/hmrc-notice-evidence.ts";
import { pensionRunMatchesSnapshot,validatePayItemEvidence,validatePayRunAccountingEvidence } from "../lib/pay-run-evidence.ts";
import { validatePensionMembershipEventEvidence,validatePensionMembershipEvidence,validatePensionSchemeEvidence } from "../lib/pension-state-evidence.ts";
import { validatePensionDeclarationEvidence } from "../lib/pension-declaration-evidence.ts";
import { validateEmployeeStateEvidence } from "../lib/employee-state-evidence.ts";
import { validateEmployerSettingsEvidence,validateEmployerStateEvidence,validateSubcontractorStateEvidence } from "../lib/employer-cis-state-evidence.ts";

const money = value => Math.round(value * 100) / 100;
const payroll = extras => calculateMonthlyPayroll({
  grossPay:3000, taxCode:"1257L", niCategory:"A",
  pensionEmployeeRate:0, pensionEmployerRate:0, periodNumber:1, ...extras,
});

test("late P45 opening balances come from the latest finalised payroll evidence",()=>{
  const snapshots=[
    {starterEvidence:"No P45 provided",p45PreviousPay:0,p45PreviousTax:0},
    {starterEvidence:"P45 provided",p45PreviousPay:5500,p45PreviousTax:720},
    {starterEvidence:"P45 provided",p45PreviousPay:5600,p45PreviousTax:740},
  ];
  assert.deepEqual(p45OpeningFromFinalisedSnapshots(snapshots,{previousPay:9999,previousTax:999}),{
    previousPay:5600,previousTax:740,source:"finalised-payroll",
  });
  assert.deepEqual(p45OpeningFromFinalisedSnapshots([],{previousPay:1250,previousTax:90}),{
    previousPay:1250,previousTax:90,source:"employee-fallback",
  });
  assert.deepEqual(p45OpeningFromFinalisedSnapshots([
    {p45PreviousPay:"not-a-number",p45PreviousTax:-10},
  ],{previousPay:1250,previousTax:90}),{
    previousPay:0,previousTax:0,source:"finalised-payroll",
  });
});

test("target net solver uses the payroll engine and resolves to the nearest penny",()=>{
  const result=solveGrossForTargetNet({
    taxCode:"1257L",niCategory:"A",periodNumber:5,studentLoanPlan:"2",
    pensionEmployeeRate:5,pensionEmployerRate:3,pensionBasis:"qualifying",pensionTaxRelief:"relief-at-source",
  },2500);
  assert.ok(result.requiredGrossPay>2500);
  assert.ok(Math.abs(result.difference)<=0.01);
  assert.equal(calculateMonthlyPayroll({
    grossPay:result.requiredGrossPay,taxCode:"1257L",niCategory:"A",periodNumber:5,studentLoanPlan:"2",
    pensionEmployeeRate:5,pensionEmployerRate:3,pensionBasis:"qualifying",pensionTaxRelief:"relief-at-source",
  }).netPay,result.achievedNetPay);
});

test("cash pay rounding rounds down and carries the exact unpaid balance",()=>{
  assert.deepEqual(applyCashPayRounding({netPay:123.47,openingCarry:0,unit:1}),{
    netPay:123.47,openingCarry:0,unit:1,exactDue:123.47,roundedNet:123,closingCarry:.47,adjustment:-.47,
  });
  assert.deepEqual(applyCashPayRounding({netPay:123.75,openingCarry:1.25,unit:5}),{
    netPay:123.75,openingCarry:1.25,unit:5,exactDue:125,roundedNet:125,closingCarry:0,adjustment:1.25,
  });
  assert.deepEqual(applyCashPayRounding({netPay:4,openingCarry:0,unit:10}),{
    netPay:4,openingCarry:0,unit:10,exactDue:4,roundedNet:0,closingCarry:4,adjustment:-4,
  });
  assert.throws(()=>applyCashPayRounding({netPay:100,openingCarry:0,unit:2}),/£1, £5 or £10/);
});

test("target net solver validates its target and supports deductions",()=>{
  assert.throws(()=>solveGrossForTargetNet({taxCode:"1257L"},-1),/non-negative/);
  const result=solveGrossForTargetNet({taxCode:"BR",niCategory:"A",postTaxDeductions:250},1000);
  assert.ok(result.requiredGrossPay>1250);
  assert.ok(Math.abs(result.difference)<=0.01);
});

test("cash makeup reconciles finalised penny amounts to UK denominations",()=>{
  const result=cashMakeup(128.87);
  assert.equal(result.counts.length,cashDenominations.length);
  assert.equal(result.counts.reduce((sum,count,index)=>sum+count*cashDenominations[index].pence,0),12887);
  assert.deepEqual(result.counts.slice(0,6),[2,1,0,1,1,1]);
  assert.throws(()=>cashMakeup(-0.01),/non-negative/);
});

test("employee loan recoveries are ordered, balance-capped and net-pay-capped",()=>{
  const result=allocateEmployeeLoanRecoveries([
    {id:2,balance:200,regularDeduction:100},{id:1,balance:40,regularDeduction:75},{id:3,balance:500,regularDeduction:200},
  ],175);
  assert.deepEqual(result.map(item=>({id:item.loan.id,amount:item.amount,balanceAfter:item.balanceAfter})),[
    {id:1,amount:40,balanceAfter:0},{id:2,amount:100,balanceAfter:100},{id:3,amount:35,balanceAfter:465},
  ]);
  assert.deepEqual(allocateEmployeeLoanRecoveries([{id:1,balance:100,regularDeduction:50}],0),[]);
});

test("2026/27 mileage allowance separates tax and NIC excess across 10,000 miles",()=>{
  const crossing=calculateMileageAllowance({vehicle:"car-van",miles:2000,ytdMiles:9000,paidRate:.60,taxYear:"2026/27"});
  assert.deepEqual(crossing,{vehicle:"car-van",miles:2000,ytdMilesBefore:9000,ytdMilesAfter:11000,paidRate:.6,paid:1200,taxApproved:800,nicApproved:1100,exempt:800,taxOnlyExcess:300,taxAndNicExcess:100,mileageReliefShortfall:0});
  const motorcycle=calculateMileageAllowance({vehicle:"motorcycle",miles:100,ytdMiles:0,paidRate:.20,taxYear:"2026/27"});
  assert.equal(motorcycle.exempt,20);assert.equal(motorcycle.mileageReliefShortfall,4);
  assert.throws(()=>calculateMileageAllowance({vehicle:"car-van",miles:1,ytdMiles:0,paidRate:.55,taxYear:"2027/28"}),/only for 2026\/27/);
});

test("legacy childcare vouchers apply monthly, weekly and multi-week exemption limits",()=>{
  assert.deepEqual(calculateChildcareVoucher({amount:300,taxBand:"basic",eligibleLegacyMember:true,payFrequency:"monthly"}),{
    amount:300,taxBand:"basic",payFrequency:"monthly",exemptLimit:243,exempt:243,class1Excess:57,
  });
  assert.equal(calculateChildcareVoucher({amount:124,taxBand:"higher",eligibleLegacyMember:true,payFrequency:"monthly"}).class1Excess,0);
  assert.equal(calculateChildcareVoucher({amount:200,taxBand:"additional",eligibleLegacyMember:true,payFrequency:"monthly"}).class1Excess,90);
  assert.equal(calculateChildcareVoucher({amount:70,taxBand:"basic",eligibleLegacyMember:true,payFrequency:"weekly"}).class1Excess,15);
  assert.equal(calculateChildcareVoucher({amount:70,taxBand:"higher",eligibleLegacyMember:true,payFrequency:"fortnightly"}).class1Excess,14);
  assert.equal(calculateChildcareVoucher({amount:125,taxBand:"additional",eligibleLegacyMember:true,payFrequency:"four-weekly"}).class1Excess,25);
  assert.throws(()=>calculateChildcareVoucher({amount:243,taxBand:"basic",eligibleLegacyMember:false,payFrequency:"monthly"}),/closed to new applicants/);
});

test("restored statutory events reconcile dates, work evidence, pay and HMRC recovery",()=>{
  const maternity={
    startDate:"2026-06-01",endDate:"2026-06-14",status:"calculated",subtype:"maternity",
    qualifyingDays:14,qualifyingDaysPerWeek:7,qualifyingWeekdays:"1,2,3,4,5,6,7",
    averageWeeklyEarnings:500,averageWeeklyEarningsSource:"manual",relevantPeriodStart:null,relevantPeriodEnd:null,relevantPayTotal:0,
    statutoryAmount:900,recoveredAmount:828,statutoryPaidDayOffset:0,statutoryPayPeriodStart:"2026-06-01",
    statutoryTouchDays:JSON.stringify([{date:"2026-06-03",kind:"kit"}]),statutoryWorkedWeeks:null,
    familyEventReference:"BABY-1",familyEventDate:"2026-06-01",familyEventKind:"birth",
  };
  assert.equal(validateStatutoryEventEvidence(maternity,false),null);
  assert.equal(validateStatutoryEventEvidence({...maternity,statutoryAmount:901},false),"Leave event statutory pay or HMRC recovery does not reconcile.");
  assert.equal(validateStatutoryEventEvidence({...maternity,recoveredAmount:980},true),"Leave event statutory pay or HMRC recovery does not reconcile.");
  assert.match(validateStatutoryEventEvidence({...maternity,statutoryTouchDays:"not-json"},false),/malformed/);
  assert.match(validateStatutoryEventEvidence({...maternity,familyEventReference:""},false),/family-event/);

  const sick={...maternity,subtype:"sick",startDate:"2026-06-01",endDate:"2026-06-14",
    qualifyingDays:10,qualifyingDaysPerWeek:5,qualifyingWeekdays:"1,2,3,4,5",
    averageWeeklyEarnings:400,statutoryAmount:246.5,recoveredAmount:0,statutoryPayPeriodStart:null,
    statutoryTouchDays:null,familyEventReference:null,familyEventDate:null,familyEventKind:null};
  assert.equal(validateStatutoryEventEvidence(sick,false),null);

  const neonatalCalculation=calculateStatutoryPay("neonatal",300,1,false,{payableDays:7,qualifyingDaysPerWeek:7});
  const neonatal={...maternity,subtype:"neonatal",startDate:"2026-07-01",endDate:"2026-07-07",
    qualifyingDays:7,averageWeeklyEarnings:300,statutoryAmount:neonatalCalculation.total,recoveredAmount:neonatalCalculation.recoverable,
    statutoryPayPeriodStart:null,statutoryTouchDays:null,familyEventReference:null,familyEventDate:null,familyEventKind:null,
    childBirthDate:"2026-06-01",neonatalCareStartDate:"2026-06-01",neonatalCareEndDate:"2026-06-14",
    neonatalTier:"tier-1",relationshipDeclaration:true,caringResponsibilityDeclaration:true};
  assert.equal(validateStatutoryEventEvidence(neonatal,false),null);
  assert.match(validateStatutoryEventEvidence({...neonatal,relationshipDeclaration:false},false),/eligibility evidence/);
});

test("non-statutory restored leave cannot inject payroll or recovery values",()=>{
  const annual={startDate:"2026-08-03",endDate:"2026-08-07",status:"calculated",subtype:"none",
    qualifyingDays:5,qualifyingDaysPerWeek:5,qualifyingWeekdays:"1,2,3,4,5",
    averageWeeklyEarnings:0,averageWeeklyEarningsSource:"manual",relevantPeriodStart:null,relevantPeriodEnd:null,relevantPayTotal:0,
    statutoryAmount:0,recoveredAmount:0,statutoryPaidDayOffset:0,statutoryPayPeriodStart:null,
    statutoryTouchDays:null,statutoryWorkedWeeks:null};
  assert.equal(validateStatutoryEventEvidence(annual,false),null);
  assert.match(validateStatutoryEventEvidence({...annual,recoveredAmount:100},false),/statutory payment evidence|does not reconcile/);
  assert.match(validateStatutoryEventEvidence({...annual,endDate:"2026-08-02"},false),/date range/);
  assert.match(validateStatutoryEventEvidence({...annual,qualifyingWeekdays:"1,1,2,3,4"},false),/weekday/);
});

test("restored statutory non-payment notices match immutable employee evidence",()=>{
  const snapshot={schemaVersion:"payflow-statutory-notice-1",
    employee:{payrollId:"EMP-1",firstName:"Alex",lastName:"Taylor"},
    employer:{name:"Example Ltd"},formType:"SMP1",statutoryType:"maternity",
    decisionDate:"2026-06-01",payStartDate:"2026-06-10",payEndDate:"2026-09-01",
    reasonCode:"continuity",reason:"Insufficient service",averageWeeklyEarnings:500,
    continuousEmploymentWeeks:12,evidenceReceived:true,noticeReceived:true,issuedAt:"2026-06-01"};
  const row={...snapshot,status:"issued",employeeSnapshot:JSON.stringify(snapshot),payloadChecksum:"a".repeat(64),issuedAt:"2026-06-01",
    cancellationReason:null};
  assert.equal(validateStatutoryNoticeEvidence(row,"a".repeat(64)),null);
  assert.match(validateStatutoryNoticeEvidence({...row,reason:"Changed"},"a".repeat(64)),/no longer matches/);
  assert.match(validateStatutoryNoticeEvidence(row,"b".repeat(64)),/corrupted/);
  assert.match(validateStatutoryNoticeEvidence({...row,status:"cancelled",cancellationReason:""},"a".repeat(64)),/lifecycle/);
});

test("restored HMRC payments preserve valid amounts, methods and void evidence",()=>{
  const payment={taxYear:"2026/27",taxMonth:2,paymentDate:"2026-06-20",kind:"payment",category:"paye-payment",method:"bank-transfer",
    amount:1250.55,reference:"123PA00012345",notes:null,status:"recorded",voidedAt:null,voidReason:null};
  assert.equal(validateHmrcPaymentEvidence(payment,"2026-06-21T10:00:00.000Z"),null);
  assert.equal(validateHmrcPaymentEvidence({...payment,kind:"credit",category:"tax-refund-funding",method:"journal"}),null);
  assert.match(validateHmrcPaymentEvidence({...payment,kind:"credit",category:"class1a-adjustment",method:"journal"}),/category/);
  assert.match(validateHmrcPaymentEvidence({...payment,amount:-1}),/amount/);
  assert.match(validateHmrcPaymentEvidence({...payment,paymentDate:"2026-06-22"},"2026-06-21T10:00:00.000Z"),/future-dated/);
  assert.match(validateHmrcPaymentEvidence({...payment,status:"recorded",voidReason:"wrong"}),/contradictory/);
  assert.equal(validateHmrcPaymentEvidence({...payment,status:"void",voidedAt:"2026-06-21T10:00:00.000Z",voidReason:"Duplicate payment"}),null);
  assert.match(validateHmrcPaymentEvidence({...payment,status:"void",voidedAt:null,voidReason:"bad"}),/correction evidence/);
});

test("restored payroll adjustments preserve period locks and reversal evidence",()=>{
  const adjustment={type:"paye-tax",amount:-25.5,reason:"Correct tax notice",status:"active",createdBy:"owner@example.test",reversedAt:null};
  assert.equal(validatePayrollAdjustmentEvidence(adjustment,"open",false),null);
  assert.match(validatePayrollAdjustmentEvidence({...adjustment,type:"gross-pay"},"open",false),/finalised-payroll/);
  assert.match(validatePayrollAdjustmentEvidence(adjustment,"finalised",false),/accepted FPS/);
  assert.equal(validatePayrollAdjustmentEvidence(adjustment,"finalised",true),null);
  assert.match(validatePayrollAdjustmentEvidence({...adjustment,status:"reversed"},"finalised",true),/reversal timestamp/);
  assert.equal(validatePayrollAdjustmentEvidence({...adjustment,status:"reversed",reversedAt:"2026-06-21T10:00:00.000Z"},"finalised",true),null);
  assert.match(validatePayrollAdjustmentEvidence({...adjustment,amount:0},"open",false),/amount/);
});

test("restored attachment orders and deductions reconcile to statutory calculations",()=>{
  const order={type:"Direct Earnings Attachment",issuingAuthority:"DWP",reference:"DEA-123",effectiveDate:"2026-04-06",
    calculationRule:"dea-standard",payFrequency:"monthly",deductionType:"percentage",deductionValue:0,
    protectedEarnings:0,priority:30,arrears:0,adminFee:1,balance:940,status:"active"};
  assert.equal(validateAttachmentOrderEvidence(order),null);
  const calculation=calculateAttachment({netPay:2000,type:order.type,deductionType:"percentage",deductionValue:0,
    calculationRule:"dea-standard",payFrequency:"monthly",protectedEarnings:0,balance:1000,adminFee:1,arrears:0});
  const row={deduction:calculation.deduction,adminFee:calculation.adminFee,balanceAfter:calculation.balanceAfter,rate:calculation.rate,
    attachableNetPay:2000,protectedEarningsApplied:calculation.protectedEarnings,shortfall:calculation.shortfall,
    arrearsBefore:0,arrearsAfter:calculation.arrearsAfter};
  assert.equal(validateAttachmentDeductionEvidence(order,row,0),null);
  assert.match(validateAttachmentDeductionEvidence(order,{...row,deduction:row.deduction+1},0),/does not reconcile/);
  assert.equal(validateAttachmentOrderEvidence({...order,payFrequency:"weekly"}),null);
  assert.equal(validateAttachmentOrderEvidence({...order,payFrequency:"fortnightly",calculationRule:"scottish-earnings-arrestment"}),null);
  assert.match(validateAttachmentOrderEvidence({...order,effectiveDate:"2026-02-30"}),/legal/);
});

test("restored benefit evidence reconciles P11D classification, lifecycle and tax calculations",()=>{
  const medical={taxYear:"2026/27",category:"Private medical insurance",p11dSection:"I",nicTreatment:"class-1a",
    providedDate:null,description:"Annual medical cover",cashEquivalent:1000,class1aNic:150,payrolled:true,
    status:"reviewed",voidedAt:null,voidReason:null};
  assert.equal(validateBenefitEvidence(medical),null);
  assert.match(validateBenefitEvidence({...medical,p11dSection:"F"}),/classification/);
  assert.match(validateBenefitEvidence({...medical,class1aNic:149.99}),/does not reconcile/);
  assert.match(validateBenefitEvidence({...medical,status:"voided",voidedAt:null,voidReason:"bad"}),/correction evidence/);
  const calculation=calculateCompanyCarBenefit({taxYear:"2026/27",co2Emissions:0,zeroEmissionMileage:0,
    listPrice:40000,capitalContributions:0,privateUseContribution:0,availableFrom:"2026-04-06",availableTo:null,fuelType:"Electric"});
  const car={...medical,category:"Company car",p11dSection:"F",description:"Electric company car",
    cashEquivalent:calculation.cashEquivalent,class1aNic:calculation.class1aNic,benefitEvent:"provided",
    vehicleRegistration:"EV26 ABC",availableFrom:"2026-04-06",availableTo:null,fuelType:"Electric",
    co2Emissions:0,zeroEmissionMileage:0,listPrice:40000,capitalContributions:0,privateUseContribution:0};
  assert.equal(validateBenefitEvidence(car),null);
  assert.match(validateBenefitEvidence({...car,cashEquivalent:car.cashEquivalent+100}),/does not reconcile/);
});

test("restored recurring schedules and occurrences preserve future-payroll evidence",()=>{
  const schedule={taxYear:"2026/27",type:"earning",name:"Monthly allowance",amount:125,taxable:true,nicable:true,pensionable:false,startPeriod:2,endPeriod:8,status:"active"};
  const occurrence={type:"earning",name:"Monthly allowance",amount:125,quantity:1,rate:125,taxable:true,nicable:true,pensionable:false};
  assert.equal(validateRecurringPayEvidence(schedule),null);
  assert.equal(validateRecurringOccurrenceEvidence(schedule,occurrence,{taxYear:"2026/27",periodNumber:5}),null);
  assert.match(validateRecurringPayEvidence({...schedule,taxYear:"2026/99"}),/classification/);
  assert.match(validateRecurringPayEvidence({...schedule,endPeriod:1}),/period range/);
  assert.match(validateRecurringOccurrenceEvidence(schedule,{...occurrence,amount:126},{taxYear:"2026/27",periodNumber:5}),/no longer matches/);
  assert.match(validateRecurringOccurrenceEvidence(schedule,occurrence,{taxYear:"2026/27",periodNumber:9}),/outside/);
  assert.equal(validateRecurringPayEvidence({...schedule,status:"stopped",endPeriod:0}),null);
});

test("restored portal change requests preserve field and reviewer evidence",()=>{
  const pending={requestType:"bank",proposedChanges:JSON.stringify({sortCode:"112233",accountNumber:"12345678"}),
    previousValues:JSON.stringify({sortCode:"445566",accountNumber:"87654321"}),status:"pending",
    employeeNote:null,reviewNote:null,reviewedBy:null,reviewedAt:null,createdAt:"2026-06-01T10:00:00.000Z"};
  assert.equal(validateEmployeeChangeEvidence(pending),null);
  assert.match(validateEmployeeChangeEvidence({...pending,proposedChanges:JSON.stringify({taxCode:"BR"})}),/field evidence/);
  assert.match(validateEmployeeChangeEvidence({...pending,proposedChanges:JSON.stringify({sortCode:"123",accountNumber:"12345678"})}),/employee values/);
  assert.match(validateEmployeeChangeEvidence({...pending,reviewedAt:"2026-06-02T10:00:00.000Z"}),/contradictory/);
  assert.equal(validateEmployeeChangeEvidence({...pending,status:"approved",reviewedBy:4,reviewedAt:"2026-06-02T10:00:00.000Z"}),null);
  assert.match(validateEmployeeChangeEvidence({...pending,status:"approved",reviewedBy:null,reviewedAt:null}),/reviewer evidence/);
});

test("restored HMRC notices preserve instruction and lifecycle evidence",()=>{
  const coding={employeeId:1,type:"coding",noticeIdentifier:"P6-123",taxYear:"2026/27",issuedDate:"2026-06-01",
    effectiveDate:"2026-06-06",taxCode:"S1257L",week1Month1:false,loanAction:null,studentLoanPlan:null,
    postgraduateLoan:false,niNumber:null,message:null,source:"hmrc",payload:JSON.stringify({notice:"P6"}),
    status:"new",appliedAt:null,ignoredAt:null};
  assert.equal(validateHmrcNoticeEvidence(coding,"2026-06-02T10:00:00.000Z"),null);
  assert.match(validateHmrcNoticeEvidence({...coding,issuedDate:"2026-06-03"},"2026-06-02T10:00:00.000Z"),/future-issued/);
  assert.match(validateHmrcNoticeEvidence({...coding,effectiveDate:"2027-04-06"}),/outside/);
  assert.match(validateHmrcNoticeEvidence({...coding,loanAction:"start"}),/contradictory/);
  assert.equal(validateHmrcNoticeEvidence({...coding,status:"applied",appliedAt:"2026-06-02T10:00:00.000Z"}),null);
  assert.match(validateHmrcNoticeEvidence({...coding,status:"applied",appliedAt:null}),/application evidence/);
  const loan={...coding,type:"student-loan",taxCode:null,loanAction:"start",studentLoanPlan:"2",noticeIdentifier:"SL1-1"};
  assert.equal(validateHmrcNoticeEvidence(loan),null);
  assert.match(validateHmrcNoticeEvidence({...loan,loanAction:"stop-all",studentLoanPlan:"2"}),/contradictory/);
});

test("restored pay items and pay runs preserve accounting bounds",()=>{
  const earning={type:"earning",name:"Salary",quantity:1,rate:3000,amount:3000,taxable:true,nicable:true,pensionable:true};
  const postTax={type:"post-tax-deduction",name:"Union fee",quantity:1,rate:50,amount:50,taxable:false,nicable:false,pensionable:false};
  const run={grossPay:3000,taxablePay:3000,nicablePay:3000,payeTax:400,employeeNic:100,employerNic:350,
    studentLoan:0,postgraduateLoan:0,pensionablePay:2480,employeePension:100,employerPension:75,
    statutoryPay:0,otherDeductions:50,netPay:2350,pensionSchemeId:4};
  assert.equal(validatePayItemEvidence(earning),null);
  assert.equal(validatePayRunAccountingEvidence(run,[earning,postTax]),null);
  assert.match(validatePayItemEvidence({...earning,type:"unsupported"}),/invalid type/);
  assert.match(validatePayRunAccountingEvidence({...run,netPay:2400},[earning,postTax]),/does not reconcile/);
  assert.match(validatePayRunAccountingEvidence({...run,otherDeductions:40,netPay:2360},[earning,postTax]),/post-tax/);
  assert.equal(validatePayRunAccountingEvidence({...run,netPay:2400},[earning,postTax],50),null);
  assert.equal(validatePayRunAccountingEvidence({...run,payeTax:-160.35,netPay:2910.35},[earning,postTax]),null);
  assert.equal(pensionRunMatchesSnapshot(run,{schemaVersion:"payflow-pension-evidence-2",schemeId:4,employeeDeduction:100}),true);
  assert.equal(pensionRunMatchesSnapshot(run,{schemaVersion:"payflow-pension-evidence-2",schemeId:4,employeeDeduction:99}),false);
});

test("restored pension schemes, memberships and events preserve lifecycle evidence",()=>{
  const scheme={provider:"NEST",schemeName:"Workplace pension",employeeRate:5,employerRate:3,earningsBasis:"qualifying",
    taxRelief:"relief-at-source",automaticEnrolmentScheme:true,contributionDueDay:22,status:"active",
    certificationDate:null,dutiesStartDate:"2026-04-06",nextReenrolmentDate:"2029-04-06",
    declarationDueDate:"2026-09-06",declarationStatus:"not-filed"};
  assert.equal(validatePensionSchemeEvidence(scheme),null);
  assert.match(validatePensionSchemeEvidence({...scheme,employerRate:2}),/minimum contribution/);
  assert.match(validatePensionSchemeEvidence({...scheme,contributionDueDay:31}),/provider or contribution/);
  const active={assessmentStatus:"eligible-jobholder",membershipStatus:"active",enrolmentDate:"2026-05-31",
    postponementEnd:null,postponementNoticeDate:null,optOutDate:null,enrolmentInformationDate:"2026-05-31",
    optOutNoticeDate:null,optOutNoticeValid:false,ceasedDate:null,lastReenrolmentDate:null,employeeRefundDue:0,
    employerRefundDue:0,communicationDueDate:"2026-07-12",lastCommunicationDate:null};
  assert.equal(validatePensionMembershipEvidence(active),null);
  assert.match(validatePensionMembershipEvidence({...active,enrolmentDate:null}),/enrolment date/);
  const opted={...active,membershipStatus:"opted-out",optOutDate:"2026-06-20",optOutNoticeDate:"2026-06-20",optOutNoticeValid:true};
  assert.equal(validatePensionMembershipEvidence(opted),null);
  assert.match(validatePensionMembershipEvidence({...opted,optOutNoticeValid:false}),/provider notice/);
  const event={eventType:"opt-out",effectiveDate:"2026-06-20",previousStatus:"active",newStatus:"opted-out",
    details:JSON.stringify({refund:{employeeRefundDue:50}}),createdBy:"owner@example.test"};
  assert.equal(validatePensionMembershipEventEvidence(event),null);
  assert.match(validatePensionMembershipEventEvidence({...event,details:"bad-json"}),/malformed/);
});

test("restored filed pension declarations retain external acknowledgement evidence",()=>{
  const scheme={id:4,provider:"NEST",schemeName:"Workplace pension",declarationDueDate:"2026-09-06"};
  const payload={schemaVersion:"payflow-pension-declaration-1",schemeId:4,provider:"NEST",schemeName:"Workplace pension",
    declarationDueDate:"2026-09-06",declarationDate:"2026-08-31",reference:"TPR-ACK-42",externalFiling:true,
    recordedAt:"2026-08-31T10:00:00.000Z",recordedBy:"Owner"};
  const checksum="a".repeat(64),row={type:"PENSION-DECLARATION",status:"recorded",payloadChecksum:checksum,
    dueDate:"2026-09-06",submittedAt:"2026-08-31"};
  assert.equal(validatePensionDeclarationEvidence(row,payload,checksum,scheme),null);
  assert.match(validatePensionDeclarationEvidence(row,{...payload,schemeId:5},checksum,scheme),/another scheme/);
  assert.match(validatePensionDeclarationEvidence({...row,submittedAt:"2026-09-01"},payload,checksum,scheme),/does not match/);
  assert.match(validatePensionDeclarationEvidence(row,payload,"b".repeat(64),scheme),/checksum/);
});

test("restored employees preserve starter, director, payment and portal evidence",()=>{
  const employee={payrollId:"EMP-001",firstName:"Ava",lastName:"Worker",reportedPayFrequency:"monthly",payBasis:"period",
    paymentMethod:"credit-transfer",status:"active",starterEvidence:"P45 provided",starterDeclaration:"Statement A – first job since 6 April",
    taxCode:"1257L",week1Month1:false,niCategory:"A",studentLoanPlan:null,dateOfBirth:"1990-05-01",startDate:"2026-05-01",
    leavingDate:null,p45LeavingDate:"2026-04-20",director:false,directorStart:null,directorEnd:null,alternativeDirectorNic:false,
    apprenticeshipStartDate:null,annualSalary:36000,hourlyRate:0,dailyRate:0,contractedHours:37.5,annualLeaveDays:28,
    workingDaysPerWeek:5,p45PreviousPay:1500,p45PreviousTax:120,p60ReferenceOnly:false,p60TaxYear:null,
    accountName:"Ava Worker",sortCode:"12-34-56",accountNumber:"12345678",employeePortal:true,portalCanEditBank:true};
  assert.equal(validateEmployeeStateEvidence(employee,"2026/27"),null);
  for(const reportedPayFrequency of ["weekly","fortnightly","four-weekly"])
    assert.equal(validateEmployeeStateEvidence({...employee,reportedPayFrequency},"2026/27"),null);
  assert.match(validateEmployeeStateEvidence({...employee,starterEvidence:"Secondary employment"},"2026/27"),/opening balances/);
  assert.match(validateEmployeeStateEvidence({...employee,starterDeclaration:"Statement A"},"2026/27"),/supported onboarding choice/);
  assert.match(validateEmployeeStateEvidence({...employee,director:true,directorStart:null},"2026/27"),/directorship/);
  assert.match(validateEmployeeStateEvidence({...employee,accountNumber:"123"},"2026/27"),/bank/);
  assert.match(validateEmployeeStateEvidence({...employee,employeePortal:false},"2026/27"),/portal/);
});

test("restored employer defaults and CIS subcontractors retain bounded evidence",()=>{
  const employer={name:"Build Ltd",payFrequency:"monthly",taxYear:"2026/27",status:"active",payeReference:"123/AB45",
    accountsOfficeReference:"123PA12345678",companyNumber:"12345678",cisContractor:true,cisUtr:"1234567890",apprenticeshipLevyAllowance:15000};
  assert.equal(validateEmployerStateEvidence(employer),null);
  assert.match(validateEmployerStateEvidence({...employer,cisUtr:"bad"}),/identifiers/);
  const settings={typicalPayBasis:"hourly",clientStatus:"active",documentPasswordStrategy:"employee-postcode",
    colourReference:"#087b79",typicalAnnualLeaveDays:28,typicalWeeklyHours:37.5,minimumHourlyRate:12.71,nextWorksNumber:2,
    finalFpsDue:"2027-04-19",epsDue:null,p60Due:null,p11dDue:null,primaryContactEmail:"payroll@example.test",alternateContactEmail:null,
    bankName:"Example Bank",bankAccountName:"Build Ltd",bankSortCode:"123456",bankAccountNumber:"12345678",employerNotes:"Payroll control account"};
  assert.equal(validateEmployerSettingsEvidence(settings),null);
  assert.match(validateEmployerSettingsEvidence({...settings,nextWorksNumber:0}),/bounds/);
  assert.match(validateEmployerSettingsEvidence({...settings,bankAccountNumber:"123"}),/bank/);
  assert.match(validateEmployerSettingsEvidence({...settings,employerNotes:"x".repeat(4001)}),/notes/);
  const subcontractor={name:"Alex Builder",type:"sole-trader",utr:"1234567890",deductionRate:20,status:"verified",
    verificationNumber:"V123",verificationMethod:"manual-or-test",verifiedAt:"2026-05-01T10:00:00Z",niNumber:"QQ123456C"};
  assert.equal(validateSubcontractorStateEvidence(subcontractor),null);
  assert.match(validateSubcontractorStateEvidence({...subcontractor,niNumber:null}),/type-specific/);
  assert.match(validateSubcontractorStateEvidence({...subcontractor,status:"gross-payment-status"}),/contradicts/);
});

test("CIS verification decisions cover first, continuing, stale, unmatched, gross and corrected evidence",()=>{
  const current=(rate=20)=>({status:rate===0?"gross-payment-status":"verified",deductionRate:rate,verificationNumber:`V-${rate}`,verificationMethod:"manual-or-test",verifiedAt:"2026-04-10T09:00:00.000Z"});
  const first=cisVerificationDecision("2026/27","2026-05-05",current(20),[]);
  assert.equal(first.valid,true);
  assert.equal(first.required,true);
  assert.equal(first.evidence.deductionRate,20);

  const historic={taxYear:"2025/26",paymentDate:"2026-03-05",deductionRate:30,verificationNumber:"V-30",verificationMethod:"hmrc-result",verifiedAt:"2025-04-10T09:00:00.000Z",status:"calculated"};
  const continuing=cisVerificationDecision("2027/28","2027-05-05",{status:"unverified",deductionRate:30,verificationNumber:null,verificationMethod:null,verifiedAt:null},[historic]);
  assert.equal(continuing.valid,true);
  assert.equal(continuing.required,false);
  assert.equal(continuing.evidence.deductionRate,30);

  const stale=cisVerificationDecision("2028/29","2028-05-05",{status:"unverified",deductionRate:30,verificationNumber:null,verificationMethod:null,verifiedAt:null},[historic]);
  assert.equal(stale.valid,false);
  assert.equal(stale.required,true);

  const gross=cisVerificationDecision("2026/27","2026-05-05",current(0),[]);
  assert.equal(gross.evidence.deductionRate,0);
  const unmatched=cisVerificationDecision("2026/27","2026-05-05",current(30),[]);
  assert.equal(unmatched.evidence.verificationNumber,"V-30");

  const changed=cisVerificationDecision("2026/27","2026-06-05",{...current(0),verifiedAt:"2026-05-20T09:00:00.000Z"},[historic]);
  assert.equal(changed.reason,"newer-verification-result");
  assert.equal(changed.evidence.deductionRate,0);
  const noFutureLeak=cisVerificationDecision("2026/27","2026-05-05",{status:"unverified",deductionRate:30,verificationNumber:null,verificationMethod:null,verifiedAt:null},[{...historic,taxYear:"2026/27",paymentDate:"2026-06-05"}]);
  assert.equal(noFutureLeak.valid,false);
});

test("CIS payment evidence reconciles frozen identity, dates and deduction arithmetic",()=>{
  const payment={
    taxYear:"2026/27",taxMonth:1,paymentDate:"2026-04-30",status:"calculated",
    labour:1000,materials:200,vat:40,retention:100,deductionRate:20,deduction:180,netPayment:960,
    subcontractorName:"Alex Builder",subcontractorType:"sole-trader",subcontractorUtr:"1234567890",
    subcontractorNiNumber:"QQ123456C",verificationNumber:"V-20",replacesPaymentId:null,voidReason:null,
  };
  assert.equal(validateCisPaymentEvidence(payment),null);
  assert.equal(validateCisPaymentEvidence({...payment,deduction:179.99}),"CIS payment deduction or net amount does not reconcile.");
  assert.equal(validateCisPaymentEvidence({...payment,paymentDate:"2026-05-06"}),"CIS payment date is outside its recorded tax month.");
  assert.equal(validateCisPaymentEvidence({...payment,subcontractorNiNumber:null}),"CIS sole-trader payment is missing a valid frozen National Insurance number.");
  assert.equal(validateCisPaymentEvidence({...payment,verificationNumber:null}),"Deducted CIS payment is missing frozen verification evidence.");
  assert.equal(validateCisPaymentEvidence({...payment,status:"voided",voidReason:""}),"Voided CIS payment is missing its correction reason.");
});

test("CIS gross, company and partnership evidence uses the correct frozen identifiers",()=>{
  const base={taxYear:"2026/27",taxMonth:12,paymentDate:"2027-04-05",status:"calculated",labour:500,materials:0,vat:0,retention:0,deductionRate:0,deduction:0,netPayment:500,subcontractorName:"Trade",subcontractorUtr:"1234567890",replacesPaymentId:null};
  assert.equal(validateCisPaymentEvidence({...base,subcontractorType:"company",subcontractorCompanyNumber:"AB123456"}),null);
  assert.equal(validateCisPaymentEvidence({...base,subcontractorType:"partnership",subcontractorPartnerUtr:"0987654321"}),null);
  assert.match(validateCisPaymentEvidence({...base,subcontractorType:"company",subcontractorCompanyNumber:"bad"}),/company number/);
});

test("CIS subcontractor import validates every legal form and rejects the whole invalid file",()=>{
  const valid=validateCisImportRows([
    {name:"Alex Builder",type:"sole-trader",utr:"1000000001",niNumber:"AB123456C"},
    {name:"Scaffold Ltd",type:"company",utr:"1000000002",companyNumber:"SC123456",deductionRate:"20",verificationNumber:"V-20-001",verificationDate:"2020-07-01"},
    {name:"Roofing Partnership",type:"partnership",utr:"1000000003",partnerUtr:"2000000003",deductionRate:"0",verificationNumber:"V-GROSS-001",verificationDate:"2020-07-01"},
  ]);
  assert.deepEqual(valid.errors,[]);
  assert.equal(valid.values.length,3);
  assert.equal(valid.values[0].status,"unverified");
  assert.equal(valid.values[1].status,"verified");
  assert.equal(valid.values[2].status,"gross-payment-status");
  assert.equal(valid.values[1].verificationMethod,"imported-evidence");
  assert.match(valid.values[1].verificationResponse,/liveVerificationPerformed/);

  const invalid=validateCisImportRows([
    {name:"Bad company",type:"company",utr:"1000000001",companyNumber:"123",deductionRate:"20"},
    {name:"Duplicate UTR",type:"sole-trader",utr:"1000000001",niNumber:"QQ123456A"},
  ]);
  assert.equal(invalid.values.length,2);
  assert.match(invalid.errors.join(" "),/company registration number/);
  assert.match(invalid.errors.join(" "),/requires imported verification evidence/);
  assert.match(invalid.errors.join(" "),/duplicates row 2/);
  assert.match(invalid.errors.join(" "),/National Insurance number/);
  assert.match(validateCisImportRows(Array.from({length:501},()=>({}))).errors[0],/limited to 500/);
});

test("pay-detail import is period-bound, employee-bound and validates all item semantics",()=>{
  const valid=validatePayDetailsImportRows([
    {period:"5",payrollId:"PAY-1",type:"monthly-salary",description:"Monthly salary",quantity:"",rate:"",amount:"3000",taxable:"true",nicable:"true",pensionable:"true"},
    {period:"5",payrollId:"PAY-1",type:"additional-hours",description:"Additional hours",quantity:"8",rate:"15",amount:"",taxable:"true",nicable:"true",pensionable:"true"},
    {period:"5",payrollId:"PAY-1",type:"earning",description:"Bonus",quantity:"2",rate:"125",amount:"",taxable:"yes",nicable:"yes",pensionable:"yes"},
    {period:"5",payrollId:"PAY-2",type:"post-tax-deduction",description:"Staff purchase",quantity:"",rate:"",amount:"40",taxable:"false",nicable:"false",pensionable:"false"},
  ],5,["PAY-1","PAY-2"]);
  assert.deepEqual(valid.errors,[]);
  assert.equal(valid.prepared.length,4);
  assert.equal(valid.prepared[1].amount,120);
  assert.equal(valid.prepared[2].amount,250);
  assert.equal(valid.prepared[3].taxable,false);
  const weeklyVoucher=validatePayDetailsImportRows([
    {period:"5",payrollId:"PAY-1",type:"childcare-voucher",description:"Legacy childcare voucher salary sacrifice · basic",amount:"55",taxable:"false",nicable:"false",pensionable:"true"},
  ],5,["PAY-1"],52,"weekly");
  assert.deepEqual(weeklyVoucher.errors,[]);
  const unsafeVoucher=validatePayDetailsImportRows([
    {period:"5",payrollId:"PAY-1",type:"childcare-voucher",description:"Childcare",amount:"70",taxable:"false",nicable:"false",pensionable:"true"},
  ],5,["PAY-1"],52,"weekly");
  assert.match(unsafeVoucher.errors.join(" "),/must be "Legacy childcare voucher/);

  const invalid=validatePayDetailsImportRows([
    {period:"4",payrollId:"PAY-1",type:"monthly-salary",amount:"3000"},
    {period:"5",payrollId:"PAY-1",type:"monthly-salary",amount:"3100"},
    {period:"5",payrollId:"UNKNOWN",type:"earning",description:"Bonus",amount:"100",taxable:"maybe",nicable:"true",pensionable:"true"},
    {period:"5",payrollId:"PAY-2",type:"benefit",description:"Car",amount:"100",taxable:"true",nicable:"false",pensionable:"false"},
  ],5,["PAY-1","PAY-2"]);
  const message=invalid.errors.join(" ");
  assert.match(message,/does not match the open payroll period 5/);
  assert.match(message,/monthly-salary duplicates row 2/);
  assert.match(message,/payroll ID UNKNOWN was not found/);
  assert.match(message,/taxable, nicable and pensionable/);
  assert.match(message,/pay type is not supported/);
});

test("CIS external filing results are guarded and require rejection evidence",()=>{
  const base={currentStatus:"test-ready",outcome:"accepted",submittedAt:"2026-07-20T10:00:00.000Z",acknowledgementReference:"HMRC-CIS-123",now:Date.parse("2026-07-21T00:00:00.000Z")};
  assert.equal(validateCisFilingResult(base).valid,true);
  assert.equal(validateCisFilingResult({...base,currentStatus:"accepted"}).valid,false);
  assert.equal(validateCisFilingResult({...base,outcome:"rejected",responseMessage:""}).valid,false);
  assert.equal(validateCisFilingResult({...base,outcome:"rejected",responseMessage:"Authentication failed"}).valid,true);
  assert.equal(validateCisFilingResult({...base,submittedAt:"2026-07-22T00:00:00.000Z"}).valid,false);
  assert.equal(validateCisFilingResult({...base,acknowledgementReference:"123"}).valid,false);
});

test("RTI external filing results require terminal evidence and cannot be replayed",()=>{
  const base={currentStatus:"test-ready",outcome:"accepted",submittedAt:"2026-07-20T10:00:00.000Z",acknowledgementReference:"HMRC-RTI-123",now:Date.parse("2026-07-21T00:00:00.000Z")};
  assert.equal(validateRtiFilingResult(base).valid,true);
  assert.equal(validateRtiFilingResult({...base,currentStatus:"accepted"}).valid,false);
  assert.equal(validateRtiFilingResult({...base,currentStatus:"rejected"}).valid,false);
  assert.equal(validateRtiFilingResult({...base,outcome:"rejected",responseMessage:""}).valid,false);
  assert.equal(validateRtiFilingResult({...base,outcome:"rejected",responseMessage:"7802 schema failure"}).valid,true);
  assert.equal(validateRtiFilingResult({...base,submittedAt:"not-a-date"}).valid,false);
});

test("P11D sections and benefit NIC treatments are explicit",()=>{
  assert.equal(benefitCategories.length,14);
  assert.deepEqual(classifyBenefit("Vouchers and credit cards"),{section:"C",defaultNicTreatment:"class-1",label:"Vouchers and credit cards"});
  assert.equal(classifyBenefit("Company car").section,"F");
  assert.equal(classifyBenefit("Private medical insurance").section,"I");
  assert.equal(classifyBenefit("Business expenses and allowances").section,"N");
  assert.equal(class1aForBenefit(1200,"class-1a"),180);
  assert.equal(class1aForBenefit(1200,"class-1"),0);
  assert.equal(class1aForBenefit(1200,"exempt"),0);
});

test("Class 1 benefits enter NIC-able pay once in the provision tax month",()=>{
  const source={cashEquivalent:120,providedDate:"2026-07-20"};
  assert.equal(payrolledBenefitForPeriod(source,3,"2026/27"),0);
  assert.equal(payrolledBenefitForPeriod(source,4,"2026/27"),120);
  assert.equal(payrolledBenefitForPeriod(source,5,"2026/27"),0);
  assert.equal(Array.from({length:12},(_,index)=>payrolledBenefitForPeriod(source,index+1,"2026/27")).reduce((sum,value)=>sum+value,0),120);
});

test("2026 company-car benefits apply HMRC emission bands and diesel supplement",()=>{
  assert.equal(companyCarAppropriatePercentage({taxYear:"2026/27",co2Emissions:0,zeroEmissionMileage:0,fuelType:"Electric"}),4);
  assert.equal(companyCarAppropriatePercentage({taxYear:"2026/27",co2Emissions:45,zeroEmissionMileage:75,fuelType:"Hybrid"}),7);
  assert.equal(companyCarAppropriatePercentage({taxYear:"2026/27",co2Emissions:120,zeroEmissionMileage:0,fuelType:"Diesel (RDE2)"}),30);
  assert.equal(companyCarAppropriatePercentage({taxYear:"2026/27",co2Emissions:120,zeroEmissionMileage:0,fuelType:"Diesel (not RDE2)"}),34);
  assert.equal(companyCarAppropriatePercentage({taxYear:"2026/27",co2Emissions:159,zeroEmissionMileage:0,fuelType:"Petrol"}),37);
});

test("company-car cash equivalent caps capital contributions and prorates availability",()=>{
  assert.deepEqual(calculateCompanyCarBenefit({
    taxYear:"2026/27",co2Emissions:0,listPrice:40000,availableFrom:"2026-04-06",fuelType:"Electric",
  }),{
    percentage:4,taxYearDays:365,availableDays:365,allowableCapitalContribution:0,priceForTax:40000,
    fullYearBenefit:1600,availabilityAdjustedBenefit:1600,cashEquivalent:1600,class1aNic:240,
  });
  const partial=calculateCompanyCarBenefit({
    taxYear:"2026/27",co2Emissions:45,zeroEmissionMileage:75,listPrice:30000,capitalContributions:9000,
    privateUseContribution:100,availableFrom:"2026-04-06",availableTo:"2026-10-05",fuelType:"Hybrid",
  });
  assert.equal(partial.allowableCapitalContribution,5000);
  assert.equal(partial.availableDays,183);
  assert.equal(partial.cashEquivalent,777.4);
  assert.equal(partial.class1aNic,116.61);
});

test("2026 company-van and private-fuel charges apply statutory exemptions",()=>{
  const taxable=calculateCompanyVanBenefit({taxYear:"2026/27",availableFrom:"2026-04-06",useType:"taxable-private-use",zeroEmission:false,privateFuelProvided:true});
  assert.equal(taxable.vanCharge,4170);
  assert.equal(taxable.fuelCharge,798);
  assert.equal(taxable.cashEquivalent,4968);
  assert.equal(taxable.class1aNic,745.2);
  const electric=calculateCompanyVanBenefit({taxYear:"2026/27",availableFrom:"2026-04-06",useType:"taxable-private-use",zeroEmission:true,privateFuelProvided:true});
  assert.equal(electric.cashEquivalent,0);
  assert.equal(electric.exempt,true);
  const restricted=calculateCompanyVanBenefit({taxYear:"2026/27",availableFrom:"2026-04-06",useType:"restricted-private-use",zeroEmission:false});
  assert.equal(restricted.vanCharge,0);
});

test("company-van charges prorate availability, sharing and private-use payments",()=>{
  const result=calculateCompanyVanBenefit({
    taxYear:"2026/27",availableFrom:"2026-04-06",availableTo:"2026-10-05",useType:"taxable-private-use",
    zeroEmission:false,sharedEmployees:2,privateUseContribution:100,privateFuelProvided:true,privateFuelRepaid:true,
  });
  assert.equal(result.availableDays,183);
  assert.equal(result.sharedEmployees,2);
  assert.equal(result.vanCharge,945.36);
  assert.equal(result.fuelCharge,0);
  assert.equal(result.cashEquivalent,945.36);
});

test("beneficial loans apply the official rate, interest paid and small-loan exemption",()=>{
  const taxable=calculateBeneficialLoan({taxYear:"2026/27",openingBalance:20000,closingBalance:10000,maximumAggregateBalance:20000,wholeMonthsOutstanding:12,interestPaid:100});
  assert.equal(taxable.officialRate,3.75);
  assert.equal(taxable.averageBalance,15000);
  assert.equal(taxable.officialInterest,562.5);
  assert.equal(taxable.cashEquivalent,462.5);
  assert.equal(taxable.class1aNic,69.38);
  const exempt=calculateBeneficialLoan({taxYear:"2026/27",openingBalance:9000,closingBalance:5000,maximumAggregateBalance:10000,wholeMonthsOutstanding:12,interestPaid:0});
  assert.equal(exempt.smallLoanExempt,true);
  assert.equal(exempt.cashEquivalent,0);
});

test("beneficial-loan optional remuneration cannot understate the taxable value",()=>{
  const result=calculateBeneficialLoan({taxYear:"2026/27",openingBalance:20000,closingBalance:10000,maximumAggregateBalance:20000,wholeMonthsOutstanding:6,interestPaid:100,salaryForegone:1000});
  assert.equal(result.normalBenefit,181.25);
  assert.equal(result.opraBenefit,900);
  assert.equal(result.cashEquivalent,900);
});

test("living accommodation uses the greater annual value or provider rent",()=>{
  const result=calculateLivingAccommodation({taxYear:"2026/27",annualValue:3000,providerRent:5000,propertyCost:70000,improvements:0,employeeCapitalContribution:0,employeeRent:1000,availableDays:365,sharedEmployees:1});
  assert.equal(result.standardCharge,5000);
  assert.equal(result.additionalCharge,0);
  assert.equal(result.cashEquivalent,4000);
  assert.equal(result.class1aNic,600);
});

test("expensive accommodation applies the £75,000 excess charge and contributions",()=>{
  const result=calculateLivingAccommodation({taxYear:"2026/27",annualValue:1000,providerRent:0,propertyCost:175000,improvements:10000,employeeCapitalContribution:10000,employeeRent:1250,availableDays:365,sharedEmployees:1});
  assert.equal(result.accommodationCost,175000);
  assert.equal(result.standardCharge,1000);
  assert.equal(result.additionalCharge,3750);
  assert.equal(result.cashEquivalent,3500);
});

test("accommodation prorates availability and protects optional remuneration",()=>{
  const result=calculateLivingAccommodation({taxYear:"2026/27",annualValue:4000,providerRent:0,propertyCost:75000,improvements:0,employeeCapitalContribution:0,employeeRent:1000,availableDays:183,sharedEmployees:2,salaryForegone:2500});
  assert.equal(result.grossCharge,1002.74);
  assert.equal(result.normalBenefit,2.74);
  assert.equal(result.cashEquivalent,2500);
});

test("2026 minimum-wage rates follow age and first-year apprentice status",()=>{
  assert.deepEqual(minimumWageRate({dateOfBirth:"2000-01-01",referenceDate:"2026-09-30"}),{rate:12.71,category:"Aged 21 and over",age:26});
  assert.deepEqual(minimumWageRate({dateOfBirth:"2007-10-01",referenceDate:"2026-09-30"}),{rate:10.85,category:"Aged 18 to 20",age:18});
  assert.deepEqual(minimumWageRate({dateOfBirth:"2009-01-01",referenceDate:"2026-09-30"}),{rate:8,category:"Aged 16 to 17",age:17});
  assert.deepEqual(minimumWageRate({dateOfBirth:"2000-01-01",referenceDate:"2026-09-30",minimumWageCategory:"apprentice",apprenticeshipStartDate:"2026-04-01"}),{rate:8,category:"Apprentice",age:26});
  assert.deepEqual(minimumWageRate({dateOfBirth:"2000-01-01",referenceDate:"2026-09-30",minimumWageCategory:"apprentice",apprenticeshipStartDate:"2025-04-01"}),{rate:12.71,category:"Aged 21 and over",age:26});
  assert.equal(minimumWageRate({referenceDate:"2026-09-30",minimumWageCategory:"apprentice"}).rate,12.71);
  assert.equal(effectiveHourlyRate({payBasis:"period",annualSalary:26000,contractedHours:40,hourlyRate:1}),12.5);
  assert.equal(effectiveHourlyRate({payBasis:"hourly",annualSalary:26000,contractedHours:40,hourlyRate:10.85}),10.85);
  assert.equal(effectiveHourlyRate({payBasis:"daily",annualSalary:0,contractedHours:37.5,hourlyRate:0,dailyRate:100,workingDaysPerWeek:5}),13.33);
});

test("Apprenticeship Levy uses the cumulative monthly allowance method", () => {
  const schedule=apprenticeshipLevyByMonth(Array(12).fill(300_000),true,15_000);
  assert.equal(schedule[0].currentDue,250);
  assert.equal(schedule[0].cumulativeDue,250);
  assert.equal(schedule[11].currentDue,250);
  assert.equal(schedule[11].cumulativeDue,3000);
  assert.equal(schedule[11].cumulativePayBill,3_600_000);
});

test("Apprenticeship Levy supports connected-employer allowance allocations and opt-out", () => {
  const shared=apprenticeshipLevyByMonth([100_000,100_000],true,6000);
  assert.equal(shared[0].currentDue,0);
  assert.equal(shared[1].currentDue,0);
  const noAllowance=apprenticeshipLevyByMonth([100_000,100_000],true,0);
  assert.deepEqual(noAllowance.map(row=>row.currentDue),[500,500]);
  assert.equal(apprenticeshipLevyByMonth([1_000_000],false,0)[0].currentDue,0);
});

test("regional flat-rate PAYE codes use the correct 2026/27 rates", () => {
  for (const [taxCode,rate] of Object.entries({
    SBR:.20, SD0:.21, SD1:.42, SD2:.45, SD3:.48, CBR:.20, CD0:.40, CD1:.45,
  })) {
    assert.equal(payroll({taxCode}).incomeTax, money(3000*rate), taxCode);
  }
});

test("HMRC tax-code validation accepts regional K and 0T codes but rejects regional NT",()=>{
  for(const code of ["1257L","S1257L","C1257L","K475","SK1000","CK1000","0T","S0T","C0T","BR","SBR","CBR","D0","D1","SD0","SD1","SD2","SD3","CD0","CD1","NT","1257L M1"])
    assert.equal(isRecognisedPayeTaxCode(code),true,code);
  for(const code of ["SNT","CNT","D2","D3","CD2","SD4","1257A","K","S",""])
    assert.equal(isRecognisedPayeTaxCode(code),false,code);
});

test("week 1/month 1 suffixes make a code non-cumulative", () => {
  assert.equal(payroll({taxCode:"1257L W1",periodNumber:6,ytdTaxablePay:50000,ytdTaxPaid:0}).incomeTax, 390.35);
});

test("cumulative PAYE produces a bounded refund", () => {
  const result=payroll({grossPay:1000,periodNumber:6,ytdTaxablePay:5000,ytdTaxPaid:500});
  assert.equal(result.incomeTax,-500);
  assert.equal(result.netPay,1500);
});

test("P45 opening pay and tax reconcile through two cumulative pay periods",()=>{
  const p45={taxablePay:8000,taxPaid:1200};
  const monthOne=payroll({grossPay:2500,periodNumber:1,ytdTaxablePay:p45.taxablePay,ytdTaxPaid:p45.taxPaid});
  const monthTwo=payroll({
    grossPay:2500,periodNumber:2,
    ytdTaxablePay:p45.taxablePay+monthOne.taxablePay,
    ytdTaxPaid:p45.taxPaid+monthOne.incomeTax,
  });
  const directMonthTwo=payroll({grossPay:2500,periodNumber:2,ytdTaxablePay:10500,ytdTaxPaid:monthOne.incomeTax+1200});
  assert.equal(monthTwo.incomeTax,directMonthTwo.incomeTax);
  assert.equal(money(p45.taxablePay+monthOne.taxablePay+monthTwo.taxablePay),13000);
});

test("irregular payments after leaving use weekly NIC and loan thresholds",()=>{
  const result=payroll({grossPay:1000,taxCode:"0T",week1Month1:true,earningsPeriod:"weekly",studentLoanPlan:"1",postgraduateLoan:true});
  assert.equal(result.employeeNic,58.66);
  assert.equal(result.employerNic,135.6);
  assert.equal(result.studentLoan,43);
  assert.equal(result.postgraduateLoan,35);
});

test("late P45 opening balances start only after the employee's first finalised payroll",()=>{
  assert.deepEqual(p45OpeningBalances({previousPay:5500,previousTax:720,receivedAfterFirstPayroll:true,priorFinalisedRuns:0}),{taxablePay:0,taxPaid:0,applied:false});
  assert.deepEqual(p45OpeningBalances({previousPay:5500,previousTax:720,receivedAfterFirstPayroll:true,priorFinalisedRuns:1}),{taxablePay:5500,taxPaid:720,applied:true});
  assert.deepEqual(p45OpeningBalances({previousPay:5500,previousTax:720,receivedAfterFirstPayroll:false,priorFinalisedRuns:0}),{taxablePay:5500,taxPaid:720,applied:true});
  const first=payroll({grossPay:2500,periodNumber:1,...p45OpeningBalances({previousPay:5500,previousTax:720,receivedAfterFirstPayroll:true,priorFinalisedRuns:0}),ytdTaxPaid:0});
  const secondOpening=p45OpeningBalances({previousPay:5500,previousTax:720,receivedAfterFirstPayroll:true,priorFinalisedRuns:1});
  const second=payroll({grossPay:2500,periodNumber:2,ytdTaxablePay:secondOpening.taxablePay+first.taxablePay,ytdTaxPaid:secondOpening.taxPaid+first.incomeTax});
  const direct=payroll({grossPay:2500,periodNumber:2,ytdTaxablePay:8000,ytdTaxPaid:720+first.incomeTax});
  assert.equal(second.incomeTax,direct.incomeTax);
});

test("all NI categories use their 2026/27 employee rate and employer threshold", () => {
  const expected = {
    A:[156.16,387.45], B:[36.11,387.45], C:[0,387.45],
    D:[39.04,137.55], E:[36.11,137.55], F:[156.16,137.55],
    H:[156.16,0], I:[36.11,137.55], J:[39.04,387.45],
    K:[0,137.55], L:[39.04,137.55], M:[156.16,0],
    N:[156.16,137.55], S:[0,137.55], V:[156.16,0], Z:[39.04,0],
    X:[0,0],
  };
  for (const [niCategory,[employeeNic,employerNic]] of Object.entries(expected)) {
    const result=payroll({niCategory});
    assert.equal(result.employeeNic,employeeNic,`${niCategory} employee`);
    assert.equal(result.employerNic,employerNic,`${niCategory} employer`);
  }
});

test("P11 and FPS NIC earnings bands reconcile to monthly NIC-able pay",()=>{
  assert.deepEqual(monthlyNicEarningsBands(558.99),{earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0});
  assert.deepEqual(monthlyNicEarningsBands(559),{earningsAtLel:559,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0});
  assert.deepEqual(monthlyNicEarningsBands(800),{earningsAtLel:559,earningsLelToPt:241,earningsPtToUel:0,earningsAboveUel:0});
  assert.deepEqual(monthlyNicEarningsBands(5200),{earningsAtLel:559,earningsLelToPt:489,earningsPtToUel:3141,earningsAboveUel:1011});
});

test("P11 and FPS NIC earnings bands use weekly limits for irregular post-leaving pay",()=>{
  assert.deepEqual(nicEarningsBands(128.99,"weekly"),{earningsAtLel:0,earningsLelToPt:0,earningsPtToUel:0,earningsAboveUel:0});
  assert.deepEqual(nicEarningsBands(500,"weekly"),{earningsAtLel:129,earningsLelToPt:113,earningsPtToUel:258,earningsAboveUel:0});
  assert.deepEqual(nicEarningsBands(1000,"weekly"),{earningsAtLel:129,earningsLelToPt:113,earningsPtToUel:725,earningsAboveUel:33});
});

test("RTI source evidence follows cumulative payroll and relevant EPS statutory records",()=>{
  const periods=[
    {id:11,periodNumber:1,periodEnd:"2026-05-05"},
    {id:12,periodNumber:2,periodEnd:"2026-06-05"},
    {id:13,periodNumber:3,periodEnd:"2026-07-05"},
  ];
  const runs=[{id:1,payPeriodId:11},{id:2,payPeriodId:12},{id:3,payPeriodId:13}];
  const events=[
    {id:1,employeeId:101,startDate:"2026-05-10"},
    {id:2,employeeId:202,startDate:"2026-05-10"},
    {id:3,employeeId:101,startDate:"2026-06-10"},
  ];
  const fps=cumulativeRtiSources("FPS",periods[1],periods,runs,events,new Set([101]));
  assert.deepEqual(fps.periods.map(item=>item.id),[11,12]);
  assert.deepEqual(fps.runs.map(item=>item.id),[1,2]);
  assert.deepEqual(fps.statutorySources,[]);
  const eps=cumulativeRtiSources("EPS",periods[1],periods,runs,events,new Set([101]));
  assert.deepEqual(eps.periods.map(item=>item.id),[11,12]);
  assert.deepEqual(eps.runs.map(item=>item.id),[1,2]);
  assert.deepEqual(eps.statutorySources.map(item=>item.id),[1]);
});

test("director annual NIC uses NIC-able rather than taxable year-to-date pay", () => {
  const result=payroll({
    grossPay:1000, taxableGrossPay:0, nicableGrossPay:1000, director:true,
    directorMethod:"annual", ytdTaxablePay:0, ytdNicablePay:13000,
  });
  assert.equal(result.employeeNic,114.4);
});

test("alternative director method reconciles in the final director period", () => {
  const result=payroll({
    grossPay:5000, director:true, directorMethod:"alternative",
    finalDirectorPeriod:true, ytdNicablePay:48000, ytdEmployeeNic:3000,
    ytdEmployerNic:6450,
  });
  assert.equal(result.employeeNic,70.6);
  assert.equal(result.employerNic,750);
});

test("mid-year director earnings period prorates annual thresholds by weeks", () => {
  const result=payroll({
    grossPay:6000, director:true, directorMethod:"annual",
    directorEarningsPeriodWeeks:13,
  });
  assert.equal(result.employeeNic,228.6);
  assert.equal(result.employerNic,712.5);
});

test("pre-tax deductions reduce taxable pay and take-home pay exactly once",()=>{
  const without=payroll({grossPay:3000,taxableGrossPay:3000});
  const withDeduction=payroll({grossPay:3000,taxableGrossPay:3000,preTaxDeductions:200,taxablePreTaxDeductions:200});
  assert.equal(withDeduction.taxablePay,without.taxablePay-200);
  assert.equal(withDeduction.netPay,without.netPay-160);
});

test("salary sacrifice becomes employer pension while Payroll Giving preserves NIC pay",()=>{
  const sacrifice=payroll({grossPay:2800,taxableGrossPay:2800,nicableGrossPay:2800,pensionableGrossPay:3000,employerPensionAdditional:200,pensionEmployeeRate:0,pensionEmployerRate:0,taxCode:"NT"});
  assert.equal(sacrifice.grossPay,2800);
  assert.equal(sacrifice.taxablePay,2800);
  assert.equal(sacrifice.employerPension,200);
  assert.equal(sacrifice.employerCost,money(2800+sacrifice.employerNic+200));
  const ordinary=payroll({grossPay:3000,taxCode:"BR",pensionEmployeeRate:0,pensionEmployerRate:0});
  const giving=payroll({grossPay:3000,taxableGrossPay:3000,nicableGrossPay:3000,preTaxDeductions:200,taxablePreTaxDeductions:200,taxCode:"BR",pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(giving.taxablePay,2800);
  assert.equal(giving.employeeNic,ordinary.employeeNic);
  assert.equal(money(ordinary.netPay-giving.netPay),160);
});

test("relief-at-source deducts the net member amount while preserving the gross contribution",()=>{
  const reliefAtSource=payroll({grossPay:3000,taxCode:"NT",pensionableGrossPay:3000,pensionBasis:"gross",pensionEmployeeRate:5,pensionEmployerRate:3,pensionTaxRelief:"relief-at-source"});
  assert.equal(reliefAtSource.employeePensionGross,150);
  assert.equal(reliefAtSource.employeePensionTaxRelief,30);
  assert.equal(reliefAtSource.employeePension,120);
  assert.equal(reliefAtSource.taxablePay,3000);
  assert.equal(reliefAtSource.netPay,2723.84);
  const netPay=payroll({grossPay:3000,taxCode:"BR",pensionableGrossPay:3000,pensionBasis:"gross",pensionEmployeeRate:5,pensionEmployerRate:3,pensionTaxRelief:"net-pay"});
  assert.equal(netPay.employeePensionGross,150);
  assert.equal(netPay.employeePensionTaxRelief,0);
  assert.equal(netPay.employeePension,150);
  assert.equal(netPay.taxablePay,2850);
  assert.equal(netPay.netPay,2123.84);
});

test("HMRC notices have deterministic precedence and semantic duplicate identity",()=>{
  const base={id:1,type:"coding",employeeId:7,taxYear:"2026/27",issuedDate:"2026-06-10",effectiveDate:"2026-06-30",taxCode:"1257L",week1Month1:false};
  assert.equal(compareHmrcNoticePriority({...base,id:2},{...base,id:1}),1);
  assert.equal(compareHmrcNoticePriority({...base,id:2,effectiveDate:"2026-07-31"},{...base,id:9}),1);
  assert.equal(compareHmrcNoticePriority({...base,id:9,issuedDate:"2026-06-09"},{...base,id:1}),-1);
  assert.equal(compareHmrcNoticePriority({...base,id:2,issuedDate:"2026-06-11",effectiveDate:"2026-06-01"},{...base,id:99,issuedDate:"2026-06-10",effectiveDate:"2026-07-31"}),1);
  assert.equal(hmrcNoticeInstructionKey({...base,id:1}),hmrcNoticeInstructionKey({...base,id:99}));
  assert.equal(hmrcNoticeInstructionKey({...base,id:1,message:"first import"}),hmrcNoticeInstructionKey({...base,id:99,message:"duplicate download"}));
  assert.notEqual(hmrcNoticeInstructionKey({...base,id:1}),hmrcNoticeInstructionKey({...base,id:99,taxCode:"BR"}));
});

test("audited deduction corrections change net pay and employer cost exactly once",()=>{
  const original=payroll({grossPay:3000});
  const corrected=applyDeductionAdjustments(original,{payeTax:100,employeeNic:-20,employerNic:30,studentLoan:10});
  assert.equal(corrected.incomeTax,original.incomeTax+100);
  assert.equal(corrected.employeeNic,original.employeeNic-20);
  assert.equal(corrected.studentLoan,original.studentLoan+10);
  assert.equal(corrected.netPay,original.netPay-90);
  assert.equal(corrected.employerCost,original.employerCost+30);
});

test("2026/27 SSP pays from the first qualifying day at the lower weekly rate",()=>{
  const result=calculateStatutoryPay("sick",200,3/5,false,{payableDays:3,qualifyingDaysPerWeek:5});
  assert.equal(result.weeklyRate,123.25);
  assert.equal(result.total,73.95);
  assert.equal(result.recoverable,0);
  assert.equal(result.payableDays,3);
});

test("statutory pay warns when ordinary cash pay is also present",()=>{
  const result=calculateMonthlyPayroll({grossPay:2500,statutoryPay:194.32,taxCode:"1257L",niCategory:"A",periodNumber:4});
  assert.equal(result.grossPay,2694.32);
  assert.match(result.warnings.join(" "),/additional to the entered cash pay/);
  assert.equal(calculateMonthlyPayroll({grossPay:0,statutoryPay:194.32,taxCode:"1257L",niCategory:"A",periodNumber:4}).warnings.some(value=>value.includes("occupational pay")),false);
});

test("2026/27 SSP partial weeks reconcile to every HMRC daily table",()=>{
  const tables={
    7:[17.61,35.22,52.83,70.43,88.04,105.65,123.25],
    6:[20.55,41.09,61.63,82.17,102.71,123.25],
    5:[24.65,49.30,73.95,98.60,123.25],
    4:[30.82,61.63,92.44,123.25],
    3:[41.09,82.17,123.25],
    2:[61.63,123.25],
    1:[123.25],
  };
  for(const [qualifyingDays,amounts] of Object.entries(tables)){
    for(let payableDays=1;payableDays<=amounts.length;payableDays++){
      const result=calculateStatutoryPay("sick",1000,payableDays/Number(qualifyingDays),false,{payableDays,qualifyingDaysPerWeek:Number(qualifyingDays)});
      assert.equal(result.total,amounts[payableDays-1],`${payableDays} of ${qualifyingDays} qualifying days`);
    }
  }
});

test("statutory AWE derives monthly, weekly and new-starter evidence without rounding drift",()=>{
  const monthly=deriveStatutoryAwe([
    {payDate:"2026-06-30",earnings:2600},{payDate:"2026-07-31",earnings:2800},{payDate:"2026-08-31",earnings:3000},
  ],"2026-09-10","monthly");
  assert.equal(monthly.relevantPeriodStart,"2026-07-31");
  assert.equal(monthly.relevantPeriodEnd,"2026-08-31");
  assert.equal(monthly.relevantPayTotal,5800);
  assert.equal(monthly.averageWeeklyEarnings,669.23);
  assert.equal(monthly.warning,null);
  const weekly=deriveStatutoryAwe(Array.from({length:9},(_,index)=>({payDate:new Date(Date.UTC(2026,5,5+index*7)).toISOString().slice(0,10),earnings:500})),"2026-08-08","weekly");
  assert.equal(weekly.paymentCount,8);
  assert.equal(weekly.averageWeeklyEarnings,500);
  const starter=deriveStatutoryAwe([],"2026-09-10","monthly",520);
  assert.equal(starter.averageWeeklyEarnings,520);
  assert.equal(starter.method,"contractual-fallback");
  assert.match(starter.warning,/No finalised payment/);
});

test("family statutory pay derives partial weeks from payable calendar days",()=>{
  const maternity=calculateStatutoryPay("maternity",640,10/7,true,{payableDays:10,qualifyingDaysPerWeek:7});
  assert.equal(maternity.total,822.86);
  assert.equal(maternity.recoverable,896.92);
  const paternity=calculateStatutoryPay("paternity",640,20/7,false,{payableDays:20,qualifyingDaysPerWeek:7});
  assert.equal(paternity.payableDays,14);
  assert.equal(paternity.total,388.64);
});

test("every supported statutory family payment respects its maximum duration and recovery rate",()=>{
  const limits={maternity:39,adoption:39,paternity:2,"shared-parental":37,bereavement:2,neonatal:12};
  for(const [type,limit] of Object.entries(limits)){
    const normal=calculateStatutoryPay(type,500,100,false);
    const small=calculateStatutoryPay(type,500,100,true);
    assert.equal(normal.payableDays,limit*7,`${type} duration`);
    assert.equal(normal.recoverable,money(normal.total*.92),`${type} standard recovery`);
    assert.equal(small.recoverable,money(small.total*1.09),`${type} small-employer recovery`);
    assert.ok(normal.total>0,`${type} payment`);
  }
  assert.equal(calculateStatutoryPay("paternity",128.99,2,false).eligible,false);
  assert.equal(calculateStatutoryPay("paternity",129,2,false).eligible,true);
});

test("neonatal care claims accrue only from evidenced whole care weeks",()=>{
  const valid=assessNeonatalCareClaim({
    childBirthDate:"2026-05-01",careStartDate:"2026-05-03",careEndDate:"2026-05-23",
    payStartDate:"2026-06-01",payEndDate:"2026-06-21",tier:"tier-2",
    relationshipDeclaration:true,caringResponsibilityDeclaration:true,
  });
  assert.deepEqual(valid,{valid:true,error:"",careDays:21,accruedWeeks:3,claimedWeeks:3});
  assert.match(assessNeonatalCareClaim({...validInput(),careEndDate:"2026-05-08"}).error,/At least 7 consecutive/);
  assert.match(assessNeonatalCareClaim({...validInput(),payEndDate:"2026-06-08"}).error,/whole weeks/);
  assert.match(assessNeonatalCareClaim({...validInput(),careEndDate:"2026-05-09",payEndDate:"2026-06-14"}).error,/Only 1 week has accrued/);
  assert.match(assessNeonatalCareClaim({...validInput(),relationshipDeclaration:false}).error,/both the parental relationship/);
});

function validInput(){
  return {childBirthDate:"2026-05-01",careStartDate:"2026-05-03",careEndDate:"2026-05-16",payStartDate:"2026-06-01",payEndDate:"2026-06-07",tier:"tier-2",relationshipDeclaration:true,caringResponsibilityDeclaration:true};
}

test("family-pay blocks share one persisted cumulative entitlement",()=>{
  const first=assessFamilyPayClaim({statutoryType:"paternity",familyEventReference:"BABY-2026-A",familyEventDate:"2026-08-01",startDate:"2026-08-10",endDate:"2026-08-16",previousClaimedWeeks:0,previousBlocks:0});
  assert.deepEqual(first,{valid:true,error:"",claimedWeeks:1,remainingWeeks:1,blockNumber:1});
  const second=assessFamilyPayClaim({statutoryType:"paternity",familyEventReference:"BABY-2026-A",familyEventDate:"2026-08-01",startDate:"2026-09-07",endDate:"2026-09-13",previousClaimedWeeks:1,previousBlocks:1});
  assert.deepEqual(second,{valid:true,error:"",claimedWeeks:1,remainingWeeks:0,blockNumber:2});
  assert.match(assessFamilyPayClaim({statutoryType:"paternity",familyEventReference:"BABY-2026-A",familyEventDate:"2026-08-01",startDate:"2026-10-01",endDate:"2026-10-07",previousClaimedWeeks:2,previousBlocks:2}).error,/No more than 2/);
  assert.match(assessFamilyPayClaim({statutoryType:"shared-parental",familyEventReference:"BABY-SPL",familyEventDate:"2026-06-01",startDate:"2026-09-01",endDate:"2026-09-14",previousClaimedWeeks:8,previousBlocks:2,sharedPayWeeksAvailable:9}).error,/Only 1 statutory-pay week/);
  assert.match(assessFamilyPayClaim({statutoryType:"bereavement",familyEventReference:"LOSS-1",familyEventDate:"2026-07-01",startDate:"2027-08-01",endDate:"2027-08-07",previousClaimedWeeks:0,previousBlocks:0}).error,/within 56 weeks/);
});

test("split maternity and adoption records preserve one 39-week rate timeline",()=>{
  const first=assessMaternityAdoptionPayClaim({
    statutoryType:"maternity",familyEventReference:"MAT-2026-A",familyEventDate:"2026-06-01",
    startDate:"2026-04-06",endDate:"2026-05-17",payPeriodStart:"2026-04-06",previousClaimedDays:0,
  });
  assert.equal(first.valid,true);
  assert.equal(first.claimedDays,42);
  assert.equal(first.payPeriodDayOffset,0);
  assert.equal(first.payPeriodStart,"2026-04-06");
  assert.equal(calculateStatutoryPay("maternity",300,6,false,{payableDays:42,payPeriodDayOffset:first.payPeriodDayOffset}).total,1620);

  const resumed=assessMaternityAdoptionPayClaim({
    statutoryType:"maternity",familyEventReference:"MAT-2026-A",familyEventDate:"2026-06-01",
    startDate:"2026-05-25",endDate:"2026-05-31",payPeriodStart:"2026-04-06",previousClaimedDays:42,
  });
  assert.equal(resumed.valid,true);
  assert.equal(resumed.payPeriodDayOffset,49);
  assert.equal(calculateStatutoryPay("maternity",300,1,false,{payableDays:7,payPeriodDayOffset:resumed.payPeriodDayOffset}).total,194.32);

  const extended=assessMaternityAdoptionPayClaim({
    statutoryType:"adoption",familyEventReference:"SAP-2026-A",familyEventDate:"2026-04-06",
    startDate:"2026-12-28",endDate:"2027-01-10",payPeriodStart:"2026-04-06",previousClaimedDays:0,
  });
  assert.match(extended.error,/39-week statutory-pay period ends/);
  const exhausted=assessMaternityAdoptionPayClaim({
    statutoryType:"adoption",familyEventReference:"SAP-2026-A",familyEventDate:"2026-04-06",
    startDate:"2026-12-21",endDate:"2027-01-03",payPeriodStart:"2026-04-06",previousClaimedDays:266,
  });
  assert.match(exhausted.error,/Only 1 statutory-pay week/);
});

test("split maternity records allocate enhanced-rate days to the correct tax month",()=>{
  const calculation=calculateStatutoryPay("maternity",300,4,false,{payableDays:28,payPeriodDayOffset:28});
  assert.equal(calculation.total,928.64);
  const event={
    type:"Maternity leave",subtype:"maternity",startDate:"2026-05-04",endDate:"2026-05-31",
    statutoryPayPeriodStart:"2026-04-06",qualifyingDays:28,qualifyingDaysPerWeek:7,
    qualifyingWeekdays:"1,2,3,4,5,6,7",averageWeeklyEarnings:300,
    statutoryAmount:calculation.total,recoveredAmount:calculation.recoverable,
  };
  const month1=statutoryPayAllocation(event,1,"2026/27"),month2=statutoryPayAllocation(event,2,"2026/27");
  assert.equal(month1.pay,77.14);
  assert.equal(money(month1.pay+month2.pay),calculation.total);
});

test("KIT and SPLIT work days share cumulative protected-day limits",()=>{
  const priorKit=Array.from({length:9},(_,index)=>({date:`2026-04-${String(index+6).padStart(2,"0")}`,kind:"kit"}));
  const tenth=assessStatutoryTouchDays({
    statutoryType:"maternity",startDate:"2026-05-01",endDate:"2026-05-07",
    days:[{date:"2026-05-04",kind:"kit"}],previousDays:priorKit,
  });
  assert.equal(tenth.valid,true);
  assert.equal(tenth.usedDays,10);
  assert.equal(tenth.remainingDays,0);
  assert.match(assessStatutoryTouchDays({
    statutoryType:"adoption",startDate:"2026-05-08",endDate:"2026-05-14",
    days:[{date:"2026-05-10",kind:"kit"}],previousDays:[...priorKit,{date:"2026-05-04",kind:"kit"}],
  }).error,/No more than 10 KIT days/);
  const twentieth=assessStatutoryTouchDays({
    statutoryType:"shared-parental",startDate:"2026-08-01",endDate:"2026-08-07",
    days:[{date:"2026-08-03",kind:"split"}],
    previousDays:Array.from({length:19},(_,index)=>({date:`2026-07-${String(index+1).padStart(2,"0")}`,kind:"split"})),
  });
  assert.equal(twentieth.valid,true);
  assert.equal(twentieth.usedDays,20);
  assert.match(assessStatutoryTouchDays({
    statutoryType:"shared-parental",startDate:"2026-08-01",endDate:"2026-08-07",
    days:[{date:"2026-08-03",kind:"kit"}],previousDays:[],
  }).error,/Only SPLIT days/);
});

test("ordinary work excludes whole family-pay weeks without extending the pay period",()=>{
  const excluded=assessStatutoryWorkedWeeks({
    statutoryType:"maternity",startDate:"2026-04-06",endDate:"2026-05-17",payPeriodStart:"2026-04-06",
    workDates:["2026-04-08"],protectedDates:[],previousWeeks:[],
  });
  assert.equal(excluded.valid,true);
  assert.deepEqual(excluded.weeks,[{workDate:"2026-04-08",weekStart:"2026-04-06"}]);
  assert.deepEqual(excluded.excludedWeekOffsets,[0]);
  const first=calculateStatutoryPay("maternity",300,6,false,{
    payableDays:42,payPeriodDayOffset:0,excludedWeekOffsets:excluded.excludedWeekOffsets,
  });
  assert.equal(first.excludedWeeks,1);
  assert.equal(first.paidDays,35);
  assert.equal(first.total,1350);
  const resumed=calculateStatutoryPay("maternity",300,1,false,{
    payableDays:7,payPeriodDayOffset:42,priorExcludedWeeks:1,
  });
  assert.equal(resumed.total,270);
  const event={
    type:"Maternity leave",subtype:"maternity",startDate:"2026-04-06",endDate:"2026-05-17",
    statutoryPayPeriodStart:"2026-04-06",statutoryWorkedWeeks:JSON.stringify(excluded.weeks),
    statutoryPaidDayOffset:0,qualifyingDays:42,qualifyingDaysPerWeek:7,qualifyingWeekdays:"1,2,3,4,5,6,7",
    averageWeeklyEarnings:300,statutoryAmount:first.total,recoveredAmount:first.recoverable,
  };
  const month1=statutoryPayAllocation(event,1,"2026/27"),month2=statutoryPayAllocation(event,2,"2026/27");
  assert.equal(money(month1.pay+month2.pay),1350);
  assert.equal(month1.pay,887.14);
  const shared=calculateStatutoryPay("shared-parental",300,3,false,{payableDays:21,excludedWeekOffsets:[1]});
  assert.equal(shared.excludedWeeks,1);
  assert.equal(shared.total,388.64);
  assert.match(assessStatutoryWorkedWeeks({
    statutoryType:"adoption",startDate:"2026-06-01",endDate:"2026-06-14",payPeriodStart:"2026-06-01",
    workDates:["2026-06-03"],protectedDates:["2026-06-03"],previousWeeks:[],
  }).error,/cannot be both/);
});

test("2026 bereavement pay uses day-one service eligibility",()=>{
  const result=assessStatutoryEligibility({statutoryType:"bereavement",averageWeeklyEarnings:129,continuousEmploymentWeeks:0,evidenceReceived:true,noticeReceived:true});
  assert.equal(result.eligible,true);
  assert.match(result.reason,/day-one/);
  const refused=assessStatutoryEligibility({statutoryType:"bereavement",averageWeeklyEarnings:0,continuousEmploymentWeeks:0,evidenceReceived:true,noticeReceived:true});
  assert.equal(refused.formType,"SPBP1");
});

test("2026 SSP eligibility has no lower earnings limit",()=>{
  const result=assessStatutoryEligibility({statutoryType:"sick",averageWeeklyEarnings:0,continuousEmploymentWeeks:0,evidenceReceived:true,noticeReceived:true});
  assert.equal(result.eligible,true);
  assert.match(result.reason,/no Lower Earnings Limit/);
  const ending=assessStatutoryEligibility({statutoryType:"sick",averageWeeklyEarnings:0,continuousEmploymentWeeks:0,evidenceReceived:true,noticeReceived:true,sspEnding:true});
  assert.equal(ending.formType,"SSP1");
  assert.equal(ending.reasonCode,"ssp-ending");
});

test("SSP allocation honours non-Monday qualifying work patterns across tax months",()=>{
  const event={
    type:"Sick leave",subtype:"sick",startDate:"2026-05-04",endDate:"2026-05-10",
    qualifyingDays:5,qualifyingDaysPerWeek:5,qualifyingWeekdays:"2,3,4,5,6",
    averageWeeklyEarnings:200,statutoryAmount:123.25,recoveredAmount:0,
  };
  assert.equal(statutoryPayAllocation(event,1,"2026/27").pay,24.65);
  assert.equal(statutoryPayAllocation(event,2,"2026/27").pay,98.6);
});

test("statutory pay and recovery allocations reconcile exactly across tax months",()=>{
  const calculation=calculateStatutoryPay("maternity",300,39,true,{payableDays:273,qualifyingDaysPerWeek:7});
  const event={
    type:"maternity",subtype:"maternity",startDate:"2026-04-06",endDate:"2027-01-03",
    qualifyingDays:calculation.payableDays,qualifyingDaysPerWeek:7,qualifyingWeekdays:"1,2,3,4,5,6,7",
    averageWeeklyEarnings:300,statutoryAmount:calculation.total,recoveredAmount:calculation.recoverable,
  };
  const allocations=Array.from({length:12},(_,index)=>statutoryPayAllocation(event,index+1,"2026/27"));
  assert.equal(money(allocations.reduce((sum,row)=>sum+row.pay,0)),calculation.total);
  assert.equal(money(allocations.reduce((sum,row)=>sum+row.recovery,0)),calculation.recoverable);
});

test("maternity and adoption calendars derive the full statutory pay schedule from one start date",()=>{
  assert.equal(automaticStatutoryPayWeeks("maternity"),39);
  assert.equal(automaticStatutoryPayWeeks("adoption"),39);
  assert.equal(automaticStatutoryPayEndDate("maternity","2026-04-06"),"2027-01-03");
  assert.equal(automaticStatutoryPayEndDate("adoption","2026-06-01"),"2027-02-28");
  const maternity=calculateStatutoryPay("maternity",300,39,false,{payableDays:273,qualifyingDaysPerWeek:7});
  assert.equal(maternity.weeklyRate,194.32);
  assert.equal(maternity.total,8032.56);
  assert.equal(maternity.recoverable,7389.96);
  assert.equal(automaticStatutoryPayEndDate("paternity","2026-04-06"),null);
  assert.equal(automaticStatutoryPayEndDate("maternity","not-a-date"),null);
});

test("employment dates include joiners and leavers only in overlapping tax months",()=>{
  assert.equal(employeeActiveInPeriod("2026-06-20",null,2,"2026/27"),false);
  assert.equal(employeeActiveInPeriod("2026-06-20",null,3,"2026/27"),true);
  assert.equal(employeeActiveInPeriod(null,"2026-06-05",2,"2026/27"),true);
  assert.equal(employeeActiveInPeriod(null,"2026-06-05",3,"2026/27"),false);
  assert.equal(employeeActiveInPeriod("2026-07-01","2026-07-01",3,"2026/27"),true);
});

  test("2026 DEA monthly bands and protected earnings are applied",()=>{
  const standard=calculateAttachment({netPay:2500,type:"DEA",deductionType:"fixed",deductionValue:0,calculationRule:"dea-standard",payFrequency:"monthly",balance:5000,adminFee:1});
  assert.equal(standard.rate,20);
  assert.equal(standard.deduction,500);
  assert.equal(standard.protectedEarnings,1500);
  assert.equal(standard.totalFromPay,501);
  const protectedResult=calculateAttachment({netPay:500,type:"DEA",deductionType:"fixed",deductionValue:0,calculationRule:"dea-higher",payFrequency:"monthly",balance:5000,adminFee:1,existingDeductions:190});
  assert.equal(protectedResult.rate,6);
  assert.equal(protectedResult.deduction,10);
    assert.equal(protectedResult.adminFee,1);
  });

  test("DEA exact half-pennies round down as required by DWP",()=>{
    const result=calculateAttachment({netPay:200.9,type:"DEA",deductionType:"fixed",deductionValue:0,
      calculationRule:"dea-standard",payFrequency:"weekly",balance:5000,adminFee:1});
    assert.equal(result.rate,5);
    assert.equal(result.deduction,10.04);
  });

  test("court AEO priority orders carry shortfalls but non-priority orders do not",()=>{
    const common={netPay:500,type:"Court AEO",deductionType:"fixed",deductionValue:150,
      payFrequency:"monthly",protectedEarnings:400,balance:5000,adminFee:1,arrears:25};
    const priority=calculateAttachment({...common,calculationRule:"aeo-priority"});
    assert.equal(priority.deduction,100);
    assert.equal(priority.shortfall,75);
    assert.equal(priority.arrearsAfter,75);
    const nonPriority=calculateAttachment({...common,calculationRule:"aeo-non-priority"});
    assert.equal(nonPriority.deduction,100);
    assert.equal(nonPriority.shortfall,50);
    assert.equal(nonPriority.arrearsAfter,0);
  });

  test("Scottish monthly earnings arrestment uses the table effective from 6 April 2025",()=>{
    const calculate=netPay=>calculateAttachment({netPay,type:"Scottish Earnings Arrestment",deductionType:"fixed",
      deductionValue:0,calculationRule:"scottish-earnings-arrestment",payFrequency:"monthly",balance:10000,adminFee:1});
    assert.equal(calculate(750).deduction,0);
    assert.equal(calculate(760).deduction,10);
    assert.equal(calculate(1000).deduction,37.5);
    assert.equal(calculate(2000).deduction,212.5);
    assert.equal(calculate(3000).deduction,437.5);
    assert.equal(calculate(4000).deduction,750);
  });

  test("Scottish weekly and multi-week earnings arrestments use the statutory weekly table",()=>{
    const calculate=(netPay,payFrequency)=>calculateAttachment({netPay,type:"Scottish Earnings Arrestment",
      deductionType:"fixed",deductionValue:0,calculationRule:"scottish-earnings-arrestment",
      payFrequency,balance:10000,adminFee:1});
    assert.equal(calculate(172.61,"weekly").deduction,0);
    assert.equal(calculate(180,"weekly").deduction,2.3);
    assert.equal(calculate(300,"weekly").deduction,19.11);
    assert.equal(calculate(500,"weekly").deduction,56.85);
    assert.equal(calculate(700,"weekly").deduction,103.08);
    assert.equal(calculate(1000,"weekly").deduction,212.31);
    assert.equal(calculate(600,"fortnightly").deduction,38.22);
    assert.equal(calculate(1200,"four-weekly").deduction,76.44);
  });

  test("Scottish mixed conjoined orders support fortnightly statutory-table deductions",()=>{
    const result=calculateAttachment({netPay:1000,type:"Scottish Mixed Conjoined Arrestment",
      deductionType:"fixed",deductionValue:0,calculationRule:"scottish-conjoined-mixed",
      payFrequency:"fortnightly",periodDays:14,balance:null,ordinaryDebtBalance:1000,
      maintenanceDailyRate:30,adminFee:1});
    assert.equal(result.protectedEarnings,345.24);
    assert.equal(result.deduction,533.7);
    assert.equal(result.ordinaryDeduction,113.7);
    assert.equal(result.maintenanceDeduction,420);
    assert.equal(result.ordinaryBalanceAfter,886.3);
  });

  test("Northern Ireland court fines use published bands and preserve 60% of net earnings",()=>{
    const result=calculateAttachment({netPay:700,type:"Northern Ireland Court Fine AEO",deductionType:"fixed",
      deductionValue:0,calculationRule:"ni-court-fine",payFrequency:"monthly",balance:5000,adminFee:1});
    assert.equal(result.rate,5);
    assert.equal(result.deduction,35);
    assert.equal(result.protectedEarnings,420);
  });

  test("Northern Ireland EJO orders obey the instructed deduction and protected earnings rate",()=>{
    const result=calculateAttachment({netPay:900,type:"Northern Ireland EJO Attachment of Earnings",
      deductionType:"fixed",deductionValue:250,calculationRule:"ni-ejo",payFrequency:"monthly",
      protectedEarnings:725,balance:5000,adminFee:1});
    assert.equal(result.deduction,175);
    assert.equal(result.shortfall,75);
    assert.equal(result.arrearsAfter,0);
  });

  test("Scottish current maintenance uses the order daily rate and £24.66 daily protection",()=>{
    const result=calculateAttachment({netPay:2000,type:"Scottish Current Maintenance Arrestment",
      deductionType:"fixed",deductionValue:20,calculationRule:"scottish-current-maintenance",
      payFrequency:"monthly",periodDays:31,balance:null,adminFee:1});
    assert.equal(result.deduction,620);
    assert.equal(result.protectedEarnings,764.46);
    const capped=calculateAttachment({netPay:2000,type:"Scottish Current Maintenance Arrestment",
      deductionType:"fixed",deductionValue:50,calculationRule:"scottish-current-maintenance",
      payFrequency:"monthly",periodDays:31,balance:null,adminFee:1});
    assert.equal(capped.deduction,1235.54);
    assert.equal(capped.shortfall,314.46);
  });

  test("Scottish conjoined current maintenance accepts an aggregate daily rate",()=>{
    const result=calculateAttachment({netPay:1000,type:"Scottish Conjoined Maintenance Arrestment",
      deductionType:"fixed",deductionValue:30,calculationRule:"scottish-conjoined-maintenance",
      payFrequency:"monthly",periodDays:30,balance:null,adminFee:1});
    assert.equal(result.protectedEarnings,739.8);
    assert.equal(result.deduction,260.2);
    assert.equal(result.shortfall,639.8);
  });

  test("mixed Scottish conjoined orders allocate constrained earnings proportionally",()=>{
    const result=calculateAttachment({netPay:1000,type:"Scottish Mixed Conjoined Arrestment",
      deductionType:"fixed",deductionValue:0,calculationRule:"scottish-conjoined-mixed",
      payFrequency:"monthly",periodDays:30,balance:null,ordinaryDebtBalance:1000,
      maintenanceDailyRate:30,adminFee:1});
    assert.equal(result.protectedEarnings,739.8);
    assert.equal(result.deduction,260.2);
    assert.equal(result.ordinaryDeduction,10.41);
    assert.equal(result.maintenanceDeduction,249.79);
    assert.equal(result.ordinaryBalanceAfter,989.59);
  });

test("child maintenance carries forward shortfalls and permits the statutory fee below protection",()=>{
  const result=calculateAttachment({netPay:500,type:"Child maintenance DEO",deductionType:"fixed",deductionValue:250,calculationRule:"child-maintenance",payFrequency:"monthly",arrears:50,balance:2000,adminFee:1});
  assert.equal(result.protectedEarnings,300);
  assert.equal(result.deduction,200);
  assert.equal(result.shortfall,100);
  assert.equal(result.arrearsAfter,100);
  assert.equal(result.totalFromPay,201);
});

test("England and Wales council-tax bands use 17% plus 50% above the upper threshold",()=>{
  const result=calculateAttachment({netPay:2500,type:"Council Tax AEO",deductionType:"fixed",deductionValue:0,calculationRule:"council-tax-england-wales",payFrequency:"monthly",balance:5000,adminFee:1});
  assert.equal(result.deduction,583.4);
  assert.equal(result.rate,50);
  assert.equal(result.totalFromPay,584.4);
});

test("attachment priorities put priority court and council orders before child maintenance and DEA",()=>{
  assert.deepEqual(["DEA","Child maintenance DEO","Council Tax AEO","Non-priority AEO"].sort((a,b)=>attachmentPriority(a)-attachmentPriority(b)),["Council Tax AEO","Child maintenance DEO","DEA","Non-priority AEO"]);
});

test("fortnightly and four-weekly attachment tables use weekly pay and scale the deduction",()=>{
  const fortnightlyDea=calculateAttachment({
    netPay:1200,type:"DEA",deductionType:"fixed",deductionValue:0,
    calculationRule:"dea-standard",payFrequency:"fortnightly",balance:5000,adminFee:1,
  });
  assert.equal(fortnightlyDea.rate,20);
  assert.equal(fortnightlyDea.deduction,240);
  const fourWeeklyCouncil=calculateAttachment({
    netPay:1200,type:"Council Tax AEO",deductionType:"fixed",deductionValue:0,
    calculationRule:"council-tax-england-wales",payFrequency:"four-weekly",balance:5000,adminFee:1,
  });
  assert.equal(fourWeeklyCouncil.rate,12);
  assert.equal(fourWeeklyCouncil.deduction,144);
});

test("the 30-employee two-period acceptance matrix has no calculation failures",()=>{
  const scenarios=runPayrollScenarios();
  assert.equal(scenarios.length,30);
  assert.deepEqual(scenarios.filter(item=>item.status!=="passed"),[]);
  const byId=Object.fromEntries(scenarios.map(item=>[item.id,item]));
  assert.equal(byId.P45.months[0].incomeTax,471.75);
  assert.equal(byId.SECONDARY.months[0].incomeTax,250);
  assert.equal(byId["LOAN-2-PG"].months[0].studentLoan,130);
  assert.equal(byId["LOAN-2-PG"].months[0].postgraduateLoan,129);
  assert.equal(byId["NIC-X"].months[1].employerNic,0);
  assert.equal(byId["NO-SECONDARY-NIC"].months[1].employerNic,0);
});

test("CIS acceptance variations deduct labour only at 0%, 20% and 30%",()=>{
  const scenarios=runCisScenarios();
  assert.deepEqual(scenarios.map(item=>item.deduction),[1600,1350,0,640]);
  assert.deepEqual(scenarios.map(item=>item.netPayment),[9440,5110,16510,3200]);
  assert.equal(scenarios[1].deductibleAmount,4500);
});

test("reviewed payrolled benefits reconcile exactly across the tax year",()=>{
  const benefit={cashEquivalent:1200};
  const allocations=Array.from({length:12},(_,index)=>payrolledBenefitForPeriod(benefit,index+1,"2026/27"));
  assert.equal(allocations.reduce((sum,value)=>sum+value,0),1200);
  assert.ok(allocations.every(value=>value>0));
  assert.equal(totalPayrolledBenefitsForPeriod([benefit,{cashEquivalent:600}],1,"2026/27"),147.95);
});

test("frozen RTI evidence accepts every supported employer pay frequency",()=>{
  const base={
    payrollId:"EMP-RTI-1",firstName:"Alex",lastName:"Evidence",taxCode:"1257L",niCategory:"A",
  };
  for(const reportedPayFrequency of ["monthly","weekly","fortnightly","four-weekly"]){
    const earningsPeriod=reportedPayFrequency==="monthly"?"monthly":"weekly";
    const source=JSON.stringify({...base,reportedPayFrequency,earningsPeriod});
    assert.equal(hasValidFrozenRtiSnapshot(source),true);
    assert.equal(parseFrozenRtiSnapshot(source).reportedPayFrequency,reportedPayFrequency);
  }
  assert.equal(hasValidFrozenRtiSnapshot(JSON.stringify({...base,reportedPayFrequency:"quarterly",earningsPeriod:"monthly"})),false);
});

test("company-car payrolling respects availability dates without rounding drift",()=>{
  const car={cashEquivalent:3650,availableFrom:"2026-07-20",availableTo:"2026-10-19"};
  const allocations=Array.from({length:12},(_,index)=>payrolledBenefitForPeriod(car,index+1,"2026/27"));
  assert.deepEqual(allocations.slice(0,3),[0,0,0]);
  assert.ok(allocations[3]>0&&allocations[3]<allocations[4]);
  assert.ok(allocations[6]>0&&allocations[6]<allocations[5]);
  assert.deepEqual(allocations.slice(7),[0,0,0,0,0]);
  assert.equal(allocations.reduce((sum,value)=>sum+value,0),3650);
});

test("annual leave consumes scheduled working days rather than calendar days",()=>{
  assert.equal(countWorkingDays("2026-08-07","2026-08-10",[1,2,3,4,5]),2);
  assert.equal(countWorkingDays("2026-08-03","2026-08-09",[1,2,3,4]),4);
  assert.equal(countWorkingDays("2026-12-21","2026-12-28",[1,2,3,4,5],["2026-12-25","2026-12-28"]),4);
  assert.deepEqual(defaultWorkingWeekdays(4),[1,2,3,4]);
  assert.deepEqual(defaultWorkingWeekdays(9),[1,2,3,4,5,6,7]);
});

test("working-day calculation validates the date range and work pattern",()=>{
  assert.throws(()=>countWorkingDays("2026-08-10","2026-08-07",[1,2,3,4,5]),/valid working-day date range/);
  assert.throws(()=>countWorkingDays("2026-08-07","2026-08-10",[]),/at least one working weekday/);
});

test("annual leave entitlement prorates joiners and leavers by employment days",()=>{
  assert.equal(proratedLeaveEntitlement(28,null,null,"2026/27"),28);
  assert.equal(proratedLeaveEntitlement(28,"2026-10-06",null,"2026/27"),13.96);
  assert.equal(proratedLeaveEntitlement(28,null,"2026-10-05","2026/27"),14.04);
  assert.equal(proratedLeaveEntitlement(28,"2027-04-06",null,"2026/27"),0);
});

test("annual leave usage allocates cross-year events by scheduled weekdays",()=>{
  const events=[
    {type:"Annual leave",startDate:"2027-04-03",endDate:"2027-04-10",qualifyingDays:5,qualifyingWeekdays:"1,2,3,4,5",excludedCalendarDates:'["2027-04-05"]',status:"calculated"},
    {type:"Annual leave",startDate:"2026-08-07",endDate:"2026-08-10",qualifyingDays:2,qualifyingWeekdays:"1,2,3,4,5",status:"cancelled"},
  ];
  assert.equal(annualLeaveUsed(events,"2026/27"),0);
  assert.equal(annualLeaveUsed(events,"2027/28"),4);
  assert.deepEqual(leaveEntitlementBalance(28,"2026-10-06",null,events,"2027/28"),{contractual:28,entitlement:28,used:4,remaining:24});
});

test("leave years split correctly at 5 and 6 April",()=>{
  assert.equal(leaveYearForDate("2027-04-05"),"2026/27");
  assert.equal(leaveYearForDate("2027-04-06"),"2027/28");
  assert.deepEqual(leaveYearsAcrossRange("2027-04-03","2027-04-10"),["2026/27","2027/28"]);
  assert.throws(()=>leaveYearsAcrossRange("2027-04-10","2027-04-03"),/valid leave date range/);
});

test("pension postponement uses calendar months and clamps month-end dates",()=>{
  assert.equal(addCalendarMonths("2026-01-31",3),"2026-04-30");
  assert.equal(addCalendarMonths("2026-11-30",3),"2027-02-28");
  assert.equal(addCalendarMonths("2028-11-30",3),"2029-02-28");
  assert.equal(addCalendarMonths("2026-04-30",-3),"2026-01-30");
});

test("employer CSV validation prepares complete PAYE and CIS client defaults",()=>{
  const result=validateEmployerImportRows([
    {name:"North Trading Ltd",payeReference:"123/AB456",accountsOfficeReference:"123PA12345678",companyNumber:"12345678",taxYear:"2026/27",
      cisContractor:"false",smallEmployersRelief:"yes",employmentAllowance:"true",apprenticeshipLevy:"no",
      typicalPayBasis:"hourly",typicalAnnualLeaveDays:"30",typicalWeeklyHours:"40",minimumHourlyRate:"13.25",
      autoWorksNumber:"true",nextWorksNumber:"100",clientStatus:"onboarding",colourReference:"#123abc",
      primaryContactEmail:"OWNER@EXAMPLE.CO.UK",documentPasswordStrategy:"employee-ni-last4"},
    {name:"South Construction LLP",payeReference:"234/CD567",accountsOfficeReference:"234PB23456789",taxYear:"2026/27",
      cisContractor:"true",cisUtr:"12345 67890",typicalPayBasis:"period"},
  ]);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.prepared.length,2);
  assert.equal(result.prepared[0].minimumHourlyRate,13.25);
  assert.equal(result.prepared[0].primaryContactEmail,"owner@example.co.uk");
  assert.equal(result.prepared[1].cisUtr,"1234567890");
  assert.equal(result.prepared[1].autoWorksNumber,true);
});

test("employer CSV validation rejects duplicate identities and malformed compliance fields",()=>{
  const result=validateEmployerImportRows([
    {name:"Existing Client",payeReference:"123/AB456",accountsOfficeReference:"bad",taxYear:"2026/26",cisContractor:"maybe",
      typicalPayBasis:"weekly",primaryContactEmail:"invalid",colourReference:"blue"},
    {name:"Existing Client",payeReference:"123/AB456",accountsOfficeReference:"123PA12345678",taxYear:"2026/27",cisContractor:"true",cisUtr:"123"},
  ],{names:["Existing Client"],payeReferences:["123/AB456"]});
  assert.ok(result.errors.length>=9);
  assert.ok(result.errors.some(value=>value.includes("already exists")));
  assert.ok(result.errors.some(value=>value.includes("duplicated in this file")));
  assert.ok(result.errors.some(value=>value.includes("10-digit UTR")));
  assert.ok(result.errors.some(value=>value.includes("typical pay basis")));
});

test("PAYE and NIC scale through weekly, fortnightly and four-weekly pay periods",()=>{
  const weekly=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",periodNumber:1,taxCode:"1257L",niCategory:"A",
    pensionEmployeeRate:0,pensionEmployerRate:0,studentLoanPlan:"1",postgraduateLoan:true});
  assert.equal(weekly.incomeTax,158.24);
  assert.equal(weekly.employeeNic,58.66);
  assert.equal(weekly.employerNic,135.6);
  assert.equal(weekly.studentLoan,43);
  assert.equal(weekly.postgraduateLoan,35);
  assert.equal(weekly.warnings.some(value=>value.includes("National Living Wage")),false);
  const weeklyTwo=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",periodNumber:2,taxCode:"1257L",niCategory:"A",
    ytdTaxablePay:1000,ytdTaxPaid:weekly.incomeTax,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(weeklyTwo.incomeTax,158.24);
  const fortnightly=calculateMonthlyPayroll({grossPay:2000,payFrequency:"fortnightly",periodNumber:1,taxCode:"1257L",niCategory:"A",
    pensionEmployeeRate:0,pensionEmployerRate:0,studentLoanPlan:"1",postgraduateLoan:true});
  assert.equal(fortnightly.incomeTax,316.48);
  assert.equal(fortnightly.employeeNic,117.32);
  assert.equal(fortnightly.employerNic,271.2);
  assert.equal(fortnightly.studentLoan,86);
  assert.equal(fortnightly.postgraduateLoan,71);
  const fourWeekly=calculateMonthlyPayroll({grossPay:4000,payFrequency:"four-weekly",periodNumber:1,taxCode:"1257L",niCategory:"A",
    pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(fourWeekly.incomeTax,632.95);
  assert.equal(fourWeekly.employeeNic,234.64);
  assert.equal(fourWeekly.employerNic,542.4);
});

test("qualifying-earnings pension bands use official 2026/27 frequency thresholds",()=>{
  const weekly=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",pensionBasis:"qualifying",pensionEmployeeRate:5,pensionEmployerRate:3});
  assert.equal(weekly.pensionablePay,847);
  assert.equal(weekly.employeePensionGross,42.35);
  const fortnightly=calculateMonthlyPayroll({grossPay:2000,payFrequency:"fortnightly",pensionBasis:"qualifying",pensionEmployeeRate:5,pensionEmployerRate:3});
  assert.equal(fortnightly.pensionablePay,1694);
  const fourWeekly=calculateMonthlyPayroll({grossPay:4000,payFrequency:"four-weekly",pensionBasis:"qualifying",pensionEmployeeRate:5,pensionEmployerRate:3});
  assert.equal(fourWeekly.pensionablePay,3387);
});

test("frequency rules enforce standard period counts and deterministic pay dates",()=>{
  assert.equal(annualPayPeriodDivisor("monthly"),12);
  assert.equal(annualPayPeriodDivisor("weekly"),52);
  assert.equal(cumulativeTaxFraction("fortnightly",13),.5);
  assert.equal(cumulativeTaxFraction("four-weekly",13),1);
  assert.equal(validatePayrollPeriod("weekly",53),53);
  assert.throws(()=>validatePayrollPeriod("weekly",54),/between 1 and 53/);
  const dates=periodDateSequence("2026/27","fortnightly","2026-04-10");
  assert.equal(dates.length,26);
  assert.deepEqual(dates.slice(0,3),["2026-04-10","2026-04-24","2026-05-08"]);
  assert.equal(dates.at(-1),"2027-03-26");
  assert.equal(periodDateSequence("2026/27","weekly","2026-04-06").length,53);
  assert.equal(periodDateSequence("2026/27","fortnightly","2026-04-06").length,27);
  assert.equal(periodDateSequence("2026/27","four-weekly","2026-04-06").length,14);
  assert.equal(rtiTaxWeekNumber("weekly",53),53);
  assert.equal(rtiTaxWeekNumber("fortnightly",27),54);
  assert.equal(rtiTaxWeekNumber("four-weekly",14),56);
  assert.equal(taxWeekForDate("2026/27","2026-04-06"),1);
  assert.equal(taxWeekForDate("2026/27","2027-04-05"),53);
  assert.equal(taxMonthForDate("2026/27","2027-04-05"),12);
  assert.equal(rtiPeriodNumberForPayDate("2026/27","weekly","2026-04-13"),2);
  assert.equal(rtiPeriodNumberForPayDate("2026/27","fortnightly","2026-04-20"),4);
  assert.equal(rtiPeriodNumberForPayDate("2026/27","four-weekly","2027-04-05"),56);
  assert.throws(()=>periodDateSequence("2026/27","weekly","2026-04-05"),/within the selected tax year/);
});

test("extra weekly and multi-week paydays use one-period PAYE without changing the tax code",()=>{
  const weekly=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",periodNumber:53,taxCode:"1257L",niCategory:"A",
    ytdTaxablePay:52000,ytdTaxPaid:8228.4,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(weekly.incomeTax,158.24);
  const fortnightly=calculateMonthlyPayroll({grossPay:2000,payFrequency:"fortnightly",periodNumber:27,taxCode:"1257L",niCategory:"A",
    ytdTaxablePay:52000,ytdTaxPaid:8228.4,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(fortnightly.incomeTax,316.48);
  const fourWeekly=calculateMonthlyPayroll({grossPay:4000,payFrequency:"four-weekly",periodNumber:14,taxCode:"1257L",niCategory:"A",
    ytdTaxablePay:52000,ytdTaxPaid:8228.4,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(fourWeekly.incomeTax,632.95);
  const lowPay=calculateMonthlyPayroll({grossPay:100,payFrequency:"weekly",periodNumber:53,taxCode:"1257L",niCategory:"A",
    ytdTaxablePay:10000,ytdTaxPaid:0,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(lowPay.incomeTax,0);
});

test("weekly cumulative PAYE uses the tax week containing the payment date",()=>{
  const firstPaymentInWeekTwo=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",periodNumber:1,taxWeekNumber:2,
    taxCode:"1257L",niCategory:"A",pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(firstPaymentInWeekTwo.incomeTax,103.24);
  const finalPaymentOnFiveApril=calculateMonthlyPayroll({grossPay:1000,payFrequency:"weekly",periodNumber:52,taxWeekNumber:53,
    taxCode:"1257L",niCategory:"A",ytdTaxablePay:51000,ytdTaxPaid:7868.4,pensionEmployeeRate:0,pensionEmployerRate:0});
  assert.equal(finalPaymentOnFiveApril.incomeTax,158.24);
});

test("pay schedules freeze pay dates, covered ranges and RTI tax periods",()=>{
  const monthly=scheduledPayPeriods("2026/27","monthly");
  assert.deepEqual(monthly[0],{periodNumber:1,payDate:"2026-04-30",periodStart:"2026-04-06",periodEnd:"2026-05-05",taxMonth:1,taxWeekNumber:1});
  assert.equal(monthly[11].payDate,"2027-03-31");
  const weekly=scheduledPayPeriods("2026/27","weekly","2026-04-13");
  assert.equal(weekly.length,52);
  assert.deepEqual(weekly[0],{periodNumber:1,payDate:"2026-04-13",periodStart:"2026-04-07",periodEnd:"2026-04-13",taxMonth:1,taxWeekNumber:2});
  assert.equal(weekly.at(-1).taxWeekNumber,53);
  const fourWeekly=scheduledPayPeriods("2026/27","four-weekly","2026-04-06");
  assert.equal(fourWeekly.length,14);
  assert.equal(fourWeekly.at(-1).taxWeekNumber,56);
  assert.equal(fourWeekly.at(-1).taxMonth,12);
});

test("date-range allocations let non-monthly periods consume benefits and statutory pay exactly once",()=>{
  const schedule=scheduledPayPeriods("2026/27","weekly","2026-04-06");
  const benefit={cashEquivalent:3650};
  const benefitAllocations=schedule.map(period=>payrolledBenefitForRange(benefit,"2026/27",period.periodStart,period.periodEnd));
  assert.equal(benefitAllocations.reduce((sum,value)=>sum+value,0),3650);
  const dated={cashEquivalent:250,providedDate:"2026-04-20"};
  assert.equal(schedule.filter(period=>payrolledBenefitForRange(dated,"2026/27",period.periodStart,period.periodEnd)>0).length,1);
  const event={type:"Maternity leave",subtype:"maternity",startDate:"2026-04-06",endDate:"2026-04-12",qualifyingDays:7,
    averageWeeklyEarnings:1000,statutoryAmount:700,recoveredAmount:644};
  const pay=schedule.slice(0,2).map(period=>statutoryPayAllocationForRange(event,period.periodStart,period.periodEnd));
  assert.equal(pay.reduce((sum,value)=>sum+value.pay,0),700);
  assert.equal(pay.reduce((sum,value)=>sum+value.recovery,0),644);
  assert.equal(employeeActiveInRange("2026-04-10",null,schedule[0].periodStart,schedule[0].periodEnd),false);
  assert.equal(employeeActiveInRange("2026-04-10",null,schedule[1].periodStart,schedule[1].periodEnd),true);
});

test("automatic-enrolment assessment uses the official trigger for every supported frequency",()=>{
  const base={dateOfBirth:"1990-01-01",assessmentDate:"2026-04-10",employeeRate:5,employerRate:3};
  assert.equal(assessPensionAtDate({...base,payFrequency:"weekly",earnings:191.99}).action,"offer-opt-in");
  const weekly=assessPensionAtDate({...base,payFrequency:"weekly",earnings:192});
  assert.equal(weekly.action,"enrol");
  assert.equal(weekly.qualifyingEarnings,72);
  assert.equal(assessPensionAtDate({...base,payFrequency:"fortnightly",earnings:384}).action,"enrol");
  assert.equal(assessPensionAtDate({...base,payFrequency:"four-weekly",earnings:768}).action,"enrol");
  assert.equal(assessPensionAtDate({...base,payFrequency:"monthly",earnings:833}).action,"enrol");
});

const copySource=overrides=>({
  id:81,employeeId:7,taxYear:"2025/26",category:"Other taxable benefit",p11dSection:"M",nicTreatment:"class-1a",
  providedDate:null,description:"Continuing medical cover",cashEquivalent:1200,payrolled:true,class1aNic:180,
  benefitEvent:null,availableFrom:null,availableTo:null,vehicleRegistration:null,makeModel:null,fuelType:null,
  firstRegistered:null,co2Emissions:null,zeroEmissionMileage:null,listPrice:null,capitalContributions:null,
  privateUseContribution:null,vanUseType:null,vanFuelProvided:null,vanFuelRepaid:null,vanSharedEmployees:null,
  loanOpeningBalance:null,loanClosingBalance:null,loanMaximumAggregateBalance:null,loanWholeMonths:null,
  loanInterestPaid:null,loanSalaryForegone:null,accommodationAnnualValue:null,accommodationProviderRent:null,
  accommodationPropertyCost:null,accommodationImprovements:null,accommodationEmployeeCapital:null,
  accommodationEmployeeRent:null,accommodationAvailableDays:null,accommodationSharedEmployees:null,
  accommodationSalaryForegone:null,...overrides,
});

test("annual benefit copying rolls dates, recalculates values and preserves draft isolation",()=>{
  assert.equal(nextTaxYear("2025/26"),"2026/27");
  assert.equal(shiftDateByTaxYear("2024-02-29"),"2025-02-28");
  const simple=prepareBenefitCopy(copySource({nicTreatment:"class-1",providedDate:"2025-09-30"}),"2026/27");
  assert.equal(simple.eligible,true);
  assert.equal(simple.values.providedDate,"2026-09-30");
  assert.equal(simple.values.status,"draft");
  assert.equal(simple.values.copiedFromBenefitId,81);
  assert.equal(simple.values.class1aNic,0);

  const car=prepareBenefitCopy(copySource({
    id:82,category:"Company car",p11dSection:"F",description:"Continuing company car",cashEquivalent:630,
    benefitEvent:"provided",availableFrom:"2025-08-01",vehicleRegistration:"AB26 XYZ",makeModel:"Example EV",
    fuelType:"Electric",firstRegistered:"2025-07-01",co2Emissions:0,zeroEmissionMileage:300,
    listPrice:30000,capitalContributions:0,privateUseContribution:0,
  }),"2026/27");
  assert.equal(car.eligible,true);
  assert.equal(car.values.availableFrom,"2026-04-06");
  assert.equal(car.values.firstRegistered,"2025-07-01");
  assert.equal(car.values.cashEquivalent,1200);
  assert.equal(car.values.class1aNic,180);
  assert.equal(validateBenefitEvidence(car.values),null);

  const ended=prepareBenefitCopy(copySource({
    category:"Company van",p11dSection:"G",description:"Returned van",availableFrom:"2025-04-06",
    availableTo:"2026-03-31",vehicleRegistration:"VN25 END",fuelType:"Combustion",
    vanUseType:"taxable-private-use",vanFuelProvided:false,vanFuelRepaid:false,vanSharedEmployees:1,
    privateUseContribution:0,
  }),"2026/27");
  assert.equal(ended.eligible,false);
});

test("beneficial-loan copies carry the closing balance into the new year",()=>{
  const copied=prepareBenefitCopy(copySource({
    category:"Beneficial loan",p11dSection:"H",description:"Director loan",
    loanOpeningBalance:20000,loanClosingBalance:12000,loanMaximumAggregateBalance:20000,
    loanWholeMonths:12,loanInterestPaid:0,loanSalaryForegone:0,
  }),"2026/27");
  assert.equal(copied.eligible,true);
  assert.equal(copied.values.loanOpeningBalance,12000);
  assert.equal(copied.values.loanClosingBalance,12000);
  assert.equal(copied.values.loanMaximumAggregateBalance,12000);
  assert.equal(copied.values.cashEquivalent,450);
  assert.equal(validateBenefitEvidence(copied.values),null);
});

test("agent invoices count finalised payroll evidence using each configured billing basis",()=>{
  const source={
    periodIds:[11,12,13],
    payRuns:[
      {id:1,employeeId:1,payPeriodId:11},{id:2,employeeId:2,payPeriodId:11},
      {id:3,employeeId:1,payPeriodId:12},{id:4,employeeId:2,payPeriodId:12},{id:5,employeeId:3,payPeriodId:13},
    ],
    submissions:[{id:8,type:"FPS"},{id:9,type:"EPS"},{id:10,type:"CIS300"}],
  };
  const charges=[
    {id:1,chargeCode:"payroll-service",description:"Monthly payroll service",billingBasis:"fixed",unitRate:100,vatRate:20,status:"active"},
    {id:2,chargeCode:"payslip",description:"Payslip processing",billingBasis:"per-payslip",unitRate:2,vatRate:20,status:"active"},
    {id:3,chargeCode:"rti-submission",description:"RTI submission",billingBasis:"per-submission",unitRate:5,vatRate:20,status:"active"},
    {id:4,chargeCode:"expired",description:"Expired charge",billingBasis:"fixed",unitRate:999,vatRate:20,status:"active",effectiveTo:"2026-03-31"},
  ];
  const invoice=calculateAgentInvoice(charges,source,"2026-04-06","2026-06-30");
  assert.equal(invoice.payslipCount,5);
  assert.equal(invoice.payrollPeriodCount,3);
  assert.equal(invoice.employeeCount,3);
  assert.equal(invoice.lines.find(line=>line.chargeCode==="rti-submission").units,2);
  assert.equal(invoice.netAmount,120);
  assert.equal(invoice.vatAmount,24);
  assert.equal(invoice.grossAmount,144);
  const row={
    invoiceDate:"2026-07-01",periodStart:"2026-04-06",periodEnd:"2026-06-30",dueDate:"2026-07-15",
    status:"draft",issuedAt:null,voidedAt:null,voidReason:null,lineItems:JSON.stringify(invoice.lines),
    sourceEvidence:JSON.stringify({...source,periodStart:"2026-04-06",periodEnd:"2026-06-30",chargeLines:invoice.lines}),
    payslipCount:5,payrollPeriodCount:3,employeeCount:3,submissionCount:3,
    netAmount:120,vatAmount:24,grossAmount:144,
  };
  assert.equal(validateAgentInvoiceEvidence(row),null);
  assert.match(validateAgentInvoiceEvidence({...row,grossAmount:143}),/totals/);
  const mismatchedSource={...source,periodStart:"2026-04-06",periodEnd:"2026-06-30",chargeLines:invoice.lines.map((line,index)=>
    index===0?{...line,unitRate:101}:line)};
  assert.match(validateAgentInvoiceEvidence({...row,sourceEvidence:JSON.stringify(mismatchedSource)}),/charge lines/);
});

test("pay-frequency changes discard only draft evidence and block statutory history",()=>{
  const safe=assessPayFrequencyChange({
    sourceFrequency:"monthly",targetFrequency:"weekly",
    periods:[{id:1,status:"open",frequency:"monthly"}],
    runs:[{id:11,status:"draft"},{id:12,status:"draft"}],
    recurringScheduleCount:0,openingBalanceCount:0,adjustmentCount:1,finalisedLedgerCount:0,
    activeAttachments:[{id:5,calculationRule:"manual"}],
  });
  assert.equal(safe.allowed,true);
  assert.equal(safe.discardedDraftRuns,2);
  assert.equal(safe.discardedAdjustments,1);
  assert.equal(safe.updatedActiveAttachments,1);
  assert.equal(safe.confirmationPhrase,"CHANGE FREQUENCY TO WEEKLY");
  assert.equal(frequencyChangeConfirmation("four-weekly"),"CHANGE FREQUENCY TO EVERY 4 WEEKS");

  const blocked=assessPayFrequencyChange({
    sourceFrequency:"monthly",targetFrequency:"fortnightly",
    periods:[{id:1,status:"finalised",frequency:"monthly"}],
    runs:[{id:11,status:"finalised"}],
    recurringScheduleCount:1,openingBalanceCount:1,adjustmentCount:0,finalisedLedgerCount:1,
    activeAttachments:[{id:5,calculationRule:"scottish-earnings-arrestment"}],
  });
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.blockers.length,5);
  assert.match(blocked.blockers.join(" "),/Finalised or migrated/);
  assert.doesNotMatch(blocked.blockers.join(" "),/Scottish attachment/);
});
