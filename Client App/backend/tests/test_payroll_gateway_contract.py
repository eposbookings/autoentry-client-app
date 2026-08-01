import base64
import hashlib
import hmac
import json
import asyncio

import httpx
from fastapi import FastAPI
try:
    from backend.payroll.router import _module_role, _signed_headers, create_payroll_router, payroll_service_enabled
except ModuleNotFoundError:
    from payroll.router import _module_role, _signed_headers, create_payroll_router, payroll_service_enabled


def test_payroll_entitlement_requires_explicit_enabled_flag():
    assert payroll_service_enabled({"service_settings": '{"payroll":{"enabled":true}}'})
    assert not payroll_service_enabled({"service_settings": '{"payroll":{"enabled":false}}'})
    assert not payroll_service_enabled({"service_settings": "not-json"})
    assert not payroll_service_enabled({})
    assert _module_role("practice_admin") == "admin"
    assert _module_role("practice_staff") == "payroll"
    assert _module_role("practice_readonly") == "viewer"


def test_worker_context_header_is_short_lived_and_hmac_signed():
    secret = "0123456789abcdef0123456789abcdef"
    user = {"id": "user-1", "email": "user@example.com", "first_name": "Payroll", "last_name": "User", "role": "practice_admin"}
    client = {"id": "client-1", "practice_id": "practice-1"}
    headers = _signed_headers(user=user, client=client, employer_id=17, secret=secret)
    encoded = headers["x-epos-payroll-context"]
    expected = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(expected, headers["x-epos-payroll-signature"])
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert payload["clientId"] == "client-1"
    assert payload["practiceId"] == "practice-1"
    assert payload["employerId"] == 17
    assert payload["exp"] > 0


def test_context_route_repeats_service_entitlement_check(monkeypatch):
    state = {"enabled": False}

    async def get_session():
        yield object()

    async def get_user():
        return {"id": "user-1", "email": "user@example.com", "role": "practice_admin", "practice_id": "practice-1"}

    async def client_lookup(_session, practice_id, client_id):
        assert practice_id == "practice-1"
        assert client_id == "client-1"
        return {
            "id": client_id,
            "practice_id": practice_id,
            "role": "client",
            "status": "active",
            "business_name": "Client One",
            "service_settings": json.dumps({"payroll": {"enabled": state["enabled"]}}),
        }

    async def worker_context(*_args, **_kwargs):
        return {"employerId": 21, "employerName": "Client One", "taxYear": "2026/27", "payFrequency": "monthly"}

    monkeypatch.setenv("PAYROLL_INTEGRATION_SECRET", "0123456789abcdef0123456789abcdef")
    router_module = create_payroll_router.__module__
    monkeypatch.setattr(f"{router_module}._worker_context", worker_context)
    app = FastAPI()
    app.include_router(create_payroll_router(
        get_session=get_session,
        get_current_user=get_user,
        practice_client_or_404=client_lookup,
        users_table=object(),
    ))

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            disabled = await client.get("/payroll/context/client-1")
            assert disabled.status_code == 403
            state["enabled"] = True
            enabled = await client.get("/payroll/context/client-1")
            assert enabled.status_code == 200
            assert enabled.json()["employerId"] == 21

    asyncio.run(exercise())
