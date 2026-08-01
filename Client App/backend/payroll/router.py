"""Authenticated EPOS-to-Payroll gateway.

The accountancy application owns authentication and client entitlements.  The
payroll worker is reachable only on the private application network and accepts
short-lived HMAC-signed context headers from this gateway.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


SessionDependency = Callable[..., Awaitable[AsyncSession]]
UserDependency = Callable[..., Awaitable[dict[str, Any]]]
ClientLookup = Callable[[AsyncSession, str, str], Awaitable[dict[str, Any]]]


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def payroll_service_enabled(client: dict[str, Any]) -> bool:
    settings = _json_object(client.get("service_settings") or client.get("serviceSettings") or client.get("services"))
    payroll = settings.get("payroll")
    return payroll is True or (isinstance(payroll, dict) and payroll.get("enabled") is True)


def _display_name(user: dict[str, Any]) -> str:
    return " ".join(filter(None, [user.get("first_name"), user.get("last_name")])).strip() or str(user.get("email") or "EPOS user")


def _module_role(epos_role: str) -> str:
    if epos_role in {"admin", "practice_admin"}:
        return "admin"
    if epos_role in {"practice_manager", "practice_staff"}:
        return "payroll"
    return "viewer"


def _signed_headers(*, user: dict[str, Any], client: dict[str, Any], employer_id: int, secret: str) -> dict[str, str]:
    payload = {
        "employerId": employer_id,
        "clientId": str(client["id"]),
        "practiceId": str(client["practice_id"]),
        "userId": str(user["id"]),
        "email": str(user.get("email") or ""),
        "displayName": _display_name(user),
        "role": str(user.get("role") or "practice_readonly"),
        "canViewConfidential": user.get("role") != "practice_readonly",
        "exp": int(time.time()) + 60,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return {"x-epos-payroll-context": encoded, "x-epos-payroll-signature": signature}


def _client_payload(client: dict[str, Any]) -> dict[str, Any]:
    return {
        "clientId": str(client["id"]),
        "practiceId": str(client["practice_id"]),
        "clientName": client.get("business_name") or " ".join(filter(None, [client.get("first_name"), client.get("last_name")])) or "EPOS payroll client",
        "taxYear": os.environ.get("PAYROLL_DEFAULT_TAX_YEAR", "2026/27"),
        "payFrequency": client.get("payroll_frequency") or "monthly",
        "firstPayDate": None,
    }


async def _worker_context(user: dict[str, Any], client: dict[str, Any], worker_url: str, secret: str) -> dict[str, Any]:
    headers = _signed_headers(user=user, client=client, employer_id=0, secret=secret)
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            response = await http.post(f"{worker_url}/api/integration/context", headers=headers, json=_client_payload(client))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="The payroll engine is unavailable.") from exc
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400 or not isinstance(body, dict) or not body.get("employerId"):
        detail = body.get("error") if isinstance(body, dict) else "The payroll engine returned an invalid response."
        raise HTTPException(status_code=502, detail=detail)
    return body


def create_payroll_router(
    *,
    get_session: SessionDependency,
    get_current_user: UserDependency,
    practice_client_or_404: ClientLookup,
    users_table: Any,
) -> APIRouter:
    router = APIRouter(prefix="/payroll", tags=["payroll"])

    async def entitled_client(client_id: str, user: dict[str, Any], session: AsyncSession) -> dict[str, Any]:
        if user.get("role") not in {"admin", "practice_admin", "practice_manager", "practice_staff", "practice_readonly"}:
            raise HTTPException(status_code=403, detail="Accountancy practice access only")
        practice_id = str(user.get("practice_id") or "")
        if not practice_id:
            raise HTTPException(status_code=403, detail="This account is not assigned to an accountancy practice")
        client = await practice_client_or_404(session, practice_id, client_id)
        if client.get("status") != "active":
            raise HTTPException(status_code=403, detail="The client account is inactive")
        if not payroll_service_enabled(client):
            raise HTTPException(status_code=403, detail="Payroll is not enabled for this client")
        return client

    @router.get("/clients")
    async def enabled_clients(
        user: dict[str, Any] = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> dict[str, list[dict[str, Any]]]:
        if user.get("role") not in {"admin", "practice_admin", "practice_manager", "practice_staff", "practice_readonly"}:
            raise HTTPException(status_code=403, detail="Accountancy practice access only")
        result = await session.execute(select(users_table).where(
            users_table.c.practice_id == str(user.get("practice_id") or ""),
            users_table.c.role == "client",
            users_table.c.status == "active",
        ).order_by(users_table.c.business_name.asc()))
        rows = [dict(row) for row in result.mappings().all()]
        return {"clients": [{
            "id": row["id"],
            "business_name": row.get("business_name"),
            "first_name": row.get("first_name"),
            "last_name": row.get("last_name"),
            "service_settings": row.get("service_settings"),
        } for row in rows if payroll_service_enabled(row)]}

    @router.get("/context/{client_id}")
    async def context(
        client_id: str,
        user: dict[str, Any] = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> dict[str, Any]:
        client = await entitled_client(client_id, user, session)
        secret = os.environ.get("PAYROLL_INTEGRATION_SECRET", "")
        if len(secret) < 32:
            raise HTTPException(status_code=503, detail="Payroll integration is not configured")
        worker_url = os.environ.get("PAYROLL_WORKER_URL", "http://payroll-worker:3102").rstrip("/")
        worker = await _worker_context(user, client, worker_url, secret)
        return {
            "employerId": int(worker["employerId"]),
            "clientId": client_id,
            "employerName": worker.get("employerName") or _client_payload(client)["clientName"],
            "taxYear": worker.get("taxYear") or "2026/27",
            "payFrequency": worker.get("payFrequency") or "monthly",
            "firstPayDate": worker.get("firstPayDate"),
            "role": _module_role(str(user.get("role") or "")),
            "canViewConfidential": user.get("role") != "practice_readonly",
        }

    @router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def proxy(
        path: str,
        request: Request,
        client_id: str = Header(alias="X-Payroll-Client-ID"),
        user: dict[str, Any] = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> Response:
        client = await entitled_client(client_id, user, session)
        secret = os.environ.get("PAYROLL_INTEGRATION_SECRET", "")
        if len(secret) < 32:
            raise HTTPException(status_code=503, detail="Payroll integration is not configured")
        worker_url = os.environ.get("PAYROLL_WORKER_URL", "http://payroll-worker:3102").rstrip("/")
        worker = await _worker_context(user, client, worker_url, secret)
        employer_id = int(worker["employerId"])
        requested_query_employer = request.query_params.get("employerId")
        if requested_query_employer and requested_query_employer != str(employer_id):
            raise HTTPException(status_code=403, detail="Payroll employer does not match the entitled EPOS client")
        content = await request.body()
        if content and "application/json" in request.headers.get("content-type", ""):
            try:
                payload = json.loads(content)
            except ValueError:
                payload = None
            if isinstance(payload, dict) and payload.get("employerId") is not None and str(payload["employerId"]) != str(employer_id):
                raise HTTPException(status_code=403, detail="Payroll employer does not match the entitled EPOS client")
        headers = _signed_headers(user=user, client=client, employer_id=employer_id, secret=secret)
        for name in ("content-type", "accept"):
            if request.headers.get(name):
                headers[name] = request.headers[name]
        target = f"{worker_url}/api/{path}"
        try:
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as http:
                upstream = await http.request(request.method, target, params=request.query_params, content=content, headers=headers)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="The payroll engine is unavailable.") from exc
        response_headers = {name: value for name, value in upstream.headers.items() if name.lower() in {"content-type", "content-disposition", "cache-control"}}
        return Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)

    return router
