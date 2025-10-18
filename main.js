
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
import keytar from "keytar";
import { spawn, execFile, exec } from "child_process";

const isDev = !app.isPackaged;
const APP_PATH = app.getAppPath();
const PRELOAD_PATH = path.join(APP_PATH, "preload.cjs");
const CACHE_PATH = path.join(app.getPath("userData"), "license-cache.json");
const PRO_PATH_CONFIG = path.join(app.getPath("userData"), "pro-path.json");

const SERVICE_NAME = "electron-license-app";
const ACCOUNT_NAME = "license";

// ===== 1) EMBED YOUR CONFIG HERE =====
const EMBEDDED_CONFIG = {
  LICENSE_LIST_URL: "https://pttensor.com/tensorhvac-licensing",
  HANDSHAKE_PASSWORD: "thvac-pro-2025-handshake-5f7c1a4e9b2d",

  PRO_APP_CANDIDATES: {
    win32: [
      "C:\\Users\\LENOVO\\AppData\\Local\\Programs\\tensorhvac-pro\\TensorHVAC Pro.exe",
    ],
  },

  PRO_APP_HINT: process.env.PRO_APP_HINT || "",
};
// ============================================================

let validateLicense;
let isExpired;
let mainWindow = null;

/* ----------------------- HTML helpers ----------------------- */
function resolveHtml(rel) {
  return path.join(APP_PATH, rel);
}

function createWindow(htmlFile) {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.on("console-message", (_level, _line, message) => {
    console.log("[Renderer]", message);
  });
  win.on("unresponsive", () => console.warn("[MAIN] Window became unresponsive"));
  win.on("render-process-gone", (_e, d) => console.warn("[MAIN] Renderer gone:", d));
  win.loadFile(htmlFile);
  return win;
}

/* ----------------------- Cache helpers ---------------------- */
async function getCachedLicense() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    }
  } catch {}
  try {
    const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function setCachedLicense(data) {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2)); } catch {}
  try { keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(data)); } catch {}
}

async function clearCachedLicense() {
  try { if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH); } catch {}
  try { await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME); } catch {}
}

/* ------------------- Pro path persistence ------------------- */
function loadProHint() {
  try {
    if (fs.existsSync(PRO_PATH_CONFIG)) {
      const j = JSON.parse(fs.readFileSync(PRO_PATH_CONFIG, "utf-8"));
      if (j && typeof j.path === "string" && j.path.trim()) return j.path.trim();
    }
  } catch {}
  return null;
}

function saveProHint(p) {
  try {
    fs.writeFileSync(PRO_PATH_CONFIG, JSON.stringify({ path: p }, null, 2), "utf-8");
    return true;
  } catch (e) {
    dialog.showErrorBox("Failed to save Pro path", e?.message || String(e));
    return false;
  }
}

/* -------------------- Pro app resolution -------------------- */
function candidateList() {
  const list = [];
  const userOverride = loadProHint();
  if (userOverride) list.push(userOverride);
  if (EMBEDDED_CONFIG.PRO_APP_HINT) list.push(EMBEDDED_CONFIG.PRO_APP_HINT);

  const plat = process.platform;
  if (plat === "win32") list.push(...(EMBEDDED_CONFIG.PRO_APP_CANDIDATES.win32 || []));
  else if (plat === "darwin") list.push(...(EMBEDDED_CONFIG.PRO_APP_CANDIDATES.darwin || []));
  else list.push(...(EMBEDDED_CONFIG.PRO_APP_CANDIDATES.linux || []));

  return [...new Set(list.filter(Boolean))];
}

function findProExecutable() {
  const unique = candidateList();

  console.log("[PRO] Candidate paths:");
  for (const c of unique) console.log("   •", c);

  for (const candidate of unique) {
    try {
      if (fs.existsSync(candidate)) {
        console.log("[PRO] Using:", candidate);
        return candidate;
      }
    } catch (e) {
      console.warn("[PRO] existsSync error for", candidate, e?.message || e);
    }
  }
  return null;
}

/* ------------------ Multi-strategy launcher ----------------- */
function getLaunchEnv() {
  return {
    ...process.env,
    TENSORHVAC_HANDSHAKE: EMBEDDED_CONFIG.HANDSHAKE_PASSWORD,
    THVAC_HANDSHAKE: EMBEDDED_CONFIG.HANDSHAKE_PASSWORD,
  };
}

function getArgs() {
  return [`--handshake=${EMBEDDED_CONFIG.HANDSHAKE_PASSWORD}`];
}

