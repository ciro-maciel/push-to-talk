/**
 * Renderer process - Entry point
 * Imports from modular audio and UI components
 */

import {
  warmUpMicrophone,
  stopMicrophone,
  startAudioRecording,
  stopAudioRecording,
  setLogCallback,
} from "./renderer/audio.js";

import {
  log,
  initLogger,
  getLogData,
  setStatus,
  initStatusElements,
  updateHotkeyDisplay,
  updateSegmentUI,
  checkAndShowPermissions,
  updateHeldModifiers,
  clearHeldModifiers,
  getEventDisplayString,
  buildAcceleratorString,
  getModelDescription,
  MODEL_METADATA,
} from "./renderer/ui.js";

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const statusIndicator = document.getElementById("status-indicator");
const statusMessage = document.getElementById("status-message");
const shortcutBtn = document.getElementById("shortcut-trigger");
const currentKeysDisplay = document.getElementById("current-keys");
const controlsHelper = document.querySelector(".controls-helper");
const recordingText = document.getElementById("recording-text");
const copyLogBtn = document.getElementById("copy-log-btn");
const transcriptionContainer = document.getElementById(
  "transcription-container"
);
const transcriptionText = document.getElementById("transcription-text");
const playAudioBtn = document.getElementById("play-audio-btn");
const permissionModal = document.getElementById("permission-modal");
const btnOpenMic = document.getElementById("btn-open-mic-settings");
const btnOpenAccessibility = document.getElementById(
  "btn-open-accessibility-settings"
);
const btnCheckPermissions = document.getElementById("btn-check-permissions");
const stepMic = document.getElementById("step-mic");
const stepAccessibility = document.getElementById("step-accessibility");
const autoLaunchToggle = document.getElementById("auto-launch-toggle");
const preHeatToggle = document.getElementById("pre-heat-toggle");
const modelSelect = document.getElementById("model-select");
const modelInfoPanel = document.getElementById("model-info-panel");
const modelDescription = document.getElementById("model-description");
const modelActionBtn = document.getElementById("model-action-btn");
const modelActionText = document.getElementById("model-action-text");
const modelBtnSpinner = document.getElementById("model-btn-spinner");
const downloadProgressContainer = document.getElementById(
  "download-progress-container"
);
const downloadProgressBar = document.getElementById("download-progress-bar");
const downloadStatusText = document.getElementById("download-status-text");
const logsHeader = document.getElementById("logs-header");
const logsWrapper = document.querySelector(".logs-wrapper");
const logsList = document.getElementById("debug-log-list");

// ============================================================================
// STATE
// ============================================================================

let isRecordingHotkey = false;
let currentHotkey = "";
let pendingHotkey = null;
let availableModelsCache = [];
let lastAudioBuffer = null;

// Initialize UI modules
initLogger(logsList);
initStatusElements(statusIndicator, statusMessage);
setLogCallback(log);

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  const loadingScreen = document.getElementById("loading-screen");

  const config = await window.api.getConfig();
  console.log("Renderer: Received config:", config);

  const permissions = await checkAndShowPermissions(
    stepMic,
    stepAccessibility,
    permissionModal,
    setStatus
  );

  if (permissions.microphone && config.preHeatMicrophone !== false) {
    await warmUpMicrophone();
  }

  currentHotkey = config.hotkey;
  updateHotkeyDisplay(
    currentHotkey,
    currentKeysDisplay,
    document.getElementById("clear-shortcut-btn"),
    isRecordingHotkey
  );

  updateSegmentUI(config.triggerMode || "hybrid", controlsHelper);

  setStatus("ready", `Pronto! Pressione o atalho para gravar`);
  log("Push to Talk iniciado e pronto.");

  // Auto-launch toggle
  if (autoLaunchToggle) {
    const isAutoLaunch = await window.api.getAutoLaunch();
    autoLaunchToggle.checked = isAutoLaunch;

    autoLaunchToggle.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      const success = await window.api.setAutoLaunch(enabled);
      if (success) {
        log(
          enabled
            ? "✅ Inicialização automática ativada"
            : "⚠️ Inicialização automática desativada"
        );
      } else {
        log("❌ Falha ao configurar inicialização automática", "error");
        autoLaunchToggle.checked = !enabled;
      }
    });
  }

  // Pre-heat toggle
  if (preHeatToggle) {
    preHeatToggle.checked = config.preHeatMicrophone !== false;

    preHeatToggle.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      const success = await window.api.setPreHeatMicrophone(enabled);

      if (success) {
        if (enabled) {
          log("🔥 Pré-aquecimento ativado. Ligando microfone...");
          await warmUpMicrophone();
        } else {
          log("❄️ Pré-aquecimento desativado. Microfone desligado.");
          await stopMicrophone();
        }
      } else {
        preHeatToggle.checked = !enabled;
        log("❌ Falha ao salvar configuração", "error");
      }
    });
  }

  // Models
  await loadModels(config.model);

  window.api.onModelDownloadProgress((data) => {
    if (downloadProgressContainer.classList.contains("hidden")) {
      downloadProgressContainer.classList.remove("hidden");
    }

    downloadProgressBar.style.width = `${data.progress}%`;
    downloadStatusText.textContent = `Baixando ${data.model}... ${Math.round(
      data.progress
    )}%`;

    if (data.progress >= 100) {
      setTimeout(() => {
        downloadProgressContainer.classList.add("hidden");
        unlockModelUI();
        log(`✅ Modelo ${data.model} baixado!`);
        setStatus("ready", `Modelo ${data.model} pronto!`);
        loadModels(data.model);
      }, 1000);
    }
  });

  if (modelSelect) {
    modelSelect.addEventListener("change", (e) =>
      updateModelInfoUI(e.target.value)
    );
  }
  if (modelActionBtn) {
    modelActionBtn.addEventListener("click", handleModelAction);
  }

  if (loadingScreen) {
    loadingScreen.classList.add("hidden");
  }
}

