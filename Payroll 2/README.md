# PayFlow UK Payroll

PayFlow is a tenant-isolated UK payroll workspace for the 2026/27 tax year. It covers employee onboarding, PAYE and NIC calculations, statutory pay, automatic enrolment, payroll documents, HMRC liabilities, RTI preparation, CIS, employee self-service, reporting, audit history and guarded data recovery.

The application uses Vinext, React, Cloudflare D1 and Drizzle. Payroll records are durable server-side data; browser state is not the source of truth.

## Current operating boundary

The local calculation and evidence workflows are implemented and tested. External transmission remains deliberately separated from local approval:

- FPS, EPS, Additional FPS, expenses-and-benefits and CIS300 packages can be generated, validated, approved and retained with immutable source evidence.
- An accepted or rejected external response can be recorded only against the matching approved package.
- Live HMRC transmission requires HMRC software recognition, a vendor ID, credentials and a production transport adapter.
- NINO Verification Requests are disabled because HMRC withdrew that service from 3 February 2025 until further notice.
- The former RTI Bacs hash cross-reference process is treated as retired from 6 April 2023.
- Pension provider upload, bank submission, transactional email and encrypted PDF delivery require the relevant accredited provider integrations.
- Calculations are locked to the verified 2026/27 statutory rate pack. A later tax year cannot be processed until its rate pack and RTI changes have been implemented and verified.

Do not represent a locally prepared or `test-ready` package as filed with HMRC or a pension provider.

## Local preview

Prerequisite: Node.js 22.13 or newer.

```powershell
pnpm install
pnpm dev
```

Open the exact local URL printed by the development server. The current workspace normally uses:

```text
http://localhost:3001/
```

An administrator account is required. The first run presents an owner-account setup screen.

## Validation

Run the deterministic calculation and implementation suite:

```powershell
pnpm test
```

Run type checking:

```powershell
node_modules/.bin/tsc --noEmit
```

Build the deployable worker:

```powershell
pnpm build
```

The `tests/live-*.mjs` scripts exercise the running preview through authenticated APIs. They intentionally create isolated QA employers and should be used only against a test database. The principal acceptance run is:

```powershell
node tests/live-full-stack-scenario.mjs
```

It creates 20 varied employees, processes multiple payroll periods, validates RTI evidence, enrols pensions and runs a construction-company CIS scenario.

The Tools workspace also has an owner-only **Create fresh sample payroll** action. It creates a separate, conspicuously labelled demonstration employer with 20 starter, tax, NIC, loan, director and portal variations, one pension scheme and three CIS deduction-rate cases. It never replaces or mixes records into the employer currently open and its identifiers must never be submitted externally. The focused two-month acceptance journey is:

```powershell
node tests/live-sample-payroll.mjs
```

That journey also verifies canonical starter/P45 identity, HMRC gender codes,
deliverable-format employee email addresses, a complete payslip-delivery batch and
full backup-state validation for the generated employer.

The focused RTI evidence-state journey prepares two FPS periods, records rejected and
accepted external results, applies a post-finalisation correction through Additional
FPS, files EPS and expenses-and-benefits evidence, verifies duplicate acknowledgement
protection, and confirms that a source change supersedes a prepared package:

```powershell
node tests/live-rti-filing-lifecycle.mjs
```

The payroll-support journey covers recurring pay items, employee-loan recovery,
cash-pay rounding and carry, source-bound bank files, payslip email/portal delivery,
resends, schedule cancellation and ledger reports across three periods:

```powershell
node tests/live-pay-support-lifecycle.mjs
```

The holiday-pay journey separates employer-funded taxable holiday pay, employee
net-pay savings and eligible rolled-up holiday pay. It runs each treatment over two
periods, reopens and refinalises the latest period, checks the statutory ledger and
rejects tampered recovery evidence:

```powershell
node tests/live-holiday-fund-scenario.mjs
```

The operational-controls journey covers departments, the employer calendar, annual
leave evidence, HMRC coding and loan notices, statutory non-payment notices,
gross-to-net/target-net calculations, minimum-wage analysis and employee history:

```powershell
node tests/live-operational-controls.mjs
```

The accounting-export journey creates two coded departments, finalises a mixed
payroll, proves that the signed nominal-ledger file balances to zero, verifies
custom liability and control codes, and confirms that later department edits do
not rewrite the frozen posting allocation:

```powershell
node tests/live-accounting-export.mjs
```

The confidential-boundaries journey runs a mixed confidential/public payroll as a
restricted user and verifies filtering across payroll support, HMRC and statutory
notices, history, analysis, reports, bank files and payslip delivery:

```powershell
node tests/live-confidential-boundaries.mjs
```

The agent-billing journey creates its own demonstration employer, completes two
payroll periods, exercises fixed/per-payslip/per-period/RTI charging, issues, voids
and replaces an invoice, checks restricted-user access and completes a tamper-tested
backup restore:

```powershell
node tests/live-agent-billing-scenario.mjs
```

Use a unique `PAYFLOW_LIVE_RUN_ID` when repeating a live journey against the same test database,
for example:

```powershell
$env:PAYFLOW_LIVE_RUN_ID = "local-regression-01"
node tests/live-pay-support-lifecycle.mjs
```

## Data and recovery

- D1 schema definitions are in `db/schema.ts`.
- Ordered SQL migrations are in `drizzle/`.
- Complete schema-7 employer backups are tenant-bound, checksummed and optionally password-encrypted in the browser. Schema 5 and 6 recovery files remain supported through explicit empty-table compatibility paths.
- File restore is owner-only, analysed before replacement, protected by an exact confirmation phrase and rejected if the live payroll changes after analysis.
- Retained payroll versions use the same validation and atomic restore path. They are excluded from their own backup payload so recovery points survive a revert.
- Authentication secrets and live sessions are never exported in a payroll backup.

Apply every unapplied migration before using a database with the current source. Never edit or reorder an already deployed migration.

## Main surfaces

- **Payroll:** sequential pay periods, draft/finalise/reopen controls, pay items, statutory pay, employer holiday funds, employee holiday savings, eligible rolled-up holiday pay, deductions, pensions, payslips and payment outputs.
- **Employees:** personal, employment, starter/leaver, payment, tax/NIC, RTI and confidential HR records.
- **Employer and clients:** PAYE/CIS identity, defaults, departments, calendar, access roles, client tracking and agent billing.
- **HMRC and RTI:** liabilities, payments, notices, year end, filing packages, corrections and external acknowledgements.
- **CIS:** subcontractor identities, verification evidence, payments, deductions, corrections, statements and CIS300.
- **Pensions:** schemes, assessment, membership lifecycle, contributions, letters, declarations and provider packages.
- **Reports:** statutory and management reports, print-ready documents and CSV exports.
- **Tools:** calculators, opening balances, validated imports, encrypted backups and retained versions.

## Security model

All operational routes require an authenticated administrator or employee-portal session and an explicit employer identifier. Employer membership and role checks run server-side. Confidential employees are filtered centrally from users without the required permission. Sensitive changes create tenant-scoped audit records.

The local preview uses application-owned authentication. A hosted deployment must additionally use an appropriate Sites access policy and production secret management.

## Official HMRC references

- [RTI technical specifications for 2026 to 2027](https://www.gov.uk/government/publications/real-time-information-internet-submissions-2026-to-2027-technical-specifications)
- [RTI support for software developers and PAYE recognition](https://www.gov.uk/government/collections/real-time-information-online-internet-submissions-support-for-software-developers)
- [HMRC notice withdrawing the NINO Verification Request service](https://www.gov.uk/hmrc-internal-manuals/paye-manual/paye55030)
