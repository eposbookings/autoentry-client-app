import inspect
import io

from backend import server
from pypdf import PdfReader


def test_year_end_accounts_workspace_route_is_registered():
    matching = [
        route
        for route in server.api.routes
        if getattr(route, "path", "") == "/api/admin/accounting/clients/{client_id}/year-end-accounts/workspace"
    ]

    assert len(matching) == 1
    assert "GET" in matching[0].methods
    assert {"client_id", "user", "session"} <= set(inspect.signature(server.get_year_end_accounts_workspace).parameters)


def test_year_end_accounts_operational_routes_are_registered():
    paths = {getattr(route, "path", ""): getattr(route, "methods", set()) for route in server.api.routes}
    base = "/api/admin/accounting/clients/{client_id}/year-end-accounts/packs"

    assert "POST" in paths[base]
    assert "PUT" in paths[f"{base}/{{pack_id}}"]
    assert "POST" in paths[f"{base}/{{pack_id}}/snapshot"]
    assert "POST" in paths[f"{base}/{{pack_id}}/generate-preview"]
    assert "POST" in paths[f"{base}/{{pack_id}}/action"]
    assert "DELETE" in paths[f"{base}/{{pack_id}}/outputs"]
    assert "DELETE" in paths["/api/admin/accounting/clients/{client_id}/year-end-accounts/outputs/{output_id}"]
    assert "GET" in paths[f"{base}/{{pack_id}}/ct600.pdf"]


def test_native_ct600_pdf_maps_system_values_into_editable_fields():
    form = {
        "sections": [{"fields": [
            {"box": "1", "value": "Example Limited"},
            {"box": "2", "value": "12345678"},
            {"box": "30", "value": "2025-10-01"},
            {"box": "40", "value": True},
            {"box": "90", "value": "Accounts cover a different period"},
            {"box": "145", "value": "14786"},
            {"box": "975", "value": "Olivia Morgan"},
            {"box": "980", "value": "2026-07-27"},
            {"box": "985", "value": "Director"},
        ]}],
    }

    reader = PdfReader(io.BytesIO(server.ct600_fillable_pdf_bytes(form)))
    fields = reader.get_fields()

    assert len(reader.pages) == 12
    assert len(fields) == 2235
    assert fields["p01_text_000"]["/V"] == "Example Limited"
    assert "".join(fields[f"p01_text_{index:03d}"]["/V"] for index in range(1, 9)) == "12345678"
    assert "".join(fields[f"p01_text_{index:03d}"]["/V"] for index in range(25, 33)) == "01102025"
    assert fields["p01_check_041"]["/V"] == "/Yes"
    assert fields["box90_explanation"]["/V"] == "Accounts cover a different period"
    assert "".join(fields[f"p02_text_{index:03d}"]["/V"] for index in range(17, 35)).strip() == "14786"
    assert fields["p12_declaration_name_975"]["/V"] == "Olivia Morgan"
    assert "".join(fields[f"p12_text_{index:03d}"]["/V"] for index in range(35, 43)) == "27072026"
    assert fields["p12_declaration_status_985"]["/V"] == "Director"


def test_ct600_preview_pdf_marks_every_widget_read_only():
    reader = PdfReader(io.BytesIO(server.ct600_fillable_pdf_bytes(
        {"sections": [{"fields": [{"box": "1", "value": "Example Limited"}]}]},
        read_only=True,
    )))
    widgets = [
        annotation.get_object()
        for page in reader.pages
        for annotation in (page.get("/Annots") or [])
        if annotation.get_object().get("/Subtype") == "/Widget"
    ]

    assert widgets
    assert all(int(widget.get("/Ff") or 0) & 1 for widget in widgets)


def test_ct600_field_constraints_cover_identifiers_numbers_and_dates():
    assert server.ct600_field_constraint("2", "text")["max_length"] == 8
    assert server.ct600_field_constraint("3", "text")["placeholder"] == "10 digits"
    assert server.ct600_field_constraint("145", "money")["decimal_places"] == 2
    assert server.ct600_field_constraint("340", "percentage")["maximum"] == 100
    assert server.ct600_field_constraint("330", "integer")["max_length"] == 4
    assert server.ct600_field_constraint("30", "date")["placeholder"] == "YYYY-MM-DD"


