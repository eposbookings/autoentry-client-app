import asyncio

from backend import server
import asyncio


def test_vat_code_value_normalises_display_labels_to_code_only():
    assert server.vat_code_value("20% S - Standard rate") == "20% S"
    assert server.vat_code_value("5% R (5%)") == "5% R"
    assert server.vat_code_value("NO VAT") == "NO VAT"


def test_ai_vat_choice_is_inferred_from_explicit_reviewed_amounts():
    review = {
        "coding_fields": {
            "net": "6.99",
            "vat": "1.40",
            "total": "8.39",
            "vat_code": "",
            "line_items": [{
                "description": "Startup Hosting",
                "net": "6.99",
                "vat": "1.40",
                "total": "8.39",
                "vat_code": "",
            }],
        },
    }
    result = server.apply_synced_coding_choices(
        review,
        {"vat_codes": [
            {"code": "20% S", "label": "20% S - Standard rate"},
            {"code": "5% R", "label": "5% R - Reduced rate"},
            {"code": "NO VAT", "label": "NO VAT - No VAT applicable"},
        ]},
        True,
    )
    assert result["coding_fields"]["vat_code"] == "20% S - Standard rate"
    assert result["coding_fields"]["line_items"][0]["vat_code"] == "20% S - Standard rate"


def test_default_native_vat_codes_are_unique_and_have_return_mapping():
    codes = [row["code"] for row in server.DEFAULT_NATIVE_VAT_CODES]
    assert len(codes) == len(set(codes))
    standard = next(row for row in server.DEFAULT_NATIVE_VAT_CODES if row["code"] == "20% S")
    assert standard["box_sales_vat"] == "1"
    assert standard["box_purchase_vat"] == "4"
    assert standard["box_sales_net"] == "6"
    assert standard["box_purchase_net"] == "7"


def test_vat_code_contract_exposes_code_only_value_and_clear_box_mapping():
    payload = server.serialize_vat_code({
        "code": "20% S",
        "description": "Standard rate",
        "percentage": "20",
        "purchase_behavior": "recoverable",
        "sales_behavior": "output",
        "box_sales_vat": "1",
        "box_purchase_vat": "4",
        "box_sales_net": "6",
        "box_purchase_net": "7",
        "active": True,
        "system_code": True,
    })
    assert payload["code"] == "20% S"
    assert payload["display_label"] == "20% S - Standard rate"
    assert payload["purchase_boxes"] == ["4", "7"]
    assert payload["sales_boxes"] == ["1", "6"]
    assert payload["custom_code"] is False


def test_vat_period_contract_has_consistent_frontend_aliases():
    payload = server.serialize_vat_period({
        "period_start": "2026-01-01",
        "period_end": "2026-03-31",
        "due_date": "2026-05-07",
    })
    assert payload["start_date"] == "2026-01-01"
    assert payload["end_date"] == "2026-03-31"
    assert payload["payment_due_date"] == "2026-05-07"
    assert payload["label"] == "01/01/2026 - 31/03/2026"


def test_single_submitted_line_inherits_missing_reviewed_header_values():
    lines = server.submission_lines_with_single_line_header_fallback(
        {
            "description": "Startup Hosting",
            "category": "5000",
            "vat_code": "20% S",
            "net": "6.99",
            "vat": "1.40",
            "total": "8.39",
        },
        [{
            "description": "Startup Hosting",
            "category": "",
            "vat_code": "NO VAT",
            "net": "0.00",
            "vat": "0.00",
            "total": "0.00",
        }],
        "5000",
    )
    normalized = server.ap_line_values(lines[0], "5000")
    assert normalized["nominal_account_code"] == "5000"
    assert normalized["vat_code"] == "20% S"
    assert normalized["net_amount"] == "6.99"
    assert normalized["vat_amount"] == "1.40"
    assert normalized["gross_amount"] == "8.39"


def test_multi_line_submission_does_not_copy_header_totals_to_each_line():
    original = [
        {"description": "First", "net": ""},
        {"description": "Second", "net": ""},
    ]
    lines = server.submission_lines_with_single_line_header_fallback(
        {"net": "100.00", "vat": "20.00", "total": "120.00"},
        original,
        "5000",
    )
    assert lines == original


