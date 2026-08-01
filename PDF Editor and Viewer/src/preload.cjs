const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  readPdfPath: (filePath) => ipcRenderer.invoke("pdf:read-path", filePath),
  savePdf: (payload) => ipcRenderer.invoke("pdf:save", payload),
  savePackage: (payload) => ipcRenderer.invoke("pdf:save-package", payload),
  getSystemFieldCatalogue: (formCode) => ipcRenderer.invoke("system:get-field-catalogue", formCode),
  installSystemPackage: (payload) => ipcRenderer.invoke("system:install-package", payload),
  getBatchJob: () => ipcRenderer.invoke("system:get-batch-job"),
  batchComplete: (payload) => ipcRenderer.invoke("system:batch-complete", payload)
});
