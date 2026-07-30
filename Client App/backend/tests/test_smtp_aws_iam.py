"""Tests for the SMTP settings endpoint with AWS IAM secret → SES SMTP password conversion.

Covers:
  * Region-detection error path (non-SES host + aws_iam_secret=true) → 400.
  * Successful IAM→SES conversion (correct SES host) → 200; GET reports configured; stored
    password equals server.derive_ses_smtp_password(secret, region), not the raw secret.
  * Normal (aws_iam_secret=false) save stores password as-is.
  * GET never leaks the password.
"""
import os
import sys
import asyncio
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://outstanding-items.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@eposaccountancy.co.uk"
ADMIN_PASSWORD = "12345Sived"

# Ensure we can import server for the derivation helper + Mongo direct check
sys.path.insert(0, "/app/backend")


@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token")
    assert token, f"No access_token in login response: {body}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def original_smtp(admin_client):
    """Snapshot current SMTP settings (best-effort) so we can restore afterwards."""
    r = admin_client.get(f"{BASE_URL}/api/admin/settings/smtp")
    snap = r.json() if r.status_code == 200 else None
    yield snap
    # No password available so we cannot fully restore; leave whatever last test wrote.


# --- Region detection error path -----------------------------------------------------------
def test_put_smtp_aws_iam_bad_host_returns_400(admin_client):
    payload = {
        "host": "smtp.gmail.com",
        "port": 587,
        "username": "AKIATEST",
        "password": "somesecret",
        "sender_email": "a@b.com",
        "sender_name": "X",
        "use_tls": True,
        "aws_iam_secret": True,
    }
    r = admin_client.put(f"{BASE_URL}/api/admin/settings/smtp", json=payload)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
    detail = (r.json().get("detail") or "").lower()
    assert "email-smtp" in detail and "region" in detail, f"Unexpected detail: {detail}"


# --- Successful conversion path -----------------------------------------------------------
def test_put_smtp_aws_iam_success_derives_password(admin_client):
    host = "email-smtp.eu-west-2.amazonaws.com"
    raw_secret = "sampleSecretKey123"
    payload = {
        "host": host,
        "port": 587,
        "username": "AKIATEST",
        "password": raw_secret,
        "sender_email": "a@b.com",
        "sender_name": "EPOS",
        "use_tls": True,
        "aws_iam_secret": True,
    }
    r = admin_client.put(f"{BASE_URL}/api/admin/settings/smtp", json=payload)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json() == {"ok": True}

    # GET must report configured:true and NOT leak password
    g = admin_client.get(f"{BASE_URL}/api/admin/settings/smtp")
    assert g.status_code == 200
    body = g.json()
    assert body.get("configured") is True
    assert body.get("host") == host
    assert body.get("username") == "AKIATEST"
    assert "password" not in body and "password_enc" not in body, f"Password leaked: {body}"

    # Directly verify the stored password is the DERIVED value, not the raw secret.
    # We import server (uses the same Mongo + Fernet) and call the helper + read the doc.
    import server  # noqa: E402

    async def _fetch():
        doc = await server.db.settings.find_one({"key": "smtp"})
        return doc

    doc = asyncio.get_event_loop().run_until_complete(_fetch())
    assert doc is not None and doc.get("password_enc"), "SMTP doc missing password_enc"
    stored_pw = server.fernet.decrypt(doc["password_enc"].encode()).decode()

    expected_pw = server.derive_ses_smtp_password(raw_secret, "eu-west-2")
    assert stored_pw == expected_pw, "Stored password does not match derived SES SMTP password"
    assert stored_pw != raw_secret, "Stored password equals raw IAM secret — conversion did NOT happen"

    # Sanity: SES SMTP password format — base64 of 33 bytes (1 version + 32-byte hmac) = 44 chars
    assert len(stored_pw) == 44, f"Unexpected SES SMTP pw length: {len(stored_pw)}"
    decoded = base64.b64decode(stored_pw)
    assert len(decoded) == 33 and decoded[0] == 0x04, "SES SMTP password missing version byte 0x04"


# --- Normal (non-AWS) save path -----------------------------------------------------------
def test_put_smtp_normal_no_conversion(admin_client):
    plain_pw = "PlainSmtpPass!987"
    payload = {
        "host": "smtp.example.com",
        "port": 587,
        "username": "someuser",
        "password": plain_pw,
        "sender_email": "sender@example.com",
        "sender_name": "EPOS Test",
        "use_tls": True,
        "aws_iam_secret": False,
    }
    r = admin_client.put(f"{BASE_URL}/api/admin/settings/smtp", json=payload)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json() == {"ok": True}

    g = admin_client.get(f"{BASE_URL}/api/admin/settings/smtp")
    assert g.status_code == 200
    body = g.json()
    assert body.get("configured") is True
    assert body.get("host") == "smtp.example.com"
    assert body.get("username") == "someuser"
    assert "password" not in body

    # Verify plain password stored verbatim (no conversion)
    import server  # noqa: E402

    async def _fetch():
        return await server.db.settings.find_one({"key": "smtp"})

    doc = asyncio.get_event_loop().run_until_complete(_fetch())
    stored_pw = server.fernet.decrypt(doc["password_enc"].encode()).decode()
    assert stored_pw == plain_pw, "Non-AWS save should not transform password"


# --- Password never returned by GET (regression) -------------------------------------------
def test_get_smtp_never_returns_password(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/admin/settings/smtp")
    assert r.status_code == 200
    body = r.json()
    for forbidden in ("password", "password_enc"):
        assert forbidden not in body, f"GET leaked field {forbidden}: {body}"


# --- Requires admin (regression) -----------------------------------------------------------
def test_put_smtp_requires_admin():
    r = requests.put(
        f"{BASE_URL}/api/admin/settings/smtp",
        json={
            "host": "email-smtp.eu-west-2.amazonaws.com",
            "port": 587,
            "username": "x",
            "password": "y",
            "sender_email": "a@b.com",
            "sender_name": "n",
            "use_tls": True,
            "aws_iam_secret": True,
        },
    )
    assert r.status_code in (401, 403), f"Unauth PUT should be blocked; got {r.status_code}"
