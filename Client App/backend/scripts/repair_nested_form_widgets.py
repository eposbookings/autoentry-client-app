"""Remove overlapping nested AcroForm widgets from installed form packages.

Run without ``--apply`` to audit packages. The repair is deliberately narrow:
it only removes thin widgets nested inside a full entry box when at least one
nested widget has the same system key as the outer widget.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject

from backend.document_forms import _nested_widget_conflicts


def _effective_name(annotation) -> str:
    parent_ref = annotation.get("/Parent")
    parent = parent_ref.get_object() if parent_ref else None
    return str(annotation.get("/T") or (parent.get("/T") if parent else "") or "")


def _repair_pdf(pdf_path: Path, removal_names: set[str]) -> None:
    reader = PdfReader(str(pdf_path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    for page in writer.pages:
        annotations = page.get("/Annots") or []
        retained = ArrayObject([
            annotation_ref
            for annotation_ref in annotations
            if not (
                annotation_ref.get_object().get("/Subtype") == "/Widget"
                and _effective_name(annotation_ref.get_object()) in removal_names
            )
        ])
        page[NameObject("/Annots")] = retained

    acroform_ref = writer.root_object.get("/AcroForm")
    acroform = acroform_ref.get_object() if acroform_ref else None
    if acroform is not None:
        retained_fields = ArrayObject()
        for field_ref in acroform.get("/Fields") or []:
            field = field_ref.get_object()
            field_name = str(field.get("/T") or "")
            if field_name in removal_names:
                continue
            kids = field.get("/Kids")
            if kids:
                retained_kids = ArrayObject([
                    kid_ref
                    for kid_ref in kids
                    if _effective_name(kid_ref.get_object()) not in removal_names
                ])
                field[NameObject("/Kids")] = retained_kids
                if not retained_kids:
                    continue
            retained_fields.append(field_ref)
        acroform[NameObject("/Fields")] = retained_fields

    temporary_path = pdf_path.with_suffix(".repair.tmp.pdf")
    with temporary_path.open("wb") as output:
        writer.write(output)
    repaired = PdfReader(str(temporary_path))
    remaining_fields = set(repaired.get_fields() or {}) & removal_names
    remaining_widgets = {
        _effective_name(annotation_ref.get_object())
        for page in repaired.pages
        for annotation_ref in (page.get("/Annots") or [])
        if annotation_ref.get_object().get("/Subtype") == "/Widget"
    } & removal_names
    if remaining_fields or remaining_widgets:
        temporary_path.unlink(missing_ok=True)
        remaining = sorted(remaining_fields | remaining_widgets)
        raise RuntimeError(f"Nested widgets remain in {pdf_path.name}: {remaining}")
    temporary_path.replace(pdf_path)


def _normalise_character_grid_indices(fields: list[dict]) -> int:
    groups: dict[tuple, list[dict]] = {}
    for field in fields:
        transform = field.get("value_transform") or {}
        if transform.get("kind") not in {"character", "money_character"}:
            continue
        geometry = field.get("geometry") or {}
        try:
            row = round(float(geometry["y"]), 3)
            x = float(geometry["x"])
        except (KeyError, TypeError, ValueError):
            continue
        group_key = (field.get("page"), field.get("system_key"), row)
        groups.setdefault(group_key, []).append((x, field))
    changes = 0
    for group in groups.values():
        if len(group) < 2:
            continue
        for index, (_, field) in enumerate(sorted(group, key=lambda item: item[0])):
            transform = field.get("value_transform") or {}
            if transform.get("index") != index:
                transform["index"] = index
                field["value_transform"] = transform
                changes += 1
    return changes


def repair_packages(package_directory: Path, *, apply: bool) -> int:
    affected = 0
    for manifest_path in sorted(package_directory.glob("*.field-map.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        conflicts = _nested_widget_conflicts(manifest.get("fields") or [])
        removal_names = {name for _, nested in conflicts for name in nested}
        retained_fields = [
            field
            for field in (manifest.get("fields") or [])
            if str(field.get("pdf_field_name") or "") not in removal_names
        ]
        index_changes = _normalise_character_grid_indices(retained_fields)
        if not removal_names and not index_changes:
            continue
        affected += 1
        print(
            f"{manifest_path.name}: {len(removal_names)} nested widgets, "
            f"{index_changes} character indices"
        )
        if not apply:
            continue
        pdf_name = str(
            manifest.get("pdf_filename")
            or manifest_path.name.replace(".field-map.json", ".pdf")
        )
        pdf_path = manifest_path.parent / Path(pdf_name).name
        if removal_names:
            _repair_pdf(pdf_path, removal_names)
        manifest["fields"] = retained_fields
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    return affected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--package-directory",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "system_forms",
    )
    arguments = parser.parse_args()
    affected = repair_packages(arguments.package_directory, apply=arguments.apply)
    mode = "Repaired" if arguments.apply else "Found"
    print(f"{mode} {affected} affected form packages.")


if __name__ == "__main__":
    main()
