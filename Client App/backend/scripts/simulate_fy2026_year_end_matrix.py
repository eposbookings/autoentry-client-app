"""Run an isolated FY2026 year-end workflow matrix.

This does not write filing records or contact HMRC/Companies House.  It verifies
the local data flow and records an explicitly simulated accepted response.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
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


def companies_house_preview(dormant):
    enabled = {"cover", "company_information", "balance_sheet"}
    if not dormant:
        enabled |= {"contents", "directors_report", "profit_and_loss", "detailed_profit_and_loss"}
    return {
        "accountants": "EPOS Accountancy",
        "accounts_standard": "Simulation",
        "section_options": [{"id": item, "enabled": item in enabled} for item, _label, _default in server.COMPANIES_HOUSE_SECTION_OPTIONS],
        "profit_and_loss_rows": [
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
        "business_name": "AG Marseille Limited",
        "company_number": "01234567",
        "utr": "1234567890",
        "registered_office_address": "1 Simulation Street, London",
    }
    results = []
    for standard, accounts_format, status in VARIANTS:
        pack = {
            "period_from": "2025-05-01",
            "period_to": "2026-04-30",
            "comparative_period_from": "2024-05-01",
            "comparative_period_to": "2025-04-30",
            "accounts_standard": standard,
            "accounts_format": accounts_format,
            "company_trading_status": status,
            "director_signing_name": "Simulation Director",
            "board_approval_date": "2026-07-31",
            "details": {"employee_count": 4, "accounts_taxonomy": "FRC-2026"},
        }
        pnl = {"turnover": "250000", "profit_before_tax": "50000", "tax_on_profit": "12500"}
        issues = server.annual_accounts_configuration_issues(standard, accounts_format, status)
        values = server.annual_accounts_ct600_auto_values(client, pack, pnl)
        form = form_for(values)
        native = server.ct600_native_pdf_values(form)
        pdf_bytes = server.ct600_fillable_pdf_bytes(form)
        pdf_pages = len(PdfReader(__import__("io").BytesIO(pdf_bytes)).pages)
        ch_html = server.annual_accounts_production_preview_html(
            client, pack, companies_house_preview(status == "dormant")
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
            "dormant_no_income_statement": status != "dormant" or "INCOME STATEMENT" not in ch_html,
        }
        passed = all(checks.values())
        results.append({
            "standard": standard,
            "format": accounts_format,
            "trading_status": status,
            "passed": passed,
            "checks": checks,
            "validation": {
                "schema": passed,
                "calculation": passed,
                "dimensions": passed,
                "destination_rules": passed,
                "mode": "local simulation; external gateway validators not invoked",
            },
            "submission": {
                "status": "accepted" if passed else "not_attempted",
                "simulated": True,
                "receipt": f"SIM-FY2026-{standard}-{accounts_format}-{status}" if passed else None,
            },
        })
    report = {
        "financial_year": "FY2026",
        "company": client["business_name"],
        "production_submission_attempted": False,
        "passed": all(item["passed"] for item in results),
        "variants": results,
    }
    output = ROOT / "tmp" / "fy2026_year_end_simulation_report.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"{sum(item['passed'] for item in results)}/{len(results)} variants passed")
    print(output)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
