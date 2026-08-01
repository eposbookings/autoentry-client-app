import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLog, employerCalendarDays, employees, employers, leaveEvents } from "../../../db/schema";
import { requireEmployerAccess } from "../../../lib/admin-auth";
import { leaveYearRange } from "../../../lib/leave-entitlement";
import { readJsonObject } from "../../../lib/request-body";

const types = new Set(["national-holiday", "company-closure"]);
const validIsoDate = (value: unknown) => {
  const text = String(value || ""), parsed = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === text;
};
const dateInTaxYear = (date: string, taxYear: string) => {
  try { const range = leaveYearRange(taxYear); return date >= range.start && date <= range.end; } catch { return false; }
};
const includesFrozenDate = (value: string, date: string) => {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) && parsed.includes(date); } catch { return false; }
};

export async function GET(request: Request) {
  const url = new URL(request.url), employerId = Number(url.searchParams.get("employerId")), taxYear = String(url.searchParams.get("taxYear") || "");
  const access = await requireEmployerAccess(request, employerId);
  if (!access.ok) return access.response;
  const [employer] = await getDb().select({ taxYear: employers.taxYear }).from(employers).where(eq(employers.id, employerId)).limit(1);
  if (!employer) return NextResponse.json({ error: "Employer was not found." }, { status: 404 });
  const selectedTaxYear = taxYear || employer.taxYear;
  if (!/^\d{4}\/\d{2}$/.test(selectedTaxYear))
    return NextResponse.json({ error: "Select a valid tax year." }, { status: 422 });
  const days = await getDb().select().from(employerCalendarDays).where(and(
    eq(employerCalendarDays.employerId, employerId), eq(employerCalendarDays.taxYear, selectedTaxYear),
  )).orderBy(desc(employerCalendarDays.date), desc(employerCalendarDays.id));
  return NextResponse.json({ taxYear: selectedTaxYear, days });
}

export async function POST(request: Request) {
  const input = await readJsonObject(request);
  if (!input) return NextResponse.json({ error: "A JSON calendar-day object is required." }, { status: 400 });
  const employerId = Number(input.employerId), taxYear = String(input.taxYear || ""), date = String(input.date || "");
  const name = String(input.name || "").trim(), type = String(input.type || "national-holiday");
  const access = await requireEmployerAccess(request, employerId, "employee-write");
  if (!access.ok) return access.response;
  if (!/^\d{4}\/\d{2}$/.test(taxYear) || !validIsoDate(date) || !dateInTaxYear(date, taxYear))
    return NextResponse.json({ error: "The calendar date must fall within the selected tax year." }, { status: 422 });
  if (!types.has(type)) return NextResponse.json({ error: "Select national holiday or company closure." }, { status: 422 });
  if (name.length < 2 || name.length > 100) return NextResponse.json({ error: "Calendar-day name must contain 2 to 100 characters." }, { status: 422 });
  const db = getDb(), [existing] = await db.select().from(employerCalendarDays).where(and(
    eq(employerCalendarDays.employerId, employerId), eq(employerCalendarDays.date, date), eq(employerCalendarDays.type, type),
  )).limit(1);
  if (existing) return NextResponse.json({ error: existing.status === "active" ? "This employer calendar day already exists." : "This calendar day exists in cancelled history. Restore it instead." }, { status: 409 });
  const now = new Date().toISOString(), [created] = await db.insert(employerCalendarDays).values({ employerId, taxYear, date, name, type, status: "active", createdAt: now, updatedAt: now }).returning();
  await db.insert(auditLog).values({ employerId, actor: access.user.displayName, action: "created:employer-calendar-day", entityType: "employer-calendar-day", entityId: String(created.id), after: JSON.stringify(created) });
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(request: Request) {
  const input = await readJsonObject(request);
  if (!input) return NextResponse.json({ error: "A JSON calendar-day update is required." }, { status: 400 });
  const employerId = Number(input.employerId), id = Number(input.id), action = String(input.action || "");
  const access = await requireEmployerAccess(request, employerId, "employee-write");
  if (!access.ok) return access.response;
  if (!["cancel", "restore"].includes(action)) return NextResponse.json({ error: "Calendar days can only be cancelled or restored." }, { status: 422 });
  const db = getDb(), [existing] = await db.select().from(employerCalendarDays).where(and(eq(employerCalendarDays.id, id), eq(employerCalendarDays.employerId, employerId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Employer calendar day was not found." }, { status: 404 });
  const nextStatus = action === "restore" ? "active" : "cancelled";
  if (existing.status === nextStatus) return NextResponse.json({ error: `This calendar day is already ${nextStatus}.` }, { status: 409 });
  const [updated] = await db.update(employerCalendarDays).set({ status: nextStatus, updatedAt: new Date().toISOString() }).where(eq(employerCalendarDays.id, id)).returning();
  const employeeLeave = await db.select({ excludedCalendarDates: leaveEvents.excludedCalendarDates }).from(leaveEvents)
    .innerJoin(employees, eq(leaveEvents.employeeId, employees.id)).where(eq(employees.employerId, employerId));
  const frozenLeaveEvents = employeeLeave.filter(event => includesFrozenDate(event.excludedCalendarDates, existing.date)).length;
  await db.insert(auditLog).values({ employerId, actor: access.user.displayName, action: `${action}:employer-calendar-day`, entityType: "employer-calendar-day", entityId: String(id), before: JSON.stringify(existing), after: JSON.stringify({ ...updated, frozenLeaveEvents }) });
  return NextResponse.json({ ...updated, frozenLeaveEvents });
}