def test_ct600_field_constraint_validation_rejects_invalid_values():
    for box, value, field_type in [
        ("2", "123456789", "text"),
        ("145", "123.456", "money"),
        ("340", "101", "percentage"),
        ("330", "20261", "integer"),
        ("30", "30/04/2026", "date"),
    ]:
        try:
            server.validate_ct600_submitted_value(box, value, field_type)
        except ValueError:
            continue
        raise AssertionError(f"Expected box {box} value {value!r} to be rejected")


def test_annual_accounts_statement_rows_preserve_statutory_order():
    rows = server.annual_accounts_statement_rows(
        {"turnover": "100.00", "gross_profit": "60.00", "profit_after_tax": "40.00"},
        [
            ("turnover", "Turnover"),
            ("gross_profit", "Gross profit"),
            ("profit_after_tax", "Profit for the financial year"),
        ],
    )

    assert [row["key"] for row in rows] == ["turnover", "gross_profit", "profit_after_tax"]
    assert rows[-1]["amount"] == "40.00"
    assert all("comparative" in row for row in rows)


def test_statutory_preview_aggregates_trial_balance_by_coa_mapping():
    current = [
        {"name": "Sales A", "account_class": "Income", "statement": "profit_and_loss", "raw_balance": "-100.00", "statutory_presentation": "Turnover"},
        {"name": "Sales B", "account_class": "Income", "statement": "profit_and_loss", "raw_balance": "-50.00", "statutory_presentation": "Turnover"},
        {"name": "Bank", "account_class": "Asset", "statement": "balance_sheet", "raw_balance": "150.00", "statutory_presentation": "Cash at bank and in hand"},
        {"name": "Tax memo", "account_class": "Memorandum", "statement": "memorandum", "raw_balance": "999.00", "statutory_presentation": "Tax memorandum"},
    ]
    comparative = [
        {"name": "Sales", "account_class": "Income", "statement": "profit_and_loss", "raw_balance": "-120.00", "statutory_presentation": "Turnover"},
        {"name": "Bank", "account_class": "Asset", "statement": "balance_sheet", "raw_balance": "120.00", "statutory_presentation": "Cash at bank and in hand"},
    ]

    preview = server.annual_accounts_preview_from_trial_balance(current, comparative)

    assert preview["profit_and_loss_rows"][0]["label"] == "Turnover"
    assert preview["profit_and_loss_rows"][0]["amount"] == "150.00"
    assert preview["profit_and_loss_rows"][0]["comparative"] == "120.00"
    assert preview["balance_sheet_rows"][0]["amount"] == "150.00"
    assert all(row["label"] != "Tax memorandum" for row in preview["profit_and_loss_rows"] + preview["balance_sheet_rows"])


def test_non_dormant_pack_cannot_treat_an_empty_trial_balance_as_ready():
    issues = server.annual_accounts_pack_validation(
        {
            "period_from": "2026-01-01",
            "period_to": "2026-12-31",
            "accounts_standard": "FRS_102",
            "accounts_format": "full",
            "audit_exemption": "Audited accounts",
            "director_signing_name": "A Director",
            "board_approval_date": "2027-01-31",
        },
        {"company_number": "01234567"},
        {"balanced": True, "account_count": 0},
    )

    assert "trial_balance_empty" in {issue["code"] for issue in issues}


def test_directors_are_derived_from_client_profile_without_duplicates():
    directors = server.annual_accounts_directors({
        "company_directors": '[{"name":"Olivia Morgan","role":"Director","appointed_on":"2022-07-01"}]',
        "main_contact_name": "Olivia Morgan",
        "main_contact_role": "Director",
    })

    assert directors == [{
        "id": "client-main-contact",
        "name": "Olivia Morgan",
        "role": "Director",
        "appointed_on": None,
    }]


