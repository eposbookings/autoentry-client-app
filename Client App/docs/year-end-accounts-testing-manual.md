# Year End Accounts - Test Flow Manual

This manual covers the implemented preparation, preview, review and approval
workflow. It stops before live iXBRL generation or submission.

## Important terminology

- **HMRC-supported taxonomy** means HMRC permits that taxonomy version for the
  selected accounting period. It is a technical preparation requirement.
- **HMRC filing accepted** means HMRC has received and accepted an actual
  submission. That status can only be recorded from the HMRC gateway response.
- Selecting a taxonomy must never mark a return or accounts filing as accepted.

## Start the test

1. Select **Demo Account Year-End Accounts**.
2. Open **Year End Accounts**.
3. Open **Overview**.
4. Confirm the pack is editable. Its status should be `draft` or `in_review`,
   not `approved`.

## Complete preparation settings

1. Open **Settings**.
2. Confirm **Responsible staff member** defaults to the accountant currently
   logged into the admin profile.
3. Confirm **Signing director** defaults to the main-contact director held in
   the client's Companies House/client details.
4. Enter the average employee count.
5. Select the appropriate audit exemption or auditor-report basis.
6. Enter the board approval date.
7. Select an FRC accounts taxonomy supported for the accounts period.
8. Select a Corporation Tax computations taxonomy supported for the accounts
   period.
9. Confirm both taxonomy cards show:
   - Supported by HMRC for electronic filing: Yes
   - Valid for selected period: Yes
10. Select **Save preparation settings**.

## Refresh and inspect the statutory accounts

1. Open **Accounts Preview**.
2. Select **Refresh preview from Trial Balance**.
3. Review the profit and loss account.
4. Review the balance sheet.
5. Resolve any disclosure, mapping or Trial Balance exceptions.
6. Return to **Overview** and select **Submit for review**.

## Complete and inspect the HMRC CT600

1. Open **HMRC**.
2. Select **CT600** in the return-type selector.
3. Work through each expandable CT600 page group. The workspace contains more
   than 120 boxes covering company details, attachments and supplementary
   pages, income, deductions, tax calculation, reconciliation, indicators,
   capital allowances, losses, repayments, bank details and declaration.
4. Review fields marked **accounts**, which are prefilled from the client,
   Trial Balance or accounts pack.
5. Complete the applicable manual indicators, reliefs, claims and declaration
   boxes, then select **Save CT600 form options**.
6. Review the CT600-styled preview:
   - company details and return period;
   - attachment indicator;
   - turnover and accounting-profit figures;
   - Corporation Tax amount;
   - declaration details.
7. Treat boxes marked **Tax computation required** or **Review against tax
   computation** as incomplete until the Corporation Tax computation engine is
   implemented and reviewed.
8. Do not treat the taxonomy status as an HMRC acceptance response.

## Inspect the Companies House submission preview

1. Open **Companies House**.
2. Review the statutory-accounts rendering:
   - company name and number;
   - accounts period and reporting standard;
   - profit and loss account;
   - balance sheet;
   - audit basis;
   - board approval and signing director.
3. Confirm this is the human-readable presentation that will later be tagged
   and packaged as iXBRL for software filing.

## Generate draft review artefacts

1. Open **iXBRL & Validation**.
2. Confirm a Trial Balance snapshot exists and both taxonomy selections were
   saved in **Settings**. Merely choosing an option without saving it does not
   update the pack.
3. Select **Generate draft review package**.
4. Download and inspect:
   - the draft Companies House accounts HTML/iXBRL review artefact;
   - the draft CT600 and Corporation Tax computation data artefact.
5. Confirm both downloads are marked `draft_review` and external validation is
   pending. They are review outputs, not gateway-ready submissions.

## Approve and test unapproval

1. Return to **Overview**.
2. Select **Approve accounts** only after the preparation checks and previews
   have been reviewed.
3. Confirm the pack becomes approved and locked.
4. Select the same control again, now labelled **Unapprove accounts**.
5. Read the warning explaining that unapproval creates a new editable version
   and later filing artefacts would need to be regenerated.
6. Confirm the warning to continue editing, or cancel to leave the approved
   version locked.

## Current stopping point

The following are intentionally not part of this test stage:

- final Corporation Tax adjustments and complete CT600 box calculation;
- production-grade comprehensive iXBRL tagging;
- schema, calculation and destination validation;
- HMRC or Companies House credential connection;
- test-service or live submission;
- accepted/rejected filing responses and receipt retention.

Those stages should only be enabled after the previewed figures and approval
workflow have been signed off.