def test_open_vat_period_workspace_uses_live_transaction_summary(monkeypatch):
    async def settings(_session, _client_id):
        return {"vat_scheme": "standard", "vat_accounting_basis": "accrual"}

    async def codes(_session, _client_id):
        return []

    async def periods(_session, _client_id, _settings):
        return [{
            "id": "q3",
            "period_start": "2026-07-01",
            "period_end": "2026-09-30",
            "status": "open",
            "transaction_count": 0,
            "output_vat": "0.00",
            "input_vat": "0.00",
            "net_vat": "0.00",
        }]

    async def rows(_session, _query):
        return []

    async def transactions(_session, _client_id, _period):
        return [{
            "date": "2026-07-23",
            "direction": "purchase",
            "net": "6.99",
            "vat": "1.40",
            "box_purchase_vat": "4",
            "box_purchase_net": "7",
        }]

    async def history(_session, _client_id, _codes):
        return {}

    async def activity(_session, _client_id):
        return {}

    monkeypatch.setattr(server, "ensure_vat_settings", settings)
    monkeypatch.setattr(server, "ensure_vat_codes", codes)
    monkeypatch.setattr(server, "ensure_vat_periods", periods)
    monkeypatch.setattr(server, "many", rows)
    monkeypatch.setattr(server, "vat_period_transactions", transactions)
    monkeypatch.setattr(server, "native_vat_code_history_counts", history)
    monkeypatch.setattr(server, "native_vat_basis_change_summary", activity)

    workspace = asyncio.run(server.vat_engine_workspace(None, "client"))
    period = workspace["periods"][0]
    assert period["transaction_count"] == 1
    assert period["output_vat"] == "0.00"
    assert period["input_vat"] == "1.40"
    assert period["net_vat"] == "-1.40"
    assert workspace["dashboard"]["current_period"] == "2026-07-01 to 2026-09-30"
    assert workspace["dashboard"]["input_vat"] == "1.40"
    assert workspace["dashboard"]["net_vat_due"] == "-1.40"


def test_outside_period_document_lines_are_forced_to_no_vat():
    lines = [{"net_amount": "100.00", "vat_amount": "20.00", "gross_amount": "120.00", "vat_code": "20% S"}]
    server.normalize_document_lines_outside_vat_period(lines)
    assert lines == [{"net_amount": "100.00", "vat_amount": "0.00", "gross_amount": "100.00", "vat_code": "NO VAT"}]


def test_shared_vat_effective_date_rule(monkeypatch):
    async def client(_session, _client_id):
        return {"is_vat_client": True}

    async def settings(_session, _client_id):
        return {
            "vat_start_date": "2026-04-01",
            "vat_end_date": "2027-03-31",
            "vat_scheme": "standard",
            "vat_frequency": "quarterly",
            "default_purchase_vat_code": "20% S",
        }

    monkeypatch.setattr(server, "get_user_by_id", client)
    monkeypatch.setattr(server, "ensure_vat_settings", settings)
    before = asyncio.run(server.native_vat_effective_context(None, "client", "2026-03-31"))
    inside = asyncio.run(server.native_vat_effective_context(None, "client", "2026-04-01"))
    after = asyncio.run(server.native_vat_effective_context(None, "client", "2027-04-01"))
    assert before["vat_active_for_date"] is False and before["default_vat_code"] == "NO VAT"
    assert inside["vat_active_for_date"] is True and inside["default_vat_code"] == "20% S"
    assert after["vat_active_for_date"] is False and after["default_vat_code"] == "NO VAT"


def test_submitted_item_vat_date_rule_accepts_ai_display_date():
    context = {
        "vat_client": True,
        "vat_configured": True,
        "vat_start_date": "2026-07-01",
        "vat_end_date": "",
    }
    assert server.submitted_item_vat_active_for_date(context, "23/07/2026") is True
    assert server.submitted_item_vat_active_for_date(context, "30/06/2026") is False


def test_external_vat_client_without_native_effective_dates_keeps_vat():
    assert server.submitted_item_vat_active_for_date({"source": "external"}, "23/07/2026", True) is True


