import asyncio

import pytest
from fastapi import HTTPException

from backend import server


def test_hmrc_configuration_is_practice_scoped_and_secret_is_not_serialized():
    assert server.practice_hmrc_settings.c.practice_id.primary_key
    assert "gateway_password_enc" in server.practice_hmrc_settings.c
    response = server.practice_hmrc_settings_response(
        {
            "practice_id": "practice-1",
            "gateway_user_id": "123456789012",
            "gateway_password_enc": "encrypted-secret",
            "self_assessment_agent_code": "SA123",
            "environment": "test",
        }
    )
    assert response["gateway_password_saved"] is True
    assert "gateway_password" not in response
    assert "gateway_password_enc" not in response


def test_hmrc_services_require_the_correct_practice_reference():
    payload = server.PracticeHmrcSettingsIn(
        gateway_user_id="123456789012",
        self_assessment_enabled=True,
    )
    with pytest.raises(HTTPException, match="Self Assessment agent code"):
        server.validate_practice_hmrc_settings(payload)

    server.validate_practice_hmrc_settings(
        server.PracticeHmrcSettingsIn(
            gateway_user_id="123456789012",
            self_assessment_agent_code="SA123",
            self_assessment_enabled=True,
            environment="test",
        )
    )


def test_hmrc_settings_routes_are_registered():
    routes = {(route.path, method) for route in server.api.routes for method in (route.methods or set())}
    assert ("/api/admin/accountancy/hmrc-settings", "GET") in routes
    assert ("/api/admin/accountancy/hmrc-settings", "PUT") in routes


def test_hmrc_settings_save_uses_a_valid_utc_timestamp(monkeypatch):
    async def no_existing_settings(*_args, **_kwargs):
        return None

    class RecordingSession:
        def __init__(self):
            self.executed = []
            self.committed = False

        async def execute(self, statement):
            self.executed.append(statement)

        async def commit(self):
            self.committed = True

    monkeypatch.setattr(server, "one", no_existing_settings)
    session = RecordingSession()
    response = asyncio.run(server.update_practice_hmrc_settings(
        server.PracticeHmrcSettingsIn(environment="test"),
        {"practice_id": "practice-1", "id": "admin-1"},
        session,
    ))

    assert response["updated_at"].endswith("+00:00")
    assert session.executed
    assert session.committed is True


@pytest.mark.parametrize(
    ("client_type", "workflow", "return_name", "required_page"),
    [
        ("limited_company", "corporation_tax", "CT600", "CT600"),
        ("sole_trader", "self_assessment", "SA100", "SA103"),
        ("cis_customer", "self_assessment", "SA100", "SA103"),
        ("landlord", "self_assessment", "SA100", "SA105"),
        ("individual", "self_assessment", "SA100", None),
        ("partnership", "self_assessment", "SA800", None),
        ("llp", "self_assessment", "SA800", None),
    ],
)
def test_client_type_selects_the_correct_year_end_return(client_type, workflow, return_name, required_page):
    profile = server.native_year_end_filing_profile(client_type)
    assert profile["workflow"] == workflow
    assert profile["return"] == return_name
    if required_page:
        assert required_page in profile["required_pages"]


def test_ambiguous_entities_require_legal_and_tax_status_review():
    for client_type in ("charity", "club_or_association", "community_interest_company"):
        profile = server.native_year_end_filing_profile(client_type)
        assert profile["workflow"] == "entity_review"
        assert profile["return"] is None


def test_sole_trader_sa100_automates_accounts_values_and_keeps_personal_answers_editable():
    form = server.sole_trader_self_assessment_form(
        {"client_type": "sole_trader", "business_name": "Demo Sole Trader", "utr": "1234567890", "phone": "01234567890"},
        {
            "period_from": "2025-04-06",
            "period_to": "2026-04-05",
            "details": {"self_assessment_fields": {"gift_aid": "250.00"}},
        },
        {"profit_and_loss": {"turnover": "80000.00", "cost_of_sales": "20000.00", "operating_expenses": "15000.00"}},
    )
    fields = {field["key"]: field for section in form["sections"] for field in section["fields"]}
    assert fields["turnover"]["value"] == "80000.00"
    assert fields["allowable_expenses"]["value"] == "35000.00"
    assert fields["net_profit"]["value"] == "45000.00"
    assert fields["turnover"]["automatic"] is True
    assert fields["gift_aid"]["value"] == "250.00"
    assert fields["gift_aid"]["automatic"] is False
