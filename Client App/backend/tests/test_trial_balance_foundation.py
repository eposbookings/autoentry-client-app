import asyncio
import inspect

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import server


def nominal(
    account_id,
    code,
    name,
    category,
    normal_balance,
    *,
    active=True,
    reporting_category_id=None,
    filing_status="Ready",
):
    return {
        "id": account_id,
        "client_id": "client-1",
        "code": code,
        "name": name,
        "category": category,
        "account_type": category,
        "purpose": "Standard Nominal",
        "normal_balance": normal_balance,
        "control_account": False,
        "is_control_account": False,
        "banking_enabled": False,
        "opening_balance": "0.00",
        "active": active,
        "statement": "P&L" if category in {"Income", "Expense"} else "Balance Sheet",
        "filing_status": filing_status,
        "reporting_category_id": reporting_category_id,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


async def create_trial_balance_database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for table in (
            server.accounting_accounts,
            server.accounting_journal_entries,
            server.accounting_journal_lines,
            server.accounting_bank_transactions,
        ):
            await connection.run_sync(table.create)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def add_journal(session, entry_id, entry_date, status, lines):
    await session.execute(insert(server.accounting_journal_entries).values(
        id=entry_id,
        client_id="client-1",
        source_type="manual_journal",
        source_id=entry_id,
        entry_date=entry_date,
        reference=entry_id,
        description=entry_id,
        status=status,
        total_debit="0.00",
        total_credit="0.00",
        created_at=f"{entry_date}T00:00:00Z",
        posted_at=f"{entry_date}T00:00:00Z" if status == "posted" else None,
    ))
    for index, line in enumerate(lines):
        await session.execute(insert(server.accounting_journal_lines).values(
            id=f"{entry_id}-line-{index}",
            entry_id=entry_id,
            client_id="client-1",
            account_id=line["account_id"],
            account_code=line["account_code"],
            account_name=line["account_name"],
            debit=line.get("debit", "0.00"),
            credit=line.get("credit", "0.00"),
            location_id=line.get("location_id"),
            dimension_id=line.get("dimension_id"),
            created_at=f"{entry_date}T00:00:00Z",
        ))


def test_trial_balance_route_declares_every_supported_filter_and_mode():
    parameters = inspect.signature(server.get_gl_trial_balance).parameters

    assert {
        "date_from",
        "date_to",
        "financial_year",
        "financial_year_id",
        "period",
        "period_id",
        "search",
        "account_code",
        "location_id",
        "dimension_id",
        "mode",
        "include_zero",
        "materiality",
    } <= set(parameters)
    assert parameters["mode"].default == "as_at"


def test_trial_balance_rows_preserve_inactive_history_and_flag_normal_balance_anomalies():
    accounts = [
        nominal("account-1", "1000", "Historic bank", "Asset", "debit", active=False),
        nominal("account-2", "4000", "Sales", "Income", "credit"),
    ]
    rows = server.trial_balance_rows_from_balances(
        accounts,
        {
            "account-1": server.Decimal("-25.00"),
            "account-2": server.Decimal("-25.00"),
        },
    )

    historic = next(row for row in rows if row["code"] == "1000")
    assert historic["active"] is False
    assert historic["credit"] == "25.00"
    assert historic["anomalies"] == ["opposite_to_normal_balance"]


def test_chart_of_accounts_contains_the_workbook_mapping_contract():
    expected = {
        "code", "name", "module", "default_active", "account_class", "account_subtype",
        "statement", "normal_balance", "control_account_type", "allow_manual_posting",
        "system_account", "internal_reporting_category", "statutory_presentation",
        "cash_flow_category", "default_tax_treatment", "vat_behaviour", "cis_role",
        "requires_dimension", "current_noncurrent_rule", "filing_status",
        "suggested_taxonomy_concept", "implementation_note",
    }

    assert expected <= set(server.accounting_accounts.c.keys())


def test_trial_balance_classification_comes_from_chart_of_accounts_mapping():
    account = nominal("cash", "1000", "Cash", "Asset", "debit", reporting_category_id="category-cash")
    account.update({
        "module": "CORE",
        "account_class": "Asset",
        "account_subtype": "Bank",
        "control_account_type": "Bank",
        "allow_manual_posting": False,
        "system_account": True,
        "internal_reporting_category": "Cash and cash equivalents",
        "statutory_presentation": "Cash and cash equivalents",
        "cash_flow_category": "Operating",
        "default_tax_treatment": "Balance sheet only",
        "vat_behaviour": "Sign/transaction driven",
        "cis_role": "",
        "requires_dimension": "",
        "current_noncurrent_rule": "Current",
        "suggested_taxonomy_concept": "CashBankOnHand",
    })

    row = server.trial_balance_rows_from_balances([account], {"cash": server.Decimal("25.00")})[0]

    assert row["reporting_category_id"] == "category-cash"
    assert row["reporting_category_name"] == "Cash and cash equivalents"
    assert row["statutory_presentation"] == "Cash and cash equivalents"
    assert row["cash_flow_category"] == "Operating"
    assert row["control_account_type"] == "Bank"
    assert row["allow_manual_posting"] is False
    assert row["system_account"] is True
    assert row["suggested_taxonomy_concept"] == "CashBankOnHand"


def test_canonical_trial_balance_reconciles_modes_filters_and_readiness():
    async def scenario():
        engine, session_factory = await create_trial_balance_database()
        accounts = [
            nominal("cash", "1000", "Cash", "Asset", "debit", reporting_category_id="cash-category"),
            nominal("sales", "4000", "Sales", "Income", "credit", reporting_category_id="sales-category"),
            nominal("suspense", "9999", "Suspense", "Asset", "debit", active=False),
        ]
        async with session_factory() as session:
            await session.execute(insert(server.accounting_accounts), accounts)
            await add_journal(session, "prior", "2025-12-31", "posted", [
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "debit": "100.00", "location_id": "north"},
                {"account_id": "sales", "account_code": "4000", "account_name": "Sales", "credit": "100.00", "location_id": "north"},
            ])
            await add_journal(session, "current", "2026-01-31", "posted", [
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "debit": "50.00", "location_id": "north"},
                {"account_id": "sales", "account_code": "4000", "account_name": "Sales", "credit": "50.00", "location_id": "north"},
            ])
            await add_journal(session, "suspense-posting", "2026-02-01", "posted", [
                {"account_id": "suspense", "account_code": "9999", "account_name": "Suspense", "debit": "10.00", "location_id": "south"},
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "credit": "10.00", "location_id": "south"},
            ])
            await add_journal(session, "draft", "2026-02-02", "draft", [
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "debit": "999.00"},
                {"account_id": "sales", "account_code": "4000", "account_name": "Sales", "credit": "999.00"},
            ])
            await session.commit()

            as_at = await server.canonical_trial_balance(
                session,
                "client-1",
                date_from="2026-01-01",
                date_to="2026-02-28",
                date_mode="as_at",
            )
            movement = await server.canonical_trial_balance(
                session,
                "client-1",
                date_from="2026-01-01",
                date_to="2026-01-31",
                date_mode="movement",
            )
            north = await server.canonical_trial_balance(
                session,
                "client-1",
                date_to="2026-02-28",
                date_mode="as_at",
                location_id="north",
            )

        await engine.dispose()
        as_at_by_code = {row["code"]: row for row in as_at["trial_balance"]}
        movement_by_code = {row["code"]: row for row in movement["trial_balance"]}
        north_by_code = {row["code"]: row for row in north["trial_balance"]}

        assert as_at_by_code["1000"]["raw_balance"] == "140.00"
        assert as_at_by_code["4000"]["raw_balance"] == "-150.00"
        assert as_at_by_code["9999"]["active"] is False
        assert as_at_by_code["9999"]["filing_status"] == "Blocked"
        assert as_at["summary"]["blocked_account_count"] == 1
        assert as_at["summary"]["balanced"] is True
        assert as_at["summary"]["date_mode"] == "as_at"
        assert as_at["summary"]["date_from"] is None
        assert movement_by_code["1000"]["raw_balance"] == "50.00"
        assert movement_by_code["4000"]["raw_balance"] == "-50.00"
        assert north_by_code["1000"]["raw_balance"] == "150.00"
        assert north_by_code["4000"]["raw_balance"] == "-150.00"

    asyncio.run(scenario())


