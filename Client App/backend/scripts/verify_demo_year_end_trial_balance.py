"""Verify the seeded Demo Account Year-End Accounts dataset."""

import asyncio
import json
import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{(BACKEND_DIR / 'autoentry_portal.db').as_posix()}",
)

import server as app  # noqa: E402


EMAIL = "demo.yearend.accounts@epos.demo"


def amount(value) -> str:
    return f"{Decimal(str(value or 0)).quantize(Decimal('0.01'))}"


async def scalar_count(db, table: str, client_id: str) -> int:
    result = await db.execute(
        app.text(f"SELECT COUNT(*) FROM {table} WHERE client_id = :client_id"),
        {"client_id": client_id},
    )
    return int(result.scalar() or 0)


async def main() -> None:
    async with app.SessionLocal() as db:
        user_result = await db.execute(
            app.text(
                """
                SELECT id, first_name, last_name, email, business_name
                FROM users
                WHERE lower(email) = lower(:email)
                """
            ),
            {"email": EMAIL},
        )
        user = user_result.mappings().first()
        if not user:
            print(json.dumps({"exists": False, "email": EMAIL}, indent=2))
            return

        client_id = str(user["id"])
        client = await app.one(
            db,
            app.select(app.users).where(app.users.c.id == client_id),
        )
        trial_balance = await app.canonical_trial_balance(
            db,
            client_id,
            date_from="2025-07-01",
            date_to="2026-06-30",
            date_mode="as_at",
        )
        rows = trial_balance.get("trial_balance", [])
        balances = {
            str(row["code"]): {
                "name": row["name"],
                "debit": amount(row["debit"]),
                "credit": amount(row["credit"]),
            }
            for row in rows
            if Decimal(str(row.get("debit", 0))) != 0
            or Decimal(str(row.get("credit", 0))) != 0
        }

        ar_result = await db.execute(
            app.text(
                """
                SELECT COALESCE(SUM(outstanding_amount), 0)
                FROM accounting_ar_invoices
                WHERE client_id = :client_id
                """
            ),
            {"client_id": client_id},
        )
        ap_result = await db.execute(
            app.text(
                """
                SELECT COALESCE(SUM(outstanding_amount), 0)
                FROM accounting_ap_invoices
                WHERE client_id = :client_id
                """
            ),
            {"client_id": client_id},
        )

        count_tables = [
            "accounting_accounts",
            "accounting_contacts",
            "accounting_ar_invoices",
            "accounting_ap_invoices",
            "accounting_bank_transactions",
            "accounting_journal_entries",
            "accounting_journal_lines",
            "accounting_financial_years",
            "accounting_annual_accounts_packs",
            "accounting_annual_accounts_snapshots",
            "accounting_annual_accounts_outputs",
            "accounting_annual_accounts_filings",
        ]
        counts = {
            table: await scalar_count(db, table, client_id)
            for table in count_tables
        }
        pack_result = await db.execute(
            app.select(app.accounting_annual_accounts_packs)
            .where(app.accounting_annual_accounts_packs.c.client_id == client_id)
            .order_by(app.accounting_annual_accounts_packs.c.updated_at.desc())
        )
        pack_row = pack_result.mappings().first()
        pack = app.serialize_annual_accounts_pack(dict(pack_row)) if pack_row else None
        approval_issues = []
        taxonomy = None
        if pack:
            approval_issues = app.annual_accounts_pack_validation(
                pack,
                client,
                trial_balance["summary"],
                {
                    "turnover": "60000.00",
                    "balance_sheet_total": "61040.00",
                },
            )
            taxonomy = app.annual_accounts_taxonomy_selection(pack)
        workspace = await app.year_end_accounts_workspace(
            db,
            client,
            {
                "id": "verification-accountant",
                "first_name": "Logged-in",
                "last_name": "Accountant",
                "email": "accountant@example.test",
            },
        )

        print(
            json.dumps(
                {
                    "exists": True,
                    "client": dict(user),
                    "counts": counts,
                    "receivables_outstanding": amount(ar_result.scalar()),
                    "payables_outstanding": amount(ap_result.scalar()),
                    "year_end_preparation": {
                        "pack_status": pack.get("status") if pack else None,
                        "locked": bool(pack and pack.get("locked_snapshot")),
                        "approval_issues": approval_issues,
                        "taxonomy": taxonomy,
                        "available_inputs": {
                            "responsible_staff_default": workspace.get("current_accountant", {}).get("name"),
                            "signing_directors": [row["name"] for row in workspace.get("directors", [])],
                            "audit_basis_option_count": len(workspace.get("audit_basis_options", [])),
                            "accounts_taxonomy_option_count": len(workspace.get("taxonomy", {}).get("accounts_options", [])),
                            "computations_taxonomy_option_count": len(workspace.get("taxonomy", {}).get("computations_options", [])),
                        },
                    },
                    "trial_balance": {
                        "as_at": "2026-06-30",
                        "total_debit": amount(trial_balance["summary"].get("debit_total")),
                        "total_credit": amount(trial_balance["summary"].get("credit_total")),
                        "difference": amount(trial_balance["summary"].get("difference")),
                        "balances": balances,
                    },
                },
                indent=2,
                default=str,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
