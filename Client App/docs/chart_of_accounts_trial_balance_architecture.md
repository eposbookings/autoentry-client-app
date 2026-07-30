# Chart of Accounts and Trial Balance Architecture

Status: architecture only  
Scope: prepare the native accounting trial balance for the later UK master chart-of-accounts implementation  
Implementation status: Phase 1 trial-balance foundation implemented on 2026-07-27; master-chart import remains deferred to Phase 2

## 1. Decision summary

The supplied workbook must not be imported into `accounting_accounts` as extra columns or treated as a replacement list of nominal codes.

The application needs a four-layer accounting model:

```text
master account template
        ↓ lineage/defaults
tenant nominal account
        ↓ stable reporting_category_id
internal reporting category
        ↓ framework/presentation rules
statutory presentation
        ↓ versioned exact mapping
taxonomy concept
```

The first implementation stage should upgrade the trial-balance foundation only:

1. establish stable nominal identity and canonical balance semantics;
2. introduce reporting-category references without yet generating statutory accounts or iXBRL;
3. make one canonical trial-balance service the source for General Ledger, Reports, Year End, and later Annual Accounts;
4. preserve nominal-level drill-down and historical inactive accounts;
5. surface validation metadata needed by the next stage, but do not yet import the 275-row master chart into tenants;
6. do not migrate conflicting codes such as 7000, 7500, or 7510 until an accountant-approved migration plan exists.

This boundary prepares the system for the supplied chart without prematurely changing live tenant ledgers.

## 2. Sources reviewed

- `codex_chart_of_accounts_implementation_spec.md`
- `uk_master_chart_of_accounts_with_codex_instructions.xlsx`
- `backend/server.py`
- native accounting backend contract tests
- `frontend/src/pages/admin/accountancy-software/AdminAccountancySoftware.jsx`
- `frontend/src/pages/admin/accountancy-software/moduleConfig.js`
- Accounts Payable, Accounts Receivable, Banking, VAT, Fixed Assets, General Ledger, Reports, and Year End flows

The workbook contains:

| Sheet | Reviewed content |
|---|---|
| Master Chart | 275 accounts and 22 configuration columns |
| Module Summary | account counts and activation/blocking profile for 8 modules |
| Implementation Guide | nominal mapping, module, filing, sign, CIS, fixed-assets, payroll, tax, taxonomy, and migration rules |
| Data Dictionary | controlled meanings for the main configuration fields |
| Official Sources | HMRC, FRC, Companies House, and CIS references |
| Codex Column Instructions | database, validation, safety, and downstream rules for all 22 columns |
| Codex Build Sequence | 12 implementation stages and their acceptance criteria |
| Codex Rules | COA-001 through COA-020 |

Workbook integrity observations:

- 275 nonblank and unique account codes are present.
- All account codes are represented as text values in the inspected workbook.
- Eight module values are used: `CORE`, `VAT`, `PAYROLL`, `CIS`, `FIXED_ASSETS`, `CONSTRUCTION`, `CORPORATION_TAX`, and `ACCOUNTS_PRODUCTION`.
- 150 displayed internal reporting categories are present. These labels must be converted into stable category records/IDs before production use.
- 267 rows contain a suggested taxonomy concept. These are hints only.
- Filing statuses include `Ready`, `Review`, `Blocked`, and `Inactive`.
- The workbook contains deliberate migration controls for 7000, 7500, and 7510.

## 3. Current system architecture

### 3.1 Persistence model

The native accounting implementation is currently concentrated in `backend/server.py` and uses SQLAlchemy `Table` definitions.

The current nominal record is `accounting_accounts`:

- surrogate `id` already exists;
- `client_id` and `code` identify a tenant nominal in application logic;
- account classification is stored as free-form/string fields such as `category`, `account_type`, and `purpose`;
- both `control_account` and `is_control_account` booleans exist;
- mapping fields are held directly on the nominal (`accounts_report_section`, `statutory_mapping_code`, `accounts_taxonomy_tag`, and related fields);
- master lineage, module ownership, default/override separation, filing status, manual-posting permission, system-account status, cash-flow category, tax-treatment reference, VAT behaviour, CIS role, maturity rule, and dimension requirements are not modelled as the supplied design requires.

