/**
 * Push-to-Talk (Whisper Local) - Electron Main Process
 * Entry point - orchestrates all modules
 */
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  shell,
  dialog,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import log from "electron-log";

// Module imports
import {
  loadConfig,
  store,
  checkAllPermissions,
  openSystemPreferences,
} from "./main/core.js";
import {
  createWindow,
  createTray,
  updateTrayMenu,
  getMainWindow,
  hideOverlay,
  getOverlayWindow,
  setIsExplicitQuit,
  getIsExplicitQuit,
} from "./main/ui.js";
import {
  logToRenderer,
  calculateRMS,
  handleRecordingComplete,
} from "./main/transcription.js";
import {
  startUiohook,
  registerHotkey,
  setPaused,
  setConfig,
} from "./main/hotkey.js";
import { ModelManager } from "./models.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";
log.info("App starting...");

// ============================================================================
// STATE
// ============================================================================

let CONFIG = null;
let modelManager = null;

/**
 * Validates that the selected model exists on disk.
 * Falls back to any available model, or defaults to "tiny" if none exist.
 */
async function validateSelectedModel() {
  if (!modelManager) return;

  const models = await modelManager.getModels();
  const selected = models.find((m) => m.name === CONFIG.model);

  if (selected && selected.exists) {
    log.info(`Model "${CONFIG.model}" validated successfully`);
    return;
  }

  log.warn(`Selected model "${CONFIG.model}" not found on disk`);

  // Try to find any available model
  const available = models.find((m) => m.exists);
  if (available) {
    log.info(`Falling back to available model: "${available.name}"`);
    CONFIG.model = available.name;
    store.set("model", available.name);
    return;
  }

  // No models exist, reset to default "tiny" and alert user
  log.warn("No models found on disk. Please download a model.");
  CONFIG.model = "tiny";
  store.set("model", "tiny");

  // Show alert to user
  const result = await dialog.showMessageBox({
    type: "warning",
    title: "Modelo Não Encontrado",
    message: "Nenhum modelo de transcrição encontrado",
    detail:
      "Para usar o Push to Talk, você precisa baixar um modelo. Deseja abrir as configurações para baixar agora?",
    buttons: ["Baixar Modelo", "Depois"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    // User clicked "Baixar Modelo" - show the config window
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

ipcMain.handle("get-config", () => {
  return CONFIG;
});

ipcMain.handle("transcribe-audio", async (event, audioDataArray) => {
  logToRenderer(
    `📥 Recebido áudio do renderer: ${audioDataArray.length} bytes`
  );

  if (audioDataArray.length < 1000) {
    logToRenderer("⚠️ Áudio muito curto/vazio (zero). Cancelando.");
    hideOverlay();
    return false;
  }

  const rms = calculateRMS(audioDataArray);
  logToRenderer(`📊 Energia do áudio (RMS): ${rms.toFixed(2)}`);

  const SILENCE_THRESHOLD = 1500;
  if (rms < SILENCE_THRESHOLD) {
    logToRenderer(
      `⚠️ Silêncio detectado (RMS < ${SILENCE_THRESHOLD}). Abortando.`
    );
    hideOverlay();
    return false;
  }

  try {
    const audioData = new Uint8Array(audioDataArray);
    fs.writeFileSync(CONFIG.audioFile, audioData);
    logToRenderer(`💾 Salvo em: ${CONFIG.audioFile}`);

    await handleRecordingComplete(CONFIG, modelManager);
    return true;
  } catch (err) {
    logToRenderer(`❌ Erro no handler de áudio: ${err.message}`);
    getMainWindow()?.webContents.send("status", {
      message: "Erro na transcrição",
      error: true,
    });
    return false;
  }
});

ipcMain.handle("copy-to-clipboard", (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("set-recording-hotkey", (event, recordingState) => {
  setPaused(recordingState);
});

ipcMain.handle("set-hotkey", async (event, newHotkey) => {
  try {
    CONFIG.hotkey = newHotkey;
    store.set("hotkey", newHotkey);
    store.set("triggerMode", CONFIG.triggerMode);
    store.set("language", CONFIG.language);
    store.set("autoPaste", CONFIG.autoPaste);
    store.set("model", CONFIG.model);

    log.info("Storage: Hotkey saved:", newHotkey);

    setConfig(CONFIG);
    registerHotkey();
    updateTrayMenu(CONFIG);

    return true;
  } catch (err) {
    log.error("Failed to save hotkey:", err);
    return false;
  }
});

ipcMain.handle("set-trigger-mode", async (event, mode) => {
  try {
    CONFIG.triggerMode = mode;
    store.set("triggerMode", mode);
    setConfig(CONFIG);
    log.info(`Storage: Trigger Mode set to: ${mode}`);
    return true;
  } catch (e) {
    log.error("Failed to set trigger mode:", e);
    return false;
  }
});

ipcMain.handle("set-pre-heat-microphone", async (event, enabled) => {
  try {
    CONFIG.preHeatMicrophone = enabled;
    store.set("preHeatMicrophone", enabled);
    log.info(`Storage: Pre-heat Microphone set to: ${enabled}`);
    return true;
  } catch (e) {
    log.error("Failed to set pre-heat microphone:", e);
    return false;
  }
});

ipcMain.handle("get-microphone-config", () => {
  return store.get("selectedMicrophone", null);
});

ipcMain.handle("set-microphone", async (event, deviceId) => {
  try {
    CONFIG.selectedMicrophone = deviceId;
    store.set("selectedMicrophone", deviceId);
    log.info(`Storage: Microphone set to: ${deviceId}`);
    return true;
  } catch (e) {
    log.error("Failed to set microphone:", e);
    return false;
  }
});

ipcMain.on("audio-level", (event, level) => {
  const overlayWindow = getOverlayWindow();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("audio-level", level);
  }
});

ipcMain.handle("check-permissions", async () => {
  return await checkAllPermissions();
});

ipcMain.handle("open-settings", (event, pane) => {
  openSystemPreferences(pane);
});

ipcMain.handle("get-models", async () => {
  if (!modelManager) return [];

  const models = await modelManager.getModels();
  models.sort((a, b) => {
    if (a.exists && !b.exists) return -1;
    if (!a.exists && b.exists) return 1;
    return a.name.localeCompare(b.name);
  });

  return models.map((m) => ({ ...m, active: m.name === CONFIG.model }));
});

ipcMain.handle("set-model", async (event, modelName) => {
  log.info(`Request to set model to: ${modelName}`);

  const models = await modelManager.getModels();
  const target = models.find((m) => m.name === modelName);

  if (!target) {
    throw new Error("Model not found in list");
  }

  if (!target.exists) {
    try {
      await modelManager.downloadModel(modelName, (progress) => {
        getMainWindow()?.webContents.send("model-download-progress", {
          model: modelName,
          progress,
        });
      });
    } catch (err) {
      log.error(`Failed to download model ${modelName}:`, err);
      throw err;
    }
  }

  CONFIG.model = modelName;
  store.set("model", modelName);
  return true;
});

ipcMain.handle("cancel-download-model", (event, modelName) => {
  return modelManager.cancelDownload(modelName);
});

ipcMain.handle("open-external", (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle("get-auto-launch", () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle("set-auto-launch", (event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      path: app.getPath("exe"),
    });
    store.set("autoLaunch", enabled);
    return true;
  } catch (err) {
    console.error("Failed to set auto-launch:", err);
    return false;
  }
});

// ============================================================================
// APP LIFECYCLE
// ============================================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  CONFIG = loadConfig();

  createTray(CONFIG);

  modelManager = new ModelManager(process.resourcesPath);

  // Validate that the selected model exists, fallback if not
  await validateSelectedModel();

  const perms = await checkAllPermissions();
  if (!perms.microphone) {
    log.warn("Microphone permission not granted!");
  }
  if (!perms.accessibility) {
    log.warn("Accessibility permission not granted!");
  }

  await createWindow();

  app.setAboutPanelOptions({
    applicationName: "Push to Talk",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: "© 2026 Ciro Cesar Maciel",
    credits: "Transcrição de voz 100% local e privada",
    website: "https://www.linkedin.com/in/ciromaciel/",
  });

  startUiohook(CONFIG);

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      getMainWindow()?.show();
    }
  });
});

