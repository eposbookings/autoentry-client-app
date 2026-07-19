"""Populate clean demo data for the existing DEMO LIMITED client.

Manual-only script. It is intentionally not imported by the app startup and is
not wired into deployment. Run it on the VPS only when you want to refresh the
demo client data:

    docker compose exec -T api python scripts/populate_demo_limited_data.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import insert, select, update

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server as app  # noqa: E402


DEMO_EMAIL = "devis@yopmail.com"
DEMO_BUSINESS_NAME = "DEMO LIMITED"


def demo_id(client_id: str, key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"epos-demo-limited:{client_id}:{key}"))


def now() -> str:
    return app.utc_now_iso()


def as_money(value: str | float | int | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def table_values(table: Any, row: dict[str, Any]) -> dict[str, Any]:
    allowed = {column.name for column in table.c}
    return {key: value for key, value in row.items() if key in allowed}


async def upsert_by_id(session: Any, table: Any, row: dict[str, Any]) -> None:
    values = table_values(table, row)
    row_id = values["id"]
    existing = await session.execute(select(table.c.id).where(table.c.id == row_id))
    if existing.scalar_one_or_none():
        update_values = {key: value for key, value in values.items() if key != "id"}
        if update_values:
            await session.execute(update(table).where(table.c.id == row_id).values(**update_values))
    else:
        await session.execute(insert(table).values(**values))


async def upsert_where(session: Any, table: Any, where_clause: Any, row: dict[str, Any]) -> None:
    values = table_values(table, row)
    existing = await session.execute(select(table.c.id).where(where_clause))
    existing_id = existing.scalar_one_or_none()
    if existing_id:
        update_values = {key: value for key, value in values.items() if key != "id"}
        if update_values:
            await session.execute(update(table).where(table.c.id == existing_id).values(**update_values))
    else:
        await session.execute(insert(table).values(**values))


async def upsert_account(
    session: Any,
    client_id: str,
    code: str,
    name: str,
    category: str,
    account_type: str,
    purpose: str,
    normal_balance: str,
    control_account: bool = False,
) -> None:
    await upsert_where(
        session,
        app.accounting_accounts,
        (app.accounting_accounts.c.client_id == client_id) & (app.accounting_accounts.c.code == code),
        {
            "id": demo_id(client_id, f"account:{code}"),
            "client_id": client_id,
            "code": code,
            "name": name,
            "category": category,
            "account_type": account_type,
            "purpose": purpose,
            "normal_balance": normal_balance,
            "control_account": control_account,
            "is_control_account": control_account,
            "active": True,
            "current_balance": as_money("0.00"),
            "created_at": now(),
            "updated_at": now(),
        },
    )


async def find_demo_client(session: Any) -> dict[str, Any]:
    result = await session.execute(
        select(app.users).where(app.users.c.email == DEMO_EMAIL)
    )
    client = result.mappings().first()
    if client:
        return dict(client)

    result = await session.execute(
        select(app.users).where(app.users.c.business_name == DEMO_BUSINESS_NAME)
    )
    client = result.mappings().first()
    if not client:
        raise RuntimeError(
            f"Could not find existing {DEMO_BUSINESS_NAME} client. "
            "Create the client in the UI first, then rerun this script."
        )
    return dict(client)


async def update_client_profile(session: Any, client_id: str) -> None:
    service_settings = {
        "Accounts": {"enabled": True, "price": "900.00"},
        "CT600 Return": {"enabled": True, "price": "450.00"},
        "Bookkeeping": {"enabled": True, "price": "250.00"},
        "VAT Returns": {"enabled": True, "price": "180.00"},
        "Payroll": {"enabled": True, "price": "95.00"},
        "Confirmation Statement": {"enabled": True, "price": "120.00"},
        "Management Accounts": {"enabled": False, "price": "350.00"},
    }
    deadline_tasks = [
        {
            "id": "demo-accounts-2027",
            "service": "Accounts",
            "title": "Accounts deadline",
            "start_date": "2027-05-01",
            "due_date": "2028-01-31",
            "status": "open",
            "source": "Companies House",
        },
        {
            "id": "demo-ct600-2027",
            "service": "CT600 Return",
            "title": "CT600 Return deadline",
            "start_date": "2027-05-01",
            "due_date": "2028-04-30",
            "status": "open",
            "source": "HMRC rule",
        },
        {
            "id": "demo-vat-2026-q2",
            "service": "VAT Returns",
            "title": "VAT return deadline",
            "start_date": "2026-07-01",
            "due_date": "2026-08-07",
            "status": "open",
            "source": "VAT schedule",
        },
    ]
    statutory_deadlines = {
        "accounts": {
            "next_accounts_made_up_to": "2027-04-30",
            "accounts_due": "2028-01-31",
            "last_accounts_made_up_to": "2026-04-30",
        },
        "confirmation_statement": {
            "next_statement_date": "2027-01-20",
            "confirmation_statement_due": "2027-02-03",
            "last_statement_date": "2026-01-20",
        },
    }
    directors = [
        {
            "name": "Andrew Charles Hibbert",
            "role": "Director",
            "appointed_on": "2020-04-27",
            "nationality": "British",
        }
    ]

    await session.execute(
        update(app.users)
        .where(app.users.c.id == client_id)
        .values(
            business_name=DEMO_BUSINESS_NAME,
            first_name="Andrew Charles",
            last_name="Hibbert",
            client_type="Limited company",
            industry="Software and accounting services",
            company_number="12575164",
            company_status="active",
            incorporation_date="2020-04-27",
            registered_office_address="16d Calderdale Business Park, Club Lane, Halifax, HX2 8DB",
            trading_address="16d Calderdale Business Park, Club Lane, Halifax, HX2 8DB",
            phone="01422 000000",
            vat_number="GB 220 4302 31",
            utr="12345 67890",
            year_end="30/04",
            practice_manager="EPOS Accountancy",
            main_contact_name="Andrew Charles Hibbert",
            main_contact_role="Director",
            company_directors=json.dumps(directors),
            company_pscs=json.dumps(directors),
            company_contacts=json.dumps(
                [
                    {
                        "name": "Andrew Charles Hibbert",
                        "role": "Director",
                        "email": DEMO_EMAIL,
                        "phone": "01422 000000",
                    }
                ]
            ),
            companies_house_filings=json.dumps(
                [
                    {
                        "date": "2026-06-14",
                        "description": "Accounts for a small company made up to 30 April 2026",
                        "type": "AA",
                    },
                    {
                        "date": "2026-02-04",
                        "description": "Confirmation statement made on 20 January 2026",
                        "type": "CS01",
                    },
                ]
            ),
            services_required=json.dumps(list(service_settings.keys())),
            service_settings=json.dumps(service_settings),
            statutory_deadlines=json.dumps(statutory_deadlines),
            deadline_tasks=json.dumps(deadline_tasks),
            autoentry_email=DEMO_EMAIL,
            sales_autoentry_email="sales-demo@yopmail.com",
            is_vat_client=True,
            ai_analysis_enabled=True,
            accounting_destination="native",
            native_accounting_enabled=True,
            native_accounting_created_at=now(),
            status="active",
        )
    )


async def populate_accounting_foundation(session: Any, client_id: str) -> None:
    accounts = [
        ("1100", "Trade Debtors", "Asset", "Current Asset", "Sales Ledger", "debit", True),
        ("1200", "Business Current Account", "Asset", "Bank", "Bank Account", "debit", True),
        ("1210", "Savings Account", "Asset", "Bank", "Bank Account", "debit", False),
        ("2100", "Trade Creditors", "Liability", "Current Liability", "Purchase Ledger", "credit", True),
        ("2200", "VAT Control", "Liability", "Current Liability", "VAT Control", "credit", True),
        ("2210", "PAYE Control", "Liability", "Current Liability", "Payroll Control", "credit", True),
        ("3000", "Ordinary Share Capital", "Equity", "Equity", "Standard Nominal", "credit", False),
        ("3200", "Retained Earnings", "Equity", "Equity", "Retained Earnings", "credit", True),
        ("4000", "Sales", "Income", "Sales", "Standard Nominal", "credit", False),
        ("4010", "Consultancy Income", "Income", "Sales", "Standard Nominal", "credit", False),
        ("5000", "Purchases", "Expense", "Direct Cost", "Standard Nominal", "debit", False),
        ("6200", "Software Subscriptions", "Expense", "Overhead", "Standard Nominal", "debit", False),
        ("7200", "Travel and Motor", "Expense", "Overhead", "Standard Nominal", "debit", False),
        ("7500", "Bank Charges", "Expense", "Overhead", "Standard Nominal", "debit", False),
        ("9999", "Suspense", "Asset", "Current Asset", "Suspense", "debit", True),
    ]
    for account in accounts:
        await upsert_account(session, client_id, *account)

    await upsert_where(
        session,
        app.accounting_settings,
        app.accounting_settings.c.client_id == client_id,
        {
            "id": demo_id(client_id, "accounting-settings"),
            "client_id": client_id,
            "default_sales_account": "4000",
            "default_purchase_account": "5000",
            "default_vat_control_account": "2200",
            "default_bank_account": "1200",
            "default_suspense_account": "9999",
            "default_debtors_control_account": "1100",
            "default_creditors_control_account": "2100",
            "default_retained_earnings_account": "3200",
            "created_at": now(),
            "updated_at": now(),
        },
    )

    vat_codes = [
        ("20.0% S", "Standard rate", "20.00"),
        ("0.0% Z", "Zero-rated", "0.00"),
        ("Exempt", "Exempt from VAT", "0.00"),
        ("No VAT", "No VAT applicable", "0.00"),
    ]
    for code, description, percentage in vat_codes:
        await upsert_where(
            session,
            app.accounting_vat_codes,
            (app.accounting_vat_codes.c.client_id == client_id) & (app.accounting_vat_codes.c.code == code),
            {
                "id": demo_id(client_id, f"vat:{code}"),
                "client_id": client_id,
                "code": code,
                "description": description,
                "percentage": as_money(percentage),
                "purchase_behavior": "standard" if percentage != "0.00" else "zero",
                "sales_behavior": "standard" if percentage != "0.00" else "zero",
                "box_sales_vat": "1",
                "box_purchase_vat": "4",
                "box_sales_net": "6",
                "box_purchase_net": "7",
                "active": True,
                "system_code": True,
                "created_at": now(),
                "updated_at": now(),
            },
        )


async def populate_contacts(session: Any, client_id: str) -> dict[str, str]:
    contacts = {
        "supplier_amazon": ("supplier", "Amazon Business", "accounts@amazon.example", "5000"),
        "supplier_tesco": ("supplier", "Tesco Stores Ltd", "invoices@tesco.example", "7200"),
        "supplier_bjl": ("supplier", "BJL Skip Hire", "accounts@bjl.example", "5000"),
        "supplier_sage": ("supplier", "Sage UK Ltd", "billing@sage.example", "6200"),
        "customer_alpha": ("customer", "Alpha Retail Ltd", "accounts@alpha.example", "4000"),
        "customer_green": ("customer", "Green Plate Training", "finance@greenplate.example", "4010"),
        "customer_premium": ("customer", "Premium Renovations", "accounts@premium.example", "4000"),
    }
    ids: dict[str, str] = {}
    for key, (contact_type, name, email, account_code) in contacts.items():
        contact_id = demo_id(client_id, f"contact:{key}")
        ids[key] = contact_id
        await upsert_by_id(
            session,
            app.accounting_contacts,
            {
                "id": contact_id,
                "client_id": client_id,
                "contact_type": contact_type,
                "name": name,
                "email": email,
                "external_id": f"demo-{key}",
                "account_code": account_code,
                "active": True,
                "raw_json": json.dumps({"demo": True, "source": "manual demo data"}),
                "created_at": now(),
                "updated_at": now(),
            },
        )

    supplier_profiles = [
        ("supplier_amazon", "SUP-001", "Amazon Business", "6200", "20.0% S"),
        ("supplier_tesco", "SUP-002", "Tesco Stores Ltd", "7200", "20.0% S"),
        ("supplier_bjl", "SUP-003", "BJL Skip Hire", "5000", "20.0% S"),
        ("supplier_sage", "SUP-004", "Sage UK Ltd", "6200", "20.0% S"),
    ]
    for key, code, trading_name, purchase_account, vat_code in supplier_profiles:
        await upsert_by_id(
            session,
            app.accounting_ap_supplier_profiles,
            {
                "id": demo_id(client_id, f"supplier-profile:{key}"),
                "client_id": client_id,
                "contact_id": ids[key],
                "supplier_code": code,
                "trading_name": trading_name,
                "payment_terms_days": 30,
                "default_currency": "GBP",
                "default_purchase_account": purchase_account,
                "default_vat_code": vat_code,
                "status": "active",
                "notes": "Demo supplier profile.",
                "created_at": now(),
                "updated_at": now(),
            },
        )

    customer_profiles = [
        ("customer_alpha", "CUS-001", "Alpha Retail Ltd", "4000", "20.0% S"),
        ("customer_green", "CUS-002", "Green Plate Training", "4010", "20.0% S"),
        ("customer_premium", "CUS-003", "Premium Renovations", "4000", "20.0% S"),
    ]
    for key, code, trading_name, sales_account, vat_code in customer_profiles:
        await upsert_by_id(
            session,
            app.accounting_ar_customer_profiles,
            {
                "id": demo_id(client_id, f"customer-profile:{key}"),
                "client_id": client_id,
                "contact_id": ids[key],
                "customer_code": code,
                "trading_name": trading_name,
                "payment_terms_days": 14,
                "default_currency": "GBP",
                "default_sales_account": sales_account,
                "default_vat_code": vat_code,
                "credit_limit": as_money("5000.00"),
                "status": "active",
                "notes": "Demo customer profile.",
                "created_at": now(),
                "updated_at": now(),
            },
        )
    return ids


async def populate_outstanding_items(session: Any, client_id: str) -> None:
    items = [
        ("purchase", "Amazon Business laptop stand", "2026-07-01", "54.99"),
        ("purchase", "Tesco fuel receipt", "2026-07-02", "76.20"),
        ("purchase", "BJL Skip Hire invoice", "2026-07-03", "290.00"),
        ("purchase", "Sage subscription", "2026-07-04", "43.20"),
        ("purchase", "Stripe fees receipt", "2026-07-05", "18.64"),
        ("purchase", "BT broadband", "2026-07-06", "48.00"),
        ("purchase", "Stationery order", "2026-07-07", "32.50"),
        ("sales", "Website support April", "2026-07-01", "360.00"),
        ("sales", "Monthly bookkeeping", "2026-07-05", "300.00"),
        ("sales", "VAT review", "2026-07-08", "180.00"),
        ("sales", "Payroll recharge", "2026-07-10", "114.00"),
    ]
    for index, (item_type, description, item_date, amount) in enumerate(items, start=1):
        await upsert_by_id(
            session,
            app.outstanding_items,
            {
                "id": demo_id(client_id, f"outstanding:{index}"),
                "client_id": client_id,
                "type": item_type,
                "description": description,
                "date": item_date,
                "amount": as_money(amount),
                "status": "outstanding",
                "created_at": now(),
            },
        )


async def populate_ap(session: Any, client_id: str, contacts: dict[str, str]) -> None:
    invoices = [
        ("amazon", "supplier_amazon", "AMZ-1001", "Amazon Business laptop stand", "2026-07-01", "45.82", "9.17", "54.99", "posted", "6200"),
        ("tesco", "supplier_tesco", "TES-7782", "Tesco fuel receipt", "2026-07-02", "63.50", "12.70", "76.20", "approved", "7200"),
        ("bjl", "supplier_bjl", "BJL105", "8 Yard skip", "2026-07-03", "241.67", "48.33", "290.00", "posted", "5000"),
        ("sage", "supplier_sage", "SAGE-INV-221", "Sage subscription", "2026-07-04", "36.00", "7.20", "43.20", "paid", "6200"),
    ]
    for key, contact_key, invoice_number, description, invoice_date, net, vat, gross, status, account_code in invoices:
        invoice_id = demo_id(client_id, f"ap-invoice:{key}")
        supplier_id = demo_id(client_id, f"supplier-profile:{contact_key}")
        await upsert_by_id(
            session,
            app.accounting_ap_invoices,
            {
                "id": invoice_id,
                "client_id": client_id,
                "supplier_id": supplier_id,
                "contact_id": contacts[contact_key],
                "invoice_number": invoice_number,
                "reference": invoice_number,
                "invoice_date": invoice_date,
                "due_date": str(date.fromisoformat(invoice_date) + timedelta(days=30)),
                "currency": "GBP",
                "status": status,
                "net_amount": as_money(net),
                "vat_amount": as_money(vat),
                "gross_amount": as_money(gross),
                "outstanding_amount": as_money("0.00") if status == "paid" else as_money(gross),
                "extracted_json": json.dumps({"demo": True, "description": description}),
                "created_at": now(),
                "updated_at": now(),
            },
        )
        await upsert_by_id(
            session,
            app.accounting_ap_invoice_lines,
            {
                "id": demo_id(client_id, f"ap-line:{key}:1"),
                "client_id": client_id,
                "invoice_id": invoice_id,
                "line_number": 1,
                "description": description,
                "nominal_account_code": account_code,
                "quantity": as_money("1.00"),
                "unit_price": as_money(net),
                "discount_amount": as_money("0.00"),
                "vat_code": "20.0% S",
                "net_amount": as_money(net),
                "vat_amount": as_money(vat),
                "gross_amount": as_money(gross),
                "created_at": now(),
                "updated_at": now(),
            },
        )


async def populate_ar(session: Any, client_id: str, contacts: dict[str, str]) -> None:
    invoices = [
        ("alpha", "customer_alpha", "SI-1001", "Website support April", "2026-07-01", "300.00", "60.00", "360.00", "posted", "4000"),
        ("green", "customer_green", "SI-1002", "Training bookkeeping review", "2026-07-05", "250.00", "50.00", "300.00", "part_paid", "4010"),
        ("premium", "customer_premium", "SI-1003", "VAT review", "2026-07-08", "150.00", "30.00", "180.00", "draft", "4000"),
    ]
    for key, contact_key, invoice_number, description, invoice_date, net, vat, gross, status, account_code in invoices:
        invoice_id = demo_id(client_id, f"ar-invoice:{key}")
        customer_id = demo_id(client_id, f"customer-profile:{contact_key}")
        outstanding = "120.00" if status == "part_paid" else ("0.00" if status == "paid" else gross)
        await upsert_by_id(
            session,
            app.accounting_ar_invoices,
            {
                "id": invoice_id,
                "client_id": client_id,
                "customer_id": customer_id,
                "contact_id": contacts[contact_key],
                "invoice_number": invoice_number,
                "reference": invoice_number,
                "invoice_date": invoice_date,
                "due_date": str(date.fromisoformat(invoice_date) + timedelta(days=14)),
                "currency": "GBP",
                "status": status,
                "net_amount": as_money(net),
                "vat_amount": as_money(vat),
                "gross_amount": as_money(gross),
                "outstanding_amount": as_money(outstanding),
                "extracted_json": json.dumps({"demo": True, "description": description}),
                "created_at": now(),
                "updated_at": now(),
            },
        )
        await upsert_by_id(
            session,
            app.accounting_ar_invoice_lines,
            {
                "id": demo_id(client_id, f"ar-line:{key}:1"),
                "client_id": client_id,
                "invoice_id": invoice_id,
                "line_number": 1,
                "description": description,
                "nominal_account_code": account_code,
                "quantity": as_money("1.00"),
                "unit_price": as_money(net),
                "discount_amount": as_money("0.00"),
                "vat_code": "20.0% S",
                "net_amount": as_money(net),
                "vat_amount": as_money(vat),
                "gross_amount": as_money(gross),
                "created_at": now(),
                "updated_at": now(),
            },
        )


async def populate_banking(session: Any, client_id: str) -> None:
    current_id = demo_id(client_id, "bank-account:current")
    savings_id = demo_id(client_id, "bank-account:savings")
    bank_accounts = [
        (current_id, "Business Current Account", "Demo Bank", "12345678", "20-00-00", "1200", "11250.45", True),
        (savings_id, "Savings Account", "Demo Bank", "87654321", "20-00-01", "1210", "2500.00", False),
    ]
    for account_id, name, bank_name, account_number, sort_code, nominal, balance, default_account in bank_accounts:
        await upsert_by_id(
            session,
            app.accounting_bank_accounts,
            {
                "id": account_id,
                "client_id": client_id,
                "account_name": name,
                "bank_name": bank_name,
                "account_number": account_number,
                "sort_code": sort_code,
                "currency": "GBP",
                "nominal_account_code": nominal,
                "opening_balance": as_money("10000.00" if default_account else "2500.00"),
                "current_balance": as_money(balance),
                "reconciled_balance": as_money("10975.45" if default_account else "2500.00"),
                "default_account": default_account,
                "allow_payments": True,
                "allow_receipts": True,
                "active": True,
                "created_at": now(),
                "updated_at": now(),
            },
        )

    transactions = [
        ("2026-07-01", "ALPHA RETAIL LTD SI-1001", "SI-1001", "Customer Receipt", "360.00", "0.00", "matched", "Sales invoice SI-1001"),
        ("2026-07-02", "AMAZON BUSINESS AMZ-1001", "AMZ-1001", "Supplier Payment", "0.00", "54.99", "matched", "Purchase invoice AMZ-1001"),
        ("2026-07-03", "TESCO STORES FUEL", "TES-7782", "Supplier Payment", "0.00", "76.20", "unreconciled", ""),
        ("2026-07-04", "SAGE UK LTD", "SAGE-INV-221", "Supplier Payment", "0.00", "43.20", "matched", "Purchase invoice SAGE-INV-221"),
        ("2026-07-05", "BANK CHARGES", "BANK-FEE", "Bank Charge", "0.00", "8.50", "posted", "Bank charges"),
        ("2026-07-06", "GREEN PLATE TRAINING PART PAYMENT", "SI-1002", "Customer Receipt", "180.00", "0.00", "matched", "Sales invoice SI-1002"),
    ]
    balance = Decimal("11250.45")
    for index, (txn_date, description, reference, txn_type, money_in, money_out, status, matched_to) in enumerate(transactions, start=1):
        await upsert_by_id(
            session,
            app.accounting_bank_transactions,
            {
                "id": demo_id(client_id, f"bank-transaction:{index}"),
                "client_id": client_id,
                "bank_account_id": current_id,
                "bank_account_code": "1200",
                "transaction_date": txn_date,
                "description": description,
                "reference": reference,
                "transaction_type": txn_type,
                "source_type": "demo",
                "money_in": as_money(money_in),
                "money_out": as_money(money_out),
                "balance": balance,
                "status": status,
                "matched_to": matched_to,
                "suggested_match": matched_to,
                "confidence": as_money("0.94" if matched_to else "0.62"),
                "ignored": False,
                "matched_account_code": "1200",
                "raw_json": json.dumps({"demo": True}),
                "created_at": now(),
                "updated_at": now(),
            },
        )


async def populate_periods_assets_and_audit(session: Any, client_id: str) -> None:
    fy_id = demo_id(client_id, "financial-year:2026")
    await upsert_by_id(
        session,
        app.accounting_financial_years,
        {
            "id": fy_id,
            "client_id": client_id,
            "name": "FY 2026/27",
            "start_date": "2026-05-01",
            "end_date": "2027-04-30",
            "status": "open",
            "created_at": now(),
            "updated_at": now(),
        },
    )
    start = date(2026, 5, 1)
    for period_number in range(1, 13):
        period_start = date(start.year + ((start.month + period_number - 2) // 12), ((start.month + period_number - 2) % 12) + 1, 1)
        next_month = date(period_start.year + (period_start.month // 12), (period_start.month % 12) + 1, 1)
        period_end = next_month - timedelta(days=1)
        await upsert_by_id(
            session,
            app.accounting_periods,
            {
                "id": demo_id(client_id, f"period:{period_number}"),
                "client_id": client_id,
                "financial_year_id": fy_id,
                "period_name": period_start.strftime("%b %Y"),
                "period_number": period_number,
                "period_start": str(period_start),
                "period_end": str(period_end),
                "status": "open",
                "transactions_posted": 12 + period_number,
                "notes": "Demo accounting period.",
                "created_at": now(),
                "updated_at": now(),
            },
        )

    vat_periods = [
        ("2026-05-01", "2026-07-31", "2026-09-07", "open", "140.00", "137.40"),
        ("2026-02-01", "2026-04-30", "2026-06-07", "closed", "620.00", "311.55"),
    ]
    for index, (period_start, period_end, due_date, status, output_vat, input_vat) in enumerate(vat_periods, start=1):
        await upsert_by_id(
            session,
            app.accounting_vat_periods,
            {
                "id": demo_id(client_id, f"vat-period:{index}"),
                "client_id": client_id,
                "period_start": period_start,
                "period_end": period_end,
                "due_date": due_date,
                "status": status,
                "output_vat": as_money(output_vat),
                "input_vat": as_money(input_vat),
                "net_vat": as_money(Decimal(output_vat) - Decimal(input_vat)),
                "transaction_count": 18 if status == "open" else 42,
                "created_at": now(),
                "updated_at": now(),
            },
        )

    assets = [
        ("FA-001", "Dell Laptop", "Computer Equipment", "2026-05-15", "950.00", "190.00", "760.00"),
        ("FA-002", "Office Desk Setup", "Furniture & Fixtures", "2026-06-10", "640.00", "64.00", "576.00"),
    ]
    for code, name, category, purchase_date, cost, depreciation, nbv in assets:
        await upsert_by_id(
            session,
            app.accounting_fixed_assets,
            {
                "id": demo_id(client_id, f"asset:{code}"),
                "client_id": client_id,
                "asset_code": code,
                "asset_name": name,
                "description": name,
                "category_name": category,
                "location": "Main office",
                "purchase_date": purchase_date,
                "in_service_date": purchase_date,
                "capitalisation_date": purchase_date,
                "purchase_cost": as_money(cost),
                "residual_value": as_money("0.00"),
                "useful_life_months": 36,
                "depreciation_method": "Straight Line",
                "depreciation_frequency": "Monthly",
                "fixed_asset_account": "1500",
                "accumulated_depreciation_account": "1510",
                "depreciation_expense_account": "8000",
                "accumulated_depreciation": as_money(depreciation),
                "net_book_value": as_money(nbv),
                "status": "active",
                "notes": "Demo fixed asset.",
                "created_at": now(),
                "updated_at": now(),
            },
        )

    audit_events = [
        ("Practice", "Client", "profile-updated", "Demo profile refreshed"),
        ("Accounts Payable", "Purchase Invoice", "posted", "Purchase invoice AMZ-1001 posted"),
        ("Accounts Receivable", "Sales Invoice", "posted", "Sales invoice SI-1001 posted"),
        ("Banking", "Bank Transaction", "matched", "Receipt matched to SI-1001"),
        ("VAT", "VAT Period", "generated", "VAT period generated"),
    ]
    for index, (module, record_type, action, detail) in enumerate(audit_events, start=1):
        await upsert_by_id(
            session,
            app.accounting_audit_log,
            {
                "id": demo_id(client_id, f"audit:{index}"),
                "client_id": client_id,
                "module": module,
                "record_type": record_type,
                "record_id": demo_id(client_id, f"audit-record:{index}"),
                "action": action,
                "entity_type": record_type,
                "entity_id": demo_id(client_id, f"audit-record:{index}"),
                "details_json": json.dumps({"demo": True, "message": detail}),
                "created_at": now(),
            },
        )


async def main() -> None:
    async with app.SessionLocal() as session:
        client = await find_demo_client(session)
        client_id = client["id"]

        await update_client_profile(session, client_id)
        await app.ensure_native_accounting_client(session, client_id)
        await populate_accounting_foundation(session, client_id)
        contacts = await populate_contacts(session, client_id)
        await populate_outstanding_items(session, client_id)
        await populate_ap(session, client_id, contacts)
        await populate_ar(session, client_id, contacts)
        await populate_banking(session, client_id)
        await populate_periods_assets_and_audit(session, client_id)
        await session.commit()

    print(f"Demo data refreshed for {DEMO_BUSINESS_NAME} ({DEMO_EMAIL}).")


if __name__ == "__main__":
    asyncio.run(main())
