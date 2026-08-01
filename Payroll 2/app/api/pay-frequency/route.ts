import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  attachmentOrderDeductions, attachmentOrders, auditLog, employeeLoanDeductions, employeePayRounding, employees,
  employerSettings, employers, payItems, payPeriods, payRoundingEntries, payRuns, payrollAdjustments,
  payrollOpeningBalances, recurringPayItems,
} from "../../../db/schema";
import { requireEmployerAccess, sha256 } from "../../../lib/admin-auth";
import { assessPayFrequencyChange } from "../../../lib/pay-frequency-change";
import { payrollFrequencyRule, scheduledPayPeriods } from "../../../lib/pay-frequency";
import { readJsonObject } from "../../../lib/request-body";

async function buildPlan(employerId:number,targetValue:unknown,firstPayDateValue:unknown){
  const db=getDb();
  const [employer]=await db.select().from(employers).where(eq(employers.id,employerId)).limit(1);
  if(!employer)return {error:"Employer was not found.",status:404 as const};
  const [settings]=await db.select().from(employerSettings).where(eq(employerSettings.employerId,employerId)).limit(1);
  let sourceFrequency,targetFrequency;
  try{
    sourceFrequency=payrollFrequencyRule(employer.payFrequency).frequency;
    targetFrequency=payrollFrequencyRule(targetValue).frequency;
  }catch(error){
    return {error:error instanceof Error?error.message:"Select a supported pay frequency.",status:422 as const};
  }
  const firstPayDate=targetFrequency==="monthly"?null:String(firstPayDateValue||"").trim();
  let schedule;
  try{schedule=scheduledPayPeriods(employer.taxYear,targetFrequency,firstPayDate||undefined);}
  catch(error){return {error:error instanceof Error?error.message:"Enter a valid first pay date.",status:422 as const};}
  const periods=await db.select().from(payPeriods).where(and(
    eq(payPeriods.employerId,employerId),eq(payPeriods.taxYear,employer.taxYear),
  ));
  const periodIds=periods.map(period=>period.id);
  const runs=periodIds.length?await db.select().from(payRuns).where(inArray(payRuns.payPeriodId,periodIds)):[];
  const runIds=runs.map(run=>run.id);
  const [recurring,openings,adjustments,activeAttachments]=await Promise.all([
    db.select({id:recurringPayItems.id}).from(recurringPayItems).where(and(
      eq(recurringPayItems.employerId,employerId),eq(recurringPayItems.taxYear,employer.taxYear),
    )),
    db.select({id:payrollOpeningBalances.id}).from(payrollOpeningBalances).where(and(
      eq(payrollOpeningBalances.employerId,employerId),eq(payrollOpeningBalances.taxYear,employer.taxYear),
    )),
    periodIds.length?db.select({id:payrollAdjustments.id}).from(payrollAdjustments).where(inArray(payrollAdjustments.payPeriodId,periodIds)):Promise.resolve([]),
    db.select({id:attachmentOrders.id,calculationRule:attachmentOrders.calculationRule}).from(attachmentOrders)
      .innerJoin(employees,eq(attachmentOrders.employeeId,employees.id))
      .where(and(eq(employees.employerId,employerId),eq(attachmentOrders.status,"active"))),
  ]);
  const ledgerRows=runIds.length?(await Promise.all([
    db.select({id:attachmentOrderDeductions.id}).from(attachmentOrderDeductions).where(inArray(attachmentOrderDeductions.payRunId,runIds)),
    db.select({id:employeeLoanDeductions.id}).from(employeeLoanDeductions).where(inArray(employeeLoanDeductions.payRunId,runIds)),
    db.select({id:payRoundingEntries.id}).from(payRoundingEntries).where(inArray(payRoundingEntries.payRunId,runIds)),
  ])).flat():[];
  const evidence={
    sourceFrequency,targetFrequency,
    periods:periods.map(period=>({id:period.id,status:period.status,frequency:period.frequency})),
    runs:runs.map(run=>({id:run.id,status:run.status})),
    recurringScheduleCount:recurring.length,openingBalanceCount:openings.length,adjustmentCount:adjustments.length,
    finalisedLedgerCount:ledgerRows.length,activeAttachments,
  };
  const assessment=assessPayFrequencyChange(evidence);
  const fingerprint=await sha256(JSON.stringify({
    employerId,taxYear:employer.taxYear,sourceFrequency,targetFrequency,
    sourceFirstPayDate:settings?.firstPayDate||null,targetFirstPayDate:firstPayDate,
    evidence,
  }));
  return {
    employer,settings,sourceFrequency,targetFrequency,firstPayDate,schedule,evidence,assessment,fingerprint,
    changed:sourceFrequency!==targetFrequency||String(settings?.firstPayDate||"")!==String(firstPayDate||""),
  };
}

