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
2. Click **Prepare a Form** or choose a field tool and drag on the page.
3. Select fields to move, resize, rename, and configure them.
4. Export a new fillable PDF. The source file is never overwritten.

Detection is intentionally presented as editable candidates because visual documents vary widely. Review the highlighted areas before export.

## EPOS global module integration

Use the integrated EPOS workflow for any official document used by an EPOS
module:

1. Enter the official form code, such as `SA100-2026` or `SA105-2026`.
2. Select **Prepare a Form**, then **Map EPOS fields**. The editor reads the
   repository field catalogue, matches nearby official box numbers, and proposes
   system keys such as `turnover` or `sa105_box_20`.
3. Review every overlay and correct its official box/system key where needed.
   Character grids such as phone numbers, UTRs and dates must show a distinct
   character position on each visible cell.
4. Select **Install in EPOS**. The editor writes the canonical PDF and field-map
   files directly to `Client App/backend/assets/system_forms/`, backing up any
   existing package first.

**Export system package** remains available for a portable PDF plus manifest
pair, but manual copying is no longer required for this repository.

Each installed package records its owning module and workflow. Module UIs use
the shared `OfficialFormDetails` and `OfficialFormPreview` components, so the
Details & sections / read-only official preview behavior stays consistent
across Accounting, Payroll, Tax and future modules.
