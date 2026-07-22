from fastapi import HTTPException

from backend import server


def raises_http_exception(fn):
    try:
        fn()
    except HTTPException as exc:
        return exc
    raise AssertionError("Expected HTTPException")


def test_bank_account_card_masks_account_and_defaults_contract_fields():
    row = {
        "id": "bank-1",
        "account_name": "Current",
        "bank_name": "Test Bank",
        "account_number": "12345678",
        "sort_code": "00-00-00",
        "nominal_account_code": "1200",
        "currency": "GBP",
        "active": True,
        "allow_payments": True,
        "allow_receipts": True,
        "default_account": True,
    }

    card = server.serialize_bank_account(row, server.Decimal("42.50"), server.Decimal("40.00"))

    assert card["account_number_masked"] == "****5678"
    assert card["current_balance"] == "42.50"
    assert card["reconciled_balance"] == "40.00"
    assert card["unreconciled_count"] == 0
    assert card["status"] == "active"


def test_chart_account_banking_aliases_force_bank_compatible_fields():
    values = {
        "banking_enabled": server.payload_bool_alias({"show_in_banking_page": "true"}, ("banking_enabled", "show_in_banking", "show_in_banking_page")),
        "category": "Expense",
        "account_type": "Overheads",
        "purpose": "Standard Nominal",
        "normal_balance": "credit",
    }

    forced = server.apply_banking_account_defaults(values)

    assert forced["banking_enabled"] is True
    assert forced["category"] == "Asset"
    assert forced["purpose"] == "Bank Account"
    assert forced["normal_balance"] == "debit"
    assert forced["account_type"] == "Bank"


def test_bank_cards_are_sourced_from_chart_accounts_with_legacy_metadata():
    accounts = [
        {"id": "acct-1200", "code": "1200", "name": "Main Bank", "account_type": "Bank", "purpose": "Bank Account", "active": True, "banking_enabled": True},
        {"id": "acct-5000", "code": "5000", "name": "Purchases", "account_type": "Purchases", "purpose": "Standard Nominal", "active": True, "banking_enabled": False},
    ]
    metadata = [{"id": "bank-legacy", "nominal_account_code": "1200", "account_name": "Current Account", "account_number": "12345678", "active": True, "default_account": True}]

    cards = server.build_bank_account_cards(accounts, metadata)

    assert len(cards) == 1
    assert cards[0]["id"] == "bank-legacy"
    assert cards[0]["account_id"] == "acct-1200"
    assert cards[0]["banking_enabled"] is True
    assert server.bank_card_matches_id(cards[0], "acct-1200")
    assert server.bank_card_matches_id(cards[0], "1200")


def test_money_out_cannot_be_income_or_customer_receipt():
    transaction = {"money_in": "0.00", "money_out": "25.00"}

    exc = raises_http_exception(lambda: server.require_bank_transaction_direction(transaction, "money_in"))

    assert exc.status_code == 400


def test_money_in_cannot_be_expense_or_supplier_payment():
    transaction = {"money_in": "25.00", "money_out": "0.00"}

    exc = raises_http_exception(lambda: server.require_bank_transaction_direction(transaction, "money_out"))

    assert exc.status_code == 400


def test_bank_transfer_suggestion_is_exposed_for_matching_account_and_amount():
    transaction = {"id": "txn-1", "bank_account_id": "bank-1", "money_in": "100.00", "money_out": "0.00", "description": "Transfer"}
    transfers = [{"id": "tr-1", "from_bank_account_id": "bank-2", "to_bank_account_id": "bank-1", "amount": "100.00", "reference": "Savings"}]

    suggestions = server.suggest_bank_matches(transaction, [], [], [], [], [], transfers)

    assert suggestions[0]["type"] == "bank_transfer"
    assert suggestions[0]["record_id"] == "tr-1"


def test_reconciliation_status_filter_includes_documentation_requested_only_until_reconciled():
    included = ["unreconciled", "pending", "awaiting_match", "unmatched", "imported", "documentation_requested"]
    excluded = ["matched", "reconciled", "ignored", "archived"]

    assert all(server.is_bank_reconciliation_line({"status": status}) for status in included)
    assert not any(server.is_bank_reconciliation_line({"status": status}) for status in excluded)
    assert not server.is_bank_reconciliation_line({"status": "unreconciled", "ignored": True})


