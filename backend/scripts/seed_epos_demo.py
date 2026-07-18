from __future__ import annotations

import argparse
import asyncio
import calendar
import json
import math
import random
import sys
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bcrypt
from sqlalchemy import delete, insert, select

import server


DEMO_CLIENT_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "epos-demo:client:epos-bookings-ltd"))
DEMO_BUSINESS_NAME = "EPOS Accountancy Demo account"
DEMO_EMAIL = "demo.account@eposbookings.net"
DEMO_PASSWORD = "DemoPass123!"
DEMO_USER = "EPOS Demo Seeder"
DEMO_NOW = datetime(2026, 7, 18, 9, 0, 0)


def sid(kind: str, key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"epos-demo:{kind}:{key}"))


def q(value: float | Decimal | int | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def iso(dt: date | datetime) -> str:
    return dt.isoformat()


def add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def table_row(table, **values):
    return {key: value for key, value in values.items() if key in table.c}


async def insert_many(session, table, rows):
    rows = [table_row(table, **row) for row in rows if row]
    if not rows:
        return
    # Keep all dictionaries aligned so SQLAlchemy can batch safely.
    keys = sorted({key for row in rows for key in row})
    normalised = [{key: row.get(key) for key in keys} for row in rows]
    await session.execute(insert(table), normalised)


async def ids_for_client(session, table):
    if "client_id" not in table.c or "id" not in table.c:
        return []
    result = await session.execute(select(table.c.id).where(table.c.client_id == DEMO_CLIENT_ID))
    return list(result.scalars())


async def clear_demo(session):
    workflow_ids = [sid("workflow", str(i)) for i in range(1, 9)]
    await session.execute(delete(server.automation_approvals).where(server.automation_approvals.c.workflow_id.in_(workflow_ids)))
    await session.execute(delete(server.automation_exceptions).where(server.automation_exceptions.c.workflow_id.in_(workflow_ids)))
    await session.execute(delete(server.automation_runs).where(server.automation_runs.c.workflow_id.in_(workflow_ids)))
    await session.execute(delete(server.automation_workflows).where(server.automation_workflows.c.id.in_(workflow_ids)))
    await session.execute(delete(server.automation_templates).where(server.automation_templates.c.name.like("EPOS Demo%")))

    for table in (
        server.platform_activity_feed,
        server.platform_notifications,
    ):
        if "client_id" in table.c:
            await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))
    await session.execute(delete(server.platform_error_logs).where(server.platform_error_logs.c.path == "/api/v1/demo"))
    await session.execute(delete(server.platform_health_checks).where(server.platform_health_checks.c.component.like("demo_%")))

    asset_ids = await ids_for_client(session, server.accounting_fixed_assets)
    if asset_ids:
        await session.execute(delete(server.accounting_fixed_asset_depreciation).where(server.accounting_fixed_asset_depreciation.c.asset_id.in_(asset_ids)))
        await session.execute(delete(server.accounting_fixed_asset_events).where(server.accounting_fixed_asset_events.c.asset_id.in_(asset_ids)))
    for table in (
        server.accounting_fixed_assets,
        server.accounting_fixed_asset_categories,
        server.accounting_fixed_asset_settings,
    ):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))

    invoice_ids = await ids_for_client(session, server.accounting_ap_invoices)
    payment_ids = await ids_for_client(session, server.accounting_ap_payments)
    if invoice_ids:
        await session.execute(delete(server.accounting_ap_invoice_lines).where(server.accounting_ap_invoice_lines.c.invoice_id.in_(invoice_ids)))
        await session.execute(delete(server.accounting_ap_payment_allocations).where(server.accounting_ap_payment_allocations.c.invoice_id.in_(invoice_ids)))
    if payment_ids:
        await session.execute(delete(server.accounting_ap_payment_allocations).where(server.accounting_ap_payment_allocations.c.payment_id.in_(payment_ids)))
    for table in (server.accounting_ap_payments, server.accounting_ap_invoices, server.accounting_ap_supplier_profiles):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))

    invoice_ids = await ids_for_client(session, server.accounting_ar_invoices)
    receipt_ids = await ids_for_client(session, server.accounting_ar_receipts)
    if invoice_ids:
        await session.execute(delete(server.accounting_ar_invoice_lines).where(server.accounting_ar_invoice_lines.c.invoice_id.in_(invoice_ids)))
        await session.execute(delete(server.accounting_ar_receipt_allocations).where(server.accounting_ar_receipt_allocations.c.invoice_id.in_(invoice_ids)))
    if receipt_ids:
        await session.execute(delete(server.accounting_ar_receipt_allocations).where(server.accounting_ar_receipt_allocations.c.receipt_id.in_(receipt_ids)))
    for table in (server.accounting_ar_receipts, server.accounting_ar_invoices, server.accounting_ar_customer_profiles):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))

    bank_tx_ids = await ids_for_client(session, server.accounting_bank_transactions)
    if bank_tx_ids:
        await session.execute(delete(server.accounting_bank_matches).where(server.accounting_bank_matches.c.bank_transaction_id.in_(bank_tx_ids)))
    for table in (
        server.accounting_bank_transfers,
        server.accounting_bank_rules,
        server.accounting_bank_transactions,
        server.accounting_bank_imports,
        server.accounting_bank_settings,
        server.accounting_bank_accounts,
    ):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))

    for table in (
        server.accounting_vat_adjustments,
        server.accounting_vat_returns,
        server.accounting_vat_periods,
        server.accounting_vat_codes,
        server.accounting_vat_settings,
        server.accounting_opening_balances,
        server.accounting_year_end_events,
        server.accounting_year_end_settings,
    ):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))

    await session.execute(delete(server.accounting_journal_lines).where(server.accounting_journal_lines.c.client_id == DEMO_CLIENT_ID))
    await session.execute(delete(server.accounting_journal_entries).where(server.accounting_journal_entries.c.client_id == DEMO_CLIENT_ID))
    for table in (
        server.accounting_periods,
        server.accounting_financial_years,
        server.accounting_audit_log,
        server.accounting_settings,
        server.accounting_contacts,
        server.accounting_accounts,
        server.submissions,
        server.outstanding_items,
    ):
        await session.execute(delete(table).where(table.c.client_id == DEMO_CLIENT_ID))
    await session.execute(delete(server.users).where(server.users.c.id == DEMO_CLIENT_ID))


def account_rows() -> list[dict]:
    accounts = [
        ("1000", "Business Current Account", "Asset", "Bank", "Bank Account", "Debit", True),
        ("1010", "Stripe Clearing", "Asset", "Current Asset", "Bank Account", "Debit", True),
        ("1020", "Savings Account", "Asset", "Bank", "Bank Account", "Debit", True),
        ("1100", "Trade Debtors", "Asset", "Current Asset", "Sales Ledger", "Debit", True),
        ("1200", "Prepayments", "Asset", "Current Asset", "Standard Nominal", "Debit", False),
        ("1300", "Computer Equipment", "Asset", "Fixed Asset", "Standard Nominal", "Debit", False),
        ("1310", "Accumulated Depreciation - Computer Equipment", "Asset", "Fixed Asset Contra", "Standard Nominal", "Credit", False),
        ("1320", "Office Equipment", "Asset", "Fixed Asset", "Standard Nominal", "Debit", False),
        ("1330", "Accumulated Depreciation - Office Equipment", "Asset", "Fixed Asset Contra", "Standard Nominal", "Credit", False),
        ("2000", "Trade Creditors", "Liability", "Current Liability", "Purchase Ledger", "Credit", True),
        ("2100", "VAT Control", "Liability", "Current Liability", "VAT Control", "Credit", True),
        ("2200", "PAYE / NIC Control", "Liability", "Current Liability", "Payroll Control", "Credit", True),
        ("2300", "Corporation Tax", "Liability", "Current Liability", "Corporation Tax", "Credit", True),
        ("2400", "Director Loan Account", "Liability", "Current Liability", "Standard Nominal", "Credit", False),
        ("3000", "Share Capital", "Equity", "Equity", "Standard Nominal", "Credit", False),
        ("3200", "Retained Earnings", "Equity", "Equity", "Retained Earnings", "Credit", True),
        ("4000", "Bookkeeping Sales", "Income", "Sales", "Standard Nominal", "Credit", False),
        ("4010", "Software Subscription Sales", "Income", "Sales", "Standard Nominal", "Credit", False),
        ("4020", "Consultancy Sales", "Income", "Sales", "Standard Nominal", "Credit", False),
        ("5000", "Software and Hosting", "Expense", "Direct Cost", "Standard Nominal", "Debit", False),
        ("5010", "Subcontractors", "Expense", "Direct Cost", "Standard Nominal", "Debit", False),
        ("6000", "Advertising and Marketing", "Expense", "Overhead", "Standard Nominal", "Debit", False),
        ("6100", "Travel and Subsistence", "Expense", "Overhead", "Standard Nominal", "Debit", False),
        ("6200", "Office Costs", "Expense", "Overhead", "Standard Nominal", "Debit", False),
        ("6300", "Bank Charges", "Expense", "Finance Cost", "Standard Nominal", "Debit", False),
        ("6400", "Depreciation", "Expense", "Overhead", "Standard Nominal", "Debit", False),
        ("6900", "Suspense", "Asset", "Current Asset", "Suspense", "Debit", True),
        ("7000", "Interest Received", "Income", "Other Income", "Standard Nominal", "Credit", False),
    ]
    return [
        {
            "id": sid("account", code),
            "client_id": DEMO_CLIENT_ID,
            "code": code,
            "name": name,
            "category": category,
            "account_type": account_type,
            "purpose": purpose,
            "normal_balance": normal,
            "control_account": is_control,
            "is_control_account": is_control,
            "active": True,
            "created_at": iso(DEMO_NOW),
            "updated_at": iso(DEMO_NOW),
        }
        for code, name, category, account_type, purpose, normal, is_control in accounts
    ]


