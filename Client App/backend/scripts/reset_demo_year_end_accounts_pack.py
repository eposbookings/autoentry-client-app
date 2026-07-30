"""Reset user-entered preparation settings on the year-end demo pack.

Source-driven defaults remain available in the UI. This does not approve,
lock, generate or file the accounts.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from sqlalchemy import select, update


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{(BACKEND_DIR / 'autoentry_portal.db').as_posix()}",
)

import server as app  # noqa: E402


EMAIL = "demo.yearend.accounts@epos.demo"


async def main() -> None:
    async with app.SessionLocal() as session:
        client = await app.one(
            session,
            select(app.users).where(app.users.c.email == EMAIL),
        )
        if not client:
            raise RuntimeError("Demo Account Year-End Accounts was not found.")

        pack = await app.one(
            session,
            select(app.accounting_annual_accounts_packs)
            .where(app.accounting_annual_accounts_packs.c.client_id == client["id"])
            .order_by(app.accounting_annual_accounts_packs.c.updated_at.desc()),
        )
        if not pack:
            raise RuntimeError("Create the demo Year End Accounts pack before preparing it.")
        if pack.get("locked_snapshot"):
            raise RuntimeError("The demo pack is approved and locked; reopen it before changing preparation settings.")

        details = app.annual_accounts_json(pack.get("details_json"), {})
        details["employee_count"] = None
        details["accounts_taxonomy"] = None
        details["computations_taxonomy"] = None
        values = {
            "audit_exemption": None,
            "director_signing_name": "Olivia Morgan",
            "board_approval_date": None,
            "details_json": app.json_compact(details),
            "updated_at": app.utc_now_iso(),
        }
        await session.execute(
            update(app.accounting_annual_accounts_packs)
            .where(app.accounting_annual_accounts_packs.c.id == pack["id"])
            .values(**values)
        )
        await app.add_accounting_audit(
            session,
            str(client["id"]),
            None,
            "annual_accounts_demo_preparation_reset",
            "annual_accounts_pack",
            str(pack["id"]),
            values,
        )
        await session.commit()

        updated = app.serialize_annual_accounts_pack({**pack, **values})
        taxonomy = app.annual_accounts_taxonomy_selection(updated)
        print(json.dumps({
            "client_id": client["id"],
            "pack_id": pack["id"],
            "status": pack["status"],
            "locked": bool(pack.get("locked_snapshot")),
            "employee_count": updated["details"].get("employee_count"),
            "audit_basis": updated.get("audit_exemption"),
            "signing_director_default": updated.get("director_signing_name"),
            "board_approval_date": updated.get("board_approval_date"),
            "accounts_taxonomy": updated["details"].get("accounts_taxonomy"),
            "computations_taxonomy": updated["details"].get("computations_taxonomy"),
            "approved": False,
            "generated": False,
            "filed": False,
        }, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
