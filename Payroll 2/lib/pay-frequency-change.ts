import { payrollFrequencyRule, type PayrollFrequency } from "./pay-frequency.ts";

export type FrequencyChangeEvidence={
  sourceFrequency:PayrollFrequency;
  targetFrequency:PayrollFrequency;
  periods:{id:number;status:string;frequency:string}[];
  runs:{id:number;status:string}[];
  recurringScheduleCount:number;
  openingBalanceCount:number;
  adjustmentCount:number;
  finalisedLedgerCount:number;
  activeAttachments:{id:number;calculationRule:string}[];
};

export function frequencyChangeConfirmation(frequency:PayrollFrequency){
  return `CHANGE FREQUENCY TO ${payrollFrequencyRule(frequency).label.toUpperCase()}`;
}

export function assessPayFrequencyChange(evidence:FrequencyChangeEvidence){
  const blockers:string[]=[];
  if(evidence.sourceFrequency===evidence.targetFrequency)
    blockers.push("The target pay frequency is already active.");
  if(evidence.periods.some(period=>["finalised","migrated"].includes(period.status)))
    blockers.push("Finalised or migrated payroll periods exist in the active tax year.");
  if(evidence.runs.some(run=>run.status!=="draft"))
    blockers.push("Non-draft pay runs exist in the active tax year.");
  if(evidence.openingBalanceCount)
    blockers.push("Mid-year opening balances are tied to the existing period sequence.");
  if(evidence.recurringScheduleCount)
    blockers.push("Recurring pay schedules use period numbers and must be ended or removed before changing frequency.");
  if(evidence.finalisedLedgerCount)
    blockers.push("Finalised attachment, loan or cash-rounding ledger entries depend on the existing pay runs.");
  return {
    allowed:blockers.length===0,
    blockers,
    discardedDraftPeriods:evidence.periods.length,
    discardedDraftRuns:evidence.runs.length,
    discardedAdjustments:evidence.adjustmentCount,
    updatedEmployeesFrequency:true,
    updatedActiveAttachments:evidence.activeAttachments.length,
    confirmationPhrase:frequencyChangeConfirmation(evidence.targetFrequency),
  };
}
