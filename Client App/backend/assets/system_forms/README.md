# EPOS official-document form packages

This directory contains official PDF forms prepared by **PDF Editor and Viewer**.
Each form package consists of:

- `<form>-system-fillable.pdf`
- `<form>-system-fillable.field-map.json`

The manifest `form_code` must match the official form identifier, for example
`SA100-2026`, `SA103S-2026`, or `SA105-2026`. Packages also declare:

- `module`: the owning EPOS module, such as `accounting` or `payroll`;
- `workflow`: the form workflow, such as `year_end_self_assessment`.

Legacy manifests without those attributes remain supported and are classified
from their form-code family.

Every widget must have a unique `pdf_field_name`. Its `system_key` must match the
field key used by the owning module's Details & sections workflow. Examples include
`utr`, `phone`, `turnover`, and `sa105_box_20`.

Several widgets may share one `system_key` when the official form prints one
character per box. Each of those manifest entries must contain a unique,
zero-based `value_transform.index`; the editor creates this metadata
automatically when it recognises a character grid.

`backend.document_forms.DocumentFormPackageRegistry` is the global package
contract. Modules must use this registry rather than creating their own PDF
fill implementation. The admin endpoints `/api/admin/document-forms/packages`
and `/api/admin/document-forms/packages/{form_code}` expose safe package status
and field metadata for module workspaces.

The backend only advertises a form as system-fillable when both files exist.
Before returning a populated PDF, it verifies that every manifest field exists
in the PDF's canonical AcroForm tree, every written value persists after the PDF
is reopened, every field still has a page widget, and every widget has a normal
appearance stream.
