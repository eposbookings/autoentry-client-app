"""Regression tests for the photo+comment watermark 500 bug.

Verifies that stamp_image() returns bytes (not None) so all four submit
paths work: (a) photo+comment (regression under test), (b) photo w/o
comment, (c) no_photo+comment, (d) additional invoice with photo+comment.
"""
import io
import os
import time

import pytest
import requests
from PIL import Image

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@eposaccountancy.co.uk"
ADMIN_PASSWORD = "12345Sived"
CLIENT_EMAIL = "testclient@example.com"
CLIENT_PASSWORD = "Client12345"
CLIENT_ID = "6a44ae23b44442303344c749"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def client_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _make_jpeg(size=(600, 400), color=(30, 120, 180)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _seed_items(admin_session, count: int, type_: str = "purchase"):
    """Upload a CSV creating `count` new outstanding items for the client."""
    header = "Description,Date,Amount\n"
    ts = int(time.time())
    rows = "".join(
        f"TEST_watermark_{ts}_{i},2026-01-15,10.0{i}\n" for i in range(count)
    )
    csv_bytes = (header + rows).encode()
    files = {"file": (f"seed_{ts}.csv", csv_bytes, "text/csv")}
    data = {"type": type_}
    r = admin_session.post(
        f"{BASE_URL}/api/admin/clients/{CLIENT_ID}/upload-csv",
        files=files,
        data=data,
        timeout=30,
    )
    assert r.status_code == 200, r.text


def _get_pending_items(client_session, type_: str = "purchase"):
    r = client_session.get(f"{BASE_URL}/api/client/items?type={type_}", timeout=30)
    assert r.status_code == 200, r.text
    # items are removed after successful submission, so anything returned is submittable
    return [i for i in r.json() if i.get("status") != "submitted"]


# ---------- tests ----------
class TestWatermarkSubmit:
    """Bug fix verification: stamp_image must return bytes."""

    def test_photo_with_comment_succeeds(self, admin_session, client_session):
        """PRIMARY BUG: previously returned 500 (stamp_image returned None)."""
        _seed_items(admin_session, count=4, type_="purchase")
        pending = _get_pending_items(client_session, "purchase")
        assert pending, "No pending items to submit against"
        item_id = pending[0]["id"] if "id" in pending[0] else pending[0]["_id"]

        jpeg = _make_jpeg()
        r = client_session.post(
            f"{BASE_URL}/api/client/items/{item_id}/submit",
            data={"mode": "photo", "comment": "Testing watermark regression"},
            files={"file": ("invoice.jpg", jpeg, "image/jpeg")},
            timeout=60,
        )
        # If this returns 500 the bug is back.
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert "submission_id" in body
        # Persist submission_id for the next test
        TestWatermarkSubmit._submission_id = body["submission_id"]

    def test_admin_submission_has_image_and_comment(self, admin_session):
        """The submission record must have image_filename + comment."""
        sub_id = getattr(TestWatermarkSubmit, "_submission_id", None)
        assert sub_id, "Prior test did not run"

        r = admin_session.get(f"{BASE_URL}/api/admin/submissions", timeout=30)
        assert r.status_code == 200, r.text
        subs = r.json()
        row = next((s for s in subs if s.get("id") == sub_id or s.get("_id") == sub_id), None)
        assert row is not None, "New submission not found in admin list"
        assert row.get("comment") == "Testing watermark regression"
        assert row.get("image_filename"), "image_filename missing on submission"

        # Fetch preview image and confirm it's a real JPEG (not empty)
        fname = row["image_filename"]
        pr = admin_session.get(f"{BASE_URL}/api/admin/uploads/{fname}", timeout=30)
        assert pr.status_code == 200, f"Preview image not accessible: {pr.status_code}"
        img = Image.open(io.BytesIO(pr.content))
        assert img.format == "JPEG"
        # image should be >= 300px wide (watermarked image)
        assert img.width >= 300

    def test_photo_without_comment_succeeds(self, admin_session, client_session):
        pending = _get_pending_items(client_session, "purchase")
        assert pending
        item_id = pending[0]["id"] if "id" in pending[0] else pending[0]["_id"]
        jpeg = _make_jpeg(color=(50, 180, 50))
        r = client_session.post(
            f"{BASE_URL}/api/client/items/{item_id}/submit",
            data={"mode": "photo", "comment": ""},
            files={"file": ("plain.jpg", jpeg, "image/jpeg")},
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json().get("ok") is True

    def test_no_photo_with_comment_succeeds(self, admin_session, client_session):
        pending = _get_pending_items(client_session, "purchase")
        assert pending
        item_id = pending[0]["id"] if "id" in pending[0] else pending[0]["_id"]
        r = client_session.post(
            f"{BASE_URL}/api/client/items/{item_id}/submit",
            data={"mode": "no_photo", "comment": "Lost the receipt"},
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json().get("ok") is True

    def test_additional_invoice_photo_with_comment_succeeds(self, client_session):
        """/client/submit-additional also uses stamp_image."""
        jpeg = _make_jpeg(color=(200, 60, 60))
        r = client_session.post(
            f"{BASE_URL}/api/client/submit-additional",
            data={
                "type": "purchase",
                "description": "TEST_additional watermark",
                "comment": "Add-another watermark check",
                "mode": "photo",
            },
            files={"file": ("addl.jpg", jpeg, "image/jpeg")},
            timeout=60,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json().get("ok") is True
