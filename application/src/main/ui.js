/**
 * UI Module - Tray, Window, and Overlay management
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { store } from "./core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// STATE
// ============================================================================

let mainWindow = null;
let tray = null;
let overlayWindow = null;
let isRecording = false;
let isExplicitQuit = false;

// Callbacks for external control
let onQuitCallback = null;

export function setQuitCallback(callback) {
  onQuitCallback = callback;
}

export function getMainWindow() {
  return mainWindow;
}

export function getIsRecording() {
  return isRecording;
}

export function setIsRecording(value) {
  isRecording = value;
}

export function setIsExplicitQuit(value) {
  isExplicitQuit = value;
}

export function getIsExplicitQuit() {
  return isExplicitQuit;
}

// ============================================================================
// TRAY ICON
// ============================================================================

function createTrayIcon(recording = false) {
  const iconPath = path.join(__dirname, "..", "..", "assets", "logo.png");

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    icon = icon.resize({ width: 20, height: 20 });
  } else {
    // Fallback: create a simple circle icon
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
      if (dist < 6) {
        canvas[i * 4] = recording ? 255 : 0;
        canvas[i * 4 + 1] = recording ? 59 : 0;
        canvas[i * 4 + 2] = recording ? 48 : 0;
        canvas[i * 4 + 3] = 255;
      }
    }
    icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  if (!recording && process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  return icon;
}

export function buildTrayMenu(config) {
  const hotkeyDisplay = config.hotkey
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .replace("Option", "⌥")
    .replace(/\+/g, "");

  return Menu.buildFromTemplate([
    {
      label: "Push to Talk",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Configurações",
      accelerator: "CmdOrCtrl+,",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Verificar atualizações",
      click: () => {},
    },
    {
      label: "Sobre",
      click: () => {
        app.showAboutPanel();
      },
    },
    { type: "separator" },
    {
      label: "Fechar Push to Talk",
      click: () => {
        isExplicitQuit = true;
        if (onQuitCallback) onQuitCallback();
        app.quit();
      },
    },
  ]);
}

export function createTray(config) {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip("Push to Talk");
  tray.setContextMenu(buildTrayMenu(config));
}

export function updateTrayIcon(recording, config) {
  if (!tray) return;

  tray.setImage(createTrayIcon(recording));
  tray.setToolTip(recording ? "Push to Talk – Gravando..." : "Push to Talk");
  tray.setContextMenu(buildTrayMenu(config));
}

export function updateTrayMenu(config) {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu(config));
}

// ============================================================================
// MAIN WINDOW
// ============================================================================

export function createWindow() {
  const defaultBounds = {
    width: 420,
    height: 740,
  };

  const bounds = store.get("windowBounds", defaultBounds);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 420,
    minHeight: 740,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  const saveState = () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    store.set("windowBounds", bounds);
  };

  mainWindow.on("resize", saveState);
  mainWindow.on("move", saveState);

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  return mainWindow;
}

// ============================================================================
// OVERLAY
// ============================================================================

function createOverlayWindow(x, y) {
  const overlayWidth = 120;
  const overlayHeight = 56;

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: x - overlayWidth / 2,
    y: y - overlayHeight - 10,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.platform === "darwin") {
    overlayWindow.setAlwaysOnTop(true, "floating");
  }

  overlayWindow.loadFile(path.join(__dirname, "..", "overlay-visualizer.html"));
  overlayWindow.once("ready-to-show", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive();
    }
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

export function showOverlay() {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);

  let x = cursorPoint.x;
  let y = cursorPoint.y;

  const overlayWidth = 120;
  const overlayHeight = 56;

  if (x - overlayWidth / 2 < display.bounds.x) {
    x = display.bounds.x + overlayWidth / 2;
  }
  if (x + overlayWidth / 2 > display.bounds.x + display.bounds.width) {
    x = display.bounds.x + display.bounds.width - overlayWidth / 2;
  }
  if (y - overlayHeight - 10 < display.bounds.y) {
    y = cursorPoint.y + overlayHeight + 10;
  }

  createOverlayWindow(x, y);
}

export function hideOverlay() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

export function setOverlayMode(mode) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("set-mode", mode);
  }
}

export function getOverlayWindow() {
  return overlayWindow;
}

// ============================================================================
// RECORDING CONTROL
// ============================================================================

export function startRecording(config) {
  if (isRecording) return;

  isRecording = true;
  updateTrayIcon(true, config);
  showOverlay();
  setOverlayMode("recording");

  mainWindow?.webContents.send("start-recording");
}

export function stopRecording(config) {
  if (!isRecording) return;

  isRecording = false;
  updateTrayIcon(false, config);
  setOverlayMode("transcribing");

  mainWindow?.webContents.send("stop-recording");
}
