from backend import server


def account(code, name, category, account_type, purpose=""):
    return {
        "code": code,
        "name": name,
        "category": category,
        "account_type": account_type,
        "purpose": purpose,
    }


def test_uk_profit_and_loss_sections_keep_tax_below_profit_before_tax():
    assert server.financial_statement_account_section(
        account("4000", "Sales", "Income", "Income")
    ) == "turnover"
    assert server.financial_statement_account_section(
        account("5000", "Purchases", "Expense", "Cost of Sales")
    ) == "cost_of_sales"
    assert server.financial_statement_account_section(
        account("6240", "UK Corporation Tax", "Expense", "Expenses", "Taxes Paid")
    ) == "tax_on_profit"


def test_dividends_are_presented_as_an_equity_distribution_not_an_expense():
    assert server.financial_statement_account_section(
        account("7510", "Dividend", "Expense", "Other Expense")
    ) == "dividends"


def test_finance_and_balance_sheet_accounts_are_classified_separately():
    assert server.financial_statement_account_section(
        account("4900", "Bank interest - received", "Income", "Other Income", "Interest earned")
    ) == "finance_income"
    assert server.financial_statement_account_section(
        account("7000", "Bank charges", "Expense", "Expenses", "Finance costs")
    ) == "finance_costs"
    assert server.financial_statement_account_section(
        account("2300", "Corporation tax payable", "Liability", "Tax", "Corporation Tax")
    ) == "liabilities"


def test_profit_and_loss_and_balance_sheet_have_standalone_routes():
    routes = {(route.path, method) for route in server.app.routes for method in getattr(route, "methods", set())}

    assert ("/api/admin/accounting/clients/{client_id}/reports/profit-and-loss", "GET") in routes
    assert ("/api/admin/accounting/clients/{client_id}/reports/balance-sheet", "GET") in routes