// ============================================================================
// MODELS
// ============================================================================

async function loadModels(activeModelName) {
  try {
    const models = await window.api.getModels();
    availableModelsCache = models;

    modelSelect.innerHTML = "";

    models.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.name;
      option.textContent = m.name;
      option.dataset.exists = m.exists;
      option.dataset.size = m.size;

      if (m.active || m.name === activeModelName) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });

    const currentVal = modelSelect.value;
    if (currentVal) {
      updateModelInfoUI(currentVal);
    }
  } catch (err) {
    log("Erro ao carregar modelos: " + err.message, "error");
  }
}

function updateModelInfoUI(modelName) {
  const model = availableModelsCache.find((m) => m.name === modelName);
  if (!model) return;

  modelInfoPanel.classList.remove("hidden");
  modelDescription.textContent = getModelDescription(modelName);

  const currentConfig = availableModelsCache.find((m) => m.active);
  const isActive = currentConfig && currentConfig.name === modelName;

  const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const currentIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

  modelActionText.style.display = "flex";
  modelActionText.style.alignItems = "center";
  modelActionText.style.gap = "6px";

  if (isActive) {
    modelActionBtn.disabled = true;
    modelActionText.innerHTML = `${currentIcon} Modelo Atual`;
  } else if (model.exists) {
    modelActionBtn.disabled = false;
    modelActionText.innerHTML = `${checkIcon} Usar Modelo`;
  } else {
    modelActionBtn.disabled = false;
    const sizeMB =
      model.size > 0 ? ` (~${(model.size / 1024 / 1024).toFixed(0)} MB)` : "";
    modelActionText.innerHTML = `${downloadIcon} Baixar${sizeMB}`;
  }
}

function lockModelUI() {
  modelSelect.disabled = true;
  modelActionBtn.disabled = true;
  modelBtnSpinner.classList.remove("hidden");
}

function unlockModelUI() {
  modelSelect.disabled = false;
  modelActionBtn.disabled = false;
  modelBtnSpinner.classList.add("hidden");
}

async function handleModelAction() {
  const modelName = modelSelect.value;
  const model = availableModelsCache.find((m) => m.name === modelName);
  if (!model) return;

  lockModelUI();
  const needsDownload = !model.exists;

  if (needsDownload) {
    log(`⬇️ Iniciando download do modelo: ${modelName}`);
    downloadProgressContainer.classList.remove("hidden");
    downloadProgressBar.style.width = "0%";
    downloadStatusText.textContent = "Iniciando download...";
  } else {
    log(`🔄 Mudando para modelo local: ${modelName}`);
  }

  try {
    await window.api.setModel(modelName);
    if (!needsDownload) {
      log("✅ Modelo alterado com sucesso.");
      setStatus("ready", "Modelo atualizado!");
      await loadModels(modelName);
      unlockModelUI();
    }
  } catch (err) {
    log(`❌ Erro: ${err.message}`, "error");
    setStatus("error", "Falha ao mudar modelo");
    unlockModelUI();
    downloadProgressContainer.classList.add("hidden");
  }
}

