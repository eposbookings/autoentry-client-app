"""Verify DejaVu TTF fonts are actually being loaded (not the PIL default
bitmap font) and that stamp_image renders a legible dark band with big text.

Legibility heuristic (no OCR available):
- title font size must equal requested (proves it's a scalable TrueType,
  not the default bitmap font which ignores size).
- stamped image must contain a solid dark band at the bottom whose height
  is >= ~15% of the image height (was ~5% with the tiny default font).
- inside that band, there must be sufficient light pixels (the text) to
  indicate real characters were rendered.
"""
import io
import os
import sys
from datetime import datetime, timezone

import pytest
from PIL import Image

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def test_load_font_returns_scalable_truetype():
    """PIL default font ignores size; a real TTF respects it."""
    f = server.load_font(True, 66)
    # FreeTypeFont exposes .size and .path
    assert type(f).__name__ == "FreeTypeFont", f"Got {type(f).__name__} — DejaVu TTF not loaded"
    assert f.size == 66
    assert f.path.endswith("DejaVuSans-Bold.ttf")

    f2 = server.load_font(False, 40)
    assert f2.size == 40
    assert f2.path.endswith("DejaVuSans.ttf")


def _make_jpeg(size=(1200, 800), color=(30, 120, 180)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def test_stamp_image_produces_large_dark_band_with_bright_text():
    raw = _make_jpeg()
    stamped = server.stamp_image(
        raw,
        "Testing watermark readability — this line should be large and clearly legible without zooming.",
        datetime.now(timezone.utc),
    )
    img = Image.open(io.BytesIO(stamped)).convert("RGB")
    W, H = img.size

    # Sample bottom 25% of the image; count how many rows are mostly dark
    # (mean R+G+B < 90 on a 0-255*3 scale) — that's the watermark band.
    bottom_start = int(H * 0.75)
    dark_rows = 0
    for y in range(bottom_start, H):
        row = [img.getpixel((x, y)) for x in range(0, W, 40)]
        avg = sum(sum(px) for px in row) / (len(row) * 3)
        if avg < 90:
            dark_rows += 1

    band_pct = dark_rows / (H - bottom_start)
    assert band_pct > 0.55, (
        f"Bottom band is only {band_pct:.0%} dark — watermark band appears too small"
    )
    # Band height in absolute pixels — should be at least ~15% of image height
    assert dark_rows >= H * 0.15, (
        f"Dark band only {dark_rows}px tall on {H}px image (<15%) — text likely tiny"
    )

    # Count bright pixels inside the band (the text). With a big TTF the
    # letters occupy noticeably more pixels than the tiny default bitmap font.
    band_top = H - dark_rows
    bright = 0
    total = 0
    for y in range(band_top, H, 2):
        for x in range(0, W, 2):
            px = img.getpixel((x, y))
            total += 1
            if sum(px) > 600:  # near-white — the text
                bright += 1
    ratio = bright / total if total else 0
    # Tiny default font gave <0.5% bright pixels; the big TTF gives several %.
    assert ratio > 0.015, (
        f"Only {ratio:.2%} of band pixels are text-bright — font may still be tiny"
    )


def test_render_document_page_uses_ttf():
    out = server.render_document_page(
        "TEST_no_photo item",
        "This is a client comment that should be legible on the rendered A4 page.",
        datetime.now(timezone.utc),
    )
    img = Image.open(io.BytesIO(out)).convert("RGB")
    # Should be a white-ish page with dark text
    assert img.width >= 800
    # sample interior — must contain plenty of dark pixels (the text)
    dark = 0
    total = 0
    for y in range(0, img.height, 10):
        for x in range(0, img.width, 10):
            total += 1
            if sum(img.getpixel((x, y))) < 300:
                dark += 1
    assert dark / total > 0.005, "Rendered page has almost no dark pixels — text not drawn"