def test_taxonomy_selection_checks_hmrc_acceptance_and_accounts_period():
    selection = server.annual_accounts_taxonomy_selection({
        "period_from": "2025-07-01",
        "period_to": "2026-06-30",
        "details": {
            "accounts_taxonomy": "FRC-2026",
            "computations_taxonomy": "CT-COMP-2025",
        },
    })

    assert selection["ready"] is True
    assert selection["accounts"]["hmrc_accepted"] is True
    assert selection["accounts"]["period_valid"] is True
    assert selection["computations"]["period_valid"] is True


def test_expired_taxonomy_is_not_period_valid():
    selection = server.annual_accounts_taxonomy_selection({
        "period_from": "2025-07-01",
        "period_to": "2026-06-30",
        "details": {
            "accounts_taxonomy": "FRC-2026",
            "computations_taxonomy": "CT-COMP-2024",
        },
    })

    assert selection["ready"] is False
    assert selection["computations"]["hmrc_accepted"] is True
    assert selection["computations"]["period_valid"] is False


def test_draft_ixbrl_preview_has_submission_structure_and_visible_warning():
    rendered = server.annual_accounts_ixbrl_preview_html(
        {
            "business_name": "Example Limited",
            "company_number": "01234567",
            "registered_office_address": "1 Example Street",
            "industry": "Consultancy",
        },
        {
            "period_from": "2025-01-01",
            "period_to": "2025-12-31",
            "comparative_period_from": "2024-01-01",
            "comparative_period_to": "2024-12-31",
            "accounts_standard": "FRS_102_1A",
            "audit_exemption": "audit_exempt_small_company",
            "director_signing_name": "A Director",
            "board_approval_date": "2026-02-01",
            "details": {"employee_count": 2, "accounts_taxonomy": "FRC-2026"},
        },
        {
            "profit_and_loss_rows": [{"key": "turnover", "label": "Turnover", "amount": "100.00", "comparative": "90.00"}],
            "balance_sheet_rows": [{"key": "assets", "label": "Total assets", "amount": "50.00", "comparative": "40.00"}],
            "detailed_profit_and_loss_rows": [{"label": "4000 - Sales", "amount": "100.00"}],
        },
    )

    assert "DRAFT REVIEW ARTEFACT - NOT VALIDATED OR FILED" in rendered
    assert "<link:schemaRef" in rendered
    assert '<xbrli:context id="CurrentDuration">' in rendered
    assert '<xbrli:context id="ComparativeDuration">' in rendered
    assert "<ix:nonFraction" in rendered
    assert "Director's report" in rendered
    assert "Detailed profit and loss account" in rendered


def test_accounts_production_download_uses_the_ten_page_reference_structure():
    rendered = server.annual_accounts_production_preview_html(
        {
            "business_name": "Example Limited",
            "company_number": "01234567",
            "registered_office_address": "1 Example Street",
        },
        {
            "period_from": "2025-01-01",
            "period_to": "2025-12-31",
            "comparative_period_from": "2024-01-01",
            "comparative_period_to": "2024-12-31",
            "director_signing_name": "A Director",
            "board_approval_date": "2026-02-01",
            "details": {"employee_count": 2, "accounts_taxonomy": "FRC-2026"},
        },
        {
            "accountants": "Example Accountants",
            "accounts_standard": "FRS 102 Section 1A",
            "approval": {"audit_basis": "Audit exempt"},
            "section_options": [
                {"id": item, "enabled": True}
                for item in (
                    "cover", "contents", "company_information", "directors_report",
                    "profit_and_loss", "balance_sheet", "detailed_profit_and_loss",
                )
            ],
            "profit_and_loss_rows": [{"key": "turnover", "label": "Turnover", "amount": "100", "comparative": "90"}],
            "balance_sheet_rows": [{"key": "assets", "label": "Total assets", "amount": "50", "comparative": "40"}],
            "detailed_profit_and_loss_rows": [{"label": "Sales", "amount": "100"}],
            "notes": [{"number": str(index), "title": f"Note {index}", "body": "Body"} for index in range(1, 9)],
        },
    )

    assert "ANNUAL REPORT AND UNAUDITED ACCOUNTS" in rendered
    assert "DIRECTOR&apos;S REPORT" in rendered
    assert "INCOME STATEMENT" in rendered
    assert "STATEMENT OF FINANCIAL POSITION" in rendered
    assert "DETAILED PROFIT AND LOSS ACCOUNT" in rendered
    assert "- 10 -" in rendered
    assert "<ix:nonFraction" in rendered


