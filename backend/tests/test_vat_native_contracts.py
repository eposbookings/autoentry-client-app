from backend import server
import asyncio


def test_vat_code_value_normalises_display_labels_to_code_only():
    assert server.vat_code_value("20% S - Standard rate") == "20% S"
    assert server.vat_code_value("5% R (5%)") == "5% R"
    assert server.vat_code_value("NO VAT") == "NO VAT"


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
    assert payload["label"] == "2026-01-01 to 2026-03-31"


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
