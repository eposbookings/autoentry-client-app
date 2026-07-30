from backend import server


def test_analytical_master_data_routes_are_registered():
    routes = {(route.path, method) for route in server.app.routes for method in getattr(route, "methods", set())}

    assert ("/api/admin/accounting/clients/{client_id}/locations", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/locations", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/locations/{location_id}", "PATCH") in routes
    assert ("/api/admin/accounting/clients/{client_id}/locations/{location_id}", "DELETE") in routes
    assert ("/api/admin/accounting/clients/{client_id}/dimension-types", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/dimensions", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/dimensions", "POST") in routes
    assert ("/api/admin/accounting/clients/{client_id}/dimensions/{dimension_id}", "PATCH") in routes
    assert ("/api/admin/accounting/clients/{client_id}/dimensions/{dimension_id}", "DELETE") in routes


def test_transaction_tables_expose_header_and_line_analytical_fields():
    header_tables = (
        server.accounting_ap_invoices,
        server.accounting_ap_credit_notes,
        server.accounting_ap_payments,
        server.accounting_ar_invoices,
        server.accounting_ar_credit_notes,
        server.accounting_ar_receipts,
        server.accounting_journal_entries,
        server.accounting_bank_transactions,
        server.accounting_bank_transfers,
    )
    line_tables = (
        server.accounting_ap_invoice_lines,
        server.accounting_ap_credit_note_lines,
        server.accounting_ar_invoice_lines,
        server.accounting_ar_credit_note_lines,
        server.accounting_journal_lines,
    )

    for table in header_tables:
        assert "default_location_id" in table.c
        assert "default_dimension_id" in table.c
    for table in line_tables:
        assert "location_id" in table.c
        assert "dimension_id" in table.c


def test_ap_and_ar_line_normalisation_preserves_analytical_overrides():
    source = {
        "description": "Tracked line",
        "nominal_account_code": "5000",
        "net_amount": "100.00",
        "vat_amount": "20.00",
        "gross_amount": "120.00",
        "location_id": "location-1",
        "dimension_id": "dimension-1",
    }

    for values in (server.ap_line_values(source, "5000"), server.ar_line_values(source, "4000")):
        assert values["location_id"] == "location-1"
        assert values["dimension_id"] == "dimension-1"