def test_accounts_production_ixbrl_is_well_formed_and_uses_standard_entry_point():
    client = {
        "business_name": "Example Limited",
        "company_number": "01234567",
        "registered_office_address": "1 Example Street",
    }
    pack = {
        "period_from": "2025-05-01",
        "period_to": "2026-04-30",
        "comparative_period_from": "2024-05-01",
        "comparative_period_to": "2025-04-30",
        "accounts_standard": "FRS_105",
        "accounts_format": "micro",
        "company_trading_status": "trading",
        "audit_exemption": "audit_exempt_small_company",
        "director_signing_name": "A Director",
        "board_approval_date": "2026-07-31",
        "details": {"employee_count": 2, "accounts_taxonomy": "FRC-2026"},
    }
    defaults = server.annual_accounts_section_defaults(pack)
    preview = {
        "accountants": "Example Accountants",
        "accounts_standard": "FRS 105",
        "approval": {"audit_basis": "Audit exempt"},
        "section_options": [
            {"id": key, "enabled": value["enabled"], "required": value["required"]}
            for key, value in defaults.items()
        ],
        "profit_and_loss_rows": [
            {"key": "turnover", "label": "Turnover", "amount": "100", "comparative": "90"},
            {"key": "profit_after_tax", "label": "Profit", "amount": "-20", "comparative": "10"},
        ],
        "balance_sheet_rows": [
            {"key": "assets", "label": "Assets", "amount": "50", "comparative": "40"},
            {"key": "equity", "label": "Equity", "amount": "50", "comparative": "40"},
        ],
        "detailed_profit_and_loss_rows": [],
        "notes": [{"number": "1", "title": "Basis", "body": "Prepared under FRS 105."}],
    }

    rendered = server.annual_accounts_production_preview_html(client, pack, preview)
    validation = server.annual_accounts_ixbrl_local_validation(rendered, client, pack, preview)

    assert validation["passed"] is True
    assert validation["checks"]["xml_well_formed"] is True
    assert validation["checks"]["schema_reference_matches_standard"] is True
    assert 'sign="-">20</ix:nonFraction>' in rendered


def test_ifrs_accounts_use_the_ifrs_taxonomy_entry_point():
    assert "/IFRS/2026-01-01/IFRS-2026-01-01.xsd" in server.annual_accounts_taxonomy_entry_point({
        "accounts_standard": "IFRS",
        "details": {"accounts_taxonomy": "FRC-2026"},
    })


def test_dormant_and_small_filing_copy_defaults_omit_inapplicable_sections():
    dormant = server.annual_accounts_section_defaults({
        "accounts_format": "dormant",
        "company_trading_status": "dormant",
    })
    small = server.annual_accounts_section_defaults({
        "accounts_format": "small_full",
        "company_trading_status": "trading",
    })

    assert dormant["balance_sheet"]["enabled"] is True
    assert dormant["profit_and_loss"]["enabled"] is False
    assert dormant["directors_report"]["enabled"] is False
    assert small["directors_report"]["enabled"] is False
    assert small["detailed_profit_and_loss"]["enabled"] is False


