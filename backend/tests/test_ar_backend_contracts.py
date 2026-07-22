import json
from decimal import Decimal
import pytest
from fastapi import HTTPException

from backend import server


def test_invoice_allocation_values_are_derived_from_gross_and_exact_allocations():
    invoice = {"gross_amount": "144.00", "status": "posted", "posted_journal_id": "journal-1"}

    unpaid = server.invoice_allocation_values(invoice, Decimal("0.00"))
    assert unpaid["paid_allocated"] == "0.00"
    assert unpaid["invoice_balance"] == "144.00"
    assert unpaid["status"] == "posted"

    partial = server.invoice_allocation_values(invoice, Decimal("64.68"))
    assert partial["paid_allocated"] == "64.68"
    assert partial["invoice_balance"] == "79.32"
    assert partial["status"] == "part_paid"

    paid = server.invoice_allocation_values(invoice, Decimal("144.00"))
    assert paid["invoice_balance"] == "0.00"
    assert paid["status"] == "paid"


def test_invoice_allocation_values_expose_over_allocation_exception():
    values = server.invoice_allocation_values(
        {"gross_amount": "144.00", "status": "part_paid", "posted_journal_id": "journal-1"},
        Decimal("433.32"),
    )

    assert values["paid_allocated"] == "433.32"
    assert values["invoice_balance"] == "-289.32"
    assert values["status"] == "over_allocated"
    assert values["display_status"] == "Over Allocated"
    assert values["is_over_allocated"] is True


def test_legacy_draft_invoice_is_exposed_as_awaiting_approval():
    values = server.invoice_allocation_values(
        {"gross_amount": "144.00", "status": "draft", "posted_journal_id": None},
        Decimal("0.00"),
    )

    assert values["status"] == "awaiting_approval"
    assert values["display_status"] == "Awaiting Approval"


def test_chart_account_classification_separates_pl_from_system_roles():
    sales = {"code": "4000", "category": "Income", "account_type": "Income", "purpose": "Sales"}
    creditors = {"code": "2000", "category": "Liability", "account_type": "Payable", "purpose": "Purchase Ledger"}

    assert server.account_statement_section(sales) == "profit_and_loss"
    assert server.account_system_role(sales, module_required=True) == "none"
    assert server.account_statement_section(creditors) == "balance_sheet"
    assert server.account_system_role(creditors) == "accounts_payable_control"


def test_chart_account_serializer_only_labels_true_controls():
    ordinary_asset = server.serialize_native_account({"code": "1500", "category": "Asset", "account_type": "Fixed Asset", "control_account": True})
    vat_control = server.serialize_native_account({"code": "2200", "category": "Liability", "account_type": "VAT", "control_account": True})

    assert ordinary_asset["statement_section"] == "balance_sheet"
    assert ordinary_asset["system_role"] == "none"
    assert ordinary_asset["is_control_account"] is False
    assert vat_control["system_role"] == "vat_control"
    assert vat_control["is_control_account"] is True


def test_chart_statement_type_is_derived_strictly_from_category():
    other_income = server.serialize_native_account({"code": "4900", "category": "Other Income", "account_type": "Bank"})
    current_asset = server.serialize_native_account({"code": "1120", "category": "Asset", "account_type": "Overheads"})

    assert other_income["statement_type"] == "profit_and_loss"
    assert server.is_bank_compatible_account(other_income) is False
    assert current_asset["statement_type"] == "balance_sheet"


def test_manual_journal_validation_accepts_balanced_nominal_lines():
    lines, debit, credit = server.validate_manual_journal_payload(
        {"lines": [{"account_code": "4000", "credit": "100.00"}, {"account_code": "1100", "debit": "100.00"}]},
        [{"id": "sales", "code": "4000", "name": "Sales"}, {"id": "debtors", "code": "1100", "name": "Debtors"}],
    )
    assert len(lines) == 2
    assert debit == credit == Decimal("100.00")


def test_manual_journal_validation_rejects_unbalanced_or_double_sided_lines():
    accounts = [{"id": "sales", "code": "4000", "name": "Sales"}, {"id": "debtors", "code": "1100", "name": "Debtors"}]
    with pytest.raises(HTTPException, match="both a debit and a credit"):
        server.validate_manual_journal_payload({"lines": [{"account_code": "4000", "debit": "10", "credit": "10"}, {"account_code": "1100", "debit": "10"}]}, accounts)
    with pytest.raises(HTTPException, match="must balance"):
        server.validate_manual_journal_payload({"lines": [{"account_code": "4000", "credit": "90"}, {"account_code": "1100", "debit": "100"}]}, accounts)