Journal entries and lines already use surrogate IDs:

- `accounting_journal_entries`
- `accounting_journal_lines`

Journal lines preserve both `account_id` and denormalised `account_code`/`account_name`. This is useful for historical display, but all new joins and mappings must use `account_id`, not code.

Amounts are stored in string columns and some reports ask the database to subtract/sum those columns. A canonical balance service must normalise amounts to `Decimal` and define one tested sign convention at its boundary.

### 3.2 Tenant chart creation

`ensure_native_accounting_client` seeds `DEFAULT_NATIVE_ACCOUNTS` directly into every tenant chart and later adds missing defaults by matching code.

Consequences:

- there is no immutable master chart/version;
- no `master_account_id` lineage is retained;
- master defaults and tenant overrides cannot be distinguished;
- adding a new default automatically adds it to existing tenant charts;
- module activation is not the source of account activation;
- a seed update cannot reliably distinguish “new master default” from “tenant intentionally customised this field.”

### 3.3 Posting controls

`post_native_journal` correctly checks:

- locked/closed accounting periods;
- locked VAT periods for VAT-bearing postings;
- debit/credit presence;
- journal balance;
- analytical location/dimension validity.

However, the generic manual-journal path currently validates only:

- at least two lines;
- nominal code exists;
- non-negative one-sided line values;
- total debits equal total credits;
- VAT code is active.

It does not enforce the supplied requirements for:

- inactive accounts;
- `allow_manual_posting = false`;
- typed control-account ownership;
- required dimensions per account;
- authorised controlled-adjustment exceptions and their audit reason.

System module postings and manual journals also share account objects but do not pass a typed posting authority. This must be explicit before control-account restrictions are enabled.

### 3.4 Trial-balance/report consumers

There are currently three independent trial-balance calculations:

1. `get_gl_trial_balance` for General Ledger;
2. `financial_report_snapshot` for Reports/financial statements;
3. `year_end_trial_balance` for Year End.

Annual Accounts has tables for packs, snapshots, trial-balance lines, mappings, mapping exceptions, outputs, and filings, but no active versioned taxonomy architecture or complete route/service flow was found.

The three calculations differ in date semantics and metadata:

- General Ledger calculates movement for the selected date range.
- The financial-statement snapshot uses period movement for P&L and cumulative-to-date balances for balance-sheet sections, but its embedded “trial balance” uses period movement for every account.
- Year End calculates balances for the selected financial year.
- Financial-statement classification is inferred from nominal name, purpose, account type, category, and special-case codes.
- None aggregates through a stable internal reporting-category ID.
- None excludes memorandum accounts through a typed `statement` field.
- None emits filing-status, mapping-readiness, normal-balance anomaly, sign/maturity decision, or reporting-category drill-down metadata.

There is also a current correctness defect in `get_gl_trial_balance`: the function body references `account_code`, `location_id`, and `dimension_id`, but those parameters are not declared in its signature. The trial-balance upgrade must repair this contract and add a route-level test.

### 3.5 Module readiness

| Supplied module | Current system position | Architecture conclusion |
|---|---|---|
| CORE | AP, AR, Banking, GL, COA, Reports, Audit, Settings, and Year End exist | Ready to consume a typed account configuration, but not currently driven by one |
| VAT | Native VAT tables, settings, codes, periods, returns, adjustments, and posting flows exist | Retain transaction-driven VAT; add typed VAT control ownership and default rule references |
| PAYROLL | UI/backend describe it as a placeholder | Do not activate master payroll accounts until a posting/subledger contract exists |
| CIS | Supplier metadata and deadlines exist, but no complete CIS ledger/subledger module was found | Do not activate CIS accounts until gross/deduction/net posting and reconciliation are implemented |
| FIXED_ASSETS | Register, categories, depreciation, disposals, transfers, revaluations, and journals exist | Strongest specialist-module fit; must map register posting settings to protected account IDs |
| CONSTRUCTION | No native accounting module found | Keep master accounts inactive and unavailable until project/contract dimensions and workflows exist |
| CORPORATION_TAX | Account fields and annual-account placeholders exist, but no versioned tax-treatment engine | Trial balance can expose treatment readiness; computation is later scope |
| ACCOUNTS_PRODUCTION | Annual-account persistence placeholders exist | Must consume reporting-category aggregates, never nominal taxonomy hints directly |

