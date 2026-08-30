"use strict";

const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const UI_PORT = 20129;
const UI_URL = `http://localhost:${UI_PORT}`;

// Projekt-Root robust finden: installierte App kennt den Pfad nicht relativ
// (app.asar), also erst env-Override, dann bekannter Pfad, dann relativer Fallback.
function findProjectRoot() {
  const candidates = [
    process.env.OMNIROUTE_UI_ROOT,
    "C:\\OmniRoute\\voice-agents",
    path.resolve(__dirname, ".."),
  ].filter(Boolean);
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, ".venv", "Scripts", "python.exe"))) return root;
  }
  return candidates[candidates.length - 1];
}

const PROJECT_ROOT = findProjectRoot();
const PYTHON = path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe");
const APP_ICON = path.join(__dirname, "assets", "icon.png");

let mainWindow = null;
let tray = null;
let uiServer = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Single instance: ein Fenster pro System
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// UI-Server (FastAPI, Port 20129) sicherstellen — selbst starten wenn down
// ---------------------------------------------------------------------------
function isServerUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      if (await isServerUp(port)) return resolve(true);
      if (Date.now() - started > timeoutMs)
        return reject(new Error(`UI-Server auf Port ${port} nicht erreichbar`));
      setTimeout(poll, 500);
    };
    poll();
  });
}

async function ensureUiServer() {
  if (await isServerUp(UI_PORT)) {
    console.log(`[desktop] UI-Server laeuft bereits auf ${UI_PORT}`);
    return;
  }
  console.log(`[desktop] Starte UI-Server (${PYTHON}) auf ${UI_PORT} ...`);
  uiServer = spawn(
    PYTHON,
    ["-m", "uvicorn", "ui.main:app", "--host", "0.0.0.0", "--port", String(UI_PORT)],
    {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      stdio: "ignore",
    }
  );
  uiServer.on("error", (err) => {
    console.error("[desktop] Fehler beim Start des UI-Servers:", err.message);
  });
  uiServer.on("exit", (code) => {
    if (!isQuitting) console.log(`[desktop] UI-Server beendet (Code ${code})`);
  });
  await waitForServer(UI_PORT);
  console.log("[desktop] UI-Server bereit.");
}

// ---------------------------------------------------------------------------
// Fenster
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0c1116",
    icon: APP_ICON,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(UI_URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Externe Links im Standard-Browser öffnen statt im Fenster
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(UI_URL) && !url.startsWith("http://localhost:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // DevTools nur im Dev-Modus (npm run dev)
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Tray (Minimize-to-tray, Show/Quit)
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromPath(APP_ICON);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("OmniRoute Control Room");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Control Room anzeigen",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: "separator" },
      {
        label: "Beenden",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// App-Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  app.setAppUserModelId("online.omniroute.controlroom");
  try {
    await ensureUiServer();
  } catch (err) {
    console.error("[desktop]", err.message);
  }
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Im Tray weiterlaufen lassen
});

app.on("before-quit", () => {
  isQuitting = true;
  if (uiServer && !uiServer.killed) {
    try {
      uiServer.kill();
    } catch {
      /* ignore */
    }
  }
});

app.on("will-quit", () => {
  if (tray) tray.destroy();
});
