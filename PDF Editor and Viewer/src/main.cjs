const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    title: "Fieldcraft PDF",
    backgroundColor: "#e9edf1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
