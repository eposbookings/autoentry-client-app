const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  savePdf: (payload) => ipcRenderer.invoke("pdf:save", payload)
});
