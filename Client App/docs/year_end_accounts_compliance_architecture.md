# Year End Accounts - compliance and system architecture

Status: authoritative specifications installed; production filing disabled  
Reviewed: 27 July 2026  
Scope: UK limited-company statutory accounts, HMRC Corporation Tax Online, and
Companies House accounts filing.

## 1. Product boundary

The existing **Year End** module closes accounting periods, posts adjustments,
transfers retained earnings, and locks the ledger. The new **Year End Accounts**
module begins after that operational close and prepares a versioned statutory
accounts pack.

The modules must remain separate:

1. Year End finalises the ledger.
2. Chart of Accounts supplies reporting mappings.
3. Year End Accounts freezes an immutable current/comparative snapshot.
4. Accounts production prepares statements, notes and disclosures.
5. Corporation Tax preparation creates the CT600 data model, supplementary-page
   selections and tax computation.
6. A versioned taxonomy service creates and validates destination artefacts.
7. A filing service submits an approved immutable package and retains every
   acknowledgement, rejection and receipt.

## 2. One accounts dataset, two destination packages

HMRC and Companies House consume related accounts information, but they do not
receive the same envelope.

### HMRC Corporation Tax package

The electronic return must support:

- CT600 XML for the period-valid form version;
- all required CT600 supplementary pages;
- statutory accounts in iXBRL;
- Corporation Tax computations in iXBRL;
- required elections and permitted supporting documents;
- declaration, agent/filer identity and gateway credentials;
- HMRC schema, business-rule, taxonomy and Local Test Service validation.

The supplied `ct600.pdf` is CT600 (2026) Version 3, 12 pages. It is a visual
reference and contains no AcroForm fields. It must not be filled or submitted as
the electronic return. Its numbered boxes are represented in a versioned data
model which is later serialised using the period-valid HMRC RIM/XML artefacts.

### Companies House package

The package must support:

- the legally applicable accounts type and filing exemptions;
- statutory accounts rendered and tagged in iXBRL;
- company identity, period and accounting framework;
- director approval and balance-sheet signature statements;
- Companies House presenter credentials and company authentication;
- gateway validation, polling and accepted/rejected receipts.

As at the review date, software filing uses the Companies House XML gateway.
Companies House has announced software-only iXBRL accounts filing for all UK
companies from 1 April 2028. The design therefore treats iXBRL as the target
format while retaining destination-version configuration.

## 3. Required workflow

Statuses must be explicit and destination-specific:

`Draft -> Mapping review -> Disclosure review -> Tax review -> Director review
-> Approved -> Generated -> Validated -> Ready to submit -> Submitted ->
Accepted/Rejected`

An approval is tied to an immutable snapshot hash. Any change to ledger data,
mapping, narrative, taxonomy, computation, form response or destination
metadata invalidates approval and creates a new version.

## 4. Financial statement preparation

The preview must eventually cover, subject to entity type and framework:

- cover and company information;
- directors' report and strategic report where legally applicable;
- accountant's or auditor's report where applicable;
- profit and loss account;
- balance sheet;
- statement of changes in equity;
- cash-flow statement where applicable;
- accounting policies;
- statutory notes and detailed profit and loss;
- current and comparative figures;
- approval and signature wording.

Statements aggregate stable internal reporting-category IDs, not nominal names
or guessed code ranges. Sign-changing and maturity-dependent balances require
typed rules. Material balances on Blocked, Review or unmapped accounts prevent
generation.

## 5. CT600 model

The supplied form is represented in sections:

- boxes 1-90: company information, return period and return indicators;
- boxes 95-144 and box 96: supplementary-page selection;
- boxes 145-325: income, gains, deductions and reliefs;
- boxes 326-615: Corporation Tax calculation and reconciliation;
- boxes 616-855: indicators, capital allowances and losses;
- boxes 856-985: repayments, bank details, authority and declaration.

Every value needs:

- form version and box number;
- typed value and currency/precision;
- source (ledger, tax rule, manual answer, external register);
- derivation or formula;
- preparer/reviewer and timestamps;
- validation messages;
- override reason and audit history.

Long accounts periods may contain more than one Corporation Tax accounting
period and therefore need separate computations while remaining linked to the
accounts period.

## 6. Taxonomy architecture

Never store one permanent QName on a nominal account.

Required versioned records:

- taxonomy package and entry point;
- authority and accepted-from/to dates;
- framework and entity/accounts type;
- concept QName, label role and preferred label;
- period type, balance/sign rule and decimals;
- dimensions and members;
- reporting-category mapping and effective dates;
- destination and validation-rule version.

The Chart of Accounts `Suggested Taxonomy Concept` remains a semantic hint.
Generation resolves stable reporting categories through the active, approved
taxonomy mapping version.

## 7. Validation gates

Generation remains blocked until:

- financial year and comparative period are correct;
- Trial Balance balances and every material balance is mapped;
- suspense and filing-blocked balances are cleared;
- statements cross-cast and reconcile to the snapshot;
- required disclosures and dimensions are present;
- tax computation reconciles to the accounts tax charge;
- CT600 calculations and supplementary-page rules pass;
- director approval and declaration data are complete;
- an accepted taxonomy version is selected;
- XHTML, XML, iXBRL, schema, calculation and dimension validation pass;
- HMRC Local Test Service or Companies House test/validation succeeds;
- filing credentials are connected and separately authorised.

Browser preview and PDF rendering are presentation checks only. They do not
prove iXBRL or gateway validity.

