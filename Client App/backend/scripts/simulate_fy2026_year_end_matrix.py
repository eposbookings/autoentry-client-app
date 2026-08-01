"""Run an isolated FY2026 year-end workflow matrix.

This does not write filing records or contact HMRC/Companies House. It verifies
the local data flow, runs deterministic iXBRL checks, and records external
validation/submission as unavailable rather than fabricating acceptance.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server  # noqa: E402


VARIANTS = [
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


def form_for(values):
    definitions = {
        box: (label, field_type)
        for section in server.CT600_FORM_SECTIONS
        for box, label, field_type in section["fields"]
    }
    return {
        "version": "CT600 (2026) Version 3",
        "sections": [
            {
                "id": f"official_page_{number}",
                "title": f"Page {number}",
                "fields": [
                    {
                        "box": box,
                        "label": definitions.get(box, (f"Official CT600 box {box}", "money"))[0],
                        "type": definitions.get(box, ("", "money"))[1],
                        "value": values.get(box, False if definitions.get(box, ("", ""))[1] == "boolean" else ""),
                    }
                    for box in boxes
                ],
            }
            for number, boxes in enumerate(server.CT600_OFFICIAL_PRINT_PAGES, 1)
        ],
    }


def companies_house_preview(pack):
    defaults = server.annual_accounts_section_defaults(pack)
    enabled = {key for key, value in defaults.items() if value["enabled"]}
    dormant = pack["company_trading_status"] == "dormant"
    return {
        "accountants": "EPOS Accountancy",
        "accounts_standard": "Simulation",
        "section_options": [
            {"id": item, "enabled": item in enabled, "required": defaults[item]["required"]}
            for item, _label, _default in server.COMPANIES_HOUSE_SECTION_OPTIONS
        ],
        "profit_and_loss_rows": [] if dormant else [
            {"key": "turnover", "label": "Turnover", "amount": "250000", "comparative": "220000"},
            {"key": "profit_before_tax", "label": "Profit before tax", "amount": "50000", "comparative": "42000"},
        ],
        "balance_sheet_rows": [
            {"key": "assets", "label": "Assets", "amount": "180000", "comparative": "150000"},
            {"key": "liabilities", "label": "Liabilities", "amount": "-70000", "comparative": "-60000"},
        ],
        "detailed_profit_and_loss_rows": [{"label": "Sales", "amount": "250000"}],
        "notes": [{"number": "1", "title": "Basis of preparation", "body": "Prepared for isolated workflow simulation."}],
        "approval": {"audit_basis": "Audit exemption under section 477"},
    }


def main():
    client = {
        "id": "simulation-client",
        "business_name": "AG Marseille Limited",
        "company_number": "01234567",
        "utr": "1234567890",
        "registered_office_address": "1 Simulation Street, London",
        "client_type": "limited_company",
        "main_contact_name": "Simulation Director",
        "main_contact_role": "Director",
    }
    results = []
    for standard, accounts_format, status in VARIANTS:
        pack = {
            "id": f"simulation-{standard}-{accounts_format}-{status}",
            "period_from": "2025-05-01",
            "period_to": "2026-04-30",
            "comparative_period_from": "2024-05-01",
            "comparative_period_to": "2025-04-30",
            "accounts_standard": standard,
            "accounts_format": accounts_format,
            "company_trading_status": status,
            "director_signing_name": "Simulation Director",
            "board_approval_date": "2026-07-31",
            "audit_exemption": "audit_exempt_dormant_company" if status == "dormant" else "audit_exempt_small_company",
            "details": {
                "employee_count": 0 if status == "dormant" else 4,
                "accounts_taxonomy": "FRC-2026",
                "computations_taxonomy": "CT-COMP-2025",
            },
        }
        pnl = {"turnover": "250000", "profit_before_tax": "50000", "tax_on_profit": "12500"}
        issues = server.annual_accounts_configuration_issues(standard, accounts_format, status)
        values = server.annual_accounts_ct600_auto_values(client, pack, pnl)
        form = form_for(values)
        native = server.ct600_native_pdf_values(form)
        pdf_bytes = server.ct600_fillable_pdf_bytes(form)
        pdf_pages = len(PdfReader(__import__("io").BytesIO(pdf_bytes)).pages)
        preview = companies_house_preview(pack)
        filing_model = server.build_filing_domain_model(
            client,
            pack,
            "simulation-snapshot",
            [
                {"account_code": "4000", "balance": "-250000.00", "period_kind": "current"},
                {"account_code": "5000", "balance": "200000.00", "period_kind": "current"},
                {"account_code": "2100", "balance": "-12500.00", "period_kind": "current"},
            ],
            preview,
            form,
            {
                "accounts": {"selected_id": "FRC-2026"},
                "computations": {"selected_id": "CT-COMP-2025"},
            },
            "2026-07-30T12:00:00Z",
        )
        projected_form = server.ct600_form_from_filing_model(form, filing_model)
        model_invariants = server.cross_document_invariants(filing_model)
        ch_html = server.annual_accounts_production_preview_html(client, pack, preview)
        ixbrl_validation = server.annual_accounts_ixbrl_local_validation(
            ch_html, client, pack, preview, destination="both"
        )
        expected_tax = "0.00" if status == "dormant" else "12500.00"
        checks = {
            "configuration": not issues,
            "ct600_identity": values["1"] == client["business_name"] and values["2"] == client["company_number"],
            "ct600_trial_balance": values["145"] == ("0.00" if status == "dormant" else "250000.00"),
            "ct600_tax_chain": all(values[box] == expected_tax for box in ("430", "440", "475", "510", "525", "528", "600")),
            "ct600_native_routes": all(
                any(name in native for name in server.CT600_NATIVE_PDF_FIELD_MAP[box])
                for box in ("145", "315", "430", "440", "475", "510", "525", "528", "600")
            ),
            "ct600_pdf": pdf_pages == 12 and len(pdf_bytes) > 100_000,
            "companies_house_ixbrl": "<ix:nonFraction" in ch_html and "<link:schemaRef" in ch_html,
            "ixbrl_well_formed": ixbrl_validation["checks"].get("xml_well_formed") is True,
            "taxonomy_entry_point": ixbrl_validation["checks"].get("schema_reference_matches_standard") is True,
            "dormant_no_income_statement": status != "dormant" or "INCOME STATEMENT" not in ch_html,
            "single_domain_projection": (
                projected_form["filing_domain_model_hash"] == filing_model.sha256()
                and model_invariants["passed"]
            ),
            "all_facts_have_provenance": all(
                fact.provenance
                for fact in (
                    filing_model.trial_balance_facts
                    + filing_model.statutory_facts
                    + filing_model.ct600_facts
                    + filing_model.presentation_facts
                )
            ),
            "production_scope_fails_closed": filing_model.support_assessment["submission_allowed"] is False,
        }
        passed = all(checks.values())
        results.append({
            "standard": standard,
            "format": accounts_format,
            "trading_status": status,
            "passed": passed,
            "checks": checks,
            "validation": {
                "local_ixbrl": ixbrl_validation,
                "external_schema": False,
                "external_calculation": False,
                "external_dimensions": False,
                "destination_rules": False,
                "filing_domain_model": {
                    "schema": filing_model.schema,
                    "version": filing_model.schema_version,
                    "hash": filing_model.sha256(),
                    "support": filing_model.support_assessment,
                    "cross_document_invariants": model_invariants,
                },
                "mode": "local simulation; FRC taxonomy and external gateway validators not invoked",
            },
            "submission": {
                "status": "blocked_external_validation",
                "simulated": True,
                "receipt": None,
            },
        })
    base_pack = {
        "period_from": "2025-05-01",
        "period_to": "2026-04-30",
        "accounts_standard": "FRS_105",
        "accounts_format": "micro",
        "company_trading_status": "trading",
        "audit_exemption": "audit_exempt_small_company",
        "director_signing_name": "Simulation Director",
        "board_approval_date": "2026-07-31",
        "details": {"employee_count": 4, "accounts_taxonomy": "FRC-2026", "computations_taxonomy": "CT-COMP-2025"},
    }
    negative_scenarios = []

    def negative(name, detected, expected_code):
        negative_scenarios.append({
            "name": name,
            "passed": bool(detected),
            "expected_blocker": expected_code,
        })

    conflict = server.annual_accounts_configuration_issues("FRS_105", "full", "trading")
    negative("incompatible standard and format", bool(conflict), "accounts_configuration_conflict")

    pack_issues = server.annual_accounts_pack_validation(
        base_pack,
        client,
        {"balanced": False, "account_count": 8, "blocked_account_count": 0, "review_account_count": 0, "unmapped_account_count": 0},
        {"turnover": "250000", "balance_sheet_total": "180000"},
    )
    negative(
        "unbalanced trial balance",
        "trial_balance_unbalanced" in {row["code"] for row in pack_issues},
        "trial_balance_unbalanced",
    )

    ineligible_pack = {**base_pack, "details": {**base_pack["details"], "employee_count": 40}}
    pack_issues = server.annual_accounts_pack_validation(
        ineligible_pack,
        client,
        {"balanced": True, "account_count": 8, "blocked_account_count": 0, "review_account_count": 0, "unmapped_account_count": 0},
        {"turnover": "20000000", "balance_sheet_total": "9000000"},
    )
    negative(
        "micro entity threshold breach",
        "accounts_format_ineligible" in {row["code"] for row in pack_issues},
        "accounts_format_ineligible",
    )

    expired = server.annual_accounts_taxonomy_selection({
        **base_pack,
        "period_from": "2025-07-01",
        "period_to": "2026-06-30",
        "details": {**base_pack["details"], "computations_taxonomy": "CT-COMP-2024"},
    })
    negative("expired computation taxonomy", not expired["ready"], "taxonomy_period_invalid")

    detail_preview = companies_house_preview(base_pack)
    for section in detail_preview["section_options"]:
        if section["id"] == "detailed_profit_and_loss":
            section["enabled"] = True
    detail_preview["detailed_profit_and_loss_rows"] = [{"label": "4000 - Sales", "amount": "250000"}]
    detail_html = server.annual_accounts_production_preview_html(client, base_pack, detail_preview)
    detail_validation = server.annual_accounts_ixbrl_local_validation(detail_html, client, base_pack, detail_preview)
    negative(
        "visible untagged detailed profit and loss",
        "detailed_profit_and_loss_untagged" in {row["code"] for row in detail_validation["issues"]},
        "detailed_profit_and_loss_untagged",
    )

    malformed_validation = server.annual_accounts_ixbrl_local_validation(
        "<html><ix:nonFraction>",
        client,
        base_pack,
        companies_house_preview(base_pack),
    )
    negative(
        "malformed inline XBRL",
        "ixbrl_not_well_formed" in {row["code"] for row in malformed_validation["issues"]},
        "ixbrl_not_well_formed",
    )

    specialist_scope = server.annual_accounts_support_assessment(
        client,
        base_pack,
        {"105": True},
    )
    negative(
        "group or consortium supplementary page outside initial scope",
        specialist_scope["level"] == "unsupported" and not specialist_scope["submission_allowed"],
        "filing_scope_unsupported",
    )

    report = {
        "financial_year": "FY2026",
        "company": client["business_name"],
        "production_submission_attempted": False,
        "harness_passed": all(item["passed"] for item in results) and all(item["passed"] for item in negative_scenarios),
        "filing_ready": False,
        "variants": results,
        "negative_scenarios": negative_scenarios,
    }
    output_dir = BACKEND / "test_reports"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "fy2026_year_end_simulation_report.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"{sum(item['passed'] for item in results)}/{len(results)} variants passed")
    print(output)
    if not report["harness_passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