export async function POST(request:Request){
  const input=await readJsonObject(request);
  if(!input)return NextResponse.json({error:"A JSON pay-frequency request is required."},{status:400});
  const employerId=Number(input.employerId);
  const access=await requireEmployerAccess(request,employerId,"employer-admin");if(!access.ok)return access.response;
  if(!["preview","apply"].includes(String(input.action||"")))
    return NextResponse.json({error:"Use preview or apply for a pay-frequency change."},{status:400});
  const plan=await buildPlan(employerId,input.targetFrequency,input.firstPayDate);
  if("error" in plan)return NextResponse.json({error:plan.error},{status:plan.status});
  if(!plan.changed)return NextResponse.json({error:"The requested pay schedule is already active."},{status:409});
  const response={
    sourceFrequency:plan.sourceFrequency,targetFrequency:plan.targetFrequency,firstPayDate:plan.firstPayDate,
    taxYear:plan.employer.taxYear,periodCount:plan.schedule.length,
    firstPeriod:plan.schedule[0],lastPeriod:plan.schedule.at(-1),
    ...plan.assessment,fingerprint:plan.fingerprint,
  };
  if(input.action==="preview")return NextResponse.json(response);
  if(!plan.assessment.allowed)return NextResponse.json({error:"This payroll contains evidence that prevents a safe frequency change.",...response},{status:409});
  if(String(input.fingerprint||"")!==plan.fingerprint)
    return NextResponse.json({error:"Payroll evidence changed after the preview. Recalculate the frequency-change preview."},{status:409});
  if(String(input.confirmation||"")!==plan.assessment.confirmationPhrase)
    return NextResponse.json({error:`Enter “${plan.assessment.confirmationPhrase}” to confirm the change.`},{status:422});

  const db=getDb(),periodIds=plan.evidence.periods.map(period=>period.id),runIds=plan.evidence.runs.map(run=>run.id);
  const now=new Date().toISOString(),operations:any[]=[];
  if(runIds.length)operations.push(db.delete(payItems).where(inArray(payItems.payRunId,runIds)));
  if(periodIds.length)operations.push(db.delete(payrollAdjustments).where(inArray(payrollAdjustments.payPeriodId,periodIds)));
  if(runIds.length)operations.push(db.delete(payRuns).where(inArray(payRuns.id,runIds)));
  if(periodIds.length)operations.push(db.delete(payPeriods).where(inArray(payPeriods.id,periodIds)));
  operations.push(
    db.update(employers).set({payFrequency:plan.targetFrequency,updatedAt:now}).where(eq(employers.id,employerId)),
    db.update(employerSettings).set({firstPayDate:plan.firstPayDate,updatedAt:now}).where(eq(employerSettings.employerId,employerId)),
    db.update(employees).set({reportedPayFrequency:plan.targetFrequency,updatedAt:now}).where(eq(employees.employerId,employerId)),
  );
  if(plan.evidence.activeAttachments.length)operations.push(
    db.update(attachmentOrders).set({payFrequency:plan.targetFrequency,updatedAt:now})
      .where(inArray(attachmentOrders.id,plan.evidence.activeAttachments.map(order=>order.id))),
  );
  operations.push(db.insert(auditLog).values({
    employerId,actor:access.user.displayName,action:"changed:pay-frequency",entityType:"employer",entityId:String(employerId),
    before:JSON.stringify({
      payFrequency:plan.sourceFrequency,firstPayDate:plan.settings?.firstPayDate||null,
      discardedDraftPeriodIds:periodIds,discardedDraftRunIds:runIds,
    }),
    after:JSON.stringify({
      payFrequency:plan.targetFrequency,firstPayDate:plan.firstPayDate,periodCount:plan.schedule.length,
      updatedEmployeesFrequency:true,updatedActiveAttachmentIds:plan.evidence.activeAttachments.map(order=>order.id),
      discardedAdjustments:plan.evidence.adjustmentCount,previewFingerprint:plan.fingerprint,
    }),
  }));
  await db.batch(operations as [any,...any[]]);
  return NextResponse.json({...response,applied:true});
}
