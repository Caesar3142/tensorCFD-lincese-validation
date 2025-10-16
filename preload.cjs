// preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

console.log("[PRELOAD] Loaded successfully and exposing window.api");

contextBridge.exposeInMainWorld("api", {
  validateLicense: (email, productKey) =>
    ipcRenderer.invoke("license:validate", { email, productKey }),
  proceedToApp: () => ipcRenderer.invoke("app:proceed"),
  logout: () => ipcRenderer.invoke('app:logout'),
});