function isProcessRunningWin(exeBaseName) {
  return new Promise((resolve) => {
    exec('tasklist /FO CSV /NH', { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const lines = stdout.trim().split(/\r?\n/);
      const target = (exeBaseName || "").toLowerCase();
      for (const line of lines) {
        const name = line.split('","')[0]?.replace(/^\"/,'').toLowerCase();
        if (name === target) return resolve(true);
      }
      resolve(false);
    });
  });
}

function launchProApp() {
  const exe = findProExecutable();
  if (!exe) {
    dialog.showErrorBox(
      "Launch Error",
      "tensorHVAC-Pro-2025 executable not found.\n\nUse the Launch button → “Browse…” (or call pro:pickPath) to set the correct path."
    );
    return { ok: false, message: "Pro app not found" };
  }

  const env = getLaunchEnv();
  const args = getArgs();
  const cwd = path.dirname(exe);

  // Strategy 1: spawn
  try {
    const child = spawn(exe, args, {
      env, cwd,
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: process.platform === "win32" ? false : true,
      shell: false,
    });
    const pid = child?.pid || null;
    try { if (mainWindow && process.platform === "win32") mainWindow.minimize(); } catch {}
    child.unref?.();
    return { ok: true, strategy: "spawn", pid };
  } catch (err1) {
    console.warn("[PRO] spawn failed:", err1?.message || err1);
  }

  // Strategy 2: execFile
  try {
    const child = execFile(exe, args, { env, cwd, windowsHide: false });
    const pid = child?.pid || null;
    try { if (mainWindow && process.platform === "win32") mainWindow.minimize(); } catch {}
    return { ok: true, strategy: "execFile", pid };
  } catch (err2) {
    console.warn("[PRO] execFile failed:", err2?.message || err2);
  }

  // Windows fallbacks
  if (process.platform === "win32") {
    // 3) cmd start
    try {
      const cmd = `start "" "${exe}" ${args.join(" ")}`;
      const child = exec(cmd, { env, cwd, windowsHide: false });
      const pid = child?.pid || null;
      try { if (mainWindow) mainWindow.minimize(); } catch {}
      return { ok: true, strategy: "cmd start", pid };
    } catch (err3) {
      console.warn("[PRO] cmd start failed:", err3?.message || err3);
    }

    // 4) PowerShell Start-Process
    try {
      const ps = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '${args.join(" ").replace(/'/g, "''")}'`;
      const child = exec(`powershell -NoProfile -Command "${ps}"`, { env, cwd, windowsHide: false });
      const pid = child?.pid || null;
      try { if (mainWindow) mainWindow.minimize(); } catch {}
      return { ok: true, strategy: "powershell Start-Process", pid };
    } catch (err4) {
      console.warn("[PRO] PowerShell failed:", err4?.message || err4);
    }

    // 5) explorer.exe
    try {
      const child = exec(`explorer.exe "${exe}"`, { env, cwd, windowsHide: false });
      const pid = child?.pid || null;
      try { if (mainWindow) mainWindow.minimize(); } catch {}
      return { ok: true, strategy: "explorer", pid };
    } catch (err5) {
      console.warn("[PRO] explorer failed:", err5?.message || err5);
    }
  }

  dialog.showErrorBox("Failed to launch Pro", "All launch strategies failed.");
  return { ok: false, message: "All strategies failed" };
}

/* ------------------------ Boot Flow ------------------------- */
async function boot() {
  const cached = await getCachedLicense();

  if (!cached || !cached.email || !cached.product_key) {
    return resolveHtml("src/index.html"); // login page
  }

  if (isExpired(cached.end_date)) {
    await clearCachedLicense();
    return resolveHtml("src/index.html");
  }

  const res = await validateLicense(cached.email, cached.product_key);
  if (res?.ok && !isExpired(res.end_date)) {
    setCachedLicense({ email: cached.email, product_key: cached.product_key, end_date: res.end_date });
    // Do NOT auto-launch; show licensed screen with Launch button
    return resolveHtml("src/app.html");
  }

  await clearCachedLicense();
  return resolveHtml("src/index.html");
}

/* -------------- Ensure env + dynamic import first ----------- */
async function loadServices() {
  if (!process.env.LICENSE_LIST_URL) {
    process.env.LICENSE_LIST_URL = EMBEDDED_CONFIG.LICENSE_LIST_URL;
  }
  console.log("[MAIN] Using LICENSE_LIST_URL:", process.env.LICENSE_LIST_URL);

  const mod = await import("./services/licenseService.js");
  validateLicense = mod.validateLicense;
  isExpired = mod.isExpired;

  if (!validateLicense || !isExpired) {
    console.error("[MAIN] licenseService not loaded correctly.");
  }
}