def test_ai_review_applies_vat_period_to_extracted_document_date(monkeypatch):
    response_body = {
        "output_text": """{
            "status": "approved",
            "document_type": "invoice",
            "message": "VAT invoice extracted.",
            "payment_method": "card",
            "confidence": "high",
            "coding_fields": {
                "vendor_name": "20i",
                "vendor_account": "",
                "category": "5000",
                "date": "23/07/2026",
                "due_date": "23/07/2026",
                "description": "Startup Hosting",
                "document_type": "bill",
                "bill_number": "9572223",
                "reference": "D Smits 3208",
                "net": "6.99",
                "vat": "1.40",
                "total": "8.39",
                "vat_code": "20% S",
                "currency": "GBP",
                "payment_method": "Card",
                "mark_as_paid": false,
                "bank_account": "",
                "price_is": "Tax Exclusive",
                "line_items": [{
                    "description": "Startup Hosting",
                    "category": "5000",
                    "vat_code": "20% S",
                    "units": "1",
                    "price": "6.99",
                    "net": "6.99",
                    "vat": "1.40",
                    "total": "8.39"
                }],
                "ocr_text_lines": [],
                "ocr_text_boxes": []
            }
        }"""
    }

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return response_body

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    review = asyncio.run(server.review_document_with_openai(
        b"invoice",
        "application/pdf",
        {"type": "purchase", "date": ""},
        {"is_vat_client": True},
        "test-key",
        "test-model",
        "invoice.pdf",
        [],
        {
            "vat_client": True,
            "vat_configured": True,
            "vat_start_date": "2026-07-01",
            "vat_end_date": "",
            "vat_codes": [{"value": "20% S", "label": "20% S - Standard rate"}, {"value": "NO VAT", "label": "NO VAT"}],
            "purchase_accounts": [{"value": "5000", "label": "5000 - Purchases"}],
            "suppliers": [{"value": "supplier-1", "label": "20i", "name": "20i"}],
        },
    ))
    fields = review["coding_fields"]
    assert fields["net"] == "6.99"
    assert fields["vat"] == "1.40"
    assert fields["total"] == "8.39"
    assert server.vat_code_value(fields["vat_code"]) == "20% S"
    assert fields["line_items"][0]["vat"] == "1.40"


def test_closed_period_late_invoice_requires_current_period_adjustment(monkeypatch):
    async def settings(_session, _client_id):
        return {"vat_scheme": "standard"}

    async def periods(_session, _client_id):
        return [
            {"id": "q1", "period_start": "2026-01-01", "period_end": "2026-03-31", "status": "closed"},
            {"id": "q2", "period_start": "2026-04-01", "period_end": "2026-12-31", "status": "open"},
        ]

    monkeypatch.setattr(server, "ensure_vat_settings", settings)
    monkeypatch.setattr(server, "ensure_vat_periods", periods)
    context = asyncio.run(server.late_invoice_vat_context(None, "client", "2026-03-15", "20.00"))
    assert context["requires_confirmation"] is True
    assert context["original_period"]["id"] == "q1"
    assert context["reported_period"]["id"] == "q2"


def test_submitted_period_is_closed_for_late_invoice_adjustments(monkeypatch):
    async def settings(_session, _client_id):
        return {"vat_scheme": "standard"}

    async def periods(_session, _client_id):
        return [
            {"id": "q1", "period_start": "2026-01-01", "period_end": "2026-03-31", "status": "submitted"},
            {"id": "q2", "period_start": "2026-04-01", "period_end": "2026-12-31", "status": "open"},
        ]

    monkeypatch.setattr(server, "ensure_vat_settings", settings)
    monkeypatch.setattr(server, "ensure_vat_periods", periods)
    context = asyncio.run(server.late_invoice_vat_context(None, "client", "2026-03-15", "20.00"))
    assert context["requires_confirmation"] is True
    assert context["requires_reopen"] is False


def test_vat_period_drilldown_and_submit_routes_exist():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/vat/periods/{period_id}", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/vat/periods/{period_id}/boxes/{box_number}", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/vat/periods/{period_id}/submit", "POST") in routes


def test_vat_adjustment_list_create_and_detail_routes_exist():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/vat/adjustments", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/vat/adjustments", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/vat/adjustments/{adjustment_id}", "GET") in routes