def test_local_ixbrl_validation_blocks_unmodelled_full_accounts_disclosures():
    client = {"business_name": "Example Limited", "company_number": "01234567"}
    pack = {
        "period_from": "2025-05-01",
        "period_to": "2026-04-30",
        "comparative_period_from": "2024-05-01",
        "comparative_period_to": "2025-04-30",
        "accounts_standard": "IFRS",
        "accounts_format": "full",
        "company_trading_status": "trading",
        "details": {"employee_count": 20, "accounts_taxonomy": "FRC-2026"},
    }
    defaults = server.annual_accounts_section_defaults(pack)
    preview = {
        "section_options": [
            {"id": key, "enabled": value["enabled"], "required": value["required"]}
            for key, value in defaults.items()
        ],
        "profit_and_loss_rows": [{"key": "turnover", "label": "Turnover", "amount": "100", "comparative": "90"}],
        "balance_sheet_rows": [{"key": "assets", "label": "Assets", "amount": "50", "comparative": "40"}],
        "notes": [{"number": "1", "title": "Basis", "body": "IFRS"}],
    }
    rendered = server.annual_accounts_production_preview_html(client, pack, preview)

    validation = server.annual_accounts_ixbrl_local_validation(rendered, client, pack, preview)

    assert validation["passed"] is False
    assert "full_accounts_disclosures_incomplete" in {issue["code"] for issue in validation["issues"]}


def test_ct600_form_model_covers_all_twelve_page_subject_areas():
    section_ids = {section["id"] for section in server.CT600_FORM_SECTIONS}
    boxes = {
        box
        for section in server.CT600_FORM_SECTIONS
        for box, _label, _field_type in section["fields"]
    }

    assert {
        "company_return", "attachments", "income", "deductions",
        "tax_calculation", "tax_payable", "indicators", "capital_allowances",
        "losses", "repayments", "bank_declaration",
    } <= section_ids
    assert {"1", "80", "145", "315", "600", "690", "780", "920", "985"} <= boxes
    assert len(boxes) >= 120
    assert len(server.CT600_OFFICIAL_PRINT_PAGES) == 12
    printed_boxes = {box for page in server.CT600_OFFICIAL_PRINT_PAGES for box in page}
    assert {"5", "8", "172", "350", "501", "586", "647", "713", "733", "850", "886", "943", "986", "987"} <= printed_boxes


def test_limited_company_ct600_profile_defers_supplementary_page_selectors():
    visible = set(server.CT600_LIMITED_COMPANY_VISIBLE_BOXES)
    deferred = server.CT600_SUPPLEMENTARY_SELECTION_BOXES

    assert {"1", "2", "3", "30", "35", "80", "90", "145", "315", "430", "600", "975", "980", "985"} <= visible
    assert {"95", "96", "100", "105", "115", "142", "144"} <= deferred
    assert not visible.intersection(deferred)


def test_ct600_editor_uses_subject_sections_without_changing_pdf_pages():
    section_titles = [title for _section_id, title, _boxes in server.CT600_EDITOR_SECTION_GROUPS]
    grouped_boxes = {
        box
        for _section_id, _title, boxes in server.CT600_EDITOR_SECTION_GROUPS
        for box in boxes
    }

    assert section_titles[:6] == [
        "Company information",
        "Northern Ireland",
        "About this return",
        "Tax calculation",
        "Income",
        "Chargeable gains",
    ]
    assert {"1", "5", "30", "145", "210", "326", "985"} <= grouped_boxes
    assert len(server.CT600_OFFICIAL_PRINT_PAGES) == 12


def test_fy2026_supported_accounts_configuration_matrix_has_no_conflicts():
    supported = [
        ("FRS_105", "micro", "trading"),
        ("FRS_105", "micro", "non_trading"),
        ("FRS_102_1A", "small_full", "trading"),
        ("FRS_102_1A", "small_full", "non_trading"),
        ("FRS_102", "small_full", "trading"),
        ("FRS_102", "full", "trading"),
        ("FRS_102", "full", "non_trading"),
        ("IFRS", "full", "trading"),
        ("IFRS", "full", "non_trading"),
        ("FRS_105", "dormant", "dormant"),
        ("FRS_102_1A", "dormant", "dormant"),
        ("FRS_102", "dormant", "dormant"),
    ]

    assert all(not server.annual_accounts_configuration_issues(*variant) for variant in supported)


