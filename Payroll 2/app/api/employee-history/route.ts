import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  auditLog,
  employeeChangeRequests,
  employeeLoans,
  employees,
  expensesBenefits,
  hmrcNotices,
  leaveEvents,
  payPeriods,
  payRuns,
  pensionMembershipEvents,
  recurringPayItems,
  statutoryNotices,
} from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { formatUkDate } from "../../../lib/uk-date";

type HistoryEvent = {
  id: string;
  category: "record" | "payroll" | "leave" | "hmrc" | "statutory" | "pension" | "benefit" | "request" | "recovery" | "schedule";
  title: string;
  detail: string;
  effectiveDate: string | null;
  recordedAt: string;
  status: string;
  amount?: number;
};

const label = (value: unknown) => String(value || "").replace(/[-:]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
const sentence = (value: unknown) => String(value || "").trim().replace(/[.\s]+$/g, "");
const timestamp = (effectiveDate: string | null, recordedAt: string) => Date.parse(`${effectiveDate || recordedAt}`) || 0;
const pensionDetail = (value: string | null) => {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return [
        parsed.taxYear,
        parsed.periodNumber ? `Period ${parsed.periodNumber}` : null,
        parsed.assessment ? label(parsed.assessment) : null,
        Number.isFinite(Number(parsed.earnings)) ? `earnings £${Number(parsed.earnings).toFixed(2)}` : null,
      ].filter(Boolean).join(" · ");
    }
  } catch {}
  return value;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const employerId = Number(url.searchParams.get("employerId"));
  const employeeId = Number(url.searchParams.get("employeeId"));
  const access = await requireEmployerAccess(request, employerId);
  if (!access.ok) return access.response;
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "A valid employee is required." }, { status: 400 });

  const db = getDb();
  const [employee] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.employerId, employerId))).limit(1);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (employee.confidential && !access.membership.canViewConfidential) {
    return NextResponse.json({ error: "Confidential employee access is required." }, { status: 403 });
  }

  const [runs, leaves, notices, statutoryNoticeRows, pensionEvents, benefits, requests, loans, schedules, recordAudit] = await Promise.all([
    db.select({ run: payRuns, period: payPeriods }).from(payRuns).innerJoin(payPeriods, eq(payRuns.payPeriodId, payPeriods.id))
      .where(and(eq(payRuns.employeeId, employeeId), eq(payPeriods.employerId, employerId))).orderBy(desc(payPeriods.payDate), desc(payRuns.id)),
    db.select().from(leaveEvents).where(eq(leaveEvents.employeeId, employeeId)).orderBy(desc(leaveEvents.startDate), desc(leaveEvents.id)),
    db.select().from(hmrcNotices).where(and(eq(hmrcNotices.employerId, employerId), eq(hmrcNotices.employeeId, employeeId))).orderBy(desc(hmrcNotices.issuedDate), desc(hmrcNotices.id)),
    db.select().from(statutoryNotices).where(eq(statutoryNotices.employeeId, employeeId)).orderBy(desc(statutoryNotices.decisionDate), desc(statutoryNotices.id)),
    db.select().from(pensionMembershipEvents).where(and(eq(pensionMembershipEvents.employerId, employerId), eq(pensionMembershipEvents.employeeId, employeeId))).orderBy(desc(pensionMembershipEvents.effectiveDate), desc(pensionMembershipEvents.id)),
    db.select().from(expensesBenefits).where(eq(expensesBenefits.employeeId, employeeId)).orderBy(desc(expensesBenefits.providedDate), desc(expensesBenefits.id)),
    db.select().from(employeeChangeRequests).where(and(eq(employeeChangeRequests.employerId, employerId), eq(employeeChangeRequests.employeeId, employeeId))).orderBy(desc(employeeChangeRequests.id)),
    db.select().from(employeeLoans).where(and(eq(employeeLoans.employerId, employerId), eq(employeeLoans.employeeId, employeeId))).orderBy(desc(employeeLoans.id)),
    db.select().from(recurringPayItems).where(and(eq(recurringPayItems.employerId, employerId), eq(recurringPayItems.employeeId, employeeId))).orderBy(desc(recurringPayItems.id)),
    db.select().from(auditLog).where(and(eq(auditLog.employerId, employerId), eq(auditLog.entityType, "employee"), eq(auditLog.entityId, String(employeeId)))).orderBy(desc(auditLog.id)),
  ]);

  const events: HistoryEvent[] = [
    ...recordAudit.map(item => ({
      id: `record-${item.id}`,
      category: "record" as const,
      title: label(item.action),
      detail: `Employee record action by ${item.actor}.`,
      effectiveDate: null,
      recordedAt: item.createdAt,
      status: "recorded",
    })),
    ...runs.map(({ run, period }) => ({
      id: `payroll-${run.id}`,
      category: "payroll" as const,
      title: `${period.taxYear} · Period ${period.periodNumber} payroll`,
      detail: `Gross £${run.grossPay.toFixed(2)} · PAYE £${run.payeTax.toFixed(2)} · employee NIC £${run.employeeNic.toFixed(2)} · net £${run.netPay.toFixed(2)}.`,
      effectiveDate: period.payDate,
      recordedAt: run.updatedAt,
      status: run.status,
      amount: run.netPay,
    })),
    ...leaves.map(item => ({
      id: `leave-${item.id}`,
      category: "leave" as const,
      title: `${label(item.subtype&&item.subtype!=="none"?item.subtype:item.type)}`,
      detail: `${formatUkDate(item.startDate)} to ${formatUkDate(item.endDate)}${item.statutoryAmount ? ` · statutory pay £${item.statutoryAmount.toFixed(2)}` : ""}.`,
      effectiveDate: item.startDate,
      recordedAt: item.updatedAt,
      status: item.status,
      amount: item.statutoryAmount || undefined,
    })),
    ...notices.map(item => ({
      id: `hmrc-${item.id}`,
      category: "hmrc" as const,
      title: `HMRC ${label(item.type)} notice`,
      detail: `${item.noticeIdentifier} · effective ${item.effectiveDate}${item.taxCode ? ` · tax code ${item.taxCode}${item.week1Month1 ? " W1/M1" : ""}` : item.niNumber ? ` · NINO ${item.niNumber}` : ""}.`,
      effectiveDate: item.effectiveDate,
      recordedAt: item.updatedAt,
      status: item.status,
    })),
    ...statutoryNoticeRows.map(item => ({
      id: `statutory-${item.id}`,
      category: "statutory" as const,
      title: `${item.formType} statutory non-payment notice`,
      detail: `${label(item.statutoryType)} pay · decision ${item.decisionDate} · ${sentence(item.reason)}${item.cancellationReason ? ` · cancellation: ${sentence(item.cancellationReason)}` : ""}.`,
      effectiveDate: item.payStartDate,
      recordedAt: item.updatedAt,
      status: item.status,
    })),
    ...pensionEvents.map(item => ({
      id: `pension-${item.id}`,
      category: "pension" as const,
      title: `Pension ${label(item.eventType)}`,
      detail: `${label(item.previousStatus || "not enrolled")} → ${label(item.newStatus)}${pensionDetail(item.details) ? ` · ${pensionDetail(item.details)}` : ""}.`,
      effectiveDate: item.effectiveDate,
      recordedAt: item.createdAt,
      status: item.newStatus,
    })),
    ...benefits.map(item => ({
      id: `benefit-${item.id}`,
      category: "benefit" as const,
      title: `${label(item.category)} benefit`,
      detail: `${item.description || "Expense or benefit"} · cash equivalent £${item.cashEquivalent.toFixed(2)} · ${label(item.nicTreatment)}.`,
      effectiveDate: item.providedDate,
      recordedAt: item.updatedAt,
      status: item.status,
      amount: item.cashEquivalent,
    })),
    ...requests.map(item => ({
      id: `request-${item.id}`,
      category: "request" as const,
      title: `${label(item.requestType)} portal request`,
      detail: item.reviewNote || item.employeeNote || "Employee change request recorded.",
      effectiveDate: null,
      recordedAt: item.updatedAt,
      status: item.status,
    })),
    ...loans.map(item => ({
      id: `recovery-${item.id}`,
      category: "recovery" as const,
      title: `${label(item.type)} recovery`,
      detail: `${item.reference} · original £${item.originalAmount.toFixed(2)} · balance £${item.balance.toFixed(2)}.`,
      effectiveDate: item.startDate,
      recordedAt: item.updatedAt,
      status: item.status,
      amount: item.balance,
    })),
    ...schedules.map(item => ({
      id: `schedule-${item.id}`,
      category: "schedule" as const,
      title: `${item.name} pay schedule`,
      detail: `${label(item.type)} · £${item.amount.toFixed(2)} · periods ${item.startPeriod}–${item.endPeriod}.`,
      effectiveDate: null,
      recordedAt: item.updatedAt,
      status: item.status,
      amount: item.amount,
    })),
  ].sort((left, right) => timestamp(right.effectiveDate, right.recordedAt) - timestamp(left.effectiveDate, left.recordedAt));

  return NextResponse.json({
    employee: { id: employee.id, payrollId: employee.payrollId, name: `${employee.firstName} ${employee.lastName}`, confidential: employee.confidential },
    events,
    summary: {
      total: events.length,
      payrollRuns: runs.length,
      leaveEvents: leaves.length,
      notices: notices.length,
      statutoryNotices: statutoryNoticeRows.length,
      pensionEvents: pensionEvents.length,
      benefits: benefits.length,
      requests: requests.length,
    },
  });
}