def test_vat_box_drilldown_contributions_include_derived_boxes():
    sales = server.vat_transaction_box_contributions({
        "direction": "sales",
        "net": "100.00",
        "vat": "20.00",
        "box_sales_vat": "1",
        "box_sales_net": "6",
    })
    purchase = server.vat_transaction_box_contributions({
        "direction": "purchase",
        "net": "50.00",
        "vat": "10.00",
        "box_purchase_vat": "4",
        "box_purchase_net": "7",
    })
    assert sales[1] == server.Decimal("20.00")
    assert sales[3] == server.Decimal("20.00")
    assert sales[5] == server.Decimal("20.00")
    assert sales[6] == server.Decimal("100.00")
    assert purchase[4] == server.Decimal("10.00")
    assert purchase[5] == server.Decimal("-10.00")
    assert purchase[7] == server.Decimal("50.00")


def test_cash_accounting_does_not_create_invoice_date_adjustment(monkeypatch):
    async def settings(_session, _client_id):
        return {"vat_scheme": "cash"}

    monkeypatch.setattr(server, "ensure_vat_settings", settings)
    assert asyncio.run(server.late_invoice_vat_context(None, "client", "2026-03-15", "20.00")) is None


def test_vat_scheme_and_accounting_basis_are_separate():
    assert server.normalized_vat_scheme({"vat_scheme": "cash"}) == "standard"
    assert server.normalized_vat_scheme({"vat_scheme": "flat_rate"}) == "flat_rate"
    assert server.normalized_vat_accounting_basis({"vat_scheme": "standard", "vat_accounting_basis": "cash"}) == "cash"
    assert server.normalized_vat_accounting_basis({"vat_scheme": "flat_rate", "vat_accounting_basis": "accrual"}) == "accrual"


def test_cash_vat_date_prefers_bank_date_and_never_allocation_date():
    payment = {
        "id": "payment",
        "bank_transaction_id": "bank",
        "payment_date": "2026-07-20",
        "created_at": "2026-07-24",
    }
    assert server.cash_vat_event_date(payment, {"bank": {"transaction_date": "2026-07-18"}}, "payment_date") == "2026-07-18"
    assert server.cash_vat_event_date({**payment, "bank_transaction_id": None}, {}, "payment_date") == "2026-07-20"
    assert server.cash_vat_event_date({"created_at": "2026-07-24"}, {}, "payment_date") == ""


def test_cash_part_payment_splits_mixed_vat_lines_proportionally():
    groups = server.proportional_vat_allocation_groups(
        {"gross_amount": "180.00"},
        [
            {"vat_code": "20% S", "net_amount": "100.00", "vat_amount": "20.00", "gross_amount": "120.00"},
            {"vat_code": "0% Z", "net_amount": "60.00", "vat_amount": "0.00", "gross_amount": "60.00"},
        ],
        "90.00",
    )
    by_code = {row["vat_code"]: row for row in groups}
    assert by_code["20% S"]["net_amount"] == "50.00"
    assert by_code["20% S"]["vat_amount"] == "10.00"
    assert by_code["0% Z"]["net_amount"] == "30.00"


def test_ap_ar_allocation_routes_support_options_and_bulk_save():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/ap/payments/{payment_id}/allocation-options", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ap/payments/{payment_id}/allocations", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ar/receipts/{receipt_id}/allocation-options", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ar/receipts/{receipt_id}/allocations", "POST") in routes


def test_ar_customer_credit_note_has_dedicated_approval_route():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/ar/credit-notes/{credit_note_id}/approve", "POST") in routes


def test_ar_customer_account_level_allocation_routes_exist():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/ar/customers/{customer_id}/allocation-workspace", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ar/customers/{customer_id}/allocate-transactions", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ar/customers/{customer_id}/credit-allocations/{allocation_id}/unallocate", "POST") in routes


def test_ap_supplier_account_level_allocation_routes_exist():
    routes = {(route.path, method) for route in server.api.routes for method in getattr(route, "methods", set())}
    assert ("/api/admin/accounting/clients/{client_id}/ap/suppliers/{supplier_id}/allocation-workspace", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ap/suppliers/{supplier_id}/allocate-transactions", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/ap/suppliers/{supplier_id}/credit-allocations/{allocation_id}/unallocate", "POST") in routes


