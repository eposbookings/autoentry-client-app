# Year End Accounts system PDF packages

This directory contains official PDF forms prepared by **PDF Editor and Viewer**.
Each form package consists of:

- `<form>-system-fillable.pdf`
- `<form>-system-fillable.field-map.json`

The manifest `form_code` must match the Year End Accounts form identifier, for
example `SA100-2026`, `SA103S-2026`, or `SA105-2026`.

Every widget must have a unique `system_key`. The key must match the field key
used by the Year End Accounts details workflow. Examples include `utr`, `phone`,
`turnover`, and `sa105_box_20`.

The backend only advertises a form as system-fillable when both files exist.
Before returning a populated PDF, it verifies that every manifest field exists
in the PDF's canonical AcroForm tree and that every written value persists.