def test_ar_document_response_matches_accounts_receivable_contract():
    invoice = {"id": "inv-1", "status": "draft", "lines": [{"description": "Line"}]}

    response = server.ar_document_response("sales_invoice", invoice)

    assert response["ok"] is True
    assert response["transaction_type"] == "sales_invoice"
    assert response["document_type"] == "sales_invoice"
    assert response["destination"] == "accounts_receivable"
    assert response["invoice"] == invoice
    assert response["invoice_or_transaction"] == invoice
    assert response["lines"] == invoice["lines"]
    assert response["ledger_impact"] == server.ar_ledger_effect("sales_invoice")
    assert response["source_document"]["status"] == "none"
    assert response["status"] == "draft"


def test_ar_ledger_effects_are_native_ar_sided():
    assert server.ar_ledger_effect("sales_invoice") == {
        "debit": ["debtors control"],
        "credit": ["sales nominal", "VAT control"],
    }
    assert server.ar_ledger_effect("customer_credit_note") == {
        "debit": ["sales nominal", "VAT control"],
        "credit": ["debtors control"],
    }
    assert server.ar_ledger_effect("customer_receipt") == {
        "debit": ["bank account"],
        "credit": ["debtors control"],
    }


def test_sales_submission_fields_preserve_customer_and_line_coding():
    submission = {
        "id": "sub-1",
        "type": "sales",
        "description": "Website work",
        "date": "2026-07-05",
        "amount": "120.00",
        "ai_extracted_fields": json.dumps(
            {
                "customer_name": "Acme Ltd",
                "customer_email": "accounts@acme.test",
                "vat_number": "GB123",
                "invoice_number": "S-100",
                "net_amount": "100.00",
                "vat_amount": "20.00",
                "gross_amount": "120.00",
                "line_items": [
                    {
                        "description": "Website running",
                        "category": "1150040003 - Website running",
                        "net": "100.00",
                        "vat": "20.00",
                        "total": "120.00",
                    }
                ],
            }
        ),
        "coding_fields": None,
    }

    fields = server.sales_submission_fields(submission, {"customer_id": "cust-1"})

    assert fields["customer_id"] == "cust-1"
    assert fields["customer_name"] == "Acme Ltd"
    assert fields["customer_email"] == "accounts@acme.test"
    assert fields["customer_vat_number"] == "GB123"
    assert fields["lines"][0]["nominal_account_code"] == "1150040003 - Website running"
    assert fields["lines"][0]["sales_account_code"] == "1150040003 - Website running"


def test_sales_submission_payload_preserves_source_document_fields():
    submission = {
        "id": "sub-1",
        "date": "2026-07-05",
        "amount": "120.00",
        "description": "Website work",
        "image_filename": "stored-upload.pdf",
        "original_filename": "Customer invoice.pdf",
    }
    fields = {
        "customer_id": "cust-1",
        "customer_name": "Acme Ltd",
        "customer_email": "accounts@acme.test",
        "customer_reference": "ACME",
        "invoice_number": "S-100",
        "invoice_date": "2026-07-05",
        "currency": "GBP",
        "net_amount": "100.00",
        "vat_amount": "20.00",
        "gross_amount": "120.00",
        "vat_code": "20% S",
        "description": "Website work",
        "sales_account_code": "4000",
        "lines": [
            {
                "description": "Website running",
                "quantity": "1",
                "unit_price": "100.00",
                "net_amount": "100.00",
                "vat_amount": "20.00",
                "gross_amount": "120.00",
                "vat_code": "20% S",
                "nominal_account_code": "4000",
            }
        ],
    }

    payload = server.sales_submission_payload_for_ar(submission, fields)

    assert payload["source_submission_id"] == "sub-1"
    assert payload["attachment_path"] == "stored-upload.pdf"
    assert payload["original_filename"] == "Customer invoice.pdf"
    assert payload["lines"][0]["nominal_account_code"] == "4000"
    assert payload["lines"][0]["vat_code"] == "20% S"


def test_serialize_ar_invoice_returns_detail_contract_fields():
    invoice = {
        "id": "inv-1",
        "client_id": "client-1",
        "status": "awaiting_approval",
        "source_submission_id": "sub-1",
        "attachment_path": "stored-upload.pdf",
        "extracted_json": json.dumps({"invoice_number": "S-100"}),
    }
    customer = {"id": "cust-1", "name": "Acme Ltd", "customer_code": "ACME"}

    item = server.serialize_ar_invoice(invoice, [{"description": "Line"}], customer)

    assert item["editable"] is True
    assert item["view_only"] is False
    assert item["customer"] == customer
    assert item["customer_name"] == "Acme Ltd"
    assert item["attachment_url"] == "/api/admin/accounting/clients/client-1/ar/invoices/inv-1/attachment"
    assert item["document_url"] == item["attachment_url"]
    assert item["lines"][0]["description"] == "Line"


