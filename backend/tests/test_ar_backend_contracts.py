import json

from backend import server


def test_ar_document_response_matches_accounts_receivable_contract():
    invoice = {"id": "inv-1", "status": "draft", "lines": [{"description": "Line"}]}

    response = server.ar_document_response("sales_invoice", invoice)

    assert response["ok"] is True
    assert response["document_type"] == "sales_invoice"
    assert response["destination"] == "accounts_receivable"
    assert response["invoice"] == invoice
    assert response["lines"] == invoice["lines"]
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
