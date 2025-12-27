const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayApi", {
  onAudioLevel: (callback) => {
    ipcRenderer.on("audio-level", (event, level) => callback(level));
  },
  onSetMode: (callback) => {
    ipcRenderer.on("set-mode", (event, mode) => callback(mode));
  },
});