app.on("window-all-closed", () => {
  // Don't quit on window close, keep running in tray
});

app.on("before-quit", (e) => {
  if (getIsExplicitQuit()) {
    app.isQuitting = true;
  } else {
    e.preventDefault();
    getMainWindow()?.hide();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

if (process.platform === "darwin") {
  app.dock?.hide();
}

// ============================================================================
// AUTO-UPDATER EVENTS
// ============================================================================

autoUpdater.on("checking-for-update", () => {
  log.info("Checking for update...");
});

autoUpdater.on("update-available", (info) => {
  log.info("Update available:", info);
});

autoUpdater.on("update-not-available", (info) => {
  log.info("Update not available:", info);
});

autoUpdater.on("error", (err) => {
  log.error("Error in auto-updater. " + err);
});

autoUpdater.on("download-progress", (progressObj) => {
  let logMsg = `Download speed: ${progressObj.bytesPerSecond}`;
  logMsg += ` - Downloaded ${progressObj.percent}%`;
  logMsg += ` (${progressObj.transferred}/${progressObj.total})`;
  log.info(logMsg);
});

autoUpdater.on("update-downloaded", (info) => {
  log.info("Update downloaded");

  const dialogOpts = {
    type: "info",
    buttons: ["Reiniciar", "Depois"],
    title: "Atualização Disponível",
    message:
      process.platform === "win32" ? info.releaseNotes : info.releaseName,
    detail:
      "Uma nova versão foi baixada. Reinicie o aplicativo para aplicar as atualizações.",
  };

  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});