## 4. Critical incompatibilities

### 4.1 Account-code collisions

The supplied chart and the current native defaults do not assign the same meaning to every code.

The most important known collision is:

| Code | Current application meaning | Supplied master meaning | Required handling |
|---|---|---|---|
| 7000 | Bank charges / finance costs | Depreciation expense | Never overwrite in place. Inventory tenant usage, choose a new bank-charge code or tenant mapping, and migrate through an approved journal/mapping plan |
| 7500 | Used in existing demo data as bank charges; workbook marks it legacy duplicate depreciation | Inactive duplicate of 7000 | Treat as tenant/legacy evidence, not a safe global rename |
| 7510 | Special-cased by current reporting as dividend expense/distribution | Inactive legacy P&L dividend account, migrate to 3400 | Preserve history; move future use to equity 3400 after an approved balance migration |
| 3400 | Not part of the currently reviewed native defaults | Dividends paid in equity | Add only through the later versioned master/tenant migration |

Code is therefore a tenant-visible identifier, not stable semantic identity.

### 4.2 Current mapping fields are unsafe for future filing

`accounts_taxonomy_tag` and the equivalent annual-account mapping string can appear to represent a final taxonomy mapping, but the supplied design requires:

- taxonomy package/version;
- entry point;
- exact QName;
- accounting framework;
- role and preferred label;
- period type;
- sign rule;
- dimensions/template;
- effective dates;
- review/approval history.

Existing string fields must be treated as legacy hints during migration. They must not be used to generate an iXBRL fact.

### 4.3 Sign-dependent presentation

The current report classifier assigns assets/liabilities from configured type/category and applies fixed sign inversions. That is insufficient for:

- VAT payable versus recoverable;
- director/related-party balances;
- bank versus overdraft presentation;
- intercompany accounts;
- tax controls;
- maturity-dependent loans and leases.

The ledger balance remains debit-minus-credit. Presentation is a later decision based on closing economic position and, where required, schedules.

### 4.4 Dimensions

The current journal line supports one `location_id` and one `dimension_id`. The workbook requires potentially multiple mandatory dimensions (`Director`, `Related party`, `Employee`, `Project/contract`, `Asset class`, and `Tax computation`).

A single generic `dimension_id` cannot represent multiple simultaneous requirements. The target should use journal-line dimension allocations/values in a junction table. Compatibility fields can remain during migration.

## 5. Target data architecture

Names below are architectural names; final migration names should follow the repository’s `accounting_` convention.

### 5.1 Master/configuration layer

`accounting_coa_versions`

- `id`
- `version_key` (stable, unique)
- `name`
- `effective_from`, `effective_to`
- `status` (`draft`, `approved`, `retired`)
- source workbook hash and import metadata
- created/approved audit fields

`accounting_master_accounts`

- `id` (surrogate primary key)
- `coa_version_id`
- `master_account_key` (stable across idempotent seed imports)
- `code` as `String(10)`
- `name` as `String(150)`
- `module_id`
- `default_active`
- `account_class`
- `account_subtype_id`
- `statement`
- `normal_balance`
- `control_account_type_id` nullable
- `allow_manual_posting`
- `system_account`
- `reporting_category_id` nullable only for pure memorandum accounts
- `statutory_presentation_id` nullable
- `cash_flow_category`
- `default_tax_treatment_id` nullable
- `vat_rule_id` nullable
- `cis_role` nullable
- `current_noncurrent_rule_id` nullable
- `filing_status`
- `suggested_taxonomy_concept` as a hint only
- `implementation_note`
- immutable seed audit metadata

