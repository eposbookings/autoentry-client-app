import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  agentCharges, agentInvoices, agentProfiles, attachmentOrderDeductions, attachmentOrders, auditLog, cisPayments, departments, employeePortalInvites,
  employeeLoanDeductions, employeeLoans, employeePayRounding, employeePortalSessions, employeeChangeRequests, employees, employerCalendarDays, employerSettings,
  employers, expensesBenefits, hmrcNotices, hmrcPayments, leaveEvents, payrollOpeningBalances, payItems, payPeriods, payrollAdjustments,
  payRoundingEntries, payRuns, pensionMembershipEvents, pensionMemberships, pensionSchemes, recurringPayItems, statutoryNotices,
  holidayFundEntries, holidayFundSettings,
  subcontractors, submissions,
} from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { isRecognisedPayeTaxCode } from "../../../lib/tax-code";
import { hasValidFrozenRtiSnapshot } from "../../../lib/rti-snapshot";
import { hasValidFrozenPensionSnapshot } from "../../../lib/pension-snapshot";
import { validateCisPaymentEvidence } from "../../../lib/cis-payment-evidence";
import { validateStatutoryEventEvidence } from "../../../lib/statutory-event-evidence";
import { validateStatutoryNoticeEvidence } from "../../../lib/statutory-notice-evidence";
import { validateHmrcPaymentEvidence } from "../../../lib/hmrc-payment-evidence";
import { validatePayrollAdjustmentEvidence } from "../../../lib/payroll-adjustment-evidence";
import { statutoryPayAllocation } from "../../../lib/pay-periods";
import { validateAttachmentDeductionEvidence, validateAttachmentOrderEvidence } from "../../../lib/attachment-evidence";
import { attachmentPriority } from "../../../lib/attachment-engine";
import { validateBenefitEvidence } from "../../../lib/benefit-evidence";
import { validateRecurringOccurrenceEvidence, validateRecurringPayEvidence } from "../../../lib/recurring-pay-evidence";
import { validateEmployeeChangeEvidence } from "../../../lib/employee-change-evidence";
import { validateHmrcNoticeEvidence } from "../../../lib/hmrc-notice-evidence";
import { hmrcNoticeInstructionKey } from "../../../lib/hmrc-notice-order";
import { pensionRunMatchesSnapshot, validatePayItemEvidence, validatePayRunAccountingEvidence } from "../../../lib/pay-run-evidence";
import { parseFrozenPensionSnapshot } from "../../../lib/pension-snapshot";
import { employeeActiveInRange } from "../../../lib/pay-periods";
import { validatePensionMembershipEventEvidence, validatePensionMembershipEvidence, validatePensionSchemeEvidence } from "../../../lib/pension-state-evidence";
import { validatePensionDeclarationEvidence } from "../../../lib/pension-declaration-evidence";
import { validateEmployeeStateEvidence } from "../../../lib/employee-state-evidence";
import { validateEmployerSettingsEvidence, validateEmployerStateEvidence, validateSubcontractorStateEvidence } from "../../../lib/employer-cis-state-evidence";
import { payrollFrequencyRule, scheduledPayPeriods, taxMonthForDate } from "../../../lib/pay-frequency";
import { nextTaxYear } from "../../../lib/benefit-copy";
import { validateAgentInvoiceEvidence } from "../../../lib/agent-billing";
import { parseStoredEmailTemplate } from "../../../lib/email-template";
import { holidayFundEntryEvidence, validateHolidayFundEntryEvidence } from "../../../lib/holiday-fund";

const backupTables=[
  "employers","departments","employerSettings","employerCalendarDays","employees","payrollOpeningBalances","payPeriods","payRuns","payItems","recurringPayItems",
  "payrollAdjustments","leaveEvents","statutoryNotices","hmrcNotices","hmrcPayments","pensionSchemes",
  "pensionMemberships","pensionMembershipEvents","subcontractors","cisPayments","submissions","expensesBenefits",
  "agentProfiles","agentCharges","agentInvoices",
  "attachmentOrders","attachmentOrderDeductions","employeeLoans","employeeLoanDeductions","employeePayRounding","payRoundingEntries",
  "holidayFundSettings","holidayFundEntries","employeeChangeRequests","auditLog",
] as const;
const schema6BackupTables=backupTables.filter(table=>!["holidayFundSettings","holidayFundEntries"].includes(table));
const schema5BackupTables=schema6BackupTables.filter(table=>!["agentProfiles","agentCharges","agentInvoices"].includes(table));
const validTaxYear=(value:unknown)=>/^\d{4}\/\d{2}$/.test(String(value||""))&&Number(String(value).slice(5))===(Number(String(value).slice(0,4))+1)%100;
const validIsoDate=(value:unknown)=>{
  const text=String(value||""),parsed=Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===text;
};
const dateInTaxYear=(date:string,taxYear:string)=>{
  if(!validIsoDate(date)||!validTaxYear(taxYear))return false;
  const startYear=Number(taxYear.slice(0,4));
  return date>=`${startYear}-04-06`&&date<=`${startYear+1}-04-05`;
};
const duplicateKey=(rows:any[],key:(row:any)=>string)=>rows.find((row,index)=>rows.findIndex(candidate=>key(candidate)===key(row))!==index);
const importedBoolean=(value:unknown)=>value===true||["1","true","yes","y"].includes(String(value??"").trim().toLowerCase());
const moneyEqualForRestore=(left:unknown,right:unknown)=>Math.abs(Number(left)-Number(right))<.005;