def test_incompatible_accounts_configurations_are_rejected():
    unsupported = [
        ("FRS_105", "full", "trading"),
        ("FRS_102_1A", "micro", "trading"),
        ("IFRS", "small_full", "trading"),
        ("IFRS", "dormant", "dormant"),
        ("FRS_102", "dormant", "trading"),
        ("FRS_102", "full", "dormant"),
    ]

    assert all(server.annual_accounts_configuration_issues(*variant) for variant in unsupported)


def test_trial_balance_totals_populate_connected_ct600_calculation_boxes():
    values = server.annual_accounts_ct600_auto_values(
        {"business_name": "Example Limited", "company_number": "01234567", "utr": "1234567890"},
        {
            "period_from": "2025-05-01",
            "period_to": "2026-04-30",
            "company_trading_status": "trading",
            "director_signing_name": "A Director",
            "board_approval_date": "2026-07-31",
        },
        {"turnover": "250000.00", "profit_before_tax": "50000.00", "tax_on_profit": "12500.00"},
    )

    assert values["145"] == "250000.00"
    assert values["155"] == values["165"] == values["235"] == values["300"] == values["315"] == "50000.00"
    assert values["430"] == values["440"] == values["475"] == values["510"] == values["525"] == values["528"] == values["600"] == "12500.00"
    assert values["150"] is False
    assert values["975"] == "A Director"


def test_dormant_ct600_profile_zeros_financial_boxes_and_marks_no_turnover():
    values = server.annual_accounts_ct600_auto_values(
        {"business_name": "Dormant Limited"},
        {
            "period_from": "2025-05-01",
            "period_to": "2026-04-30",
            "company_trading_status": "dormant",
        },
        {"turnover": "999.00", "profit_before_tax": "100.00", "tax_on_profit": "25.00"},
    )

    assert values["80"] is False
    assert values["145"] == values["315"] == values["600"] == "0.00"
    assert values["150"] is True
    assert "dormant" in values["90"].lower()


def test_ct600_trial_balance_and_tax_chain_route_to_native_pdf_rows():
    expected_routes = {
        "295": "p04_text_056",
        "300": "p04_text_067",
        "305": "p04_text_078",
        "315": "p04_text_111",
        "430": "p05_text_000",
        "440": "p05_text_026",
        "470": "p05_text_080",
        "475": "p05_text_167",
        "510": "p06_text_052",
        "525": "p06_text_091",
        "528": "p06_text_130",
        "595": "p07_text_065",
        "600": "p07_text_078",
        "605": "p07_text_091",
    }

    for box, first_field in expected_routes.items():
        assert server.CT600_NATIVE_PDF_FIELD_MAP[box][0] == first_field
    assert server.CT600_NATIVE_PDF_FIELD_MAP["616"] == ["p07_check_143"]
    assert server.CT600_NATIVE_PDF_FIELD_MAP["618"] == ["p07_check_145"]


def test_ct600_printable_draft_has_form_pages_computation_and_no_fake_receipt():
    rendered = server.annual_accounts_ct600_preview_html(
        {"business_name": "Example Limited"},
        {"period_from": "2025-01-01", "period_to": "2025-12-31"},
        {
            "version": "CT600 (2026) Version 3",
            "sections": [
                {"id": "company", "title": "Company information", "fields": [
                    {"box": "1", "label": "Company name", "type": "text", "value": "Example Limited"},
                    {"box": "40", "label": "Repayment due", "type": "boolean", "value": False},
                ]},
            ],
        },
        {"title": "Example Limited - Computation", "profit_before_tax": "100.00", "status": "Review"},
    )

    assert "CT600 (2026) Version 3" in rendered
    assert "Corporation Tax computation" in rendered
    assert "no IRmark or HMRC receipt exists until submission" in rendered
    assert "HMRC Submission Response" not in rendered
    assert "official-page" in rendered
    assert 'title="Box 1: Company name"' in rendered
    assert 'class="overlay"' in rendered