def test_serialize_ar_invoice_marks_posted_as_view_only():
    item = server.serialize_ar_invoice({"id": "inv-1", "client_id": "client-1", "status": "posted"})

    assert item["editable"] is False
    assert item["view_only"] is True


def test_attachment_resolution_preserves_stored_relative_folders():
    candidates = server.upload_path_candidates("demo/ap/00600.pdf")

    assert candidates[0] == server.UPLOAD_DIR / "demo" / "ap" / "00600.pdf"
    assert candidates[1] == server.UPLOAD_DIR / "00600.pdf"


def test_serialize_ap_invoice_returns_missing_source_state_without_dropping_reference():
    invoice = {
        "id": "ap-1",
        "client_id": "client-1",
        "status": "awaiting_approval",
        "source_submission_id": "sub-1",
        "attachment_path": "demo/ap/missing.pdf",
        "original_filename": "Invoice.pdf",
    }

    item = server.serialize_ap_invoice(invoice, [{"nominal_account_code": "5000", "vat_code": "NO VAT"}])

    assert item["attachment_path"] == "demo/ap/missing.pdf"
    assert item["attachment_url"] == "/api/admin/accounting/clients/client-1/ap/invoices/ap-1/attachment"
    assert item["document_url"] == item["attachment_url"]
    assert item["source_document_status"] == "missing"
    assert item["source_document_missing"] is True
    assert item["lines"][0]["nominal_account_code"] == "5000"
    assert item["lines"][0]["vat_code"] == "NO VAT"


def test_native_supplier_and_customer_serializers_include_settings_list_aliases():
    supplier = server.serialize_ap_supplier(
        {"id": "sup-1", "supplier_code": "SUP001", "trading_name": "Supplier Trading", "status": "active"},
        {"name": "Supplier Ltd", "email": "supplier@example.test", "account_code": "SUP001", "active": True},
    )
    customer = server.serialize_ar_customer(
        {"id": "cus-1", "customer_code": "CUS001", "trading_name": "Customer Trading", "status": "active"},
        {"name": "Customer Ltd", "email": "customer@example.test", "account_code": "CUS001", "active": True},
    )

    assert supplier["supplier_id"] == "sup-1"
    assert supplier["supplier_name"] == "Supplier Ltd"
    assert supplier["code"] == "SUP001"
    assert supplier["active"] is True
    assert customer["customer_id"] == "cus-1"
    assert customer["customer_name"] == "Customer Ltd"
    assert customer["code"] == "CUS001"
    assert customer["active"] is True


def test_workspace_snapshot_pagination_shape_supports_first_page_native_records():
    payload = server.paginated_payload([{"id": "sup-1"}], 1, 50, 125, {"supplier_count": 125})

    assert payload["rows"] == [{"id": "sup-1"}]
    assert payload["page_size"] == 50
    assert payload["total_rows"] == 125
    assert payload["total_pages"] == 3


def test_ar_copy_invoice_payload_uses_today_terms_and_does_not_copy_source_document():
    original = {
        "customer_id": "cus-1",
        "payment_terms_days": "14",
        "currency": "GBP",
        "description": "Monthly support",
        "vat_code": "20% S",
        "source_submission_id": "sub-1",
        "attachment_path": "old.pdf",
    }
    lines = [{"description": "Support", "nominal_account_code": "4000", "vat_code": "20% S", "quantity": "1.00", "unit_price": "100.00", "net_amount": "100.00", "vat_amount": "20.00", "gross_amount": "120.00"}]

    payload = server.ar_copy_invoice_payload(original, {"payment_terms_days": 30}, lines, server.date(2026, 7, 22))

    assert payload["customer_id"] == "cus-1"
    assert payload["invoice_date"] == "2026-07-22"
    assert payload["due_date"] == "2026-08-05"
    assert payload["lines"][0]["nominal_account_code"] == "4000"
    assert "source_submission_id" not in payload
    assert "attachment_path" not in payload


def test_ap_document_response_includes_manual_create_contract_fields():
    invoice = {"id": "ap-1", "status": "draft", "net_amount": "100.00", "vat_amount": "0.00", "gross_amount": "100.00", "lines": [{"vat_code": "NO VAT"}]}

    response = server.ap_document_response("purchase_invoice", invoice)

    assert response["transaction_type"] == "purchase_invoice"
    assert response["invoice_or_transaction"] == invoice
    assert response["totals"] == {"net_amount": "100.00", "vat_amount": "0.00", "gross_amount": "100.00"}
    assert response["ledger_impact"] == server.ap_ledger_effect("purchase_invoice")
