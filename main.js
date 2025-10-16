// main.js
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import keytar from "keytar";

// ===== 1) EMBED YOUR CONFIG HERE (no .env needed) =====
const EMBEDDED_CONFIG = {
  LICENSE_LIST_URL: "https://pttensor.com/tensorhvac-licensing" // <-- change if needed
};
// ======================================================

// We will import licenseService.js AFTER we set process.env
let validateLicense;
let isExpired;

// ── Detect environment & common paths
const isDev = !app.isPackaged;
const APP_PATH = app.getAppPath(); // ASAR root in production, project root in dev
const PRELOAD_PATH = path.join(APP_PATH, "preload.cjs");
const CACHE_PATH = path.join(app.getPath("userData"), "license-cache.json");

const SERVICE_NAME = "electron-license-app";
const ACCOUNT_NAME = "license";

let mainWindow = null;

// ── Helper to resolve bundled HTML
function resolveHtml(rel) {
  return path.join(APP_PATH, rel); // e.g. "src/index.html"
}

function createWindow(htmlFile) {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on("console-message", (_level, _line, message) => {
    console.log("[Renderer]", message);
  });

  win.loadFile(htmlFile);
  return win;
}

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

// ── Boot: re-validate license on every start using cached creds
async function boot() {
  const cached = await getCachedLicense();

  if (!cached || !cached.email || !cached.product_key) {
    return resolveHtml("src/index.html");
  }

  if (isExpired(cached.end_date)) {
    await clearCachedLicense();
    return resolveHtml("src/index.html");
  }

  const res = await validateLicense(cached.email, cached.product_key);
  if (res?.ok && !isExpired(res.end_date)) {
    setCachedLicense({ email: cached.email, product_key: cached.product_key, end_date: res.end_date });
    return resolveHtml("src/app.html");
  }

  await clearCachedLicense();
  return resolveHtml("src/index.html");
}

// ── Ensure env + dynamic import happen before we use the service
async function loadServices() {
  // Set env for licenseService.js (so it reads the correct URL)
  if (!process.env.LICENSE_LIST_URL) {
    process.env.LICENSE_LIST_URL = EMBEDDED_CONFIG.LICENSE_LIST_URL;
  }
  console.log("[MAIN] Using LICENSE_LIST_URL:", process.env.LICENSE_LIST_URL);

  // Dynamic import AFTER env is set
  const mod = await import("./services/licenseService.js");
  validateLicense = mod.validateLicense;
  isExpired = mod.isExpired;
}

// ── App lifecycle
app.whenReady().then(async () => {
  console.log("[MAIN] Mode:", isDev ? "Development" : "Production");
  console.log("[MAIN] APP_PATH:", APP_PATH);
  console.log("[MAIN] PRELOAD_PATH:", PRELOAD_PATH);
  console.log("[MAIN] CACHE_PATH:", CACHE_PATH);

  // Load services (sets env and then imports licenseService)
  await loadServices();

  const htmlToLoad = await boot();
  mainWindow = createWindow(htmlToLoad);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(resolveHtml("src/index.html"));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC
ipcMain.handle("license:validate", async (_evt, { email, productKey }) => {
  const result = await validateLicense(email, productKey);
  if (result.ok) {
    setCachedLicense({ email, product_key: productKey, end_date: result.end_date });
  }
  return result;
});

ipcMain.handle("app:proceed", async () => {
  if (!mainWindow) return { ok: false, message: "No main window" };
  await mainWindow.loadFile(resolveHtml("src/app.html"));
  return { ok: true };
});

ipcMain.handle("app:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) {
      await mainWindow.loadFile(resolveHtml("src/index.html"));
    }
    return { ok: true };
  } catch (err) {
    console.error("[MAIN] Logout failed", err);
    return { ok: false, message: err.message };
  }
});

ipcMain.handle("license:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) {
      await mainWindow.loadFile(resolveHtml("src/index.html"));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle("license:revalidateNow", async () => {
  const cached = await getCachedLicense();
  if (!cached?.email || !cached?.product_key) {
    if (mainWindow) await mainWindow.loadFile(resolveHtml("src/index.html"));
    return { ok: false, message: "No cached license." };
  }
  const res = await validateLicense(cached.email, cached.product_key);
  if (res?.ok && !isExpired(res.end_date)) {
    setCachedLicense({ email: cached.email, product_key: cached.product_key, end_date: res.end_date });
    if (mainWindow) await mainWindow.loadFile(resolveHtml("src/app.html"));
    return { ok: true, message: "License valid." };
  } else {
    await clearCachedLicense();
    if (mainWindow) await mainWindow.loadFile(resolveHtml("src/index.html"));
    return { ok: false, message: res?.message || "License invalid." };
  }
});
