"""Shared official-document form package registry and AcroForm filler.

A package consists of:

* ``<form>-system-fillable.pdf`` - the official artwork with AcroForm widgets.
* ``<form>-system-fillable.field-map.json`` - stable application keys mapped
  to the PDF field names and widget geometry.

The service is deliberately module-agnostic. Accounting, payroll, tax,
practice-management and future modules can register packages in one directory
and use the same validation and population path.
"""

from __future__ import annotations

import io
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable, Optional

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject


class DocumentFormPackageError(ValueError):
    """Raised when an installed form package is incomplete or inconsistent."""


def _nested_widget_conflicts(
    manifest_fields: list[dict[str, Any]],
) -> list[tuple[str, list[str]]]:
    """Find converter artefacts that place thin widgets inside one entry box.

    HMRC artwork sometimes describes a box with both its full rectangle and
    short line segments. Treating both as fields creates overlapping click
    targets whose borders resemble stray characters (usually an equals sign).
    """
    conflicts: list[tuple[str, list[str]]] = []
    for outer in manifest_fields:
        if outer.get("type") not in {None, "text"}:
            continue
        geometry = outer.get("geometry") or {}
        try:
            outer_x = float(geometry["x"])
            outer_y = float(geometry["y"])
            outer_width = float(geometry["width"])
            outer_height = float(geometry["height"])
        except (KeyError, TypeError, ValueError):
            continue
        nested: list[dict[str, Any]] = []
        for inner in manifest_fields:
            if inner is outer or inner.get("page") != outer.get("page"):
                continue
            if inner.get("type") not in {None, "text"}:
                continue
            inner_geometry = inner.get("geometry") or {}
            try:
                inner_x = float(inner_geometry["x"])
                inner_y = float(inner_geometry["y"])
                inner_width = float(inner_geometry["width"])
                inner_height = float(inner_geometry["height"])
            except (KeyError, TypeError, ValueError):
                continue
            same_horizontal_bounds = (
                abs(inner_x - outer_x) < 0.002
                and abs(
                    (inner_x + inner_width) - (outer_x + outer_width)
                ) < 0.002
            )
            vertically_contained = (
                inner_y >= outer_y - 0.001
                and inner_y + inner_height
                <= outer_y + outer_height + 0.001
            )
            if (
                same_horizontal_bounds
                and vertically_contained
                and inner_height < outer_height * 0.8
            ):
                nested.append(inner)
        same_key_nested = any(
            inner.get("system_key")
            and inner.get("system_key") == outer.get("system_key")
            for inner in nested
        )
        if same_key_nested:
            conflicts.append((
                str(outer.get("pdf_field_name") or "(unnamed)"),
                [str(inner.get("pdf_field_name") or "(unnamed)") for inner in nested],
            ))
    return conflicts


def normalise_form_code(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9.-]", "", str(value or "")).upper()


def _base_system_key(system_key: str) -> str:
    return re.sub(
        r"(?:_option_\d+|_alternate_\d+|_grid_\d+)$",
        "",
        system_key,
    )


def _money_grid_value(
    value: Any,
    *,
    whole_digits: int,
    decimal_places: int,
) -> str:
    """Format an HMRC amount for one-character pounds/pence boxes."""
    width = whole_digits + decimal_places
    source = str(value or "").strip().replace(",", "").replace("£", "")
    if not source:
        return " " * width
    try:
        amount = Decimal(source)
    except InvalidOperation as error:
        raise DocumentFormPackageError(
            f"Invalid money value for an official form: {value!r}"
        ) from error
    if amount < 0:
        raise DocumentFormPackageError(
            "Negative money values cannot be entered in this official form grid."
        )
    quantum = Decimal(1).scaleb(-decimal_places)
    fixed = f"{amount.quantize(quantum, rounding=ROUND_HALF_UP):.{decimal_places}f}"
    whole, _, fraction = fixed.partition(".")
    if len(whole) > whole_digits:
        raise DocumentFormPackageError(
            f"Money value has more than {whole_digits} whole-pound digits: {value!r}"
        )
    return whole.rjust(whole_digits) + fraction.ljust(decimal_places, "0")


def _default_package_scope(form_code: str) -> tuple[str, str]:
    if form_code.startswith("SA"):
        return "accounting", "year_end_self_assessment"
    if form_code.startswith("CT600"):
        return "accounting", "year_end_corporation_tax"
    return "shared", "official_forms"