// ============================================================================
// SEGMENT CONTROL
// ============================================================================

const segmentContainer = document.querySelector(".segmented-control");
if (segmentContainer) {
  segmentContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest(".segment-btn");
    if (!btn) return;

    const mode = btn.dataset.mode;
    updateSegmentUI(mode, controlsHelper);

    const success = await window.api.setTriggerMode(mode);
    if (success) {
      log(`🔄 Modo alterado para: ${mode}`);
    } else {
      log("❌ Falha ao alterar modo", "error");
    }
  });
}

// ============================================================================
// PERMISSIONS
// ============================================================================

btnOpenMic.addEventListener("click", () =>
  window.api.openSettings("microphone")
);
btnOpenAccessibility.addEventListener("click", () =>
  window.api.openSettings("accessibility")
);
btnCheckPermissions.addEventListener("click", async () => {
  const permissions = await checkAndShowPermissions(
    stepMic,
    stepAccessibility,
    permissionModal,
    setStatus
  );
  if (permissions.microphone && permissions.accessibility) {
    setStatus("ready", "Permissões concedidas! Pronto para uso.");
  }
});

// ============================================================================
// LOGS
// ============================================================================

if (logsHeader) {
  logsHeader.addEventListener("click", (e) => {
    if (e.target.closest("#copy-log-btn")) return;
    logsWrapper.classList.toggle("expanded");
    if (logsWrapper.classList.contains("expanded") && logsList) {
      setTimeout(() => {
        logsList.scrollTop = logsList.scrollHeight;
      }, 300);
    }
  });
}