def test_settled_allocation_statuses_use_payment_language():
    assert server.accounting_display_status("allocated") == "Paid"
    assert server.accounting_display_status("part_allocated") == "Part Paid"


def test_supplier_and_customer_on_account_balances_reduce_net_control_balance():
    supplier = server.serialize_ap_supplier(
        {"id": "supplier", "status": "active"},
        {"name": "Supplier", "active": True},
        server.Decimal("500.00"),
        server.Decimal("1500.00"),
    )
    assert supplier["outstanding_balance"] == "500.00"
    assert supplier["payment_on_account_balance"] == "1500.00"
    assert supplier["current_balance"] == "-1000.00"

    customer = server.serialize_ar_customer(
        {"id": "customer", "status": "active"},
        {"name": "Customer", "active": True},
        server.Decimal("500.00"),
        on_account_credit=server.Decimal("1500.00"),
    )
    assert customer["outstanding_balance"] == "500.00"
    assert customer["receipts_on_account_balance"] == "1500.00"
    assert customer["current_balance"] == "-1000.00"


def test_subledger_line_balances_are_outstanding_items_not_running_balances():
    rows = [
        {"id": "payment", "invoice_balance": "-1500.00", "status": "posted"},
        {"id": "part-paid-invoice", "invoice_balance": "500.00", "status": "part_paid"},
        {"id": "allocated-payment", "invoice_balance": "0.00", "status": "posted"},
        {"id": "void", "invoice_balance": "100.00", "status": "void"},
    ]

    balance = server.apply_subledger_line_balances(rows)

    assert [row["line_balance"] for row in rows] == ["-1500.00", "500.00", "0.00", "0.00"]
    assert balance == server.Decimal("-1000.00")


def test_invoice_payment_display_is_allocation_and_line_balance_is_remainder():
    values = server.invoice_allocation_values(
        {"gross_amount": "2229.00", "status": "posted"},
        server.Decimal("891.60"),
    )

    assert values["invoice_value"] == "2229.00"
    assert values["paid_allocated"] == "891.60"
    assert values["invoice_balance"] == "1337.40"


def test_ap_approval_forwards_prior_period_vat_confirmation_payload(monkeypatch):
    captured = {}

    async def fake_get_invoice(session, client_id, invoice_id):
        return {"id": invoice_id, "status": "awaiting_approval"}

    async def fake_audit(*args, **kwargs):
        return None

    async def fake_post(client_id, invoice_id, payload, user, session):
        captured["payload"] = payload
        return {"ok": True}

    class FakeSession:
        async def execute(self, statement):
            return None

        async def flush(self):
            return None

    monkeypatch.setattr(server, "get_ap_invoice_or_404", fake_get_invoice)
    monkeypatch.setattr(server, "add_accounting_audit", fake_audit)
    monkeypatch.setattr(server, "post_ap_invoice", fake_post)
    confirmation = {"confirm_prior_period_vat_adjustment": True}

    result = asyncio.run(
        server.approve_ap_invoice(
            "client-1",
            "invoice-1",
            confirmation,
            {"id": "admin-1"},
            FakeSession(),
        )
    )

    assert result == {"ok": True}
    assert captured["payload"] == confirmation


def test_late_invoice_vat_adjustment_keeps_optional_user_comment(monkeypatch):
    audit_payloads = []

    async def fake_audit(*args):
        audit_payloads.append(args[-1])

    class FakeSession:
        async def execute(self, statement):
            return None

    monkeypatch.setattr(server, "add_accounting_audit", fake_audit)
    context = {
        "reported_period": {"id": "period-current"},
        "original_period": {"id": "period-closed"},
        "posting_date": "2026-07-25",
    }

    adjustment = asyncio.run(
        server.apply_confirmed_late_invoice_vat_adjustment(
            FakeSession(),
            "client-1",
            "ap_invoice",
            "invoice-1",
            "INV-1",
            "20% S",
            "100.00",
            "20.00",
            "120.00",
            context,
            "admin-1",
            "Invoice arrived after the return was submitted.",
        )
    )

    assert "Additional comment: Invoice arrived after the return was submitted." in adjustment["notes"]
    assert audit_payloads[-1]["additional_comment"] == "Invoice arrived after the return was submitted."
