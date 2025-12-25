/**
 * Preload script for the overlay visualizer window
 * Exposes only the audio level callback API
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayApi", {
  onAudioLevel: (callback) => {
    ipcRenderer.on("audio-level", (event, level) => callback(level));
  },
});
