// preload.cjs
// Runs in isolated world. Exposes a safe API to the renderer.

const { contextBridge, ipcRenderer } = require("electron");

console.log("[PRELOAD] Loaded successfully and exposing window.api");

// Optional allowlist (uncomment to enforce)
// const ALLOW = new Set([
//   "license:validate", "app:proceed", "app:logout", "license:logout",
//   "license:status", "license:clear",
//   "license:revalidateNow",
//   "pro:launch", "pro:where", "pro:pickPath", "pro:setHint"
// ]);

function safeInvoke(channel, payload) {
  // if (ALLOW.size && !ALLOW.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("api", {
  // Generic helper
  invoke: (channel, payload) => safeInvoke(channel, payload),

  // 🔐 Licensing
  validateLicense: (email, productKey) => safeInvoke("license:validate", { email, productKey }),
  revalidate:      () => safeInvoke("license:revalidateNow"),     // if you use this elsewhere
  licenseStatus:   () => safeInvoke("license:status"),
  licenseClear:    () => safeInvoke("license:clear"),
  logout:          () => safeInvoke("app:logout"),

  // 🚀 Pro app utilities
  proLaunch:   ()    => safeInvoke("pro:launch"),
  proWhere:    ()    => safeInvoke("pro:where"),
  proPickPath: ()    => safeInvoke("pro:pickPath"),
  setProHint:  (p)   => safeInvoke("pro:setHint", p),

  // Tiny ping for sanity in DevTools
  _ping: () => "pong",
});
