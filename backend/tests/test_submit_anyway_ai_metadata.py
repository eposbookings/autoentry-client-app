import io
import os
import asyncio

from httpx import ASGITransport, AsyncClient
from PIL import Image


os.environ["JWT_SECRET"] = "test-submit-anyway-secret"
os.environ["FERNET_KEY"] = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_submit_anyway.db"

import server  # noqa: E402


def make_jpeg() -> bytes:
    img = Image.new("RGB", (320, 200), (120, 80, 40))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def test_submit_anyway_preserves_ai_review_metadata(monkeypatch):
    asyncio.run(_run_submit_anyway_regression(monkeypatch))


async def _run_submit_anyway_regression(monkeypatch):
    client_user = {
        "id": "client-submit-anyway",
        "role": "client",
        "business_name": "Submit Anyway Ltd",
        "first_name": "Sam",
        "last_name": "Client",
        "email": "sam@example.com",
        "autoentry_email": "practice@example.com",
        "is_vat_client": True,
        "ai_analysis_enabled": True,
    }
    item_id = "item-submit-anyway"
    review = {
        "status": "needs_review",
        "message": "Valid payment receipt, but VAT evidence and VAT breakdown are not shown",
        "document_type": "receipt",
        "payment_method": "card",
        "coding_fields": {"vendor_name": "Mobile Shop", "total": "12.00", "line_items": []},
    }

    async with server.engine.begin() as conn:
        await conn.run_sync(server.metadata.drop_all)
        await conn.run_sync(server.metadata.create_all)
        await server.ensure_schema_columns(conn)
    async with server.SessionLocal() as session:
        await session.execute(server.insert(server.outstanding_items).values(
            id=item_id,
            client_id=client_user["id"],
            type="purchase",
            description="Mobile receipt",
            date="05/07/2026",
            amount="12.00",
            status="outstanding",
            created_at=server.utc_now_iso(),
        ))
        await session.commit()

    async def fake_require_client():
        return client_user

    async def fake_ai_review(*args, **kwargs):
        return review

    async def fake_send_email(*args, **kwargs):
        return None

    server.app.dependency_overrides[server.require_client] = fake_require_client
    monkeypatch.setattr(server, "run_pre_submission_ai_review", fake_ai_review)
    monkeypatch.setattr(server, "send_submission_email", fake_send_email)

    jpeg = make_jpeg()
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        first = await client.post(
            f"/api/client/items/{item_id}/submit",
            data={"mode": "photo", "comment": ""},
            files={"file": ("receipt.jpg", jpeg, "image/jpeg")},
        )
        assert first.status_code == 200, first.text
        first_body = first.json()
        assert first_body["ok"] is False
        assert first_body["ai_review"]["status"] == "needs_review"
        assert first_body["ai_review"]["token"]

        second = await client.post(
            f"/api/client/items/{item_id}/submit",
            data={
                "mode": "photo",
                "comment": "",
                "client_approved_ai_warning": "true",
                "ai_review_token": first_body["ai_review"]["token"],
            },
            files={"file": ("receipt.jpg", jpeg, "image/jpeg")},
        )
        assert second.status_code == 200, second.text
        second_body = second.json()
        assert second_body["ok"] is True
        assert second_body["ai_client_approved"] is True
        assert second_body["ai_review_status"] == "needs_review"
        assert second_body["ai_review_message"] == review["message"]
        assert second_body["stamped"] is True

    async with server.SessionLocal() as session:
        row = await server.one(
            session,
            server.select(server.submissions).where(server.submissions.c.id == second_body["submission_id"]),
        )
    assert row["ai_client_approved"] is True
    assert row["ai_review_status"] == "needs_review"
    assert row["ai_review_message"] == review["message"]
    assert row["ai_document_type"] == "receipt"
    assert "Mobile Shop" in row["ai_extracted_fields"]
    assert row["image_filename"]
    assert (server.UPLOAD_DIR / row["image_filename"]).exists()
    assert "Client approved AI warning" in row["comment"]

    server.app.dependency_overrides.clear()