Required uniqueness: `(coa_version_id, code)` and `master_account_key`.

`accounting_modules`

- stable module key and status;
- CORE is always enabled;
- dependencies and owning service;
- activation policy.

`accounting_control_account_types`

- stable typed values such as bank, sales ledger, purchase ledger, VAT, payroll, CIS, and fixed-asset register;
- one primary owner unless an explicit multi-owner rule is introduced.

`accounting_account_subtypes`, `accounting_tax_treatments`, `accounting_vat_rules`, and `accounting_current_noncurrent_rules`

- controlled reference data;
- rules are typed and versionable;
- descriptive workbook text is not executable logic.

`accounting_reporting_categories`

- immutable stable ID/key;
- display name;
- base statement/account class;
- default cash-flow/tax metadata where appropriate;
- never use the display label as the foreign key.

`accounting_statutory_presentations`

- framework/version-specific human presentation;
- references reporting category;
- presentation line/note, ordering, sign and maturity strategy;
- effective dates.

`accounting_master_account_dimension_requirements`

- `master_account_id`
- `dimension_type_key`
- required/optional
- validation timing and effective dates.

### 5.2 Tenant layer

Evolve `accounting_accounts` into the tenant nominal, or migrate it to `accounting_tenant_accounts`.

Required fields:

- existing surrogate `id`;
- `client_id`;
- `master_account_id` nullable for tenant-created accounts;
- `code` as string;
- master description plus optional tenant display-name override;
- `is_active`;
- `reporting_category_id`;
- tenant-selected subtype/control/tax/VAT/presentation overrides only where permitted;
- `override_version`;
- `first_transaction_at`/derived usage guard;
- timestamps.

Required uniqueness: `(client_id, code)`.

Do not copy all master values and then mutate them invisibly. Store tenant override records separately:

`accounting_tenant_account_overrides`

- `id`, `client_id`, `tenant_account_id`;
- typed field name or structured override columns;
- previous/new values;
- effective date;
- reason;
- actor/reviewer/approval;
- version and audit timestamps.

For frequently queried operational fields, a resolved tenant-account projection may be materialised, but the source of truth remains master default plus explicit override.

`accounting_client_modules`

- enabled/status/effective dates;
- activated version;
- validation state;
- required control-account assignments.

`accounting_module_account_assignments`

- client/module/control role;
- tenant account ID;
- effective dates;
- unique primary assignment;
- audit history.

### 5.3 Dimensions

Retain existing location and dimension records during transition, then add:

`accounting_journal_line_dimension_values`

- `journal_line_id`
- `dimension_type_id`
- `dimension_value_id`
- source (`manual`, `document`, `subledger`, `default`)

Unique `(journal_line_id, dimension_type_id)` unless a dimension type explicitly allows multi-value allocation.

Posting validation resolves account requirements and rejects missing mandatory values before a journal is persisted.

### 5.4 Taxonomy layer (later stage)

`accounting_taxonomy_packages`

- package identifier/version;
- source;
- entry points;
- framework;
- effective/accepted periods;
- import hash and status.

`accounting_taxonomy_concepts`

- package ID;
- exact QName;
- data/period/balance types;
- labels and metadata.

`accounting_taxonomy_mappings`

- reporting category ID, not nominal code;
- statutory presentation/framework;
- package and entry point;
- exact concept QName;
- role/preferred label;
- period type;
- sign rule;
- dimension template;
- effective dates;
- status/version;
- preparer/reviewer/approver and audit history.

The generator accepts only an approved, effective mapping record. It refuses `suggested_taxonomy_concept` and legacy `accounts_taxonomy_tag` strings.

## 6. Canonical trial-balance architecture

### 6.1 One service, several views