/* --------------------- Single instance ---------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/* ---------------------- App lifecycle ----------------------- */
app.whenReady().then(async () => {
  console.log("[MAIN] Mode:", isDev ? "Development" : "Production");
  console.log("[MAIN] APP_PATH:", APP_PATH);
  console.log("[MAIN] PRELOAD_PATH:", PRELOAD_PATH);
  console.log("[MAIN] CACHE_PATH:", CACHE_PATH);

  await loadServices();
  const htmlToLoad = await boot();
  mainWindow = createWindow(htmlToLoad);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(resolveHtml("src/index.html"));
    }
  });
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* -------------------------- IPC ----------------------------- */
// Validate & cache (returns descriptive message)
ipcMain.handle("license:validate", async (_evt, { email, productKey }) => {
  try {
    const result = await validateLicense(email, productKey);
    console.log("[LICENSE] validate", { email, ok: result.ok, msg: result.message, end: result.end_date, offline: result.offline });
    if (result.ok) {
      setCachedLicense({ email, product_key: productKey, end_date: result.end_date });
    }
    return result;
  } catch (e) {
    console.error("[LICENSE] validate error:", e);
    return { ok: false, message: e?.message || "Validation failed." };
  }
});

// Proceed to licensed UI (no auto-launch)
ipcMain.handle("app:proceed", async () => {
  if (!mainWindow) return { ok: false, message: "No main window" };
  await mainWindow.loadFile(resolveHtml("src/app.html"));
  return { ok: true };
});

// Optional helpers to inspect/clear cached license
ipcMain.handle("license:status", async () => {
  try {
    const cached = await getCachedLicense();
    return { ok: true, cached };
  } catch (e) {
    return { ok: false, message: e?.message || "Failed to read cache." };
  }
});
ipcMain.handle("license:clear", async () => {
  try {
    await clearCachedLicense();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || "Failed to clear cache." };
  }
});

// Launch the Pro app (button)
ipcMain.handle("pro:launch", async () => {
  const res = launchProApp();
  if (!res.ok) return res;

  let running = null;
  if (process.platform === "win32") {
    const exe = findProExecutable();
    const base = exe ? path.basename(exe) : null;
    running = base ? await isProcessRunningWin(base) : null;
  }

  return {
    ok: true,
    message: `Launched via ${res.strategy}`,
    strategy: res.strategy,
    pid: res.pid || null,
    running,
    note:
      process.platform === "win32"
        ? "If the Pro window is behind this one, try Alt+Tab. We minimized this window to help."
        : undefined,
  };
});

// Diagnostics
ipcMain.handle("pro:where", async () => {
  const exe = findProExecutable();
  return { exe, exists: !!(exe && fs.existsSync(exe)), platform: process.platform, candidates: candidateList() };
});
ipcMain.handle("pro:pickPath", async () => {
  const res = await dialog.showOpenDialog({
    title: "Select tensorHVAC-Pro-2025 executable",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "Executables", extensions: ["exe"] }]
      : [{ name: "Executables", extensions: ["", "app"] }],
  });
  if (res.canceled || !res.filePaths?.length) return { ok: false, message: "User cancelled" };

  const chosen = res.filePaths[0];
  if (!fs.existsSync(chosen)) return { ok: false, message: "Selected file does not exist" };

  if (!saveProHint(chosen)) return { ok: false, message: "Failed to save override path" };
  return { ok: true, path: chosen };
});
ipcMain.handle("pro:setHint", async (_e, p) => {
  if (!p || typeof p !== "string") return { ok: false, message: "Invalid path" };
  if (!fs.existsSync(p)) return { ok: false, message: "Path does not exist" };
  if (!saveProHint(p)) return { ok: false, message: "Failed to save override path" };
  return { ok: true, path: p };
});

// Logout (✅ this is the handler your renderer is calling)
ipcMain.handle("app:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) await mainWindow.loadFile(resolveHtml("src/index.html"));
    return { ok: true };
  } catch (err) {
    console.error("[MAIN] Logout failed", err);
    return { ok: false, message: err.message };
  }
});
ipcMain.handle("license:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) await mainWindow.loadFile(resolveHtml("src/index.html"));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});
