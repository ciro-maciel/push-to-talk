/**
 * Preload script - Bridge between main and renderer processes
 * Supports Web Audio API recording
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Open external link in default browser
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // Get configuration
  getConfig: () => ipcRenderer.invoke("get-config"),
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),

  // Auto-launch settings
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", enabled),

  // Hotkey management
  setHotkey: (hotkey) => ipcRenderer.invoke("set-hotkey", hotkey),
  setRecordingHotkey: (isRecording) =>
    ipcRenderer.invoke("set-recording-hotkey", isRecording),
  setTriggerMode: (mode) => ipcRenderer.invoke("set-trigger-mode", mode),
  setPreHeatMicrophone: (enabled) =>
    ipcRenderer.invoke("set-pre-heat-microphone", enabled),

  // Microphone selection
  getMicrophoneConfig: () => ipcRenderer.invoke("get-microphone-config"),
  setMicrophone: (deviceId) => ipcRenderer.invoke("set-microphone", deviceId),

  // Permission management
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  openSettings: (pane) => ipcRenderer.invoke("open-settings", pane),

  // Audio transcription (send audio data from renderer to main)
  sendAudioForTranscription: (audioData) => {
    // Convert ArrayBuffer to Buffer for IPC
    ipcRenderer.invoke(
      "transcribe-audio",
      Array.from(new Uint8Array(audioData))
    );
  },

  // Send audio level for visualizer overlay
  sendAudioLevel: (level) => {
    ipcRenderer.send("audio-level", level);
  },

  // Event listeners from main
  onStatus: (callback) =>
    ipcRenderer.on("status", (event, data) => callback(data)),
  onLog: (callback) => ipcRenderer.on("log", (event, msg) => callback(msg)),
  onTranscription: (callback) =>
    ipcRenderer.on("transcription", (event, data) => callback(data)),

  // Recording control from main (triggered by global hotkey)
  onStartRecording: (callback) => {
    ipcRenderer.on("start-recording", () => callback());
  },

  onStopRecording: (callback) => {
    ipcRenderer.on("stop-recording", () => callback());
  },

  // Models
  getModels: () => ipcRenderer.invoke("get-models"),
  setModel: (modelName) => ipcRenderer.invoke("set-model", modelName),
  cancelDownloadModel: (modelName) =>
    ipcRenderer.invoke("cancel-download-model", modelName),

  onModelDownloadProgress: (callback) =>
    ipcRenderer.on("model-download-progress", (event, data) => callback(data)),
});
