/**
 * Preload script - Bridge between main and renderer processes
 * Supports Web Audio API recording
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Get configuration
  getConfig: () => ipcRenderer.invoke("get-config"),
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),

  // Hotkey management
  setHotkey: (hotkey) => ipcRenderer.invoke("set-hotkey", hotkey),
  setRecordingHotkey: (isRecording) =>
    ipcRenderer.invoke("set-recording-hotkey", isRecording),
  setTriggerMode: (mode) => ipcRenderer.invoke("set-trigger-mode", mode),

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
});
