import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import keytar from "keytar";
import "dotenv/config";
import { validateLicense, isExpired } from "./services/licenseService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRELOAD_PATH = path.resolve(__dirname, "preload.cjs");
const CACHE_PATH = path.join(__dirname, "license-cache.json");
const SERVICE_NAME = "electron-license-app";
const ACCOUNT_NAME = "license";

let mainWindow;

function createWindow(htmlPath) {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      preload: PRELOAD_PATH, // ✅ CommonJS preload file
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
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
      return data;
    }
  } catch {}

  try {
    const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (stored) return JSON.parse(stored);
  } catch {}

  return null;
}

function setCachedLicense(data) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
  } catch {}
  try {
    keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(data));
  } catch {}
}

app.whenReady().then(async () => {
  console.log("[MAIN] App starting, preload path:", PRELOAD_PATH);

  const cached = await getCachedLicense();
  const htmlToLoad =
    cached && !isExpired(cached.end_date)
      ? path.join(__dirname, "src", "app.html")
      : path.join(__dirname, "src", "index.html");

  mainWindow = createWindow(htmlToLoad);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(path.join(__dirname, "src", "index.html"));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

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

ipcMain.handle("app:logout", async () => {
  // Remove cache file if present
  try {
    if (fs.existsSync(CACHE_PATH)) {
      fs.unlinkSync(CACHE_PATH);
    }
  } catch (err) {
    console.error('[MAIN] Failed removing cache file', err);
  }

  // Remove credential from keytar
  try {
    if (keytar && typeof keytar.deletePassword === 'function') {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    }
  } catch (err) {
    console.error('[MAIN] Failed clearing keytar entry', err);
  }

  // Navigate back to the login page
  try {
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
    }
  } catch (err) {
    console.error('[MAIN] Failed loading index.html after logout', err);
  }

  return { ok: true };
});
