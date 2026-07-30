import json
import shutil
from io import BytesIO

from pypdf import PdfReader

import server


def create_test_form(path):
    shutil.copyfile(server.ROOT_DIR / "assets" / "SA100-2026.pdf", path)


def test_system_form_package_populates_and_reopens(tmp_path, monkeypatch):
    pdf_path = tmp_path / "SA999-2026-system-fillable.pdf"
    manifest_path = tmp_path / "SA999-2026-system-fillable.field-map.json"
    create_test_form(pdf_path)
    manifest_path.write_text(json.dumps({
        "schema_version": 1,
        "form_code": "SA999-2026",
        "pdf_filename": pdf_path.name,
        "fields": [
            {
                "pdf_field_name": "UTR",
                "system_key": "utr",
                "official_box": "1",
                "type": "text",
            },
            {
                "pdf_field_name": "Name",
                "system_key": "full_name",
                "official_box": "",
                "type": "text",
            },
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(server, "SYSTEM_FORM_DIR", tmp_path)

    package = server.system_pdf_form_package("SA999-2026")
    assert package and package["available"] is True

    output = server.fill_system_pdf_package(
        package,
        {"utr": "1234567890", "full_name": "Example Sole Trader"},
        read_only=True,
    )
    fields = PdfReader(BytesIO(output)).get_fields()
    assert fields["UTR"]["/V"] == "1234567890"
    assert fields["Name"]["/V"] == "Example Sole Trader"
    assert int(fields["UTR"]["/Ff"]) & 1


def test_system_form_status_reports_unprepared_forms(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SYSTEM_FORM_DIR", tmp_path)
    form = {
        "sections": [{
            "fields": [
                {"key": "self_employment_schedule", "value": "SA103S"},
            ],
        }],
        "supplementary_forms": [
            {"code": "SA105", "selected": True, "fields": []},
        ],
    }

    status = server.self_assessment_system_form_status(form)
    assert [row["form_code"] for row in status] == ["SA100-2026", "SA103S-2026", "SA105-2026"]
    assert all(row["status"] == "Needs PDF Editor preparation" for row in status)