## 8. Implemented foundation

- new `Year End Accounts` navigation module;
- destination-specific Overview, Accounts Preview, HMRC CT600, Companies House,
  iXBRL & Validation, Submissions and Settings tabs;
- backend preparation workspace built from the canonical Trial Balance;
- readiness and blocker output from COA mappings, client identity, credentials,
  taxonomy and validation state;
- CT600 section inventory matching the supplied 2026 Version 3 form;
- existing versioned pack, snapshot, TB-line, mapping, content, output, filing,
  CT600, computation and supplementary-page persistence recognised by the
  workspace;
- iXBRL generation button visibly gated until the generator and validators are
  implemented.
- HMRC CT600 V3 (2026) V1.994 official XSD, envelope XSD, Schematron,
  specification and renderer artefacts installed with SHA-256 provenance;
- Companies House accounts TIS 5.9 installed as the current software-filing
  contract;
- a runtime compliance registry reports exact authority, release, source URL,
  installed artefacts and mandatory release gates;
- no destination can report `Ready` and no production filing can be generated
  while any release gate is unpassed.

## 8.1 Operational preparation workflow

The module now supports:

1. creating one accounts pack per financial year;
2. selecting the accounting standard, accounts regime and trading status;
3. recording average employees, audit basis, responsible staff, signing
   director and approval date;
4. automatically selecting the preceding financial year as the comparative
   period when available;
5. creating versioned current and comparative snapshots from the canonical
   Trial Balance;
6. copying every nominal balance and its COA reporting metadata into immutable
   snapshot/TB-line records;
7. creating mapping exceptions for material unmapped balances;
8. aggregating statement previews by COA statutory-presentation mapping and
   excluding memorandum accounts;
9. validating balance, filing status, mapping completeness, company identity,
   selected regime thresholds, employee count, audit basis and approval data;
10. submitting a snapshot for review, approving and locking it, or reopening it
    as a new version;
11. retaining snapshot hashes, versions and audit events.

This produces reviewable financial-statement reports from the Trial Balance. It
does not yet claim that those reports are complete statutory accounts: the
disclosure/narrative engine and taxonomy-backed document generator remain the
next controlled stage.

## 9. Back-engineered implementation sequence

The accepted reference return and accounts define regression outcomes, while
the official machine-readable specifications define correctness. Work proceeds
backwards from those outcomes:

1. **Submission receipts:** persist GovTalk correlation IDs, IRmark, gateway
   acknowledgements, acceptance/rejection payloads, timestamps and the exact
   submitted package hash.
2. **Destination envelopes:** implement separate HMRC CT and Companies House
   GovTalk envelopes, authentication, polling and error-code mapping from the
   current technical specifications.
3. **Executable validation:** validate CT XML against HMRC V1.994 XSD and
   Schematron; validate accounts/computations against XBRL 2.1, Dimensions 1.0,
   Inline XBRL 1.1, active taxonomy packages, generic-dimension rules and joint
   filing checks.
4. **Deterministic generation:** produce CT600 and supplementary-page XML,
   accounts iXBRL and computations iXBRL from one approved immutable dataset.
   Visible text, tagged facts and submitted facts must be equivalent.
5. **Disclosure and tax rule engines:** determine applicable statutory
   statements/notes, accounts regime, audit basis, CT adjustments, losses,
   capital allowances, associated companies and supplementary pages.
6. **Source schedules:** reconcile every generated fact and form value to a
   Trial Balance mapping, tax schedule, statutory record or explicit reviewed
   answer, with provenance and override history.

The supplied accepted CT600 PDF and filed iXBRL accounts are golden regression
fixtures for content, pagination/rendering and tagging coverage. They do not
replace the official XSD, Schematron, taxonomy or destination test services.

## 10. Deliberately not implemented yet

- final statutory statement templates and disclosure rule engine;
- comparative snapshot generation;
- tax adjustment, loss, capital-allowance and supplementary-page engines;
- taxonomy package importer and versioned reporting-category mappings;
- iXBRL context/fact/document generation;
- HMRC RIM/XML serializer and Local Test Service connection;
- Companies House software-filing gateway submission;
- production credentials, approval signatures and live submission;
- PDF as a filing substitute.

These are compliance features, not UI formatting tasks, and require
destination test credentials plus golden-file validation packs before release.

## 11. Official references

- HMRC Corporation Tax developer collection:
  https://www.gov.uk/government/collections/corporation-tax-online-support-for-software-developers
- HMRC XBRL/iXBRL technical specifications:
  https://www.gov.uk/government/publications/corporation-tax-technical-specifications-xbrl-and-ixbrl
- HMRC accepted taxonomies:
  https://www.gov.uk/government/publications/taxonomies-accepted-by-hm-revenue-and-customs
- XBRL guide for UK businesses:
  https://www.gov.uk/government/publications/xbrl-guide-for-uk-businesses/xbrl-guide-for-uk-businesses
- Companies House accounts guidance:
  https://www.gov.uk/government/publications/life-of-a-company-annual-requirements/life-of-a-company-part-1-accounts
- Companies House software filing:
  https://resources.companieshouse.gov.uk/toolsToHelp/efiling.shtml
- Companies House accounts TIS 5.9:
  https://www.gov.uk/government/publications/technical-interface-specifications-for-companies-house-software
- Companies House iXBRL validator:
  https://find-and-update.company-information.service.gov.uk/xbrl_validate
