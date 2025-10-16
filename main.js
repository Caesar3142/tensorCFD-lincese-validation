// main.js
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import keytar from "keytar";
import "dotenv/config";
import { validateLicense, isExpired } from "./services/licenseService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRELOAD_PATH = path.resolve(__dirname, "preload.cjs");  // CommonJS preload
const CACHE_PATH   = path.join(__dirname, "license-cache.json");
const SERVICE_NAME = "electron-license-app";
const ACCOUNT_NAME = "license";

let mainWindow;

// ---------- helpers
function createWindow(htmlPath) {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on("console-message", (_level, _line, message) => {
    console.log("[Renderer Log]", message);
  });

  win.loadFile(htmlPath);
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

// NEW: Always re-validate the cached license against your website on startup
async function boot() {
  const cached = await getCachedLicense();

  // No cache → show login
  if (!cached || !cached.email || !cached.product_key) {
    return path.join(__dirname, "src", "index.html");
  }

  // Expired by date → clear & show login
  if (isExpired(cached.end_date)) {
    await clearCachedLicense();
    return path.join(__dirname, "src", "index.html");
  }

  // Re-check with the live license list on your website
  const res = await validateLicense(cached.email, cached.product_key);
  if (res?.ok && !isExpired(res.end_date)) {
    // refresh cached end date (in case you extended it online)
    setCachedLicense({
      email: cached.email,
      product_key: cached.product_key,
      end_date: res.end_date,
    });
    return path.join(__dirname, "src", "app.html");
  }

  // Revoked/changed/expired online → force login
  await clearCachedLicense();
  return path.join(__dirname, "src", "index.html");
}

// ---------- app lifecycle
app.whenReady().then(async () => {
  console.log("[MAIN] App starting, preload path:", PRELOAD_PATH);

  const startHtml = await boot();       // <-- revalidates every start
  mainWindow = createWindow(startHtml);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(path.join(__dirname, "src", "index.html"));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- IPC
ipcMain.handle("license:validate", async (_evt, { email, productKey }) => {
  const result = await validateLicense(email, productKey);
  if (result.ok) {
    setCachedLicense({ email, product_key: productKey, end_date: result.end_date });
  }
  return result;
});

ipcMain.handle("app:proceed", async () => {
  if (!mainWindow) return { ok: false, message: "No main window" };
  await mainWindow.loadFile(path.join(__dirname, "src", "app.html"));
  return { ok: true };
});

// Logout (your original channel)
ipcMain.handle("app:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
    }
    return { ok: true };
  } catch (err) {
    console.error("[MAIN] Failed during logout", err);
    return { ok: false, message: err?.message || String(err) };
  }
});

// Compatibility: also provide license:logout if your preload/UI uses that
ipcMain.handle("license:logout", async () => {
  try {
    await clearCachedLicense();
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});

// OPTIONAL: manual recheck without restarting (call from UI if desired)
ipcMain.handle("license:revalidateNow", async () => {
  const cached = await getCachedLicense();
  if (!cached?.email || !cached?.product_key) {
    if (mainWindow) await mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
    return { ok: false, message: "No cached license." };
  }
  const res = await validateLicense(cached.email, cached.product_key);
  if (res?.ok && !isExpired(res.end_date)) {
    setCachedLicense({ email: cached.email, product_key: cached.product_key, end_date: res.end_date });
    if (mainWindow) await mainWindow.loadFile(path.join(__dirname, "src", "app.html"));
    return { ok: true, message: "License valid." };
  } else {
    await clearCachedLicense();
    if (mainWindow) await mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
    return { ok: false, message: res?.message || "License invalid." };
  }
});
