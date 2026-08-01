import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const requiredRoutes = [
  "employees", "pay-runs", "leave", "pensions", "submissions", "hmrc-notices", "hmrc-payments",
  "hmrc-liabilities", "cis", "reports", "analysis", "exports", "year-end",
  "attachments", "benefits", "agent", "pay-frequency", "recurring-items", "adjustments", "portal/session", "portal/me", "portal/requests", "portal/documents",
  "statutory-notices", "payslip-deliveries", "email-templates", "calendar-days", "holiday-funds",
  "admin/session", "admin/users", "employee-requests", "employee-history",
];

test("build contains the complete payroll workspace", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  for (const section of ["Payroll", "Employees", "Employer", "HMRC", "RTI", "CIS", "Pensions", "Reports"]) {
    assert.match(page, new RegExp(`["']${section}["']`), `${section} workspace is missing`);
  }
  assert.match(page, /Add another pay item/);
  assert.match(page, /Finalise payslips/);
  assert.match(page, /Email payslips/);
  assert.match(page, /Publish to portal/);
  assert.match(page, /Delivery history/);
  assert.match(page, /Awaiting approved email provider/);
  assert.match(page, /resend:true/);
  await access("dist/server/index.js");
});

test("leave calendars highlight recorded events and all visible registers use UK dates",async()=>{
  const [page,styles,portal,history,reports,dateUtility]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),readFile("app/portal/page.tsx","utf8"),
    readFile("app/api/employee-history/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),readFile("lib/uk-date.ts","utf8"),
  ]);
  assert.match(page,/data-event-type=\{activeEvent\?\.type\|\|undefined\}/);
  for(const eventClass of ["event-annual","event-family","event-sick","event-other"])assert.match(page,new RegExp(eventClass));
  assert.match(styles,/button\.has-event\.event-annual:not\(\.in-range\)/);
  assert.match(styles,/button\.has-event\.event-family:not\(\.in-range\)/);
  assert.match(styles,/button\.has-event\.event-sick:not\(\.in-range\)/);
  assert.match(page,/formatUkDate\(event\.startDate\).*formatUkDate\(event\.endDate\)/);
  assert.match(page,/Started \$\{formatUkDate\(e\.startDate\)\}/);
  assert.match(portal,/formatUkDate\(item\.createdAt\)/);
  assert.match(history,/formatUkDate\(item\.startDate\).*formatUkDate\(item\.endDate\)/);
  assert.match(reports,/formatUkDate\(r\.startDate\).*formatUkDate\(r\.endDate\)/);
  assert.match(dateUtility,/dayText\}\/\$\{monthText\}\/\$\{yearText/);
});

test("project handoff documents the implemented payroll and external filing boundary",async()=>{
  const readme=await readFile("README.md","utf8");
  assert.match(readme,/PayFlow UK Payroll/);
  assert.match(readme,/tenant-isolated UK payroll workspace for the 2026\/27 tax year/);
  assert.match(readme,/Live HMRC transmission requires HMRC software recognition/);
  assert.match(readme,/NINO Verification Requests are disabled/);
  assert.match(readme,/Bacs hash cross-reference process is treated as retired/);
  assert.match(readme,/Retained payroll versions use the same validation and atomic restore path/);
  assert.doesNotMatch(readme,/vinext-starter|starts intentionally empty|rendered loading skeleton/);
});

test("sample payroll reinstatement creates a separate audited tenant with rollback protection",async()=>{
  const [page,styles,route,samples,schema]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),readFile("app/api/scenarios/route.ts","utf8"),
    readFile("lib/sample-payroll.ts","utf8"),readFile("db/schema.ts","utf8"),
  ]);
  assert.match(route,/input\.action!=="create-isolated-sample"/);
  assert.match(route,/input\.confirmation!=="CREATE ISOLATED SAMPLE"/);
  assert.match(route,/const user=await currentAdmin\(request\)/);
  assert.match(route,/\["owner","admin"\]\.includes\(item\.role\)/);
  assert.match(route,/db\.insert\(employers\)/);
  assert.match(route,/\.\.\.employeeRows\.map\(employee=>db\.insert\(employees\)\.values\(employee\)\)/);
  assert.match(route,/db\.batch\(sampleCreationOperations as \[any,\.\.\.any\[\]\]\)/);
  assert.match(route,/db\.insert\(pensionSchemes\)/);
  assert.match(route,/db\.insert\(subcontractors\)/);
  assert.match(route,/created:isolated-sample-payroll/);
  assert.match(route,/await db\.delete\(employees\)\.where\(eq\(employees\.employerId,employer\.id\)\)/);
  assert.match(route,/every sample record was rolled back/);
  assert.match(samples,/sampleEmployeeProfiles/);
  assert.match(samples,/DEMO-020/);
  assert.match(samples,/sampleSubcontractors/);
  assert.match(page,/Create fresh sample payroll/);
  assert.match(page,/No current payroll data will be changed/);
  assert.match(page,/window\.location\.assign\(`\/\?employerId=\$\{body\.employerId\}`\)/);
  assert.match(page,/requestedEmployerIdFromLocation=.*URLSearchParams\(window\.location\.search\)/s);
  assert.match(page,/String\(membership\.employerId\)===requestedEmployerId/);
  assert.match(page,/"Reinstate sample data"/);
  assert.match(page,/"Toolbar"/);
  assert.match(page,/item==="Close all windows"\?"Not applicable"/);
  assert.match(styles,/\.sample-payroll-body/);
  for(const table of ["employers","employerSettings","employerMemberships","employees","pensionSchemes","subcontractors","auditLog"])assert.match(schema,new RegExp(`export const ${table}`));
});

