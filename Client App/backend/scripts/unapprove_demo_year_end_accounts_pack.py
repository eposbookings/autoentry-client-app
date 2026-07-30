"""Reopen the approved year-end demo pack as a new editable version."""

from __future__ import annotations

import asyncio
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
        client = await app.one(session, select(app.users).where(app.users.c.email == EMAIL))
        if not client:
            raise RuntimeError("Demo client not found.")
        pack = await app.one(
            session,
            select(app.accounting_annual_accounts_packs)
            .where(app.accounting_annual_accounts_packs.c.client_id == client["id"])
            .order_by(app.accounting_annual_accounts_packs.c.updated_at.desc()),
        )
        if not pack:
            raise RuntimeError("Demo Year End Accounts pack not found.")
        if pack.get("status") != "approved":
            print(f"Pack is already editable with status {pack.get('status')}.")
            return

        values = {
            "status": "draft",
            "locked_snapshot": False,
            "version_number": int(pack.get("version_number") or 1) + 1,
            "approved_by": None,
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
            "annual_accounts_pack_reopened",
            "annual_accounts_pack",
            str(pack["id"]),
            values,
        )
        await session.commit()
        print(
            f"Reopened pack {pack['id']} as editable version {values['version_number']} "
            f"with status {values['status']}."
        )


if __name__ == "__main__":
    asyncio.run(main())
