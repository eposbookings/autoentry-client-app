"""Create a deterministic demo client through Trial Balance only.

This deliberately creates no Year End Accounts pack, snapshot, output or filing.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import insert, select, update

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server as app  # noqa: E402


DEMO_EMAIL = "demo.yearend.accounts@epos.demo"
DEMO_NAME = "Demo Account Year-End Accounts"
DEMO_PASSWORD = "DemoYearEnd2026!"
YEAR_START = "2025-07-01"
YEAR_END = "2026-06-30"


def did(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"epos-year-end-demo:{key}"))


def money(value: str) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def values_for(table: Any, row: dict[str, Any]) -> dict[str, Any]:
    allowed = {column.name for column in table.c}
    return {
        key: str(value) if isinstance(value, Decimal) else value
        for key, value in row.items()
        if key in allowed
    }


async def add(session: Any, table: Any, row: dict[str, Any]) -> None:
    await session.execute(insert(table).values(**values_for(table, row)))


async def main() -> None:
    async with app.SessionLocal() as session:
        existing = await app.one(session, select(app.users).where(app.users.c.email == DEMO_EMAIL))
        if existing:
            raise RuntimeError(
                f"{DEMO_NAME} already exists with id {existing['id']}. "
                "The script will not overwrite an existing demo."
            )

        now = app.utc_now_iso()
        client_id = did("client")
        director = [{"name": "Olivia Morgan", "role": "Director", "appointed_on": "2022-07-01"}]
        await add(session, app.users, {
            "id": client_id,
            "email": DEMO_EMAIL,
            "password_hash": app.hash_password(DEMO_PASSWORD),
            "role": "client",
            "first_name": "Olivia",
            "last_name": "Morgan",
            "business_name": DEMO_NAME,
            "client_type": "Limited company",
            "industry": "Business technology consultancy",
            "company_number": "09999991",
            "company_status": "active",
            "incorporation_date": "2022-07-01",
            "registered_office_address": "14 Market Square, Manchester, M1 1AA",
            "trading_address": "14 Market Square, Manchester, M1 1AA",
            "phone": "0161 555 0188",
            "utr": "1234567891",
            "vat_number": "GB 999 9999 91",
            "paye_reference": "123/YE00001",
            "year_end": "30/06",
            "main_contact_name": "Olivia Morgan",
            "main_contact_role": "Director",
            "company_directors": json.dumps(director),
            "company_pscs": json.dumps(director),
            "services_required": json.dumps(["Accounts", "CT600 Return", "Bookkeeping", "VAT Returns", "Payroll"]),
            "bookkeeping_frequency": "monthly",
            "is_vat_client": True,
            "ai_analysis_enabled": True,
            "accounting_destination": "native",
            "native_accounting_enabled": True,
            "native_accounting_created_at": now,
            "status": "active",
            "created_at": now,
        })
        await app.ensure_native_accounting_client(session, client_id)
        accounts = {
            str(row["code"]): row
            for row in await app.many(
                session,
                select(app.accounting_accounts).where(app.accounting_accounts.c.client_id == client_id),
            )
        }

        mappings = {
            "1200": ("Cash and cash equivalents", "Cash at bank and in hand", "Operating"),
            "1100": ("Trade receivables", "Debtors due within one year", "Operating"),
            "1510": ("Tangible fixed assets", "Tangible assets", "Investing"),
            "1591": ("Accumulated depreciation", "Tangible assets", "Non-cash"),
            "2000": ("Trade payables", "Creditors due within one year", "Operating"),
            "2200": ("VAT payable", "Other taxation and social security", "Operating"),
            "2210": ("PAYE and payroll liabilities", "Other taxation and social security", "Operating"),
            "2300": ("Corporation tax payable", "Corporation tax liability", "Operating"),
            "2410": ("Amounts owed to directors", "Creditors due within one year", "Financing"),
            "3100": ("Called up share capital", "Called up share capital", "Financing"),
            "4000": ("Turnover", "Turnover", "Operating"),
            "5000": ("Cost of sales", "Cost of sales", "Operating"),
            "6040": ("Staff costs", "Administrative expenses", "Operating"),
            "6180": ("Premises costs", "Administrative expenses", "Operating"),
            "6240": ("Tax on profit", "Tax on profit", "Operating"),
            "7000": ("Finance costs", "Interest payable and similar expenses", "Operating"),
            "7500": ("Depreciation", "Administrative expenses", "Non-cash"),
        }
        for code, (reporting, statutory, cash_flow) in mappings.items():
            account = accounts[code]
            statement = "P&L" if account["category"] in {"Income", "Expense", "Other Income", "Other Expense"} else "Balance Sheet"
            account_class = {"Other Income": "Income", "Other Expense": "Expense"}.get(account["category"], account["category"])
            await session.execute(
                update(app.accounting_accounts)
                .where(app.accounting_accounts.c.id == account["id"])
                .values(
                    module="CORE",
                    default_active="Active",
                    account_class=account_class,
                    account_subtype=account.get("account_type"),
                    statement=statement,
                    control_account_type=account.get("purpose") if account.get("is_control_account") else "None",
                    allow_manual_posting=not bool(account.get("is_control_account")),
                    system_account=bool(account.get("is_control_account")),
                    reporting_category_id=did(f"reporting:{reporting}"),
                    internal_reporting_category=reporting,
                    statutory_presentation=statutory,
                    cash_flow_category=cash_flow,
                    default_tax_treatment="Taxable" if account_class == "Income" else "Deductible" if account_class == "Expense" else "Balance sheet only",
                    vat_behaviour="Transaction driven",
                    current_noncurrent_rule="Current" if statement == "Balance Sheet" else "Not applicable",
                    filing_status="Ready",
                    updated_at=now,
                )
            )
        accounts = {
            str(row["code"]): row
            for row in await app.many(
                session,
                select(app.accounting_accounts).where(app.accounting_accounts.c.client_id == client_id),
            )
        }

        financial_year_id = did("financial-year")
        await add(session, app.accounting_financial_years, {
            "id": financial_year_id,
            "client_id": client_id,
            "name": "FY 2025/26",
            "start_date": YEAR_START,
            "end_date": YEAR_END,
            "status": "open",
            "created_at": now,
            "updated_at": now,
        })
        for month_index in range(12):
            year = 2025 + ((7 + month_index - 1) // 12)
            month = ((7 + month_index - 1) % 12) + 1
            start = date(year, month, 1)
            next_year = year + (month // 12)
            next_month = (month % 12) + 1
            end = date(next_year, next_month, 1) - app.timedelta(days=1)
            await add(session, app.accounting_periods, {
                "id": did(f"period:{month_index + 1}"),
                "client_id": client_id,
                "financial_year_id": financial_year_id,
                "period_name": start.strftime("%b %Y"),
                "period_number": month_index + 1,
                "period_start": str(start),
                "period_end": str(end),
                "status": "open",
                "transactions_posted": 0,
                "created_at": now,
                "updated_at": now,
            })

        contact_specs = [
            ("north", "customer", "Northstar Retail Ltd", "accounts@northstar.example"),
            ("willow", "customer", "Willow Training Group", "finance@willow.example"),
            ("apex", "customer", "Apex Property Services", "accounts@apex.example"),
            ("hardware", "supplier", "Manchester Hardware Systems Ltd", "billing@hardware.example"),
            ("contractor", "supplier", "Brightline Contractors Ltd", "accounts@brightline.example"),
            ("landlord", "supplier", "Market Square Estates Ltd", "rent@market-square.example"),
        ]
        contacts: dict[str, dict] = {}
        for key, contact_type, name, email in contact_specs:
            row = {
                "id": did(f"contact:{key}"),
                "client_id": client_id,
                "contact_type": contact_type,
                "name": name,
                "email": email,
                "active": True,
                "raw_json": json.dumps({"demo": True}),
                "created_at": now,
                "updated_at": now,
            }
            await add(session, app.accounting_contacts, row)
            contacts[key] = row

        for index, key in enumerate(("hardware", "contractor", "landlord"), start=1):
            await add(session, app.accounting_ap_supplier_profiles, {
                "id": did(f"supplier:{key}"),
                "client_id": client_id,
                "contact_id": contacts[key]["id"],
                "supplier_code": f"SUP-{index:03}",
                "trading_name": contacts[key]["name"],
                "payment_terms_days": 30,
                "default_currency": "GBP",
                "default_purchase_account": {"hardware": "1510", "contractor": "5000", "landlord": "6180"}[key],
                "default_vat_code": "20.0% S",
                "status": "active",
                "created_at": now,
                "updated_at": now,
            })
        for index, key in enumerate(("north", "willow", "apex"), start=1):
            await add(session, app.accounting_ar_customer_profiles, {
                "id": did(f"customer:{key}"),
                "client_id": client_id,
                "contact_id": contacts[key]["id"],
                "customer_code": f"CUS-{index:03}",
                "trading_name": contacts[key]["name"],
                "payment_terms_days": 30,
                "default_currency": "GBP",
                "default_sales_account": "4000",
                "default_vat_code": "20.0% S",
                "credit_limit": money("50000.00"),
                "status": "active",
                "created_at": now,
                "updated_at": now,
            })

        ar_specs = [
            ("north", "SI-1001", "2025-11-15", "30000.00", "6000.00", "36000.00", "12000.00", "part_paid"),
            ("willow", "SI-1002", "2026-02-10", "18000.00", "3600.00", "21600.00", "0.00", "paid"),
            ("apex", "SI-1003", "2026-05-20", "12000.00", "2400.00", "14400.00", "14400.00", "posted"),
        ]
        for key, number, invoice_date, net, vat, gross, outstanding, status in ar_specs:
            invoice_id = did(f"ar:{number}")
            await add(session, app.accounting_ar_invoices, {
                "id": invoice_id,
                "client_id": client_id,
                "customer_id": did(f"customer:{key}"),
                "contact_id": contacts[key]["id"],
                "invoice_number": number,
                "reference": number,
                "invoice_date": invoice_date,
                "due_date": invoice_date,
                "currency": "GBP",
                "status": status,
                "net_amount": money(net),
                "vat_amount": money(vat),
                "gross_amount": money(gross),
                "outstanding_amount": money(outstanding),
                "created_at": now,
                "updated_at": now,
            })
            await add(session, app.accounting_ar_invoice_lines, {
                "id": did(f"ar-line:{number}"),
                "client_id": client_id,
                "invoice_id": invoice_id,
                "line_number": 1,
                "description": "Technology consulting and implementation services",
                "nominal_account_code": "4000",
                "quantity": money("1.00"),
                "unit_price": money(net),
                "vat_code": "20.0% S",
                "net_amount": money(net),
                "vat_amount": money(vat),
                "gross_amount": money(gross),
                "created_at": now,
                "updated_at": now,
            })

        ap_specs = [
            ("hardware", "PI-2001", "2025-10-01", "6000.00", "1200.00", "7200.00", "0.00", "paid", "1510", "Computer and server equipment"),
            ("contractor", "PI-2002", "2025-12-01", "12000.00", "2400.00", "14400.00", "6400.00", "part_paid", "5000", "Implementation subcontractors"),
            ("landlord", "PI-2003", "2026-03-31", "9600.00", "1920.00", "11520.00", "0.00", "paid", "6180", "Office rent for the year"),
        ]
        for key, number, invoice_date, net, vat, gross, outstanding, status, nominal, description in ap_specs:
            invoice_id = did(f"ap:{number}")
            await add(session, app.accounting_ap_invoices, {
                "id": invoice_id,
                "client_id": client_id,
                "supplier_id": did(f"supplier:{key}"),
                "contact_id": contacts[key]["id"],
                "invoice_number": number,
                "reference": number,
                "invoice_date": invoice_date,
                "due_date": invoice_date,
                "currency": "GBP",
                "status": status,
                "net_amount": money(net),
                "vat_amount": money(vat),
                "gross_amount": money(gross),
                "outstanding_amount": money(outstanding),
                "created_at": now,
                "updated_at": now,
            })
            await add(session, app.accounting_ap_invoice_lines, {
                "id": did(f"ap-line:{number}"),
                "client_id": client_id,
                "invoice_id": invoice_id,
                "line_number": 1,
                "description": description,
                "nominal_account_code": nominal,
                "quantity": money("1.00"),
                "unit_price": money(net),
                "vat_code": "20.0% S",
                "net_amount": money(net),
                "vat_amount": money(vat),
                "gross_amount": money(gross),
                "created_at": now,
                "updated_at": now,
            })

        bank_id = did("bank")
        await add(session, app.accounting_bank_accounts, {
            "id": bank_id,
            "client_id": client_id,
            "account_name": "Demo Business Current Account",
            "bank_name": "Demo Bank",
            "account_number": "10002026",
            "sort_code": "20-26-00",
            "currency": "GBP",
            "nominal_account_code": "1200",
            "opening_balance": money("25000.00"),
            "current_balance": money("28640.00"),
            "reconciled_balance": money("28640.00"),
            "default_account": True,
            "allow_payments": True,
            "allow_receipts": True,
            "active": True,
            "created_at": now,
            "updated_at": now,
        })
        bank_specs = [
            ("2025-07-01", "Director funding and share capital", "OPEN-2025", "25000.00", "0.00"),
            ("2025-10-30", "Manchester Hardware Systems PI-2001", "PI-2001", "0.00", "7200.00"),
            ("2025-12-15", "Northstar Retail part receipt", "SI-1001", "24000.00", "0.00"),
            ("2026-03-15", "Willow Training receipt", "SI-1002", "21600.00", "0.00"),
            ("2026-03-31", "Market Square Estates rent", "PI-2003", "0.00", "11520.00"),
            ("2026-04-15", "Brightline Contractors part payment", "PI-2002", "0.00", "8000.00"),
            ("2026-06-15", "Payroll net pay", "PAY-2026", "0.00", "15000.00"),
            ("2026-06-20", "Bank service charges", "BANK-CHG", "0.00", "240.00"),
        ]
        running = Decimal("0.00")
        for index, (txn_date, description, reference, money_in, money_out) in enumerate(bank_specs, start=1):
            running += money(money_in) - money(money_out)
            await add(session, app.accounting_bank_transactions, {
                "id": did(f"bank-txn:{index}"),
                "client_id": client_id,
                "bank_account_id": bank_id,
                "bank_account_code": "1200",
                "transaction_date": txn_date,
                "description": description,
                "reference": reference,
                "transaction_type": "Receipt" if money(money_in) else "Payment",
                "source_type": "demo",
                "money_in": money(money_in),
                "money_out": money(money_out),
                "balance": running,
                "status": "reconciled",
                "matched_to": reference,
                "confidence": money("1.00"),
                "ignored": False,
                "matched_account_code": "1200",
                "raw_json": json.dumps({"demo": True}),
                "created_at": now,
                "updated_at": now,
            })

        async def journal(source: str, ref: str, entry_date: str, description: str, lines: list[tuple[str, str, str, str | None]]) -> None:
            await app.post_native_journal(
                session,
                client_id,
                source,
                did(f"source:{ref}"),
                entry_date,
                ref,
                description,
                [
                    {
                        "account": accounts[code],
                        "debit": debit,
                        "credit": credit,
                        "contact": contacts.get(contact_key) if contact_key else None,
                        "description": description,
                    }
                    for code, debit, credit, contact_key in lines
                ],
                client_id,
            )

        await journal("opening_balance", "OPEN-2025", "2025-07-01", "Opening director funding and share capital", [
            ("1200", "25000.00", "0.00", None), ("3100", "0.00", "1000.00", None), ("2410", "0.00", "24000.00", None),
        ])
        for key, number, invoice_date, net, vat, gross, *_ in ar_specs:
            await journal("ar_invoice", number, invoice_date, f"Sales invoice {number}", [
                ("1100", gross, "0.00", key), ("4000", "0.00", net, key), ("2200", "0.00", vat, key),
            ])
        for key, number, invoice_date, net, vat, gross, *rest in ap_specs:
            nominal = rest[2]
            await journal("ap_invoice", number, invoice_date, f"Purchase invoice {number}", [
                (nominal, net, "0.00", key), ("2200", vat, "0.00", key), ("2000", "0.00", gross, key),
            ])
        await journal("ar_receipt", "RCPT-SI-1001", "2025-12-15", "Part receipt from Northstar Retail", [
            ("1200", "24000.00", "0.00", "north"), ("1100", "0.00", "24000.00", "north"),
        ])
        await journal("ar_receipt", "RCPT-SI-1002", "2026-03-15", "Receipt from Willow Training", [
            ("1200", "21600.00", "0.00", "willow"), ("1100", "0.00", "21600.00", "willow"),
        ])
        await journal("ap_payment", "PAY-PI-2001", "2025-10-30", "Payment to Manchester Hardware Systems", [
            ("2000", "7200.00", "0.00", "hardware"), ("1200", "0.00", "7200.00", "hardware"),
        ])
        await journal("ap_payment", "PAY-PI-2002", "2026-04-15", "Part payment to Brightline Contractors", [
            ("2000", "8000.00", "0.00", "contractor"), ("1200", "0.00", "8000.00", "contractor"),
        ])
        await journal("ap_payment", "PAY-PI-2003", "2026-03-31", "Payment to Market Square Estates", [
            ("2000", "11520.00", "0.00", "landlord"), ("1200", "0.00", "11520.00", "landlord"),
        ])
        await journal("payroll", "PAYROLL-2026", "2026-06-15", "Annual payroll summary", [
            ("6040", "18000.00", "0.00", None), ("1200", "0.00", "15000.00", None), ("2210", "0.00", "3000.00", None),
        ])
        await journal("bank_charge", "BANK-CHG", "2026-06-20", "Bank service charges", [
            ("7000", "240.00", "0.00", None), ("1200", "0.00", "240.00", None),
        ])
        await journal("depreciation", "DEP-2026", "2026-06-30", "Computer equipment depreciation", [
            ("7500", "1200.00", "0.00", None), ("1591", "0.00", "1200.00", None),
        ])
        await journal("corporation_tax_accrual", "CT-ACCRUAL-2026", "2026-06-30", "Estimated Corporation Tax accrual", [
            ("6240", "2500.00", "0.00", None), ("2300", "0.00", "2500.00", None),
        ])

        await session.commit()

        result = await app.canonical_trial_balance(
            session,
            client_id,
            date_from=YEAR_START,
            date_to=YEAR_END,
            date_mode="as_at",
        )
        ar_total = sum((money(str(row[6])) for row in ar_specs), Decimal("0.00"))
        ap_total = sum((money(str(row[6])) for row in ap_specs), Decimal("0.00"))
        year_end_pack_count = await app.count_rows(
            session,
            app.accounting_annual_accounts_packs,
            app.accounting_annual_accounts_packs.c.client_id == client_id,
        )
        print(json.dumps({
            "client_id": client_id,
            "business_name": DEMO_NAME,
            "email": DEMO_EMAIL,
            "password": DEMO_PASSWORD,
            "financial_year": f"{YEAR_START} to {YEAR_END}",
            "accounts_receivable": app.money_str(ar_total),
            "accounts_payable": app.money_str(ap_total),
            "trial_balance": result["summary"],
            "year_end_accounts_pack_count": year_end_pack_count,
        }, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
