/**
 * Core module - Configuration, Permissions, and Paths
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Store from "electron-store";
import permissions from "electron-mac-permissions";
import log from "electron-log";

const { getAuthStatus, askForMicrophoneAccess, askForAccessibilityAccess } =
  permissions;

export const store = new Store();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

export function loadConfig() {
  // Migration: Try to read old config.json once if store is empty
  const hasMigrated = store.get("migrated_from_json", false);

  if (!hasMigrated) {
    const configPath = app.isPackaged
      ? path.join(process.resourcesPath, "config.json")
      : path.join(__dirname, "..", "..", "config.json");

    if (fs.existsSync(configPath)) {
      try {
        const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

        // Migrate known keys
        if (userConfig.hotkey) store.set("hotkey", userConfig.hotkey);
        if (userConfig.triggerMode)
          store.set("triggerMode", userConfig.triggerMode);
        if (userConfig.language) store.set("language", userConfig.language);
        if (userConfig.autoPaste !== undefined)
          store.set("autoPaste", userConfig.autoPaste);
        if (userConfig.model) store.set("model", userConfig.model);
        if (userConfig.audioDevice)
          store.set("audioDevice", userConfig.audioDevice);
        if (userConfig.preHeatMicrophone !== undefined)
          store.set("preHeatMicrophone", userConfig.preHeatMicrophone);

        store.set("migrated_from_json", true);
        log.info("Migration from config.json complete");
      } catch (err) {
        log.error("Failed to migrate config.json:", err.message);
      }
    }
  }

  // Ensure defaults exist in store
  if (!store.has("preHeatMicrophone")) {
    store.set("preHeatMicrophone", true);
  }

  const config = {
    hotkey: store.get("hotkey", "CommandOrControl+Shift+Space"),
    triggerMode: store.get("triggerMode", "hybrid"),
    language: store.get("language", "pt"),
    prompt: store.get(
      "prompt",
      "A frase pode conter termos técnicos em inglês, programação e desenvolvimento de software. Pontuação e formatação corretas."
    ),
    autoPaste: store.get("autoPaste", true),
    model: store.get("model", "tiny"),
    audioDevice: store.get("audioDevice", "default"),
    preHeatMicrophone: store.get("preHeatMicrophone"),
    audioFile: path.join(app.getPath("temp"), "recording.wav"),
    audio: {
      rate: 16000,
      channels: 1,
      bits: 16,
    },
  };

  console.log("MAIN: Store Path:", store.path);
  return config;
}

// ============================================================================
// PATHS (handles both dev and packaged app)
// ============================================================================

export function getWhisperBinary() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "whisper-cli");
  }

  // Development paths
  const possiblePaths = [
    path.join(
      __dirname,
      "..",
      "..",
      "whisper.cpp",
      "build",
      "bin",
      "whisper-cli"
    ),
    path.join(__dirname, "..", "..", "whisper.cpp", "main"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return possiblePaths[0];
}

export function getWhisperModel(modelManager, config) {
  if (modelManager) {
    return modelManager.getModelPath(config.model);
  }
  // Fallback if manager not ready
  const modelName = `ggml-${config.model}.bin`;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "models", modelName);
  }
  return path.join(__dirname, "..", "..", "whisper.cpp", "models", modelName);
}

// ============================================================================
// PERMISSION CHECKS (macOS)
// ============================================================================

export async function checkMicrophonePermission() {
  if (process.platform !== "darwin") return true;

  const status = getAuthStatus("microphone");

  if (status === "authorized") {
    return true;
  }

  if (status === "not determined") {
    const granted = await askForMicrophoneAccess();
    return granted === "authorized";
  }

  return false;
}

export function checkAccessibilityPermission() {
  if (process.platform !== "darwin") return true;

  const status = getAuthStatus("accessibility");

  if (status === "authorized") {
    return true;
  }

  return false;
}

export async function checkAllPermissions() {
  const mic = await checkMicrophonePermission();
  const accessibility = checkAccessibilityPermission();

  return {
    microphone: mic,
    accessibility: accessibility,
    allGranted: mic && accessibility,
  };
}

export function openSystemPreferences(pane) {
  if (process.platform === "darwin") {
    if (pane === "microphone") {
      askForMicrophoneAccess();
    } else if (pane === "accessibility") {
      askForAccessibilityAccess();
    }
  }
}