def test_financial_reports_and_year_end_consume_canonical_balance_semantics():
    async def scenario():
        engine, session_factory = await create_trial_balance_database()
        accounts = [
            nominal("cash", "1000", "Cash", "Asset", "debit", reporting_category_id="cash-category"),
            nominal("sales", "4000", "Sales", "Income", "credit", reporting_category_id="sales-category"),
        ]
        async with session_factory() as session:
            await session.execute(insert(server.accounting_accounts), accounts)
            await add_journal(session, "prior", "2025-12-31", "posted", [
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "debit": "100.00"},
                {"account_id": "sales", "account_code": "4000", "account_name": "Sales", "credit": "100.00"},
            ])
            await add_journal(session, "current", "2026-01-31", "posted", [
                {"account_id": "cash", "account_code": "1000", "account_name": "Cash", "debit": "50.00"},
                {"account_id": "sales", "account_code": "4000", "account_name": "Sales", "credit": "50.00"},
            ])
            await session.commit()

            snapshot = await server.financial_report_snapshot(
                session,
                "client-1",
                "2026-01-01",
                "2026-01-31",
            )
            year_rows = await server.year_end_trial_balance(
                session,
                "client-1",
                {"start_date": "2026-01-01", "end_date": "2026-12-31"},
                accounts,
            )

        await engine.dispose()
        snapshot_by_code = {row["code"]: row for row in snapshot["trial_balance"]}
        year_by_code = {row["code"]: row for row in year_rows}

        assert snapshot["trial_balance_summary"]["date_mode"] == "as_at"
        assert snapshot_by_code["1000"]["raw_balance"] == "150.00"
        assert snapshot_by_code["4000"]["raw_balance"] == "-150.00"
        assert snapshot["profit_and_loss"]["turnover"] == "50.00"
        assert year_by_code["1000"]["raw_balance"] == "50.00"
        assert year_by_code["4000"]["raw_balance"] == "-50.00"

    asyncio.run(scenario())
