/**
 * Push-to-Talk (Whisper Local) - Electron Main Process
 *
 * Menu bar app with global hotkey for speech-to-text transcription.
 */

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  clipboard,
  Notification,
  systemPreferences,
  shell,
} from "electron";
import { spawn, exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import permissions from "electron-mac-permissions";
import Store from "electron-store";
const { getAuthStatus, askForMicrophoneAccess, askForAccessibilityAccess } =
  permissions;

const store = new Store();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION (loaded from config.json)
// ============================================================================

function loadConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, "config.json")
    : path.join(__dirname, "..", "config.json");

  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log("✅ Config loaded from:", configPath);
    } catch (err) {
      console.error("⚠️ Failed to parse config.json:", err.message);
    }
  } else {
    console.log("⚠️ config.json not found, using defaults");
  }

  return {
    hotkey: userConfig.hotkey || "CommandOrControl+Shift+Space",
    language: userConfig.language || "pt",
    autoPaste: userConfig.autoPaste !== false,
    model: userConfig.model || "tiny",
    audioDevice: userConfig.audioDevice || "default",
    audioFile: path.join(app.getPath("temp"), "recording.wav"),
    audio: {
      rate: 16000,
      channels: 1,
      bits: 16,
    },
  };
}

// Will be initialized after app is ready
let CONFIG = null;

// ============================================================================
// PATHS (handles both dev and packaged app)
// ============================================================================

function getWhisperBinary() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "whisper-cli");
  }

  // Development paths
  const possiblePaths = [
    path.join(__dirname, "..", "whisper.cpp", "build", "bin", "whisper-cli"),
    path.join(__dirname, "..", "whisper.cpp", "main"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return possiblePaths[0];
}

function getWhisperModel() {
  const modelName = `ggml-${CONFIG.model}.bin`;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "models", modelName);
  }
  return path.join(__dirname, "..", "whisper.cpp", "models", modelName);
}

// ============================================================================
// STATE
// ============================================================================

let mainWindow = null;
let tray = null;
let isRecording = false;

// ============================================================================
// PERMISSION CHECKS (macOS)
// ============================================================================

async function checkMicrophonePermission() {
  if (process.platform !== "darwin") return true;

  const status = getAuthStatus("microphone");
  console.log("🎤 Microphone permission status:", status);

  if (status === "authorized") {
    return true;
  }

  if (status === "not determined") {
    // Request permission
    const granted = await askForMicrophoneAccess();
    return granted === "authorized";
  }

  // denied or restricted
  return false;
}

function checkAccessibilityPermission() {
  if (process.platform !== "darwin") return true;

  const status = getAuthStatus("accessibility");
  console.log("♿ Accessibility permission status:", status);

  if (status === "authorized") {
    return true;
  }

  // If not authorized, trust status might be needed or we can prompt
  // But for simple check, 'authorized' is what we want.
  // Note: getAuthStatus for accessibility might return 'denied' even if just not enabled in preferences.
  return false;
}

async function checkAllPermissions() {
  const mic = await checkMicrophonePermission();
  const accessibility = checkAccessibilityPermission();

  return {
    microphone: mic,
    accessibility: accessibility,
    allGranted: mic && accessibility,
  };
}

function openSystemPreferences(pane) {
  if (process.platform === "darwin") {
    if (pane === "microphone") {
      askForMicrophoneAccess();
    } else if (pane === "accessibility") {
      askForAccessibilityAccess();
    }
  }
}

// ============================================================================
// TRAY ICON
// ============================================================================