if (copyLogBtn) {
  copyLogBtn.addEventListener("click", async () => {
    const logData = getLogData();
    if (logData.length === 0) return;

    const formattedLogs = logData
      .map((l) => `[${l.timestamp}] ${l.type.toUpperCase()}: ${l.message}`)
      .join("\n");

    try {
      await window.api.copyToClipboard(formattedLogs);
      const originalHtml = copyLogBtn.innerHTML;
      copyLogBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copiado!`;
      setTimeout(() => (copyLogBtn.innerHTML = originalHtml), 2000);
    } catch (err) {
      console.error("Clipboard error:", err);
    }
  });
}

// ============================================================================
// HOTKEY RECORDING
// ============================================================================

function startRecordingHotkey() {
  if (isRecordingHotkey) return;
  isRecordingHotkey = true;
  shortcutBtn.classList.add("recording");

  currentKeysDisplay.classList.add("hidden");
  recordingText.textContent = "Digite o atalho...";
  recordingText.classList.remove("hidden");

  const confirmBtn = document.getElementById("confirm-shortcut-btn");
  const clearBtn = document.getElementById("clear-shortcut-btn");
  if (confirmBtn) confirmBtn.classList.remove("hidden");
  if (clearBtn) clearBtn.classList.add("hidden");

  pendingHotkey = null;
  clearHeldModifiers();
  window.api.setRecordingHotkey(true);
}

function stopRecordingHotkey(save = true) {
  isRecordingHotkey = false;
  shortcutBtn.classList.remove("recording");

  currentKeysDisplay.classList.remove("hidden");
  recordingText.classList.add("hidden");

  const confirmBtn = document.getElementById("confirm-shortcut-btn");
  if (confirmBtn) confirmBtn.classList.add("hidden");

  window.api.setRecordingHotkey(false);
  clearHeldModifiers();
}

async function finishRecording(save = true) {
  stopRecordingHotkey(save);

  if (save && pendingHotkey) {
    currentHotkey = pendingHotkey;
    updateHotkeyDisplay(
      currentHotkey,
      currentKeysDisplay,
      document.getElementById("clear-shortcut-btn"),
      isRecordingHotkey
    );

    const success = await window.api.setHotkey(currentHotkey);
    if (success) {
      setStatus("ready", "Atalho salvo!");
    } else {
      setStatus("error", "Erro ao salvar");
    }
  } else {
    updateHotkeyDisplay(
      currentHotkey,
      currentKeysDisplay,
      document.getElementById("clear-shortcut-btn"),
      isRecordingHotkey
    );
  }
  pendingHotkey = null;
}

shortcutBtn.addEventListener("click", (e) => {
  if (e.target.closest("#clear-shortcut-btn")) return;
  if (e.target.closest("#confirm-shortcut-btn")) return;

  if (isRecordingHotkey) {
    finishRecording(true);
  } else {
    startRecordingHotkey();
  }
});

const clearBtnEl = document.getElementById("clear-shortcut-btn");
if (clearBtnEl) {
  clearBtnEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    currentHotkey = "";
    updateHotkeyDisplay("", currentKeysDisplay, clearBtnEl, isRecordingHotkey);
    await window.api.setHotkey("");
    setStatus("ready", "Atalho limpo. Digite o novo.");
    startRecordingHotkey();
  });
}

const confirmBtnEl = document.getElementById("confirm-shortcut-btn");
if (confirmBtnEl) {
  confirmBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    finishRecording(true);
  });
}

document.addEventListener("click", (e) => {
  if (isRecordingHotkey && !shortcutBtn.contains(e.target)) {
    finishRecording(true);
  }
});

document.addEventListener("keydown", async (event) => {
  if (!isRecordingHotkey) return;

  updateHeldModifiers(event);
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    stopRecordingHotkey(false);
    return;
  }

  const displayStr = getEventDisplayString(event);
  if (displayStr) recordingText.textContent = displayStr;

  const accelerator = buildAcceleratorString(event);
  if (accelerator) pendingHotkey = accelerator;
});

document.addEventListener("keyup", (event) => {
  if (!isRecordingHotkey) return;
  updateHeldModifiers(event);
  event.preventDefault();
  event.stopPropagation();

  const displayStr = getEventDisplayString(event);
  if (displayStr) {
    recordingText.textContent = displayStr;
  } else {
    recordingText.textContent = pendingHotkey
      ? pendingHotkey.replace(/\+/g, " ")
      : "Digite...";
  }
});

// ============================================================================
// IPC TRIGGERS
// ============================================================================

window.api.onStartRecording(async () => {
  setStatus("recording", "Gravando...");
  log("🎤 Iniciando gravação...");
  await startAudioRecording();
});

window.api.onStopRecording(async () => {
  setStatus("ready", "Processando...");
  log("⏹️ Parando gravação...");

  const shouldCoolDown = preHeatToggle && !preHeatToggle.checked;
  const audioData = await stopAudioRecording(shouldCoolDown);

  if (audioData) {
    log(`✅ Áudio gerado: ${audioData.byteLength} bytes`);
    if (transcriptionContainer)
      transcriptionContainer.classList.remove("hidden");
    if (playAudioBtn) playAudioBtn.classList.remove("hidden");

    lastAudioBuffer = audioData;
    log("📤 Enviando para transcrição...");
    window.api.sendAudioForTranscription(audioData);
  } else {
    log("❌ Gravação vazia (0 bytes)");
    setStatus("error", "Gravação vazia");
    // Send empty audio to main so it hides the overlay
    window.api.sendAudioForTranscription(new ArrayBuffer(0));
  }
});

window.api.onTranscription((data) => {
  if (transcriptionContainer) transcriptionContainer.classList.remove("hidden");

  const rawText = data.text ? data.text.trim() : "";
  const isNoise = data.isNoise;

  if (isNoise) {
    if (transcriptionText) {
      transcriptionText.textContent = rawText;
      transcriptionText.classList.add("low-confidence");
    }
    setStatus("ready", "Nenhuma fala detectada");
    log(`⚠️ Ruído filtrado: "${rawText}"`);
  } else {
    if (transcriptionText) {
      transcriptionText.textContent = rawText;
      transcriptionText.classList.remove("low-confidence");
    }
    setStatus("ready", data.message || "Copiado!");
    log(`✅ Transcrição recebida: "${rawText.substring(0, 20)}..."`);
  }

  checkAndShowPermissions(
    stepMic,
    stepAccessibility,
    permissionModal,
    setStatus
  );
});

window.api.onLog((msg) => {
  log(`🤖 Main: ${msg}`);
});

// Play audio button
if (playAudioBtn) {
  playAudioBtn.addEventListener("click", async () => {
    if (lastAudioBuffer) {
      log("▶️ Reproduzindo áudio...");
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(
        lastAudioBuffer.slice(0)
      );
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } else {
      log("❌ Sem áudio buffer para reproduzir");
    }
  });
}

// Footer link
const footerLink = document.querySelector(".footer-link");
if (footerLink) {
  footerLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.api.openExternal(footerLink.href);
  });
}

// Start
init();
