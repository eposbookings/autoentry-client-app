import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from backend import server


def ar_line(description="Consulting", net="100.00", vat="20.00", gross="120.00"):
    return server.ar_line_values({
        "description": description,
        "nominal_account_code": "4000",
        "vat_code": "S20",
        "quantity": "1",
        "unit_price": net,
        "net_amount": net,
        "vat_amount": vat,
        "gross_amount": gross,
    })


def test_ar_invoice_line_update_recalculates_document_totals():
    lines = [ar_line(), ar_line("Support", "50.00", "10.00", "60.00")]

    totals = server.validate_ar_document_totals({}, lines, "Sales invoice")

    assert totals == {"net_amount": "150.00", "vat_amount": "30.00", "gross_amount": "180.00"}


def test_ar_invoice_line_removal_uses_remaining_line_totals():
    totals = server.validate_ar_document_totals({}, [ar_line()], "Sales invoice")

    assert totals["gross_amount"] == "120.00"


def test_ar_invoice_rejects_header_totals_that_do_not_match_lines():
    with pytest.raises(HTTPException, match="does not match line totals"):
        server.validate_ar_document_totals({"gross_amount": "999.00"}, [ar_line()], "Sales invoice")


def test_ar_vat_validation_stores_native_code_values(monkeypatch):
    seen = []

    async def validate(_session, _client_id, code):
        seen.append(code)
        return {"code": code}

    monkeypatch.setattr(server, "validate_native_vat_code", validate)
    lines = [{"vat_code": "S20"}]

    result = asyncio.run(server.validate_native_vat_codes_for_document(None, "client-1", "S20", lines, "Sales invoice"))

    assert result == "S20"
    assert lines[0]["vat_code"] == "S20"
    assert seen == ["S20", "S20"]


def test_copy_invoice_payload_resets_identity_source_and_dates():
    original = {"id": "inv-1", "customer_id": "cust-1", "invoice_number": "SINV00001", "payment_terms_days": 30, "currency": "GBP", "description": "Original", "vat_code": "S20", "attachment_path": "source.pdf", "posted_journal_id": "journal-1"}
    line = {"id": "line-1", "invoice_id": "inv-1", **ar_line()}

    payload = server.ar_copy_invoice_payload(original, {"payment_terms_days": 14}, [line], date(2026, 7, 22))

    assert payload["invoice_date"] == "2026-07-22"
    assert payload["due_date"] == "2026-08-21"
    assert payload["customer_id"] == "cust-1"
    assert "invoice_number" not in payload
    assert "attachment_path" not in payload
    assert "posted_journal_id" not in payload
    assert "id" not in payload["lines"][0]
    assert "invoice_id" not in payload["lines"][0]


def test_ar_update_copy_routes_are_registered():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    invoice_path = "/api/admin/accounting/clients/{client_id}/ar/invoices/{invoice_id}"
    credit_path = "/api/admin/accounting/clients/{client_id}/ar/credit-notes/{credit_note_id}"

    assert (invoice_path, "PUT") in routes
    assert (invoice_path, "PATCH") in routes
    assert (f"{invoice_path}/copy", "POST") in routes
    assert (credit_path, "PUT") in routes
    assert (credit_path, "PATCH") in routes