def test_bank_import_counts_all_statement_statuses():
    bank_import = {"id": "imp-1", "rows_imported": 4, "duplicates": 1, "raw_summary": "{}"}
    transactions = [
        {"id": "t1", "import_id": "imp-1", "status": "unreconciled", "money_in": "1.00", "money_out": "0.00"},
        {"id": "t2", "import_id": "imp-1", "status": "documentation_requested", "money_in": "0.00", "money_out": "2.00"},
        {"id": "t3", "import_id": "imp-1", "status": "reconciled", "money_in": "3.00", "money_out": "0.00"},
        {"id": "t4", "import_id": "imp-1", "status": "ignored", "money_in": "0.00", "money_out": "4.00"},
    ]

    counted = server.bank_import_with_counts(bank_import, transactions)

    assert counted["rows_unreconciled"] == 2
    assert counted["rows_reconciled"] == 1
    assert counted["rows_ignored"] == 1
    assert len(counted["lines"]) == 4


def test_suggested_bank_line_uses_outstanding_account_record_amount():
    record = {"reference": "INV-10", "contact_name": "Acme", "outstanding_amount": "85.08"}
    bank_lines = [
        {"id": "bank-1", "status": "unreconciled", "money_in": "0.00", "money_out": "85.08", "description": "Acme INV-10"},
        {"id": "bank-2", "status": "reconciled", "money_in": "0.00", "money_out": "85.08", "description": "Acme INV-10"},
    ]

    suggestion = server.suggested_bank_line_for_record(record, bank_lines, "money_out")

    assert suggestion["bank_transaction_id"] == "bank-1"
    assert suggestion["confidence"] >= 55


def test_bank_line_suggestions_reference_real_account_transactions_only():
    transaction = {"id": "bank-1", "money_in": "0.00", "money_out": "85.08", "description": "Acme INV-10"}
    account_transactions = [
        {"id": "ap_invoice:inv-10", "linked_record_type": "ap_invoice", "linked_record_id": "inv-10", "contact_name": "Acme", "reference": "INV-10", "outstanding_amount": "85.08"},
        {"id": "ar_invoice:sinv-1", "linked_record_type": "ar_invoice", "linked_record_id": "sinv-1", "contact_name": "Acme", "reference": "SINV-1", "outstanding_amount": "85.08"},
    ]

    suggestions = server.account_transaction_match_suggestions(transaction, account_transactions)

    assert len(suggestions) == 1
    assert suggestions[0]["match_type"] == "ap_invoice"
    assert suggestions[0]["record_id"] == "inv-10"
    assert suggestions[0]["account_transaction_id"] == "ap_invoice:inv-10"


def test_find_account_transaction_row_supports_account_transaction_id_or_record_id():
    rows = [{"id": "ap_invoice:inv-10", "linked_record_type": "ap_invoice", "linked_record_id": "inv-10"}]

    assert server.find_account_transaction_row(rows, "", "", "ap_invoice:inv-10") == rows[0]
    assert server.find_account_transaction_row(rows, "ap_invoice", "inv-10") == rows[0]
    assert server.find_account_transaction_row(rows, "ar_invoice", "inv-10") is None


def test_pagination_contract_clamps_page_size_and_reports_total_pages():
    page, page_size = server.pagination_params(0, 999)

    payload = server.paginated_payload([{"id": "row-1"}], page, page_size, 501, {"count": 501})

    assert page == 1
    assert page_size == 250
    assert payload["rows"] == [{"id": "row-1"}]
    assert payload["page"] == 1
    assert payload["page_size"] == 250
    assert payload["total_rows"] == 501
    assert payload["total_pages"] == 3
    assert payload["summary"] == {"count": 501}


def test_bank_account_transaction_conditions_support_metadata_id_account_id_and_code():
    card = {"id": "bank-1", "bank_account_id": "meta-1", "account_id": "acct-1200", "nominal_account_code": "1200"}

    conditions = server.bank_account_transaction_conditions(card)

    assert len(conditions) == 1


def test_filter_ledger_rows_uses_filters_before_pagination_summary():
    rows = [
        {"date": "2026-01-01", "type": "invoice", "status": "posted", "reference": "INV-1", "description": "Alpha"},
        {"date": "2026-01-02", "type": "payment", "status": "posted", "reference": "PAY-1", "description": "Alpha"},
        {"date": "2026-01-03", "type": "invoice", "status": "draft", "reference": "INV-2", "description": "Beta"},
    ]

    filtered = server.filter_ledger_rows(rows, "alpha", "posted", "invoice", "2026-01-01", "2026-01-31")

    assert filtered == [rows[0]]