function createTray() {
  // Create a simple icon (16x16 for tray)
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple colored icon if file doesn't exist
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? createDefaultIcon() : icon);
  tray.setToolTip("Push to Talk - Ready");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "🎤 Push to Talk",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => mainWindow?.show(),
    },
    {
      label: `Hotkey: ${CONFIG.hotkey}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    mainWindow?.show();
  });
}

function createDefaultIcon() {
  // Create a 16x16 icon programmatically
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const cx = size / 2;
    const cy = size / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

    if (dist < 6) {
      // Red circle
      canvas[i * 4] = 255; // R
      canvas[i * 4 + 1] = 59; // G
      canvas[i * 4 + 2] = 48; // B
      canvas[i * 4 + 3] = 255; // A
    } else {
      canvas[i * 4 + 3] = 0; // Transparent
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayIcon(recording) {
  if (!tray) return;
  tray.setToolTip(
    recording ? "Push to Talk - Recording..." : "Push to Talk - Ready"
  );
}

// ============================================================================
// WINDOW
// ============================================================================

function createWindow() {
  const defaultBounds = {
    width: 600,
    height: 700,
  };

  const bounds = store.get("windowBounds", defaultBounds);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    show: false,
    frame: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  // Save window state on resize and move
  const saveState = () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    store.set("windowBounds", bounds);
  };

  mainWindow.on("resize", saveState);
  mainWindow.on("move", saveState);

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

// ============================================================================
// AUDIO RECORDING (Web Audio API in Renderer)
// Recording is done in the renderer process, main process just coordinates
// ============================================================================

function startRecording() {
  if (isRecording) return;

  console.log("🎤 Recording started...");
  isRecording = true;
  updateTrayIcon(true);

  // Tell renderer to start recording
  mainWindow?.webContents.send("start-recording");
}

function stopRecording() {
  if (!isRecording) return;

  console.log("⏹️ Recording stopped.");
  isRecording = false;
  updateTrayIcon(false);

  // Tell renderer to stop recording and send audio
  mainWindow?.webContents.send("stop-recording");
}

// ============================================================================
// TRANSCRIPTION (whisper.cpp)
// ============================================================================

// Helper to log to both console and renderer
function logToRenderer(msg) {
  console.log(msg);
  mainWindow?.webContents.send("log", msg);
}

// ============================================================================
// TRANSCRIPTION (whisper.cpp)
// ============================================================================

async function transcribe() {
  logToRenderer("🧠 Preparando transcrição...");
  mainWindow?.webContents.send("status", {
    recording: false,
    message: "Transcrevendo...",
  });

  const startTime = Date.now();

  return new Promise((resolve) => {
    const whisperBin = getWhisperBinary();
    const whisperModel = getWhisperModel();
    logToRenderer(`🔍 Buscando modelo em: ${whisperModel}`);

    if (fs.existsSync(whisperModel)) {
      logToRenderer("✅ Arquivo de modelo encontrado.");
    } else {
      logToRenderer(`❌ Arquivo de modelo NÃO encontrado em: ${whisperModel}`);
      // Fallback: try resources root
      const fallback = path.join(
        process.resourcesPath,
        path.basename(whisperModel)
      );
      if (fs.existsSync(fallback)) {
        logToRenderer(`⚠️ Modelo encontrado na raiz: ${fallback}`);
      }
    }

    if (!fs.existsSync(whisperBin)) {
      logToRenderer(`❌ Erro: whisper-cli não encontrado em: ${whisperBin}`);
      mainWindow?.webContents.send("status", {
        message: "Error: whisper.cpp not compiled",
        error: true,
      });
      resolve(null);
      return;
    }

    // Debug: check file size
    if (fs.existsSync(CONFIG.audioFile)) {
      const stats = fs.statSync(CONFIG.audioFile);
      logToRenderer(`📁 Arquivo de áudio: ${stats.size} bytes`);
      if (stats.size < 1000) {
        logToRenderer("⚠️ Arquivo muito pequeno, provável silêncio.");
      }
    } else {
      logToRenderer("❌ Arquivo de áudio não encontrado!");
      resolve(null);
      return;
    }

    const args = [
      "-m",
      whisperModel,
      "-f",
      CONFIG.audioFile,
      "-l",
      CONFIG.language,
      "-nt",
      "--no-prints",
    ];

    logToRenderer(
      `🚀 Executando: ${whisperBin} -m ${path.basename(whisperModel)} ...`
    );

    const proc = spawn(whisperBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      logToRenderer(`❌ Falha ao iniciar processo: ${err.message}`);
      mainWindow?.webContents.send("status", {
        message: "Error: Failed to run whisper",
        error: true,
      });
      resolve(null);
    });

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logToRenderer(`⏱️ Tempo: ${elapsed}s, Código: ${code}`);

      if (code !== 0) {
        logToRenderer(`❌ Whisper falhou. Stderr: ${stderr}`);
        resolve(null);
        return;
      }

      const text = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .trim();

      if (!text) {
        logToRenderer("⚠️ Whisper retornou texto vazio");
        if (stderr) logToRenderer(`Stderr: ${stderr}`);
      }

      resolve(text || null);
    });
  });
}

// ============================================================================
// CLIPBOARD & PASTE
// ============================================================================

function simulatePaste() {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;
      exec(`osascript -e '${script}'`, (error) => {
        if (error) {
          console.error("Failed to paste:", error.message);
        }
        resolve();
      });
    } else if (process.platform === "win32") {
      // Windows: Use PowerShell to simulate Ctrl+V
      exec(
        "powershell -command \"$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')\"",
        resolve
      );
    } else {
      // Linux: Use xdotool
      exec("xdotool key ctrl+v", resolve);
    }
  });
}

// ============================================================================
// MAIN FLOW
// ============================================================================

async function handleRecordingComplete() {
  const text = await transcribe();

  if (text) {
    console.log("📝 Transcription:", text);

    // Copy to clipboard
    clipboard.writeText(text);

    mainWindow?.webContents.send("transcription", {
      text,
      message: "Copied to clipboard!",
    });

    // Show notification
    new Notification({
      title: "Transcription Complete",
      body: text.length > 50 ? text.substring(0, 50) + "..." : text,
    }).show();

    // Auto-paste
    if (CONFIG.autoPaste) {
      await new Promise((r) => setTimeout(r, 100));
      await simulatePaste();
    }
  } else {
    mainWindow?.webContents.send("status", {
      message: "No transcription (audio too short or unclear)",
      error: true,
    });
  }

  setTimeout(() => {
    mainWindow?.webContents.send("status", {
      message: `Ready! Press ${CONFIG.hotkey} to start`,
    });
  }, 2000);
}

// ============================================================================
// GLOBAL HOTKEY (Toggle Mode)
// ============================================================================

function registerHotkey() {
  globalShortcut.unregisterAll();

  const registered = globalShortcut.register(CONFIG.hotkey, async () => {
    if (!isRecording) {
      // Start recording
      startRecording();
    } else {
      // Stop recording and transcribe
      await stopRecording();
      await handleRecordingComplete();
    }
  });

  if (!registered) {
    console.error("Failed to register hotkey:", CONFIG.hotkey);
    mainWindow?.webContents.send("status", {
      message: `Failed to register hotkey: ${CONFIG.hotkey}`,
      error: true,
    });
  } else {
    console.log("Hotkey registered:", CONFIG.hotkey);
  }
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

ipcMain.handle("get-config", () => {
  return {
    hotkey: CONFIG.hotkey,
    autoPaste: CONFIG.autoPaste,
    language: CONFIG.language,
  };
});

// Handle audio data from renderer and transcribe
ipcMain.handle("transcribe-audio", async (event, audioDataArray) => {
  logToRenderer(
    `📥 Recebido áudio do renderer: ${audioDataArray.length} bytes`
  );

  try {
    // Convert array back to buffer
    const audioData = new Uint8Array(audioDataArray);

    // Write WAV file directly (renderer already encoded it)
    fs.writeFileSync(CONFIG.audioFile, audioData);
    logToRenderer(`💾 Salvo em: ${CONFIG.audioFile}`);

    // Transcribe
    await handleRecordingComplete();

    return true;
  } catch (err) {
    logToRenderer(`❌ Erro no handler de áudio: ${err.message}`);
    mainWindow?.webContents.send("status", {
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

// Temporarily disable hotkey while user is recording a new one
ipcMain.handle("set-recording-hotkey", (event, isRecording) => {
  if (isRecording) {
    globalShortcut.unregisterAll();
    console.log("⏸️ Hotkey temporarily disabled for recording");
  } else {
    registerHotkey();
    console.log("▶️ Hotkey re-enabled");
  }
});

// Set new hotkey and save to config
ipcMain.handle("set-hotkey", async (event, newHotkey) => {
  try {
    // Update config
    CONFIG.hotkey = newHotkey;

    // Save to config.json
    const configPath = app.isPackaged
      ? path.join(process.resourcesPath, "config.json")
      : path.join(__dirname, "..", "config.json");

    const configData = {
      hotkey: newHotkey,
      language: CONFIG.language,
      autoPaste: CONFIG.autoPaste,
      model: CONFIG.model,
    };

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    console.log("💾 Config saved:", configPath);

    // Re-register with new hotkey
    registerHotkey();

    // Update tray menu
    if (tray) {
      const contextMenu = Menu.buildFromTemplate([
        { label: "🎤 Push to Talk", enabled: false },
        { type: "separator" },
        { label: "Show Window", click: () => mainWindow?.show() },
        { label: `Hotkey: ${newHotkey}`, enabled: false },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]);
      tray.setContextMenu(contextMenu);
    }

    return true;
  } catch (err) {
    console.error("Failed to save hotkey:", err);
    return false;
  }
});

// Permission handlers
ipcMain.handle("check-permissions", async () => {
  return await checkAllPermissions();
});

ipcMain.handle("open-settings", (event, pane) => {
  openSystemPreferences(pane);
});

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(async () => {
  // Load configuration from config.json
  CONFIG = loadConfig();
  console.log(`🎯 Hotkey: ${CONFIG.hotkey}`);
  console.log(`🌐 Language: ${CONFIG.language}`);
  console.log(`📋 Auto-paste: ${CONFIG.autoPaste}`);
  console.log(`🔊 Audio device: ${CONFIG.audioDevice}`);

  // Check permissions on startup
  const permissions = await checkAllPermissions();

  if (!permissions.microphone) {
    console.log("⚠️ Microphone permission not granted!");
  }
  if (!permissions.accessibility) {
    console.log("⚠️ Accessibility permission not granted!");
  }

  createWindow();
  createTray();
  registerHotkey();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  // Don't quit on window close, keep running in tray
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Handle macOS dock
if (process.platform === "darwin") {
  app.dock?.hide();
}