class DocumentFormPackageRegistry:
    """Discover, describe, validate and populate installed document packages."""

    def __init__(self, package_directory: Path):
        self.package_directory = Path(package_directory)
        self.package_directory.mkdir(parents=True, exist_ok=True)

    def _manifest_paths(self) -> Iterable[Path]:
        return sorted(self.package_directory.glob("*.field-map.json"))

    def get(self, form_code: str) -> Optional[dict[str, Any]]:
        safe_code = normalise_form_code(form_code)
        if not safe_code:
            return None
        for manifest_path in self._manifest_paths():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if normalise_form_code(manifest.get("form_code")) != safe_code:
                continue
            pdf_name = str(
                manifest.get("pdf_filename")
                or manifest_path.name.replace(".field-map.json", ".pdf")
            )
            pdf_path = manifest_path.parent / Path(pdf_name).name
            default_module, default_workflow = _default_package_scope(safe_code)
            package = {
                **manifest,
                "form_code": safe_code,
                "module": str(manifest.get("module") or default_module),
                "workflow": str(manifest.get("workflow") or default_workflow),
                "available": pdf_path.exists(),
                "_pdf_path": pdf_path,
                "_manifest_path": manifest_path,
            }
            if not pdf_path.exists():
                package["error"] = "Prepared PDF is missing."
            return package
        return None

    def list(
        self,
        *,
        module: Optional[str] = None,
        workflow: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        packages = []
        seen = set()
        for manifest_path in self._manifest_paths():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            form_code = normalise_form_code(manifest.get("form_code"))
            if not form_code or form_code in seen:
                continue
            seen.add(form_code)
            package = self.get(form_code)
            if not package:
                continue
            if module and package["module"] != module:
                continue
            if workflow and package["workflow"] != workflow:
                continue
            packages.append(self.describe(package))
        return packages

    @staticmethod
    def describe(package: dict[str, Any]) -> dict[str, Any]:
        fields = package.get("fields") or []
        return {
            "form_code": package.get("form_code"),
            "title": package.get("title") or package.get("form_code"),
            "module": package.get("module") or "shared",
            "workflow": package.get("workflow") or "official_forms",
            "schema_version": package.get("schema_version"),
            "source_filename": package.get("source_filename"),
            "available": bool(package.get("available")),
            "error": package.get("error"),
            "field_count": len(fields),
            "system_keys": sorted({
                str(field.get("system_key") or "")
                for field in fields
                if field.get("system_key")
            }),
        }

    @staticmethod
    def validate(
        package: dict[str, Any],
        *,
        require_appearances: bool = True,
    ) -> dict[str, Any]:
        if not package.get("available"):
            raise DocumentFormPackageError(
                str(package.get("error") or "Prepared PDF is unavailable.")
            )
        manifest_fields = package.get("fields") or []
        manifest_names = [
            str(field.get("pdf_field_name") or "") for field in manifest_fields
        ]
        if not manifest_names or any(not name for name in manifest_names):
            raise DocumentFormPackageError(
                "Prepared PDF manifest contains a blank or missing PDF field name."
            )
        if len(manifest_names) != len(set(manifest_names)):
            raise DocumentFormPackageError(
                "Prepared PDF manifest contains duplicate PDF field names."
            )
        nested_conflicts = _nested_widget_conflicts(manifest_fields)
        if nested_conflicts:
            outer, nested = nested_conflicts[0]
            raise DocumentFormPackageError(
                "Prepared PDF contains overlapping nested fields: "
                f"{outer} contains {', '.join(nested)}. Rebuild the package "
                "with the duplicate-widget safeguard enabled."
            )
        reader = PdfReader(str(package["_pdf_path"]))
        canonical_fields = reader.get_fields() or {}
        missing = sorted(set(manifest_names) - set(canonical_fields))
        if missing:
            raise DocumentFormPackageError(
                f"Prepared PDF fields are missing: {', '.join(missing[:20])}"
            )
        widget_names = set()
        missing_appearances = []
        for page in reader.pages:
            for annotation_ref in page.get("/Annots", []) or []:
                annotation = annotation_ref.get_object()
                if annotation.get("/Subtype") != "/Widget":
                    continue
                parent_ref = annotation.get("/Parent")
                parent = parent_ref.get_object() if parent_ref else None
                field_name = str(
                    annotation.get("/T")
                    or (parent.get("/T") if parent else "")
                    or ""
                )
                if field_name not in manifest_names:
                    continue
                widget_names.add(field_name)
                appearance = annotation.get("/AP")
                appearance = (
                    appearance.get_object()
                    if hasattr(appearance, "get_object")
                    else appearance
                )
                normal = appearance.get("/N") if appearance else None
                if normal is None:
                    missing_appearances.append(field_name)
        missing_widgets = sorted(set(manifest_names) - widget_names)
        if missing_widgets:
            raise DocumentFormPackageError(
                f"Prepared PDF widgets are missing: {', '.join(missing_widgets[:20])}"
            )
        if require_appearances and missing_appearances:
            raise DocumentFormPackageError(
                "Prepared PDF fields have no normal appearance stream: "
                f"{', '.join(sorted(set(missing_appearances))[:20])}"
            )
        return {
            "field_count": len(manifest_names),
            "widget_count": len(widget_names),
            "page_count": len(reader.pages),
        }

    @staticmethod
    def fill(
        package: dict[str, Any],
        values_by_key: dict[str, Any],
        *,
        read_only: bool = True,
    ) -> bytes:
        DocumentFormPackageRegistry.validate(
            package,
            require_appearances=False,
        )
        reader = PdfReader(str(package["_pdf_path"]))
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        manifest_fields = package.get("fields") or []
        expected_names = {
            str(field.get("pdf_field_name") or "") for field in manifest_fields
        }
        pdf_values: dict[str, Any] = {}
        for field in manifest_fields:
            pdf_name = str(field.get("pdf_field_name") or "")
            system_key = str(field.get("system_key") or "")
            value = values_by_key.get(system_key)
            if system_key not in values_by_key:
                value = values_by_key.get(_base_system_key(system_key))
            transform = field.get("value_transform") or {}
            transform_kind = transform.get("kind")
            if transform_kind == "money_character":
                source = _money_grid_value(
                    value,
                    whole_digits=max(1, int(transform.get("whole_digits") or 8)),
                    decimal_places=max(0, int(transform.get("decimal_places") or 0)),
                )
                try:
                    character_index = max(0, int(transform.get("index") or 0))
                except (TypeError, ValueError):
                    character_index = 0
                value = source[character_index:character_index + 1].strip()
            elif transform_kind == "character":
                source = "" if value is None else str(value)
                if transform.get("strip_non_alphanumeric"):
                    source = re.sub(r"[^A-Za-z0-9]", "", source)
                try:
                    character_index = max(0, int(transform.get("index") or 0))
                except (TypeError, ValueError):
                    character_index = 0
                value = source[character_index:character_index + 1]
            if field.get("type") == "boolean":
                pdf_values[pdf_name] = "/Yes" if bool(value) else "/Off"
            else:
                pdf_values[pdf_name] = "" if value is None else str(value)
        for page in writer.pages:
            for annotation_ref in page.get("/Annots", []) or []:
                annotation = annotation_ref.get_object()
                if annotation.get("/Subtype") != "/Widget":
                    continue
                parent_ref = annotation.get("/Parent")
                parent = parent_ref.get_object() if parent_ref else None
                field_name = str(
                    annotation.get("/T")
                    or (parent.get("/T") if parent else "")
                    or ""
                )
                if read_only and field_name in expected_names:
                    target = parent or annotation
                    target[NameObject("/Ff")] = NumberObject(
                        int(target.get("/Ff") or 0) | 1
                    )
        writer.update_page_form_field_values(
            None,
            pdf_values,
            auto_regenerate=True,
        )
        output = io.BytesIO()
        writer.write(output)
        content = output.getvalue()
        written = PdfReader(io.BytesIO(content))
        written_fields = written.get_fields() or {}
        stale = [
            name
            for name, expected in pdf_values.items()
            if str((written_fields.get(name) or {}).get("/V") or "") != str(expected)
        ]
        if stale:
            raise DocumentFormPackageError(
                f"Prepared PDF values did not persist: {', '.join(stale[:20])}"
            )
        widget_names = set()
        missing_appearances = []
        for page in written.pages:
            for annotation_ref in page.get("/Annots", []) or []:
                annotation = annotation_ref.get_object()
                if annotation.get("/Subtype") != "/Widget":
                    continue
                parent_ref = annotation.get("/Parent")
                parent = parent_ref.get_object() if parent_ref else None
                field_name = str(
                    annotation.get("/T")
                    or (parent.get("/T") if parent else "")
                    or ""
                )
                if field_name not in expected_names:
                    continue
                widget_names.add(field_name)
                appearance = annotation.get("/AP")
                appearance = (
                    appearance.get_object()
                    if hasattr(appearance, "get_object")
                    else appearance
                )
                if not appearance or appearance.get("/N") is None:
                    missing_appearances.append(field_name)
        missing_widgets = sorted(expected_names - widget_names)
        if missing_widgets:
            raise DocumentFormPackageError(
                f"Prepared PDF widgets are missing after writing: {', '.join(missing_widgets[:20])}"
            )
        if missing_appearances:
            raise DocumentFormPackageError(
                "Prepared PDF fields have no normal appearance stream after writing: "
                f"{', '.join(sorted(set(missing_appearances))[:20])}"
            )
        return content
