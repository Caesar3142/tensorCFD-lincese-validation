// preload.cjs
// Runs in isolated world. Exposes a safe API to the renderer.

const { contextBridge, ipcRenderer } = require("electron");

// Optional: log so you can see this actually loaded
console.log("[PRELOAD] Loaded successfully and exposing window.api");

function safeInvoke(channel, payload) {
  // Optionally whitelist channels to be extra strict:
  // const ALLOW = new Set([
  //   "license:validate", "app:proceed", "app:logout", "license:logout",
  //   "license:revalidateNow", "pro:launch", "pro:where", "pro:pickPath", "pro:setHint"
  // ]);
  // if (!ALLOW.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("api", {
  /** Generic helper your renderer expects */
  invoke: (channel, payload) => safeInvoke(channel, payload),

  /** Convenience shorthands (optional) */
  logout:     ()       => safeInvoke("app:logout"),
  revalidate: ()       => safeInvoke("license:revalidateNow"),
  proLaunch:  ()       => safeInvoke("pro:launch"),
  proWhere:   ()       => safeInvoke("pro:where"),
  proPickPath:()       => safeInvoke("pro:pickPath"),
  setProHint: (p)      => safeInvoke("pro:setHint", p),

  /** Tiny test util so you can verify in DevTools quickly */
  _ping: () => "pong",
});