async function validateBackup(backup:any,employerId:number){
  const checksum=String(backup?.checksum?.value||""),unsigned=backup&&typeof backup==="object"
    ?Object.fromEntries(Object.entries(backup).filter(([key])=>key!=="checksum")):null;
  if(!unsigned||![5,6,7].includes(backup.schemaVersion)||backup.employerId!==employerId||!/^[a-f0-9]{64}$/.test(checksum))
    return {ok:false as const,error:"This is not a compatible backup for the selected employer."};
  const actual=await sha256(JSON.stringify(unsigned)),counts={...(backup.counts||{})},dataset=backup.dataset||{};
  const tableList:readonly (typeof backupTables[number])[]=backup.schemaVersion===5?schema5BackupTables:backup.schemaVersion===6?schema6BackupTables:backupTables;
  const missing=tableList.find(table=>!Array.isArray(dataset[table])||!Number.isInteger(counts[table])||dataset[table].length!==counts[table]);
  const unknown=Object.keys(dataset).find(table=>!tableList.includes(table as any));
  const total=tableList.reduce<number>((sum,table)=>sum+(Number(counts[table])||0),0);
  if(actual!==checksum||missing||unknown||total>100000)
    return {ok:false as const,error:"Backup verification failed. The file is incomplete, unsupported or has been changed.",table:missing||unknown};
  if(backup.schemaVersion===5)for(const table of ["agentProfiles","agentCharges","agentInvoices"]){
    dataset[table]=[];counts[table]=0;
  }
  if(backup.schemaVersion<=6)for(const table of ["holidayFundSettings","holidayFundEntries"]){
    dataset[table]=[];counts[table]=0;
  }
  if(dataset.employers.length!==1||dataset.employers[0]?.id!==employerId)
    return {ok:false as const,error:"The backup employer record does not match the selected employer."};
  if(validateEmployerStateEvidence(dataset.employers[0]))
    return {ok:false as const,error:"Backup employer-state validation failed. Registration or payroll defaults are invalid.",table:"employers"};
  if(dataset.employerSettings.length>1)
    return {ok:false as const,error:"Backup relationship validation failed. Only one employer settings record is permitted.",table:"employerSettings"};
  if(dataset.employerSettings.some((row:any)=>validateEmployerSettingsEvidence(row)))
    return {ok:false as const,error:"Backup employer defaults are invalid or unsupported.",table:"employerSettings"};
  let restoredFrequency:ReturnType<typeof payrollFrequencyRule>["frequency"];
  let restoredSchedule:ReturnType<typeof scheduledPayPeriods>;
  try{
    const employer=dataset.employers[0],settings=dataset.employerSettings[0];
    restoredFrequency=payrollFrequencyRule(employer.payFrequency).frequency;
    restoredSchedule=scheduledPayPeriods(employer.taxYear,restoredFrequency,settings?.firstPayDate||undefined);
  }catch{
    return {ok:false as const,error:"Backup payroll schedule validation failed. The frequency or first pay date is invalid.",table:"employerSettings"};
  }
  const maximumPeriods=payrollFrequencyRule(restoredFrequency).maximumPeriods;
  const invalidIdentity=backupTables.find(table=>{
    const values=dataset[table].map((row:any)=>table==="employerSettings"?row?.employerId:row?.id);
    return values.some((id:any)=>!Number.isInteger(id)||id<=0)||new Set(values).size!==values.length;
  });
  if(invalidIdentity)
    return {ok:false as const,error:"Backup identity validation failed. Every record must have a unique positive integer ID.",table:invalidIdentity};
  const ids=(table:string)=>new Set(dataset[table].map((row:any)=>row.id));
  const employeeIds=ids("employees"),periodIds=ids("payPeriods"),runIds=ids("payRuns"),schemeIds=ids("pensionSchemes");
  const membershipIds=ids("pensionMemberships"),subcontractorIds=ids("subcontractors"),orderIds=ids("attachmentOrders"),loanIds=ids("employeeLoans"),roundingIds=ids("employeePayRounding");
  const holidayFundSettingIds=ids("holidayFundSettings");
  const byId=(table:string):Map<number,any>=>new Map<number,any>(dataset[table].map((row:any)=>[row.id,row]));
  const runById=byId("payRuns"),recurringById=byId("recurringPayItems"),leaveById=byId("leaveEvents"),employeeByIdForRuns=byId("employees");
  const membershipById=byId("pensionMemberships"),orderById=byId("attachmentOrders"),loanById=byId("employeeLoans"),roundingById=byId("employeePayRounding");
  const holidayFundSettingById=byId("holidayFundSettings"),periodById=byId("payPeriods");
  const invalidDirect=[
    ...["departments","employerCalendarDays","employees","payrollOpeningBalances","payPeriods","recurringPayItems","payrollAdjustments","hmrcNotices","hmrcPayments","pensionSchemes","pensionMembershipEvents","subcontractors","submissions","agentProfiles","agentCharges","agentInvoices","employeeLoans","employeePayRounding","holidayFundSettings","holidayFundEntries","auditLog"]
      .flatMap(table=>dataset[table].filter((row:any)=>row.employerId!==employerId).map(()=>`${table}.employerId`)),
    ...dataset.employerSettings.filter((row:any)=>row.employerId!==employerId).map(()=>`employerSettings.employerId`),
  ];
  const invalidRelations=[
    ...dataset.employees.filter((row:any)=>row.departmentId&&!ids("departments").has(row.departmentId)).map(()=>`employees.departmentId`),
    ...dataset.payrollOpeningBalances.filter((row:any)=>!employeeIds.has(row.employeeId)).map(()=>`payrollOpeningBalances.employeeId`),
    ...dataset.payRuns.filter((row:any)=>!periodIds.has(row.payPeriodId)||!employeeIds.has(row.employeeId)||(row.pensionSchemeId&&!schemeIds.has(row.pensionSchemeId))).map(()=>`payRuns`),
    ...dataset.payItems.filter((row:any)=>{
      const run=runById.get(row.payRunId),recurring=row.recurringItemId?recurringById.get(row.recurringItemId):null;
      return !run||(row.recurringItemId&&!recurring)||Boolean(recurring&&recurring.employeeId!==run.employeeId);
    }).map(()=>`payItems`),
    ...dataset.recurringPayItems.filter((row:any)=>!employeeIds.has(row.employeeId)).map(()=>`recurringPayItems.employeeId`),
    ...dataset.payrollAdjustments.filter((row:any)=>!employeeIds.has(row.employeeId)||!periodIds.has(row.payPeriodId)).map(()=>`payrollAdjustments`),
    ...dataset.leaveEvents.filter((row:any)=>!employeeIds.has(row.employeeId)).map(()=>`leaveEvents.employeeId`),
    ...dataset.statutoryNotices.filter((row:any)=>{
      const leave=row.leaveEventId?leaveById.get(row.leaveEventId):null;
      return !employeeIds.has(row.employeeId)||(row.leaveEventId&&!leave)||Boolean(leave&&leave.employeeId!==row.employeeId);
    }).map(()=>`statutoryNotices`),
    ...dataset.hmrcNotices.filter((row:any)=>row.employeeId&&!employeeIds.has(row.employeeId)).map(()=>`hmrcNotices.employeeId`),
    ...dataset.pensionMemberships.filter((row:any)=>!employeeIds.has(row.employeeId)||!schemeIds.has(row.schemeId)).map(()=>`pensionMemberships`),
    ...dataset.pensionMembershipEvents.filter((row:any)=>{
      const membership=membershipById.get(row.membershipId);
      return !employeeIds.has(row.employeeId)||!schemeIds.has(row.schemeId)||!membershipIds.has(row.membershipId)||
        Boolean(membership&&(membership.employeeId!==row.employeeId||membership.schemeId!==row.schemeId));
    }).map(()=>`pensionMembershipEvents`),
    ...dataset.cisPayments.filter((row:any)=>!subcontractorIds.has(row.subcontractorId)).map(()=>`cisPayments.subcontractorId`),
    ...dataset.submissions.filter((row:any)=>row.payPeriodId&&!periodIds.has(row.payPeriodId)).map(()=>`submissions.payPeriodId`),
    ...dataset.agentInvoices.filter((row:any)=>{
      try{
        const source=JSON.parse(String(row.sourceEvidence||"{}"));
        const submissionById=byId("submissions");
        return source.periodIds.some((id:number)=>!periodIds.has(id))||source.payRuns.some((run:any)=>{
          const recorded=runById.get(run.id);
          return !recorded||recorded.employeeId!==run.employeeId||recorded.payPeriodId!==run.payPeriodId;
        })||source.submissions.some((submission:any)=>{
          const recorded=submissionById.get(submission.id);
          return !recorded||recorded.type!==submission.type;
        });
      }catch{return true;}
    }).map(()=>`agentInvoices.sourceEvidence`),
    ...dataset.expensesBenefits.filter((row:any)=>!employeeIds.has(row.employeeId)).map(()=>`expensesBenefits.employeeId`),
    ...dataset.attachmentOrders.filter((row:any)=>!employeeIds.has(row.employeeId)||row.payFrequency!==dataset.employers[0].payFrequency).map(()=>`attachmentOrders.employeeIdOrFrequency`),
    ...dataset.attachmentOrderDeductions.filter((row:any)=>{
      const order=orderById.get(row.attachmentOrderId),run=runById.get(row.payRunId);
      return !orderIds.has(row.attachmentOrderId)||!runIds.has(row.payRunId)||Boolean(order&&run&&order.employeeId!==run.employeeId);
    }).map(()=>`attachmentOrderDeductions`),
    ...dataset.employeeLoans.filter((row:any)=>!employeeIds.has(row.employeeId)||!["loan","advance","overpayment"].includes(row.type)||![row.originalAmount,row.balance,row.regularDeduction].every((value:any)=>Number.isFinite(value)&&value>=0)).map(()=>`employeeLoans`),
    ...dataset.employeeLoanDeductions.filter((row:any)=>{
      const loan=loanById.get(row.employeeLoanId),run=runById.get(row.payRunId);
      return !loanIds.has(row.employeeLoanId)||!runIds.has(row.payRunId)||Boolean(loan&&run&&loan.employeeId!==run.employeeId)||
        ![row.amount,row.balanceBefore,row.balanceAfter].every((value:any)=>Number.isFinite(value)&&value>=0)||!moneyEqualForRestore(row.balanceBefore-row.amount,row.balanceAfter);
    }).map(()=>`employeeLoanDeductions`),
    ...dataset.employeePayRounding.filter((row:any)=>!employeeIds.has(row.employeeId)||![1,5,10].includes(Number(row.unit))||
      !Number.isFinite(row.carry)||row.carry<0||row.carry>=row.unit+.005||!["active","suspended","stopped"].includes(row.status)).map(()=>`employeePayRounding`),
    ...dataset.payRoundingEntries.filter((row:any)=>{
      const setting=roundingById.get(row.employeePayRoundingId),run=runById.get(row.payRunId);
      return !roundingIds.has(row.employeePayRoundingId)||!runIds.has(row.payRunId)||Boolean(setting&&run&&setting.employeeId!==run.employeeId)||
        ![row.unroundedNet,row.openingCarry,row.roundedNet,row.closingCarry,row.adjustment].every((value:any)=>Number.isFinite(value))||
        [row.unroundedNet,row.openingCarry,row.roundedNet,row.closingCarry].some((value:any)=>value<0)||
        Boolean(setting&&(row.openingCarry>=setting.unit+.005||row.closingCarry>=setting.unit+.005))||
        !moneyEqualForRestore(row.unroundedNet+row.openingCarry,row.roundedNet+row.closingCarry)||
        !moneyEqualForRestore(row.roundedNet-row.unroundedNet,row.adjustment)||!moneyEqualForRestore(run?.netPay,row.roundedNet);
    }).map(()=>`payRoundingEntries`),
    ...dataset.holidayFundSettings.filter((row:any)=>!employeeIds.has(row.employeeId)||
      !["employer-accrual","employee-savings","rolled-up"].includes(row.schemeType)||
      !["regular-hours","irregular-hours","part-year"].includes(row.workerType)||
      !["active","suspended"].includes(row.status)||![row.accrualRate,row.openingBalance,row.currentBalance].every((value:any)=>Number.isFinite(value)&&value>=0)||
      row.accrualRate>100||!validIsoDate(row.startDate)||
      (row.schemeType==="rolled-up"&&(!["irregular-hours","part-year"].includes(row.workerType)||row.contractConfirmed!==true||!moneyEqualForRestore(row.openingBalance,0)||!moneyEqualForRestore(row.currentBalance,0)))
    ).map(()=>`holidayFundSettings`),
    ...dataset.holidayFundEntries.filter((row:any)=>{
      const setting=holidayFundSettingById.get(row.holidayFundSettingId),run=runById.get(row.payRunId),period=periodById.get(row.payPeriodId);
      if(!holidayFundSettingIds.has(row.holidayFundSettingId)||!employeeIds.has(row.employeeId)||!periodIds.has(row.payPeriodId)||
        !setting||setting.employeeId!==row.employeeId||setting.employerId!==employerId||
        row.schemeType!==setting.schemeType||row.workerType!==setting.workerType||row.contractConfirmed!==setting.contractConfirmed||
        !moneyEqualForRestore(row.accrualRate,setting.accrualRate)||
        !validTaxYear(row.taxYear)||!Number.isInteger(row.periodNumber)||row.periodNumber<1||
        !period||period.taxYear!==row.taxYear||period.periodNumber!==row.periodNumber||
        ![row.manualAdded,row.requestedPaid,row.referencePayOverride??0].every((value:any)=>Number.isFinite(value)&&value>=0))return true;
      if(row.status==="draft"&&!row.payRunId)
        return row.sourceChecksum!==null||![row.accrualBase,row.addedAmount,row.paidAmount,row.taxablePay,row.nicablePay,row.postTaxDeduction].every((value:any)=>moneyEqualForRestore(value,0))||
          !moneyEqualForRestore(row.balanceBefore,setting.currentBalance)||!moneyEqualForRestore(row.balanceAfter,setting.currentBalance);
      if(!runIds.has(row.payRunId)||!run||run.employeeId!==row.employeeId||run.payPeriodId!==row.payPeriodId||
        run.status!==row.status||validateHolidayFundEntryEvidence(row))return true;
      return !row.sourceChecksum;
    }).map(()=>`holidayFundEntries`),
    ...dataset.employeeChangeRequests.filter((row:any)=>row.employerId!==employerId||!employeeIds.has(row.employeeId)).map(()=>`employeeChangeRequests`),
    ...dataset.employees.filter((row:any)=>row.reportedPayFrequency!==restoredFrequency).map(()=>`employees.reportedPayFrequency`),
  ];
  if(invalidDirect.length||invalidRelations.length)
    return {ok:false as const,error:"Backup relationship validation failed. The file contains records outside the selected employer.",table:invalidDirect[0]||invalidRelations[0]};
  const invalidPeriod=dataset.payPeriods.find((row:any)=>{
    const scheduled=row.taxYear===dataset.employers[0].taxYear
      ?restoredSchedule.find(period=>period.periodNumber===row.periodNumber):null;
    return !validTaxYear(row.taxYear)||!Number.isInteger(row.periodNumber)||row.periodNumber<1||row.periodNumber>maximumPeriods||
      row.frequency!==restoredFrequency||!validIsoDate(row.payDate)||!validIsoDate(row.periodStart)||!validIsoDate(row.periodEnd)||
      row.periodStart>row.periodEnd||row.payDate<row.periodStart||row.payDate>row.periodEnd||!["future","open","draft","migrated","finalised"].includes(row.status)||
      row.taxYear===dataset.employers[0].taxYear&&(
        !scheduled||row.periodStart!==scheduled.periodStart||row.periodEnd!==scheduled.periodEnd||
        restoredFrequency!=="monthly"&&row.payDate!==scheduled.payDate
      );
  });
  const duplicatePeriod=duplicateKey(dataset.payPeriods,(row:any)=>`${row.taxYear}:${row.periodNumber}`);
  const invalidCalendarDay=dataset.employerCalendarDays.find((row:any)=>!validTaxYear(row.taxYear)||!validIsoDate(row.date)||
    !dateInTaxYear(row.date,row.taxYear)||typeof row.name!=="string"||row.name.trim().length<2||row.name.trim().length>100||
    !["national-holiday","company-closure"].includes(row.type)||!["active","cancelled"].includes(row.status));
  const duplicateCalendarDay=duplicateKey(dataset.employerCalendarDays,(row:any)=>`${row.date}:${row.type}`);
  const calendarDates=new Set(dataset.employerCalendarDays.map((row:any)=>row.date));
  const invalidLeaveCalendarEvidence=dataset.leaveEvents.find((row:any)=>{
    let dates:unknown;
    try{dates=JSON.parse(String(row.excludedCalendarDates||"[]"));}catch{return true;}
    return !Array.isArray(dates)||new Set(dates).size!==dates.length||dates.some(date=>
      !validIsoDate(date)||String(date)<String(row.startDate)||String(date)>String(row.endDate)||!calendarDates.has(String(date)),
    );
  });
  const openingMoneyFields=["grossPay","taxablePay","payeTax","nicablePay","earningsAtLel","earningsLelToPt","earningsPtToUel","earningsAboveUel","employeeNic","employerNic","studentLoan","postgraduateLoan","statutoryPay","employeePension","employerPension","netPay"];
  const openingNicFields=["nicablePay","earningsAtLel","earningsLelToPt","earningsPtToUel","earningsAboveUel","employeeNic","employerNic"];
  const supportedNiCategories=new Set(["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"]);
  const parsedOpeningNic=(row:any)=>{try{const parsed=JSON.parse(row.nicCategoryBreakdown||"[]");return Array.isArray(parsed)?parsed:null;}catch{return null;}};
  const invalidOpening=dataset.payrollOpeningBalances.find((row:any)=>
    !validTaxYear(row.taxYear)||!Number.isInteger(row.firstPayFlowPeriod)||row.firstPayFlowPeriod<2||
    row.firstPayFlowPeriod>(row.taxYear===dataset.employers[0].taxYear?restoredSchedule.length:maximumPeriods)||
    !["prior-payroll-p11","prior-provider-export","accountant-confirmation"].includes(row.source)||
    openingMoneyFields.some(field=>!Number.isFinite(row[field])||row[field]<0)||
    row.taxablePay>row.grossPay+.005||row.nicablePay>row.grossPay+.005||
    row.earningsAtLel+row.earningsLelToPt+row.earningsPtToUel+row.earningsAboveUel>row.nicablePay+.005||
    typeof row.payloadChecksum!=="string"||!/^[a-f0-9]{64}$/.test(row.payloadChecksum)
  );
  const invalidOpeningNic=dataset.payrollOpeningBalances.find((row:any)=>{
    const lines=parsedOpeningNic(row);
    if(!lines)return true;
    if(!lines.length)return false;
    if(new Set(lines.map((line:any)=>line?.niCategory)).size!==lines.length)return true;
    if(lines.some((line:any)=>!line||typeof line!=="object"||Array.isArray(line)||!supportedNiCategories.has(String(line.niCategory||""))||
      openingNicFields.some(field=>!Number.isFinite(line[field])||line[field]<0)||
      line.earningsAtLel+line.earningsLelToPt+line.earningsPtToUel+line.earningsAboveUel>line.nicablePay+.005))return true;
    return openingNicFields.some(field=>!moneyEqualForRestore(lines.reduce((sum:number,line:any)=>sum+line[field],0),row[field]));
  });
  const duplicateOpening=duplicateKey(dataset.payrollOpeningBalances,(row:any)=>`${row.employeeId}:${row.taxYear}`);
  const inconsistentOpeningBoundary=dataset.payrollOpeningBalances.find((row:any)=>
    dataset.payrollOpeningBalances.some((other:any)=>other.taxYear===row.taxYear&&other.firstPayFlowPeriod!==row.firstPayFlowPeriod)
  );
  const invalidOpeningPeriods=dataset.payrollOpeningBalances.find((row:any)=>
    Array.from({length:row.firstPayFlowPeriod-1},(_,index)=>index+1).some(periodNumber=>
      dataset.payPeriods.find((period:any)=>period.taxYear===row.taxYear&&period.periodNumber===periodNumber)?.status!=="migrated"
    )
  );
  if(invalidOpening||invalidOpeningNic||duplicateOpening||inconsistentOpeningBoundary||invalidOpeningPeriods)
    return {ok:false as const,error:"Backup mid-year opening-balance evidence is invalid, duplicated or inconsistent with migrated payroll periods.",table:"payrollOpeningBalances"};
  for(const row of dataset.payrollOpeningBalances){
    const values=Object.fromEntries(openingMoneyFields.map(field=>[field,row[field]]));
    const nicCategoryBreakdown=parsedOpeningNic(row)||[];
    const evidence=nicCategoryBreakdown.length
      ?{employerId:row.employerId,employeeId:row.employeeId,taxYear:row.taxYear,firstPayFlowPeriod:row.firstPayFlowPeriod,...values,nicCategoryBreakdown,source:row.source,notes:row.notes||null}
      :{employerId:row.employerId,employeeId:row.employeeId,taxYear:row.taxYear,firstPayFlowPeriod:row.firstPayFlowPeriod,...values,source:row.source,notes:row.notes||null};
    if(await sha256(JSON.stringify(evidence))!==row.payloadChecksum)
      return {ok:false as const,error:"Backup mid-year opening-balance checksum validation failed.",table:"payrollOpeningBalances"};
  }
  const invalidEmployee=dataset.employees.find((row:any)=>validateEmployeeStateEvidence(row,dataset.employers[0].taxYear));
  const duplicatePayrollId=duplicateKey(dataset.employees,(row:any)=>String(row.payrollId||"").trim().toUpperCase());
  const invalidRun=dataset.payRuns.find((row:any)=>{
    const period=byId("payPeriods").get(row.payPeriodId) as any;
    return !["draft","finalised"].includes(row.status)||row.status==="finalised"&&(period?.status!=="finalised"||!hasValidFrozenRtiSnapshot(row.rtiSnapshot)||
      Boolean(row.pensionSchemeId)&&!hasValidFrozenPensionSnapshot(row.pensionSnapshot))||
      ["grossPay","taxablePay","nicablePay","payeTax","employeeNic","employerNic","netPay"].some(field=>!Number.isFinite(row[field]));
  });
  const invalidPayItem=dataset.payItems.find((row:any)=>validatePayItemEvidence(row));
  const invalidRunLifecycle=dataset.payRuns.find((row:any)=>{
    const period=byId("payPeriods").get(row.payPeriodId) as any;
    return period?.status==="finalised"?row.status!=="finalised":row.status!=="draft";
  });
  const invalidRunAccounting=dataset.payRuns.find((row:any)=>{
    const items=dataset.payItems.filter((item:any)=>item.payRunId===row.id);
    const adjustmentTotal=dataset.payrollAdjustments.filter((item:any)=>
      item.payPeriodId===row.payPeriodId&&item.employeeId===row.employeeId&&item.type==="net-pay"&&item.status==="active",
    ).reduce((sum:number,item:any)=>sum+Number(item.amount),0);
    const roundingAdjustment=dataset.payRoundingEntries.filter((item:any)=>item.payRunId===row.id)
      .reduce((sum:number,item:any)=>sum+Number(item.adjustment),0);
    const netAdjustment=adjustmentTotal+roundingAdjustment;
    if(validatePayRunAccountingEvidence(row,items,netAdjustment))return true;
    if(row.status==="finalised"&&row.pensionSchemeId){
      try{return !pensionRunMatchesSnapshot(row,parseFrozenPensionSnapshot(row.pensionSnapshot));}
      catch{return true;}
    }
    return false;
  });
  const invalidFinalisedPopulation=dataset.payPeriods.filter((period:any)=>period.status==="finalised").find((period:any)=>{
    const runs=dataset.payRuns.filter((run:any)=>run.payPeriodId===period.id);
    const runEmployeeIds=new Set(runs.map((run:any)=>run.employeeId));
    const missing=dataset.employees.some((employee:any)=>
      employeeActiveInRange(employee.startDate,employee.leavingDate,period.periodStart,period.periodEnd)&&!runEmployeeIds.has(employee.id));
    const extraneous=runs.some((run:any)=>{
      const employee=employeeByIdForRuns.get(run.employeeId);
      if(employeeActiveInRange(employee?.startDate,employee?.leavingDate,period.periodStart,period.periodEnd))return false;
      try{return !Boolean(JSON.parse(String(run.rtiSnapshot||"{}")).paymentAfterLeaving);}
      catch{return true;}
    });
    return missing||extraneous;
  });
  const invalidPensionScheme=dataset.pensionSchemes.find((row:any)=>validatePensionSchemeEvidence(row));
  const invalidPensionMembership=dataset.pensionMemberships.find((row:any)=>validatePensionMembershipEvidence(row));
  const duplicatePensionMembership=duplicateKey(dataset.pensionMemberships,(row:any)=>`${row.schemeId}:${row.employeeId}`);
  const invalidPensionEvent=dataset.pensionMembershipEvents.find((row:any)=>validatePensionMembershipEventEvidence(row));
  const invalidPensionEventState=dataset.pensionMemberships.find((membership:any)=>{
    if(membership.membershipStatus==="transferred")return false;
    const latest=dataset.pensionMembershipEvents.filter((event:any)=>event.membershipId===membership.id).sort((a:any,b:any)=>a.id-b.id).at(-1);
    return Boolean(latest)&&latest.newStatus!==membership.membershipStatus;
  });
  const invalidPensionRefund=dataset.pensionMemberships.find((membership:any)=>{
    if(Number(membership.employeeRefundDue)<=0&&Number(membership.employerRefundDue)<=0)return false;
    if(!membership.optOutNoticeDate||!membership.enrolmentDate)return true;
    const windowStart=[membership.enrolmentDate,membership.enrolmentInformationDate].filter(Boolean).sort().at(-1);
    const refundable=dataset.payRuns.filter((run:any)=>{
      if(run.employeeId!==membership.employeeId||run.status!=="finalised"||run.pensionSchemeId!==membership.schemeId)return false;
      const period=byId("payPeriods").get(run.payPeriodId) as any;
      return period?.payDate&&period.payDate>=windowStart&&period.payDate<=membership.optOutNoticeDate;
    });
    const employeeDue=refundable.reduce((sum:number,run:any)=>sum+Math.max(0,Number(run.employeePension)),0);
    const employerDue=refundable.reduce((sum:number,run:any)=>sum+Math.max(0,Number(run.employerPension)),0);
    return !moneyEqualForRestore(employeeDue,membership.employeeRefundDue)||!moneyEqualForRestore(employerDue,membership.employerRefundDue);
  });
  const duplicateRun=duplicateKey(dataset.payRuns,(row:any)=>`${row.payPeriodId}:${row.employeeId}`);
  const invalidCisPayment=dataset.cisPayments.find((row:any)=>validateCisPaymentEvidence(row));
  const invalidSubcontractor=dataset.subcontractors.find((row:any)=>validateSubcontractorStateEvidence(row));
  const duplicateSubcontractorUtr=duplicateKey(dataset.subcontractors,(row:any)=>String(row.utr||"").replace(/\s/g,""));
  const invalidLeaveEvent=dataset.leaveEvents.find((row:any)=>validateStatutoryEventEvidence(row,Boolean(dataset.employers[0]?.smallEmployersRelief)));
  const invalidHmrcPayment=dataset.hmrcPayments.find((row:any)=>{
    const periods=dataset.payPeriods.filter((period:any)=>{
      if(period.taxYear!==row.taxYear)return false;
      try{return taxMonthForDate(period.taxYear,period.payDate)===row.taxMonth;}catch{return false;}
    });
    return validateHmrcPaymentEvidence(row,backup.exportedAt)||!periods.length||
      periods.some((period:any)=>!["finalised","migrated"].includes(period.status));
  });
  const duplicateHmrcReference=duplicateKey(dataset.hmrcPayments,(row:any)=>String(row.reference||"").trim().toUpperCase());
  const acceptedRtiPeriodIds=new Set(dataset.submissions.filter((row:any)=>
    ["FPS","Additional FPS"].includes(row.type)&&row.status==="accepted"&&row.payPeriodId,
  ).map((row:any)=>row.payPeriodId));
  const adjustmentMatches=(recorded:any,row:any)=>
    recorded?.id===row.id&&recorded?.employerId===row.employerId&&recorded?.employeeId===row.employeeId&&
    recorded?.payPeriodId===row.payPeriodId&&recorded?.type===row.type&&moneyEqualForRestore(recorded?.amount,row.amount)&&
    recorded?.reason===row.reason;
  const runFinancialFields=["grossPay","taxablePay","nicablePay","payeTax","employeeNic","employerNic","studentLoan","postgraduateLoan","statutoryPay","netPay"];
  const runStateMatches=(left:any,right:any)=>Boolean(left&&right)&&left.id===right.id&&
    left.payPeriodId===right.payPeriodId&&left.employeeId===right.employeeId&&
    runFinancialFields.every(field=>moneyEqualForRestore(left[field],right[field]));
  const invalidPayrollAdjustment=dataset.payrollAdjustments.find((row:any)=>{
    const period=byId("payPeriods").get(row.payPeriodId) as any;
    const creationAudit=dataset.auditLog.find((entry:any)=>
      entry.entityType==="payroll-adjustment"&&entry.entityId===String(row.id)&&entry.action==="created",
    );
    let includedInOriginalFinalisation=false;
    if(creationAudit)try{
      const recorded=JSON.parse(String(creationAudit.after||"{}"));
      includedInOriginalFinalisation=recorded.payRun===null&&adjustmentMatches(recorded.adjustment,row);
    }catch{}
    let finalisedCorrectionFullyReversed=false;
    if(row.status==="reversed"){
      const finalisedCreation=dataset.auditLog.find((entry:any)=>
        entry.entityType==="payroll-adjustment"&&entry.entityId===String(row.id)&&entry.action==="created:finalised-rti-correction",
      );
      const reversal=dataset.auditLog.find((entry:any)=>
        entry.entityType==="payroll-adjustment"&&entry.entityId===String(row.id)&&entry.action==="reversed:finalised-rti-correction",
      );
      const currentRun=dataset.payRuns.find((candidate:any)=>candidate.payPeriodId===row.payPeriodId&&candidate.employeeId===row.employeeId);
      if(finalisedCreation&&reversal&&currentRun)try{
        const creationBefore=JSON.parse(String(finalisedCreation.before||"{}"));
        const creationAfter=JSON.parse(String(finalisedCreation.after||"{}"));
        const reversalBefore=JSON.parse(String(reversal.before||"{}"));
        const reversalAfter=JSON.parse(String(reversal.after||"{}"));
        finalisedCorrectionFullyReversed=adjustmentMatches(creationAfter.adjustment,row)&&
          adjustmentMatches(reversalAfter.adjustment,row)&&runStateMatches(creationAfter.payRun,reversalBefore.payRun)&&
          runStateMatches(creationBefore,reversalAfter.payRun)&&runStateMatches(reversalAfter.payRun,currentRun);
      }catch{}
    }
    return validatePayrollAdjustmentEvidence(row,period?.status,acceptedRtiPeriodIds.has(row.payPeriodId)||
      includedInOriginalFinalisation||finalisedCorrectionFullyReversed);
  });
  const duplicateActiveAdjustment=duplicateKey(dataset.payrollAdjustments.filter((row:any)=>row.status==="active"),(row:any)=>
    `${row.employeeId}:${row.payPeriodId}:${row.type}:${row.amount}:${String(row.reason||"").trim()}`,
  );
  const invalidRecoveryBalance=Array.from({length:12},(_,index)=>index+1).find(taxMonth=>{
    const monthPeriods=dataset.payPeriods.filter((period:any)=>{
      if(period.status!=="finalised")return false;
      try{return taxMonthForDate(period.taxYear,period.payDate)===taxMonth;}catch{return false;}
    });
    if(!monthPeriods.length)return false;
    const monthPeriodIds=new Set(monthPeriods.map((period:any)=>period.id));
    const allocated=dataset.leaveEvents.filter((event:any)=>event.status==="calculated")
      .reduce((sum:number,event:any)=>sum+statutoryPayAllocation(event,taxMonth,monthPeriods[0].taxYear).recovery,0);
    const corrections=dataset.payrollAdjustments.filter((row:any)=>monthPeriodIds.has(row.payPeriodId)&&row.type==="statutory-recovery"&&row.status==="active")
      .reduce((sum:number,row:any)=>sum+Number(row.amount),0);
    return allocated+corrections<-.005;
  });
  const invalidAttachmentOrder=dataset.attachmentOrders.find((row:any)=>validateAttachmentOrderEvidence(row));
  const duplicateActiveOrder=duplicateKey(dataset.attachmentOrders.filter((row:any)=>row.status==="active"),(row:any)=>
    `${row.employeeId}:${String(row.reference||"").trim().toUpperCase()}`,
  );
  let invalidAttachmentDeduction:any=null;
  for(const run of dataset.payRuns){
    const rows=dataset.attachmentOrderDeductions.filter((row:any)=>row.payRunId===run.id);
    if(!rows.length)continue;
    if(run.status!=="finalised"){invalidAttachmentDeduction=rows[0];break;}
    rows.sort((left:any,right:any)=>{
      const leftOrder=orderById.get(left.attachmentOrderId),rightOrder=orderById.get(right.attachmentOrderId);
      return attachmentPriority(leftOrder?.type,leftOrder?.priority)-attachmentPriority(rightOrder?.type,rightOrder?.priority)||left.attachmentOrderId-right.attachmentOrderId;
    });
    let existingDeductions=0;
    for(const row of rows){
      const order=orderById.get(row.attachmentOrderId);
      const error=validateAttachmentDeductionEvidence(order,row,existingDeductions);
      if(error){invalidAttachmentDeduction=row;break;}
      existingDeductions+=Number(row.deduction)+Number(row.adminFee);
    }
    if(invalidAttachmentDeduction||existingDeductions>Number(rows[0].attachableNetPay)+.005||
      existingDeductions>Number(run.otherDeductions)+.005){invalidAttachmentDeduction=invalidAttachmentDeduction||rows[0];break;}
  }
  const duplicateAttachmentDeduction=duplicateKey(dataset.attachmentOrderDeductions,(row:any)=>`${row.attachmentOrderId}:${row.payRunId}`);
  const invalidAttachmentCurrentBalance=dataset.attachmentOrders.find((order:any)=>{
    const history=dataset.attachmentOrderDeductions.filter((row:any)=>row.attachmentOrderId===order.id)
      .sort((left:any,right:any)=>left.id-right.id);
    const latest=history.at(-1);
    const latestOrdinaryBalance=latest?.ordinaryBalanceAfter??null,orderOrdinaryBalance=order.ordinaryDebtBalance??null;
    return Boolean(latest)&&((latest.balanceAfter===null)!==(order.balance===null)||
      latest.balanceAfter!==null&&!moneyEqualForRestore(latest.balanceAfter,order.balance)||
      (latestOrdinaryBalance===null)!==(orderOrdinaryBalance===null)||
      latestOrdinaryBalance!==null&&!moneyEqualForRestore(latestOrdinaryBalance,orderOrdinaryBalance)||
      !moneyEqualForRestore(latest.arrearsAfter,order.arrears));
  });
  const duplicateEmployeeLoanReference=duplicateKey(dataset.employeeLoans,(row:any)=>String(row.reference||"").trim().toUpperCase());
  const duplicateEmployeeLoanDeduction=duplicateKey(dataset.employeeLoanDeductions,(row:any)=>`${row.employeeLoanId}:${row.payRunId}`);
  const invalidEmployeeLoanDeduction=dataset.employeeLoanDeductions.find((row:any)=>{
    const run=runById.get(row.payRunId);
    return run?.status!=="finalised"||Number(row.amount)>Number(row.balanceBefore)+.005||Number(row.amount)>Number(run?.otherDeductions)+.005;
  });
  const invalidEmployeeLoanBalance=dataset.employeeLoans.find((loan:any)=>{
    const history=dataset.employeeLoanDeductions.filter((row:any)=>row.employeeLoanId===loan.id).sort((left:any,right:any)=>left.id-right.id);
    const latest=history.at(-1);
    return Number(loan.originalAmount)<=0||Number(loan.regularDeduction)<=0||Number(loan.balance)<0||Number(loan.balance)>Number(loan.originalAmount)+.005||
      !["active","suspended","stopped","completed"].includes(loan.status)||Boolean(latest)&&!moneyEqualForRestore(latest.balanceAfter,loan.balance)||
      loan.status==="completed"&&!moneyEqualForRestore(loan.balance,0);
  });
  const duplicatePayRoundingSetting=duplicateKey(dataset.employeePayRounding,(row:any)=>String(row.employeeId));
  const duplicatePayRoundingEntry=duplicateKey(dataset.payRoundingEntries,(row:any)=>`${row.employeePayRoundingId}:${row.payRunId}`);
  const invalidPayRoundingEntry=dataset.payRoundingEntries.find((row:any)=>runById.get(row.payRunId)?.status!=="finalised");
  const invalidPayRoundingBalance=dataset.employeePayRounding.find((setting:any)=>{
    const history=dataset.payRoundingEntries.filter((row:any)=>row.employeePayRoundingId===setting.id).sort((left:any,right:any)=>left.id-right.id);
    const latest=history.at(-1);
    return !moneyEqualForRestore(setting.carry,latest?.closingCarry??0);
  });
  const duplicateHolidayFundSetting=duplicateKey(dataset.holidayFundSettings,(row:any)=>String(row.employeeId));
  const duplicateHolidayFundEntry=duplicateKey(dataset.holidayFundEntries,(row:any)=>`${row.holidayFundSettingId}:${row.payPeriodId}`);
  let invalidHolidayFundChecksum:any=null;
  for(const row of dataset.holidayFundEntries.filter((item:any)=>item.payRunId)){
    const actual=await sha256(JSON.stringify(holidayFundEntryEvidence(row)));
    if(actual!==row.sourceChecksum){invalidHolidayFundChecksum=row;break;}
  }
  const invalidHolidayFundBalance=dataset.holidayFundSettings.find((setting:any)=>{
    const history=dataset.holidayFundEntries.filter((row:any)=>row.holidayFundSettingId===setting.id&&row.status==="finalised")
      .sort((left:any,right:any)=>left.periodNumber-right.periodNumber||left.id-right.id);
    let balance=Number(setting.openingBalance);
    for(const row of history){
      if(!moneyEqualForRestore(row.balanceBefore,balance))return true;
      balance=Number(row.balanceAfter);
    }
    return !moneyEqualForRestore(setting.currentBalance,balance);
  });
  const invalidBenefit=dataset.expensesBenefits.find((row:any)=>validateBenefitEvidence(row));
  const benefitById=byId("expensesBenefits");
  const duplicateCopiedBenefit=duplicateKey(dataset.expensesBenefits.filter((row:any)=>row.copiedFromBenefitId),(row:any)=>String(row.copiedFromBenefitId));
  const invalidBenefitLineage=dataset.expensesBenefits.find((row:any)=>{
    if(row.copiedFromBenefitId){
      const source=benefitById.get(Number(row.copiedFromBenefitId));
      if(!source||source.id===row.id||source.employeeId!==row.employeeId||nextTaxYear(source.taxYear)!==row.taxYear||
        !row.copiedAt||!Number.isFinite(Date.parse(String(row.copiedAt)))||Date.parse(String(row.copiedAt))>Date.parse(String(backup.exportedAt)))
        return true;
    }else if(row.copiedAt)return true;
    if(!row.replacesBenefitId)return false;
    const baseline=benefitById.get(Number(row.replacesBenefitId));
    return !baseline||baseline.status!=="voided"||baseline.employeeId!==row.employeeId||baseline.taxYear!==row.taxYear||
      baseline.id===row.id||dataset.expensesBenefits.some((candidate:any)=>
        candidate.id!==row.id&&candidate.replacesBenefitId===row.replacesBenefitId&&candidate.status!=="voided");
  });
  const invalidRecurringSchedule=dataset.recurringPayItems.find((row:any)=>validateRecurringPayEvidence(row));
  const duplicateAgentCharge=duplicateKey(dataset.agentCharges,(row:any)=>String(row.chargeCode||"").trim().toLowerCase());
  const duplicateAgentInvoice=duplicateKey(dataset.agentInvoices,(row:any)=>String(row.invoiceNumber||"").trim().toUpperCase());
  const invalidAgentProfile=dataset.agentProfiles.length>1||dataset.agentProfiles.find((row:any)=>
    String(row.firmName||"").trim().length<2||String(row.contactName||"").trim().length<2||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email||""))||!Number.isFinite(row.defaultVatRate)||row.defaultVatRate<0||row.defaultVatRate>100||
    !Number.isInteger(row.paymentTermsDays)||row.paymentTermsDays<0||row.paymentTermsDays>365||
    !Number.isInteger(row.nextInvoiceNumber)||row.nextInvoiceNumber<1||!/^[A-Z0-9-]{1,10}$/.test(String(row.invoicePrefix||""))
  );
  const invalidAgentCharge=dataset.agentCharges.find((row:any)=>
    !/^[a-z0-9-]{2,40}$/.test(String(row.chargeCode||""))||String(row.description||"").trim().length<3||
    !["fixed","per-payslip","per-period","per-employee","per-submission"].includes(row.billingBasis)||
    !Number.isFinite(row.unitRate)||row.unitRate<0||!Number.isFinite(row.vatRate)||row.vatRate<0||row.vatRate>100||
    !["active","archived"].includes(row.status)
  );
  let invalidAgentInvoice:any=null;
  for(const row of dataset.agentInvoices){
    if(validateAgentInvoiceEvidence(row)||await sha256(String(row.sourceEvidence||""))!==row.sourceChecksum){invalidAgentInvoice=row;break;}
  }
  const duplicateActiveSchedule=duplicateKey(dataset.recurringPayItems.filter((row:any)=>row.status==="active"),(row:any)=>
    `${row.employeeId}:${row.taxYear}:${row.type}:${String(row.name||"").trim()}:${row.amount}:${row.startPeriod}:${row.endPeriod}`,
  );
  const invalidRecurringOccurrence=dataset.payItems.find((item:any)=>{
    if(!item.recurringItemId)return false;
    const schedule=recurringById.get(item.recurringItemId),run=runById.get(item.payRunId);
    const period=run?byId("payPeriods").get(run.payPeriodId):null;
    return validateRecurringOccurrenceEvidence(schedule,item,period);
  });
  const invalidEmployeeChange=dataset.employeeChangeRequests.find((row:any)=>validateEmployeeChangeEvidence(row));
  const duplicatePendingEmployeeChange=duplicateKey(dataset.employeeChangeRequests.filter((row:any)=>row.status==="pending"),(row:any)=>
    `${row.employeeId}:${row.requestType}`,
  );
  const invalidHmrcNotice=dataset.hmrcNotices.find((row:any)=>validateHmrcNoticeEvidence(row,backup.exportedAt));
  const duplicateNoticeIdentifier=duplicateKey(dataset.hmrcNotices,(row:any)=>String(row.noticeIdentifier||"").trim().toUpperCase());
  const duplicateActiveNotice=duplicateKey(dataset.hmrcNotices.filter((row:any)=>["new","applied"].includes(row.status)),(row:any)=>
    hmrcNoticeInstructionKey(row),
  );
  let invalidStatutoryNotice:any=null;
  for(const row of dataset.statutoryNotices){
    const actualSnapshotChecksum=await sha256(String(row.employeeSnapshot||""));
    if(validateStatutoryNoticeEvidence(row,actualSnapshotChecksum)){invalidStatutoryNotice=row;break;}
  }
  const cisPaymentById=byId("cisPayments");
  const invalidCisLineage=dataset.cisPayments.find((row:any)=>{
    if(!row.replacesPaymentId)return false;
    const baseline=cisPaymentById.get(Number(row.replacesPaymentId));
    return !baseline||baseline.status!=="voided"||baseline.subcontractorId!==row.subcontractorId||
      baseline.taxYear!==row.taxYear||baseline.taxMonth!==row.taxMonth||
      dataset.cisPayments.some((candidate:any)=>candidate.id!==row.id&&candidate.replacesPaymentId===row.replacesPaymentId&&candidate.status!=="voided");
  });
  const activeSchemes=dataset.pensionSchemes.filter((row:any)=>row.status==="active");
  if(invalidPeriod||duplicatePeriod||invalidCalendarDay||duplicateCalendarDay||invalidEmployee||duplicatePayrollId||invalidRun||invalidRunLifecycle||invalidRunAccounting||invalidFinalisedPopulation||invalidPayItem||duplicateRun||invalidSubcontractor||duplicateSubcontractorUtr||invalidCisPayment||invalidCisLineage||invalidLeaveEvent||invalidLeaveCalendarEvidence||invalidStatutoryNotice||invalidHmrcPayment||duplicateHmrcReference||invalidPayrollAdjustment||duplicateActiveAdjustment||invalidRecoveryBalance||invalidAttachmentOrder||duplicateActiveOrder||invalidAttachmentDeduction||duplicateAttachmentDeduction||invalidAttachmentCurrentBalance||duplicateEmployeeLoanReference||duplicateEmployeeLoanDeduction||invalidEmployeeLoanDeduction||invalidEmployeeLoanBalance||duplicatePayRoundingSetting||duplicatePayRoundingEntry||invalidPayRoundingEntry||invalidPayRoundingBalance||duplicateHolidayFundSetting||duplicateHolidayFundEntry||invalidHolidayFundChecksum||invalidHolidayFundBalance||invalidBenefit||invalidBenefitLineage||duplicateCopiedBenefit||invalidAgentProfile||invalidAgentCharge||duplicateAgentCharge||invalidAgentInvoice||duplicateAgentInvoice||invalidRecurringSchedule||duplicateActiveSchedule||invalidRecurringOccurrence||invalidEmployeeChange||duplicatePendingEmployeeChange||invalidHmrcNotice||duplicateNoticeIdentifier||duplicateActiveNotice||invalidPensionScheme||invalidPensionMembership||duplicatePensionMembership||invalidPensionEvent||invalidPensionEventState||invalidPensionRefund||activeSchemes.length>1)
    return {ok:false as const,error:"Backup payroll-state validation failed. The file contains duplicate or invalid operational records.",
      table:invalidPeriod||duplicatePeriod?"payPeriods":invalidEmployee||duplicatePayrollId?"employees":
        invalidCalendarDay||duplicateCalendarDay?"employerCalendarDays":
        invalidRun||invalidRunLifecycle||invalidRunAccounting||invalidFinalisedPopulation||invalidPayItem||duplicateRun?"payRuns":
        invalidSubcontractor||duplicateSubcontractorUtr?"subcontractors":invalidCisPayment||invalidCisLineage?"cisPayments":invalidLeaveEvent||invalidLeaveCalendarEvidence?"leaveEvents":invalidStatutoryNotice?"statutoryNotices":
          invalidHmrcPayment||duplicateHmrcReference?"hmrcPayments":invalidPayrollAdjustment||duplicateActiveAdjustment||invalidRecoveryBalance?"payrollAdjustments":
            invalidAttachmentOrder||duplicateActiveOrder||invalidAttachmentDeduction||duplicateAttachmentDeduction||invalidAttachmentCurrentBalance?"attachmentOrders":
              duplicateEmployeeLoanReference||duplicateEmployeeLoanDeduction||invalidEmployeeLoanDeduction||invalidEmployeeLoanBalance?"employeeLoans":
              duplicatePayRoundingSetting||duplicatePayRoundingEntry||invalidPayRoundingEntry||invalidPayRoundingBalance?"employeePayRounding":
              duplicateHolidayFundSetting||invalidHolidayFundBalance?"holidayFundSettings":
              duplicateHolidayFundEntry||invalidHolidayFundChecksum?"holidayFundEntries":
              invalidBenefit||invalidBenefitLineage||duplicateCopiedBenefit?"expensesBenefits":
                invalidAgentProfile?"agentProfiles":invalidAgentCharge||duplicateAgentCharge?"agentCharges":invalidAgentInvoice||duplicateAgentInvoice?"agentInvoices":
                invalidRecurringSchedule||duplicateActiveSchedule||invalidRecurringOccurrence?"recurringPayItems":
                invalidEmployeeChange||duplicatePendingEmployeeChange?"employeeChangeRequests":
                  invalidHmrcNotice||duplicateNoticeIdentifier||duplicateActiveNotice?"hmrcNotices":
                    invalidPensionScheme||invalidPensionMembership||duplicatePensionMembership||invalidPensionEvent||invalidPensionEventState||invalidPensionRefund?"pensionMemberships":"pensionSchemes"};
  const submissionById=byId("submissions");
  let invalidPensionDeclaration:any=null;
  for(const scheme of dataset.pensionSchemes.filter((row:any)=>row.declarationStatus==="filed")){
    const candidates=dataset.submissions.filter((row:any)=>row.type==="PENSION-DECLARATION"&&row.status==="recorded").filter((row:any)=>{
      try{return Number(JSON.parse(row.payload||"{}").schemeId)===scheme.id;}catch{return false;}
    }).sort((a:any,b:any)=>String(b.preparedAt||"").localeCompare(String(a.preparedAt||"")));
    const evidence=candidates[0];
    if(!evidence){invalidPensionDeclaration=scheme;break;}
    let payload:any;
    try{payload=JSON.parse(evidence.payload||"{}");}catch{invalidPensionDeclaration=evidence;break;}
    const actualChecksum=await sha256(JSON.stringify(payload));
    if(validatePensionDeclarationEvidence(evidence,payload,actualChecksum,scheme)){invalidPensionDeclaration=evidence;break;}
  }
  const receiptRows=dataset.submissions.filter((row:any)=>String(row.correlationId||"").trim());
  const duplicateReceipt=duplicateKey(receiptRows,(row:any)=>String(row.correlationId).trim().toUpperCase());
  const allowedSubmissionStatuses=new Set(["draft","validated","test-ready","submitted","accepted","rejected","superseded","invalid","prepared","generated","issued","queued","queued-external","published","recorded"]);
  const invalidSubmissionStatus=dataset.submissions.find((row:any)=>!allowedSubmissionStatuses.has(String(row.status||"")));
  let invalidEmailTemplate:any=null;
  for(const row of dataset.submissions.filter((item:any)=>item.type==="EMAIL-TEMPLATE")){
    const template=parseStoredEmailTemplate(row.payload),actualChecksum=template?await sha256(JSON.stringify(template)):"";
    if(!template||!["recorded","superseded"].includes(String(row.status||""))||actualChecksum!==row.payloadChecksum){invalidEmailTemplate=row;break;}
  }
  let invalidFilingEvidence:any=null;
  for(const row of dataset.submissions){
    if(!["accepted","rejected"].includes(row.status))continue;
    let payload:any={},receipt:any={};
    try{payload=JSON.parse(row.payload||"{}");receipt=JSON.parse(row.response||"{}");}catch{invalidFilingEvidence=row;break;}
    const expectedSchema=row.type==="CIS300"?"payflow-cis300-external-result-1":["FPS","EPS","Additional FPS","EXB"].includes(row.type)?"payflow-rti-external-result-1":"";
    const checksumValid=Boolean(row.payloadChecksum)&&await sha256(JSON.stringify(payload))===row.payloadChecksum;
    const receiptValid=Boolean(expectedSchema)&&receipt.schemaVersion===expectedSchema&&receipt.outcome===row.status&&
      receipt.acknowledgementReference===row.correlationId&&typeof receipt.evidenceSource==="string"&&receipt.evidenceSource.length>0&&
      Boolean(row.submittedAt)&&Number.isFinite(Date.parse(row.submittedAt))&&!String(row.correlationId||"").startsWith("PF-TEST-");
    if(!checksumValid||!receiptValid){invalidFilingEvidence=row;break;}
    const baselineId=Number(row.type==="Additional FPS"?payload.correctionOfSubmissionId:row.type==="CIS300"?payload.amendsSubmissionId:0);
    const baselineChecksum=String(row.type==="Additional FPS"?payload.correctionBaselineChecksum:row.type==="CIS300"?payload.amendsPayloadChecksum:"");
    if(baselineId){
      const baseline=submissionById.get(baselineId);
      if(!baseline||baseline.status!=="accepted"||baseline.payloadChecksum!==baselineChecksum){invalidFilingEvidence=row;break;}
    }
  }
  if(duplicateReceipt||invalidSubmissionStatus||invalidFilingEvidence||invalidPensionDeclaration||invalidEmailTemplate)
    return {ok:false as const,error:duplicateReceipt
      ?"Backup filing-evidence validation failed. An external acknowledgement reference is attached to more than one submission."
      :invalidSubmissionStatus
        ?"Backup filing-evidence validation failed. A submission has an unsupported lifecycle status."
        :invalidPensionDeclaration
          ?"Backup pension declaration evidence is missing, corrupted or no longer matches its scheme."
          :invalidEmailTemplate
            ?"Backup email-template evidence is malformed or no longer matches its checksum."
          :"Backup filing-evidence validation failed. Accepted or rejected HMRC evidence is incomplete, corrupted or has a broken correction baseline.",
      table:"submissions"};
  return {ok:true as const,backup,dataset,counts,checksum,total};
}