def test_year_end_accounts_schema_supports_immutable_outputs_and_receipts():
    pack_columns = set(server.accounting_annual_accounts_packs.c.keys())
    output_columns = set(server.accounting_annual_accounts_outputs.c.keys())
    filing_columns = set(server.accounting_annual_accounts_filings.c.keys())
    model_columns = set(server.accounting_filing_domain_models.c.keys())

    assert {"version_number", "locked_snapshot", "approved_by", "companies_house_submission_status", "hmrc_submission_status"} <= pack_columns
    assert {"snapshot_id", "output_type", "format", "validation_json"} <= output_columns
    assert {"destination", "status", "package_json", "receipt_reference", "receipt_json", "filed_at", "filed_by"} <= filing_columns
    assert {"snapshot_id", "schema_version", "model_json", "model_hash", "support_level"} <= model_columns


def test_ct600_form_is_projected_from_one_filing_domain_model():
    client = {
        "id": "client-1",
        "client_type": "limited_company",
        "business_name": "Example Limited",
        "company_number": "12345678",
        "utr": "1234567890",
    }
    pack = {
        "id": "pack-1",
        "period_from": "2025-05-01",
        "period_to": "2026-04-30",
        "accounts_standard": "FRS_102_1A",
        "accounts_format": "small_full",
        "company_trading_status": "trading",
        "audit_exemption": "audit_exempt_small_company",
    }
    form = {"sections": [{"fields": [
        {"box": "1", "type": "text", "value": "Example Limited", "source": "accounts"},
        {"box": "2", "type": "text", "value": "12345678", "source": "accounts"},
        {"box": "35", "type": "date", "value": "2026-04-30", "source": "accounts"},
        {"box": "145", "type": "money", "value": "100000.00", "source": "accounts"},
    ]}]}
    preview = {
        "profit_and_loss_rows": [
            {"key": "turnover", "label": "Turnover", "amount": "100000.00", "comparative": "90000.00"},
        ],
        "balance_sheet_rows": [
            {"key": "net_assets", "label": "Net assets", "amount": "50000.00", "comparative": "40000.00"},
        ],
    }
    model = server.build_filing_domain_model(
        client,
        pack,
        "snapshot-1",
        [{"account_code": "4000", "balance": "-100000.00", "period_kind": "current"}],
        preview,
        form,
        {
            "accounts": {"selected_id": "frc-2026"},
            "computations": {"selected_id": "ct-2025"},
        },
        "2026-07-30T12:00:00Z",
    )
    projected = server.ct600_form_from_filing_model(form, model)

    assert projected["filing_domain_model_id"] == model.model_id
    assert projected["filing_domain_model_hash"] == model.sha256()
    assert {
        field["box"]: field["value"]
        for field in projected["sections"][0]["fields"]
    } == {"1": "Example Limited", "2": "12345678", "35": "2026-04-30", "145": "100000.00"}
    assert server.cross_document_invariants(model)["passed"] is True


def test_ct600_model_supports_versioned_form_and_supplementary_pages():
    return_columns = set(server.accounting_corporation_tax_returns.c.keys())
    supplementary_columns = set(server.accounting_corporation_tax_supplementary_pages.c.keys())

    assert {"form_version", "period_from", "period_to", "utr", "declaration_name", "declaration_capacity", "data_json"} <= return_columns
    assert {"pack_id", "page_code", "selected", "data_json"} <= supplementary_columns


def test_official_compliance_specs_are_versioned_and_integrity_checked():
    status = server.year_end_specification_status()

    assert status["status"] == "prototype_not_validated"
    assert status["compliance_claim"] is False
    assert status["hmrc"]["version"] == "1.994"
    assert status["hmrc"]["integrity_verified"] is True
    assert status["hmrc"]["schema_assertions"] > 100
    assert status["companies_house"]["version"] == "5.9"
    assert status["companies_house"]["specification_present"] is True
    assert server.filing_generation_allowed() is False


def test_no_production_filing_gate_is_implicitly_passed():
    gates = server.year_end_specification_status()["release_gates"]

    assert gates
    assert all(gate["status"] != "passed" for gate in gates)