test("responsive payroll keeps employer selection visible without document overflow",async()=>{
  const [page,styles]=await Promise.all([readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8")]);
  assert.match(styles,/@media\(max-width:820px\)/);
  assert.match(styles,/\.company\{display:flex;flex:1;min-width:0\}/);
  assert.match(styles,/\.employer-switcher\{min-width:0;max-width:none;width:100%\}/);
  assert.match(styles,/\.employer-switcher-menu\{position:fixed;left:8px;right:8px;top:54px;width:auto\}/);
  assert.match(styles,/\.employer-switcher-results\{max-height:min\(430px,60vh\);overflow:auto/);
  assert.match(styles,/\.workspace\{display:block\}\.employee-list\{display:none\}/);
  assert.match(styles,/\.toolbar,.period-wrap,.workspace\{max-width:100%;min-width:0\}/);
  assert.match(styles,/\.toolbar\{overflow-x:auto;overflow-y:hidden\}/);
  assert.match(styles,/\.company,.workspace>\*,.periods\{min-width:0\}/);
  assert.match(page,/className="employee-scroll-list"/);
  assert.match(styles,/\.employee-scroll-list\{[\s\S]*?overflow-y:auto/);
  assert.match(styles,/\.workspace\{[\s\S]*?height:calc\(100vh - 206px\)[\s\S]*?overflow:hidden/);
  assert.match(styles,/\.pay-editor\{height:100%;max-height:none;overscroll-behavior:contain\}/);
  assert.match(styles,/\.summary\{height:100%;max-height:none;top:auto;overscroll-behavior:contain\}/);
  assert.match(styles,/\.file-action\.primary\{background:var\(--teal\);border-color:var\(--teal\);color:#fff\}/);
  assert.match(page,/const fetchWorkspaceResource=async\(url:string,init\?:RequestInit\)=>/);
  assert.match(page,/const retryableWorkspaceStatus=\(status:number\)=>\[500,502,503,504\]\.includes\(status\)/);
  assert.match(page,/for\(let attempt=0;attempt<3;attempt\+\+\)/);
  assert.match(page,/const readJsonResponse=async\(response:Response\)=>/);
  assert.match(page,/if\(!text\)return null/);
  assert.match(page,/fetchWorkspaceResource\("\/api\/admin\/session\?employerId=1"\)/);
  assert.match(page,/Payroll sign-in service is temporarily unavailable/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/pay-runs\?employerId=/);
  assert.match(page,/SummaryLine label="Employees" value=\{draft\?\.employeeCount\|\|0\} format="number"/);
  assert.doesNotMatch(page,/c\.cards\.map/);
  assert.doesNotMatch(page,/const config: Record<string, \{ title: string; subtitle: string \}>/);
  assert.match(page,/className="module" data-module=\{active\.toLowerCase\(\)\}/);
  assert.match(page,/className="module-content"/);
  assert.match(styles,/Shared application workspace: carry the approved payroll hierarchy through every module/);
  assert.match(styles,/Payroll-only canvas colour trial/);
  assert.match(styles,/\.workspace\{background:#dfe9ea\}/);
  assert.match(styles,/Payroll outer-pane outlines: frame the three primary work areas, not each inner section/);
  assert.match(styles,/\.employee-list,[\s\S]*?\.pay-editor,[\s\S]*?\.summary\{[\s\S]*?border:2px solid #91adb1/);
  assert.match(styles,/\.employee-scroll-list>button\.selected\{[\s\S]*?border:2px solid #087b79/);
  assert.doesNotMatch(page,/className="page-title payroll-employee-heading"/);
  assert.match(page,/className="payroll-leave-column"/);
  assert.doesNotMatch(page,/className="payroll-employee-action"/);
  assert.match(page,/className="outline summary-edit"[\s\S]*?>✎ Edit employee</);
  assert.match(styles,/\.payroll-leave-column\{[\s\S]*?align-self:stretch/);
  assert.match(styles,/\.payroll-secondary-grid>\.deductions-card\{grid-column:1\/-1;grid-row:1\}/);
  assert.match(styles,/\.payroll-secondary-grid>\.notes-card\{display:block;grid-column:2;grid-row:2/);
  assert.doesNotMatch(page,/Take-home pay<\/span><strong>\{money\(data\.totals\.netPay\)\}/);
  assert.doesNotMatch(page,/Pension funding<\/span><strong>\{money\(data\.totals\.employeePension/);
});

test("employer calendar days are tenant-scoped, frozen into leave evidence, and recoverable",async()=>{
  const [page,styles,calendarRoute,leaveRoute,schema,migration,data]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),readFile("app/api/calendar-days/route.ts","utf8"),
    readFile("app/api/leave/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0060_employer_calendar_days.sql","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(page,/Employer calendar and national holidays/);
  assert.match(page,/EmployerCalendarWorkspace/);
  assert.match(page,/EmployerCalendarWorkspace canWrite=\{canEmployeeWrite\} onAddEmployee=\{onAddEmployee\}/);
  assert.match(page,/<span className="status">\{activeDays\.length\} active<\/span><button className="primary" disabled=\{!canWrite\} onClick=\{onAddEmployee\}>＋ Add employee<\/button><button onClick=\{\(\)=>setOpen/);
  assert.match(page,/CalendarModal employee=\{employee\} period=\{period\}/);
  assert.match(page,/selectionMode=\{automaticScheduleWeeks\?"start":"range"\}/);
  assert.match(page,/Choose one date\. The \$\{automaticScheduleWeeks\}-week statutory schedule and end date will be selected automatically\./);
  assert.match(page,/Calculated statutory pay end/);
  assert.match(page,/Restore automatic end date/);
  assert.match(page,/initialPeriodRange=paySchedule\.find\(item=>item\.periodNumber===period\)\|\|paySchedule\[0\]/);
  assert.match(page,/initialStartDate=initialPeriodRange\.periodStart/);
  assert.match(page,/calendarExclusions\.map\(item=>item\.date\)/);
  assert.match(page,/excluded dates are frozen into the leave record/);
  assert.match(styles,/\.employer-calendar-card/);
  assert.match(schema,/employerCalendarDays/);
  assert.match(schema,/excludedCalendarDates/);
  assert.match(migration,/CREATE TABLE `employer_calendar_days`/);
  assert.match(migration,/ALTER TABLE `leave_events` ADD `excluded_calendar_dates`/);
  assert.match(calendarRoute,/requireEmployerAccess\(request, employerId, "employee-write"\)/);
  assert.match(calendarRoute,/eq\(employerCalendarDays\.employerId, employerId\)/);
  assert.match(calendarRoute,/eq\(employees\.employerId, employerId\)/);
  assert.match(leaveRoute,/eq\(employerCalendarDays\.status,"active"\)/);
  assert.match(leaveRoute,/countWorkingDays\(String\(input\.startDate\),String\(input\.endDate\),qualifyingWeekdays,workPatternLeave\?excludedCalendarDates:\[\]\)/);
  assert.match(leaveRoute,/excludedCalendarDates:workPatternLeave\?JSON\.stringify\(excludedCalendarDates\):"\[\]"/);
  assert.match(data,/"employerCalendarDays"/);
  assert.match(data,/schemaVersion:7/);
  assert.match(data,/insert\(employerCalendarDays,dataset\.employerCalendarDays\)/);
});

test("leave locking uses persisted payroll date ranges for every pay frequency",async()=>{
  const route=await readFile("app/api/leave/route.ts","utf8");
  assert.match(route,/periodStart:payPeriods\.periodStart,periodEnd:payPeriods\.periodEnd/);
  assert.match(route,/payrollPeriodOverlaps\(period,String\(input\.startDate\),String\(input\.endDate\)\)/);
  assert.match(route,/payrollPeriodOverlaps\(period,event\.startDate,event\.endDate\)/);
  assert.doesNotMatch(route,/taxMonthRange\(period\.taxYear,period\.periodNumber\)/);
});

test("benefit correction locks use persisted payroll date ranges for every pay frequency",async()=>{
  const route=await readFile("app/api/benefits/route.ts","utf8");
  assert.match(route,/periodStart:payPeriods\.periodStart,periodEnd:payPeriods\.periodEnd/);
  assert.match(route,/payrolledBenefitForRange\(source,taxYear,period\.periodStart,period\.periodEnd\)/);
  assert.doesNotMatch(route,/payrolledBenefitForPeriod\(source,period\.periodNumber,taxYear\)/);
});

test("leave calendar defaults to the employer pay schedule rather than a tax month",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/function CalendarModal[\s\S]*?scheduledPayPeriods\(taxYear,payFrequency,firstPayDate\|\|undefined\)/);
  assert.match(page,/initialPeriodRange=paySchedule\.find\(item=>item\.periodNumber===period\)\|\|paySchedule\[0\]/);
  assert.doesNotMatch(page,/initialPeriodRange=taxMonthRange\(taxYear,period\)/);
});

test("required payroll API modules are present", async () => {
  await Promise.all(requiredRoutes.map(route => access(`app/api/${route}/route.ts`)));
});

test("payslip delivery validates finalised payroll and records auditable provider boundaries", async()=>{
  const route=await readFile("app/api/payslip-deliveries/route.ts","utf8");
  assert.match(route,/period\.status!=="finalised"/);
  assert.match(route,/PAYSLIP-DELIVERY/);
  assert.match(route,/queued-external/);
  assert.match(route,/externalTransmission:method==="email"\?false:null/);
  assert.match(route,/This exact payslip delivery batch has already been recorded/);
  assert.match(route,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(route,/excludedCount:excluded\.length/);
  assert.match(route,/access\.membership\.canViewConfidential\?rows:rows\.filter/);
  assert.match(route,/hiddenPayrollIds/);
  assert.match(route,/const runIdentity=/);
  assert.match(route,/Object\.prototype\.hasOwnProperty\.call\(snapshot,field\)/);
  assert.match(route,/recipients=eligible\.map\(\(\{employee,run\}\)=>\{/);
  assert.match(route,/employeeId:employee\.id,\.\.\.identity,destination/);
  assert.match(route,/sourceChecksum=await sha256\(JSON\.stringify\(\{employerId,taxYear,periodNumber,method,recipients\}\)\)/);
});

test("email templates are tenant-scoped, token validated, personalised and retained in recovery",async()=>{
  const [page,styles,templates,delivery,helper,data]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),
    readFile("app/api/email-templates/route.ts","utf8"),readFile("app/api/payslip-deliveries/route.ts","utf8"),
    readFile("lib/email-template.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(page,/EmailTemplateSettings/);
  assert.match(page,/EmailPayslipsModal/);
  assert.match(page,/Preview and queue email messages/);
  assert.match(page,/Delivery and email log/);
  assert.match(page,/A resend uses the current default template/);
  assert.match(page,/"Email setup","Email log"/);
  assert.match(styles,/\.email-template-settings/);
  assert.match(styles,/\.email-message-preview/);
  assert.match(templates,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(templates,/eq\(submissions\.employerId,employerId\)/);
  assert.match(templates,/An active email template already uses this name/);
  assert.match(templates,/item\.template\.reportType===template\.reportType/);
  assert.match(templates,/payloadChecksum=await sha256\(JSON\.stringify\(template\)\)/);
  assert.match(templates,/archived:email-template/);
  assert.match(helper,/unsupported token/);
  assert.match(helper,/"report\+period"/);
  assert.match(delivery,/payflow-payslip-delivery-2/);
  assert.match(delivery,/renderEmailTemplate\(selectedTemplate\.subject,context\)/);
  assert.match(delivery,/renderEmailTemplate\(selectedTemplate\.body,context\)/);
  assert.match(delivery,/\["payslip","general"\]\.includes\(selectedTemplate\.reportType\)/);
  assert.match(delivery,/latestSameMethod=input\.resend/);
  assert.match(delivery,/resendOf:input\.resend\?\(duplicate\?\.id\|\|latestSameMethod\?\.id\|\|null\):null/);
  assert.match(data,/parseStoredEmailTemplate/);
  assert.match(data,/email-template evidence is malformed/i);
});

test("payroll request inbox enforces confidential employee access and guarded review",async()=>{
  const [page,route]=await Promise.all([readFile("app/page.tsx","utf8"),readFile("app/api/employee-requests/route.ts","utf8")]);
  assert.match(page,/Employee portal request inbox/);
  assert.match(page,/onClick=\{\(\)=>setModal\("requests"\)\}/);
  assert.match(page,/decision==="approved"\?refresh\(\)/);
  assert.match(route,/access\.membership\.canViewConfidential\|\|!row\.confidential/);
  assert.match(route,/employee\.confidential&&!access\.membership\.canViewConfidential/);
  assert.match(route,/values have not changed|conflicts\.length/);
});

test("neonatal care pay retains statutory evidence and enforces accrued whole weeks",async()=>{
  const [page,route,schema,migration,engine]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/leave/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0036_neonatal_care_claim_evidence.sql","utf8"),readFile("lib/neonatal-care.ts","utf8"),
  ]);
  for(const field of ["childBirthDate","neonatalCareStartDate","neonatalCareEndDate","neonatalTier","relationshipDeclaration","caringResponsibilityDeclaration"])assert.match(schema,new RegExp(field));
  assert.match(migration,/child_birth_date/);
  assert.match(page,/Neonatal care evidence/);
  assert.match(page,/Tier 2 · later continuous block/);
  assert.match(route,/assessNeonatalCareClaim/);
  assert.match(route,/Tier 2 Neonatal Care Pay must be taken as one continuous block/);
  assert.match(route,/previouslyClaimedWeeks\+neonatalClaim\.claimedWeeks/);
  assert.match(engine,/within 68 weeks/);
});

test("grouped family pay enforces cumulative blocks, maternity timelines and 2026 bereavement rights",async()=>{
  const [page,route,schema,migration,payPeriodMigration,engine,allocation,eligibility]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/leave/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0037_family_pay_entitlement.sql","utf8"),readFile("drizzle/0038_statutory_pay_period_start.sql","utf8"),
    readFile("lib/family-pay.ts","utf8"),readFile("lib/pay-periods.ts","utf8"),readFile("lib/statutory-eligibility.ts","utf8"),
  ]);
  for(const field of ["familyEventReference","familyEventDate","familyEventKind","sharedPayWeeksAvailable"])assert.match(schema,new RegExp(field));
  assert.match(migration,/family_event_reference/);
  assert.match(payPeriodMigration,/statutory_pay_period_start/);
  assert.match(schema,/statutoryPayPeriodStart/);
  assert.match(page,/Family-pay entitlement/);
  assert.match(page,/ShPP weeks made available/);
  assert.match(page,/statutory-rate timeline are enforced cumulatively/);
  assert.match(page,/Day-one bereavement-pay service rule applies/);
  assert.match(route,/previousClaimedWeeks:relatedFamilyClaims\.reduce/);
  assert.match(route,/assessMaternityAdoptionPayClaim/);
  assert.match(route,/payPeriodDayOffset:maternityAdoptionClaim\?\.payPeriodDayOffset/);
  assert.match(route,/statutoryPayPeriodStart:maternityAdoptionClaim\?\.payPeriodStart/);
  assert.match(route,/Reuse family-event reference/);
  assert.match(route,/availability must match the first block/);
  assert.match(engine,/maxBlocks:3/);
  assert.match(engine,/39-week statutory-pay period ends/);
  assert.match(allocation,/paidDayIndex<42/);
  assert.match(engine,/within \$\{rules\.windowWeeks\} weeks/);
  assert.match(eligibility,/type!=="bereavement"&&input\.continuousEmploymentWeeks<26/);
});

test("KIT and SPLIT days are persisted and capped across related statutory claims",async()=>{
  const [page,route,schema,migration,engine]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/leave/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0039_statutory_touch_days.sql","utf8"),readFile("lib/statutory-touch-days.ts","utf8"),
  ]);
  assert.match(schema,/statutoryTouchDays/);
  assert.match(migration,/statutory_touch_days/);
  assert.match(route,/assessStatutoryTouchDays/);
  assert.match(route,/previousDays:relatedFamilyClaims\.flatMap/);
  assert.match(route,/JSON\.stringify\(statutoryTouchDays\)/);
  assert.match(page,/SPLIT":"KIT"} work days/);
  assert.match(page,/SPLIT/);
  assert.match(page,/Contractual pay for work must be entered separately/);
  assert.match(engine,/limit=kind==="kit"\?10:20/);
  assert.match(engine,/ordinary worked-week exclusion workflow/);
});

test("ordinary worked weeks reduce statutory pay and recovery without moving entitlement dates",async()=>{
  const [page,route,schema,migration,engine,allocation,hmrc]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/leave/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0040_statutory_worked_weeks.sql","utf8"),readFile("lib/statutory-work-weeks.ts","utf8"),
    readFile("lib/pay-periods.ts","utf8"),readFile("app/api/hmrc-liabilities/route.ts","utf8"),
  ]);
  assert.match(schema,/statutoryWorkedWeeks/);
  assert.match(schema,/statutoryPaidDayOffset/);
  assert.match(migration,/statutory_worked_weeks/);
  assert.match(migration,/julianday\(`start_date`\)/);
  assert.match(route,/assessStatutoryWorkedWeeks/);
  assert.match(route,/ordinaryWorkDates/);
  assert.match(route,/priorExcludedWeeks/);
  assert.match(route,/JSON\.stringify\(workedWeekAssessment\.weeks\)/);
  assert.match(page,/Ordinary work and unpaid statutory weeks/);
  assert.match(page,/Exclude affected pay week/);
  assert.match(engine,/Only one exclusion is recorded for statutory-pay week/);
  assert.match(engine,/cannot be both a protected KIT or SPLIT day/);
  assert.match(allocation,/workedWeekStarts\.has\(weekStart\)/);
  assert.match(allocation,/statutoryPaidDayOffset/);
  assert.match(hmrc,/statutoryWorkedWeeks:leaveEvents\.statutoryWorkedWeeks/);
});

test("authenticated employer selection scopes every operational workspace", async () => {
  const [page,sessionRoute] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/api/admin/session/route.ts","utf8"),
  ]);
  assert.match(page,/EmployerContext\.Provider/);
  assert.match(page,/TaxYearContext\.Provider/);
  assert.match(page,/aria-label=\{`Active employer: \$\{activeMembership\?\.employerName\|\|"Select employer"\}`\}/);
  assert.match(page,/aria-label="Search employer payrolls"/);
  assert.match(page,/role="listbox" aria-label="Available employer payrolls"/);
  assert.match(page,/`Employer #\$\{membership\.employerId\}`/);
  assert.match(page,/if\(event\.key==="Escape"\)\{setOpen\(false\);setQuery\(""\);\}/);
  assert.match(page,/if\(event\.key==="Enter"&&filtered\.length===1\)choose\(filtered\[0\]\.employerId\)/);
  assert.match(page,/url\.searchParams\.set\("employerId",String\(id\)\)/);
  assert.match(page,/window\.history\.replaceState\(\{\},"",url\)/);
  assert.match(page,/key=\{`\$\{activeMembership\?\.employerId\|\|activeEmployerId\}:\$\{activeMembership\?\.taxYear/);
  const operationalSource=page.slice(page.indexOf("function PayrollApp"));
  assert.doesNotMatch(operationalSource,/employerId\s*:\s*1|employerId=1/);
  for (const workspace of ["PayrollApp","DataToolsWorkspace","AccessWorkspace","EmployerWorkspace","CisWorkspace","RtiWorkspace","HmrcWorkspace","PensionsWorkspace","ReportsWorkspace","CalendarModal","PayItemModal","ScheduleModal","AdjustmentModal","BenefitModal","AttachmentModal"]) {
    const start=page.indexOf(`function ${workspace}`);
    assert.notEqual(start,-1,`${workspace} is missing`);
  }
  assert.match(sessionRoute,/leftJoin\(employerSettings/);
  assert.match(sessionRoute,/clientStatus:employerSettings\.clientStatus/);
  assert.match(page,/Client tracking and year end/);
  assert.match(page,/onSwitchEmployer\(client\.employerId\)/);
  assert.match(page,/yearEndResponse=await fetch\(`\/api\/year-end\?employerId=/);
});

test("operational mutations require explicit tenant IDs and structured JSON",async()=>{
  const helper=await readFile("lib/request-body.ts","utf8");
  assert.match(helper,/typeof input==="object"&&!Array\.isArray\(input\)/);
  const routes=[
    "adjustments","attachments","benefits","calculate","employees","exports","hmrc-notices","hmrc-payments",
    "leave","pay-runs","recurring-items","statutory-notices","admin/session","admin/users",
  ];
  for(const name of routes){
    const source=await readFile(`app/api/${name}/route.ts`,"utf8");
    assert.match(source,/readJsonObject/,`${name} must reject malformed JSON`);
    assert.doesNotMatch(source,/input\.employerId\s*\|\|\s*1/,`${name} must not default a mutation to employer 1`);
  }
  for(const name of routes.filter(name=>!["calculate","admin/session"].includes(name))){
    const source=await readFile(`app/api/${name}/route.ts`,"utf8");
    assert.match(source,/Number\(input\.employerId\)/,`${name} must use the explicit employer ID`);
  }
});

test("complete backup restore is owner-only, validated, atomic and access-preserving", async () => {
  const [route,page]=await Promise.all([readFile("app/api/data/route.ts","utf8"),readFile("app/page.tsx","utf8")]);
  assert.match(route,/\["verify-backup","analyse-restore","restore-backup"\]/);
  assert.match(route,/access\.membership\.role!=="owner"/);
  assert.match(route,/Backup relationship validation failed/);
  assert.match(route,/confirmationPhrase=`RESTORE \$\{employer\.name\} \$\{checksum\.slice\(0,8\)\.toUpperCase\(\)\}`/);
  assert.match(route,/db\.batch\(operations as \[any,\.\.\.any\[\]\]\)/);
  assert.match(route,/const pushChunkedDelete=/);
  assert.match(route,/values\.slice\(index,index\+75\)/);
  assert.match(route,/pushChunkedDelete\(payItems,payItems\.payRunId,runIds\)/);
  assert.match(route,/pushChunkedDelete\(payRuns,payRuns\.id,runIds\)/);
  assert.match(route,/pushChunkedDelete\(employeePortalSessions,employeePortalSessions\.employeeId,employeeIds\)/);
  assert.match(route,/administratorAccessPreserved:true/);
  assert.doesNotMatch(route,/db\.delete\(employers\)/);
  assert.match(route,/action:"restored:complete-backup"/);
  assert.match(route,/new Set\(values\)\.size!==values\.length/);
  assert.match(route,/Every record must have a unique positive integer ID/);
  assert.match(route,/Only one employer settings record is permitted/);
  assert.match(route,/Confidential employee permission is required to create a complete employer backup/);
  assert.match(route,/currentRestoreFingerprint/);
  assert.match(route,/currentFingerprint:current\.fingerprint/);
  assert.match(route,/Current payroll data changed after the recovery analysis/);
  assert.match(page,/currentFingerprint:restoreAnalysis\.currentFingerprint/);
  assert.match(route,/row\.pensionSchemeId&&!schemeIds\.has\(row\.pensionSchemeId\)/);
  assert.match(route,/leave&&leave\.employeeId!==row\.employeeId/);
  assert.match(route,/membership\.employeeId!==row\.employeeId\|\|membership\.schemeId!==row\.schemeId/);
  assert.match(route,/order\.employeeId!==run\.employeeId/);
  assert.match(route,/recurring\.employeeId!==run\.employeeId/);
  assert.match(route,/A JSON data operation object is required/);
  assert.match(route,/Backup payroll-state validation failed/);
  assert.match(route,/duplicatePayrollId/);
  assert.match(route,/duplicatePeriod/);
  assert.match(route,/duplicateRun/);
  assert.match(route,/activeSchemes\.length>1/);
  assert.match(page,/Analyse recovery file/);
  assert.match(page,/aria-label="Restore confirmation"/);
  assert.match(page,/restoreConfirmation!==restoreAnalysis\.confirmationPhrase/);
});

test("backup recovery validates and preserves the employer payroll schedule",async()=>{
  const [route,validator,employeeValidator]=await Promise.all([
    readFile("app/api/data/route.ts","utf8"),readFile("lib/employer-cis-state-evidence.ts","utf8"),
    readFile("lib/employee-state-evidence.ts","utf8"),
  ]);
  assert.match(validator,/\["monthly","weekly","fortnightly","four-weekly"\]/);
  assert.match(employeeValidator,/\["monthly","weekly","fortnightly","four-weekly"\]\.includes\(String\(row\.reportedPayFrequency/);
  assert.match(route,/restoredFrequency=payrollFrequencyRule\(employer\.payFrequency\)\.frequency/);
  assert.match(route,/restoredSchedule=scheduledPayPeriods\(employer\.taxYear,restoredFrequency/);
  assert.match(route,/maximumPeriods=payrollFrequencyRule\(restoredFrequency\)\.maximumPeriods/);
  assert.match(route,/row\.firstPayFlowPeriod>\(row\.taxYear===dataset\.employers\[0\]\.taxYear\?restoredSchedule\.length:maximumPeriods\)/);
  assert.match(route,/row\.payDate!==scheduled\.payDate/);
  assert.match(route,/restoredFrequency!=="monthly"&&row\.payDate!==scheduled\.payDate/);
  assert.match(route,/row\.reportedPayFrequency!==restoredFrequency/);
  assert.match(route,/Backup payroll schedule validation failed/);
  assert.match(route,/row\.frequency!==restoredFrequency/);
});

test("HMRC reconciliation includes authoritative Apprenticeship Levy", async () => {
  const [schema,employer,liabilities,reports,submissions,page]=await Promise.all([
    readFile("db/schema.ts","utf8"),readFile("app/api/employer/route.ts","utf8"),
    readFile("app/api/hmrc-liabilities/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/submissions/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(schema,/apprenticeshipLevyAllowance/);
  assert.match(employer,/finiteInRange\(input\.apprenticeshipLevyAllowance,0,15000\)/);
  assert.match(liabilities,/apprenticeshipLevyByMonth/);
  assert.match(reports,/Apprenticeship Levy/);
  assert.match(submissions,/authoritativeLevy/);
  assert.match(page,/Employer is liable for Apprenticeship Levy/);
  assert.match(page,/body\.employer\?\.smallEmployersRelief/);
});

test("employer configuration rejects malformed statutory data and departments are tenant-safe",async()=>{
  const [employer,departments,page]=await Promise.all([
    readFile("app/api/employer/route.ts","utf8"),readFile("app/api/departments/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  for(const requirement of ["payePattern","accountsOfficePattern","companyNumberPattern","validTaxYear","validDate","alternateContactEmail","preferredCredentialLabel"])assert.match(employer,new RegExp(requirement));
  assert.match(employer,/requireEmployerAccess\(request,employerId,"employer-admin"\)/);
  assert.match(employer,/before:JSON\.stringify\(\{\.\.\.before,\.\.\.beforeSettings\}\)/);
  assert.match(employer,/created:employer-client/);
  assert.match(employer,/An existing owner or administrator may create an employer client/);
  assert.match(employer,/db\.insert\(employerMemberships\)\.values\(\{employerId:employer\.id,userId:user\.userId,role:"owner"/);
  assert.match(page,/Create isolated client/);
  assert.match(page,/Every client has isolated payroll, CIS, pension, RTI and audit records/);
  assert.doesNotMatch(page,/employerName\.toUpperCase\(\)/);
  assert.match(departments,/requireEmployerAccess\(request,employerId,"employer-admin"\)/);
  assert.match(departments,/eq\(departments\.employerId,employerId\)/);
  assert.match(departments,/Move employees out of this department before deleting it/);
  assert.match(departments,/entityType:"department"/);
  assert.match(page,/Add department/);
  assert.match(page,/function editDepartment/);
  assert.match(page,/async function saveDepartment/);
  assert.match(page,/Department nominal code/);
  assert.match(page,/Nominal code/);
  assert.match(page,/Cost centre/);
  assert.match(employer,/Employer bank details require an account name, 6-digit sort code and 8-digit account number/);
  assert.match(employer,/employerNotes:optional\(input\.employerNotes\)/);
  assert.match(page,/Bank and notes/);
  assert.match(page,/Employer notes/);
});

test("employer frequency is schedule-aware across configuration, payroll and UI",async()=>{
  const [employer,payRuns,page]=await Promise.all([
    readFile("app/api/employer/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(employer,/payrollFrequencyRule\(input\.payFrequency\)/);
  assert.match(employer,/A first pay date is required for weekly, fortnightly and four-weekly payroll/);
  assert.match(employer,/scheduleChanged[\s\S]*?payPeriods/);
  assert.match(payRuns,/scheduledPayPeriods\(taxYear,frequency,employer\.firstPayDate\|\|undefined\)/);
  assert.match(payRuns,/requestedPayDate!==scheduledPeriod\.payDate/);
  assert.match(page,/Weekly · up to 53 periods/);
  assert.match(page,/Every 2 weeks · up to 27 periods/);
  assert.match(page,/Every 4 weeks · up to 14 periods/);
});

test("employee RTI frequency must match the employer deduction cycle",async()=>{
  const [employees,payRuns,data]=await Promise.all([
    readFile("app/api/employees/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(employees,/input\.reportedPayFrequency&&input\.reportedPayFrequency!==existingEmployer\[0\]\.payFrequency/);
  assert.match(employees,/must match the employer payroll frequency/);
  assert.match(payRuns,/existing\.reportedPayFrequency!==frequency/);
  assert.match(payRuns,/Correct the employee's RTI frequency before processing/);
  assert.match(data,/validateEmployeeStateEvidence\(row,dataset\.employers\[0\]\.taxYear\)/);
});

test("pay-frequency controls offer only implemented schedules and require an anchor date",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/Monthly · 12 PAYE periods/);
  assert.match(page,/First pay date in tax year/);
  for(const option of ['value="weekly"','value="fortnightly"','value="four-weekly"'])assert.match(page,new RegExp(option));
  for(const option of ['value="quarterly"','value="biannual"','value="annual"','value="one-off"'])assert.doesNotMatch(page,new RegExp(option));
});

test("employer settings expose only API-valid choices and required CIS identity",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  for(const evidence of [
    'label="CIS contractor UTR"','value="period">Period salary','value="hourly">Hourly rate',
    'value="employee-postcode">Employee postcode','value="employee-ni-last4">Last four NI characters',
    'value="manual-per-document">Set per document','value="onboarding">Onboarding','value="archived">Archived',
  ])assert.match(page,new RegExp(evidence));
});

test("portal invitations require a persisted employee record",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/canInvite=\{employeeDefaults\.some\(item=>item\.id===employee\.id\)\}/);
  assert.match(page,/disabled=\{!employee\.employeePortal\|\|!canInvite\}/);
  assert.match(page,/Save the employee record before creating a portal invitation/);
});

test("payroll header actions and period/YTD summary are operational",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/aria-label="Search employees"[\s\S]*?querySelector<HTMLInputElement>/);
  assert.match(page,/aria-label="Open HMRC notifications"[\s\S]*?disabled=\{!canPayrollWrite\}[\s\S]*?setActive\("HMRC"\)/);
  assert.match(page,/const \[summaryBasis,setSummaryBasis\]=useState<"period"\|"ytd">/);
  assert.match(page,/aria-label=\{`\$\{scheduleRule\.label\} salary`\} value=\{roundMoney\(payrollEntryEnabled\?employee\.pay:0\)\} type="number" step="\.01"/);
  assert.match(page,/run\.status==="finalised"/);
  assert.match(page,/periodRow\.periodNumber<=period/);
  assert.match(page,/onClick=\{\(\)=>setSummaryBasis\("ytd"\)\}/);
  assert.match(page,/\(employee\.paymentMethod\|\|"credit-transfer"\)\.replaceAll/);
  assert.match(page,/<SummaryLine label="Employer pension" value=\{summaryPayroll\.employerPension\}/);
  assert.match(page,/downloadPayrollReport\("payslips","html",`payslips-\$\{taxYear\.replace\("\/","-"\)\}-period-\$\{period\}\.html`,period\)/);
  assert.match(page,/<button disabled=\{!periodLocked\}[\s\S]{0,300}<Icon>↗<\/Icon>Create payslips/);
  assert.doesNotMatch(page,/<Icon>•••<\/Icon>More/);
  assert.doesNotMatch(page,/<Icon>←<\/Icon>Previous period|<Icon>→<\/Icon>Next period/);
  assert.match(page,/aria-label="Show earlier payroll periods"[\s\S]{0,500}aria-current=\{n===period\?"true":undefined\}/);
  assert.match(page,/Period \$\{maximumPeriods\} finalised and saved\.\$\{downstream\} The payroll year is complete/);
});

test("unsaved open-period pay entries survive historical period comparison",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/type PayrollEntryDraft=Partial<Pick<Employee/);
  assert.match(page,/const \[periodEntryDrafts,setPeriodEntryDrafts\]=useState/);
  assert.match(page,/const entryDraft=periodEntryDrafts\[`\$\{period\}:\$\{person\.id\}`\]/);
  assert.match(page,/return entryDraft\?\{\.\.\.base,\.\.\.entryDraft\}:base/);
  assert.match(page,/const entryKeys:Array<keyof PayrollEntryDraft>/);
  assert.match(page,/setPeriodEntryDrafts\(current=>\{const key=`\$\{period\}:\$\{employee\.id\}`/);
  assert.match(page,/filter\(\(\[key\]\)=>!key\.startsWith\(`\$\{period\}:`\)\)/);
});

test("attachment orders distinguish priority and non-priority court rules",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  const route=await readFile("app/api/attachments/route.ts","utf8");
  assert.match(page,/value="aeo-priority">Court AEO · priority \(carry shortfall\)/);
  assert.match(page,/value="aeo-non-priority">Court AEO · non-priority \(no carry\)/);
  assert.match(page,/only priority court AEO shortfalls carry forward/);
  assert.match(route,/"aeo-priority","aeo-non-priority"/);
  assert.match(route,/Court AEOs require the positive protected earnings rate/);
});

test("attachment UI and API expose Scottish and Northern Ireland rules",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  const route=await readFile("app/api/attachments/route.ts","utf8");
  assert.match(page,/Scottish earnings-arrestment tables convert fortnightly or four-weekly net pay/);
  assert.match(page,/statutory weekly, monthly and daily tables effective from 6 April 2025/);
  assert.doesNotMatch(page,/unsupportedScottish|monthly-only in this implementation/);
  assert.doesNotMatch(route,/currently available for monthly payroll only/);
  assert.match(page,/value="scottish-earnings-arrestment">Scottish earnings arrestment · statutory table/);
  assert.match(page,/value="ni-court-fine">Northern Ireland court fine · statutory bands/);
  assert.match(page,/value="ni-ejo">Northern Ireland EJO · order amount and protection/);
  assert.match(route,/"scottish-earnings-arrestment","scottish-current-maintenance","scottish-conjoined-maintenance","scottish-conjoined-mixed","ni-court-fine","ni-ejo"/);
});

test("Scottish maintenance orders count elapsed payday days and expose daily-rate inputs",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  assert.match(page,/value="scottish-current-maintenance">Scottish current maintenance · daily rate/);
  assert.match(page,/value="scottish-conjoined-maintenance">Scottish conjoined maintenance · aggregate daily rate/);
  assert.match(page,/Daily maintenance rate from order/);
  assert.match(page,/Preview days since previous payday/);
  assert.match(payRuns,/new Date\(periodRange\.start-86_400_000\)/);
  assert.match(payRuns,/elapsedPayDays\(order\.effectiveDate&&order\.effectiveDate>priorPeriodPayDate/);
  assert.match(payRuns,/periodDays:maintenanceDays/);
});

test("mixed Scottish conjoined orders persist and report component allocations",async()=>{
  const [page,schema,migration,payRuns,reports,data]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0053_mixed_conjoined_arrestments.sql","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(page,/value="scottish-conjoined-mixed">Scottish conjoined · ordinary debt and maintenance/);
  assert.match(page,/Ordinary-debt balance/);assert.match(page,/Aggregate maintenance daily rate/);
  assert.match(schema,/ordinaryDebtBalance/);assert.match(schema,/maintenanceDailyRate/);
  assert.match(schema,/ordinaryDeduction/);assert.match(schema,/maintenanceDeduction/);
  assert.match(migration,/ordinary_debt_balance/);assert.match(migration,/ordinary_balance_after/);
  assert.match(payRuns,/ordinaryDebtBalance:order\.ordinaryDebtBalance/);
  assert.match(payRuns,/ordinaryDeduction:calculation\.ordinaryDeduction/);
  assert.match(reports,/Ordinary debt deducted/);assert.match(reports,/Maintenance deducted/);
  assert.match(data,/latestOrdinaryBalance=latest\?\.ordinaryBalanceAfter\?\?null/);
});

test("production navigation contains no invented sample employees or alert counts",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.doesNotMatch(page,/seedEmployees|Clive Walton|Diane Garlick/);
  assert.doesNotMatch(page,/t === "RTI" && <em>|t === "Pensions" && <em>/);
});

test("employee master data survives recovery with starter and payment controls",async()=>{
  const validator=await readFile("lib/employee-state-evidence.ts","utf8");
  for(const evidence of ["P45 provided","P60 only","Secondary employment","directorStart","studentLoanPlan","portalCanEditBank","accountNumber"])
    assert.match(validator,new RegExp(evidence));
});

test("employer defaults and CIS subcontractor verification survive recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/employer-cis-state-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const evidence of ["accountsOfficeReference","apprenticeshipLevyAllowance","documentPasswordStrategy","verificationNumber","gross-payment-status"])
    assert.match(validator,new RegExp(evidence));
  for(const evidence of ["validateEmployerStateEvidence","validateEmployerSettingsEvidence","validateSubcontractorStateEvidence","duplicateSubcontractorUtr"])
    assert.match(data,new RegExp(evidence));
});

test("attachment orders use employer frequency while supporting Scottish multi-week tables",async()=>{
  const [attachments,payRuns,data]=await Promise.all([
    readFile("app/api/attachments/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(attachments,/payFrequency!==employer\.payFrequency/);
  assert.match(attachments,/must match the employer payroll schedule/);
  assert.match(payRuns,/expectedOrderFrequency=frequency/);
  assert.match(payRuns,/for\(const employee of resolvedEmployees\)/);
  assert.doesNotMatch(payRuns,/unsupportedScottish|requires a monthly Scottish ordinary-debt table/);
  assert.match(data,/row\.payFrequency!==dataset\.employers\[0\]\.payFrequency/);
});

test("reviewed payrolled benefits feed authoritative taxable pay",async()=>{
  const route=await readFile("app/api/pay-runs/route.ts","utf8");
  const benefitsRoute=await readFile("app/api/benefits/route.ts","utf8");
  const engine=await readFile("lib/payrolled-benefits.ts","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  const portalDocuments=await readFile("app/api/portal/documents/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(route,/eq\(expensesBenefits\.status,"reviewed"\)/);
  assert.match(route,/reviewedPayrolledBenefits\.filter\(benefit=>benefit\.payrolled&&benefit\.nicTreatment!==\"exempt\"\)/);
  assert.match(route,/taxableBenefits:Number\(record\.taxableBenefits\|\|0\)\+benefitTotal\+automaticPayrolledBenefits/);
  assert.match(route,/payrolledBenefits:automaticPayrolledBenefits/);
  assert.match(engine,/allocatedThrough-allocatedBefore/);
  assert.match(reports,/"Gross cash pay","Payrolled benefits","Taxable pay"/);
  assert.match(reports,/Number\(snapshot\.payrolledBenefits\|\|0\)/);
  assert.match(portalDocuments,/Payrolled benefits \(non-cash\)/);
  assert.match(portalDocuments,/runSnapshot=snapshot\(run\)/);
  assert.match(page,/fetch\(`\/api\/benefits\?employerId=\$\{employerId\}`/);
  assert.match(page,/totalPayrolledBenefitsForRange\(reviewedEmployeeBenefits\.filter\(item=>item\.payrolled&&item\.nicTreatment!==\"exempt\"\),taxYear,currentScheduledPeriod\.periodStart,currentScheduledPeriod\.periodEnd\)/);
  assert.match(route,/totalPayrolledBenefitsForRange\(reviewedPayrolledBenefits\.filter\(benefit=>benefit\.payrolled&&benefit\.nicTreatment!==\"exempt\"\),taxYear,scheduledPeriod\.periodStart,scheduledPeriod\.periodEnd\)/);
  assert.match(page,/automaticClass1Benefits/);
  assert.match(page,/Reviewed non-cash benefits · included in PAYE taxable pay/);
  assert.match(benefitsRoute,/An identical benefit record already exists/);
  assert.match(benefitsRoute,/eq\(expensesBenefits\.employeeId,employee\.id\),eq\(expensesBenefits\.taxYear,taxYear\)/);
});

test("report controls are authoritative and company-car events support P46(Car)", async () => {
  const [page,reports,benefits,schema,vanMigration,loanMigration,accommodationMigration]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/benefits/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0041_company_van_benefits.sql","utf8"),
    readFile("drizzle/0042_beneficial_loan_evidence.sql","utf8"),
    readFile("drizzle/0043_living_accommodation_evidence.sql","utf8"),
  ]);
  assert.match(page,/periodNumber=\$\{periodNumber\}/);
  assert.match(page,/employeeId=\$\{employeeId\}/);
  assert.match(page,/P46\(Car\) company-car events/);
  assert.match(page,/Fuel and emissions standard/);
  assert.match(page,/HMRC rate \$\{carCalculation\.percentage\}%/);
  assert.match(page,/Calculated cash equivalent/);
  assert.match(reports,/periodSensitive/);
  assert.match(reports,/The selected payroll period must be finalised before this report can be generated/);
  assert.match(reports,/liabilityPeriods=periods\.filter\(period=>period\.status==="finalised"\)/);
  assert.match(reports,/type==="p46car"/);
  assert.match(reports,/Live P46\(Car\) transmission requires HMRC-recognised software/);
  assert.match(benefits,/Company-car registration and a valid availability date are required/);
  assert.match(benefits,/validTaxYear/);
  assert.match(benefits,/Cash equivalent must be a valid non-negative amount/);
  assert.match(benefits,/Enter the company car list price and accessories/);
  assert.match(benefits,/calculateCompanyCarBenefit/);
  assert.match(benefits,/Select the company car fuel and diesel emissions standard/);
  assert.match(benefits,/cashEquivalent=carCalculation\.cashEquivalent/);
  assert.match(benefits,/calculateCompanyVanBenefit/);
  assert.match(benefits,/cashEquivalent=vanCalculation\.cashEquivalent/);
  assert.match(benefits,/Select the company van private-use treatment/);
  assert.match(page,/Private-use treatment/);
  assert.match(page,/Employer provides fuel for private journeys/);
  assert.match(page,/vanCalculation\.vanCharge/);
  assert.match(reports,/Company-van values use statutory private-use/);
  for(const field of ["vanUseType","vanFuelProvided","vanFuelRepaid","vanSharedEmployees"])assert.match(schema,new RegExp(field));
  assert.match(vanMigration,/van_use_type/);
  assert.match(benefits,/calculateBeneficialLoan/);
  assert.match(benefits,/cashEquivalent=loanCalculation\.cashEquivalent/);
  assert.match(page,/Maximum aggregate employee loans/);
  assert.match(page,/official rate \$\{loanCalculation\.officialRate\}%/);
  assert.match(reports,/Beneficial loans use the normal averaging method/);
  for(const field of ["loanOpeningBalance","loanClosingBalance","loanMaximumAggregateBalance","loanWholeMonths","loanInterestPaid","loanSalaryForegone"])assert.match(schema,new RegExp(field));
  assert.match(loanMigration,/loan_maximum_aggregate_balance/);
  assert.match(benefits,/calculateLivingAccommodation/);
  assert.match(benefits,/cashEquivalent=accommodationCalculation\.cashEquivalent/);
  assert.match(reports,/Living accommodation retains annual value/);
  for(const field of ["accommodationAnnualValue","accommodationProviderRent","accommodationPropertyCost","accommodationImprovements","accommodationEmployeeCapital","accommodationEmployeeRent","accommodationAvailableDays","accommodationSharedEmployees","accommodationSalaryForegone"])assert.match(schema,new RegExp(field));
  assert.match(accommodationMigration,/accommodation_annual_value/);
  assert.match(page,/Annual value \/ gross rating value/);
  assert.match(page,/additional charge over £75,000/);
  assert.match(page,/accommodationCalculation\.standardCharge/);
  assert.match(benefits,/entityType:"expense-benefit"/);
  for(const field of ["benefitEvent","availableFrom","vehicleRegistration","makeModel","fuelType","co2Emissions","listPrice"])assert.match(schema,new RegExp(field));
});

test("itemised payroll uses distinct PAYE, NIC and pension bases", async () => {
  const engine = await readFile("lib/payroll-engine.ts", "utf8");
  const payRuns = await readFile("app/api/pay-runs/route.ts", "utf8");
  const page = await readFile("app/page.tsx", "utf8");
  for (const field of ["taxableGrossPay", "nicableGrossPay", "pensionableGrossPay"]) {
    assert.match(engine, new RegExp(field));
    assert.match(payRuns, new RegExp(field));
  }
  assert.match(payRuns, /Itemised payroll must include at least one earning line/);
  assert.match(payRuns, /db\.insert\(payItems\)/);
  assert.match(payRuns,/salarySacrificeLines/);
  assert.match(payRuns,/employerPensionAdditional/);
  assert.match(page,/value="salary-sacrifice"/);
  assert.match(page,/value="payroll-giving"/);
  assert.match(payRuns,/payrollNote:String\(record\.payrollNote\|\|""\)\.trim\(\)\.slice\(0,4000\)\|\|null/);
  assert.match(page,/aria-label="Payroll note"/);
  assert.doesNotMatch(page,/This workflow is not implemented yet/);
  assert.match(page,/External integration/);
  assert.doesNotMatch(page,/\["RTI credentials","Government Gateway","Connected"/);
});

test("imports are tenant-bound and RTI types have dedicated validation", async () => {
  const [dataRoute,submissions,page]=await Promise.all([
    readFile("app/api/data/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(dataRoute,/A valid employerId is required for the whole import/);
  assert.doesNotMatch(dataRoute,/employerId:\s*Number\(row\.employerId/);
  assert.match(dataRoute,/requireEmployerAccess\(request,employerId,"employer-admin"\)/);
  assert.match(dataRoute,/schemaVersion:7/);
  assert.match(dataRoute,/checksum:\{algorithm:"SHA-256"/);
  assert.match(dataRoute,/input\.action==="verify-backup"/);
  assert.match(dataRoute,/Backup verification failed/);
  assert.match(page,/Affected dataset: \$\{body\.table\}/);
  assert.match(dataRoute,/input\.action!=="import-employees"/);
  assert.match(dataRoute,/const importedValues=prepared\.map/);
  assert.match(dataRoute,/db\.insert\(employees\)\.values\(importedValues\)/);
  assert.match(dataRoute,/await db\.batch\(\[/);
  assert.match(dataRoute,/action:"imported:employees"/);
  assert.match(dataRoute,/No employee rows were inserted/);
  assert.match(dataRoute,/starterEvidenceValues/);
  assert.match(dataRoute,/worked-elsewhere starters must use Statement B/);
  assert.match(dataRoute,/secondary employment must use Statement C/);
  assert.match(dataRoute,/P45 leaving date must fall within \$\{employer\.taxYear\}/);
  assert.match(dataRoute,/P60-only evidence needs its tax year and reference-only confirmation/);
  assert.match(dataRoute,/isRecognisedPayeTaxCode\(row\.taxCode\)/);
  assert.match(dataRoute,/National Insurance number is invalid/);
  assert.match(dataRoute,/hourly pay requires a positive rate and contracted hours/);
  assert.match(dataRoute,/bank details must include the account name, a six-digit sort code and an eight-digit account number/);
  assert.match(dataRoute,/importedBoolean/);
  assert.match(dataRoute,/`\$\{row\.taxYear\}:\$\{row\.periodNumber\}`/);
  assert.match(dataRoute,/duplicateReceipt/);
  assert.match(dataRoute,/allowedSubmissionStatuses.*queued-external/);
  assert.match(dataRoute,/payflow-cis300-external-result-1/);
  assert.match(dataRoute,/payflow-rti-external-result-1/);
  assert.match(dataRoute,/receipt\.acknowledgementReference===row\.correlationId/);
  assert.match(dataRoute,/await sha256\(JSON\.stringify\(payload\)\)===row\.payloadChecksum/);
  assert.match(dataRoute,/baseline\.status!=="accepted"/);
  assert.match(page,/function parseCsvRecords/);
  assert.match(page,/CSV contains an unclosed quoted value/);
  assert.match(page,/CSV headers must be present and unique/);
  assert.match(page,/CSV is missing required header \$\{required\}/);
  assert.match(page,/action:"import-employees",employerId,rows/);
  assert.match(page,/payflow-employee-import-template\.csv/);
  assert.match(page,/All rows or no rows/);
  assert.match(page,/A file with any invalid row inserts no employees/);
  assert.match(page,/importErrors\.slice\(0,50\)/);
  assert.match(dataRoute,/Backup filing-evidence validation failed/);
  for(const table of ["payRuns","payItems","leaveEvents","hmrcPayments","pensionMemberships","cisPayments","attachmentOrderDeductions","auditLog"])assert.match(dataRoute,new RegExp(`${table}:`),`${table} is missing from backups`);
  assert.match(page,/function DataToolsWorkspace/);
  assert.match(page,/Complete employer backup/);
  assert.match(page,/verify-backup/);
  for(const requirement of [
    "EPS requires a no-payment declaration",
    "HMRC withdrew the NINO Verification Request service on 3 February 2025",
    "Every expense or benefit must be reviewed",
    "An Additional FPS correction reason must contain 5 to 500 characters",
  ]) assert.match(submissions,new RegExp(requirement));
  assert.match(submissions,/cumulativeRtiSources\(type,period,periods,runs,statutorySources,employeeIds\)/);
  assert.match(submissions,/The Additional FPS baseline changed after validation/);
  assert.match(submissions,/baseline\.status!==\"accepted\"/);
  assert.doesNotMatch(submissions,/allowedTypes\s*=\s*\[[^\]]*"CIS300"/);
});

test("only the first unfinalised payroll period can be processed", async () => {
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(payRuns,/firstOpenPeriod/);
  assert.match(payRuns,/must be completed before period/);
  assert.match(payRuns,/if \(next\.length\) await db\.update\(payPeriods\)\.set\(\{status:"open"/);
  assert.match(payRuns,/periodEnd:scheduledPeriod\.periodEnd.*status:"open"/s);
  assert.match(payRuns,/A valid payroll pay date is required/);
  assert.match(payRuns,/pay date must fall within PAYE tax month/);
  assert.match(payRuns,/periodStart:scheduledPeriod\.periodStart/);
  assert.match(payRuns,/payDate:requestedPayDate/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/employees\?employerId=\$\{employerId\}`/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/pay-runs\?employerId=\$\{employerId\}&taxYear=\$\{encodeURIComponent\(taxYear\)\}`/);
  assert.match(page,/persistedRun/);
  assert.match(page,/persistedItems/);
  assert.match(page,/processPayroll\("draft"\)/);
  assert.match(page,/periodLocked/);
  assert.doesNotMatch(page,/useState\(\[1,\s*2,\s*3,\s*4\]\)/);
  assert.doesNotMatch(page,/\["PAYE due","£2,843\.71"/);
  assert.match(page,/latestFinalisedPeriod=finalised\.length/);
  assert.match(page,/useState\(latestFinalisedPeriod\)/);
  assert.match(payRuns,/validatePayrollPeriod\(frequency,periodNumber\)/);
  assert.match(payRuns,/Payroll action must be draft or finalise/);
  assert.match(payRuns,/Payroll calculation rules for \$\{taxYear\} are not installed/);
  assert.match(page,/payrollRulesAvailable=taxYear==="2026\/27"/);
  assert.match(page,/Install the approved PAYE, NIC, loan, statutory-pay and minimum-wage tables/);
  assert.match(payRuns,/Payroll must contain between 1 and 500 employees/);
  assert.match(payRuns,/cannot contain more than 100 pay items/);
  assert.match(payRuns,/recurring schedule reference that does not belong to this employee and tax year/);
  assert.match(payRuns,/resolvedEmployees/);
  assert.doesNotMatch(payRuns,/async function ensureEmployee/);
});

test("period finalisation cannot silently omit an active employee",async()=>{
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  assert.match(payRuns,/if\(input\.action===\"finalise\"\)/);
  assert.match(payRuns,/employerEmployees\.filter\(employee=>employeeActiveInRange/);
  assert.match(payRuns,/Finalisation must include every employee active in this period/);
  assert.match(payRuns,/Confidential employee permission is required to finalise a complete payroll period/);
  const completeness=payRuns.indexOf("Finalisation must include every employee active in this period");
  const periodLookup=payRuns.indexOf("let [period] = await db.select().from(payPeriods)");
  assert.ok(completeness>0&&periodLookup>completeness,"population completeness must be checked before period creation");
});

test("statutory pay is allocated into payroll and HMRC from one schedule", async () => {
  const periods=await readFile("lib/pay-periods.ts","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const liabilities=await readFile("app/api/hmrc-liabilities/route.ts","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  assert.match(periods,/statutoryPayAllocation/);
  assert.match(periods,/paidDayIndex<42/);
  assert.match(payRuns,/automaticStatutoryPay/);
  assert.match(liabilities,/statutoryPayAllocation/);
  assert.match(reports,/"Statutory pay"/);
});

test("pension membership is authoritative and opt-out refunds are one-time", async () => {
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const pensions=await readFile("app/api/pensions/route.ts","utf8");
  const engine=await readFile("lib/payroll-engine.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(payRuns,/membershipStatus==="active"/);
  assert.match(payRuns,/membershipStatus==="postponed"/);
  assert.match(payRuns,/employeeRefundDue:0/);
  assert.match(pensions,/action==="save-scheme"/);
  assert.match(pensions,/action==="opt-out"/);
  assert.match(pensions,/Date of birth is required for pension assessment/);
  assert.match(pensions,/A finalised pay run is required for pension assessment/);
  assert.doesNotMatch(pensions,/age:\s*Number\(input\.age\)/);
  assert.match(engine,/pensionRefund/);
  assert.match(page,/let projectedPensionStatus=/);
  assert.match(page,/assessPensionAtDate\(\{dateOfBirth:employee\.dateOfBirth,assessmentDate:payrollCalculationDate,earnings:scheduledGross,payFrequency/);
  assert.match(page,/membership\?\.employerContributionRequired===false\?0/);
  assert.match(payRuns,/pensionSnapshot:payRuns\.pensionSnapshot/);
  assert.match(page,/frozenPensionEvidence=JSON\.parse\(persistedRun\.pensionSnapshot\|\|"null"\)/);
  assert.match(page,/status:frozenPensionEvidence\?"active":"not-assessed"/);
});

test("pension operations expose stored contributions, membership actions, letters and provider files", async()=>{
  const pensions=await readFile("app/api/pensions/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  for(const value of ["export-contributions","generated:pension-contributions","generated:pension-letter","must be finalised before contribution export"]){
    assert.equal(pensions.includes(value),true);
  }
  for(const value of ["Pension memberships","Finalised pension contributions","Employee pension communications","Provider submission preparation"]){
    assert.match(page,new RegExp(value));
  }
  for(const value of ["periodNumber:Number.isInteger","providerTransmission:payload.providerTransmission","payloadChecksum:row.payloadChecksum"]){
    assert.equal(pensions.includes(value),true);
  }
  assert.match(page,/Payroll source/);
  assert.match(page,/item\.records/);
  assert.match(pensions,/payflow-pension-generic-csv-2/);
  assert.match(pensions,/Provider Tax Relief/);
  assert.match(pensions,/employeeGrossContribution/);
  assert.match(page,/Net member deduction, provider tax relief and gross contribution/);
  const reports=await readFile("app/api/reports/route.ts","utf8");
  assert.match(reports,/Provider tax relief/);
  assert.match(reports,/Legacy finalised records created before split contribution evidence/);
  assert.match(await readFile("app/api/portal/documents/route.ts","utf8"),/Pension member deduction/);
  assert.doesNotMatch(page,/Manage pension \\{section\\.toLowerCase\\(\\)\\}, provider files and history/);
});

test("pension lifecycle uses statutory windows, scheme-bound refunds and immutable history", async()=>{
  const [pensions,payRuns,schema,page]=await Promise.all([
    readFile("app/api/pensions/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(pensions,/addCalendarMonths\(windowStart,1\)/);
  assert.match(pensions,/valid provider-issued opt-out notice/);
  assert.match(pensions,/Use cessation outside this window/);
  assert.match(pensions,/Postponement cannot exceed three calendar months/);
  assert.match(page,/postponementEnd=addCalendarMonths\(assessmentDate,3\)/);
  assert.doesNotMatch(page,/postponementEnd\.setUTCDate/);
  assert.match(pensions,/Contribution due day must be a whole number between 1 and 28/);
  assert.match(pensions,/Assessment date must be a valid calendar date/);
  assert.match(pensions,/Assessment payroll period must be a whole number between 1 and \$\{paySchedule\.length\}/);
  assert.match(pensions,/pension assessment must use its authoritative pay date/);
  assert.match(pensions,/action==="assess"&&assessmentDate!==run\.payDate/);
  assert.match(pensions,/Pay-period earnings must be a valid non-negative amount/);
  assert.match(pensions,/memberships\.filter\(membership=>access\.membership\.canViewConfidential/);
  assert.match(pensions,/Confidential employee permission is required to generate the complete provider contribution file/);
  assert.match(pensions,/row\.payDate>=windowStart/);
  assert.match(pensions,/row\.pensionSchemeId===scheme\[0\]\.id/);
  assert.match(pensions,/eventType:"scheme-transfer"/);
  assert.match(pensions,/values\.status==="active"&&priorActive/);
  assert.match(pensions,/eq\(pensionSchemes\.status,"active"\)/);
  assert.match(pensions,/\["opted-out","ceased"\]\.includes\(existing\[0\]\.membershipStatus\)/);
  assert.match(pensions,/existing\[0\]\?\.optOutNoticeDate\|\|null/);
  assert.match(pensions,/unchangedAssessment/);
  assert.match(pensions,/startsActiveMembership=membershipStatus==="active"&&existing\[0\]\?\.membershipStatus!=="active"/);
  assert.match(pensions,/membershipStatus==="active"&&!existing\[0\]\?\.communicationDueDate/);
  assert.match(pensions,/addDays\(existing\[0\]\?\.enrolmentDate\|\|assessmentDate,42\)/);
  assert.match(pensions,/already has active pension membership/);
  assert.match(pensions,/details\.assessment===assessment\.category/);
  assert.match(payRuns,/pensionSchemeId/);
  assert.match(payRuns,/const assessmentDate=requestedPayDate/);
  assert.doesNotMatch(payRuns,/const assessmentDate=new Date\(taxMonthRange/);
  assert.match(payRuns,/eventType:"payroll-assessment"/);
  assert.match(payRuns,/eventType:"postponement-ended"/);
  assert.match(payRuns,/membership\?\.membershipStatus==="not-enrolled"&&assessment/);
  assert.match(payRuns,/eventType:becomesEligible\?"became-eligible":"payroll-reassessment"/);
  assert.match(payRuns,/const commitPensionLifecycle=input\.action==="finalise"/);
  assert.match(payRuns,/if\(commitPensionLifecycle\)/);
  assert.match(payRuns,/else membership=\{id:0,\.\.\.projected\}/);
  assert.match(payRuns,/pensionMembershipEvents/);
  assert.match(schema,/pensionMembershipEvents/);
  assert.match(page,/Membership lifecycle history/);
  assert.match(page,/Provider-issued opt-out notice is valid and personally submitted/);
  assert.match(page,/Run assessment & enrol eligible workers/);
  assert.match(page,/paySchedule\.find\(item=>item\.periodNumber===\(assessmentPeriod\|\|1\)\)/);
  assert.match(page,/assessmentDateLabel/);
  assert.match(page,/const successful=outcomes\.filter\(result=>result\.body\),failed=outcomes\.filter\(result=>result\.error\)/);
  assert.match(page,/assessment\(s\) saved; \$\{failed\.length\} could not be processed/);
});

test("pension compliance dates, voluntary joins and provider packages are authoritative",async()=>{
  const [pensions,payRuns,schema,migration,page]=await Promise.all([
    readFile("app/api/pensions/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0029_pension_compliance_dates.sql","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(pensions,/existing\[0\]\?\.membershipStatus==="active"\)membershipStatus="active"/);
  assert.match(pensions,/An active member cannot be postponed/);
  assert.match(pensions,/postponement notice must be issued between/);
  assert.match(pensions,/The join action is reserved for entitled workers/);
  assert.match(pensions,/employerContributionRequired:action==="join"\?false/);
  assert.match(pensions,/Re-enrolment must fall within the permitted window/);
  assert.match(pensions,/PENSION-PROVIDER/);
  assert.match(pensions,/PENSION-LETTER/);
  assert.match(pensions,/payloadChecksum/);
  assert.match(pensions,/providerTransmission:false/);
  assert.match(pensions,/No non-zero finalised contributions exist/);
  assert.match(payRuns,/membership\.employerContributionRequired\?activePensionScheme\.employerRate:0/);
  assert.match(schema,/automaticEnrolmentScheme/);
  assert.match(schema,/communicationDueDate/);
  assert.match(migration,/next_reenrolment_date/);
  assert.match(page,/Automatic-enrolment compliance/);
  assert.match(page,/Postponement notice issued/);
  assert.match(page,/Membership action effective date/);
  assert.match(page,/const active=member\.membershipStatus==="active",canActivate=!active/);
  assert.match(page,/disabled=\{!canActivate\|\|!lifecycleDate\}/);
  assert.match(page,/disabled=\{!optOutNoticeDate\|\|!optOutNoticeValid\|\|!active\}/);
  assert.match(page,/await loadPensions\(\);toast\(`Pension communication/);
});

test("pension declaration status requires immutable external acknowledgement evidence",async()=>{
  const [route,page]=await Promise.all([
    readFile("app/api/pensions/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  for(const evidence of ["record-declaration","payflow-pension-declaration-1","PENSION-DECLARATION","payloadChecksum","recorded:pension-declaration","externalFiling:true","supersededEvidence"]){
    assert.match(route,new RegExp(evidence));
  }
  assert.match(route,/declarationDueDate&&scheme\.declarationDueDate<today\?"overdue":"not-filed"/);
  assert.match(route,/Confirm that the declaration was filed outside PayFlow/);
  assert.match(route,/PayFlow did not transmit this declaration/);
  assert.match(route,/evidence\.declarationDate===declarationDate&&evidence\.reference===reference/);
  assert.match(route,/ownedForStatus\.declarationDueDate===\(declarationDueDate\|\|null\)/);
  assert.doesNotMatch(page,/setDeclarationStatus\(event\.target\.value\)/);
  assert.match(page,/Record external declaration/);
  assert.match(page,/I checked the external declaration acknowledgement/);
  assert.match(page,/Declaration acknowledgement/);
});

test("finalised pension contributions freeze provider and employee evidence",async()=>{
  const [pensions,payRuns,schema,migration,legacyRepair]=await Promise.all([
    readFile("app/api/pensions/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("drizzle/0048_payrun_pension_snapshot.sql","utf8"),
    readFile("drizzle/0049_repair_legacy_pension_snapshot_identity.sql","utf8"),
  ]);
  assert.match(schema,/pensionSnapshot: text\("pension_snapshot"\)/);
  assert.match(migration,/ALTER TABLE `pay_runs` ADD `pension_snapshot`/);
  assert.match(migration,/WHERE `status` = 'finalised'/);
  assert.match(migration,/payflow-pension-evidence-backfill-1/);
  assert.match(legacyRepair,/json_set/);
  assert.match(legacyRepair,/json_extract\(`pension_snapshot`, '\$\.firstName'\) IS NULL/);
  assert.match(payRuns,/schemaVersion:"payflow-pension-evidence-2"/);
  for(const field of ["provider","schemeName","employerReference","contributionDueDay","employeeDeduction","employeeTaxRelief","employeeGrossContribution","payrollId","niNumber","dateOfBirth","firstName","middleNames","lastName"]){
    assert.match(payRuns,new RegExp(`pensionSnapshot:[\\s\\S]{0,1200}${field}`),`${field} is missing from finalised pension evidence`);
  }
  assert.match(pensions,/const pensionEvidence=/);
  assert.match(pensions,/parseFrozenPensionSnapshot\(run\.pensionSnapshot\)/);
  assert.match(pensions,/Object\.prototype\.hasOwnProperty\.call\(snapshot,field\)/);
  assert.match(pensions,/evidenceRows\.map\(\(\{run,evidence\}\)=>\[evidence\.provider,evidence\.schemeName/);
  assert.match(pensions,/evidence\.employeeDeduction,evidence\.employeeTaxRelief,evidence\.employeeGrossContribution/);
  assert.match(pensions,/sourceChecksum=await sha256\(JSON\.stringify\(\{periodId:period\.id,taxYear,periodNumber,payDate,rows\}\)\)/);
  assert.match(pensions,/contributionDeadline\(payDate,evidence\.contributionDueDay\)/);
});

test("pension-bearing finalised runs require recognised immutable evidence",async()=>{
  const [snapshot,data,pensions,reports,submissions]=await Promise.all([
    readFile("lib/pension-snapshot.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
    readFile("app/api/pensions/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),
  ]);
  assert.match(snapshot,/payflow-pension-evidence-2/);
  assert.match(snapshot,/payflow-pension-evidence-backfill-1/);
  for(const field of ["schemeId","provider","schemeName","taxRelief","contributionDueDay","payrollId","firstName","lastName","employeeDeduction","employeeTaxRelief","employeeGrossContribution"])assert.match(snapshot,new RegExp(field));
  assert.match(data,/Boolean\(row\.pensionSchemeId\)&&!hasValidFrozenPensionSnapshot\(row\.pensionSnapshot\)/);
  assert.match(pensions,/exportRuns\.some\(run=>!hasValidFrozenPensionSnapshot\(run\.pensionSnapshot\)\)/);
  assert.match(pensions,/contributionRuns\.some\(run=>run\.pensionSchemeId&&!hasValidFrozenPensionSnapshot\(run\.pensionSnapshot\)\)/);
  assert.match(pensions,/snapshot=parseFrozenPensionSnapshot\(run\.pensionSnapshot\)/);
  assert.match(reports,/type===\"pensions\"&&allRuns\.some\(run=>run\.pensionSchemeId&&!hasValidFrozenPensionSnapshot/);
  assert.match(submissions,/yearRuns\.some\(run=>run\.pensionSchemeId&&!hasValidFrozenPensionSnapshot/);
});

test("CIS periods and payment dates are validated dynamically", async()=>{
  const [cis,page,schema]=await Promise.all([
    readFile("app/api/cis/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("db/schema.ts","utf8"),
  ]);
  assert.match(cis,/const validDate=/);
  assert.match(cis,/const validTaxMonth=/);
  assert.match(cis,/taxMonthParam!==null/);
  assert.match(cis,/Payment date must be a valid calendar date within CIS tax month/);
  assert.match(cis,/Every payment date must fall within CIS tax month/);
  assert.match(cis,/Select the CIS verification deduction rate/);
  assert.match(cis,/taxMonthRange/);
  assert.match(cis,/p\.taxYear===taxYear/);
  assert.match(cis,/cisVerificationDecision/);
  assert.match(cis,/verificationRequired:true/);
  assert.match(cis,/verificationMethod:applicableEvidence\.verificationMethod,verifiedAt:applicableEvidence\.verifiedAt/);
  assert.match(cis,/supersedeCisArtifacts\(employerId,payment\.taxYear,payment\.taxMonth/);
  assert.match(cis,/deductibleAmount=round\(labour-retention\)/);
  assert.match(cis,/Labour retention cannot exceed the labour amount/);
  assert.match(cis,/active subcontractor invoice or payment reference is already recorded/);
  assert.match(cis,/Payments including materials require an evidence or estimate note/);
  assert.match(cis,/invoiceNumber:cisPayments\.invoiceNumber/);
  assert.match(cis,/paymentRecipient:cisPayments\.paymentRecipient/);
  assert.match(cis,/materialsEvidence:cisPayments\.materialsEvidence/);
  assert.match(cis,/duplicatesSubmissionId/);
  assert.match(cis,/Select download, email, post or portal delivery/);
  assert.match(cis,/action"\)==="statement-document"/);
  assert.match(cis,/stored CIS statement checksum does not match/);
  assert.match(cis,/x-payflow-source-checksum/);
  assert.match(cis,/CIS payment and deduction statement/);
  assert.match(cis,/payflow-cis-pds-2/);
  assert.match(cis,/Resolve CIS payment evidence before issuing the statement/);
  assert.match(cis,/Contractor name and PAYE reference are required/);
  assert.match(cis,/priorSourceChecksum===sourceChecksum/);
  assert.match(cis,/replacesStatementId/);
  assert.match(page,/Open printable/);
  assert.match(page,/format=csv/);
  assert.match(page,/Corrected replacement of statement/);
  assert.match(page,/action=statement-document&id=\$\{statementId\}&format=html/);
  assert.match(page,/await loadCis\(\);toast\(`Statement #\$\{statementId\} downloaded/);
  assert.match(page,/\[correctionReason,setCorrectionReason\]=useState\(""\)/);
  assert.match(schema,/taxYear: text\("tax_year"\)/);
  assert.match(schema,/verificationNumber: text\("verification_number"\)/);
  assert.match(page,/cisTaxMonthDates/);
  assert.match(page,/currentCisTaxMonth/);
  assert.match(page,/value=\{taxMonth\}/);
  assert.match(page,/HMRC deduction result/);
  assert.match(page,/invoiceNumber\.trim\(\)\.length<3/);
  assert.match(page,/materials>0&&materialsEvidence\.trim\(\)\.length<3/);
  assert.match(page,/payment\.invoiceNumber\|\|"Legacy record"/);
  assert.match(page,/payment\.paymentRecipient\|\|"Recipient not recorded"/);
  assert.doesNotMatch(page,/taxMonth:5,\s*paymentDate/);
});

test("CIS CSV import is tenant-bound, atomic and visible in the subcontractor register",async()=>{
  const [cis,page,validator]=await Promise.all([
    readFile("app/api/cis/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("lib/cis-import.ts","utf8"),
  ]);
  assert.match(cis,/input\.action==="import-subcontractors"/);
  assert.match(cis,/validateCisImportRows\(input\.rows\)/);
  assert.match(cis,/eq\(subcontractors\.employerId,employerId\)/);
  assert.match(cis,/db\.batch\(\[/);
  assert.match(cis,/action:"imported:cis-subcontractors"/);
  assert.match(cis,/No subcontractors were imported because/);
  assert.match(validator,/limited to 500 subcontractors/);
  assert.match(validator,/UTR duplicates row/);
  assert.match(validator,/imported-evidence/);
  assert.match(validator,/liveVerificationPerformed:false/);
  assert.match(page,/payflow-cis-subcontractor-import-template\.csv/);
  assert.match(page,/action:"import-subcontractors",employerId,rows/);
  assert.match(page,/Choose CIS CSV/);
  assert.match(page,/Subcontractor register/);
  assert.match(page,/No partial imports/);
  assert.match(page,/event\.target\.value="";void importCisCsv\(file\)/);
  assert.match(page,/event\.target\.value="";void importEmployeeCsv\(file\)/);
  assert.match(page,/setSelectedSub\(current=>loadedSubcontractors\.some/);
  assert.match(page,/\},\[employerId\]\);/);
});

test("pay-detail CSV import validates the open period and saves through the payroll engine",async()=>{
  const [page,validator]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("lib/pay-details-import.ts","utf8"),
  ]);
  assert.match(page,/Import pay/);
  assert.match(page,/PayDetailsImportModal/);
  assert.match(page,/payflow-pay-details-period-\$\{period\}\.csv/);
  assert.match(page,/validatePayDetailsImportRows\(rows,period,activeEmployees\.map/);
  assert.match(page,/existing non-scheduled variable lines are replaced/);
  assert.match(page,/filter\(item=>item\.recurringItemId\)/);
  assert.match(page,/processPayroll\("draft",imported,"pay-details-csv"\)/);
  assert.match(page,/Apply and save payroll draft/);
  assert.match(validator,/period \$\{period\} does not match the open payroll period \$\{currentPeriod\}/);
  assert.match(validator,/payroll ID \$\{suppliedPayrollId\|\|"\(blank\)"\} was not found for this employer/);
  assert.match(validator,/limited to 2,000 rows/);
  assert.doesNotMatch(validator,/\"benefit\"/);
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  assert.match(payRuns,/Payroll source must be manual or pay-details-csv/);
  assert.match(payRuns,/Imported pay details must be saved and reviewed as a draft before finalisation/);
  assert.match(payRuns,/action:operationSource==="pay-details-csv"\?"imported:pay-details":"saved:payroll-draft"/);
});

test("CIS verification uses current-or-previous-two-year payment history and freezes evidence",async()=>{
  const [verification,cis,schema,migration,page]=await Promise.all([
    readFile("lib/cis-verification.ts","utf8"),readFile("app/api/cis/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0051_cis_payment_verification_evidence.sql","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(verification,/new Set\(\[start,start-1,start-2\]\)/);
  assert.match(verification,/payment\.paymentDate<=paymentDate/);
  assert.match(verification,/continuing-payment-history/);
  assert.match(verification,/first-payment-verification/);
  assert.match(verification,/historic-payment-missing-verification-evidence/);
  assert.match(cis,/No complete verification evidence or continuing payment history exists/);
  assert.match(cis,/verificationReason:verification\.reason/);
  assert.match(schema,/verificationMethod: text\("verification_method"\)/);
  assert.match(schema,/verifiedAt: text\("verified_at"\)/);
  assert.match(migration,/ALTER TABLE `cis_payments` ADD `verification_method` text/);
  assert.match(page,/payment-time identity and verification evidence/);
});

test("CIS filing evidence is immutable, non-polluting and superseded by source changes",async()=>{
  const [cis,employer,reports]=await Promise.all([readFile("app/api/cis/route.ts","utf8"),readFile("app/api/employer/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8")]);
  assert.match(cis,/A JSON CIS operation object is required/);
  assert.match(cis,/A JSON CIS correction object is required/);
  assert.match(cis,/Unsupported CIS operation/);
  assert.match(cis,/validation-failed:cis300-package/);
  assert.match(cis,/entityType:"submission-validation"/);
  assert.match(cis,/return NextResponse\.json\(\{submission:null,payload,validation:\{valid:false,errors\}\},\{status:422\}\)/);
  assert.match(cis,/sourceChecksum/);
  assert.match(cis,/supersededStatements/);
  assert.match(cis,/filingHistory:filingRows\.filter/);
  assert.match(cis,/Superseded because CIS payment \$\{createdPayment\.id\} was added after preparation/);
  assert.match(cis,/input\.action==="record-filing-result"/);
  assert.match(cis,/validateCisFilingResult/);
  assert.match(cis,/liveTransmissionPerformedByPayFlow:false/);
  assert.match(cis,/recorded:cis300-\$\{result\.outcome\}/);
  assert.match(cis,/external acknowledgement reference is already attached/);
  assert.match(cis,/Accepted CIS300 #\$\{samePeriod\.id\} already exists/);
  assert.match(cis,/amendsPayloadChecksum/);
  assert.match(cis,/input\.employmentStatusConsidered!==true/);
  assert.doesNotMatch(cis,/db\.insert\(employers\)/);
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/CIS filing and statement history/);
  assert.match(page,/Test-ready is not an HMRC submission/);
  assert.match(page,/Record external HMRC result/);
  assert.match(page,/Payments recorded this tax month/);
  assert.match(page,/Open payment history & corrections/);
  assert.match(page,/currentMonthPayments=cisPayments\.filter/);
  assert.match(page,/PayFlow does not claim transmission/);
  assert.match(employer,/cisIdentityChanged/);
  assert.match(employer,/supersededCisArtifacts/);
  assert.match(reports,/Invoice \/ payment reference/);
  assert.match(reports,/Legal payment recipient/);
  assert.match(reports,/Materials evidence/);
  assert.match(reports,/p\.invoiceNumber\|\|""/);
  assert.match(reports,/p\.paymentRecipient\|\|p\.subcontractorName\|\|s\?\.name\|\|""/);
  assert.match(reports,/p\.materialsEvidence\|\|""/);
});

test("CIS freezes legal identity at payment time and preserves correction lineage",async()=>{
  const [cis,page,schema,migration,reports]=await Promise.all([
    readFile("app/api/cis/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0047_cis_identity_and_correction_lineage.sql","utf8"),readFile("app/api/reports/route.ts","utf8"),
  ]);
  for(const field of ["subcontractorName","subcontractorType","subcontractorUtr","subcontractorNiNumber","subcontractorCompanyNumber","subcontractorPartnerUtr","replacesPaymentId","voidReason"]){
    assert.match(schema,new RegExp(field),`${field} is missing from the CIS payment schema`);
  }
  assert.match(migration,/UPDATE `cis_payments`/);
  assert.match(migration,/CREATE INDEX `cis_payments_replaces_payment_idx`/);
  assert.match(cis,/subcontractorName:owner\.name/);
  assert.match(cis,/name:evidence\?\.subcontractorName\|\|sub\.name/);
  assert.match(cis,/A replacement can only link to a voided CIS payment/);
  assert.match(cis,/same subcontractor, tax year and tax month/);
  assert.match(cis,/already has an active replacement/);
  assert.match(cis,/voidReason:reason/);
  assert.match(cis,/conflicting payment-time identity evidence/);
  assert.match(reports,/p\.subcontractorName\|\|s\?\.name/);
  assert.match(reports,/p\.subcontractorUtr\|\|s\?\.utr/);
  assert.match(reports,/p\.replacesPaymentId\|\|""/);
  assert.match(page,/Replacing payment #\{replacesPaymentId\}/);
  assert.match(page,/setReplacesPaymentId\(paymentId\)/);
  assert.match(page,/replacesPaymentId \}\) \}\)/);
});

test("CIS payment evidence and replacement lineage survive only valid backup recovery",async()=>{
  const [validator,cis,data]=await Promise.all([
    readFile("lib/cis-payment-evidence.ts","utf8"),readFile("app/api/cis/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const field of ["taxYear","taxMonth","paymentDate","labour","materials","vat","retention","deduction","netPayment","subcontractorName","subcontractorType","subcontractorUtr","verificationNumber","replacesPaymentId","voidReason"])assert.match(validator,new RegExp(field));
  assert.match(validator,/does not reconcile/);
  assert.match(cis,/validateCisPaymentEvidence\(payment\)/);
  assert.match(data,/invalidCisPayment=dataset\.cisPayments\.find/);
  assert.match(data,/baseline\.status!==\"voided\"/);
  assert.match(data,/candidate\.replacesPaymentId===row\.replacesPaymentId/);
});

test("statutory leave and HMRC recovery evidence survive only valid backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/statutory-event-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const field of ["startDate","endDate","qualifyingDays","qualifyingWeekdays","averageWeeklyEarningsSource","statutoryAmount","recoveredAmount","statutoryTouchDays","statutoryWorkedWeeks","familyEventReference","neonatalTier"])
    assert.match(validator,new RegExp(field));
  assert.match(validator,/calculateStatutoryPay/);
  assert.match(validator,/does not reconcile/);
  assert.match(data,/validateStatutoryEventEvidence/);
  assert.match(data,/invalidLeaveEvent=dataset\.leaveEvents\.find/);
  assert.match(data,/invalidLeaveEvent\|\|invalidLeaveCalendarEvidence\?\"leaveEvents\"/);
});

test("statutory non-payment notice identity and checksum evidence survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/statutory-notice-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(validator,/payflow-statutory-notice-1/);
  assert.match(validator,/actualChecksum!==row\.payloadChecksum/);
  assert.match(validator,/snapshot\[field\]!==row\[field\]/);
  assert.match(data,/validateStatutoryNoticeEvidence/);
  assert.match(data,/actualSnapshotChecksum=await sha256/);
  assert.match(data,/invalidStatutoryNotice\?\"statutoryNotices\"/);
});

test("HMRC payment lifecycle and finalised-period evidence survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/hmrc-payment-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const field of ["taxYear","taxMonth","paymentDate","kind","category","method","amount","reference","status","voidedAt","voidReason"])
    assert.match(validator,new RegExp(field));
  assert.match(data,/validateHmrcPaymentEvidence\(row,backup\.exportedAt\)/);
  assert.match(data,/period\?\.status!==\"finalised\"/);
  assert.match(data,/duplicateHmrcReference/);
});

test("payroll correction locks, reversals and recovery balances survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/payroll-adjustment-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const type of ["gross-pay","taxable-pay","nicable-pay","statutory-pay","net-pay","statutory-recovery","paye-tax","employee-nic","employer-nic","student-loan","postgraduate-loan"])
    assert.match(validator,new RegExp(type));
  assert.match(data,/acceptedRtiPeriodIds/);
  assert.match(data,/duplicateActiveAdjustment/);
  assert.match(data,/includedInOriginalFinalisation/);
  assert.match(data,/entry\.entityType==="payroll-adjustment"&&entry\.entityId===String\(row\.id\)&&entry\.action==="created"/);
  assert.match(data,/recorded\.payRun===null/);
  assert.match(data,/finalisedCorrectionFullyReversed/);
  assert.match(data,/created:finalised-rti-correction/);
  assert.match(data,/reversed:finalised-rti-correction/);
  assert.match(data,/invalidRecoveryBalance/);
  assert.match(data,/statutoryPayAllocation/);
});

test("attachment order balances and finalised deductions survive only reconciled backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/attachment-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(validator,/calculateAttachment/);
  assert.match(validator,/does not reconcile/);
  assert.match(data,/invalidAttachmentOrder/);
  assert.match(data,/duplicateActiveOrder/);
  assert.match(data,/invalidAttachmentDeduction/);
  assert.match(data,/duplicateAttachmentDeduction/);
  assert.match(data,/invalidAttachmentCurrentBalance/);
  assert.match(data,/run\.status!==\"finalised\"/);
});

test("benefit calculations, void evidence and replacement lineage survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/benefit-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const calculator of ["calculateCompanyCarBenefit","calculateCompanyVanBenefit","calculateBeneficialLoan","calculateLivingAccommodation","class1aForBenefit"])
    assert.match(validator,new RegExp(calculator));
  assert.match(validator,/does not reconcile/);
  assert.match(data,/invalidBenefit=dataset\.expensesBenefits\.find/);
  assert.match(data,/invalidBenefitLineage/);
  assert.match(data,/baseline\.status!==\"voided\"/);
});

test("recurring schedules cannot contradict finalised occurrences after stop or restore",async()=>{
  const [validator,route,data]=await Promise.all([
    readFile("lib/recurring-pay-evidence.ts","utf8"),readFile("app/api/recurring-items/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(route,/finalisedThrough/);
  assert.match(route,/requestedEnd<finalisedThrough/);
  assert.match(route,/validTaxYear/);
  assert.match(validator,/falls outside its stored schedule/);
  assert.match(validator,/no longer matches its source schedule/);
  assert.match(data,/invalidRecurringOccurrence/);
  assert.match(data,/duplicateActiveSchedule/);
});

test("portal change request fields and review lifecycle survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/employee-change-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(validator,/contactFields/);
  assert.match(validator,/bankFields/);
  assert.match(validator,/contradictory review evidence/);
  assert.match(validator,/reviewer evidence/);
  assert.match(data,/invalidEmployeeChange/);
  assert.match(data,/duplicatePendingEmployeeChange/);
});

test("HMRC notice dates, instructions and lifecycle survive backup recovery",async()=>{
  const [validator,route,data]=await Promise.all([
    readFile("lib/hmrc-notice-evidence.ts","utf8"),readFile("app/api/hmrc-notices/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const type of ["coding","student-loan","nino","generic"])assert.match(validator,new RegExp(type));
  assert.match(validator,/future-issued/);
  assert.match(validator,/contradictory lifecycle evidence/);
  assert.match(route,/issuedDate>today\(\)/);
  assert.match(data,/invalidHmrcNotice/);
  assert.match(data,/duplicateNoticeIdentifier/);
  assert.match(data,/duplicateActiveNotice/);
  assert.match(data,/hmrcNoticeInstructionKey/);
});

test("finalised pay-run population, items, net pay and pension deductions survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/pay-run-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  assert.match(validator,/Pay run net pay does not reconcile/);
  assert.match(validator,/Pay run omits an itemised post-tax deduction/);
  assert.match(validator,/employeeDeduction/);
  assert.match(data,/invalidRunLifecycle/);
  assert.match(data,/invalidRunAccounting/);
  assert.match(data,/invalidFinalisedPopulation/);
  assert.match(data,/employeeActiveInRange/);
  assert.match(data,/paymentAfterLeaving/);
  assert.match(data,/parseFrozenPensionSnapshot/);
});

test("pension scheme, membership, event and pending-refund state survive backup recovery",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/pension-state-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const status of ["active","not-enrolled","postponed","opted-out","ceased","transferred"])assert.match(validator,new RegExp(status));
  for(const event of ["payroll-assessment","postponement-ended","became-eligible","payroll-reassessment","scheme-transfer"])assert.match(validator,new RegExp(event));
  assert.match(data,/invalidPensionScheme/);
  assert.match(data,/duplicatePensionMembership/);
  assert.match(data,/invalidPensionEventState/);
  assert.match(data,/invalidPensionRefund/);
  assert.match(data,/optOutNoticeDate/);
});

test("filed pension declarations require restored acknowledgement evidence",async()=>{
  const [validator,data]=await Promise.all([
    readFile("lib/pension-declaration-evidence.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
  ]);
  for(const evidence of ["payflow-pension-declaration-1","externalFiling","payloadChecksum","declarationDate","recordedBy"])
    assert.match(validator,new RegExp(evidence));
  for(const evidence of ["invalidPensionDeclaration","PENSION-DECLARATION","validatePensionDeclarationEvidence","Backup pension declaration evidence"])
    assert.match(data,new RegExp(evidence));
});

test("employer identifier changes supersede unfiled RTI and CIS packages but preserve terminal evidence",async()=>{
  const [employer,page]=await Promise.all([readFile("app/api/employer/route.ts","utf8"),readFile("app/page.tsx","utf8")]);
  assert.match(employer,/rtiIdentityChanged=\["payeReference","accountsOfficeReference"\]/);
  assert.match(employer,/\["FPS","EPS","NVR","Additional FPS","EXB"\]/);
  assert.match(employer,/\["validated","test-ready"\]\.includes\(filing\.status\)/);
  assert.match(employer,/employer PAYE or Accounts Office reference changed/);
  assert.match(employer,/supersededRtiPackages\+\+/);
  assert.match(employer,/superseded:employer-identity-packages/);
  assert.match(employer,/supersededRtiPackages,supersededCisArtifacts/);
  assert.doesNotMatch(employer,/\["validated","test-ready","accepted"\]/);
  assert.match(page,/prepared RTI\/CIS package/);
  assert.match(page,/regenerate before filing/);
});

test("statutory reports enforce tax-year eligibility and reconcile employer liabilities", async () => {
  const reports=await readFile("app/api/reports/route.ts","utf8");
  for(const type of ["p45","p60","p11","p32","pbik","leave-summary","calendar","employee-count"]) {
    assert.match(reports,new RegExp(`"${type}"`),`${type} report is missing`);
  }
  assert.match(reports,/identity\.leavingDate>=dates\.start&&identity\.leavingDate<=dates\.end/);
  assert.match(reports,/identity\.leavingDate>=dates\.end/);
  assert.match(reports,/P60 certificates can only be generated after final payroll period \$\{maximumPeriods\} is finalised/);
  assert.match(reports,/reportErrorResponse/);
  assert.match(reports,/must be finalised\|only be generated after/);
  assert.match(reports,/const allLiabilityRows=Array\.from\(\{length:12\}/);
  assert.match(reports,/requestedPeriod\?allLiabilityRows\.filter/);
  assert.match(reports,/leaveEntitlementBalance/);
  assert.match(reports,/r\.status==="reviewed"/);
  assert.match(reports,/attachmentRuns=allRuns\.filter/);
  assert.match(reports,/n\.payStartDate<=dates\.end/);
  assert.match(reports,/\^\[=\+\\-@\]/);
  assert.match(reports,/statutoryPayAllocation/);
  assert.match(reports,/allRuns\.filter/);
  assert.match(reports,/p\.taxYear===taxYear/);
  assert.match(reports,/p\.verificationNumber\|\|""/);
  assert.match(reports,/runIds\.has\(item\.payRunId\)/);
  assert.match(reports,/leaveEntitlementBalance\(e\.annualLeaveDays,e\.startDate,e\.leavingDate/);
  assert.match(reports,/This is an employer-level report and cannot be filtered to one employee/);
  assert.match(reports,/previous-employment opening balances come from finalised RTI snapshots/);
  assert.match(reports,/10500-allowanceUsed/);
  assert.match(reports,/hmrcPayments/);
  assert.match(reports,/row\.status==="recorded"/);
  assert.match(reports,/Outstanding \/ \(overpaid\)/);
  assert.match(reports,/amountPayable-payments-credits\+charges/);
  assert.match(reports,/Active at tax-year end/);
  assert.match(reports,/!identity\.leavingDate\|\|identity\.leavingDate>=dates\.end/);
  assert.match(reports,/format==="html"/);
  assert.match(reports,/text\/html; charset=utf-8/);
  assert.match(reports,/actor:access\.user\.email/);
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/report-table-scroll/);
  assert.match(page,/preview\.rows\.slice\(0,25\)/);
  assert.match(page,/employerReportTypes\.has\(type\)\)setEmployeeId\(0\)/);
  assert.match(page,/disabled=\{!usesPeriod\}/);
  assert.match(page,/periodReportTypes=new Set\(\[[^\]]*"cis"/);
  assert.match(page,/taxMonthSelection=\["cis","p30","p32"\]\.includes\(selectedReportType\)/);
  assert.match(page,/selectablePeriods=taxMonthSelection\?Array\.from\(\{length:12\}/);
  assert.match(page,/disabled=\{!usesEmployee\}/);
  assert.match(page,/disabled=\{!enabledPeriods\.includes\(value\)\}/);
  assert.match(page,/noticeError\?"!":"✓"/);
});

test("report downloads expose an honest, private and source-bound output contract", async () => {
  const [page,reports,portalDocuments]=await Promise.all([
    readFile("app/page.tsx","utf8"),
    readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/portal/documents/route.ts","utf8"),
  ]);
  assert.match(page,/Printable HTML, CSV/);
  assert.match(page,/Browser print to PDF/);
  assert.doesNotMatch(page,/\["P45 \/ P60 employee forms","Employee","PDF"/);
  assert.match(reports,/Export format must be csv or html/);
  assert.match(reports,/x-payflow-source-checksum/);
  assert.match(reports,/Source checksum \$\{escapeHtml\(checksum\)\}/);
  assert.match(reports,/cache-control":"private, no-store"/);
  assert.match(reports,/content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
  assert.match(portalDocuments,/cache-control":"private, no-store"/);
  assert.match(portalDocuments,/content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
});

test("statutory non-payment notices and guarded tax-year rollover are implemented", async () => {
  const notices=await readFile("app/api/statutory-notices/route.ts","utf8");
  const eligibility=await readFile("lib/statutory-eligibility.ts","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  const yearEnd=await readFile("app/api/year-end/route.ts","utf8");
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  for(const form of ["SMP1","SPP1","SAP1","SSP1","SPBP1","NEO1"])assert.match(eligibility,new RegExp(form));
  for(const reportType of ["smp1","spp1","sap1","ssp1","spbp1","neo1"])assert.match(reports,new RegExp(`${reportType}:`));
  assert.match(reports,/n\.formType===requestedForm/);
  assert.match(page,/SMP1 maternity non-payment notices/);
  assert.match(page,/NEO1 neonatal-care-pay notices/);
  assert.match(notices,/a non-payment notice cannot be issued/);
  assert.match(notices,/Enter a valid statutory-pay date range/);
  assert.match(notices,/An issued statutory non-payment notice already exists/);
  assert.match(notices,/employees\.employerId/);
  assert.match(notices,/text\/html; charset=utf-8/);
  assert.match(notices,/SPBP1:"Statutory Parental Bereavement Pay non-payment record"/);
  assert.match(notices,/checksum!==row\.payloadChecksum/);
  assert.match(notices,/frozen statutory-notice evidence is incomplete or has failed its checksum/);
  assert.match(notices,/x-payflow-source-checksum/);
  assert.match(notices,/cache-control":"private, no-store"/);
  assert.match(notices,/content-security-policy":"default-src 'none'; style-src 'unsafe-inline'"/);
  assert.match(notices,/const transitions:Record<string,string\[\]>/);
  assert.match(notices,/cancellation reason between 5 and 500 characters/);
  assert.match(notices,/access\.membership\.canViewConfidential/);
  assert.match(notices,/\$\{status\}:statutory-notice/);
  for(const evidence of ["employeeSnapshot","payloadChecksum","payflow-statutory-notice-1","cancellationReason","sha256"])assert.match(notices,new RegExp(evidence));
  assert.match(submissions,/finalSubmission/);
  assert.match(yearEnd,/Number\(payload\.periodNumber\)===\(s\.type==="EPS"\?12:finalPeriodNumber\)&&payload\.finalSubmission===true/);
  assert.match(yearEnd,/filing\.status==="accepted"/);
  assert.match(yearEnd,/Final RTI submission accepted by HMRC/);
  assert.match(yearEnd,/Local test-ready packages are not treated as filed/);
  assert.match(yearEnd,/db\.update\(employers\)\.set\(\{taxYear:result\.nextTaxYear/);
  assert.match(page,/Tax year \$\{body\.toTaxYear\} created with period 1 open\.`\);window\.location\.reload\(\)/);
  assert.match(page,/SSP entitlement is ending; issue SSP1/);
  assert.match(page,/inLegalCustody,sspEnding/);
  assert.match(await readFile("app/api/leave/route.ts","utf8"),/sspEnding:Boolean\(input\.sspEnding\)/);
  assert.match(yearEnd,/Year end is not ready for rollover/);
  assert.match(yearEnd,/\["FPS","Additional FPS","EPS"\]/);
  assert.match(yearEnd,/!filing\.correlationId\?\.startsWith\("PF-TEST-"\)/);
  assert.match(yearEnd,/filing\.submittedAt/);
  assert.match(yearEnd,/acceptedFinalCandidates\.find/);
  assert.match(yearEnd,/alreadyExisted:true/);
  assert.match(yearEnd,/incomplete or changed period set/);
  assert.match(yearEnd,/await db\.batch/);
  assert.match(yearEnd,/status:index===0\?"open":"future"/);
  assert.match(yearEnd,/expectedSchedule=scheduledPayPeriods\(result\.nextTaxYear,frequency,nextFirstPayDate\)/);
  assert.match(yearEnd,/tax-year-rollover-recovered/);
  assert.match(yearEnd,/datesBackfilled/);
  assert.match(yearEnd,/employeeActiveInRange\(employee\.startDate,employee\.leavingDate,period\.periodStart!,period\.periodEnd!\)/);
  assert.match(yearEnd,/actor:access\.user\.email/);
});

test("pay periods are unique per employer tax year and period",async()=>{
  const [schema,migration]=await Promise.all([
    readFile("db/schema.ts","utf8"),readFile("drizzle/0052_unique_pay_periods.sql","utf8"),
  ]);
  assert.match(schema,/uniqueIndex\("pay_periods_employer_tax_year_period_unique"\)/);
  assert.match(schema,/table\.employerId,table\.taxYear,table\.periodNumber/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS `pay_periods_employer_tax_year_period_unique`/);
});

test("tax-year rollover updates operational identifiers, dates and filenames without unlocking old rates",async()=>{
  const [page,payRuns,exportsRoute,submissions,adjustments]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("app/api/exports/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),
    readFile("app/api/adjustments/route.ts","utf8"),
  ]);
  assert.match(page,/const taxYearStartYear=/);
  assert.match(page,/const taxYearSlug=/);
  assert.match(page,/const fallbackPayrollId=/);
  assert.match(page,/fallbackPayrollId\(employee,taxYear\)/);
  assert.match(page,/payroll-journal-\$\{taxYearSlug\(taxYear\)\}\.csv/);
  assert.match(page,/\$\{reportTypes\[report\]\}-\$\{taxYearSlug\(taxYear\)\}/);
  assert.match(page,/scheduledPayPeriods\(taxYear,payFrequency,firstPayDate\|\|undefined\)/);
  assert.match(page,/cessationDate,setCessationDate\]=useState\(`\$\{taxYearStartYear\(taxYear\)\+1\}-04-05`\)/);
  assert.doesNotMatch(page,/PAY-\$\{employee\.id\}-2026/);
  assert.doesNotMatch(page,/payroll-journal-2026-27/);
  assert.match(page,/payrollRulesAvailable=taxYear==="2026\/27"/);
  assert.match(payRuns,/taxYear!=="2026\/27"/);
  for(const route of [payRuns,exportsRoute,submissions,adjustments])assert.doesNotMatch(route,/String\(input\.taxYear\|\|"2026\/27"\)/);
});

test("client portfolio renders immediately and supports payroll search",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/setPortfolios\(memberships\);/);
  assert.match(page,/aria-label="Search payrolls"/);
  assert.match(page,/filteredPortfolios/);
  assert.match(page,/`Employer #\$\{client\.employerId\}`\]\.some\(value=>String\(value\|\|""\)\.toLowerCase\(\)\.includes\(normalisedClientSearch\)\)/);
  assert.match(page,/portfolioLoaded\?/);
  assert.match(page,/Loading payrolls…/);
  assert.match(page,/Loading year-end checks/);
  assert.match(page,/"Rename payroll","Search payrolls"/);
});

test("backup tools encrypt locally and accept protected recovery files",async()=>{
  const [page,encryption]=await Promise.all([
    readFile("app/page.tsx","utf8"),
    readFile("lib/backup-encryption.ts","utf8"),
  ]);
  assert.match(page,/encryptPayrollBackup\(backup,backupPassword\)/);
  assert.match(page,/decryptPayrollBackup\(parsed,importBackupPassword,employerId\)/);
  assert.match(page,/Password for encrypted files/);
  assert.match(page,/accept="application\/json,\.json,\.payflow"/);
  assert.match(page,/"Password protection"/);
  assert.match(encryption,/AES-GCM/);
  assert.match(encryption,/PBKDF2/);
  assert.match(encryption,/310_000/);
  assert.match(encryption,/additionalData/);
});

test("retained payroll versions are tenant-scoped and reuse atomic backup recovery",async()=>{
  const [page,route,schema,migration]=await Promise.all([
    readFile("app/page.tsx","utf8"),
    readFile("app/api/payroll-versions/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),
    readFile("drizzle/0065_payroll_versions.sql","utf8"),
  ]);
  assert.match(schema,/export const payrollVersions = sqliteTable\("payroll_versions"/);
  assert.match(schema,/backupChecksum: text\("backup_checksum"\)\.notNull\(\)/);
  assert.match(migration,/CREATE TABLE `payroll_versions`/);
  assert.match(migration,/payroll_versions_employer_checksum_unique/);
  assert.match(route,/requireEmployerAccess\(request,employerId,"employer-admin"\)/);
  assert.match(route,/access\.membership\.role!=="owner"/);
  assert.match(route,/createBackupResponse\(delegatedRequest/);
  assert.match(route,/runDataOperation\(delegatedRequest/);
  assert.match(route,/backup\?\.checksum\?\.value!==version\.backupChecksum/);
  assert.match(route,/action:"restored:payroll-version"/);
  assert.match(route,/createdAt,updatedAt:createdAt/);
  assert.match(route,/currentFingerprint:input\.currentFingerprint/);
  assert.match(page,/formatTimestamp\(version\.createdAt\)/);
  assert.match(page,/Retained payroll versions/);
  assert.match(page,/aria-label="Version revert confirmation"/);
  assert.match(page,/Revert to retained version/);
  assert.match(page,/"Revert version"/);
  assert.match(page,/Open payroll file/);
  assert.match(page,/"Import payroll file"/);
});

test("year-end requires complete current P60 evidence",async()=>{
  const reports=await readFile("app/api/reports/route.ts","utf8");
  const yearEnd=await readFile("app/api/year-end/route.ts","utf8");
  assert.match(reports,/A JSON report request object is required/);
  assert.match(reports,/employeeIds:eligible\.map\(\(\{employee\}\)=>employee\.id\)/);
  assert.match(reports,/sourceChecksum/);
  assert.match(reports,/employeeIds:data\.employeeIds\|\|\[\]/);
  assert.match(yearEnd,/A JSON year-end operation object is required/);
  assert.match(yearEnd,/currentP60Checksum/);
  assert.match(yearEnd,/completeP60Evidence/);
  assert.match(yearEnd,/evidenceIds\.length===eligibleP60Ids\.length/);
  assert.match(yearEnd,/Generate a current P60 set for all/);
  assert.match(yearEnd,/payflow-rti-external-result-1/);
  assert.match(yearEnd,/receipt\.acknowledgementReference===filing\.correlationId/);
  assert.match(yearEnd,/sha256\(JSON\.stringify\(payload\)\)===filing\.payloadChecksum/);
  assert.match(yearEnd,/coverageErrors/);
  assert.match(yearEnd,/matching\.length!==1/);
  assert.doesNotMatch(yearEnd,/audit\.some\(a=>a\.action==="generated:p60"/);
});

test("administrator sessions and employer roles protect payroll data", async () => {
  const auth=await readFile("lib/admin-auth.ts","utf8");
  const session=await readFile("app/api/admin/session/route.ts","utf8");
  const users=await readFile("app/api/admin/users/route.ts","utf8");
  const employeesRoute=await readFile("app/api/employees/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  const protectedRoutes=["pay-runs","leave","pensions","submissions","hmrc-liabilities","hmrc-notices","hmrc-payments","cis","reports","analysis","year-end","attachments","benefits","employer","data","statutory-notices","employee-history","calendar-days"];
  assert.match(auth,/PBKDF2/);
  assert.match(auth,/HttpOnly|sessionCookie/);
  assert.match(page,/canPayrollWrite=\["owner","admin","payroll"\]\.includes\(role\)/);
  assert.match(page,/if\(\["Employer","Clients","Tools"\]\.includes\(tab\)\)return canEmployerAdmin/);
  assert.match(page,/disabled=\{!canPayrollWrite\|\|periodLocked/);
  assert.match(page,/canEmployeeWrite=\{canEmployeeWrite\}/);
  assert.match(page,/canEmployeeWrite\?"Edit":"View only"/);
  assert.match(auth,/rolePermissions/);
  assert.match(session,/SameSite=Strict/);
  assert.match(session,/This employer already has an administrator/);
  assert.match(employeesRoute,/rows\.filter\(row=>!row\.confidential\)/);
  assert.match(users,/membershipId:employerMemberships\.id/);
  assert.match(users,/last active employer administrator cannot be demoted or revoked/);
  assert.match(users,/updated:employer-membership/);
  assert.match(users,/created:employer-membership/);
  assert.match(page,/function AccessWorkspace/);
  assert.match(page,/Tenant-bound administrators/);
  for(const route of protectedRoutes){
    const source=await readFile(`app/api/${route}/route.ts`,"utf8");
    assert.match(source,/requireEmployerAccess/,`${route} is not protected by employer membership`);
  }
});

test("HMRC notices are tenant-scoped, validated and applied through guarded employee updates",async()=>{
  const notices=await readFile("app/api/hmrc-notices/route.ts","utf8");
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0011_hmrc_notices.sql","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/export const hmrcNotices/);
  assert.match(migration,/hmrc_notices_employer_identifier_idx/);
  assert.match(notices,/requireEmployerAccess\(request,employerId,"employee-write"\)/);
  assert.match(notices,/eq\(hmrcNotices\.employerId,employerId\)/);
  assert.match(notices,/eq\(employees\.employerId,employerId\)/);
  assert.match(notices,/employees\.confidential/);
  assert.match(notices,/canViewConfidential/);
  assert.match(notices,/scheduledPayPeriods/);
  assert.match(notices,/firstScheduled\?\{periodNumber:1,payDate:firstScheduled\.payDate\}/);
  assert.match(notices,/isRecognisedPayeTaxCode/);
  assert.match(notices,/dateWithinTaxYear/);
  assert.match(notices,/notice effective date must fall within its tax year/);
  assert.match(notices,/validNino/);
  assert.match(notices,/validIsoDate/);
  assert.match(notices,/eq\(hmrcNotices\.taxYear,taxYear\)/);
  assert.match(notices,/This notice is not effective for open Period/);
  assert.match(notices,/equivalent active HMRC notice already exists/);
  assert.match(notices,/employee=type!=="generic"&&payrollId/);
  assert.match(notices,/needs a valid pay date before an HMRC notice can be applied/);
  assert.match(notices,/later .* notice .* has already been applied/);
  assert.match(notices,/superseded:hmrc-notice/);
  assert.match(notices,/compareHmrcNoticePriority/);
  assert.match(notices,/hmrcNoticeInstructionKey/);
  assert.match(notices,/stop-postgraduate/);
  assert.match(notices,/\{postgraduateLoan:true,updatedAt:timestamp\}/);
  assert.match(notices,/\{studentLoanPlan:notice\.studentLoanPlan,updatedAt:timestamp\}/);
  assert.match(notices,/applied:hmrc-notice/);
  assert.match(page,/HMRC notice inbox and history/);
  assert.match(page,/Issued date/);
  assert.match(page,/issuedDate:noticeIssuedDate,effectiveDate:noticeEffectiveDate/);
  assert.doesNotMatch(page,/issuedDate:noticeEffectiveDate,effectiveDate:noticeEffectiveDate/);
  assert.match(page,/payrollId:noticeType==="generic"\?undefined:noticePayrollId/);
  assert.match(page,/noticeType==="generic"\?noticeMessage\.trim\(\)\.length<3:!noticePayrollId/);
  assert.match(page,/firstOpen=loaded\.find\(\(item:any\)=>item\.status==="open"\)/);
  assert.match(page,/setNoticeEffectiveDate\(firstOpen\.payDate\|\|periodPayDate\(firstOpen\.periodNumber,taxYear\)\.iso\)/);
  assert.match(page,/Automatic retrieval from HMRC is disabled/);
  assert.match(page,/function downloadNotices\(\)/);
  assert.match(page,/Download notices CSV/);
  assert.match(page,/hmrc-notices-\$\{taxYear\.replace\("\/","-"\)\}\.csv/);
  assert.match(page,/formatUkDateTime\(item\.appliedAt,""\)/);
  assert.match(page,/formatUkDateTime\(item\.ignoredAt,""\)/);
  assert.match(page,/Stop student loan only/);
  assert.match(page,/Stop postgraduate loan only/);
});

test("report documents expose an explicit browser print and PDF workflow",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/async function openPrintView\(\)/);
  assert.match(page,/format:"html"/);
  assert.match(page,/window\.open\(url,"_blank"\)/);
  assert.match(page,/opened\.opener=null/);
  assert.match(page,/Open print \/ PDF view/);
  assert.match(page,/Use the browser Print command to save as PDF/);
});

test("employee register sorting and tenant-scoped lifecycle history are operational",async()=>{
  const [page,history,schema]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/employee-history/route.ts","utf8"),readFile("db/schema.ts","utf8"),
  ]);
  assert.match(page,/aria-label="Order employees"/);
  assert.match(page,/Newest starters/);
  assert.match(page,/function EmployeeHistoryModal/);
  assert.match(page,/Download history CSV/);
  assert.match(page,/formatUkDateTime\(value,"Recorded time unavailable"\)/);
  assert.match(page,/Recorded time unavailable/);
  assert.match(page,/\/api\/employee-history\?employerId=\$\{employerId\}&employeeId=\$\{employee\.id\}/);
  assert.match(history,/eq\(employees\.employerId, employerId\)/);
  assert.match(history,/employee\.confidential && !access\.membership\.canViewConfidential/);
  for(const source of ["payRuns","leaveEvents","hmrcNotices","statutoryNotices","pensionMembershipEvents","expensesBenefits","employeeChangeRequests"])
    assert.match(history,new RegExp(source));
  assert.match(history,/category: "statutory"/);
  assert.match(history,/statutoryNotices: statutoryNoticeRows\.length/);
  assert.match(history,/item\.subtype&&item\.subtype!=="none"\?item\.subtype:item\.type/);
  assert.match(history,/const sentence/);
  assert.match(page,/history\.summary\.statutoryNotices/);
  assert.match(history,/eq\(payPeriods\.employerId, employerId\)/);
  assert.match(history,/eq\(hmrcNotices\.employerId, employerId\)/);
  assert.match(history,/eq\(employeeChangeRequests\.employerId, employerId\)/);
  assert.match(history,/const pensionDetail/);
  assert.doesNotMatch(history,/before: item\.before|after: item\.after/);
  assert.match(schema,/const runtimeTimestamp = \(\) => new Date\(\)\.toISOString\(\)/);
  assert.match(schema,/\$defaultFn\(runtimeTimestamp\)/);
  assert.match(schema,/\$onUpdateFn\(runtimeTimestamp\)/);
});

test("tools expose a shared-engine gross-to-net, target-net and statutory-rate calculator",async()=>{
  const [page,styles]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),
  ]);
  assert.match(page,/function UtilitiesWorkspace\(\)/);
  assert.match(page,/solveGrossForTargetNet\(base,targetNet\)/);
  assert.match(page,/calculateMonthlyPayroll\(\{\.\.\.base,grossPay:calculatedGross\}\)/);
  assert.match(page,/Gross to net/);
  assert.match(page,/Target net to gross/);
  assert.match(page,/This is a non-cumulative W1\/M1 estimate and does not change payroll/);
  for(const text of ["Plan 1 / 2 / 4 / 5","Postgraduate loan","Qualifying earnings pension band","National Living Wage","Statutory family-pay cap","SSP maximum"])
    assert.match(page,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(styles,/\.utilities-grid/);
  assert.match(styles,/\.calculator-result/);
});

test("HMRC payments reconcile liabilities with tenant-scoped auditable records",async()=>{
  const payments=await readFile("app/api/hmrc-payments/route.ts","utf8");
  const liabilities=await readFile("app/api/hmrc-liabilities/route.ts","utf8");
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0012_hmrc_payments.sql","utf8");
  const voidMigration=await readFile("drizzle/0035_hmrc_payment_void_reason.sql","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/export const hmrcPayments/);
  assert.match(migration,/hmrc_payments_employer_reference_idx/);
  assert.match(payments,/eq\(hmrcPayments\.employerId,employerId\)/);
  assert.match(payments,/taxMonth<1\|\|taxMonth>12/);
  assert.match(payments,/toISOString\(\)\.slice\(0,10\)!==paymentDate/);
  assert.match(payments,/Payment or adjustment date cannot be in the future/);
  assert.match(payments,/upper\(\$\{hmrcPayments\.reference\}\)/);
  assert.match(payments,/Select a supported HMRC payment method/);
  assert.match(payments,/Enter a void reason between 5 and 250 characters/);
  assert.match(voidMigration,/ADD `void_reason` text/);
  assert.match(schema,/voidReason: text\("void_reason"\)/);
  assert.match(payments,/scheduledPayPeriods\(taxYear,payrollFrequencyRule\(employer\.payFrequency\)\.frequency/);
  assert.match(payments,/expectedPeriods\.every\(expected/);
  assert.match(payments,/\["finalised","migrated"\]\.includes\(period\.status\)/);
  assert.match(payments,/Complete every payroll period in HMRC tax month/);
  assert.match(payments,/recorded:hmrc-payment/);
  assert.match(payments,/voided:hmrc-payment/);
  assert.match(liabilities,/paymentTotal\+creditTotal-chargeTotal/);
  assert.match(liabilities,/balance=round\(current\.amountDue-settled\)/);
  assert.match(liabilities,/paymentDeadline\(taxYear,taxMonth,22\)/);
  assert.match(liabilities,/postalDueDate/);
  assert.match(liabilities,/reconciliationStatus/);
  assert.match(page,/Record payment or adjustment/);
  assert.match(page,/Why is this HMRC payment or adjustment being voided/);
  assert.match(page,/Electronic payment due/);
  assert.match(page,/disabled=\{!hmrcMonthFinalised\}/);
  assert.match(page,/Number\(paymentAmount\)<=0\|\|paymentReference\.trim\(\)\.length<3/);
  assert.match(page,/Unpaid \/ \(overpaid\)/);
});

test("employee onboarding persists departments, work, payment, RTI and portal controls",async()=>{
  const employeesRoute=await readFile("app/api/employees/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  for(const field of ["departmentName","contractedHours","annualLeaveDays","paymentMethod","bankName","accountName","sortCode","accountNumber","irregularPayment","zeroPayFpsExclusion","employeePortal","confidential","nationality","passportNumber","maritalStatus"]){
    assert.match(employeesRoute,new RegExp(field),`${field} is not persisted by the employee API`);
    assert.match(page,new RegExp(field),`${field} is not mapped by the employee workspace`);
  }
  assert.match(employeesRoute,/db\.insert\(departments\)/);
  assert.match(employeesRoute,/Sort code must contain 6 digits/);
  assert.match(employeesRoute,/Account number must contain 8 digits/);
  assert.match(employeesRoute,/validateBankAndPortalEvidence/);
  assert.match(employeesRoute,/Bank details must include the account name, a 6-digit sort code and an 8-digit account number/);
  assert.match(employeesRoute,/Enable employee portal access before allowing employee bank-detail requests/);
  assert.doesNotMatch(page,/value=\{employee\.accountName\|\|employee\.name\}/);
  assert.match(employeesRoute,/must be a valid calendar date/);
  assert.match(employeesRoute,/A directorship start date is required/);
  assert.match(employeesRoute,/\["Annual salary",input\.annualSalary\]/);
  assert.match(employeesRoute,/invalidNumber\[0\].*must be a valid number/);
  assert.match(employeesRoute,/Working days per week must be a whole number between 0 and 7/);
  assert.match(employeesRoute,/Confidential employee permission is required/);
  assert.match(employeesRoute,/if\(!existingEmployer\.length\)return NextResponse\.json\(\{error:"Employer was not found\."/);
  assert.doesNotMatch(employeesRoute,/Gotts Golf Club CIC/);
  assert.match(employeesRoute,/existing\.confidential&&!access\.membership\.canViewConfidential/);
  assert.match(employeesRoute,/action:"updated:employee"/);
  assert.match(employeesRoute,/action:"created:employee"/);
  assert.match(employeesRoute,/annualLeaveDays:Number\(input\.annualLeaveDays\?\?28\)/);
  assert.match(employeesRoute,/Directorship cannot start before the employment start date/);
  assert.match(employeesRoute,/status:employmentStatus\(input\.leavingDate\)/);
  assert.match(employeesRoute,/date&&date<=new Date\(\)\.toISOString\(\)\.slice\(0,10\)\?"leaver":"active"/);
  assert.match(employeesRoute,/portalCanEditBank:Boolean\(input\.employeePortal&&input\.portalCanEditBank\)/);
  assert.match(page,/function closeEmployeeEditor\(\)/);
  assert.match(page,/!employeeDefaults\.some\(item=>item\.id===employee\.id\)/);
  assert.match(page,/disabled=\{!employee\.director\}/);
  assert.match(page,/employeePortal:false,portalCanEditBank:false/);
  assert.match(page,/No employees in this finalised period have positive net pay and complete credit-transfer bank details/);
  assert.doesNotMatch(page,/sortCode: "20-18-32"/);
});

test("employee HR privacy and portal bank permissions are enforced end to end",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0013_employee_hr_fields.sql","utf8");
  const employeesApi=await readFile("app/api/employees/route.ts","utf8");
  const portalApi=await readFile("app/api/portal/me/route.ts","utf8");
  const requestApi=await readFile("app/api/portal/requests/route.ts","utf8");
  const sessionApi=await readFile("app/api/portal/session/route.ts","utf8");
  const inviteApi=await readFile("app/api/portal/invites/route.ts","utf8");
  const reviewApi=await readFile("app/api/employee-requests/route.ts","utf8");
  const documentApi=await readFile("app/api/portal/documents/route.ts","utf8");
  const portalPage=await readFile("app/portal/page.tsx","utf8");
  const payrollPage=await readFile("app/page.tsx","utf8");
  for(const field of ["portalCanEditBank","managerName","emergencyContactName","medicalInformation","hrNotes","hrNotesConfidential"]){
    assert.match(schema,new RegExp(field));
    assert.match(employeesApi,new RegExp(field));
    assert.match(payrollPage,new RegExp(field));
  }
  assert.match(migration,/portal_can_edit_bank/);
  assert.match(migration,/hr_notes_confidential/);
  assert.match(employeesApi,/!access\.membership\.canViewConfidential/);
  assert.match(employeesApi,/medicalInformation:null/);
  assert.match(employeesApi,/emergencyContactPhone:null/);
  assert.doesNotMatch(portalApi,/update\(employees\)/);
  assert.match(requestApi,/employee\.portalCanEditBank/);
  assert.match(requestApi,/eq\(employees\.employeePortal,true\)/);
  assert.match(sessionApi,/eq\(employees\.employeePortal,true\)/);
  assert.match(sessionApi,/Employee portal access is disabled/);
  assert.match(sessionApi,/portalSession/);
  assert.match(sessionApi,/eq\(employeePortalSessions\.id,session\.sessionId\)/);
  assert.match(sessionApi,/isNull\(employeePortalInvites\.usedAt\)/);
  assert.match(inviteApi,/employee\.confidential&&!access\.membership\.canViewConfidential/);
  assert.match(inviteApi,/created:employee-portal-invite/);
  assert.match(inviteApi,/isNull\(employeePortalInvites\.usedAt\)/);
  assert.match(requestApi,/A .* change request is already awaiting payroll review/);
  assert.match(requestApi,/Enter a valid email address/);
  assert.match(requestApi,/Employee request notes cannot exceed 500 characters/);
  assert.match(requestApi,/employee-change:requested/);
  assert.match(reviewApi,/decision==="approved"/);
  assert.match(reviewApi,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(reviewApi,/validProposal\(change\.requestType,proposed\)/);
  assert.match(reviewApi,/eq\(employees\.employerId,employerId\)/);
  const reportsApi=await readFile("app/api/reports/route.ts","utf8");
  assert.match(reportsApi,/employeeIdentifyingReports/);
  assert.match(reportsApi,/"employee-count"/);
  assert.match(reportsApi,/!canViewConfidential\?employeeRows\.filter\(e=>!e\.confidential\)/);
  assert.match(reportsApi,/Boolean\(access\.membership\.canViewConfidential\)/);
  assert.match(reportsApi,/attachmentCutoff=requestedPeriod/);
  const portalDocuments=await readFile("app/api/portal/documents/route.ts","utf8");
  assert.match(portalDocuments,/p45OpeningFromFinalisedSnapshots\(sortedRuns\.map\(snapshot\)/);
  assert.match(portalDocuments,/const finalIdentity=identity\(lastSnapshot\)/);
  assert.match(reviewApi,/employee-change:\$\{decision\}/);
  assert.match(documentApi,/period\.periodNumber===maximumPeriods&&period\.status==="finalised"/);
  assert.match(documentApi,/run\.status==="finalised"/);
  assert.match(documentApi,/cache-control":"private, no-store"/);
  assert.match(documentApi,/Tax year must use a valid YYYY\/YY sequence/);
  assert.match(documentApi,/Payslip period must be a whole number between 1 and \$\{maximumPeriods\}/);
  assert.match(documentApi,/The leaving date does not fall within the requested P45 tax year/);
  assert.match(documentApi,/No finalised payroll is available for this P60 tax year/);
  assert.match(portalApi,/latestYearPayslips/);
  assert.match(portalApi,/p45TaxYear/);
  assert.match(portalPage,/item\.periodNumber,item\.taxYear/);
  assert.match(portalPage,/disabled=\{!profile\.portalCanEditBank\}/);
  assert.match(portalPage,/Request bank changes/);
  assert.match(portalPage,/Download payslip/);
  assert.match(portalPage,/const retryablePortalStatus=\(status:number\)=>\[500,502,503,504\]\.includes\(status\)/);
  assert.match(portalPage,/for\(let attempt=0;attempt<3;attempt\+\+\)/);
  assert.match(portalPage,/const body=await readPortalJson\(response\)/);
  assert.match(portalPage,/if\(response\.status===401\)\{setData\(null\);setRequests\(\[\]\);return;\}/);
  assert.match(portalPage,/The employee portal is temporarily unavailable/);
  assert.doesNotMatch(portalPage,/await response\.json\(\)/);
  assert.doesNotMatch(portalPage,/â€¦|â€™|Â·|â€”/);
  assert.match(payrollPage,/Allow employee to update bank details/);
  assert.match(payrollPage,/Mark HR notes as confidential/);
});

test("period payroll documents retain their own finalised identity evidence",async()=>{
  const [reports,documents,deliveries]=await Promise.all([
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/portal/documents/route.ts","utf8"),readFile("app/api/payslip-deliveries/route.ts","utf8"),
  ]);
  assert.match(reports,/const periodName=\[String\(snapshot\.firstName/);
  assert.match(reports,/title:"Finalised payslips",columns:\["Employee","Payroll ID","Period"/);
  assert.match(reports,/periodName,String\(snapshot\.payrollId\|\|employee\.payrollId\)/);
  assert.match(documents,/const runSnapshot=snapshot\(run\),runIdentity=identity\(runSnapshot\)/);
  assert.match(documents,/renderPayslipHtml\(\[document\]/);
  assert.match(documents,/finalIdentity\.leavingDate&&finalIdentity\.leavingDate<end/);
  assert.match(documents,/P45 is available only after a leaving date has been recorded in finalised payroll/);
  assert.match(documents,/esc\(p45Identity\.leavingDate\)/);
  assert.match(deliveries,/grossPay:run\.grossPay/);
  assert.match(deliveries,/otherDeductions:run\.otherDeductions,netPay:run\.netPay/);
});

test("employer payslip editor persists branding and drives payroll and portal documents",async()=>{
  const [page,styles,schema,migration,employer,reports,portal,design,evidence]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0069_payslip_designer.sql","utf8"),readFile("app/api/employer/route.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/portal/documents/route.ts","utf8"),
    readFile("lib/payslip-design.ts","utf8"),readFile("lib/employer-cis-state-evidence.ts","utf8"),
  ]);
  assert.match(page,/Payslip editor/);assert.match(page,/function PayslipDesignEditor/);assert.match(page,/Upload payslip logo/);
  for(const label of ["Year-to-date totals","Employer NIC and pension","Hours and rates","Payment method"])assert.match(page,new RegExp(label));
  assert.match(page,/LIVE SAMPLE/);assert.match(styles,/\.payslip-designer/);assert.match(styles,/\.payslip-editor-preview/);
  assert.match(schema,/payslipDesign: text\("payslip_design"\)/);assert.match(migration,/ADD `payslip_design` text/);
  assert.match(employer,/validPayslipLogo/);assert.match(employer,/JSON\.stringify\(normalisePayslipDesign/);assert.match(evidence,/validatePayslipDesign/);
  assert.match(reports,/renderPayslipHtml/);assert.match(reports,/employerSettings\.payslipDesign/);assert.match(reports,/employerSettings\.logoUrl/);
  assert.match(portal,/renderPayslipHtml/);assert.match(portal,/payItems\.payRunId/);assert.match(portal,/img-src data:/);
  assert.match(design,/payflow-payslip-design-1/);assert.match(design,/Payment after leaving/);assert.match(design,/Employer contributions \(not deducted from pay\)/);
});

test("payroll finalisation creates payment-aware RTI and pension workflow tasks",async()=>{
  const [page,payRuns,styles]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/globals.css","utf8"),
  ]);
  assert.match(payRuns,/const rtiTypes=noEmployeePayments/);assert.match(payRuns,/statutoryRecovery>0\?\["EPS_RECOVERY"\]/);
  assert.match(payRuns,/hasEmployeePaymentActivity/);assert.match(payRuns,/acceptedNoPaymentTaxMonths/);
  assert.match(payRuns,/const confirmedEmptyPayroll=input\.action==="finalise"&&input\.confirmNoEmployeePayments===true/);
  assert.match(payRuns,/const rtiTasks:RtiWorkflowTask\[\]/);assert.match(payRuns,/monthComplete&&hasPayFlowPeriod&&!hasPayments/);
  assert.match(payRuns,/type:"EPS_RECOVERY"/);assert.match(payRuns,/statutoryPayByType/);assert.match(payRuns,/statutoryRecoveryByType/);
  assert.match(payRuns,/completedRtiPeriodIds/);assert.match(payRuns,/preparedPensionPeriodIds/);
  assert.match(payRuns,/rtiReadyPeriods/);assert.match(payRuns,/pensionReadyPeriods/);
  assert.match(page,/PayrollWorkflowStatus/);assert.match(page,/className="workflow-badge"/);
  assert.match(page,/No employee payments are entered for period/);
  assert.match(page,/action==="draft"&&!sourceEmployees\.length/);
  assert.match(page,/RTI now has an EPS no-payment task/);
  assert.match(page,/Pension contributions are also ready for provider submission/);
  assert.match(page,/await loadHistory\(\);await onDataChanged\(\)/);
  assert.match(page,/ready for submission/);assert.match(page,/Generate provider file for period/);
  assert.match(styles,/\.mainnav \.workflow-badge/);assert.match(styles,/#c93434/);
});

test("module pages omit duplicate headings while RTI keeps filing types before the period strip",async()=>{
  const [page,styles]=await Promise.all([readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8")]);
  assert.doesNotMatch(page,/className="module-head"/);
  assert.match(styles,/\.module-content\{[\s\S]*?padding-top:0/);
  assert.match(styles,/\.module\[data-module="rti"\] \.operational-workspace>\.submission-cards\{/);
  assert.match(styles,/grid-template-columns:repeat\(5,minmax\(180px,1fr\)\)/);
  assert.match(styles,/\.operational-workspace>\.submission-cards[\s\S]*?order:-2/);
  assert.match(styles,/\.operational-workspace>\.subnav\{order:-1\}/);
});

test("employee portal requests cannot overwrite newer payroll master data",async()=>{
  const invites=await readFile("app/api/portal/invites/route.ts","utf8");
  const session=await readFile("app/api/portal/session/route.ts","utf8");
  const portalRequests=await readFile("app/api/portal/requests/route.ts","utf8");
  const reviews=await readFile("app/api/employee-requests/route.ts","utf8");
  const employees=await readFile("app/api/employees/route.ts","utf8");
  assert.match(invites,/A JSON portal invitation object is required/);
  assert.match(invites,/employerId=Number\(input\.employerId\)/);
  assert.doesNotMatch(invites,/input\.employerId\|\|1/);
  assert.match(session,/A JSON portal sign-in object is required/);
  assert.match(session,/code\.length<20/);
  assert.match(portalRequests,/A JSON employee change object is required/);
  assert.match(reviews,/A JSON employee review object is required/);
  assert.match(reviews,/Portal access has been disabled/);
  assert.match(reviews,/Bank-detail requests are no longer enabled/);
  assert.match(reviews,/Payroll has changed \$\{conflicts\.join/);
  assert.match(reviews,/eq\(employeeChangeRequests\.status,"pending"\)/);
  assert.match(reviews,/This employee request has already been reviewed/);
  assert.equal((employees.match(/employeePortal&&!updated\.employeePortal/g)||[]).length,1);
  assert.match(employees,/revokeEmployeePortalAccess/);
  assert.match(employees,/employeePortalSessions\)\.set\(\{revokedAt:now/);
  assert.match(employees,/employeePortalInvites\)\.set\(\{usedAt:now/);
  assert.equal((employees.match(/phone: input\.phone \|\| null/g)||[]).length,2);
});

test("confidential employees are excluded from every supporting payroll workflow",async()=>{
  const routes=[
    "app/api/analysis/route.ts","app/api/attachments/route.ts","app/api/benefits/route.ts",
    "app/api/adjustments/route.ts","app/api/recurring-items/route.ts","app/api/pay-runs/route.ts",
  ];
  for(const path of routes){
    const source=await readFile(path,"utf8");
    assert.match(source,/access\.membership\.canViewConfidential/,`${path} must enforce confidential access`);
    assert.match(source,/\.confidential/,`${path} must scope confidential employee records`);
  }
  const analysis=await readFile(routes[0],"utf8");
  assert.match(analysis,/allEmployeeRows\.filter\(employee=>!employee\.confidential\)/);
  const payRuns=await readFile(routes[5],"utf8");
  assert.match(payRuns,/runs\.filter\(run=>!run\.confidential\)/);
  assert.match(payRuns,/One or more employees were not found for this employer/);
  for(const path of routes.slice(1,5)){
    const source=await readFile(path,"utf8");
    assert.match(source,/Employee.*not found|employee.*not found|not found for this employer/i);
  }
});

test("central confidential-record permission honours the membership flag for every role",async()=>{
  const auth=await readFile("lib/admin-auth.ts","utf8");
  assert.match(auth,/permission==="confidential-read"&&!membership\.canViewConfidential/);
  assert.doesNotMatch(auth,/permission==="confidential-read".*owner.*admin.*payroll/);
});

test("only the latest finalised period can be safely reopened",async()=>{
  const route=await readFile("app/api/pay-runs/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(route,/export async function PUT/);
  assert.match(route,/latest finalised period and must be reopened first/);
  assert.match(route,/Additional FPS correction instead/);
  assert.match(route,/attachmentOrderDeductions/);
  assert.match(route,/employeeRefundDue:Math\.round/);
  assert.match(route,/status:"superseded"/);
  assert.match(route,/action:"reopened"/);
  assert.match(page,/async function reopenPayroll/);
  assert.match(page,/Reopen payslips/);
  assert.match(page,/period!==Math\.max\(0,\.\.\.finalised\)/);
  assert.match(page,/legacyBasePay=Math\.max\(0,run\.grossPay-\(run\.statutoryPay\|\|0\)\)/);
  assert.match(page,/salary\?\.amount\?\?\(items\.length\?defaults\.pay:legacyBasePay\)/);
});

test("pension provider packages are source-bound and lifecycle-safe",async()=>{
  const route=await readFile("app/api/pensions/route.ts","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const employees=await readFile("app/api/employees/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(route,/A JSON pension operation object is required/);
  assert.match(route,/sourceChecksum/);
  assert.match(route,/supersedeProviderPackages/);
  assert.match(route,/payPeriodId:period\.id/);
  assert.match(route,/typeof input\.automaticEnrolmentScheme!=="boolean"/);
  assert.match(route,/Create and activate a workplace pension scheme before assessing employees/);
  assert.match(route,/input\.optOutNoticeValid===true/);
  assert.match(route,/filingHistory/);
  assert.match(payRuns,/legacyPensionPackages/);
  assert.match(payRuns,/eq\(submissions\.type,"PENSION-PROVIDER"\)/);
  assert.match(payRuns,/supersededPensionPackages/);
  assert.match(employees,/pensionIdentityChanged/);
  assert.match(employees,/eq\(submissions\.type,"PENSION-PROVIDER"\)/);
  assert.match(employees,/action:"superseded:pension-provider-files"/);
  assert.match(employees,/reason:"pension-identity-change"/);
  assert.match(page,/Provider files and communications/);
  assert.match(page,/Not transmitted/);
  assert.match(page,/pensionData\.filingHistory/);
  assert.match(page,/const contributionFile=await response\.blob\(\)/);
  assert.match(page,/downloadBlob\(contributionFile,[\s\S]*await loadPensions\(\)/);
});

test("bank payments use authoritative finalised net pay",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  const exportsRoute=await readFile("app/api/exports/route.ts","utf8");
  const paymentFunction=page.slice(page.indexOf("async function downloadPaymentFile"),page.indexOf("async function downloadPayrollReport"));
  assert.match(paymentFunction,/persistedPeriod\.status!=="finalised"/);
  assert.match(paymentFunction,/item\.status==="finalised"/);
  assert.match(paymentFunction,/run\.netPay>0/);
  assert.match(paymentFunction,/taxYear,periodNumber:period/);
  assert.doesNotMatch(paymentFunction,/calculateEmployeePeriod/);
  assert.match(exportsRoute,/eq\(payRuns\.status,"finalised"\)/);
  assert.match(exportsRoute,/eq\(employees\.employerId,employerId\)/);
  assert.match(exportsRoute,/row\.netPay>0/);
  assert.match(exportsRoute,/access\.membership\.canViewConfidential\|\|!row\.confidential/);
  assert.match(exportsRoute,/Confidential employee permission is required to generate the complete bank payment file/);
  assert.match(exportsRoute,/type:"BANK-PAYMENT"/);
  assert.match(exportsRoute,/payloadChecksum=await sha256\(content\)/);
  assert.match(exportsRoute,/accountEnding:account\.slice\(-4\)/);
  assert.match(exportsRoute,/rawBankDetailsRetained:false/);
  assert.match(exportsRoute,/"x-payflow-submission-id":String\(batch\.id\)/);
  assert.match(exportsRoute,/"x-payflow-checksum":payloadChecksum/);
  assert.match(exportsRoute,/snapshot\.payrollId\|\|row\.payrollId/);
  assert.match(exportsRoute,/accountName:employees\.accountName/);
  assert.match(exportsRoute,/No partial bank file was generated/);
  assert.match(exportsRoute,/String\(row\.accountName\)\.trim\(\)/);
  assert.match(exportsRoute,/row\.netPay\.toFixed\(2\)/);
  assert.match(exportsRoute,/\^\[=\+\\-@\]/);
  assert.match(exportsRoute,/redownloaded:bank-payment-file/);
  assert.match(exportsRoute,/x-payflow-duplicate/);
  assert.match(exportsRoute,/cache-control":"private, no-store"/);
  assert.doesNotMatch(exportsRoute,/payload:JSON\.stringify\([^\\n]*accountNumber/);
  assert.match(paymentFunction,/response\.headers\.get\("x-payflow-submission-id"\)/);
  assert.match(paymentFunction,/checksum\.slice\(0,12\)/);
  assert.match(exportsRoute,/Use the reconciled Reports or Pensions workspace/);
  assert.doesNotMatch(exportsRoute,/input\.records/);
  assert.match(page,/Bank payment file/);
  assert.match(page,/PayFlow has not transmitted payment/);
});

test("target net pay is implemented through the shared payroll engine and pay-item workflow",async()=>{
  const [engine,route,page]=await Promise.all([
    readFile("lib/payroll-engine.ts","utf8"),readFile("app/api/calculate/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(engine,/export function solveGrossForTargetNet/);
  assert.match(route,/input\.kind==="target-net"/);
  assert.match(page,/Target net pay[\s\S]*Calculate gross adjustment/);
  assert.match(page,/Target net pay adjustment/);
  assert.match(page,/automaticEnrolmentScheme=\{activePensionScheme\}/);
  assert.match(page,/const assessment=assessPensionAtDate\(\{dateOfBirth:candidate\.dateOfBirth,assessmentDate:payrollCalculationDate,earnings:preAssessment\.gross,payFrequency/);
  assert.match(page,/assessedCandidate=\{\.\.\.candidate,pensionStatus:assessment\.action==="enrol"\?"active":"not-enrolled"/);
});

test("later-period previews use the same cumulative and director inputs as finalisation",async()=>{
  const [page,payRuns]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
  ]);
  assert.match(page,/const calculationHistory=useMemo<CalculationHistory>/);
  assert.match(page,/p45OpeningBalances\(/);
  for(const field of ["ytdTaxablePay","ytdTaxPaid","ytdNicablePay","ytdEmployeeNic","ytdEmployerNic"])
    assert.match(page,new RegExp(`${field}:total\\.${field}`));
  assert.match(page,/const calculatedPayrollBase=useMemo\(\(\)=>calculationEmployee\?calculateEmployeePeriod\(calculationEmployee,period,taxYear,calculationHistory/);
  assert.match(page,/allocateEmployeeLoanRecoveries\(activeEmployeeLoans,calculatedPayrollAfterAttachments\.net\)/);
  assert.match(page,/director:employee\.director/);
  assert.match(page,/directorMethod:employee\.alternativeDirectorNic\?"alternative":"annual"/);
  assert.match(page,/directorEarningsPeriodWeeks/);
  assert.match(page,/finalDirectorPeriod/);
  assert.match(page,/history=\{calculationHistory\}/);
  assert.match(page,/netFor=\(adjustment:number\)=>netWithLoans/);
  for(const field of ["ytdTaxablePay","ytdTaxPaid","ytdNicablePay","ytdEmployeeNic","ytdEmployerNic"])
    assert.match(payRuns,new RegExp(`${field}:`));
});

test("cash and cheque employees have finalised reconciled payment schedules",async()=>{
  const [reports,payRuns,page,cash]=await Promise.all([
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("app/page.tsx","utf8"),readFile("lib/cash-makeup.ts","utf8"),
  ]);
  assert.match(payRuns,/paymentMethod:employee\.paymentMethod/);
  assert.match(reports,/snapshot\.paymentMethod\|\|employee\.paymentMethod/);
  assert.match(reports,/type==="payments"/);
  assert.match(reports,/type==="cheque-payments"/);
  assert.match(reports,/title:"Cash makeup schedule"/);
  assert.match(reports,/title:"Bank cash request"/);
  assert.match(reports,/TOTAL CASH REQUESTED/);
  assert.match(reports,/title:"Cash wage receipt sheet"/);
  assert.match(reports,/Wage amounts are intentionally omitted for confidentiality/);
  assert.match(reports,/String\(item\.snapshot\.niNumber\|\|item\.employee\.niNumber\|\|"Not supplied"\)/);
  assert.match(reports,/run\.netPay>0/);
  assert.match(cash,/Math\.round\(amount\*100\)/);
  assert.match(page,/"Payment summary":"payments"/);
  assert.match(page,/"Cash makeup schedule":"cash-payments"/);
  assert.match(page,/"Bank cash request":"cash-request"/);
  assert.match(page,/"Cash wage receipt sheet":"cash-receipt"/);
  assert.match(page,/"Cheque payment schedule":"cheque-payments"/);
});

test("nominal-ledger export freezes department allocation and balances configured accounting codes",async()=>{
  const [schema,migration,employer,payRuns,reports,data,page,evidence]=await Promise.all([
    readFile("db/schema.ts","utf8"),readFile("drizzle/0067_accounting_nominal_codes.sql","utf8"),
    readFile("app/api/employer/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
    readFile("app/page.tsx","utf8"),readFile("lib/employer-cis-state-evidence.ts","utf8"),
  ]);
  for(const field of [
    "accountingDefaultWagesCode","accountingControlCode","accountingPayeCode","accountingNicCode",
    "accountingPensionCode","accountingOtherDeductionsCode","accountingEmployerNicExpenseCode","accountingEmployerPensionExpenseCode",
  ]){
    assert.match(schema,new RegExp(field));
    assert.match(employer,new RegExp(field));
    assert.match(evidence,new RegExp(field));
  }
  assert.match(migration,/accounting_default_wages_code/);
  assert.match(payRuns,/departmentName:departmentById\.get\(employee\.departmentId\|\|0\)\?\.name\|\|"Unassigned"/);
  assert.match(payRuns,/departmentCostCentre:departmentById\.get\(employee\.departmentId\|\|0\)\?\.costCentre\|\|"000"/);
  assert.match(payRuns,/departmentNominalCode:departmentById\.get\(employee\.departmentId\|\|0\)\?\.nominalCode\|\|null/);
  assert.match(reports,/type==="accounting-file"/);
  assert.match(reports,/title:"Nominal-ledger accounting import"/);
  assert.match(reports,/Gross wages - \$\{entry\.department\}/);
  assert.match(reports,/if\(periodBalance!==0\)throw new Error/);
  assert.match(reports,/Department allocation used current employee settings because this older payroll predates frozen accounting evidence/);
  assert.match(page,/"Nominal-ledger accounting import":"accounting-file"/);
  assert.match(page,/\["Business","Payroll defaults","Reports and printing","Payslip editor","Email templates","Accounting"/);
  assert.match(page,/Finalised payroll freezes that allocation/);
  assert.match(data,/employerSettings/);
});

test("employee loans, advances and overpayments use reversible balance ledgers",async()=>{
  const [schema,migration,api,payRuns,reports,data,page]=await Promise.all([
    readFile("db/schema.ts","utf8"),readFile("drizzle/0054_employee_loan_ledgers.sql","utf8"),
    readFile("app/api/employee-loans/route.ts","utf8"),readFile("app/api/pay-runs/route.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/data/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  for(const field of ["originalAmount","regularDeduction","balanceBefore","balanceAfter"])assert.match(schema,new RegExp(field));
  assert.match(migration,/employee_loan_deductions_loan_run_unique/);
  assert.match(api,/\["loan","advance","overpayment"\]/);
  assert.match(api,/eq\(employeeLoans\.employerId,employerId\)/);
  assert.match(payRuns,/allocateEmployeeLoanRecoveries\(activeLoans,resultBeforeLoans\.netPay\)/);
  assert.match(payRuns,/employeeLoanDeductions\)\.values/);
  assert.match(payRuns,/balance:deduction\.balanceBefore,status:"active"/);
  assert.match(payRuns,/db\.delete\(employeeLoanDeductions\)/);
  assert.match(reports,/title:"Employee loan, advance and overpayment ledger"/);
  for(const table of ["employeeLoans","employeeLoanDeductions"])assert.match(data,new RegExp(table));
  assert.match(page,/Manage loan, advance or overpayment/);
  assert.match(page,/Create recovery ledger/);
});

test("mileage allowance applies 2026/27 PAYE and NIC thresholds with YTD mileage",async()=>{
  const [calculator,page]=await Promise.all([
    readFile("lib/mileage-allowance.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(calculator,/10_000-ytdMiles/);
  assert.match(calculator,/nicApproved=round\(miles\*standard\)/);
  assert.match(calculator,/taxOnlyExcess/);
  assert.match(calculator,/taxAndNicExcess/);
  assert.match(page,/Add business mileage allowance/);
  assert.match(page,/Mileage allowance · \$\{vehicle\} · approved/);
  assert.match(page,/item\.quantity\?\?1/);
  assert.match(page,/Prior business miles this tax year/);
});

test("legacy childcare vouchers enforce eligibility and Class 1-only excess",async()=>{
  const [calculator,page,payRuns,reports,evidence,recurring]=await Promise.all([
    readFile("lib/childcare-vouchers.ts","utf8"),readFile("app/page.tsx","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("lib/pay-run-evidence.ts","utf8"),readFile("app/api/recurring-items/route.ts","utf8"),
  ]);
  for(const limit of ["55","28","25","243","124","110"])assert.match(calculator,new RegExp(limit));
  assert.match(calculator,/payFrequency==="fortnightly"\?2:payFrequency==="four-weekly"\?4/);
  assert.match(calculator,/childcareVoucherBandFromName/);
  assert.match(calculator,/closed to new applicants/);
  assert.match(page,/pre-4 October 2018 scheme/);
  assert.match(page,/childcareVoucherLimit\(band,payFrequency\)/);
  assert.match(page,/childcareVoucherName\(taxBand\)/);
  assert.match(page,/type:"childcare-voucher"/);
  assert.match(page,/taxable:false,nicable:true/);
  assert.match(payRuns,/childcareVoucherSacrifice/);
  assert.match(payRuns,/expectedChildcareClass1Excess/);
  assert.match(payRuns,/childcare-voucher Class 1 excess must be/);
  assert.match(payRuns,/suppliedClass1Benefits/);
  assert.match(reports,/Legacy childcare voucher excess above the applicable pay-period exemption/);
  assert.match(evidence,/childcare-voucher/);
  assert.match(recurring,/childcare-voucher/);
});

test("cash pay rounding uses a reversible finalised ledger and preserves statutory pay evidence",async()=>{
  const [schema,migration,helper,api,payRuns,reports,data,page]=await Promise.all([
    readFile("db/schema.ts","utf8"),readFile("drizzle/0055_cash_pay_rounding.sql","utf8"),
    readFile("lib/pay-rounding.ts","utf8"),readFile("app/api/pay-rounding/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/data/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  for(const field of ["employeePayRounding","payRoundingEntries","openingCarry","closingCarry","adjustment"])assert.match(schema,new RegExp(field));
  assert.match(migration,/pay_rounding_entries_setting_run_unique/);
  assert.match(helper,/Math\.floor/);
  assert.match(helper,/roundedNet-netPay/);
  assert.match(api,/employee\.paymentMethod!==\"cash\"/);
  assert.match(api,/existing\.carry>\.005/);
  assert.match(payRuns,/applyCashPayRounding/);
  assert.match(payRuns,/db\.insert\(payRoundingEntries\)/);
  assert.match(payRuns,/carry:roundingEntry\.openingCarry/);
  assert.match(payRuns,/cashRounding:roundingCalculation/);
  assert.match(reports,/title:"Cash pay rounding and carried balances"/);
  assert.match(reports,/does not change gross pay and statutory PAYE/);
  for(const table of ["employeePayRounding","payRoundingEntries"])assert.match(data,new RegExp(table));
  assert.match(data,/schemaVersion:7/);
  assert.match(page,/Manage cash pay rounding/);
  assert.match(page,/CashPayRoundingModal/);
  assert.match(page,/"Cash rounding and carried balances":"cash-rounding"/);
  assert.match(page,/const evidence=JSON\.parse\(persistedRun\.rtiSnapshot\|\|"{}"\)/);
  assert.match(page,/frozenCashRounding=evidence\.cashRounding\|\|null/);
  assert.match(page,/persistedRun&&!runDirty\?frozenCashRounding:cashRoundingPreview/);
});

test("structured employee names are not duplicated during onboarding or payroll",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/hasStructuredName=Boolean\(employee\.firstName\?\.trim\(\)\|\|employee\.lastName\?\.trim\(\)\)/);
  assert.match(page,/!hasStructuredName\?parts\.slice\(1,-1\)\.join\(" "\)/);
  assert.match(page,/firstName: e\.firstName\?\.trim\(\)\|\|e\.name/);
  assert.match(page,/lastName: e\.lastName\?\.trim\(\)\|\|e\.name/);
  assert.doesNotMatch(page,/onInput=\{e=>update\(e\.currentTarget\)\}/);
});

test("prepared bank payment files are superseded when their employee payment source changes",async()=>{
  const [helper,employeesRoute,requestsRoute,page]=await Promise.all([
    readFile("lib/payment-batches.ts","utf8"),readFile("app/api/employees/route.ts","utf8"),
    readFile("app/api/employee-requests/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(helper,/schemaVersion==="payflow-bank-payment-1"/);
  assert.match(helper,/parsed\.recipients\.some/);
  assert.match(helper,/eq\(submissions\.type,"BANK-PAYMENT"\)/);
  assert.match(helper,/eq\(submissions\.status,"generated"\)/);
  assert.match(helper,/status:"superseded"/);
  assert.match(helper,/Generate a new bank payment file before authorisation/);
  assert.match(employeesRoute,/\["payrollId","paymentMethod","accountName","sortCode","accountNumber"\]/);
  assert.match(employeesRoute,/supersedeEmployeePaymentBatches\(db,employerId,updated\.id/);
  assert.match(employeesRoute,/superseded:bank-payment-files/);
  assert.match(requestsRoute,/\["accountName","sortCode","accountNumber"\]/);
  assert.match(requestsRoute,/approved portal bank-detail request/);
  assert.match(requestsRoute,/supersededPaymentBatches:supersededPaymentBatches\.length/);
  assert.match(page,/prepared bank payment batch/);
  assert.match(page,/generate a replacement file/);
});

test("recurring pay-item schedules persist and flow into applicable pay runs",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0014_recurring_pay_items.sql","utf8");
  const taxYearMigration=await readFile("drizzle/0034_recurring_pay_item_tax_year.sql","utf8");
  const route=await readFile("app/api/recurring-items/route.ts","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/export const recurringPayItems/);
  assert.match(schema,/recurringItemId/);
  assert.match(migration,/recurring_pay_items_employer_employee_idx/);
  assert.match(migration,/ALTER TABLE `pay_items` ADD `recurring_item_id`/);
  assert.match(taxYearMigration,/ADD `tax_year` text/);
  assert.match(schema,/taxYear: text\("tax_year"\)/);
  assert.match(route,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(route,/endPeriod<startPeriod/);
  assert.match(route,/input\.action!=="stop"/);
  assert.match(route,/item\.runStatus==="draft"&&item\.periodNumber>endPeriod/);
  assert.match(route,/removedDraftOccurrences/);
  assert.match(route,/invalidatedDraftRuns/);
  assert.match(route,/db\.delete\(payRuns\)/);
  assert.match(route,/firstOpen\?\.periodNumber\|\|1/);
  assert.match(route,/An identical active pay schedule already exists/);
  assert.match(route,/cannot start before open Period/);
  assert.match(route,/entityType:"recurring-pay-item"/);
  assert.match(route,/Taxable, NIC-able and pensionable classifications must each be explicitly true or false/);
  assert.match(route,/typeof input\[field\]!=="boolean"/);
  assert.doesNotMatch(route,/taxable:Boolean\(input\.taxable\)/);
  assert.match(payRuns,/scheduledForPeriod/);
  assert.match(payRuns,/eq\(recurringPayItems\.taxYear,taxYear\)/);
  assert.match(page,/fetch\(`\/api\/recurring-items\?employerId=\$\{employerId\}&taxYear=/);
  assert.match(page,/const scheduledPayItems:PayLine\[\]=/);
  assert.match(page,/const effectivePayItems=/);
  assert.match(page,/payItems:effectivePayItems/);
  assert.doesNotMatch(page,/recurringPayItemRecords\.filter\(item=>item\.employeeId===employee\.id&&item\.status==="active"/);
  assert.match(payRuns,/recurringItemId:line\.recurringItemId/);
  assert.match(page,/This and future periods/);
  assert.match(page,/\[name,setName\]=useState\(""\),\[amount,setAmount\]=useState\(0\)/);
  assert.match(page,/\[endPeriod,setEndPeriod\]=useState\(period\)/);
  assert.match(page,/function ScheduleModal/);
  assert.match(page,/finalised history remains unchanged/);
  assert.match(page,/item\.recurringItemId\?"Manage":"Remove"/);
  assert.match(page,/Included in PAYE taxable pay/);
  assert.match(page,/Included in National Insurance pay/);
  assert.match(page,/Included in pensionable pay/);
  assert.match(page,/item\.type\.replaceAll\("-"," "\)/);
  assert.equal((page.match(/effectivePayItems\.map/g)||[]).length,1);
});

test("manual PAYE, NIC and loan corrections are audited and applied before attachments",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0015_payroll_adjustments.sql","utf8");
  const route=await readFile("app/api/adjustments/route.ts","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const helper=await readFile("lib/payroll-adjustments.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/export const payrollAdjustments/);
  assert.match(migration,/payroll_adjustments_employer_period_employee_idx/);
  assert.match(route,/non-zero signed amount/);
  assert.match(route,/created:finalised-rti-correction/);
  assert.match(route,/reversed:finalised-rti-correction/);
  assert.match(route,/Enter an audit reason between 5 and 500 characters/);
  assert.match(route,/An identical active correction already exists for this employee and period/);
  assert.match(route,/acceptedRtiExists/);
  assert.match(route,/latestFinalisedPeriod/);
  assert.match(route,/Direct finalised corrections are reserved for periods with an HMRC-accepted FPS baseline/);
  assert.match(route,/editing period \$\{periodNumber\} would leave later year-to-date payroll and RTI evidence inconsistent/);
  assert.match(route,/changing period \$\{existing\.periodNumber\} would leave later year-to-date payroll and RTI evidence inconsistent/);
  assert.match(route,/applyToFinalisedRun/);
  for(const type of ["gross-pay","taxable-pay","nicable-pay","statutory-pay","net-pay"])assert.match(route,new RegExp(type));
  assert.match(route,/additionalFpsRequired:finalisedCorrection/);
  assert.match(route,/statutory-recovery/);
  assert.match(route,/epsRequired:finalisedCorrection&&type==="statutory-recovery"/);
  assert.match(route,/if\(type==="statutory-recovery"\)return \{before:run,after:run\}/);
  assert.match(route,/Correct open-period earnings through payroll items instead/);
  assert.match(payRuns,/applyDeductionAdjustments\(initialResult,adjustmentTotals\)/);
  assert.match(payRuns,/const attachmentNetPay=Math\.max\(0,adjustedResult\.netPay-nonAttachableStatutoryPay\)/);
  assert.match(helper,/result\.netPay-\(payeTax-result\.incomeTax\)/);
  assert.match(page,/Use signed amounts/);
  assert.match(page,/Accepted-period pay corrections use Additional FPS/);
  assert.match(page,/must target the latest finalised period so later year-to-date evidence cannot become stale/);
  assert.match(page,/Finalised values corrected\. Prepare and validate an Additional FPS/);
  assert.match(page,/HMRC statutory-pay recovery/);
  assert.match(page,/Prepare and validate an EPS for the affected tax month/);
  assert.match(page,/Gross cash pay/);
  assert.match(page,/Statutory pay/);
  assert.match(page,/dirtyRuns\.has\(`\$\{period\}:\$\{employee\.id\}`\)/);
  assert.match(page,/persistedRun&&!runDirty/);
});

test("attachment orders apply statutory bands, legal priority, arrears and reversible history",async()=>{
  const [engine,schema,route,payRuns,page,migration,reports]=await Promise.all([
    readFile("lib/attachment-engine.ts","utf8"),readFile("db/schema.ts","utf8"),readFile("app/api/attachments/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("drizzle/0024_attachment_order_rules.sql","utf8"),
    readFile("app/api/reports/route.ts","utf8"),
  ]);
  assert.match(engine,/deaBands/);
  assert.match(engine,/councilTaxBands/);
  assert.match(engine,/arrearsAfter/);
  assert.match(engine,/attachmentPriority/);
  for(const column of ["calculationRule","payFrequency","priority","arrears","effectiveDate","attachableNetPay","protectedEarningsApplied","arrearsBefore","arrearsAfter"])assert.match(schema,new RegExp(column));
  assert.match(route,/created:attachment-order/);
  assert.match(route,/suspend","resume","stop/);
  assert.match(route,/Attachment amounts must be valid non-negative numbers/);
  assert.match(route,/An active attachment order with this legal reference already exists/);
  assert.match(route,/A completed attachment order cannot be changed/);
  assert.match(route,/Only a suspended attachment order can be resumed/);
  assert.match(payRuns,/nonAttachableStatutoryPay/);
  assert.match(payRuns,/\.sort\(\(left,right\)=>attachmentPriority/);
  assert.match(payRuns,/arrears:deduction\.arrearsBefore/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/attachments\?employerId=\$\{employerId\}`/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/adjustments\?employerId=\$\{employerId\}&taxYear=/);
  assert.match(page,/const calculatedPayrollAdjusted=/);
  assert.match(page,/const attachmentNetPay=Math\.max\(0,calculatedPayrollAdjusted\.net-nonAttachableStatutoryPay\)/);
  assert.match(page,/existingDeductions:priorAttachmentDeductions/);
  assert.match(page,/const calculatedPayrollAfterAttachments=/);
  assert.match(page,/allocateEmployeeLoanRecoveries\(activeEmployeeLoans,calculatedPayrollAfterAttachments\.net\)/);
  assert.match(page,/applyCashPayRounding\(\{netPay:calculatedPayrollUnrounded\.net/);
  assert.match(page,/displayedAttachmentCalculations/);
  assert.match(page,/recovered after attachment orders/);
  assert.match(page,/DWP DEA · standard bands/);
  assert.match(page,/Council Tax AEO · England and Wales/);
  assert.match(migration,/arrears_before/);
  assert.match(page,/reference\.trim\(\)\.length<3/);
  assert.match(page,/priority<1\|\|priority>100/);
  assert.match(reports,/Attachment order summary/);
});

test("annual leave uses the employee working pattern for entitlement",async()=>{
  const route=await readFile("app/api/leave/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  assert.match(route,/workingDaysPerWeek:employees\.workingDaysPerWeek/);
  assert.match(route,/workPatternTypes=new Set\(\["Annual leave","Unpaid leave","Absent","On strike","Parental leave \(unpaid\)"\]\)/);
  assert.match(route,/workPatternLeave\?derivedQualifyingDays:calendarDays/);
  assert.match(route,/qualifyingDays: storedPayableDays/);
  assert.match(route,/leaveYearsAcrossRange\(String\(input\.startDate\),String\(input\.endDate\)\)/);
  assert.match(route,/projectedRemaining<0/);
  assert.match(route,/exceeds the \$\{exceeded\.leaveYear\} entitlement/);
  assert.match(route,/annualLeaveBalances/);
  assert.match(page,/Scheduled leave days/);
  assert.match(page,/Scheduled working pattern/);
  assert.match(page,/leaveEntitlementBalance\(employee\.annualLeaveDays\?\?28,employee\.startDate,employee\.leavingDate,events,taxYear\)/);
  assert.match(page,/Prorated entitlement/);
  assert.match(reports,/"Contractual annual days","Prorated entitlement","Recorded leave days","Remaining days"/);
  assert.match(reports,/leaveEntitlementBalance\(e\.annualLeaveDays,e\.startDate,e\.leavingDate/);
});

test("statutory pay is date-derived with 2026/27 SSP qualifying-day rules",async()=>{
  const engine=await readFile("lib/payroll-engine.ts","utf8");
  const periods=await readFile("lib/pay-periods.ts","utf8");
  const leave=await readFile("app/api/leave/route.ts","utf8");
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0016_leave_qualifying_days.sql","utf8");
  const workPatternMigration=await readFile("drizzle/0023_leave_work_patterns.sql","utf8");
  const aweMigration=await readFile("drizzle/0026_statutory_awe_provenance.sql","utf8");
  const aweEngine=await readFile("lib/statutory-awe.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(engine,/payableDays\s*\*\s*Math\.min\(123\.25,\s*averageWeeklyEarnings\s*\*\s*\.8\)\s*\/\s*qualifyingDaysPerWeek/);
  assert.match(engine,/smallEmployer \? 1\.09 : \.92/);
  assert.match(periods,/qualifyingWeekdays\.has\(weekday\)/);
  assert.match(leave,/calendarDays=Math\.floor\(\(end-start\)\/dayMs\)\+1/);
  assert.match(leave,/employer\.smallEmployersRelief/);
  assert.match(leave,/!draft&&\(!result\.eligible/);
  assert.match(leave,/eq\(payPeriods\.status,"finalised"\)/);
  assert.match(leave,/This leave overlaps a finalised payroll period/);
  assert.match(leave,/SSP dates must fall entirely within the employee/);
  assert.match(leave,/Annual and unpaid leave dates must fall entirely within the employee/);
  assert.match(leave,/Average weekly earnings must be a valid non-negative amount/);
  assert.match(leave,/Qualifying days must be a whole number between 0 and/);
  assert.match(leave,/Average weekly earnings source must be manual or finalised payroll/);
  assert.match(leave,/authoritativeAwe\?\.paymentCount===0/);
  assert.match(leave,/No finalised payment exists before the statutory relevant date/);
  assert.match(leave,/Leave notes cannot exceed 1,000 characters/);
  assert.match(leave,/access\.membership\.canViewConfidential\?rows:rows\.filter/);
  assert.match(leave,/A calculated statutory payment already overlaps this date range/);
  assert.match(leave,/event\.status==="calculated"&&Number\(event\.statutoryAmount\)>0/);
  assert.match(leave,/validIsoDate/);
  assert.match(leave,/qualifyingWeekdays\.join\(","\)/);
  assert.doesNotMatch(leave,/Boolean\(input\.smallEmployer\)/);
  assert.match(schema,/qualifyingDaysPerWeek/);
  assert.match(schema,/qualifyingWeekdays/);
  assert.match(migration,/qualifying_days_per_week/);
  assert.match(workPatternMigration,/qualifying_weekdays/);
  assert.match(aweMigration,/average_weekly_earnings_source/);
  assert.match(aweEngine,/monthly-payments-x12-div52/);
  assert.match(page,/useState\("Annual leave"\)/);
  assert.match(page,/disabled=\{saving\|\|calendarDays<=0\}/);
  assert.match(page,/statutoryType==="none"\?"Save leave event"/);
  assert.match(leave,/get\("action"\)==="calculate-awe"/);
  assert.match(leave,/action!=="cancel"/);
  assert.match(leave,/This leave affected a finalised payroll period/);
  assert.match(page,/Qualifying sickness days/);
  assert.match(page,/SSP qualifying work pattern/);
  for(const leaveType of ["Working day","Non-work day","Absent","On strike","Parental leave \\(unpaid\\)","Shared parental leave \\(adoption\\)"])assert.match(page,new RegExp(leaveType));
  assert.match(page,/notes:leaveNotes/);
  assert.match(page,/value=\{leaveNotes\} onChange=\{event=>setLeaveNotes/);
  assert.match(page,/Calculate from finalised pay/);
  assert.match(page,/Employee leave register/);
  assert.match(page,/payrollId:employee\.payrollId/);
  assert.match(page,/if\(!keepOpen\)setModal\(null\)/);
  assert.match(page,/derived from the recorded date range/);
  assert.match(page,/function LeaveRangeCalendar/);
  assert.match(page,/aria-label=\{selectionMode==="start"\?"Statutory pay start-date calendar":"Leave date range calendar"\}/);
  assert.match(page,/aria-pressed=\{inRange\}/);
  assert.match(page,/className="leave-calendar-layout"/);
  assert.match(page,/Estimated statutory pay/);
  assert.match(page,/fetchWorkspaceResource\(`\/api\/pay-runs\?employerId=\$\{employerId\}&taxYear=\$\{encodeURIComponent\(taxYear\)\}`\)/);
  assert.doesNotMatch(page,/setWeeks/);
});

test("employment dates and employee RTI declarations control payroll and FPS inclusion",async()=>{
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  const employees=await readFile("app/api/employees/route.ts","utf8");
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0017_employee_rti_declarations.sql","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(payRuns,/employeeActiveInRange\(employee\.startDate,employee\.leavingDate,scheduledPeriod\.periodStart,scheduledPeriod\.periodEnd\)/);
  assert.match(submissions,/row\.grossPay===0&&row\.zeroPayFpsExclusion/);
  for(const field of ["reportedPayFrequency","workplacePostcode","previousPayrollId","paymentToBody","trivialCommutation","flexibleDrawdown"]){
    assert.match(schema,new RegExp(field));
    assert.match(employees,new RegExp(field));
    assert.match(submissions,new RegExp(field));
    assert.match(page,new RegExp(field));
  }
  assert.match(migration,/reported_pay_frequency/);
  assert.match(page,/No employees are active within this payroll period/);
});

test("payments after leaving require an explicit guarded payroll and FPS indicator",async()=>{
  const [payRuns,submissions,page,reports]=await Promise.all([
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("app/api/reports/route.ts","utf8"),
  ]);
  assert.match(payRuns,/validPostLeavingPayment=postLeavingPayment&&Boolean\(employee\.leavingDate\)/);
  assert.match(payRuns,/payment after leaving can only be used in a payroll period that starts after the recorded leaving date/);
  assert.match(payRuns,/enter a positive taxable payment after leaving/);
  assert.match(payRuns,/\^S\/i\.test\(employee\.taxCode\)\?"S0T":\/\^C\/i\.test\(employee\.taxCode\)\?"C0T":"0T"/);
  assert.match(payRuns,/confirm that the employee's P45 was issued/);
  assert.match(payRuns,/week1Month1: postLeavingPayment\?true/);
  assert.match(payRuns,/paymentAfterLeaving:postLeavingPayment/);
  assert.match(payRuns,/earningsPeriod:postLeavingPayment&&postLeavingNicBasis==="weekly"\?"weekly":frequency==="monthly"\?"monthly":"weekly"/);
  assert.match(payRuns,/postLeavingNicBasis:postLeavingPayment\?postLeavingNicBasis:null/);
  assert.match(payRuns,/earningsPeriod:payrollInput\.earningsPeriod/);
  assert.match(payRuns,/postLeavingPayments:records\.filter/);
  assert.match(submissions,/paymentAfterLeaving\?:boolean/);
  assert.match(page,/Make an exceptional payment after leaving/);
  assert.match(page,/postLeavingPayment:Boolean/);
  assert.match(page,/rtiEvidence\.paymentAfterLeaving===true/);
  assert.match(page,/postLeavingTaxCode/);
  assert.match(page,/Weekly — irregular holiday pay, bonus or arrears/);
  assert.match(page,/another P45 must not be produced/);
  assert.match(reports,/nicEarningsBands\(r\.nicablePay,snapshotFrequency==="monthly"\?"monthly":"weekly",periodWeeks\)/);
  assert.match(submissions,/nicEarningsBands\(run\.nicablePay,snapshot\.earningsPeriod==="weekly"\?"weekly":"monthly",periodWeeks\)/);
});

test("payment-after-leaving validation runs before period or employee payroll writes",async()=>{
  const route=await readFile("app/api/pay-runs/route.ts","utf8");
  const validation=route.indexOf("confirm that the employee's P45 was issued before setting the payment-after-leaving FPS indicator");
  const periodLookup=route.indexOf("let [period] = await db.select().from(payPeriods)");
  const runDelete=route.indexOf("await db.delete(payRuns)");
  assert.ok(validation>0&&periodLookup>validation,"post-leaving validation must precede period creation");
  assert.ok(runDelete>validation,"post-leaving validation must precede pay-run replacement");
  assert.equal(route.match(/confirm that the employee's P45 was issued before setting the payment-after-leaving FPS indicator/g)?.length,1);
});

test("payments after leaving do not rewrite P45 evidence and receive written confirmation",async()=>{
  const [reports,documents,payslipDesign]=await Promise.all([readFile("app/api/reports/route.ts","utf8"),readFile("app/api/portal/documents/route.ts","utf8"),readFile("lib/payslip-design.ts","utf8")]);
  assert.match(reports,/rtiSnapshot\(run\)\.paymentAfterLeaving!==true/);
  assert.match(reports,/Payments made after the P45 was issued are deliberately excluded/);
  assert.match(reports,/Yes — written confirmation; do not issue another P45/);
  assert.match(documents,/p45Runs=sortedRuns\.filter\(run=>snapshot\(run\)\.paymentAfterLeaving!==true\)/);
  assert.match(payslipDesign,/This is written confirmation of a post-leaving payment/);
  assert.match(payslipDesign,/Your original P45 remains unchanged/);
  assert.match(documents,/const totals=p45Runs\.reduce/);
});

test("CIS corrections are tenant-bound, audited and supersede prepared returns",async()=>{
  const cis=await readFile("app/api/cis/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(cis,/action!==\"void-payment\"/);
  assert.match(cis,/eq\(subcontractors\.employerId,employerId\)/);
  assert.match(cis,/entityType:\"cis-payment\"/);
  assert.match(cis,/status:\"superseded\"/);
  assert.match(cis,/p\.status!==\"voided\"/);
  assert.match(cis,/valid 10-digit UTR/);
  assert.match(page,/Void & replace/);
});

test("CIS300 declarations, nil returns, amendments and statements are auditable",async()=>{
  const [cis,page,schema,migration,employer]=await Promise.all([
    readFile("app/api/cis/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0028_cis_compliance_audit.sql","utf8"),readFile("app/api/employer/route.ts","utf8"),
  ]);
  for(const requirement of ["allSubcontractorsNotEmployees","allRequiredVerified","nilReturn","inactivityRequest","amendsSubmissionId","amendsPayloadChecksum","replacesSubmissionId","replacesPayloadChecksum","acceptedPrior","replacementPrior","issue-statement","issued:cis-payment-statement","cisDeadline","payloadChecksum","submittedAt:null"])assert.match(cis,new RegExp(requirement));
  assert.match(cis,/const reusablePrior=priorRows\.find\(item=>item\.status==="test-ready"\)/);
  assert.match(cis,/sameDeclarations&&sameAcceptedBaseline/);
  assert.match(cis,/reused:true/);
  assert.match(page,/Document and lineage/);
  assert.match(page,/Replaces package #/);
  assert.match(page,/Amends accepted return #/);
  assert.match(cis,/Enable CIS contractor status/);
  assert.match(cis,/valid 10-digit contractor UTR/);
  assert.match(cis,/sole trader/);
  assert.match(cis,/company registration number/);
  assert.match(cis,/nominated partner's 10-digit UTR/i);
  assert.match(cis,/Every paid sole trader must retain a valid National Insurance number/);
  assert.match(cis,/Every paid company must retain a valid company registration number/);
  assert.match(cis,/Every paid partnership must retain its nominated partner UTR/);
  assert.match(page,/Every listed subcontractor is not an employee/);
  assert.match(page,/Request CIS inactivity/);
  assert.match(page,/Issue payment and deduction statements/);
  assert.match(page,/Contractor registration/);
  assert.match(page,/Save contractor registration/);
  assert.match(cis,/validation:\{valid:errors\.length===0,errors\}/);
  assert.match(page,/Promise\.all\(\[loadCis\(\),loadReturn\(\)\]\)/);
  assert.match(page,/setCisResultId\(Number\(body\.submission\?\.id\)\|\|0\);await loadCis\(\)/);
  assert.match(page,/The unchanged CIS300 package was reused and selected; no duplicate filing package was created/);
  assert.match(page,/!employmentStatus\|\|!notEmployees\|\|!allVerified\|\|!declaration/);
  assert.match(page,/\[labour, setLabour\] = useState\(0\)/);
  assert.match(page,/if\(savingPayment\)return/);
  assert.match(page,/setInvoiceNumber\(""\)/);
  assert.match(page,/disabled=\{savingPayment\|\|!selectedSub\|\|!selectedVerification\?\.valid\|\|invoiceNumber\.trim\(\)\.length<3/);
  assert.match(schema,/cisUtr/);
  assert.match(schema,/verificationResponse/);
  assert.match(schema,/materialsEvidence/);
  assert.match(migration,/cis_utr/);
  assert.match(employer,/CIS contractor UTR must contain 10 digits/);
});

test("RTI EPS declarations reconcile to payroll and statutory records",async()=>{
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  const liabilities=await readFile("app/api/hmrc-liabilities/route.ts","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(submissions,/authoritativeRecovery/);
  assert.match(submissions,/A no-payment EPS cannot be used/);
  assert.match(submissions,/const paymentRuns=epsRuns\.filter\(hasEmployeePaymentActivity\)/);
  assert.match(submissions,/if\(!noPaymentForPeriod&&unfinalisedPeriods\.length\)/);
  assert.match(submissions,/reportingWindow:epsTaxMonthWindow\(taxYear,periodNumber\)/);
  assert.match(submissions,/payPeriodId:type==="EPS"&&\(payload as any\)\.noPaymentForPeriod\?null/);
  assert.match(submissions,/Every payroll period whose pay date falls in this tax month must be finalised before an EPS can be generated/);
  assert.match(submissions,/month<=periodNumber/);
  assert.match(submissions,/if\(!finalisedTaxMonths\.has\(month\)\)continue/);
  assert.match(submissions,/statutoryPayRecoveredByType:recoveryByType/);
  assert.match(submissions,/\.cumulativeDue\|\|0/);
  assert.doesNotMatch(submissions,/\[periodNumber-1\]\?\.currentDue/);
  assert.match(page,/CIS deductions suffered year to date/);
  assert.match(submissions,/Employment Allowance is not enabled/);
  assert.match(submissions,/status:\"superseded\"/);
  assert.match(submissions,/finalSubmission&&periodNumber!==12/);
  assert.match(submissions,/finalSubmission&&ceasedIndicator/);
  assert.match(submissions,/Record a leaving date on or before the cessation date for every employee/);
  assert.match(submissions,/allowedLateReasons/);
  assert.match(submissions,/const validDate=/);
  assert.match(submissions,/FPS payroll period must be a whole number between 1 and \$\{maximumPeriods/);
  assert.match(submissions,/else if \(period&&period\.status !== "finalised"\)/);
  assert.match(submissions,/if\(type==="FPS"\)employeeRuns=employeeRuns\.filter/);
  assert.match(submissions,/The Additional FPS contains no changed period values/);
  assert.match(submissions,/cessation date must be a valid calendar date within the selected tax year/);
  assert.match(submissions,/export async function GET[\s\S]*requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(submissions,/replacementWorkflow:"Complete the employee's identity details and report them without a NINO on the FPS/);
  assert.match(submissions,/needs a valid date of birth for RTI/);
  assert.match(submissions,/needs Male or Female recorded for RTI/);
  assert.match(submissions,/needs an address and postcode because their National Insurance number is unknown/);
  assert.match(submissions,/has an invalid National Insurance number/);
  assert.match(page,/Use FPS identity matching/);
  assert.match(page,/selected==="NVR"\?"HMRC suspended"/);
  assert.match(page,/disabled=\{filing\|\|selected==="NVR"\}/);
  assert.match(page,/setRtiResultId\(Number\(body\.id\)\|\|draft\.id\);await loadHistory\(\)/);
  assert.match(page,/type:"p32",format,periodNumber:taxMonth/);
  assert.match(submissions,/Additional FPS correction must use late reporting reason H/);
  assert.match(submissions,/An accepted FPS already exists for this period/);
  assert.match(submissions,/An Additional FPS requires an earlier FPS or Additional FPS accepted by HMRC/);
  assert.match(submissions,/A local test-ready package has not been filed/);
  assert.match(submissions,/correctionOfSubmissionId/);
  assert.match(submissions,/correctionBaselineChecksum/);
  assert.match(submissions,/epsDeadline/);
  assert.match(submissions,/dueDate:authoritativeDueDate/);
  assert.match(submissions,/payloadChecksum/);
  assert.match(submissions,/statutoryPay:a\.statutoryPay\+row\.statutoryPay/);
  assert.match(submissions,/statutoryRecoveryAdjustment/);
  assert.match(submissions,/Statutory recovery corrections cannot reduce the cumulative HMRC recovery below zero/);
  assert.match(submissions,/recoveryAdjustments/);
  assert.match(submissions,/submittedAt:null/);
  assert.match(submissions,/declarationAcceptedBy:access\.user\.displayName/);
  assert.match(submissions,/lateReason:lateReason\|\|null/);
  assert.match(liabilities,/10500-employmentAllowanceUsed/);
  assert.match(liabilities,/current\.amountDue=.*current\.employmentAllowance/);
  assert.match(liabilities,/eq\(payrollAdjustments\.type,"statutory-recovery"\)/);
  assert.match(liabilities,/allocatedRecovery\+recoveryCorrection/);
  assert.match(reports,/\"p30\",\"p32\"/);
  assert.match(reports,/eq\(payrollAdjustments\.type,"statutory-recovery"\)/);
  assert.match(page,/No employee payments were made in this tax month/);
  assert.match(page,/Submission summary — review before approval/);
  assert.match(page,/No payment for period declared/);
  assert.match(page,/HMRC deadline/);
  assert.match(page,/function RtiSubmissionPreview/);
  assert.match(page,/Open detailed submission preview/);
  assert.match(page,/Employer details/);
  assert.match(page,/Employee details/);
  assert.match(page,/NI letters and values \(year to date\)/);
  assert.match(page,/Draft transaction ID/);
  assert.match(page,/Assigned by the HMRC transport adapter/);
  assert.match(page,/HMRC submission status/);
  assert.match(submissions,/employer:\{name:employer\.legalName\|\|employer\.name/);
  assert.match(submissions,/schemaVersion:"payflow-rti-draft-3"/);
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  assert.match(payRuns,/director:Boolean\(employee\.director\),directorMethod:employee\.alternativeDirectorNic\?"alternative":"annual"/);
  assert.match(page,/This is the final submission for the tax year/);
  assert.match(page,/This EPS is the final submission for the tax year/);
  assert.match(page,/This PAYE scheme has ceased/);
  assert.match(page,/RTI submission history/);
  assert.match(page,/const latestStatus=\(type:string,fallback:string\)=>latestSubmission\(type\)\?\.status\|\|fallback/);
  assert.match(page,/latestStatus\("FPS","Draft"\)/);
  assert.match(page,/type==="EPS"\?epsTaxMonth:submissionPeriod/);
  assert.match(page,/activeSubmissionPeriod=selected==="EPS"\?epsTaxMonth:submissionPeriod/);
  assert.match(page,/\["EPS","Employer Payment Summary",`Tax month \$\{epsTaxMonth\}`/);
  assert.match(page,/\["validated","test-ready","accepted"\]\.includes\(existing\.status\)/);
  assert.match(page,/setDeclaration\(\["test-ready","accepted"\]\.includes\(existing\.status\)\)/);
  assert.match(page,/draft\.status!=="validated"/);
  assert.match(page,/aria-label=\{selected==="EPS"\?"RTI tax month":"RTI payroll period"\}/);
  assert.match(page,/if\(selected==="EPS"\)setEpsTaxMonth\(value\);else setSubmissionPeriod\(value\)/);
  assert.match(page,/RTI submission schedule/);
  assert.match(page,/FPS is due on or before each pay date/);
  assert.match(page,/rtiEpsDeadline/);
  assert.match(page,/unpreparedFpsPeriods=rtiSchedule\.filter/);
  assert.match(page,/finalised payroll \{unpreparedFpsPeriods\.length===1\?"period has":"periods have"\} no FPS package/);
  assert.match(page,/External filing evidence required/);
  assert.match(page,/acceptedNoPaymentEpsForMonth/);
  assert.match(page,/Not required · no-payment EPS accepted/);
  assert.match(page,/Not applicable · no FPS required/);
  assert.match(page,/Not required unless adjustments · FPS complete/);
  assert.match(page,/fpsRequirementComplete/);
  assert.match(page,/body\.submission\?\.status==="accepted"/);
  assert.match(page,/setEpsTaxMonth\(completedPeriod\+1\)/);
  assert.match(page,/workspace moved to the next period/);
  assert.match(page,/RTI period remains open/);
  assert.doesNotMatch(page,/done:\["accepted","submitted"\]\.includes/);
  assert.match(page,/\"Submission schedule\"/);
  assert.match(page,/\["Earlier Year Update","BACS hash code","Agent authority FBI2"\]\.includes\(item\)\?"HMRC retired"/);
  assert.match(page,/“Prepared” is not an HMRC submission/);
  assert.match(page,/Not transmitted/);
  assert.match(page,/H · Correction to earlier submission/);
  assert.match(page,/correction only/);
  assert.match(page,/validated or test-ready local package must be replaced with a normal FPS instead/);
  assert.match(page,/rtiHistory=history\s*\.filter/);
  assert.match(page,/P30 HMRC payment schedule/);
});

test("Additional FPS packages report period differences and corrected YTD values",async()=>{
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  assert.match(submissions,/periodValueKeys=\["grossPay","taxablePay","nicablePay","statutoryPay","payeTax","employeeNic","employerNic","studentLoan","postgraduateLoan","netPay"\]/);
  assert.match(submissions,/statutoryPay:payRuns\.statutoryPay/);
  assert.match(submissions,/Number\(row\[key\]\|\|0\)-Number\(priorReported\?\.\[key\]\|\|0\)/);
  assert.match(submissions,/correctedYearToDate:row\.ytd/);
  assert.match(submissions,/reportedPeriodValues:Object\.fromEntries/);
  assert.match(submissions,/prior\.reportedPeriodValues/);
  assert.match(submissions,/lacks a safe period baseline/);
  assert.match(submissions,/correctionBaselineChecksum:correctionOf\?\.payloadChecksum/);
});

test("RTI approval rejects stale or corrupted source packages",async()=>{
  const [submissions,page]=await Promise.all([
    readFile("app/api/submissions/route.ts","utf8"),readFile("app/page.tsx","utf8"),
  ]);
  assert.match(submissions,/A JSON RTI submission object is required/);
  assert.match(submissions,/A JSON RTI approval object is required/);
  assert.match(submissions,/sha256\(JSON\.stringify\(payload\)\)!==existing\.payloadChecksum/);
  assert.match(submissions,/source payroll period is no longer finalised/);
  assert.match(submissions,/sourceFingerprint/);
  assert.match(submissions,/currentSourceChecksum!==payload\.sourceChecksum/);
  assert.match(submissions,/RTI source records changed after validation/);
  assert.match(submissions,/validation-failed:rti-/);
  assert.match(submissions,/entityType:"submission-validation"/);
  assert.match(submissions,/return NextResponse\.json\(\{submission:null,payload,validation:\{valid:false,errors\}\},\{status:422\}\)/);
  assert.match(submissions,/eq\(submissions\.payloadChecksum,payloadChecksum\)/);
  assert.match(submissions,/\["validated","test-ready"\]\.includes\(row\.status\)/);
  assert.match(submissions,/await sha256\(JSON\.stringify\(storedPayload\)\)!==row\.payloadChecksum/);
  assert.match(submissions,/validation:\{valid:true,errors:\[\]\},reused:true/);
  assert.match(submissions,/period=\[\.\.\.epsPeriods\]\.sort/);
  assert.match(page,/employerIdentity\.name/);
  assert.match(page,/employerIdentity\.payeReference/);
  assert.match(page,/item\.status!==\"invalid\"/);
  assert.match(page,/The unchanged \$\{selected\} package was reused; no duplicate RTI draft was created/);
});

test("RTI external HMRC results establish guarded accepted and rejected evidence",async()=>{
  const [route,page,validator]=await Promise.all([
    readFile("app/api/submissions/route.ts","utf8"),readFile("app/page.tsx","utf8"),readFile("lib/rti-filing-result.ts","utf8"),
  ]);
  assert.match(route,/input\.action==="record-filing-result"/);
  assert.match(route,/validateRtiFilingResult/);
  assert.match(route,/Only an RTI filing package can receive an HMRC result/);
  assert.match(route,/external acknowledgement reference is already attached/);
  assert.match(route,/Accepted FPS #\$\{accepted\[0\]\.id\} already exists/);
  assert.match(route,/accepted RTI correction baseline has changed/);
  assert.match(route,/liveTransmissionPerformedByPayFlow:false/);
  assert.match(route,/recorded:rti-\$\{existing\.type\.toLowerCase\(\)\.replaceAll\(" ","-"\)\}-\$\{result\.outcome\}/);
  assert.match(validator,/test-ready","submitted/);
  assert.match(page,/Record external RTI result/);
  assert.match(page,/PayFlow does not claim transmission/);
  assert.match(page,/rtiOutcome==="rejected"/);
  assert.match(page,/This FPS already has accepted HMRC evidence\. Use Additional FPS/);
  assert.match(page,/This FPS has accepted HMRC evidence/);
  assert.match(page,/const filingResponse=/);
  assert.match(page,/responseSummary=\[response\.code,response\.message\]/);
  const liveLifecycle=await readFile("tests/live-rti-filing-lifecycle.mjs","utf8");
  for(const evidence of ["HMRC-FPS-P1-REJECTED","HMRC-FPS-P1-ACCEPTED","HMRC-AFPS-P2-ACCEPTED","HMRC-EPS-M1-ACCEPTED","HMRC-EXB-2026-ACCEPTED","supersededRtiPackages"])
    assert.match(liveLifecycle,new RegExp(evidence));
});

test("HMRC liability deductions never render a misleading negative zero",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  assert.match(page,/const deductionMoney = \(n: number\) => n > 0 \? `−\$\{money\(n\)\}` : money\(0\)/);
  assert.match(page,/deductionMoney\(current\.statutoryRecovery\|\|0\)/);
  assert.match(page,/deductionMoney\(current\.employmentAllowance\|\|0\)/);
  assert.match(page,/deductionMoney\(current\.settled\|\|0\)/);
  assert.doesNotMatch(page,/>−\{money\(current\.(?:statutoryRecovery|employmentAllowance|settled)\|\|0\)\}/);
});

test("finalised pay runs retain immutable RTI values for later FPS and P11 output",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0018_payrun_rti_snapshot.sql","utf8");
  const auditMigration=await readFile("drizzle/0027_rti_preparation_audit.sql","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  assert.match(schema,/rtiSnapshot/);
  assert.match(migration,/json_object/);
  assert.match(payRuns,/rtiSnapshot:JSON\.stringify/);
  assert.match(submissions,/parseFrozenRtiSnapshot\(rtiSnapshot\)/);
  assert.match(submissions,/niByCategory/);
  assert.match(submissions,/previousEmploymentPay/);
  assert.match(submissions,/own\.reduce\(\(sum,run\)=>sum\+run\.taxablePay/);
  assert.match(auditMigration,/payload_checksum/);
  assert.match(auditMigration,/declaration_accepted_at/);
  assert.match(reports,/const snapshot=rtiSnapshot\(r\)/);
  assert.match(reports,/p\.status!==\"voided\"/);
  assert.match(reports,/identity\.leavingDate>=dates\.end/);
});

test("corrupted finalised RTI snapshots cannot enter recovery, reports or submissions",async()=>{
  const [snapshot,data,reports,submissions]=await Promise.all([
    readFile("lib/rti-snapshot.ts","utf8"),readFile("app/api/data/route.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),
  ]);
  for(const field of ["payrollId","firstName","lastName","taxCode","niCategory","reportedPayFrequency","earningsPeriod"])assert.match(snapshot,new RegExp(field));
  assert.match(snapshot,/incomplete or unsupported frozen RTI snapshot/);
  assert.match(data,/hasValidFrozenRtiSnapshot\(row\.rtiSnapshot\)/);
  assert.match(reports,/for\(const run of allRuns\)parseFrozenRtiSnapshot\(run\.rtiSnapshot\)/);
  assert.match(submissions,/rawRuns\.some\(run=>!hasValidFrozenRtiSnapshot\(run\.rtiSnapshot\)\)/);
  assert.match(submissions,/snapshot=parseFrozenRtiSnapshot\(rtiSnapshot\)/);
});

test("finalised RTI snapshots preserve employee identity and P45 opening balances",async()=>{
  const [payRuns,submissions]=await Promise.all([
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),
  ]);
  for(const field of ["firstName","middleNames","lastName","dateOfBirth","gender","address","postcode","starterDeclaration","p45PreviousPay","p45PreviousTax"]){
    assert.match(payRuns,new RegExp(`rtiSnapshot:[\\s\\S]{0,1200}${field}`));
    assert.match(submissions,new RegExp(field));
  }
  assert.match(submissions,/return \{\.\.\.row,\.\.\.snapshot,pensionContributionNetPay:/);
  assert.match(submissions,/pensionContributionReliefAtSource:/);
  assert.match(await readFile("app/api/reports/route.ts","utf8"),/p45OpeningFromFinalisedSnapshots\(snapshots/);
});

test("late P45 evidence uses the latest finalised snapshot across reports and year end",async()=>{
  const [helper,reports,portalDocuments,yearEnd]=await Promise.all([
    readFile("lib/p45-opening-evidence.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/portal/documents/route.ts","utf8"),
    readFile("app/api/year-end/route.ts","utf8"),
  ]);
  assert.match(helper,/\[\.\.\.snapshots\]\.reverse\(\)\.find/);
  assert.match(helper,/source:"finalised-payroll"/);
  for(const route of [reports,portalDocuments,yearEnd])assert.match(route,/p45OpeningFromFinalisedSnapshots/);
  assert.match(reports,/p45OpeningFromFinalisedSnapshots\(\[snapshot\]/);
  assert.match(reports,/employmentTaxableToDate\+opening\.previousPay/);
  assert.match(reports,/a late P45 is not backdated into earlier P11 rows/);
  assert.match(yearEnd,/periods\.filter\(item=>item\.status==="finalised"\)/);
});

test("P45, P60 and year-end evidence use immutable finalised employee identity",async()=>{
  const [reports,yearEnd]=await Promise.all([
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/year-end/route.ts","utf8"),
  ]);
  assert.match(reports,/const finalisedIdentity=/);
  assert.match(reports,/Object\.prototype\.hasOwnProperty\.call\(snapshot,field\)/);
  for(const field of ["firstName","middleNames","lastName","payrollId","niNumber","taxCode","startDate","leavingDate"]){
    assert.match(reports,new RegExp(`frozen\\("${field}"`),`${field} is not frozen for statutory certificates`);
    assert.match(yearEnd,new RegExp(`frozen\\(last,"${field}"`),`${field} is not frozen for the P60 year-end checksum`);
  }
  assert.match(reports,/employee:v\.name,payrollId:v\.payrollId,niNumber:v\.niNumber,leavingDate:formatUkDate\(v\.leavingDate\)/);
  assert.match(reports,/employeeIds:eligible\.map\(\(\{employee\}\)=>employee\.id\)/);
  assert.match(yearEnd,/const employeeEvidence=employeeRows\.map/);
  assert.match(yearEnd,/eligibleP60Ids=eligibleForP60\.map\(evidence=>evidence\.employee\.id\)/);
  assert.doesNotMatch(reports,/employee:name\.get\(e\.id\),payrollId:v\.payrollId,niNumber:e\.niNumber/);
});

test("Payroll Giving has a finalised-pay-run remittance report",async()=>{
  const page=await readFile("app/page.tsx","utf8");
  const reports=await readFile("app/api/reports/route.ts","utf8");
  assert.match(page,/"Payroll Giving summary":"payroll-giving"/);
  assert.match(reports,/item\.type==="payroll-giving"/);
  assert.match(reports,/runById\.has\(item\.payRunId\)/);
  assert.match(reports,/approved Payroll Giving agency/);
});

test("attachment and child-maintenance remittances use finalised deductions",async()=>{
  const [page,reports]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/reports/route.ts","utf8"),
  ]);
  assert.match(page,/"Attachment payment schedule":"attachment-payments"/);
  assert.match(page,/"Child maintenance payment export":"child-support-payments"/);
  assert.match(reports,/"attachment-payments","child-support-payments"/);
  assert.match(reports,/runById=new Map\(runs\.map/);
  assert.match(reports,/order\?\.calculationRule==="child-maintenance"/);
  assert.match(reports,/order\.type,item\.deduction,item\.adminFee,order\.id/);
  assert.match(reports,/administration fee is retained by the employer/);
  assert.match(reports,/identity=employee\?finalisedIdentity\(employee\):null/);
  assert.match(page,/\["Earlier Year Update","BACS hash code","Agent authority FBI2"\]\.includes\(item\)\?"HMRC retired"/);
});

test("employee onboarding and workforce reports are operational",async()=>{
  const [page,reports]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/reports/route.ts","utf8"),
  ]);
  for(const mapping of [
    '"Employee detail register":"employee-details"',
    '"Employee list":"employee-list"',
    '"Joiners and leavers":"joiners-leavers"',
    '"Employee joining statement":"starter-statement"',
    '"Blank new-employee form":"blank-joiner-form"',
  ])assert.match(page,new RegExp(mapping));
  for(const type of ["employee-details","employee-list","joiners-leavers","starter-statement","blank-joiner-form"])assert.match(reports,new RegExp(`"${type}"`));
  assert.match(reports,/HR medical notes, emergency contacts and bank account details are deliberately excluded/);
  assert.match(reports,/employee\.starterEvidence\|\|""/);
  assert.match(reports,/A P60 is reference evidence only and does not replace a current P45/);
  assert.match(reports,/\["Declaration","Employee signature and date; payroll reviewer signature and date",""\]/);
  assert.match(page,/"Joining statement","Blank joiner form"/);
});

test("operational audit records use the authenticated administrator identity",async()=>{
  for(const route of ["employer","leave","statutory-notices","pay-runs","exports","hmrc-payments","hmrc-notices"]){
    const source=await readFile(`app/api/${route}/route.ts`,"utf8");
    assert.doesNotMatch(source,/actor:\"(?:Payroll user|Payroll administrator)\"/,`${route} still writes a generic audit actor`);
    assert.match(source,/actor:access\.user\.(?:displayName|email)/,`${route} does not use the authenticated actor`);
  }
});

test("statutory calculation API preserves qualifying-day inputs",async()=>{
  const source=await readFile("app/api/calculate/route.ts","utf8");
  assert.match(source,/\{payableDays,qualifyingDaysPerWeek\}/);
  assert.match(source,/Payable days must be a non-negative whole number/);
  assert.match(source,/Qualifying days per week must be between 1 and 7/);
});

test("minimum-wage compliance uses persisted age and apprenticeship profiles",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0031_employee_minimum_wage_profile.sql","utf8");
  const employeesApi=await readFile("app/api/employees/route.ts","utf8");
  const analysis=await readFile("app/api/analysis/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/minimumWageCategory/);
  assert.match(migration,/minimum_wage_category/);
  assert.match(employeesApi,/apprenticeshipStartDate/);
  assert.match(analysis,/minimumWageRate/);
  assert.match(analysis,/effectiveHourlyRate/);
  assert.match(analysis,/validTaxYear\(taxYear\)/);
  assert.match(analysis,/const payElementMap/);
  assert.match(analysis,/payCount:runs\.length/);
  assert.match(page,/Pay-element analysis/);
  assert.match(page,/Average gross/);
  assert.match(page,/Automatic from date of birth/);
  assert.match(page,/Apprenticeship start date/);
});

test("unused employees can be deleted without erasing statutory history",async()=>{
  const employeesApi=await readFile("app/api/employees/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(employeesApi,/export async function DELETE/);
  for(const table of ["payRuns","leaveEvents","pensionMemberships","expensesBenefits","attachmentOrders","recurringPayItems"])
    assert.match(employeesApi,new RegExp(`from\\(${table}\\)`));
  assert.match(employeesApi,/cannot be deleted\. Record a leaving date/);
  assert.match(employeesApi,/deleted:unused-employee/);
  assert.match(page,/Delete employee/);
  assert.match(page,/deleteEmployeeRecord/);
});

test("period, hourly and daily employee pay bases drive frequency-aware basic pay",async()=>{
  const schema=await readFile("db/schema.ts","utf8");
  const migration=await readFile("drizzle/0032_employee_daily_pay_basis.sql","utf8");
  const employeesApi=await readFile("app/api/employees/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(schema,/dailyRate/);
  assert.match(migration,/working_days_per_week/);
  assert.match(employeesApi,/Hourly employees require a positive hourly rate/);
  assert.match(employeesApi,/Daily employees require a positive daily rate/);
  assert.match(page,/const periodicBasePay/);
  assert.match(page,/Contracted hourly/);
  assert.match(page,/Contracted daily/);
  assert.match(page,/Calculated \$\{frequencyRule\.label\.toLowerCase\(\)\} basic pay/);
});

test("employee starter, tax, NIC and loan setup uses validated statutory choices",async()=>{
  const employeesApi=await readFile("app/api/employees/route.ts","utf8");
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  const submissions=await readFile("app/api/submissions/route.ts","utf8");
  const page=await readFile("app/page.tsx","utf8");
  assert.match(employeesApi,/isRecognisedPayeTaxCode/);
  assert.match(employeesApi,/Select a supported National Insurance category/);
  assert.match(employeesApi,/Student loan plan must be 1, 2, 4 or 5/);
  assert.match(employeesApi,/starterEvidenceValues/);
  assert.match(employeesApi,/normalizeStarterDeclaration/);
  assert.match(page,/Secondary employment/);
  assert.match(page,/Statement C – another job or pension/);
  assert.match(page,/>Plan 5</);
  assert.match(page,/Deduct postgraduate loan/);
  assert.match(employeesApi,/Payroll ID must contain 1 to 35 printable characters/);
  assert.match(employeesApi,/Payroll ID is already assigned to another employee for this employer/);
  assert.match(employeesApi,/previousPayrollId:payrollIdChanged\?existing\.payrollId:existing\.previousPayrollId/);
  assert.match(employeesApi,/action:"changed:employee-payroll-id"/);
  assert.match(page,/method:persistedEmployee\?"PUT":"POST"/);
  assert.match(page,/Previous payroll ID \(automatic\)/);
  assert.match(employeesApi,/A secondary employment must use starter Statement C/);
  assert.match(employeesApi,/worked elsewhere this tax year and has no P45 must use starter Statement B/);
  assert.match(employeesApi,/A P60 is reference-only and cannot replace a current P45/);
  assert.match(employeesApi,/Starter Statement B must use emergency code 1257L/);
  assert.match(employeesApi,/Starter Statement C must use tax code BR/);
  assert.match(employeesApi,/no declaration must use tax code 0T/);
  assert.match(page,/No statement – use 0T week 1 \/ month 1/);
  assert.match(page,/starterDeclaration:"Statement C – another job or pension",taxCode:"BR"/);
  for(const field of ["title","middleNames"]) {
    assert.match(employeesApi,new RegExp(`${field}:input\\.${field}`));
    assert.match(page,new RegExp(field));
  }
  assert.match(payRuns,/starterEvidence:employee\.starterEvidence/);
  assert.match(submissions,/reportStarterDeclaration=!migrationOpening&&period!\.periodNumber===firstPaidPeriod&&row\.starterEvidence!=="P45 provided"/);
  assert.match(submissions,/starterDeclaration:reportStarterDeclaration\?row\.starterDeclaration:null/);
});

test("late P45 and reference-only P60 evidence is persisted",async()=>{
  const [page,route,schema,migration]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/employees/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("drizzle/0033_employee_starter_evidence_flags.sql","utf8"),
  ]);
  for(const field of ["p45ReceivedAfterPayroll","p60ReferenceOnly"]){
    assert.match(page,new RegExp(field));
    assert.match(route,new RegExp(field));
    assert.match(schema,new RegExp(field));
  }
  assert.match(migration,/p45_received_after_payroll/);
  assert.match(migration,/p60_reference_only/);
  assert.match(route,/validateP45OpeningBalances/);
  assert.match(route,/P45 opening pay and tax must come from a leaving date within/);
  assert.match(route,/P45 leaving date cannot be after this employment starts/);
  assert.match(route,/Current-year previous pay or tax can only be applied from a P45/);
  const payRuns=await readFile("app/api/pay-runs/route.ts","utf8");
  assert.match(payRuns,/p45OpeningBalances/);
  assert.match(payRuns,/receivedAfterFirstPayroll:employee\.p45ReceivedAfterPayroll/);
  assert.match(payRuns,/priorFinalisedRuns:prior\.length/);
  assert.match(payRuns,/cannot supply year-to-date payroll totals/);
  assert.doesNotMatch(payRuns,/record\.ytdTaxablePay/);
  assert.doesNotMatch(payRuns,/record\.ytdTaxPaid/);
});

test("benefit corrections are tenant-bound, auditable and report-safe",async()=>{
  const [page,route,schema,migration,reports]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/benefits/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("drizzle/0044_benefit_corrections.sql","utf8"),
    readFile("app/api/reports/route.ts","utf8"),
  ]);
  for(const field of ["voidReason","voidedAt","replacesBenefitId"]){
    assert.match(route,new RegExp(field));
    assert.match(schema,new RegExp(field));
  }
  assert.match(migration,/void_reason/);
  assert.match(migration,/replaces_benefit_id/);
  assert.match(route,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(route,/action==="void"/);
  assert.match(route,/original benefit must be voided/i);
  assert.match(route,/finalisedPayrollPreserved:true/);
  assert.match(reports,/r\.status==="reviewed"/);
  assert.match(page,/BenefitRegisterModal/);
  assert.match(page,/Void incorrect record/);
  assert.match(page,/never rewrites a finalised payroll snapshot/);
});

test("benefits retain P11D section and Class 1, Class 1A or exempt treatment",async()=>{
  const [page,benefits,payRuns,reports,analysis,yearEnd,schema,migration,classification]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/benefits/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/analysis/route.ts","utf8"),readFile("app/api/year-end/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0045_benefit_classification.sql","utf8"),readFile("lib/benefit-classification.ts","utf8"),
  ]);
  for(const field of ["p11dSection","nicTreatment"]){
    assert.match(benefits,new RegExp(field));assert.match(schema,new RegExp(field));
  }
  for(const section of "ABCDEFGHIJKLMN")assert.match(classification,new RegExp(`section:\"${section}\"`));
  assert.match(migration,/p11d_section/);assert.match(migration,/nic_treatment/);
  assert.match(payRuns,/automaticClass1Benefits/);
  assert.match(payRuns,/nicableGrossPay:.*automaticClass1Benefits/);
  assert.match(reports,/reportableBenefits=benefits\.filter\(r=>r\.nicTreatment!==\"exempt\"\)/);
  assert.match(analysis,/item\.status===\"reviewed\"&&item\.nicTreatment!==\"exempt\"/);
  assert.match(yearEnd,/benefit\.status!==\"voided\"/);
  assert.match(yearEnd,/benefit\.nicTreatment===\"class-1a\"\?benefit\.cashEquivalent\*\.15:0/);
  assert.match(page,/Class 1 · include value in payroll NIC/);
  assert.match(page,/Register only/);
});

test("Class 1 benefit timing is dated and cannot bypass finalised payroll",async()=>{
  const [page,benefits,payRuns,reports,yearEnd,schema,migration,allocator]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/benefits/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("app/api/year-end/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0046_class1_benefit_timing.sql","utf8"),readFile("lib/payrolled-benefits.ts","utf8"),
  ]);
  assert.match(schema,/providedDate/);assert.match(migration,/provided_date/);
  assert.match(benefits,/Class 1 benefits require the date/);
  assert.match(benefits,/affects finalised Period/);
  assert.match(benefits,/finalisedBenefitPeriods/);
  assert.match(benefits,/nicTreatment===\"class-1\"\|\|normalized\.payrolled/);
  assert.match(benefits,/owned\.nicTreatment===\"class-1\"\|\|owned\.payrolled/);
  assert.match(benefits,/prepare an Additional FPS/);
  assert.match(payRuns,/providedDate:expensesBenefits\.providedDate/);
  assert.match(allocator,/if\(source\.providedDate\)return source\.providedDate>=periodStart/);
  assert.match(reports,/Provided \/ paid date/);
  assert.match(yearEnd,/benefit\.providedDate/);
  assert.match(page,/Date provided or paid/);
  assert.match(page,/full value enters NIC-able earnings in the tax month/);
  assert.match(page,/benefit-error/);
  assert.match(page,/setError\(error instanceof Error\?error\.message/);
  assert.match(page,/setOperationError\(message\)/);
});

test("mid-year starts preserve audited P11 history without inventing prior liabilities",async()=>{
  const [page,openings,payRuns,submissions,reports,yearEnd,data,hmrc,schema,migration,nicMigration]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/opening-balances/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/submissions/route.ts","utf8"),
    readFile("app/api/reports/route.ts","utf8"),readFile("app/api/year-end/route.ts","utf8"),
    readFile("app/api/data/route.ts","utf8"),readFile("app/api/hmrc-liabilities/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0056_mid_year_opening_balances.sql","utf8"),
    readFile("drizzle/0057_mid_year_nic_categories.sql","utf8"),
  ]);
  assert.match(schema,/payrollOpeningBalances/);assert.match(migration,/payroll_opening_balances/);
  assert.match(nicMigration,/nic_category_breakdown/);assert.match(schema,/nicCategoryBreakdown/);
  assert.match(openings,/firstPayFlowPeriod<2\|\|firstPayFlowPeriod>schedule\.length/);
  assert.match(openings,/before any payroll run is saved/);
  assert.match(openings,/payloadChecksum/);assert.match(openings,/status:desiredStatus/);
  assert.match(payRuns,/\["finalised","migrated"\]\.includes\(p\.status\)/);
  assert.match(payRuns,/migrationOpening\?\.taxablePay/);
  assert.match(submissions,/openingBalances/);assert.match(submissions,/migrationOpening\?\.grossPay/);
  assert.match(submissions,/openingNicCategories/);assert.match(submissions,/niByCategory:\[\.\.\.categories\.values\(\)\]/);
  assert.match(reports,/Opening before P/);assert.match(reports,/migrationOpeningByEmployee/);
  assert.match(reports,/Opening NI category/);assert.match(openings,/Each NI category may appear only once/);
  assert.match(yearEnd,/\["migrated","finalised"\]\.includes\(p\.status\)/);
  assert.match(hmrc,/migrated-history/);assert.match(page,/Processed in the previous payroll system/);
  assert.match(data,/"payrollOpeningBalances"/);assert.match(data,/schemaVersion:7/);
  assert.match(page,/Mid-year payroll start/);assert.match(page,/separate from P45 previous-employment figures/);
  assert.match(page,/periodMigrated/);assert.match(page,/Imported payroll history/);
});

test("pension onboarding and statutory reporting stay visibly synchronized",async()=>{
  const [page,reports]=await Promise.all([
    readFile("app/page.tsx","utf8"),
    readFile("app/api/reports/route.ts","utf8"),
  ]);
  assert.match(page,/PensionsWorkspace toast=\{toast\} employees=\{employees\} finalised=\{finalised\} onDataChanged=\{onDataChanged\}/);
  assert.match(page,/function PensionsWorkspace\(\{ toast,employees,finalised,onDataChanged \}/);
  assert.match(page,/await loadPensions\(\);await onDataChanged\(\);toast/);
  assert.match(page,/Create and activate a scheme before assessing or enrolling workers/);
  assert.match(page,/\{schemeId\?"Active":"Not configured"\}/);
  assert.match(page,/Boolean\(schemeId\)&&<button/);
  assert.match(page,/\{schemeId\?"Update active scheme":"Create and activate scheme"\}/);
  assert.match(page,/<input type="checkbox" checked=\{checked\} disabled=\{disabled\} readOnly\/>/);
  assert.match(page,/draft generated with its required declarations and validated\.`?,true/);
  assert.match(page,/test-ready and selected for external-result recording\. Live transmission requires the HMRC transport adapter\.",true/);
  assert.match(reports,/round\(allocation\.pay\),round\(allocation\.recovery\)/);
  assert.match(reports,/round\(event\.relevantPayTotal\)/);
});

test("employer CSV import is validated, owner-bound and rollback-safe",async()=>{
  const [page,route,validator]=await Promise.all([
    readFile("app/page.tsx","utf8"),
    readFile("app/api/employer/route.ts","utf8"),
    readFile("lib/employer-import.ts","utf8"),
  ]);
  assert.match(page,/Download employer template/);
  assert.match(page,/Choose employer CSV/);
  assert.match(page,/action:"import-employers"/);
  assert.match(page,/"Employer CSV import"/);
  assert.match(route,/input\.action===\"import-employers\"/);
  assert.match(route,/validateEmployerImportRows/);
  assert.match(route,/role:\"owner\",canViewConfidential:true/);
  assert.match(route,/action:\"imported:employer-client\"/);
  assert.match(route,/every client created by this file was rolled back/);
  assert.match(route,/db\.delete\(employerMemberships\)/);
  assert.match(route,/db\.delete\(employerSettings\)/);
  assert.match(route,/db\.delete\(employers\)/);
  assert.match(validator,/rows\.length>100/);
  assert.match(validator,/PAYE reference is duplicated in this file/);
  assert.match(validator,/a CIS contractor requires a 10-digit UTR/);
});

test("reviewed expenses and benefits copy into the active tax year as audited drafts",async()=>{
  const [page,route,schema,migration,data,copyEngine]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/benefits/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("drizzle/0062_benefit_copy_provenance.sql","utf8"),
    readFile("app/api/data/route.ts","utf8"),readFile("lib/benefit-copy.ts","utf8"),
  ]);
  assert.match(page,/Copy reviewed benefits/);
  assert.match(page,/action:"copy-tax-year"/);
  assert.match(page,/Copied values must be reviewed before they affect payroll or reporting/);
  assert.match(page,/"Copy expenses and benefits"/);
  assert.match(route,/input\.action==="copy-tax-year"/);
  assert.match(route,/targetTaxYear!==employer\.taxYear/);
  assert.match(route,/row\.taxYear===sourceTaxYear&&row\.status==="reviewed"/);
  assert.match(route,/Confidential employees have reviewed benefits/);
  assert.match(route,/status:"draft",requiresReview:true/);
  assert.match(route,/action:"copied:expense-benefits"/);
  assert.match(schema,/copiedFromBenefitId/);
  assert.match(schema,/expenses_benefits_copied_source_unique/);
  assert.match(migration,/copied_from_benefit_id/);
  assert.match(data,/duplicateCopiedBenefit/);
  assert.match(data,/nextTaxYear\(source\.taxYear\)!==row\.taxYear/);
  assert.match(copyEngine,/loanOpeningBalance=Number\(source\.loanClosingBalance\)/);
  assert.match(copyEngine,/source\.availableTo&&source\.availableTo<targetStart/);
});

test("agent administration creates source-bound charge invoices and preserves them in recovery",async()=>{
  const [page,route,schema,migration,data,billing,styles]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/agent/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0063_agent_billing.sql","utf8"),readFile("app/api/data/route.ts","utf8"),
    readFile("lib/agent-billing.ts","utf8"),readFile("app/globals.css","utf8"),
  ]);
  assert.match(page,/function AgentWorkspace/);
  assert.match(page,/AgentWorkspace toast=\{toast\}/);
  assert.match(page,/Recalculate payslip count/);
  assert.match(page,/Create next draft invoice/);
  assert.match(page,/FBI2 is retired/);
  assert.match(page,/Open current HMRC agent authorisation/);
  assert.match(page,/"Agent details","Agent charges","Agent invoice","Payslip count"/);
  assert.match(route,/requireEmployerAccess\(request,employerId,"employer-admin"\)/);
  assert.match(route,/action==="create-invoice"/);
  assert.match(route,/sourceEvidence=JSON\.stringify/);
  assert.match(route,/sourceChecksum=await sha256\(sourceEvidence\)/);
  assert.match(route,/db\.batch\(\[/);
  assert.match(route,/format"\)==="html"/);
  assert.match(billing,/per-payslip/);
  assert.match(billing,/new Set\(source\.payRuns\.map\(run=>run\.employeeId\)\)\.size/);
  assert.match(billing,/validateAgentInvoiceEvidence/);
  assert.match(schema,/agentProfiles/);assert.match(schema,/agentCharges/);assert.match(schema,/agentInvoices/);
  assert.match(migration,/CREATE TABLE `agent_profiles`/);assert.match(migration,/CREATE TABLE `agent_invoices`/);
  assert.match(data,/"agentProfiles","agentCharges","agentInvoices"/);
  assert.match(data,/validateAgentInvoiceEvidence/);
  assert.match(data,/backup\.schemaVersion===5/);
  assert.match(styles,/\.agent-workspace/);
});

test("pay-frequency changes are previewed, source-bound and preserve statutory history",async()=>{
  const [route,engine]=await Promise.all([
    readFile("app/api/pay-frequency/route.ts","utf8"),readFile("lib/pay-frequency-change.ts","utf8"),
  ]);
  assert.match(route,/action==="preview"/);
  assert.match(route,/input\.fingerprint.*plan\.fingerprint/);
  assert.match(route,/input\.confirmation.*confirmationPhrase/);
  assert.match(route,/db\.delete\(payItems\)/);
  assert.match(route,/db\.delete\(payrollAdjustments\)/);
  assert.match(route,/reportedPayFrequency:plan\.targetFrequency/);
  assert.match(route,/action:"changed:pay-frequency"/);
  assert.match(engine,/Finalised or migrated payroll periods exist/);
  assert.match(engine,/Mid-year opening balances are tied/);
  assert.match(engine,/Recurring pay schedules use period numbers/);
  assert.doesNotMatch(engine,/unsupportedMultiWeekAttachmentRules|Scottish attachment calculation does not support/);
});

test("report colours and pre-printed stationery are employer-scoped and applied to private documents",async()=>{
  const [page,route,schema,migration,employerRoute,evidence,styles]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/reports/route.ts","utf8"),readFile("db/schema.ts","utf8"),
    readFile("drizzle/0064_report_presentation.sql","utf8"),readFile("app/api/employer/route.ts","utf8"),
    readFile("lib/employer-cis-state-evidence.ts","utf8"),readFile("app/globals.css","utf8"),
  ]);
  assert.match(page,/Reports and printing/);
  assert.match(page,/Report accent colour/);
  assert.match(page,/Reserve space for pre-printed letterhead/);
  assert.match(route,/type ReportBranding/);
  assert.match(route,/page\.preprinted\{padding-top:42mm/);
  assert.match(route,/escapeHtml\(header\)/);
  assert.match(route,/escapeHtml\(footer\)/);
  assert.match(route,/employerSettings\.reportAccentColour/);
  assert.match(schema,/reportAccentColour/);assert.match(schema,/reportStationeryMode/);
  assert.match(migration,/report_accent_colour/);assert.match(migration,/report_stationery_mode/);
  assert.match(employerRoute,/reportAccentColour/);assert.match(evidence,/reportStationeryMode/);
  assert.match(styles,/\.report-style-preview/);
});

test("holiday-pay funds preserve distinct tax treatments, finalised evidence and recovery data",async()=>{
  const [page,api,payRuns,reports,schema,migration,data,engine]=await Promise.all([
    readFile("app/page.tsx","utf8"),readFile("app/api/holiday-funds/route.ts","utf8"),
    readFile("app/api/pay-runs/route.ts","utf8"),readFile("app/api/reports/route.ts","utf8"),
    readFile("db/schema.ts","utf8"),readFile("drizzle/0068_holiday_fund_ledgers.sql","utf8"),
    readFile("app/api/data/route.ts","utf8"),readFile("lib/holiday-fund.ts","utf8"),
  ]);
  assert.match(page,/Manage holiday pay fund/);
  assert.match(page,/function HolidayFundModal/);
  assert.match(page,/Rolled-up holiday pay is limited to irregular-hours and part-year workers/);
  assert.match(page,/"Holiday-pay fund ledger":"holiday-fund"/);
  assert.match(api,/requireEmployerAccess\(request,employerId,"payroll-write"\)/);
  assert.match(api,/Scheme type, worker classification, start date and opening balance are frozen/);
  assert.match(api,/Finalised or imported holiday-fund evidence cannot be edited/);
  assert.match(payRuns,/calculateHolidayFundPeriod/);
  assert.match(payRuns,/name:"Rolled-up holiday pay"/);
  assert.match(payRuns,/name:"Holiday savings contribution"/);
  assert.match(payRuns,/restoredHolidayFundBalances/);
  assert.match(reports,/title:"Holiday-pay fund and rolled-up pay ledger"/);
  assert.match(reports,/retain holiday entitlement and pay records for at least 6 years/);
  assert.match(schema,/holidayFundSettings/);assert.match(schema,/holidayFundEntries/);
  assert.match(migration,/holiday_fund_settings/);assert.match(migration,/holiday_fund_entries/);
  assert.match(data,/"holidayFundSettings","holidayFundEntries"/);
  assert.match(data,/validateHolidayFundEntryEvidence/);
  assert.match(data,/schemaVersion:7/);
  assert.match(engine,/schemeType==="rolled-up"/);
  assert.match(engine,/postTaxDeduction:addedAmount/);
});

test("RTI, CIS and pension workspaces share payroll-style period navigation without changing filing operations",async()=>{
  const [page,styles]=await Promise.all([readFile("app/page.tsx","utf8"),readFile("app/globals.css","utf8")]);
  assert.match(page,/function ModulePeriodBar/);
  assert.match(page,/subtitle="RTI tax months"/);
  assert.match(page,/subtitle="CIS tax months"/);
  assert.match(page,/pensionPeriodSections=new Set\(\["Assessment","Contributions","Submissions"\]\)/);
  assert.match(page,/cisPeriodViews=new Set\(\["Payments","Corrections","CIS300 return","Statements"\]\)/);
  assert.match(page,/selectedPensionContributions=pensionData\.contributions\.filter/);
  assert.match(page,/onClick=\{validateSubmission\}/);
  assert.match(page,/onClick=\{prepareFiling\}/);
  assert.match(page,/onClick=\{prepareReturn\}/);
  assert.match(page,/onClick=\{downloadContributions\}/);
  assert.match(styles,/\.module-period-wrap/);
  assert.match(styles,/\.cis-workspace>\.subnav:not\(\.cis-section-nav\)/);
});