Introduce a backend domain service such as:

```text
build_trial_balance(query, view)
```

`query`:

- tenant/client ID;
- `as_of` and optional `period_from`;
- financial year or period selector;
- posted/draft policy (default posted only);
- location and dimension filters;
- currency/ledger scope when supported later.

`view`:

- `nominal`: one row per tenant account;
- `reporting_category`: aggregate multiple nominals by stable category;
- `statutory_preview`: later stage only, after sign/maturity resolution.

Consumers:

```text
posted journal lines
        ↓
canonical balance query
        ├── General Ledger Trial Balance (nominal)
        ├── Reports Trial Balance (nominal)
        ├── Year End (nominal + validations)
        └── Annual Accounts snapshot
                ├── nominal drill-down
                └── reporting-category aggregate
```

### 6.2 Balance semantics

Canonical ledger sign:

```text
raw_balance = sum(debit) - sum(credit)
```

Row display:

```text
debit  = max(raw_balance, 0)
credit = max(-raw_balance, 0)
```

Rules:

- use `Decimal`, never binary float;
- aggregate posted journal lines only unless a named preview mode explicitly includes drafts;
- join/group by tenant `account_id`; code/name are display snapshots;
- preserve historical lines for inactive accounts;
- exclude memorandum accounts from statutory trial balance, but allow a separate memorandum report;
- an opposite-to-normal balance is an anomaly, not an automatic reversal;
- nominal trial balance is not the same as a P&L movement report or balance-sheet presentation.

### 6.3 Date modes

Define explicit modes:

- `movement`: entries between `from` and `to`;
- `as_at`: all posted entries through `to`;
- `financial_year`: entries inside the selected year, used for pre-close ledger review;
- `opening`: balances carried into a year;
- `snapshot`: immutable balance result for an annual-accounts pack.

The UI and API must display the selected mode. A balance sheet uses `as_at`; a P&L uses `movement`; a true trial balance for a reporting date normally uses `as_at`. The current financial-report embedded trial balance must stop using P&L-style period movement for all accounts.

### 6.4 Canonical row contract

Nominal row:

```json
{
  "account_id": "uuid",
  "code": "1000",
  "name": "Cash on hand",
  "active": true,
  "account_class": "Asset",
  "statement": "Balance Sheet",
  "normal_balance": "Debit",
  "raw_balance": "1250.00",
  "debit": "1250.00",
  "credit": "0.00",
  "reporting_category_id": "uuid-or-null",
  "reporting_category_name": "Cash and cash equivalents",
  "filing_status": "Ready",
  "mapping_status": "mapped",
  "anomalies": [],
  "journal_line_count": 12
}
```

Summary:

- debit total;
- credit total;
- signed difference;
- balanced flag and fixed tolerance policy;
- zero/non-zero account counts;
- unmapped material balance;
- blocked material balance;
- review material balance;
- memorandum balance excluded;
- abnormal-balance count;
- date mode and resolved dates;
- applied filters.

Reporting-category view:

- reporting category ID/key/name;
- debit, credit, and net balance;
- source nominal count;
- drill-down account IDs/codes;
- mapping/readiness status;
- presentation decisions remain separate.

### 6.5 Sign and maturity resolver

Do not change ledger balances. Resolve presentation using:

1. reporting category;
2. closing raw balance;
3. configured sign rule;
4. maturity/expected-recovery schedule when required;
5. related module/subledger detail;
6. framework-effective statutory presentation.

If required schedule data is absent:

- retain the ledger balance;
- mark the presentation `Review` or `Blocked` according to rule/materiality;
- explain the missing structured evidence;
- never silently choose a permanent section from the account name.

### 6.6 Filing readiness

Create a reusable validation service over a trial-balance snapshot.

Minimum checks:

- debits equal credits;
- every material statutory nominal has a reporting category;
- no material `Blocked` balance (including 9999);
- every material `Review` balance has an approved resolution;
- no memorandum account entered the statutory balance set;
- required sign/maturity evidence is present;
- required dimensions are present;
- duplicate/legacy migration checks (7000/7500/7510);
- taxonomy mapping check is deferred until taxonomy stage.

