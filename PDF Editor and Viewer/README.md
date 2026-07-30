# Fieldcraft PDF

A local-first desktop PDF viewer and visual form editor. It can open ordinary PDFs, detect likely printed boxes, convert them into editable fields, add new text/checkbox/signature areas, and export a fillable AcroForm PDF.

## Run on Windows

Double-click **Start Fieldcraft.cmd** in this folder. This launcher does not
require `pnpm` to be installed globally and works from any current directory.

Alternatively, from the parent repository in PowerShell:

```powershell
& ".\PDF Editor and Viewer\Start Fieldcraft.cmd"
```

## Developer run

```powershell
pnpm install
pnpm start
```

## Workflow

1. Open a PDF.
2. Click **Detect boxes** or choose a field tool and drag on the page.
3. Select fields to move, resize, rename, and configure them.
4. Export a new fillable PDF. The source file is never overwritten.

Detection is intentionally presented as editable candidates because visual documents vary widely. Review the highlighted areas before export.

## EPOS Accountancy integration

Use **Export system package** for a Year End Accounts form:

1. Enter the official form code, such as `SA100-2026` or `SA105-2026`.
2. Give every field a unique **System key** matching the key used by the
   accounting workflow, such as `turnover` or `sa105_box_20`.
3. Enter the official box number where applicable.
4. Export the system package.
5. Place both the PDF and its `.field-map.json` file in
   `Client App/backend/assets/system_forms/`.

The Year End Accounts preview automatically switches from the image fallback
to the populated native PDF when a valid package is installed.
