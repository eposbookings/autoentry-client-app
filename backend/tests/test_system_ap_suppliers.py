import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import server


def test_system_supplier_definitions_are_complete_and_unique():
    expected = {
        "SYS-HMRC-VAT": ("HMRC_VAT", "🧾"),
        "SYS-HMRC-PAYE": ("HMRC_PAYE", "👥"),
        "SYS-HMRC-CT": ("HMRC_CT", "🏛️"),
        "SYS-HMRC-CIS": ("HMRC_CIS", "🏗️"),
        "SYS-CH": ("CompaniesHouse", "🏢"),
        "SYS-PENSION": ("Pension", "🛡️"),
    }
    definitions = {row["code"]: (row["category"], row["icon"]) for row in server.SYSTEM_AP_SUPPLIER_DEFINITIONS}

    assert definitions == expected
    assert len(definitions) == len(server.SYSTEM_AP_SUPPLIER_DEFINITIONS)


def test_system_supplier_schema_contains_protection_and_payment_fields():
    column_names = {column.name for column in server.accounting_ap_supplier_profiles.columns}

    assert {"is_system_supplier", "supplier_category", "payment_reference"} <= column_names


def test_system_supplier_contract_exposes_visual_and_protection_metadata():
    supplier = server.serialize_ap_supplier(
        {
            "id": "supplier-1",
            "supplier_code": "SYS-HMRC-VAT",
            "supplier_category": "HMRC_VAT",
            "is_system_supplier": True,
            "status": "active",
        },
        {
            "name": "HMRC – VAT",
            "account_code": "SYS-HMRC-VAT",
            "active": True,
        },
    )

    assert supplier["is_system_supplier"] is True
    assert supplier["isSystemSupplier"] is True
    assert supplier["supplierCategory"] == "HMRC_VAT"
    assert supplier["system_icon"] == "🧾"
    assert supplier["system_authority_label"] == "Government Authority"
    assert "VAT Returns" in supplier["system_usage"]
    assert {"name", "supplier_code", "supplier_category", "status"} <= set(supplier["protected_fields"])
    assert supplier["active"] is True


def test_only_trade_and_pension_categories_are_available_for_user_created_suppliers():
    assert server.AP_USER_SUPPLIER_CATEGORIES == {"Trade", "Pension"}
    assert not (set(server.SYSTEM_AP_SUPPLIER_BY_CATEGORY) - {"Pension"}) & server.AP_USER_SUPPLIER_CATEGORIES


def test_system_supplier_initialisation_is_idempotent():
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            for table in (
                server.accounting_contacts,
                server.accounting_settings,
                server.accounting_ap_settings,
                server.accounting_ap_supplier_profiles,
            ):
                await connection.run_sync(table.create)

        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            first = await server.ensure_system_ap_suppliers(session, "client-1")
            await session.commit()
            second = await server.ensure_system_ap_suppliers(session, "client-1")
            await session.commit()
            count = await session.scalar(
                select(func.count()).select_from(server.accounting_ap_supplier_profiles)
            )
            inactive = await session.scalar(
                select(func.count())
                .select_from(server.accounting_ap_supplier_profiles)
                .where(server.accounting_ap_supplier_profiles.c.status != "active")
            )

        await engine.dispose()
        assert len(first) == 6
        assert len(second) == 6
        assert count == 6
        assert inactive == 0

    asyncio.run(scenario())