export async function GET(request: Request) {
  const employerId = Number(new URL(request.url).searchParams.get("employerId") || 1);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  const db = getDb();
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
  const portableEmployer=employer;
  const employeeRows=await db.select().from(employees).where(eq(employees.employerId,employerId)),employeeIds=new Set(employeeRows.map(row=>row.id));
  if(employeeRows.some(row=>row.confidential)&&!access.membership.canViewConfidential)
    return NextResponse.json({error:"Confidential employee permission is required to create a complete employer backup."},{status:403});
  const periodRows=await db.select().from(payPeriods).where(eq(payPeriods.employerId,employerId)),periodIds=new Set(periodRows.map(row=>row.id));
  const runRows=(await db.select().from(payRuns)).filter(row=>periodIds.has(row.payPeriodId)&&employeeIds.has(row.employeeId)),runIds=new Set(runRows.map(row=>row.id));
  const schemeRows=await db.select().from(pensionSchemes).where(eq(pensionSchemes.employerId,employerId)),schemeIds=new Set(schemeRows.map(row=>row.id));
  const subcontractorRows=await db.select().from(subcontractors).where(eq(subcontractors.employerId,employerId)),subcontractorIds=new Set(subcontractorRows.map(row=>row.id));
  const orderRows=(await db.select().from(attachmentOrders)).filter(row=>employeeIds.has(row.employeeId)),orderIds=new Set(orderRows.map(row=>row.id));
  const loanRows=await db.select().from(employeeLoans).where(eq(employeeLoans.employerId,employerId)),loanIds=new Set(loanRows.map(row=>row.id));
  const roundingRows=await db.select().from(employeePayRounding).where(eq(employeePayRounding.employerId,employerId)),roundingIds=new Set(roundingRows.map(row=>row.id));
  const holidayFundSettingRows=await db.select().from(holidayFundSettings).where(eq(holidayFundSettings.employerId,employerId)),holidayFundSettingIds=new Set(holidayFundSettingRows.map(row=>row.id));
  const dataset={
    employers:[portableEmployer],
    departments:await db.select().from(departments).where(eq(departments.employerId,employerId)),
    employerSettings:await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)),
    employerCalendarDays:await db.select().from(employerCalendarDays).where(eq(employerCalendarDays.employerId,employerId)),
    employees:employeeRows,
    payrollOpeningBalances:await db.select().from(payrollOpeningBalances).where(eq(payrollOpeningBalances.employerId,employerId)),
    payPeriods:periodRows,
    payRuns:runRows,
    payItems:(await db.select().from(payItems)).filter(row=>runIds.has(row.payRunId)),
    recurringPayItems:(await db.select().from(recurringPayItems)).filter(row=>row.employerId===employerId&&employeeIds.has(row.employeeId)),
    payrollAdjustments:(await db.select().from(payrollAdjustments)).filter(row=>row.employerId===employerId&&employeeIds.has(row.employeeId)&&periodIds.has(row.payPeriodId)),
    leaveEvents:(await db.select().from(leaveEvents)).filter(row=>employeeIds.has(row.employeeId)),
    statutoryNotices:(await db.select().from(statutoryNotices)).filter(row=>employeeIds.has(row.employeeId)),
    hmrcNotices:await db.select().from(hmrcNotices).where(eq(hmrcNotices.employerId,employerId)),
    hmrcPayments:await db.select().from(hmrcPayments).where(eq(hmrcPayments.employerId,employerId)),
    pensionSchemes:schemeRows,
    pensionMemberships:(await db.select().from(pensionMemberships)).filter(row=>schemeIds.has(row.schemeId)&&employeeIds.has(row.employeeId)),
    pensionMembershipEvents:await db.select().from(pensionMembershipEvents).where(eq(pensionMembershipEvents.employerId,employerId)),
    subcontractors:subcontractorRows,
    cisPayments:(await db.select().from(cisPayments)).filter(row=>subcontractorIds.has(row.subcontractorId)),
    submissions:await db.select().from(submissions).where(eq(submissions.employerId,employerId)),
    agentProfiles:await db.select().from(agentProfiles).where(eq(agentProfiles.employerId,employerId)),
    agentCharges:await db.select().from(agentCharges).where(eq(agentCharges.employerId,employerId)),
    agentInvoices:await db.select().from(agentInvoices).where(eq(agentInvoices.employerId,employerId)),
    expensesBenefits:(await db.select().from(expensesBenefits)).filter(row=>employeeIds.has(row.employeeId)),
    attachmentOrders:orderRows,
    attachmentOrderDeductions:(await db.select().from(attachmentOrderDeductions)).filter(row=>orderIds.has(row.attachmentOrderId)&&runIds.has(row.payRunId)),
    employeeLoans:loanRows,
    employeeLoanDeductions:(await db.select().from(employeeLoanDeductions)).filter(row=>loanIds.has(row.employeeLoanId)&&runIds.has(row.payRunId)),
    employeePayRounding:roundingRows,
    payRoundingEntries:(await db.select().from(payRoundingEntries)).filter(row=>roundingIds.has(row.employeePayRoundingId)&&runIds.has(row.payRunId)),
    holidayFundSettings:holidayFundSettingRows,
    holidayFundEntries:(await db.select().from(holidayFundEntries)).filter(row=>holidayFundSettingIds.has(row.holidayFundSettingId)),
    employeeChangeRequests:await db.select().from(employeeChangeRequests).where(eq(employeeChangeRequests.employerId,employerId)),
    auditLog:await db.select().from(auditLog).where(eq(auditLog.employerId,employerId)),
  };
  const counts=Object.fromEntries(Object.entries(dataset).map(([table,rows])=>[table,rows.length]));
  const backup={schemaVersion:7,employerId,employerName:employer.name,exportedAt:new Date().toISOString(),counts,
    exclusions:["Administrator password hashes","Administrator session tokens","Employee portal invitation and session tokens"],dataset};
  const result={...backup,checksum:{algorithm:"SHA-256",value:await sha256(JSON.stringify(backup))}};
  return NextResponse.json(result,{headers:{"content-disposition":`attachment; filename="payflow-backup-${employerId}-${new Date().toISOString().slice(0,10)}.json"`}});
}