Materiality must be an explicit, versioned policy. Do not default silently to zero for filing decisions.

## 7. Posting-policy architecture

Every journal creation path must call one policy service before persistence:

```text
authorise_posting(account_id, source_type, posting_authority, dimensions, date)
```

Posting authorities:

- `manual_journal`;
- `module_service:<module>`;
- `controlled_adjustment`;
- `migration`;
- `year_end`;
- `reversal`.

Policy:

- inactive: reject new ordinary/module postings unless an approved migration/reversal rule applies;
- manual posting disabled: reject `manual_journal`;
- control owner: accept only owning module, controlled adjustment, migration, or valid reversal;
- required dimensions: require all account rules effective on posting date;
- system account: prevent delete and restrict deactivation;
- code with transactions: prevent ordinary code change;
- every exception records reason, authority, actor, and immutable audit event.

The UI may filter invalid choices, but the API remains authoritative.

## 8. Migration strategy

### Phase 0 — inventory and freeze decisions

- export each tenant’s account IDs, codes, meanings, mappings, transaction counts, module references, and balances;
- identify code collisions against the supplied master;
- identify tenant customisations currently indistinguishable from defaults;
- record a workbook content hash/version;
- agree accountant-owned decisions for 7000/7500/7510 and other collisions.

No automatic renames or balance journals.

### Phase 1 — trial-balance foundation (this requested next implementation stage)

- add a canonical balance query/service;
- correct General Ledger filter parameters;
- make GL, Reports, and Year End use the same nominal result;
- explicitly support `movement` and `as_at` modes;
- group by account ID and retain nominal drill-down;
- add reporting-category ID as nullable preparatory metadata;
- add statement/memorandum and filing-readiness fields needed by the service;
- add validation summary without enabling filing;
- add contract, integration, and reconciliation tests.

Do not seed/activate the 275 master accounts yet.

### Phase 2 — versioned master and tenant lineage

- create master/configuration tables;
- import all 275 rows idempotently;
- create stable reporting-category records from the 150 displayed labels, with reviewed immutable keys;
- link existing tenant accounts to master rows only after collision review;
- create explicit overrides rather than overwriting master defaults;
- enforce `(client_id, code)` and master version/code uniqueness at database level.

### Phase 3 — module activation and posting protection

- add client module activation;
- assign required control accounts by account ID;
- implement posting authority and required-dimension rules;
- enable only modules whose service/subledger is ready;
- keep payroll, CIS, and construction accounts inactive until their acceptance paths exist.

### Phase 4 — reporting aggregation, sign/maturity, and filing readiness

- enable reporting-category aggregation;
- add sign/maturity resolver;
- add materiality and approval workflow;
- make blocked balances prevent annual-account finalisation;
- persist immutable annual-account snapshots with nominal drill-down.

### Phase 5 — tax and taxonomy

- add versioned tax-treatment overrides;
- import supported taxonomy packages;
- approve exact reporting-category mappings;
- generate facts only from effective approved mappings;
- add golden-file accounts/iXBRL tests.

### Phase 6 — controlled legacy migration

- migrate 7510 to equity account 3400;
- resolve 7000 collision and 7500 duplicate per tenant;
- retain immutable before/after trial balances;
- require accountant approval;
- verify opening/closing equality and audit trace;
- deactivate legacy accounts only after successful reconciliation.

## 9. Trial-balance acceptance criteria for Phase 1

### Core calculation

- identical input/filter sets return identical nominal balances from GL, Reports, and Year End;
- `as_at` includes all posted entries through the reporting date;
- `movement` includes only entries inside the range;
- drafts and voided journals are excluded by default;
- each result groups by account ID;
- debit total equals credit total exactly at currency precision;
- zero-balance policy is explicit and consistent;
- inactive accounts with historical balances remain reportable;
- memorandum balances are identifiable and excluded only from statutory view.

