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
  shell,
  screen,
  dialog,
} from "electron";
import { spawn, exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import permissions from "electron-mac-permissions";
import Store from "electron-store";
import pkg from "uiohook-napi";
const { uIOhook, UiohookKey } = pkg;
const uiohook = uIOhook;
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import log from "electron-log";

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";
log.info("App starting...");
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
      // console.log("✅ Config loaded from:", configPath);
    } catch (err) {
      console.error("⚠️ Failed to parse config.json:", err.message);
    }
  } else {
    // console.log("⚠️ config.json not found, using defaults");
  }

  return {
    hotkey: userConfig.hotkey || "CommandOrControl+Shift+Space",
    triggerMode: userConfig.triggerMode || "hybrid", // hybrid, toggle, hold
    language: userConfig.language || "pt",
    prompt:
      userConfig.prompt ||
      "A frase pode conter termos técnicos em inglês, programação e desenvolvimento de software. Pontuação e formatação corretas.",
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
let overlayWindow = null;
let isRecording = false;

// Hybrid PTT State
let pressedKeys = new Set();
let recordingStartTime = 0;
let isLatched = false; // true if "Tapped" (latched on), false if "Holding"
let isPaused = false; // To pause listener (e.g. when recording hotkey in UI)

// ============================================================================
// PERMISSION CHECKS (macOS)
// ============================================================================

async function checkMicrophonePermission() {
  if (process.platform !== "darwin") return true;

  const status = getAuthStatus("microphone");
  // console.log("🎤 Microphone permission status:", status);

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
  // console.log("♿ Accessibility permission status:", status);

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
// TRAY ICON - Tabler Icons PNG
// ============================================================================

// Create tray icon from PNG file
function createTrayIcon(isRecording = false) {
  // Use the ear icon PNG for tray
  const iconPath = path.join(__dirname, "assets", "icons", "message-2.png");

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    // Resize to 16x16 for tray (standard size)
    icon = icon.resize({ width: 16, height: 16 });
  } else {
    // Fallback: create a simple circle icon
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
      if (dist < 6) {
        canvas[i * 4] = isRecording ? 255 : 0;
        canvas[i * 4 + 1] = isRecording ? 59 : 0;
        canvas[i * 4 + 2] = isRecording ? 48 : 0;
        canvas[i * 4 + 3] = 255;
      }
    }
    icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  // Template image for macOS (auto adapts to dark/light mode) - only for idle
  if (!isRecording && process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  return icon;
}

// Build the tray context menu
function buildTrayMenu() {
  const hotkeyDisplay = CONFIG.hotkey
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
    {
      label: isRecording ? "● Gravando..." : "○ Pronto",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Abrir Configurações",
      accelerator: "CmdOrCtrl+,",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    // {
    //   label: `Iniciar Gravação   ${hotkeyDisplay}`,
    //   enabled: !isRecording,
    //   click: () => {
    //     if (!isRecording) {
    //       startRecording();
    //     }
    //   },
    // },
    { type: "separator" },
    {
      label: "Sobre Push to Talk",
      click: () => {
        app.showAboutPanel();
      },
    },
    { type: "separator" },
    {
      label: "Sair",
      accelerator: "CmdOrCtrl+Q",
      click: () => app.quit(),
    },
  ]);
}

function createTray() {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip("Push to Talk");
  tray.setContextMenu(buildTrayMenu());

  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function updateTrayIcon(recording) {
  if (!tray) return;

  tray.setImage(createTrayIcon(recording));
  tray.setToolTip(recording ? "Push to Talk – Gravando..." : "Push to Talk");
  tray.setContextMenu(buildTrayMenu());
}

// ============================================================================
// WINDOW
// ============================================================================

function createWindow() {
  const defaultBounds = {
    width: 420,
    height: 630,
  };

  const bounds = store.get("windowBounds", defaultBounds);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 420,
    minHeight: 630,
    resizable: true,
    maximizable: false,
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

  // console.log("🎤 Recording started...");
  isRecording = true;
  updateTrayIcon(true);
  showOverlay();

  // Tell renderer to start recording
  mainWindow?.webContents.send("start-recording");
}

function stopRecording() {
  if (!isRecording) return;

  // console.log("⏹️ Recording stopped.");
  isRecording = false;
  updateTrayIcon(false);
  hideOverlay();

  // Tell renderer to stop recording and send audio
  mainWindow?.webContents.send("stop-recording");
}

// ============================================================================
// OVERLAY VISUALIZER
// ============================================================================

function createOverlayWindow(x, y) {
  const overlayWidth = 120;
  const overlayHeight = 56;

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: x - overlayWidth / 2,
    y: y - overlayHeight - 10, // Position above cursor
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    show: false, // Don't show immediately - prevents focus steal
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Set floating level to stay on top without stealing focus
  if (process.platform === "darwin") {
    overlayWindow.setAlwaysOnTop(true, "floating");
  }

  // Load file then show without taking focus
  overlayWindow.loadFile(path.join(__dirname, "overlay-visualizer.html"));
  overlayWindow.once("ready-to-show", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive(); // Show without stealing focus
    }
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function showOverlay() {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);

  // Ensure overlay stays within screen bounds
  let x = cursorPoint.x;
  let y = cursorPoint.y;

  const overlayWidth = 120;
  const overlayHeight = 56;

  // Adjust if too close to edges
  if (x - overlayWidth / 2 < display.bounds.x) {
    x = display.bounds.x + overlayWidth / 2;
  }
  if (x + overlayWidth / 2 > display.bounds.x + display.bounds.width) {
    x = display.bounds.x + display.bounds.width - overlayWidth / 2;
  }
  if (y - overlayHeight - 10 < display.bounds.y) {
    y = cursorPoint.y + overlayHeight + 10; // Show below cursor instead
  }

  createOverlayWindow(x, y);
}

function hideOverlay() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

// ============================================================================
// TRANSCRIPTION (whisper.cpp)
// ============================================================================

// Helper to log to both console and renderer
function logToRenderer(msg) {
  // console.log(msg);
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
      "--prompt",
      CONFIG.prompt,
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
// DIRECT TEXT INSERTION (no clipboard)
// ============================================================================

/**
 * Types text directly into the active text field without using clipboard.
 * This inserts the text character by character using system automation.
 */
function typeText(text) {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      // macOS: Use AppleScript to type text directly
      // Escape special characters for AppleScript
      const escapedText = text
        .replace(/\\/g, "\\\\") // Escape backslashes first
        .replace(/"/g, '\\"') // Escape double quotes
        .replace(/\n/g, '" & return & "'); // Handle newlines

      const script = `
        tell application "System Events"
          keystroke "${escapedText}"
        end tell
      `;
      exec(`osascript -e '${script}'`, (error) => {
        if (error) {
          console.error("Failed to type text:", error.message);
          // Fallback: try clipboard method
          clipboard.writeText(text);
          exec(
            `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
            resolve
          );
        } else {
          resolve();
        }
      });
    } else if (process.platform === "win32") {
      // Windows: Use PowerShell to type text
      // Escape special characters for PowerShell
      const escapedText = text
        .replace(/'/g, "''")
        .replace(/`/g, "``")
        .replace(/\$/g, "`$");
      exec(
        `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')"`,
        (error) => {
          if (error) {
            console.error("Failed to type text:", error.message);
            // Fallback: clipboard method
            clipboard.writeText(text);
            exec(
              "powershell -command \"$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')\"",
              resolve
            );
          } else {
            resolve();
          }
        }
      );
    } else {
      // Linux: Use xdotool to type text
      // Escape special characters for shell
      const escapedText = text.replace(/'/g, "'\\''");
      exec(`xdotool type -- '${escapedText}'`, (error) => {
        if (error) {
          console.error("Failed to type text:", error.message);
          // Fallback: clipboard method
          clipboard.writeText(text);
          exec("xdotool key ctrl+v", resolve);
        } else {
          resolve();
        }
      });
    }
  });
}

// ============================================================================
// MAIN FLOW
// ============================================================================

async function handleRecordingComplete() {
  const text = await transcribe();

  if (text) {
    // Noise filtering
    const lowerText = text.toLowerCase();
    const noisePatterns = [
      "[música de fundo]",
      "[fundo]",
      "[music]",
      "(music)",
      "[silence]",
      "[silêncio]",
      "...",
    ];

    const isNoise = noisePatterns.some((pattern) =>
      lowerText.includes(pattern)
    );

    if (isNoise) {
      logToRenderer(`⚠️ Ruído ignorado: "${text}"`);
      mainWindow?.webContents.send("transcription", {
        text: "Não consegui ouvir. Tente novamente.",
        isNoise: true,
      });
      // Do NOT copy to clipboard or show system notification
    } else {
      // Valid transcription
      // console.log("📝 Transcription:", text);

      mainWindow?.webContents.send("transcription", {
        text,
        message: "Texto inserido!",
      });

      // Show notification
      new Notification({
        title: "Transcrição Completa",
        body: text.length > 50 ? text.substring(0, 50) + "..." : text,
      }).show();

      // Insert text directly into active text field (no clipboard)
      await new Promise((r) => setTimeout(r, 100));
      await typeText(text);
    }
  } else {
    mainWindow?.webContents.send("status", {
      message: "Opa, não consegui te ouvir!",
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

// ============================================================================
// GLOBAL HOTKEY (Hybrid: Tap to Toggle / Hold to PTT)
// ============================================================================

// Map Electron Accelerator strings to Uiohook Keycodes
const KEY_MAP = {
  Space: UiohookKey.Space,
  Enter: UiohookKey.Enter,
  Escape: UiohookKey.Escape,
  Tab: UiohookKey.Tab,
  Backspace: UiohookKey.Backspace,

  // Navigation
  Home: UiohookKey.Home,
  End: UiohookKey.End,
  PageUp: UiohookKey.PageUp,
  PageDown: UiohookKey.PageDown,
  Delete: UiohookKey.Delete,
  Insert: UiohookKey.Insert,

  // Arrow Keys
  ArrowUp: UiohookKey.ArrowUp,
  ArrowDown: UiohookKey.ArrowDown,
  ArrowLeft: UiohookKey.ArrowLeft,
  ArrowRight: UiohookKey.ArrowRight,

  // F-Keys
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,

  // Modifiers (Check both Left and Right)
  CommandOrControl: [
    UiohookKey.Meta,
    UiohookKey.MetaRight,
    UiohookKey.Ctrl,
    UiohookKey.CtrlRight,
  ],
  // Legacy/Generic (matches either)
  Command: [UiohookKey.Meta, UiohookKey.MetaRight],
  Control: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  Option: [UiohookKey.Alt, UiohookKey.AltRight],

  // Specific Left/Right
  RightCommand: UiohookKey.MetaRight,
  RightControl: UiohookKey.CtrlRight,
  RightShift: UiohookKey.ShiftRight,
  RightOption: UiohookKey.AltRight,
  RightAlt: UiohookKey.AltRight,

  LeftCommand: UiohookKey.Meta,
  LeftControl: UiohookKey.Ctrl,
  LeftShift: UiohookKey.Shift,
  LeftOption: UiohookKey.Alt,
  LeftAlt: UiohookKey.Alt,
};

// Helper: Check if hotkey is currently pressed
function isHotkeyPressed() {
  const keys = CONFIG.hotkey.split("+");

  for (const k of keys) {
    const mapped =
      KEY_MAP[k] ||
      KEY_MAP[k.toUpperCase()] ||
      UiohookKey[k.length === 1 ? k.toUpperCase() : k];

    // If mapped to array (modifiers), check if ANY is pressed
    if (Array.isArray(mapped)) {
      if (!mapped.some((code) => pressedKeys.has(code))) return false;
    } else if (mapped) {
      if (!pressedKeys.has(mapped)) return false;
    } else {
      // Fallback for single letters like 'A', 'B'
      if (k.length === 1) {
        const charCode = UiohookKey[k.toUpperCase()];
        if (charCode && !pressedKeys.has(charCode)) return false;
      }
    }
  }
  return true;
}

function startUiohook() {
  uiohook.on("input", (e) => {
    if (isPaused) return;

    if (e.type === 4) {
      // KeyDown
      pressedKeys.add(e.keycode);

      if (isHotkeyPressed()) {
        if (!isRecording) {
          // Start Logic
          // console.log(
          //   `⚡ Hotkey Pressed (${CONFIG.triggerMode}) -> Starting...`
          // );
          startRecording();
          recordingStartTime = Date.now();
          isLatched = false; // Initially assume holding, will confirm on release
        } else if (
          isLatched &&
          (CONFIG.triggerMode === "hybrid" || CONFIG.triggerMode === "toggle")
        ) {
          // Already recording and was latched (Toggle Mode) -> User pressed again to Stop
          // 'hold' mode does not use latching, so it shouldn't hit this if logic is correct,
          // but effectively pressing again in 'hold' mode while recording is just continuing to hold
          // console.log(
          //   "⚡ Hotkey PRESSED (Latched) -> Stopping (Toggle Off)..."
          // );
          stopRecording();
          // handleRecordingComplete is called by transcribe-audio handler when renderer sends audio
          isLatched = false;
        } else if (CONFIG.triggerMode === "toggle") {
          // In toggle mode, if we are recording (even if not latched, though it should always be latched in toggle)
          // we stop.
          // console.log("⚡ Hotkey PRESSED (Toggle) -> Stopping...");
          stopRecording();
          // handleRecordingComplete is called by transcribe-audio handler when renderer sends audio
        }
      }
    } else if (e.type === 5) {
      // KeyUp
      // If we were pressing the hotkey, check if we are releasing it
      const wasPressed = isHotkeyPressed();
      pressedKeys.delete(e.keycode);
      const isPressedNow = isHotkeyPressed();

      // If it WAS pressed and NOW is NOT (meaning we just released the hotkey combo or part of it)
      // AND we are recording...
      if (wasPressed && !isPressedNow && isRecording) {
        const duration = Date.now() - recordingStartTime;

        if (CONFIG.triggerMode === "toggle") {
          // Toggle mode: Ignore KeyUp. We stop only on next KeyDown.
          // ensure we mark as latched just in case
          isLatched = true;
        } else if (CONFIG.triggerMode === "hold") {
          // Hold mode: Always stop on release
          // console.log(`⚡ Release (Hold Mode) -> Stopping...`);
          stopRecording();
          // handleRecordingComplete is called by transcribe-audio handler when renderer sends audio
        } else {
          // Hybrid Mode (Default)
          if (!isLatched) {
            if (duration < 500) {
              // Short press (< 500ms) -> LATCH IT (Toggle Mode)
              // console.log(`⚡ Short Press (${duration}ms) -> Latching ON`);
              isLatched = true;
            } else {
              // Long press (> 500ms) -> STOP (PTT Mode)
              // console.log(
              //   `⚡ Long Press (${duration}ms) -> Stopping (PTT Release)...`
              // );
              stopRecording();
              // handleRecordingComplete is called by transcribe-audio handler when renderer sends audio
            }
          }
        }
      }
    }
  });

  uiohook.start();
  // console.log("Hooks started");
}

function registerHotkey() {
  // We don't use globalShortcut anymore for the triggering
  // But we start the hook if not started
  // We can restart/configure logic here if needed
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

ipcMain.handle("get-config", () => {
  return {
    hotkey: CONFIG.hotkey,
    triggerMode: CONFIG.triggerMode,
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
ipcMain.handle("set-recording-hotkey", (event, recordingState) => {
  if (recordingState) {
    isPaused = true;
    // console.log("⏸️ Hotkey temporarily disabled for recording");
  } else {
    isPaused = false;
    // console.log("▶️ Hotkey re-enabled");
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
      triggerMode: CONFIG.triggerMode, // preserve
      language: CONFIG.language,
      autoPaste: CONFIG.autoPaste,
      model: CONFIG.model,
    };

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    // console.log("💾 Config saved:", configPath);

    // Re-register with new hotkey
    registerHotkey();

    // Update tray menu
    if (tray) {
      tray.setContextMenu(buildTrayMenu());
    }

    return true;
  } catch (err) {
    console.error("Failed to save hotkey:", err);
    return false;
  }
});

// Set trigger mode
ipcMain.handle("set-trigger-mode", async (event, mode) => {
  try {
    CONFIG.triggerMode = mode;
    // console.log(`🔄 Trigger Mode set to: ${mode}`);

    const configPath = app.isPackaged
      ? path.join(process.resourcesPath, "config.json")
      : path.join(__dirname, "..", "config.json");

    const configData = {
      hotkey: CONFIG.hotkey,
      triggerMode: CONFIG.triggerMode,
      language: CONFIG.language,
      autoPaste: CONFIG.autoPaste,
      model: CONFIG.model,
    };

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

    return true;
  } catch (e) {
    console.error("Failed to set trigger mode:", e);
    return false;
  }
});

// Audio level forwarding to overlay
ipcMain.on("audio-level", (event, level) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("audio-level", level);
  }
});

// Permission handlers
ipcMain.handle("check-permissions", async () => {
  return await checkAllPermissions();
});

ipcMain.handle("open-settings", (event, pane) => {
  openSystemPreferences(pane);
});

ipcMain.handle("open-external", (event, url) => {
  shell.openExternal(url);
});

// ============================================================================
// AUTO-LAUNCH (Login Item Settings)
// Works on macOS, Windows, and Linux
// ============================================================================

ipcMain.handle("get-auto-launch", () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});

ipcMain.handle("set-auto-launch", (event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS specific: open hidden (minimized to tray)
      openAsHidden: true,
      // Windows/Linux: path to the executable
      path: app.getPath("exe"),
    });

    // Save preference to store for persistence across updates
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

app.whenReady().then(async () => {
  // Load configuration from config.json
  CONFIG = loadConfig();
  // console.log("Hotkey registered:", CONFIG.hotkey);
  // console.log(`🎯 Hotkey: ${CONFIG.hotkey}`);
  // console.log(`🎮 Mode: ${CONFIG.triggerMode}`);
  // console.log(`🌐 Language: ${CONFIG.language}`);
  // console.log(`📋 Auto-paste: ${CONFIG.autoPaste}`);
  // console.log(`🔊 Audio device: ${CONFIG.audioDevice}`);

  // Check permissions on startup
  const permissions = await checkAllPermissions();

  if (!permissions.microphone) {
    // console.log("⚠️ Microphone permission not granted!");
  }
  if (!permissions.accessibility) {
    // console.log("⚠️ Accessibility permission not granted!");
  }

  createWindow();

  // Configure About Panel
  // Note: On macOS, the About icon comes from the app's .icns file (after build)
  app.setAboutPanelOptions({
    applicationName: "Push to Talk",
    applicationVersion: "1.0.0",
    version: "1.0.0",
    copyright: "© 2026 Ciro Cesar Maciel",
    credits: "Transcrição de voz 100% local e privada",
    website: "https://www.linkedin.com/in/ciromaciel/",
  });

  createTray();
  startUiohook(); // Start the global hook

  // Check for updates
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

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

// ============================================================================
// AUTO-UPDATER EVENTS
// ============================================================================

autoUpdater.on("checking-for-update", () => {
  log.info("Checking for update...");
});

autoUpdater.on("update-available", (info) => {
  log.info("Update available:", info);
  // Optionally notify user
});

autoUpdater.on("update-not-available", (info) => {
  log.info("Update not available:", info);
});

autoUpdater.on("error", (err) => {
  log.error("Error in auto-updater. " + err);
});

autoUpdater.on("download-progress", (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + " - Downloaded " + progressObj.percent + "%";
  log_message =
    log_message +
    " (" +
    progressObj.transferred +
    "/" +
    progressObj.total +
    ")";
  log.info(log_message);
});

autoUpdater.on("update-downloaded", (info) => {
  log.info("Update downloaded");

  // Create a dialog to ask the user to restart
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