def suppliers() -> list[dict]:
    names = [
        "Amazon Business", "Google Cloud", "Microsoft 365", "Xero", "QuickBooks", "Sage", "Stripe", "GoCardless",
        "Adobe", "Canva", "HubSpot", "Twilio", "SendGrid", "Dropbox", "Zoom", "Slack", "Asana", "Notion",
        "BJL Skip Hire", "Tesco", "Asda Stores Ltd", "Shell UK", "EE Business", "Vodafone", "BT Business",
        "Royal Mail", "HMRC", "Companies House", "20i Ltd", "Linode", "Dell UK", "Apple Store", "Currys",
        "Staples", "Trainline", "Uber", "Regus", "WeWork", "Local Cleaning Co", "Premium Contractors Ltd",
    ]
    rows = []
    for idx, name in enumerate(names, start=1):
        rows.append(
            {
                "id": sid("supplier-profile", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "contact_id": sid("contact-supplier", str(idx)),
                "supplier_code": f"S{idx:04d}",
                "trading_name": name,
                "phone": f"0207 555 {idx:04d}",
                "website": f"https://{name.lower().replace(' ', '').replace('&', 'and')}.example.com",
                "vat_number": f"GB{220000000 + idx:09d}"[:11],
                "company_number": f"{12570000 + idx}",
                "payment_terms_days": 30 if idx % 4 else 14,
                "default_currency": "GBP",
                "default_purchase_account": "5000" if idx < 18 else "6200",
                "default_vat_code": "20.0% S" if idx % 5 else "0.0% Z",
                "bank_name": "Demo Bank",
                "bank_sort_code": f"20-00-{idx % 90:02d}",
                "bank_account_number": f"10{idx:06d}",
                "cis_registered": name in {"BJL Skip Hire", "Premium Contractors Ltd"},
                "reverse_charge": False,
                "status": "active",
                "notes": "Seeded demo supplier for native accounting walkthrough.",
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        )
    return rows


def customers() -> list[dict]:
    prefixes = ["Bright", "Green", "North", "South", "Prime", "Oak", "River", "Cloud", "Urban", "Cedar"]
    sectors = ["Consulting", "Training", "Retail", "Construction", "Digital", "Care", "Logistics", "Hospitality", "Studios", "Holdings"]
    rows = []
    for idx in range(1, 251):
        name = f"{prefixes[idx % len(prefixes)]} {sectors[idx % len(sectors)]} {idx:03d} Ltd"
        rows.append(
            {
                "id": sid("customer-profile", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "contact_id": sid("contact-customer", str(idx)),
                "customer_code": f"C{idx:04d}",
                "trading_name": name,
                "phone": f"0330 555 {idx:04d}",
                "website": f"https://customer-{idx:03d}.example.com",
                "vat_number": f"GB{330000000 + idx:09d}"[:11],
                "company_number": f"{12800000 + idx}",
                "payment_terms_days": 14 if idx % 5 else 30,
                "default_currency": "GBP",
                "default_sales_account": "4010" if idx % 3 else "4020",
                "default_vat_code": "20.0% S",
                "credit_limit": str(q(2500 + (idx % 20) * 500)),
                "status": "active",
                "notes": "Seeded demo customer for sales ledger, aged debtors and receipts.",
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        )
    return rows


def contacts_for(supplier_rows, customer_rows) -> list[dict]:
    rows = []
    for row in supplier_rows:
        rows.append(
            {
                "id": row["contact_id"],
                "client_id": DEMO_CLIENT_ID,
                "contact_type": "supplier",
                "name": row["trading_name"],
                "email": f"accounts+{row['supplier_code'].lower()}@example.com",
                "external_id": row["supplier_code"],
                "account_code": row["supplier_code"],
                "active": True,
                "raw_json": json.dumps({"source": "demo", "type": "supplier"}),
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        )
    for row in customer_rows:
        rows.append(
            {
                "id": row["contact_id"],
                "client_id": DEMO_CLIENT_ID,
                "contact_type": "customer",
                "name": row["trading_name"],
                "email": f"accounts+{row['customer_code'].lower()}@example.com",
                "external_id": row["customer_code"],
                "account_code": row["customer_code"],
                "active": True,
                "raw_json": json.dumps({"source": "demo", "type": "customer"}),
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        )
    return rows


class DemoBuilder:
    def __init__(self, scale: str):
        self.scale = scale
        self.rng = random.Random(13072026)
        self.journal_entries: list[dict] = []
        self.journal_lines: list[dict] = []
        self.audit_rows: list[dict] = []
        self.activity_rows: list[dict] = []
        self.vat_transactions: list[dict] = []
        if scale == "quick":
            self.ap_count, self.ar_count, self.bank_count, self.docs, self.runs, self.audit_target = 70, 95, 900, 350, 100, 1800
        else:
            self.ap_count, self.ar_count, self.bank_count, self.docs, self.runs, self.audit_target = 700, 950, 9000, 3500, 1000, 18000

    def audit(self, module: str, record_type: str, record_id: str, action: str, details: dict | None = None):
        idx = len(self.audit_rows) + 1
        self.audit_rows.append(
            {
                "id": sid("audit", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "actor_id": "demo-seeder",
                "module": module,
                "record_type": record_type,
                "record_id": record_id,
                "action": action,
                "entity_type": record_type,
                "entity_id": record_id,
                "previous_value": None,
                "new_value": json.dumps(details or {"seeded": True}),
                "ip_address": "127.0.0.1",
                "details_json": json.dumps(details or {"seeded": True}),
                "created_at": iso(DEMO_NOW - timedelta(minutes=idx % 6000)),
            }
        )

    def activity(self, module: str, record_type: str, record_id: str, action: str, summary: str):
        idx = len(self.activity_rows) + 1
        self.activity_rows.append(
            {
                "id": sid("activity", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "actor_id": "demo-seeder",
                "module": module,
                "record_type": record_type,
                "record_id": record_id,
                "action": action,
                "summary": summary,
                "details_json": json.dumps({"demo": True}),
                "correlation_id": sid("correlation", str(idx)),
                "created_at": iso(DEMO_NOW - timedelta(minutes=idx % 4000)),
            }
        )

    def journal(self, source_type: str, source_id: str, entry_date: date, reference: str, description: str, lines: list[tuple[str, str, Decimal, Decimal, str | None]]):
        entry_id = sid("journal", source_id)
        total_debit = sum(line[2] for line in lines)
        total_credit = sum(line[3] for line in lines)
        if total_debit != total_credit:
            raise ValueError(f"Unbalanced journal {reference}: {total_debit} != {total_credit}")
        self.journal_entries.append(
            {
                "id": entry_id,
                "client_id": DEMO_CLIENT_ID,
                "source_type": source_type,
                "source_id": source_id,
                "entry_date": iso(entry_date),
                "reference": reference,
                "description": description,
                "status": "posted",
                "total_debit": str(total_debit),
                "total_credit": str(total_credit),
                "created_at": iso(DEMO_NOW),
                "posted_at": iso(DEMO_NOW),
            }
        )
        account_name = {row["code"]: row["name"] for row in account_rows()}
        for idx, (code, desc, debit, credit, vat_code) in enumerate(lines, start=1):
            self.journal_lines.append(
                {
                    "id": sid("journal-line", f"{source_id}:{idx}"),
                    "entry_id": entry_id,
                    "client_id": DEMO_CLIENT_ID,
                    "account_id": sid("account", code),
                    "account_code": code,
                    "account_name": account_name.get(code, code),
                    "contact_id": None,
                    "debit": str(debit),
                    "credit": str(credit),
                    "vat_code": vat_code,
                    "description": desc,
                    "created_at": iso(DEMO_NOW),
                }
            )
        self.audit("General Ledger", "journal", entry_id, "posted", {"reference": reference, "source": source_type})
        return entry_id

    def build_ap(self, supplier_rows: list[dict]):
        invoices, lines, payments, allocations = [], [], [], []
        statuses = ["paid", "posted", "part_paid", "overdue", "draft", "awaiting_approval"]
        for idx in range(1, self.ap_count + 1):
            supplier = supplier_rows[idx % len(supplier_rows)]
            invoice_date = date(2024 + (idx % 3), ((idx * 7) % 12) + 1, ((idx * 11) % 25) + 1)
            due_date = invoice_date + timedelta(days=supplier["payment_terms_days"])
            status = statuses[idx % len(statuses)]
            net = q(35 + (idx * 13.71) % 1850)
            vat_code = "0.0% Z" if idx % 9 == 0 else "20.0% S"
            vat = q(0 if vat_code == "0.0% Z" else net * Decimal("0.20"))
            gross = net + vat
            paid_amount = gross if status == "paid" else (q(gross / 2) if status == "part_paid" else Decimal("0.00"))
            outstanding = q(gross - paid_amount)
            invoice_id = sid("ap-invoice", str(idx))
            journal_id = None
            if status in {"paid", "posted", "part_paid", "overdue"}:
                journal_id = self.journal(
                    "AP Invoice",
                    invoice_id,
                    invoice_date,
                    f"PI-{idx:05d}",
                    f"{supplier['trading_name']} purchase invoice",
                    [
                        (supplier["default_purchase_account"], "Purchase net", net, Decimal("0.00"), vat_code),
                        ("2100", "Input VAT", vat, Decimal("0.00"), vat_code),
                        ("2000", "Trade creditors", Decimal("0.00"), gross, None),
                    ],
                )
            invoices.append(
                {
                    "id": invoice_id,
                    "client_id": DEMO_CLIENT_ID,
                    "supplier_id": supplier["id"],
                    "contact_id": supplier["contact_id"],
                    "invoice_number": f"{supplier['supplier_code']}-{idx:05d}",
                    "reference": f"PO-{40000 + idx}",
                    "invoice_date": iso(invoice_date),
                    "due_date": iso(due_date),
                    "currency": "GBP",
                    "status": status,
                    "net_amount": str(net),
                    "vat_amount": str(vat),
                    "gross_amount": str(gross),
                    "outstanding_amount": str(outstanding),
                    "source_submission_id": sid("submission", str(idx)),
                    "attachment_path": f"demo/ap/{idx:05d}.pdf",
                    "extracted_json": json.dumps({"confidence": 0.83 + (idx % 16) / 100, "payment_method": "Card" if idx % 4 else "Terms"}),
                    "posted_journal_id": journal_id,
                    "approved_by": DEMO_USER if status not in {"draft", "awaiting_approval"} else None,
                    "approved_at": iso(DEMO_NOW) if status not in {"draft", "awaiting_approval"} else None,
                    "posted_by": DEMO_USER if journal_id else None,
                    "posted_at": iso(DEMO_NOW) if journal_id else None,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            lines.append(
                {
                    "id": sid("ap-line", str(idx)),
                    "client_id": DEMO_CLIENT_ID,
                    "invoice_id": invoice_id,
                    "line_number": 1,
                    "description": f"{supplier['trading_name']} services",
                    "nominal_account_code": supplier["default_purchase_account"],
                    "quantity": "1",
                    "unit_price": str(net),
                    "discount_amount": "0.00",
                    "vat_code": vat_code,
                    "net_amount": str(net),
                    "vat_amount": str(vat),
                    "gross_amount": str(gross),
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            if paid_amount:
                payment_id = sid("ap-payment", str(idx))
                payment_journal = self.journal(
                    "AP Payment",
                    payment_id,
                    min(due_date, date(2026, 7, 17)),
                    f"PAY-AP-{idx:05d}",
                    f"Payment to {supplier['trading_name']}",
                    [
                        ("2000", "Supplier payment allocation", paid_amount, Decimal("0.00"), None),
                        ("1000", "Bank payment", Decimal("0.00"), paid_amount, None),
                    ],
                )
                payments.append(
                    {
                        "id": payment_id,
                        "client_id": DEMO_CLIENT_ID,
                        "supplier_id": supplier["id"],
                        "contact_id": supplier["contact_id"],
                        "payment_date": iso(min(due_date, date(2026, 7, 17))),
                        "bank_account_code": "1000",
                        "reference": f"AP-PAY-{idx:05d}",
                        "amount": str(paid_amount),
                        "currency": "GBP",
                        "status": "posted",
                        "posted_journal_id": payment_journal,
                        "created_at": iso(DEMO_NOW),
                        "updated_at": iso(DEMO_NOW),
                    }
                )
                allocations.append(
                    {
                        "id": sid("ap-allocation", str(idx)),
                        "client_id": DEMO_CLIENT_ID,
                        "payment_id": payment_id,
                        "invoice_id": invoice_id,
                        "credit_note_id": None,
                        "amount": str(paid_amount),
                        "created_at": iso(DEMO_NOW),
                    }
                )
            self.activity("Accounts Payable", "purchase_invoice", invoice_id, "created", f"Purchase invoice {idx:05d} seeded")
        return invoices, lines, payments, allocations

    def build_ar(self, customer_rows: list[dict]):
        invoices, lines, receipts, allocations = [], [], [], []
        statuses = ["paid", "posted", "part_paid", "overdue", "draft", "awaiting_approval"]
        for idx in range(1, self.ar_count + 1):
            customer = customer_rows[idx % len(customer_rows)]
            invoice_date = date(2024 + (idx % 3), ((idx * 5) % 12) + 1, ((idx * 13) % 25) + 1)
            due_date = invoice_date + timedelta(days=customer["payment_terms_days"])
            status = statuses[(idx + 2) % len(statuses)]
            net = q(85 + (idx * 19.43) % 3200)
            vat = q(net * Decimal("0.20"))
            gross = net + vat
            receipt_amount = gross if status == "paid" else (q(gross * Decimal("0.40")) if status == "part_paid" else Decimal("0.00"))
            outstanding = q(gross - receipt_amount)
            invoice_id = sid("ar-invoice", str(idx))
            journal_id = None
            if status in {"paid", "posted", "part_paid", "overdue"}:
                journal_id = self.journal(
                    "AR Invoice",
                    invoice_id,
                    invoice_date,
                    f"SI-{idx:05d}",
                    f"{customer['trading_name']} sales invoice",
                    [
                        ("1100", "Trade debtors", gross, Decimal("0.00"), None),
                        (customer["default_sales_account"], "Sales net", Decimal("0.00"), net, "20.0% S"),
                        ("2100", "Output VAT", Decimal("0.00"), vat, "20.0% S"),
                    ],
                )
            invoices.append(
                {
                    "id": invoice_id,
                    "client_id": DEMO_CLIENT_ID,
                    "customer_id": customer["id"],
                    "contact_id": customer["contact_id"],
                    "invoice_number": f"INV-{idx:05d}",
                    "reference": f"SO-{50000 + idx}",
                    "invoice_date": iso(invoice_date),
                    "due_date": iso(due_date),
                    "currency": "GBP",
                    "status": status,
                    "net_amount": str(net),
                    "vat_amount": str(vat),
                    "gross_amount": str(gross),
                    "outstanding_amount": str(outstanding),
                    "source_submission_id": None,
                    "attachment_path": f"demo/ar/{idx:05d}.pdf",
                    "extracted_json": json.dumps({"source": "native", "confidence": 0.98}),
                    "posted_journal_id": journal_id,
                    "approved_by": DEMO_USER if status not in {"draft", "awaiting_approval"} else None,
                    "approved_at": iso(DEMO_NOW) if status not in {"draft", "awaiting_approval"} else None,
                    "posted_by": DEMO_USER if journal_id else None,
                    "posted_at": iso(DEMO_NOW) if journal_id else None,
                    "archived_at": None,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            for line_no in range(1, 3 if idx % 7 == 0 else 2):
                line_net = q(net / (2 if idx % 7 == 0 else 1))
                line_vat = q(line_net * Decimal("0.20"))
                lines.append(
                    {
                        "id": sid("ar-line", f"{idx}:{line_no}"),
                        "client_id": DEMO_CLIENT_ID,
                        "invoice_id": invoice_id,
                        "line_number": line_no,
                        "description": "Bookkeeping and software support" if line_no == 1 else "Management reporting",
                        "nominal_account_code": customer["default_sales_account"],
                        "quantity": "1",
                        "unit_price": str(line_net),
                        "discount_amount": "0.00",
                        "vat_code": "20.0% S",
                        "net_amount": str(line_net),
                        "vat_amount": str(line_vat),
                        "gross_amount": str(line_net + line_vat),
                        "created_at": iso(DEMO_NOW),
                        "updated_at": iso(DEMO_NOW),
                    }
                )
            if receipt_amount:
                receipt_id = sid("ar-receipt", str(idx))
                receipt_journal = self.journal(
                    "AR Receipt",
                    receipt_id,
                    min(due_date, date(2026, 7, 17)),
                    f"REC-{idx:05d}",
                    f"Receipt from {customer['trading_name']}",
                    [
                        ("1000", "Bank receipt", receipt_amount, Decimal("0.00"), None),
                        ("1100", "Customer receipt allocation", Decimal("0.00"), receipt_amount, None),
                    ],
                )
                receipts.append(
                    {
                        "id": receipt_id,
                        "client_id": DEMO_CLIENT_ID,
                        "customer_id": customer["id"],
                        "contact_id": customer["contact_id"],
                        "receipt_date": iso(min(due_date, date(2026, 7, 17))),
                        "bank_account_code": "1000",
                        "payment_method": "Bank Transfer" if idx % 3 else "Card",
                        "reference": f"AR-REC-{idx:05d}",
                        "amount": str(receipt_amount),
                        "currency": "GBP",
                        "status": "posted",
                        "posted_journal_id": receipt_journal,
                        "bank_transaction_id": sid("bank-ar", str(idx)),
                        "created_at": iso(DEMO_NOW),
                        "updated_at": iso(DEMO_NOW),
                    }
                )
                allocations.append(
                    {
                        "id": sid("ar-allocation", str(idx)),
                        "client_id": DEMO_CLIENT_ID,
                        "receipt_id": receipt_id,
                        "invoice_id": invoice_id,
                        "credit_note_id": None,
                        "amount": str(receipt_amount),
                        "created_at": iso(DEMO_NOW),
                    }
                )
            self.activity("Accounts Receivable", "sales_invoice", invoice_id, "created", f"Sales invoice {idx:05d} seeded")
        return invoices, lines, receipts, allocations

    def build_bank(self, ap_payments: list[dict], ar_receipts: list[dict]):
        accounts = [
            {
                "id": sid("bank-account", "current"),
                "client_id": DEMO_CLIENT_ID,
                "account_name": "Business Current Account",
                "bank_name": "Demo Bank",
                "account_number": "12345678",
                "sort_code": "20-00-00",
                "currency": "GBP",
                "nominal_account_code": "1000",
                "opening_balance": "15000.00",
                "default_account": True,
                "allow_payments": True,
                "allow_receipts": True,
                "active": True,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            },
            {
                "id": sid("bank-account", "stripe"),
                "client_id": DEMO_CLIENT_ID,
                "account_name": "Stripe Clearing",
                "bank_name": "Stripe",
                "account_number": "STRIPE",
                "sort_code": "00-00-00",
                "currency": "GBP",
                "nominal_account_code": "1010",
                "opening_balance": "0.00",
                "default_account": False,
                "allow_payments": False,
                "allow_receipts": True,
                "active": True,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            },
        ]
        imports = []
        transactions = []
        matches = []
        running = Decimal("15000.00")
        for imp in range(1, 37):
            imports.append(
                {
                    "id": sid("bank-import", str(imp)),
                    "client_id": DEMO_CLIENT_ID,
                    "bank_account_id": accounts[0]["id"],
                    "provider": "CSV",
                    "source_type": "csv",
                    "filename": f"demo_statement_{imp:02d}.csv",
                    "imported_by": DEMO_USER,
                    "rows_imported": self.bank_count // 36,
                    "duplicates": imp % 4,
                    "errors": 0 if imp % 9 else 1,
                    "status": "processed",
                    "raw_summary": json.dumps({"demo": True, "statement": imp}),
                    "created_at": iso(DEMO_NOW - timedelta(days=36 - imp)),
                    "updated_at": iso(DEMO_NOW - timedelta(days=36 - imp)),
                }
            )
        linked = []
        for row in ap_payments[: min(len(ap_payments), self.bank_count // 5)]:
            linked.append(("supplier_payment", row["id"], row["payment_date"], row["reference"], Decimal(row["amount"]), "out"))
        for row in ar_receipts[: min(len(ar_receipts), self.bank_count // 4)]:
            linked.append(("customer_receipt", row["id"], row["receipt_date"], row["reference"], Decimal(row["amount"]), "in"))
        for idx in range(1, self.bank_count + 1):
            if idx <= len(linked):
                source_type, source_id, tx_date, ref, amount, direction = linked[idx - 1]
                money_in = amount if direction == "in" else Decimal("0.00")
                money_out = amount if direction == "out" else Decimal("0.00")
                desc = f"{source_type.replace('_', ' ').title()} {ref}"
                status = "matched"
                matched_to = source_id
                confidence = 96
            else:
                tx_date = iso(date(2024 + (idx % 3), ((idx * 3) % 12) + 1, ((idx * 17) % 25) + 1))
                source_type = "statement_import"
                source_id = None
                ref = f"BANK-{idx:06d}"
                direction = "out" if idx % 3 else "in"
                amount = q(5 + (idx * 7.89) % 850)
                money_in = amount if direction == "in" else Decimal("0.00")
                money_out = amount if direction == "out" else Decimal("0.00")
                desc = ["Card settlement", "Bank charge", "Interest received", "HMRC payment", "Supplier direct debit"][idx % 5]
                status = "reconciled" if idx % 4 else "unreconciled"
                matched_to = None
                confidence = 60 + (idx % 36)
            running = q(running + money_in - money_out)
            tx_id = sid("bank-tx", str(idx))
            transactions.append(
                {
                    "id": tx_id,
                    "client_id": DEMO_CLIENT_ID,
                    "bank_account_id": accounts[0]["id"],
                    "bank_account_code": "1000",
                    "transaction_date": tx_date,
                    "description": desc,
                    "reference": ref,
                    "transaction_type": source_type,
                    "source_type": source_type,
                    "import_id": sid("bank-import", str(((idx - 1) % 36) + 1)),
                    "money_in": str(money_in),
                    "money_out": str(money_out),
                    "balance": str(running),
                    "status": status,
                    "matched_to": matched_to,
                    "suggested_match": matched_to or desc,
                    "confidence": confidence,
                    "ignored": False,
                    "matched_contact_id": None,
                    "matched_account_code": "6300" if "charge" in desc.lower() else None,
                    "journal_entry_id": None,
                    "raw_json": json.dumps({"demo": True}),
                    "reconciled_at": iso(DEMO_NOW) if status in {"matched", "reconciled"} else None,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            if status == "matched":
                matches.append(
                    {
                        "id": sid("bank-match", str(idx)),
                        "client_id": DEMO_CLIENT_ID,
                        "bank_transaction_id": tx_id,
                        "match_type": "automatic",
                        "matched_record_type": source_type,
                        "matched_record_id": matched_to,
                        "amount": str(amount),
                        "confidence": confidence,
                        "status": "approved",
                        "journal_entry_id": None,
                        "created_at": iso(DEMO_NOW),
                        "updated_at": iso(DEMO_NOW),
                    }
                )
        rules = [
            ("HMRC payments", "description", "contains", "HMRC", "Create Journal", "2100", "Supplier Payment"),
            ("Bank charges", "description", "contains", "charge", "Create Journal", "6300", "Bank Charge"),
            ("Stripe settlements", "description", "contains", "Card settlement", "Match Receipt", "1010", "Customer Receipt"),
        ]
        rule_rows = [
            {
                "id": sid("bank-rule", name),
                "client_id": DEMO_CLIENT_ID,
                "name": name,
                "active": True,
                "bank_account_id": accounts[0]["id"],
                "field": field,
                "operator": op,
                "value": value,
                "amount_operator": None,
                "amount_value": None,
                "target_action": action,
                "target_account_code": target,
                "transaction_type": tx_type,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
            for name, field, op, value, action, target, tx_type in rules
        ]
        transfers = [
            {
                "id": sid("bank-transfer", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "from_bank_account_id": accounts[0]["id"],
                "to_bank_account_id": accounts[1]["id"],
                "transfer_date": iso(date(2026, ((idx - 1) % 6) + 1, 15)),
                "reference": f"TRF-{idx:04d}",
                "amount": str(q(500 + idx * 125)),
                "status": "posted",
                "posted_journal_id": self.journal(
                    "Bank Transfer",
                    sid("bank-transfer", str(idx)),
                    date(2026, ((idx - 1) % 6) + 1, 15),
                    f"TRF-{idx:04d}",
                    "Bank account transfer",
                    [("1010", "Transfer in", q(500 + idx * 125), Decimal("0.00"), None), ("1000", "Transfer out", Decimal("0.00"), q(500 + idx * 125), None)],
                ),
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
            for idx in range(1, 13)
        ]
        settings = [
            {
                "id": sid("bank-settings", "main"),
                "client_id": DEMO_CLIENT_ID,
                "default_bank_account_id": accounts[0]["id"],
                "default_transfer_account": "1000",
                "default_bank_charges_account": "6300",
                "default_interest_account": "7000",
                "default_suspense_account": "6900",
                "statement_number_prefix": "STAT",
                "automatic_matching_threshold": 90,
                "duplicate_detection": True,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        ]
        return accounts, imports, transactions, matches, rule_rows, transfers, settings

    def build_vat(self):
        codes = [
            ("20.0% S", "Standard rate", 20, True),
            ("0.0% Z", "Zero-rated", 0, True),
            ("Exempt", "Exempt from VAT", 0, True),
            ("No VAT", "No VAT applicable", 0, True),
            ("5.0% R", "Reduced rate", 5, False),
            ("20.0% RC CIS", "Domestic reverse charge standard", 20, False),
        ]
        code_rows = [
            {
                "id": sid("vat-code", code),
                "client_id": DEMO_CLIENT_ID,
                "code": code,
                "description": desc,
                "percentage": str(q(pct)),
                "purchase_behavior": "reclaim" if pct else "none",
                "sales_behavior": "collect" if pct else "none",
                "box_sales_vat": "1",
                "box_purchase_vat": "4",
                "box_sales_net": "6",
                "box_purchase_net": "7",
                "active": active,
                "system_code": True,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
            for code, desc, pct, active in codes
        ]
        settings = [
            {
                "id": sid("vat-settings", "main"),
                "client_id": DEMO_CLIENT_ID,
                "vat_registration_number": "GB220430231",
                "vat_scheme": "standard",
                "vat_frequency": "quarterly",
                "vat_start_date": "2023-05-01",
                "default_purchase_vat_code": "20.0% S",
                "default_sales_vat_code": "20.0% S",
                "default_bank_vat_code": "No VAT",
                "flat_rate_percentage": None,
                "cash_accounting": False,
                "accrual_accounting": True,
                "mtd_enabled": False,
                "hmrc_connection_status": "not_connected",
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        ]
        periods, returns = [], []
        start = date(2023, 5, 1)
        for idx in range(1, 14):
            period_start = add_months(start, (idx - 1) * 3)
            period_end = add_months(period_start, 3) - timedelta(days=1)
            due = add_months(period_end, 1) + timedelta(days=7)
            output = q(2500 + idx * 187.34)
            input_vat = q(1100 + idx * 96.12)
            net = q(output - input_vat)
            status = "submitted" if period_end < date(2026, 5, 1) else "open"
            period_id = sid("vat-period", str(idx))
            periods.append(
                {
                    "id": period_id,
                    "client_id": DEMO_CLIENT_ID,
                    "period_start": iso(period_start),
                    "period_end": iso(period_end),
                    "due_date": iso(due),
                    "status": status,
                    "output_vat": str(output),
                    "input_vat": str(input_vat),
                    "net_vat": str(net),
                    "transaction_count": 120 + idx * 7,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            returns.append(
                {
                    "id": sid("vat-return", str(idx)),
                    "client_id": DEMO_CLIENT_ID,
                    "period_start": iso(period_start),
                    "period_end": iso(period_end),
                    "status": "submitted" if status == "submitted" else "draft",
                    "vat_due_sales": str(output),
                    "vat_reclaimed_purchases": str(input_vat),
                    "net_vat_due": str(net),
                    "sales_net": str(q(output / Decimal("0.20"))),
                    "purchase_net": str(q(input_vat / Decimal("0.20"))),
                    "box1": str(output),
                    "box2": "0.00",
                    "box3": str(output),
                    "box4": str(input_vat),
                    "box5": str(net),
                    "box6": str(q(output / Decimal("0.20"))),
                    "box7": str(q(input_vat / Decimal("0.20"))),
                    "box8": "0.00",
                    "box9": "0.00",
                    "locked_at": iso(DEMO_NOW) if status == "submitted" else None,
                    "submitted_at": iso(DEMO_NOW) if status == "submitted" else None,
                    "notes": "Seeded quarterly VAT return.",
                    "prepared_json": json.dumps({"source": "demo", "drilldown": True}),
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
        adjustments = [
            {
                "id": sid("vat-adjustment", str(idx)),
                "client_id": DEMO_CLIENT_ID,
                "vat_period_id": sid("vat-period", str((idx % 8) + 1)),
                "adjustment_date": iso(date(2025, (idx % 12) + 1, 12)),
                "adjustment_type": "rounding",
                "vat_code": "20.0% S",
                "reason": "Rounding adjustment",
                "notes": "Seeded VAT rounding correction.",
                "net_amount": "0.00",
                "vat_amount": str(q((idx % 5) - 2)),
                "gross_amount": str(q((idx % 5) - 2)),
                "status": "posted",
                "journal_entry_id": None,
                "created_by": DEMO_USER,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
            for idx in range(1, 13)
        ]
        return settings, code_rows, periods, returns, adjustments

    def build_fixed_assets(self, supplier_rows: list[dict]):
        categories = [
            ("Computer Equipment", 36, "1300", "1310"),
            ("Office Equipment", 60, "1320", "1330"),
            ("Furniture & Fixtures", 84, "1320", "1330"),
            ("Plant & Machinery", 60, "1300", "1310"),
        ]
        category_rows = [
            {
                "id": sid("asset-category", name),
                "client_id": DEMO_CLIENT_ID,
                "name": name,
                "description": f"{name} demo category",
                "default_depreciation_method": "straight_line",
                "default_useful_life_months": months,
                "default_residual_value": "0.00",
                "fixed_asset_account": asset_account,
                "accumulated_depreciation_account": acc_dep,
                "depreciation_expense_account": "6400",
                "active": True,
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
            for name, months, asset_account, acc_dep in categories
        ]
        assets, depreciation, events = [], [], []
        for idx in range(1, 26):
            cat = category_rows[idx % len(category_rows)]
            supplier = supplier_rows[(idx * 3) % len(supplier_rows)]
            purchase_cost = q(450 + idx * 215.45)
            life = int(cat["default_useful_life_months"])
            monthly = q(purchase_cost / life)
            accumulated = q(monthly * min(18, life))
            nbv = q(purchase_cost - accumulated)
            asset_id = sid("asset", str(idx))
            purchase_date = date(2024 + (idx % 3), ((idx * 4) % 12) + 1, min(25, idx + 1))
            assets.append(
                {
                    "id": asset_id,
                    "client_id": DEMO_CLIENT_ID,
                    "asset_code": f"FA-{idx:04d}",
                    "asset_name": f"{cat['name']} Asset {idx:02d}",
                    "description": f"Seeded {cat['name'].lower()} asset",
                    "category_id": cat["id"],
                    "category_name": cat["name"],
                    "location": "Halifax Office" if idx % 2 else "Remote Team",
                    "department": "Operations" if idx % 3 else "Engineering",
                    "serial_number": f"SN-DEMO-{idx:05d}",
                    "manufacturer": "Dell" if idx % 2 else "Apple",
                    "model": f"Model {idx}",
                    "supplier_id": supplier["id"],
                    "supplier_name": supplier["trading_name"],
                    "purchase_invoice_id": sid("ap-invoice", str(idx * 2)),
                    "purchase_date": iso(purchase_date),
                    "in_service_date": iso(purchase_date + timedelta(days=3)),
                    "capitalisation_date": iso(purchase_date),
                    "purchase_cost": str(purchase_cost),
                    "residual_value": "0.00",
                    "useful_life_months": life,
                    "depreciation_method": "straight_line",
                    "depreciation_frequency": "monthly",
                    "fixed_asset_account": cat["fixed_asset_account"],
                    "accumulated_depreciation_account": cat["accumulated_depreciation_account"],
                    "depreciation_expense_account": "6400",
                    "accumulated_depreciation": str(accumulated),
                    "net_book_value": str(nbv),
                    "status": "active" if idx % 9 else "disposed",
                    "disposal_date": iso(date(2026, 6, 30)) if idx % 9 == 0 else None,
                    "disposal_proceeds": str(q(nbv * Decimal("0.45"))) if idx % 9 == 0 else None,
                    "created_from_submission_id": sid("submission", str(idx)),
                    "notes": "Seeded fixed asset with depreciation schedule.",
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            ytd = Decimal("0.00")
            opening = purchase_cost
            for m in range(1, 13):
                period_start = add_months(purchase_date.replace(day=1), m)
                period_end = add_months(period_start, 1) - timedelta(days=1)
                ytd = q(ytd + monthly)
                closing = q(max(Decimal("0.00"), opening - monthly))
                depreciation.append(
                    {
                        "id": sid("asset-dep", f"{idx}:{m}"),
                        "client_id": DEMO_CLIENT_ID,
                        "asset_id": asset_id,
                        "period_label": period_start.strftime("%Y-%m"),
                        "period_start": iso(period_start),
                        "period_end": iso(period_end),
                        "opening_nbv": str(opening),
                        "charge": str(monthly),
                        "ytd_depreciation": str(ytd),
                        "accumulated_depreciation": str(ytd),
                        "closing_nbv": str(closing),
                        "status": "posted" if period_end < date(2026, 7, 1) else "scheduled",
                        "journal_entry_id": None,
                        "posted_at": iso(DEMO_NOW) if period_end < date(2026, 7, 1) else None,
                        "created_at": iso(DEMO_NOW),
                        "updated_at": iso(DEMO_NOW),
                    }
                )
                opening = closing
            events.append(
                {
                    "id": sid("asset-event", str(idx)),
                    "client_id": DEMO_CLIENT_ID,
                    "asset_id": asset_id,
                    "event_type": "created",
                    "event_date": iso(purchase_date),
                    "from_value": None,
                    "to_value": str(purchase_cost),
                    "amount": str(purchase_cost),
                    "notes": "Asset created from demo purchase invoice.",
                    "journal_entry_id": None,
                    "created_by": DEMO_USER,
                    "created_at": iso(DEMO_NOW),
                }
            )
        settings = [
            {
                "id": sid("asset-settings", "main"),
                "client_id": DEMO_CLIENT_ID,
                "default_depreciation_method": "straight_line",
                "posting_frequency": "monthly",
                "asset_number_prefix": "FA",
                "next_asset_number": 26,
                "capitalisation_threshold": "250.00",
                "default_fixed_asset_account": "1300",
                "default_accumulated_depreciation_account": "1310",
                "default_depreciation_expense_account": "6400",
                "default_disposal_account": "6900",
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        ]
        return settings, category_rows, assets, depreciation, events

    def build_submissions(self):
        rows = []
        statuses = ["inbox", "archive", "archive", "archive", "inbox", "review"]
        for idx in range(1, self.docs + 1):
            doc_type = "purchase" if idx % 3 else "sales"
            status = statuses[idx % len(statuses)]
            rows.append(
                {
                    "id": sid("submission", str(idx)),
                    "client_id": DEMO_CLIENT_ID,
                    "type": doc_type,
                    "description": f"Demo {doc_type} document {idx:05d}",
                    "date": iso(date(2024 + (idx % 3), ((idx * 2) % 12) + 1, ((idx * 5) % 25) + 1)),
                    "amount": str(q(10 + (idx * 5.75) % 2000)),
                    "comment": "Client approved warning" if idx % 23 == 0 else "",
                    "image_filename": f"demo/documents/{idx:05d}.pdf",
                    "is_additional": idx % 4 == 0,
                    "ai_review_status": "valid" if idx % 19 else "needs_review",
                    "ai_review_message": "Valid invoice or receipt." if idx % 19 else "Supplier mismatch warning approved by client.",
                    "ai_document_type": "invoice" if idx % 5 else "receipt",
                    "ai_extracted_fields": json.dumps({"supplier": "Amazon Business", "net": "120.00", "vat": "24.00", "gross": "144.00", "payment_method": "Card"}),
                    "coding_fields": json.dumps({"vendorName": "Amazon Business", "category": "Software and Hosting", "vatCode": "20.0% S", "paymentMethod": "Card"}),
                    "ai_client_approved": idx % 23 == 0,
                    "review_status": status,
                    "reviewed_at": iso(DEMO_NOW) if status == "archive" else None,
                    "submitted_at": iso(DEMO_NOW - timedelta(minutes=idx)),
                    "client_business_name": DEMO_BUSINESS_NAME,
                    "client_first_name": "Devis",
                    "client_last_name": "Smits",
                }
            )
        return rows

    def build_automation(self):
        templates, workflows, runs, approvals, exceptions = [], [], [], [], []
        names = [
            "Purchase Invoice Automation",
            "Sales Invoice Automation",
            "Bank Import Automation",
            "VAT Preparation",
            "Month End Checklist",
            "Year End Checklist",
            "New Client Onboarding",
            "AI Low Confidence Review",
        ]
        for idx, name in enumerate(names, start=1):
            blocks = [{"type": "trigger", "label": name}, {"type": "condition", "label": "Confidence > 90%"}, {"type": "action", "label": "Create task or posting"}]
            workflows.append(
                {
                    "id": sid("workflow", str(idx)),
                    "name": f"EPOS Demo {name}",
                    "description": f"Demo workflow for {name.lower()}.",
                    "trigger_type": name.lower().replace(" ", "_"),
                    "status": "active",
                    "permission_role": "accountant",
                    "blocks_json": json.dumps(blocks),
                    "conditions_json": json.dumps({"client_id": DEMO_CLIENT_ID}),
                    "actions_json": json.dumps([{"action": "notify"}, {"action": "audit"}]),
                    "approval_required": idx in {1, 8},
                    "time_saved_minutes": idx * 3,
                    "last_run_at": iso(DEMO_NOW - timedelta(hours=idx)),
                    "created_by": DEMO_USER,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
            templates.append(
                {
                    "id": sid("automation-template", str(idx)),
                    "name": f"EPOS Demo {name}",
                    "description": f"Reusable template for {name.lower()}.",
                    "category": "Demo",
                    "trigger_type": name.lower().replace(" ", "_"),
                    "blocks_json": json.dumps(blocks),
                    "conditions_json": json.dumps({}),
                    "actions_json": json.dumps([{"action": "notify"}]),
                    "active": True,
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )
        for idx in range(1, self.runs + 1):
            workflow = workflows[idx % len(workflows)]
            status = "failed" if idx % 37 == 0 else ("approval_required" if idx % 19 == 0 else "success")
            run_id = sid("automation-run", str(idx))
            runs.append(
                {
                    "id": run_id,
                    "workflow_id": workflow["id"],
                    "workflow_name": workflow["name"],
                    "trigger_type": workflow["trigger_type"],
                    "trigger_payload_json": json.dumps({"client_id": DEMO_CLIENT_ID, "sequence": idx}),
                    "status": status,
                    "result": "Completed" if status == "success" else "Requires attention",
                    "actions_taken_json": json.dumps(["validated", "notified", "audited"]),
                    "duration_ms": 250 + (idx % 1400),
                    "time_saved_minutes": 2 + (idx % 7),
                    "started_at": iso(DEMO_NOW - timedelta(minutes=idx * 3)),
                    "finished_at": iso(DEMO_NOW - timedelta(minutes=idx * 3 - 1)) if status != "approval_required" else None,
                    "created_by": DEMO_USER,
                }
            )
            if status == "approval_required":
                approvals.append(
                    {
                        "id": sid("automation-approval", str(idx)),
                        "workflow_id": workflow["id"],
                        "run_id": run_id,
                        "title": "Demo approval required",
                        "summary": "Review low confidence AI extraction before posting.",
                        "status": "pending",
                        "assigned_to": "manager",
                        "requested_by": DEMO_USER,
                        "resolved_by": None,
                        "resolved_at": None,
                        "payload_json": json.dumps({"client_id": DEMO_CLIENT_ID}),
                        "created_at": iso(DEMO_NOW - timedelta(minutes=idx)),
                    }
                )
            if status == "failed":
                exceptions.append(
                    {
                        "id": sid("automation-exception", str(idx)),
                        "workflow_id": workflow["id"],
                        "run_id": run_id,
                        "exception_type": "validation",
                        "message": "Demo missing nominal account mapping.",
                        "status": "open",
                        "resolution": None,
                        "payload_json": json.dumps({"client_id": DEMO_CLIENT_ID}),
                        "created_at": iso(DEMO_NOW - timedelta(minutes=idx)),
                        "resolved_at": None,
                    }
                )
        return templates, workflows, runs, approvals, exceptions


async def demo_client_exists() -> bool:
    async with server.SessionLocal() as session:
        result = await session.execute(select(server.users.c.id).where(server.users.c.id == DEMO_CLIENT_ID))
        return result.scalar_one_or_none() is not None


async def seed(scale: str, if_missing: bool = False):
    async with server.engine.begin() as conn:
        await conn.run_sync(server.metadata.create_all)
        await server.ensure_schema_columns(conn)

    if if_missing and await demo_client_exists():
        print(
            json.dumps(
                {
                    "skipped": True,
                    "reason": "Demo client already exists.",
                    "client": DEMO_BUSINESS_NAME,
                    "client_id": DEMO_CLIENT_ID,
                    "login_email": DEMO_EMAIL,
                },
                indent=2,
            )
        )
        return

    builder = DemoBuilder(scale)
    supplier_rows = suppliers()
    customer_rows = customers()
    ap_invoices, ap_lines, ap_payments, ap_allocations = builder.build_ap(supplier_rows)
    ar_invoices, ar_lines, ar_receipts, ar_allocations = builder.build_ar(customer_rows)
    bank_accounts, bank_imports, bank_tx, bank_matches, bank_rules, bank_transfers, bank_settings = builder.build_bank(ap_payments, ar_receipts)
    vat_settings, vat_codes, vat_periods, vat_returns, vat_adjustments = builder.build_vat()
    asset_settings, asset_categories, assets, asset_depreciation, asset_events = builder.build_fixed_assets(supplier_rows)
    submissions = builder.build_submissions()
    automation_templates, automation_workflows, automation_runs, automation_approvals, automation_exceptions = builder.build_automation()

    while len(builder.audit_rows) < builder.audit_target:
        idx = len(builder.audit_rows) + 1
        builder.audit("Platform", "demo_record", sid("audit-target", str(idx)), "reviewed", {"sequence": idx, "source": "bulk demo history"})

    financial_years = []
    periods = []
    for offset, year in enumerate((2024, 2025, 2026), start=1):
        fy_id = sid("financial-year", str(year))
        start = date(year - 1, 5, 1)
        end = date(year, 4, 30)
        financial_years.append(
            {
                "id": fy_id,
                "client_id": DEMO_CLIENT_ID,
                "name": f"FY{year}",
                "start_date": iso(start),
                "end_date": iso(end),
                "status": "closed" if year < 2026 else "open",
                "created_at": iso(DEMO_NOW),
                "updated_at": iso(DEMO_NOW),
            }
        )
        for p in range(1, 13):
            period_start = add_months(start, p - 1)
            period_end = add_months(period_start, 1) - timedelta(days=1)
            periods.append(
                {
                    "id": sid("period", f"{year}:{p}"),
                    "client_id": DEMO_CLIENT_ID,
                    "financial_year_id": fy_id,
                    "period_name": period_start.strftime("%b %Y"),
                    "period_number": p,
                    "period_start": iso(period_start),
                    "period_end": iso(period_end),
                    "status": "closed" if year < 2026 else ("locked" if p < 9 else "open"),
                    "transactions_posted": 150 + p * 11,
                    "notes": "Seeded monthly period.",
                    "created_at": iso(DEMO_NOW),
                    "updated_at": iso(DEMO_NOW),
                }
            )

    password_hash = bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    client_row = {
        "id": DEMO_CLIENT_ID,
        "email": DEMO_EMAIL,
        "password_hash": password_hash,
        "role": "client",
        "first_name": "Devis",
        "last_name": "Smits",
        "business_name": DEMO_BUSINESS_NAME,
        "client_type": "Limited company",
        "industry": "Software Development & Bookkeeping",
        "company_number": "12573813",
        "company_status": "active",
        "incorporation_date": "2020-04-27",
        "registered_office_address": "16d Calderdale Business Park, Club Lane, Halifax, England, HX2 8DB",
        "trading_address": "16d Calderdale Business Park, Club Lane, Halifax, England, HX2 8DB",
        "phone": "01422 555000",
        "utr": "1234567890",
        "vat_number": "GB220430231",
        "paye_reference": "123/AB456",
        "accounts_office_reference": "123PA00012345",
        "authorisation_codes": json.dumps({"corporation_tax": "CT-123456", "vat": "VAT-220430231", "paye": "PAYE-AB456"}),
        "services_required": json.dumps(["Bookkeeping", "Accounts", "VAT Returns", "Payroll", "Corporation Tax", "Confirmation Statement", "Management Accounts", "Automation", "AI Review"]),
        "service_settings": json.dumps({"bookkeeping": {"frequency": "monthly"}, "vat": {"frequency": "quarterly"}, "payroll": {"frequency": "monthly"}}),
        "statutory_deadlines": json.dumps(
            {
                "accounts_due": "2028-01-31",
                "accounts_made_up_to": "2027-04-30",
                "confirmation_statement_due": "2027-02-03",
                "confirmation_statement_date": "2027-01-20",
                "ct600_due": "2028-04-30",
            }
        ),
        "deadline_tasks": json.dumps(
            [
                {"service": "Accounts", "start_date": "2027-05-01", "due_date": "2028-01-31", "status": "open"},
                {"service": "CT600", "start_date": "2027-05-01", "due_date": "2028-04-30", "status": "open"},
                {"service": "Confirmation Statement", "start_date": "2027-01-20", "due_date": "2027-02-03", "status": "open"},
            ]
        ),
        "bookkeeping_frequency": "monthly",
        "payroll_frequency": "monthly",
        "year_end": "30 April",
        "practice_manager": "Sarah Johnson",
        "companies_house_last_checked": iso(DEMO_NOW),
        "main_contact_name": "Devis Smits",
        "main_contact_role": "Director",
        "company_directors": json.dumps([{"name": "Devis Smits", "role": "Director", "appointed_on": "2020-04-27"}]),
        "company_pscs": json.dumps([{"name": "Devis Smits", "ownership": "75% or more"}]),
        "company_contacts": json.dumps(
            [
                {"name": "Sarah Johnson", "role": "Client Manager"},
                {"name": "David Brown", "role": "Bookkeeper"},
                {"name": "Emily Clarke", "role": "VAT Reviewer"},
                {"name": "James Wilson", "role": "Payroll"},
            ]
        ),
        "companies_house_filings": json.dumps(
            [
                {"type": "accounts", "made_up_to": "2026-04-30", "filed_on": "2026-07-05"},
                {"type": "confirmation_statement", "made_up_to": "2026-01-20", "filed_on": "2026-01-25"},
            ]
        ),
        "autoentry_email": "purchase@eposbookings.net",
        "sales_autoentry_email": "sales@eposbookings.net",
        "is_vat_client": True,
        "ai_analysis_enabled": True,
        "accounting_destination": "native",
        "native_accounting_enabled": True,
        "native_accounting_created_at": iso(DEMO_NOW),
        "status": "active",
        "created_at": iso(DEMO_NOW),
    }

    accounting_settings = [
        {
            "id": sid("accounting-settings", "main"),
            "client_id": DEMO_CLIENT_ID,
            "default_sales_account": "4010",
            "default_purchase_account": "5000",
            "default_vat_control_account": "2100",
            "default_bank_account": "1000",
            "default_suspense_account": "6900",
            "default_debtors_control_account": "1100",
            "default_creditors_control_account": "2000",
            "default_retained_earnings_account": "3200",
            "created_at": iso(DEMO_NOW),
            "updated_at": iso(DEMO_NOW),
        }
    ]
    year_end_settings = [
        {
            "id": sid("year-end-settings", "main"),
            "client_id": DEMO_CLIENT_ID,
            "retained_earnings_account": "3200",
            "allow_period_reopen": True,
            "automatic_opening_balances": True,
            "year_end_approval_required": True,
            "checklist_requirements": json.dumps(["Trial balance reviewed", "VAT periods checked", "Bank reconciliations complete"]),
            "created_at": iso(DEMO_NOW),
            "updated_at": iso(DEMO_NOW),
        }
    ]
    opening_balances = [
        {
            "id": sid("opening-balance", code),
            "client_id": DEMO_CLIENT_ID,
            "financial_year_id": sid("financial-year", "2026"),
            "source_financial_year_id": sid("financial-year", "2025"),
            "account_code": code,
            "account_name": name,
            "category": category,
            "debit": str(q(amount if normal == "Debit" else 0)),
            "credit": str(q(amount if normal == "Credit" else 0)),
            "journal_entry_id": None,
            "status": "posted",
            "created_at": iso(DEMO_NOW),
            "updated_at": iso(DEMO_NOW),
        }
        for code, name, category, amount, normal in [
            ("1000", "Business Current Account", "Asset", 15000, "Debit"),
            ("1100", "Trade Debtors", "Asset", 28000, "Debit"),
            ("2000", "Trade Creditors", "Liability", 11500, "Credit"),
            ("2100", "VAT Control", "Liability", 4200, "Credit"),
            ("3200", "Retained Earnings", "Equity", 27300, "Credit"),
        ]
    ]
    year_end_events = [
        {
            "id": sid("year-end-event", str(idx)),
            "client_id": DEMO_CLIENT_ID,
            "event_type": "financial_year_closed" if idx < 3 else "period_locked",
            "financial_year_id": sid("financial-year", str(2023 + idx)),
            "period_id": None,
            "journal_entry_id": None,
            "user_id": "demo-seeder",
            "reason": "Seeded historical close event.",
            "payload_json": json.dumps({"demo": True}),
            "created_at": iso(DEMO_NOW - timedelta(days=idx * 30)),
        }
        for idx in range(1, 4)
    ]
    notifications = [
        {
            "id": sid("notification", str(idx)),
            "user_id": None,
            "client_id": DEMO_CLIENT_ID,
            "channel": "in_app",
            "severity": "warning" if idx % 7 == 0 else "info",
            "title": ["VAT return due", "Bank match ready", "Document needs review", "Automation completed"][idx % 4],
            "message": "Seeded notification for demo dashboard.",
            "module": ["VAT", "Banking", "AI Review", "Automation"][idx % 4],
            "record_type": "demo",
            "record_id": sid("notification-record", str(idx)),
            "status": "unread" if idx % 3 else "read",
            "created_at": iso(DEMO_NOW - timedelta(hours=idx)),
            "read_at": iso(DEMO_NOW) if idx % 3 == 0 else None,
        }
        for idx in range(1, 61)
    ]
    health = [
        {"id": sid("health", "db"), "component": "demo_database", "status": "healthy", "metric": "latency_ms", "value": "18", "details_json": json.dumps({"score": 93}), "checked_at": iso(DEMO_NOW)},
        {"id": sid("health", "queue"), "component": "demo_queue", "status": "healthy", "metric": "backlog", "value": "4", "details_json": json.dumps({"ai_processing": 2}), "checked_at": iso(DEMO_NOW)},
        {"id": sid("health", "integrations"), "component": "demo_integrations", "status": "degraded", "metric": "failed_syncs", "value": "1", "details_json": json.dumps({"quickbooks": "disabled", "companies_house": "connected"}), "checked_at": iso(DEMO_NOW)},
    ]
    errors = [
        {
            "id": sid("error", str(idx)),
            "correlation_id": sid("correlation-error", str(idx)),
            "path": "/api/v1/demo",
            "method": "POST",
            "status_code": 422 if idx % 2 else 409,
            "message": "Seeded recoverable validation error.",
            "details": json.dumps({"demo": True, "resolved": idx % 3 == 0}),
            "user_id": None,
            "created_at": iso(DEMO_NOW - timedelta(days=idx)),
        }
        for idx in range(1, 21)
    ]

    async with server.SessionLocal() as session:
        await clear_demo(session)
        await insert_many(session, server.users, [client_row])
        await insert_many(session, server.accounting_accounts, account_rows())
        await insert_many(session, server.accounting_settings, accounting_settings)
        await insert_many(session, server.accounting_contacts, contacts_for(supplier_rows, customer_rows))
        await insert_many(session, server.accounting_financial_years, financial_years)
        await insert_many(session, server.accounting_periods, periods)
        await insert_many(session, server.accounting_ap_supplier_profiles, supplier_rows)
        await insert_many(session, server.accounting_ar_customer_profiles, customer_rows)
        await insert_many(session, server.submissions, submissions)
        await insert_many(session, server.accounting_ap_invoices, ap_invoices)
        await insert_many(session, server.accounting_ap_invoice_lines, ap_lines)
        await insert_many(session, server.accounting_ap_payments, ap_payments)
        await insert_many(session, server.accounting_ap_payment_allocations, ap_allocations)
        await insert_many(session, server.accounting_ar_invoices, ar_invoices)
        await insert_many(session, server.accounting_ar_invoice_lines, ar_lines)
        await insert_many(session, server.accounting_ar_receipts, ar_receipts)
        await insert_many(session, server.accounting_ar_receipt_allocations, ar_allocations)
        await insert_many(session, server.accounting_bank_accounts, bank_accounts)
        await insert_many(session, server.accounting_bank_imports, bank_imports)
        await insert_many(session, server.accounting_bank_transactions, bank_tx)
        await insert_many(session, server.accounting_bank_matches, bank_matches)
        await insert_many(session, server.accounting_bank_rules, bank_rules)
        await insert_many(session, server.accounting_bank_transfers, bank_transfers)
        await insert_many(session, server.accounting_bank_settings, bank_settings)
        await insert_many(session, server.accounting_vat_settings, vat_settings)
        await insert_many(session, server.accounting_vat_codes, vat_codes)
        await insert_many(session, server.accounting_vat_periods, vat_periods)
        await insert_many(session, server.accounting_vat_returns, vat_returns)
        await insert_many(session, server.accounting_vat_adjustments, vat_adjustments)
        await insert_many(session, server.accounting_fixed_asset_settings, asset_settings)
        await insert_many(session, server.accounting_fixed_asset_categories, asset_categories)
        await insert_many(session, server.accounting_fixed_assets, assets)
        await insert_many(session, server.accounting_fixed_asset_depreciation, asset_depreciation)
        await insert_many(session, server.accounting_fixed_asset_events, asset_events)
        await insert_many(session, server.accounting_year_end_settings, year_end_settings)
        await insert_many(session, server.accounting_opening_balances, opening_balances)
        await insert_many(session, server.accounting_year_end_events, year_end_events)
        await insert_many(session, server.accounting_journal_entries, builder.journal_entries)
        await insert_many(session, server.accounting_journal_lines, builder.journal_lines)
        await insert_many(session, server.automation_templates, automation_templates)
        await insert_many(session, server.automation_workflows, automation_workflows)
        await insert_many(session, server.automation_runs, automation_runs)
        await insert_many(session, server.automation_approvals, automation_approvals)
        await insert_many(session, server.automation_exceptions, automation_exceptions)
        await insert_many(session, server.platform_activity_feed, builder.activity_rows)
        await insert_many(session, server.platform_notifications, notifications)
        await insert_many(session, server.platform_health_checks, health)
        await insert_many(session, server.platform_error_logs, errors)
        await insert_many(session, server.accounting_audit_log, builder.audit_rows)
        await session.commit()

    print(json.dumps({
        "client": DEMO_BUSINESS_NAME,
        "client_id": DEMO_CLIENT_ID,
        "login_email": DEMO_EMAIL,
        "login_password": DEMO_PASSWORD,
        "scale": scale,
        "suppliers": len(supplier_rows),
        "customers": len(customer_rows),
        "purchase_invoices": len(ap_invoices),
        "sales_invoices": len(ar_invoices),
        "bank_transactions": len(bank_tx),
        "submissions": len(submissions),
        "automation_runs": len(automation_runs),
        "audit_events": len(builder.audit_rows),
    }, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Seed the EPOS Accountancy Demo account as a normal live client.")
    parser.add_argument("--scale", choices=["quick", "full"], default="full", help="Use quick for local smoke tests or full for pilot-scale demo data.")
    parser.add_argument("--if-missing", action="store_true", help="Skip without changing data when the demo client already exists.")
    args = parser.parse_args()
    asyncio.run(seed(args.scale, if_missing=args.if_missing))


if __name__ == "__main__":
    main()