async function currentRestoreFingerprint(request:Request,employerId:number){
  const response=await GET(new Request(new URL(`/api/data?employerId=${employerId}`,request.url),{headers:request.headers}));
  let body:any;
  try{body=await response.json();}catch{body={error:"Current payroll state could not be fingerprinted."};}
  if(!response.ok)return {ok:false as const,response:NextResponse.json(body,{status:response.status})};
  return {ok:true as const,fingerprint:await sha256(JSON.stringify(body.dataset))};
}

export async function POST(request: Request) {
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"A JSON data operation object is required."},{status:400}); }
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({error:"A JSON data operation object is required."},{status:400});
  if(["verify-backup","analyse-restore","restore-backup"].includes(input.action)){
    const employerId=Number(input.employerId),access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
    const validation=await validateBackup(input.backup,employerId);
    if(!validation.ok)return NextResponse.json({error:validation.error,table:validation.table},{status:422});
    const {backup,counts,checksum,total,dataset}=validation;
    if(input.action==="verify-backup")return NextResponse.json({verified:true,schemaVersion:backup.schemaVersion,employerId,exportedAt:backup.exportedAt,counts,checksum});
    if(access.membership.role!=="owner")return NextResponse.json({error:"Only an employer owner can analyse or restore a complete payroll backup."},{status:403});
    const db=getDb(),[employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
    if(!employer)return NextResponse.json({error:"Employer was not found."},{status:404});
    const currentEmployees=await db.select({id:employees.id}).from(employees).where(eq(employees.employerId,employerId));
    const currentPeriods=await db.select({id:payPeriods.id,status:payPeriods.status}).from(payPeriods).where(eq(payPeriods.employerId,employerId));
    const confirmationPhrase=`RESTORE ${employer.name} ${checksum.slice(0,8).toUpperCase()}`;
    const impact={current:{employees:currentEmployees.length,payPeriods:currentPeriods.length,finalisedPeriods:currentPeriods.filter(row=>row.status==="finalised").length},backup:{employees:counts.employees,payPeriods:counts.payPeriods,finalisedPeriods:dataset.payPeriods.filter((row:any)=>row.status==="finalised").length,totalRecords:total},portalSessionsRevoked:true,administratorAccessPreserved:true};
    if(input.action==="analyse-restore"){
      const current=await currentRestoreFingerprint(request,employerId);if(!current.ok)return current.response;
      return NextResponse.json({verified:true,confirmationPhrase,impact,exportedAt:backup.exportedAt,checksum,currentFingerprint:current.fingerprint});
    }
    if(String(input.confirmation||"")!==confirmationPhrase)return NextResponse.json({error:"Type the exact restore confirmation phrase shown in the recovery analysis."},{status:422});
    if(!/^[a-f0-9]{64}$/.test(String(input.currentFingerprint||"")))
      return NextResponse.json({error:"Re-analyse this recovery point before restoring it."},{status:422});
    const current=await currentRestoreFingerprint(request,employerId);if(!current.ok)return current.response;
    if(current.fingerprint!==input.currentFingerprint)
      return NextResponse.json({error:"Current payroll data changed after the recovery analysis. Analyse the recovery point again before restoring."},{status:409});

    const employeeIds=currentEmployees.map(row=>row.id),periodIds=currentPeriods.map(row=>row.id);
    const runRows=periodIds.length?await db.select({id:payRuns.id}).from(payRuns).where(inArray(payRuns.payPeriodId,periodIds)):[];
    const runIds=runRows.map(row=>row.id);
    const schemeRows=await db.select({id:pensionSchemes.id}).from(pensionSchemes).where(eq(pensionSchemes.employerId,employerId)),schemeIds=schemeRows.map(row=>row.id);
    const subcontractorRows=await db.select({id:subcontractors.id}).from(subcontractors).where(eq(subcontractors.employerId,employerId)),subcontractorIds=subcontractorRows.map(row=>row.id);
    const orderRows=employeeIds.length?await db.select({id:attachmentOrders.id}).from(attachmentOrders).where(inArray(attachmentOrders.employeeId,employeeIds)):[],orderIds=orderRows.map(row=>row.id);
    const loanRows=await db.select({id:employeeLoans.id}).from(employeeLoans).where(eq(employeeLoans.employerId,employerId)),loanIds=loanRows.map(row=>row.id);
    const roundingRows=await db.select({id:employeePayRounding.id}).from(employeePayRounding).where(eq(employeePayRounding.employerId,employerId)),roundingIds=roundingRows.map(row=>row.id);
    const operations:any[]=[];
    const pushChunkedDelete=(table:any,column:any,values:number[])=>{
      for(let index=0;index<values.length;index+=75)
        operations.push(db.delete(table).where(inArray(column,values.slice(index,index+75))));
    };
    pushChunkedDelete(attachmentOrderDeductions,attachmentOrderDeductions.attachmentOrderId,orderIds);
    pushChunkedDelete(employeeLoanDeductions,employeeLoanDeductions.employeeLoanId,loanIds);
    pushChunkedDelete(payRoundingEntries,payRoundingEntries.employeePayRoundingId,roundingIds);
    operations.push(db.delete(holidayFundEntries).where(eq(holidayFundEntries.employerId,employerId)));
    pushChunkedDelete(payItems,payItems.payRunId,runIds);
    operations.push(db.delete(pensionMembershipEvents).where(eq(pensionMembershipEvents.employerId,employerId)));
    pushChunkedDelete(pensionMemberships,pensionMemberships.schemeId,schemeIds);
    pushChunkedDelete(cisPayments,cisPayments.subcontractorId,subcontractorIds);
    if(employeeIds.length){
      pushChunkedDelete(employeePortalSessions,employeePortalSessions.employeeId,employeeIds);
      pushChunkedDelete(employeePortalInvites,employeePortalInvites.employeeId,employeeIds);
      pushChunkedDelete(employeeChangeRequests,employeeChangeRequests.employeeId,employeeIds);
      pushChunkedDelete(payrollOpeningBalances,payrollOpeningBalances.employeeId,employeeIds);
      pushChunkedDelete(statutoryNotices,statutoryNotices.employeeId,employeeIds);
      pushChunkedDelete(leaveEvents,leaveEvents.employeeId,employeeIds);
      pushChunkedDelete(expensesBenefits,expensesBenefits.employeeId,employeeIds);
      pushChunkedDelete(attachmentOrders,attachmentOrders.employeeId,employeeIds);
      pushChunkedDelete(employeeLoans,employeeLoans.employeeId,employeeIds);
      pushChunkedDelete(employeePayRounding,employeePayRounding.employeeId,employeeIds);
    }
    operations.push(db.delete(holidayFundSettings).where(eq(holidayFundSettings.employerId,employerId)));
    operations.push(db.delete(hmrcNotices).where(eq(hmrcNotices.employerId,employerId)));
    operations.push(db.delete(hmrcPayments).where(eq(hmrcPayments.employerId,employerId)));
    operations.push(db.delete(payrollAdjustments).where(eq(payrollAdjustments.employerId,employerId)));
    operations.push(db.delete(recurringPayItems).where(eq(recurringPayItems.employerId,employerId)));
    pushChunkedDelete(payRuns,payRuns.id,runIds);
    operations.push(db.delete(submissions).where(eq(submissions.employerId,employerId)));
    operations.push(db.delete(agentInvoices).where(eq(agentInvoices.employerId,employerId)));
    operations.push(db.delete(agentCharges).where(eq(agentCharges.employerId,employerId)));
    operations.push(db.delete(agentProfiles).where(eq(agentProfiles.employerId,employerId)));
    operations.push(db.delete(pensionSchemes).where(eq(pensionSchemes.employerId,employerId)));
    operations.push(db.delete(subcontractors).where(eq(subcontractors.employerId,employerId)));
    operations.push(db.delete(payPeriods).where(eq(payPeriods.employerId,employerId)));
    operations.push(db.delete(employees).where(eq(employees.employerId,employerId)));
    operations.push(db.delete(departments).where(eq(departments.employerId,employerId)));
    operations.push(db.delete(employerCalendarDays).where(eq(employerCalendarDays.employerId,employerId)));
    operations.push(db.delete(employerSettings).where(eq(employerSettings.employerId,employerId)));
    operations.push(db.delete(auditLog).where(eq(auditLog.employerId,employerId)));
    const {id:_employerId,...employerValues}=dataset.employers[0];
    operations.push(db.update(employers).set(employerValues).where(eq(employers.id,employerId)));
    const insert=(table:any,rows:any[])=>{
      if(!rows.length)return;
      const variablesPerRow=Math.max(1,Object.keys(rows[0]).length),chunkSize=Math.max(1,Math.floor(90/variablesPerRow));
      for(let index=0;index<rows.length;index+=chunkSize)operations.push(db.insert(table).values(rows.slice(index,index+chunkSize)));
    };
    insert(departments,dataset.departments);insert(employerSettings,dataset.employerSettings);insert(employerCalendarDays,dataset.employerCalendarDays);insert(employees,dataset.employees);insert(payrollOpeningBalances,dataset.payrollOpeningBalances);insert(employeePayRounding,dataset.employeePayRounding);insert(holidayFundSettings,dataset.holidayFundSettings);
    insert(payPeriods,dataset.payPeriods);insert(pensionSchemes,dataset.pensionSchemes);insert(subcontractors,dataset.subcontractors);
    insert(recurringPayItems,dataset.recurringPayItems);insert(payRuns,dataset.payRuns);insert(payItems,dataset.payItems);
    insert(payrollAdjustments,dataset.payrollAdjustments);insert(leaveEvents,dataset.leaveEvents);insert(statutoryNotices,dataset.statutoryNotices);
    insert(hmrcNotices,dataset.hmrcNotices);insert(hmrcPayments,dataset.hmrcPayments);insert(pensionMemberships,dataset.pensionMemberships);
    insert(pensionMembershipEvents,dataset.pensionMembershipEvents);insert(cisPayments,dataset.cisPayments);insert(submissions,dataset.submissions);
    insert(agentProfiles,dataset.agentProfiles);insert(agentCharges,dataset.agentCharges);insert(agentInvoices,dataset.agentInvoices);
    insert(expensesBenefits,dataset.expensesBenefits);insert(attachmentOrders,dataset.attachmentOrders);
    insert(attachmentOrderDeductions,dataset.attachmentOrderDeductions);insert(employeeLoans,dataset.employeeLoans);insert(employeeLoanDeductions,dataset.employeeLoanDeductions);insert(payRoundingEntries,dataset.payRoundingEntries);insert(holidayFundEntries,dataset.holidayFundEntries);insert(employeeChangeRequests,dataset.employeeChangeRequests);insert(auditLog,dataset.auditLog);
    operations.push(db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"restored:complete-backup",entityType:"employer-backup",entityId:checksum.slice(0,16),after:JSON.stringify({exportedAt:backup.exportedAt,checksum,counts,portalSessionsRevoked:true})}));
    await db.batch(operations as [any,...any[]]);
    return NextResponse.json({restored:true,employerId,checksum,counts,impact,portalSessionsRevoked:true,administratorAccessPreserved:true});
  }
  if(input.action!=="import-employees")return NextResponse.json({error:"Unsupported data operation."},{status:400});
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const employerId = Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  if (!Number.isInteger(employerId) || employerId < 1) {
    return NextResponse.json({ error: "A valid employerId is required for the whole import." }, { status: 400 });
  }
  if (!rows.length || rows.length > 500) {
    return NextResponse.json({ error: "Import between 1 and 500 employee rows." }, { status: 400 });
  }
  const db = getDb();
  const [employer] = await db.select({ id: employers.id,taxYear:employers.taxYear }).from(employers).where(eq(employers.id, employerId)).limit(1);
  if (!employer) return NextResponse.json({ error: "Employer was not found." }, { status: 404 });

  const prepared:Array<{
    rowNumber:number;payrollId:string;firstName:string;lastName:string;email:string|null;
    dateOfBirth:string|null;startDate:string|null;starterEvidence:string;starterDeclaration:string;
    p45LeavingDate:string|null;p45PreviousPay:number;p45PreviousTax:number;p60TaxYear:string|null;p60ReferenceOnly:boolean;
    taxCode:string;week1Month1:boolean;niCategory:string;niNumber:string|null;studentLoanPlan:string|null;postgraduateLoan:boolean;
    payBasis:string;annualSalary:number;hourlyRate:number;dailyRate:number;contractedHours:number;workingDaysPerWeek:number;
    paymentMethod:string;bankName:string|null;accountName:string|null;sortCode:string|null;accountNumber:string|null;
  }> = rows.map((row:Record<string,unknown>, index:number) => ({
    rowNumber:index+1,
    payrollId:String(row.payrollId || "").trim(),
    firstName:String(row.firstName || "").trim(),
    lastName:String(row.lastName || "").trim(),
    email:row.email ? String(row.email).trim() : null,
    dateOfBirth:row.dateOfBirth?String(row.dateOfBirth).trim():null,
    startDate:row.startDate?String(row.startDate).trim():null,
    starterEvidence:String(row.starterEvidence||"No P45 provided").trim(),
    starterDeclaration:String(row.starterDeclaration||"Statement A").trim(),
    p45LeavingDate:row.p45LeavingDate?String(row.p45LeavingDate).trim():null,
    p45PreviousPay:Number(row.p45PreviousPay||0),p45PreviousTax:Number(row.p45PreviousTax||0),
    p60TaxYear:row.p60TaxYear?String(row.p60TaxYear).trim():null,p60ReferenceOnly:importedBoolean(row.p60ReferenceOnly),
    taxCode:String(row.taxCode || "1257L").trim().toUpperCase(),
    week1Month1:importedBoolean(row.week1Month1),
    niCategory:String(row.niCategory || "A").trim().toUpperCase(),
    niNumber:row.niNumber?String(row.niNumber).replace(/\s/g,"").toUpperCase():null,
    studentLoanPlan:row.studentLoanPlan?String(row.studentLoanPlan):null,postgraduateLoan:importedBoolean(row.postgraduateLoan),
    payBasis:String(row.payBasis||"period"),annualSalary:Number(row.annualSalary || 0),
    hourlyRate:Number(row.hourlyRate || 0),
    dailyRate:Number(row.dailyRate||0),contractedHours:Number(row.contractedHours||0),workingDaysPerWeek:Number(row.workingDaysPerWeek??5),
    paymentMethod:String(row.paymentMethod||"credit-transfer"),bankName:row.bankName?String(row.bankName).trim():null,
    accountName:row.accountName?String(row.accountName).trim():null,
    sortCode:row.sortCode?String(row.sortCode).replace(/\D/g,""):null,
    accountNumber:row.accountNumber?String(row.accountNumber).replace(/\D/g,""):null,
  }));
  const errors:string[]=[];
  const seen=new Set<string>();
  const niCategories=new Set(["A","B","C","D","E","F","H","I","J","K","L","M","N","S","V","Z","X"]);
  const starterEvidenceValues=new Set(["P45 provided","No P45 provided","P60 only","Worked elsewhere this tax year","Secondary employment"]);
  const validDate=(value:string|null)=>{
    if(!value)return true;
    const timestamp=Date.parse(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value;
  };
  for(const row of prepared) {
    if(!row.payrollId)errors.push(`Row ${row.rowNumber}: payrollId is required.`);
    else if(row.payrollId.length>35)errors.push(`Row ${row.rowNumber}: payrollId must contain 35 characters or fewer.`);
    else if(seen.has(row.payrollId))errors.push(`Row ${row.rowNumber}: duplicate payrollId ${row.payrollId} in this import.`);
    else seen.add(row.payrollId);
    if(!row.firstName||!row.lastName)errors.push(`Row ${row.rowNumber}: firstName and lastName are required.`);
    if(!validDate(row.dateOfBirth)||!validDate(row.startDate)||!validDate(row.p45LeavingDate))errors.push(`Row ${row.rowNumber}: employee dates must be real ISO calendar dates.`);
    if(!starterEvidenceValues.has(row.starterEvidence))errors.push(`Row ${row.rowNumber}: starterEvidence is not supported.`);
    if(!/^(?:Statement [ABC]|No statement)/i.test(row.starterDeclaration))errors.push(`Row ${row.rowNumber}: starterDeclaration must be Statement A, B, C or No statement.`);
    if(row.starterEvidence==="P45 provided"&&(!row.p45LeavingDate||row.p45PreviousPay<0||row.p45PreviousTax<0))errors.push(`Row ${row.rowNumber}: P45 starters need a leaving date and non-negative previous pay and tax.`);
    const statement=row.starterDeclaration.toLowerCase();
    if(row.starterEvidence==="Worked elsewhere this tax year"&&!statement.startsWith("statement b"))errors.push(`Row ${row.rowNumber}: worked-elsewhere starters must use Statement B.`);
    if(row.starterEvidence==="Secondary employment"&&!statement.startsWith("statement c"))errors.push(`Row ${row.rowNumber}: secondary employment must use Statement C.`);
    if(statement.startsWith("statement b")&&(!/^[SC]?1257L$/.test(row.taxCode)||!row.week1Month1))errors.push(`Row ${row.rowNumber}: Statement B must use 1257L (or regional equivalent) on week 1 / month 1.`);
    if(statement.startsWith("statement c")&&!/^[SC]?BR$/.test(row.taxCode))errors.push(`Row ${row.rowNumber}: Statement C must use BR (or regional equivalent).`);
    if(statement.startsWith("no statement")&&(!/^[SC]?0T$/.test(row.taxCode)||!row.week1Month1))errors.push(`Row ${row.rowNumber}: no starter statement must use 0T on week 1 / month 1.`);
    if(row.p45LeavingDate){
      const startYear=Number(employer.taxYear.slice(0,4)),yearStart=`${startYear}-04-06`,yearEnd=`${startYear+1}-04-05`;
      if(row.p45LeavingDate<yearStart||row.p45LeavingDate>yearEnd)errors.push(`Row ${row.rowNumber}: P45 leaving date must fall within ${employer.taxYear}.`);
      if(row.startDate&&row.p45LeavingDate>row.startDate)errors.push(`Row ${row.rowNumber}: P45 leaving date cannot be after the new employment start date.`);
    }
    if(row.starterEvidence==="P60 only"&&(!validTaxYear(row.p60TaxYear)||!row.p60ReferenceOnly))errors.push(`Row ${row.rowNumber}: P60-only evidence needs its tax year and reference-only confirmation.`);
    if(row.niNumber&&!/^[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]$/.test(row.niNumber))errors.push(`Row ${row.rowNumber}: National Insurance number is invalid.`);
    if(row.studentLoanPlan&&!["1","2","4","5"].includes(row.studentLoanPlan))errors.push(`Row ${row.rowNumber}: student loan plan must be 1, 2, 4 or 5.`);
    if(!["period","hourly","daily"].includes(row.payBasis))errors.push(`Row ${row.rowNumber}: payBasis must be period, hourly or daily.`);
    if(!Number.isFinite(row.annualSalary)||row.annualSalary<0)errors.push(`Row ${row.rowNumber}: annualSalary must be zero or more.`);
    if(!Number.isFinite(row.hourlyRate)||row.hourlyRate<0)errors.push(`Row ${row.rowNumber}: hourlyRate must be zero or more.`);
    if(row.payBasis==="hourly"&&(row.hourlyRate<=0||row.contractedHours<=0))errors.push(`Row ${row.rowNumber}: hourly pay requires a positive rate and contracted hours.`);
    if(row.payBasis==="daily"&&(row.dailyRate<=0||row.workingDaysPerWeek<=0||row.workingDaysPerWeek>7))errors.push(`Row ${row.rowNumber}: daily pay requires a positive rate and 1 to 7 working days.`);
    if(!niCategories.has(row.niCategory))errors.push(`Row ${row.rowNumber}: NI category is not supported for 2026/27.`);
    if(!isRecognisedPayeTaxCode(row.taxCode))errors.push(`Row ${row.rowNumber}: taxCode is not a recognised PAYE code.`);
    if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))errors.push(`Row ${row.rowNumber}: email is invalid.`);
    if(!["credit-transfer","cash","cheque"].includes(row.paymentMethod))errors.push(`Row ${row.rowNumber}: paymentMethod is not supported.`);
    const hasBankEvidence=Boolean(row.bankName||row.accountName||row.sortCode||row.accountNumber);
    if(hasBankEvidence&&(!row.accountName||row.sortCode?.length!==6||row.accountNumber?.length!==8))
      errors.push(`Row ${row.rowNumber}: bank details must include the account name, a six-digit sort code and an eight-digit account number.`);
  }
  for(const payrollId of seen) {
    const [existing]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.employerId,employerId),eq(employees.payrollId,payrollId))).limit(1);
    if(existing)errors.push(`Payroll ID ${payrollId} already exists for this employer.`);
  }
  if(errors.length)return NextResponse.json({error:"Employee import validation failed. No employee rows were inserted.",errors},{status:422});

  const importedValues=prepared.map(row=>({
      employerId,
      payrollId:row.payrollId,
      firstName:row.firstName,
      lastName:row.lastName,
      email:row.email,
      dateOfBirth:row.dateOfBirth,startDate:row.startDate,starterEvidence:row.starterEvidence,starterDeclaration:row.starterDeclaration,
      p45LeavingDate:row.p45LeavingDate,p45PreviousPay:row.p45PreviousPay,p45PreviousTax:row.p45PreviousTax,
      p60TaxYear:row.p60TaxYear,p60ReferenceOnly:row.p60ReferenceOnly,
      taxCode:row.taxCode,
      week1Month1:row.week1Month1,niCategory:row.niCategory,niNumber:row.niNumber,
      studentLoanPlan:row.studentLoanPlan,postgraduateLoan:row.postgraduateLoan,
      payBasis:row.payBasis,annualSalary:row.annualSalary,hourlyRate:row.hourlyRate,dailyRate:row.dailyRate,
      contractedHours:row.contractedHours,workingDaysPerWeek:row.workingDaysPerWeek,
      paymentMethod:row.paymentMethod,bankName:row.bankName,accountName:row.accountName,sortCode:row.sortCode,accountNumber:row.accountNumber,
    }));
  await db.batch([
    db.insert(employees).values(importedValues),
    db.insert(auditLog).values({employerId,actor:access.user.displayName,action:"imported:employees",entityType:"employee-import",after:JSON.stringify({rows:prepared.length,payrollIds:prepared.map(row=>row.payrollId)})}),
  ]);
  const inserted=await db.select().from(employees).where(and(eq(employees.employerId,employerId),inArray(employees.payrollId,prepared.map(row=>row.payrollId))));
  return NextResponse.json({ imported: inserted.length, records: inserted }, { status: 201 });
}
