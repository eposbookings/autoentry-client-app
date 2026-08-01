import json
import shutil
from io import BytesIO

from pypdf import PdfReader

from backend import server
from backend.document_forms import DocumentFormPackageRegistry
from backend.document_forms import DocumentFormPackageError


def install_test_package(directory, form_code="SA901-2026"):
    pdf_path = directory / f"{form_code}-system-fillable.pdf"
    manifest_path = directory / f"{form_code}-system-fillable.field-map.json"
    shutil.copyfile(server.ROOT_DIR / "assets" / "SA100-2026.pdf", pdf_path)
    manifest_path.write_text(json.dumps({
        "schema_version": 2,
        "form_code": form_code,
        "pdf_filename": pdf_path.name,
        "fields": [
            {
                "pdf_field_name": "UTR",
                "system_key": "client_tax_reference",
                "page": 1,
                "type": "text",
            },
            {
                "pdf_field_name": "Name",
                "system_key": "client_name",
                "page": 1,
                "type": "text",
            },
        ],
    }), encoding="utf-8")
    return pdf_path


def test_registry_discovers_packages_for_any_module(tmp_path):
    install_test_package(tmp_path)
    registry = DocumentFormPackageRegistry(tmp_path)

    packages = registry.list(
        module="accounting",
        workflow="year_end_self_assessment",
    )

    assert [package["form_code"] for package in packages] == ["SA901-2026"]
    assert packages[0]["field_count"] == 2


def test_registry_fills_and_reopens_a_package(tmp_path):
    install_test_package(tmp_path)
    registry = DocumentFormPackageRegistry(tmp_path)
    package = registry.get("sa901-2026")

    output = registry.fill(package, {
        "client_tax_reference": "1234567890",
        "client_name": "Example Client",
    })
    fields = PdfReader(BytesIO(output)).get_fields()

    assert fields["UTR"]["/V"] == "1234567890"
    assert fields["Name"]["/V"] == "Example Client"
    assert registry.validate(package, require_appearances=False)["widget_count"] == 2


def test_registry_returns_safe_metadata_without_internal_paths(tmp_path):
    install_test_package(tmp_path)
    registry = DocumentFormPackageRegistry(tmp_path)

    description = registry.describe(registry.get("SA901-2026"))

    assert "_pdf_path" not in description
    assert description["module"] == "accounting"
    assert description["workflow"] == "year_end_self_assessment"


def test_registry_rejects_overlapping_nested_widgets(tmp_path):
    install_test_package(tmp_path)
    manifest_path = tmp_path / "SA901-2026-system-fillable.field-map.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["fields"] = [
        {
            "pdf_field_name": "UTR",
            "system_key": "client_tax_reference",
            "page": 1,
            "type": "text",
            "geometry": {"x": .1, "y": .1, "width": .2, "height": .04},
        },
        {
            "pdf_field_name": "Name",
            "system_key": "client_tax_reference",
            "page": 1,
            "type": "text",
            "geometry": {"x": .1, "y": .1, "width": .2, "height": .015},
        },
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    package = DocumentFormPackageRegistry(tmp_path).get("SA901-2026")

    try:
        DocumentFormPackageRegistry.validate(package, require_appearances=False)
    except DocumentFormPackageError as error:
        assert "overlapping nested fields" in str(error)
    else:
        raise AssertionError("Nested AcroForm widgets must be rejected")
