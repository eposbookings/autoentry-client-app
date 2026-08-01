import json
import shutil
from io import BytesIO

from pypdf import PdfReader

from backend import server


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


def test_system_form_package_splits_one_value_across_character_fields(tmp_path, monkeypatch):
    pdf_path = tmp_path / "SA998-2026-system-fillable.pdf"
    manifest_path = tmp_path / "SA998-2026-system-fillable.field-map.json"
    create_test_form(pdf_path)
    manifest_path.write_text(json.dumps({
        "schema_version": 2,
        "form_code": "SA998-2026",
        "pdf_filename": pdf_path.name,
        "fields": [
            {
                "pdf_field_name": "UTR",
                "system_key": "phone",
                "type": "text",
                "max_length": 1,
                "value_transform": {
                    "kind": "character",
                    "index": 0,
                    "strip_non_alphanumeric": True,
                },
            },
            {
                "pdf_field_name": "Name",
                "system_key": "phone",
                "type": "text",
                "max_length": 1,
                "value_transform": {
                    "kind": "character",
                    "index": 1,
                    "strip_non_alphanumeric": True,
                },
            },
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(server, "SYSTEM_FORM_DIR", tmp_path)

    package = server.system_pdf_form_package("SA998-2026")
    output = server.fill_system_pdf_package(package, {"phone": "01 422-555000"})
    fields = PdfReader(BytesIO(output)).get_fields()

    assert fields["UTR"]["/V"] == "0"
    assert fields["Name"]["/V"] == "1"


def test_system_form_package_formats_money_across_character_fields(tmp_path, monkeypatch):
    pdf_path = tmp_path / "SA996-2026-system-fillable.pdf"
    manifest_path = tmp_path / "SA996-2026-system-fillable.field-map.json"
    create_test_form(pdf_path)
    manifest_path.write_text(json.dumps({
        "schema_version": 2,
        "form_code": "SA996-2026",
        "pdf_filename": pdf_path.name,
        "fields": [
            {
                "pdf_field_name": "UTR",
                "system_key": "amount",
                "type": "text",
                "max_length": 1,
                "value_transform": {
                    "kind": "money_character",
                    "index": 0,
                    "whole_digits": 1,
                    "decimal_places": 1,
                },
            },
            {
                "pdf_field_name": "Name",
                "system_key": "amount",
                "type": "text",
                "max_length": 1,
                "value_transform": {
                    "kind": "money_character",
                    "index": 1,
                    "whole_digits": 1,
                    "decimal_places": 1,
                },
            },
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(server, "SYSTEM_FORM_DIR", tmp_path)

    package = server.system_pdf_form_package("SA996-2026")
    output = server.fill_system_pdf_package(package, {"amount": "5.2"})
    fields = PdfReader(BytesIO(output)).get_fields()

    assert fields["UTR"]["/V"] == "5"
    assert fields["Name"]["/V"] == "2"


def test_system_form_package_uses_base_value_for_editor_generated_variants(tmp_path, monkeypatch):
    pdf_path = tmp_path / "SA997-2026-system-fillable.pdf"
    manifest_path = tmp_path / "SA997-2026-system-fillable.field-map.json"
    create_test_form(pdf_path)
    manifest_path.write_text(json.dumps({
        "schema_version": 2,
        "form_code": "SA997-2026",
        "pdf_filename": pdf_path.name,
        "fields": [
            {
                "pdf_field_name": "Name",
                "system_key": "business_name_option_1",
                "type": "text",
            },
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(server, "SYSTEM_FORM_DIR", tmp_path)

    package = server.system_pdf_form_package("SA997-2026")
    output = server.fill_system_pdf_package(package, {"business_name": "Example Trading"})
    fields = PdfReader(BytesIO(output)).get_fields()

    assert fields["Name"]["/V"] == "Example Trading"


def test_installed_supplementary_packages_map_name_and_utr_headers():
    for code in (
        "SA101", "SA102", "SA103S", "SA103F", "SA104S",
        "SA105", "SA106", "SA107", "SA108", "SA109", "SA110",
    ):
        package = server.system_pdf_form_package(f"{code}-2026")
        assert package and package["available"] is True
        system_keys = [field["system_key"] for field in package["fields"]]
        assert system_keys.count("full_name") == 1
        assert system_keys.count("utr") == 10


def test_official_branding_artwork_is_not_exposed_as_an_editable_field():
    excluded_widgets = {
        "SA103F": "text_92",
        "SA104S": "text_01",
        "SA110": "text_01",
    }
    for code, widget_name in excluded_widgets.items():
        package = server.system_pdf_form_package(f"{code}-2026")
        assert package and package["available"] is True
        assert widget_name not in {
            field["pdf_field_name"]
            for field in package["fields"]
        }


def test_every_installed_self_assessment_package_validates_and_renders():
    codes = (
        "SA100", "SA101", "SA102", "SA103S", "SA103F", "SA104S",
        "SA105", "SA106", "SA107", "SA108", "SA109", "SA110",
    )
    for code in codes:
        package = server.system_pdf_form_package(f"{code}-2026")
        assert package and package["available"] is True
        validation = server.DOCUMENT_FORM_REGISTRY.validate(package)
        assert validation["field_count"] == len(package["fields"])
        output = server.fill_system_pdf_package(package, {
            "full_name": "Complete package audit",
            "utr": "1234567890",
        })
        reopened = PdfReader(BytesIO(output))
        pdf_fields = reopened.get_fields() or {}
        assert {
            field["pdf_field_name"] for field in package["fields"]
        }.issubset(pdf_fields)


def test_every_installed_manifest_key_can_be_saved_for_filing():
    valid_main_keys = {
        key
        for section in server.SA100_SOLE_TRADER_SECTIONS
        for key, _label, _field_type, _automatic in section["fields"]
    }
    unsupported = []
    for code in (
        "SA100", "SA101", "SA102", "SA103S", "SA103F", "SA104S",
        "SA105", "SA106", "SA107", "SA108", "SA109", "SA110",
    ):
        package = server.system_pdf_form_package(f"{code}-2026")
        for field in package["fields"]:
            key = str(field["system_key"])
            base_key = server.SELF_ASSESSMENT_VARIANT_SUFFIX_PATTERN.sub("", key)
            if (
                key not in valid_main_keys
                and base_key not in valid_main_keys
                and not server.SELF_ASSESSMENT_SUPPLEMENTARY_KEY_PATTERN.fullmatch(key)
                and not server.SELF_ASSESSMENT_SUPPLEMENTARY_KEY_PATTERN.fullmatch(base_key)
            ):
                unsupported.append((code, key))
    assert unsupported == []


def test_unselected_supplementary_forms_are_lazy(monkeypatch):
    calls = []

    def fake_schema(code, asset_name, saved):
        calls.append((code, asset_name))
        return [{"key": f"{code.lower()}_box_1", "value": saved.get(f"{code.lower()}_box_1", "")}]

    monkeypatch.setattr(server, "supplementary_sa_form_schema", fake_schema)
    form = server.sole_trader_self_assessment_form(
        {"business_name": "Lazy Loader Test"},
        {"period_from": "2025-04-06", "period_to": "2026-04-05", "details": {"self_assessment_fields": {"residence": True}}},
        {"profit_and_loss": {}},
    )
    by_code = {row["code"]: row for row in form["supplementary_forms"]}

    assert {code for code, _asset in calls} == {"SA109", "SA110"}
    assert by_code["SA109"]["selected"] is True
    assert by_code["SA109"]["lazy"] is False
    assert by_code["SA102"]["fields"] == []
    assert by_code["SA102"]["lazy"] is True


def test_editor_allowlist_includes_supported_unselected_forms():
    form = {
        "supplementary_forms": [
            {"code": "SA109", "selected": False},
            {"code": "SA110", "selected": True},
        ],
    }

    assert server.self_assessment_editor_form_codes(form) == {
        "SA100-2026", "SA103S-2026", "SA103F-2026", "SA109-2026", "SA110-2026",
    }
    selected = {
        row["form_code"] for row in server.self_assessment_system_form_status(form)
    }
    assert "SA109-2026" not in selected
    assert "SA110-2026" in selected


def test_installed_sa110_maps_money_grids_and_additional_information():
    server.SA_SUPPLEMENTARY_SCHEMA_CACHE.pop("SA110-2026.pdf", None)
    schema = server.supplementary_sa_form_schema("SA110", "SA110-2026.pdf", {})
    box_17 = next(field for field in schema if field["key"] == "sa110_box_17")
    assert box_17["type"] == "textarea"
    assert box_17["pdf_mapped"] is True

    package = server.system_pdf_form_package("SA110-2026")
    output = server.fill_system_pdf_package(package, {
        "full_name": "SA110 Regression Test",
        "utr": "1234567890",
        "sa110_box_9": "52520",
        "sa110_box_17": "Expected additional information",
    })
    fields = PdfReader(BytesIO(output)).get_fields() or {}
    manifest_by_key = {}
    for manifest_field in package["fields"]:
        manifest_by_key.setdefault(manifest_field["system_key"], []).append(manifest_field)

    utr_values = [
        fields[field["pdf_field_name"]].get("/V")
        for field in manifest_by_key["utr"]
    ]
    money_values = [
        fields[field["pdf_field_name"]].get("/V")
        for field in manifest_by_key["sa110_box_9"]
    ]
    information_values = [
        fields[field["pdf_field_name"]].get("/V")
        for field in manifest_by_key["sa110_box_17"]
    ]

    assert utr_values == list("1234567890")
    assert money_values == ["", "", "", "5", "2", "5", "2", "0", "0", "0"]
    assert information_values == ["Expected additional information"]


def test_self_assessment_pdf_values_include_replica_editor_fields():
    form = {
        "saved_values": {
            "sa100_box_99": "Main return replica value",
            "sa103f_box_73_grid_2": "Supplementary replica value",
        },
        "sections": [{"fields": [{"key": "full_name", "value": "Example Taxpayer"}]}],
        "supplementary_forms": [],
    }

    values = server.self_assessment_system_form_values(form)

    assert values["full_name"] == "Example Taxpayer"
    assert values["sa100_box_99"] == "Main return replica value"
    assert values["sa103f_box_73_grid_2"] == "Supplementary replica value"


def test_installed_supplementary_details_populate_mapped_pdf_fields():
    form_assets = (
        ("SA101", "SA101-2026.pdf"),
        ("SA102", "SA102-2026.pdf"),
        ("SA104S", "SA104S-2026.pdf"),
        ("SA105", "SA105-2026.pdf"),
        ("SA106", "SA106-2026.pdf"),
        ("SA107", "SA107-2026.pdf"),
        ("SA108", "SA108-2026.pdf"),
        ("SA109", "SA109-2026.pdf"),
        ("SA110", "SA110-2026.pdf"),
    )
    for code, asset_name in form_assets:
        schema = server.supplementary_sa_form_schema(code, asset_name, {})
        mapped_fields = [field for field in schema if field.get("pdf_mapped")]
        values = {
            field["key"]: (
                True if field["type"] == "boolean"
                else "01/05/2025" if field["type"] == "date"
                else "1234" if field["type"] in {"money", "number"}
                else "TEST"
            )
            for field in mapped_fields
        }
        package = server.system_pdf_form_package(f"{code}-2026")
        output = server.fill_system_pdf_package(package, values)
        reopened = PdfReader(BytesIO(output))
        pdf_fields = reopened.get_fields() or {}
        manifest_by_key = {}
        for manifest_field in package["fields"]:
            manifest_by_key.setdefault(manifest_field["system_key"], []).append(manifest_field)
        for detail_field in mapped_fields:
            populated = [
                pdf_fields[manifest_field["pdf_field_name"]].get("/V")
                for manifest_field in manifest_by_key[detail_field["key"]]
            ]
            assert any(value not in (None, "", "/Off") for value in populated), (
                code,
                detail_field["key"],
            )
