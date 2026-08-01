const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const systemFormsDirectory = path.join(repositoryRoot, "Client App", "backend", "assets", "system_forms");
const systemFieldCataloguePath = path.join(systemFormsDirectory, "system-form-field-catalogue.json");
const officialFormsDirectory = path.join(repositoryRoot, "Client App", "backend", "assets");
const batchSystemForms = process.argv.includes("--batch-system-forms");
const requestedBatchCodes = process.argv
  .filter(value => value.startsWith("--batch-form="))
  .flatMap(value => value.slice("--batch-form=".length).split(","))
  .map(normaliseFormCode)
  .filter(Boolean);
const allBatchFormCodes = [
  "SA100-2026", "SA101-2026", "SA102-2026", "SA103S-2026",
  "SA103F-2026", "SA104S-2026", "SA105-2026", "SA106-2026",
  "SA107-2026", "SA108-2026", "SA109-2026", "SA110-2026"
];
const batchFormCodes = requestedBatchCodes.length ? requestedBatchCodes : allBatchFormCodes;

function normaliseFormCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

async function backupExistingFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const backupPath = `${filePath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    title: "Fieldcraft PDF",
    backgroundColor: "#e9edf1",
    show: !batchSystemForms,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.webContents.on("did-finish-load", () => win.setTitle("Fieldcraft PDF"));
  win.webContents.on("render-process-gone", (_event, details) => {
    dialog.showErrorBox(
      "Fieldcraft renderer stopped",
      `The document window stopped unexpectedly (${details.reason}). Fieldcraft will reopen it.`
    );
    if (!win.isDestroyed()) win.reload();
  });
  win.webContents.on("did-fail-load", (_event, code, description) => {
    dialog.showErrorBox("Fieldcraft could not start", `${description} (${code})`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("pdf:open", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PDF documents", extensions: ["pdf"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return { name: path.basename(filePath), path: filePath, bytes };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("pdf:read-path", async (_event, filePath) => {
  const resolved = path.resolve(String(filePath || ""));
  const relative = path.relative(officialFormsDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Batch PDF path is outside the official forms directory.");
  }
  const data = await fs.readFile(resolved);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return { name: path.basename(resolved), path: resolved, bytes };
});

ipcMain.handle("system:get-batch-job", async () => ({
  enabled: batchSystemForms,
  forms: batchFormCodes.map(formCode => ({
    formCode,
    path: path.join(officialFormsDirectory, `${formCode}.pdf`)
  }))
}));

ipcMain.handle("system:batch-complete", async (_event, result) => {
  const reportPath = path.join(systemFormsDirectory, "batch-install-report.json");
  await fs.mkdir(systemFormsDirectory, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...result, reportPath }));
  setTimeout(() => app.quit(), 50);
  return reportPath;
});

ipcMain.handle("pdf:save", async (_event, { bytes, suggestedName }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName || "fillable-document.pdf",
    filters: [{ name: "PDF documents", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(bytes));
  return result.filePath;
});

ipcMain.handle("pdf:save-package", async (_event, { bytes, manifest, suggestedName }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName || "prepared-form.pdf",
    filters: [{ name: "PDF form package", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) return null;
  const pdfPath = result.filePath.toLowerCase().endsWith(".pdf") ? result.filePath : `${result.filePath}.pdf`;
  const manifestPath = pdfPath.replace(/\.pdf$/i, ".field-map.json");
  await fs.writeFile(pdfPath, Buffer.from(bytes));
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { pdfPath, manifestPath };
});

ipcMain.handle("system:get-field-catalogue", async (_event, formCode) => {
  const safeCode = normaliseFormCode(formCode);
  let catalogue = { schema_version: 1, forms: {} };
  try {
    catalogue = JSON.parse(await fs.readFile(systemFieldCataloguePath, "utf8"));
  } catch (error) {
    return {
      formCode: safeCode,
      targetDirectory: systemFormsDirectory,
      fields: [],
      error: `Unable to read the EPOS field catalogue: ${error.message || error}`
    };
  }
  return {
    formCode: safeCode,
    targetDirectory: systemFormsDirectory,
    ...(catalogue.forms?.[safeCode] || { fields: [] })
  };
});

ipcMain.handle("system:install-package", async (_event, { bytes, manifest }) => {
  const formCode = normaliseFormCode(manifest?.form_code);
  if (!formCode) throw new Error("A valid form code is required before installing a system package.");
  if (!Array.isArray(manifest?.fields) || !manifest.fields.length) {
    throw new Error("The system package must contain at least one mapped field.");
  }
  await fs.mkdir(systemFormsDirectory, { recursive: true });
  const pdfName = `${formCode}-system-fillable.pdf`;
  const manifestName = `${formCode}-system-fillable.field-map.json`;
  const pdfPath = path.join(systemFormsDirectory, pdfName);
  const manifestPath = path.join(systemFormsDirectory, manifestName);
  const backupPaths = [
    await backupExistingFile(pdfPath),
    await backupExistingFile(manifestPath)
  ].filter(Boolean);
  const installedManifest = {
    ...manifest,
    schema_version: Math.max(2, Number(manifest.schema_version) || 1),
    form_code: formCode,
    pdf_filename: pdfName,
    installed_at: new Date().toISOString()
  };
  await fs.writeFile(pdfPath, Buffer.from(bytes));
  await fs.writeFile(manifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`, "utf8");
  return { pdfPath, manifestPath, backupPaths };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