### Filters and drill-down

- date, financial year, period, account, location, and dimension filters are declared in the route contract and tested;
- each trial-balance amount reconciles to its journal-line drill-down;
- reporting-category totals reconcile to their source nominals;
- multiple tenant nominals can aggregate to one reporting category.

### Readiness metadata

- account 9999 with a material balance appears as a blocking reason;
- missing reporting category is reported, not silently inferred;
- normal-balance exceptions are warnings;
- sign/maturity-dependent accounts show unresolved status until the resolver/schedule exists;
- blocked/review totals are included in summary metadata.

### Regression

- AP, AR, Banking, VAT, Fixed Assets, manual journals, reversals, opening balances, and year-end journals still reconcile;
- no live account code is renamed;
- no existing tenant mapping is overwritten;
- the current 7000 meaning is preserved pending controlled migration;
- financial-statement P&L and balance-sheet totals reconcile to canonical balance inputs.

## 10. Traceability to workbook build sequence

| Workbook step | System-specific disposition |
|---|---|
| 1. Database schema | Target schema defined here; implement incrementally, not as extra fields on the current nominal |
| 2. Seed import | Phase 2; all 275 rows, stable key, content version/hash, idempotent |
| 3. Tenant chart creation | Replace direct default-code injection with master lineage and resolved tenant defaults |
| 4. Module activation | Add client modules and typed control assignments; gate unsupported modules |
| 5. Posting protection | Central posting policy with explicit authority; server-side |
| 6. Reporting aggregation | Canonical TB plus reporting-category view and nominal drill-down |
| 7. Sign and maturity | Separate presentation resolver over closing position and schedules |
| 8. Filing readiness | Snapshot validation, materiality, reviewer decisions, blocking reasons |
| 9. Tax treatment | Versioned defaults and overrides; later than TB foundation |
| 10. Taxonomy resolution | Separate packages/concepts/mappings; never nominal hint to QName |
| 11. Module transaction data | Preserve/use VAT and fixed-assets structures; build CIS/payroll/construction before activation |
| 12. Migration and tests | Per-tenant collision plan, approval, before/after TB, golden files |

## 11. Traceability to COA rules

| Rule | Architecture control |
|---|---|
| COA-001 | string code plus `(client_id, code)` uniqueness |
| COA-002 | system/reference usage policy prevents deletion |
| COA-003 | posting policy rejects inactive accounts; canonical TB retains history |
| COA-004 | central server posting policy |
| COA-005 | typed statement and statutory-view exclusion |
| COA-006 | trial-balance readiness validator and materiality policy |
| COA-007 | versioned reviewer resolution |
| COA-008 | immutable reporting-category ID |
| COA-009 | taxonomy hint explicitly non-executable |
| COA-010 | package/framework/effective versioned mapping |
| COA-011 | presentation resolver uses closing economic position |
| COA-012 | maturity/expected-recovery schedules |
| COA-013 | future CIS contractor subledger posting authority |
| COA-014 | future CIS subcontractor structured deduction/reconciliation |
| COA-015 | existing transaction VAT retained; nominal contains only default rule reference |
| COA-016 | existing fixed-asset register remains movement source |
| COA-017 | dimension requirement junction and journal-line dimension values |
| COA-018 | versioned tax adjustment/override |
| COA-019 | controlled 7510-to-3400 migration |
| COA-020 | controlled 7500-to-7000 migration after resolving current 7000 collision |

## 12. Decisions required before implementation

These are accounting/product decisions, not safe coding assumptions:

1. What master-chart version key and approval owner will be used?
2. Is the canonical trial balance expected to default to `as_at` or selected-period movement in the General Ledger UI?
3. What is the filing materiality policy and who can override a `Review` item?
4. How will current tenant code 7000 (bank charges) be migrated without overwriting history?
5. Which replacement code will represent bank charges where 7000 must become depreciation?
6. Is 3200 or another account the long-term retained-earnings standard, and how does that coexist with workbook equity accounts?
7. Which module can authorise each control-account posting, including controlled year-end adjustments?
8. Which dimension types allow multiple values per journal line?
9. Which accounting frameworks and taxonomy packages will be supported first?
10. Must legacy nominal mapping strings remain visible as untrusted migration hints?

None of these decisions should block Phase 1’s canonical trial-balance service, provided Phase 1 does not rename codes, activate new accounts, or generate filing mappings.

## 13. Definition of ready for the next chart-of-accounts stage

The trial-balance upgrade is ready when:

- one canonical service powers all current trial-balance consumers;
- its date and sign semantics are documented and tested;
- balances reconcile to journal-line drill-down;
- account identity is ID-based and code remains display/import metadata;
- inactive and memorandum behaviour is correct;
- reporting-category IDs can be attached and aggregated without losing nominal detail;
- readiness output identifies blocked, review, unmapped, abnormal, and missing-evidence balances;
- no supplied taxonomy hint can reach a filing generator;
- code collisions and legacy migrations remain explicitly quarantined;
- no existing tenant chart or balance has been silently changed.

## 14. Phase 1 implementation record

Implemented:

- canonical `canonical_trial_balance` backend service;
- `movement`, `as_at`, and `financial_year` date modes;
- account-ID aggregation with legacy code fallback diagnostics;
- posted-only balance calculation using decimal database casts;
- account, location, dimension, search, zero-row, and materiality parameters;
- stable nominal row metadata for active status, statement, normal balance, reporting category, filing status, anomalies, and journal-line count;
- readiness-only summary for blocked, review, unmapped, memorandum, and abnormal balances;
- General Ledger route correction for previously undeclared filters;
- financial-report trial balance changed to an as-at balance while P&L remains period movement;
- Year End consumption of the canonical service and visibility of readiness warnings;
- Trial Balance UI now explicitly requests as-at mode and aligns account drill-down with that date basis;
- preparatory tenant-account columns for statement, filing status, and reporting-category ID;
- backend regression coverage for date modes, posted-only behaviour, filters, inactive history, suspense blocking, Reports, and Year End.

Explicitly deferred:

- importing or activating the 275 workbook accounts;
- changing codes 7000, 7500, 7510, or 3400;
- master/tenant lineage tables;
- module activation and posting-authority enforcement;
- reporting-category seed records;
- sign/maturity schedules;
- filing enforcement, tax-treatment versions, taxonomy packages, and iXBRL generation.

## 15. Chart of Accounts source-of-truth update

The tenant Chart of Accounts is now the authoritative source for Trial Balance
classification and downstream mapping. Posted journal lines remain the
authoritative source for monetary balances. This separation prevents Trial
Balance from guessing reporting treatment from account names or code ranges.

The `accounting_accounts` persistence model, account API serializer, create and
update routes, and Chart of Accounts editor now cover all 22 columns in the
workbook's `Master Chart`:

- account identity and display: Account Code, Account Name;
- ownership and activation: Module, Default Active;
- ledger classification: Account Class, Account Subtype, Statement, Normal
  Balance;
- posting protection: Control Account, Allow Manual Posting, System Account;
- reporting and compliance: Internal Reporting Category, Statutory
  Presentation, Cash Flow Category, Default Tax Treatment, VAT Behaviour, CIS
  Role, Requires Dimension, Current / Non-current Rule, Filing Status,
  Suggested Taxonomy Concept, and Implementation Note.

Trial Balance rows expose these COA mappings alongside journal-derived debit and
credit balances. `reporting_category_id` is retained as the stable product-owned
mapping key; the workbook's reporting-category text is display metadata.
Suggested taxonomy concepts remain hints only and cannot be treated as final
filing tags.

This update intentionally does not bulk-create the 275 master accounts or
silently replace tenant mappings. That requires the separately designed
master-chart import, lineage, collision review, and controlled tenant migration.
