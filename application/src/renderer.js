/**
 * Renderer process - UI logic
 * Simple IPC triggers - Audio recording is handled by Main process (via bundled FFmpeg)
 */

const statusIndicator = document.getElementById("status-indicator");
const statusMessage = document.getElementById("status-message");

// New Shortcut UI Elements
const shortcutBtn = document.getElementById("shortcut-trigger");
const currentKeysDisplay = document.getElementById("current-keys");
const controlsHelper = document.querySelector(".controls-helper");
const recordingText = document.getElementById("recording-text");
// const triggerModeSelect = document.getElementById("trigger-mode-select"); // Removed

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

let isRecordingHotkey = false;
let currentHotkey = "";
let availableModelsCache = [];

// Model Metadata
const MODEL_METADATA = {
  tiny: "⚡ Ultra Rápido e Leve\nResposta quase instantânea. Ideal para comandos de voz curtos e frases simples.",
  base: "⚖️ Balanceado (Padrão)\nO melhor equilíbrio para o dia a dia. Rápido o suficiente e com boa precisão para ditados gerais.",
  small:
    "🎯 Alta Precisão\nEntende nuances, sotaques e fala rápida muito melhor. Ótima escolha se o 'Base' estiver errando.",
  medium:
    "🧠 Qualidade Profissional\nTranscrição extremamente detalhada e fiel. Ideal para textos longos, artigos ou conteúdo técnico complexo.",
  "large-v3-turbo":
    "🚀 Inteligência Máxima\nO modelo mais avançado disponível. Capacidade de compreensão superior, quase humana.",
};

function getModelDescription(name) {
  // Default description if not found
  if (MODEL_METADATA[name]) return MODEL_METADATA[name];

  if (name.includes("q5"))
    return "Versão quantizada (mais leve) do modelo. Menor consumo de memória.";
  if (name.includes(".en"))
    return "Modelo otimizado apenas para o idioma Inglês.";

  return "Modelo de transcrição Whisper.";
}

// Initialize
async function init() {
  const loadingScreen = document.getElementById("loading-screen");

  const config = await window.api.getConfig();
  console.log("Renderer: Received config:", config);
  console.log("Renderer: preHeatMicrophone =", config.preHeatMicrophone);

  const permissions = await checkAndShowPermissions();

  // Warm up microphone for instant recording (if permissions granted AND enabled)
  if (permissions.microphone && config.preHeatMicrophone !== false) {
    await warmUpMicrophone();
  }

  currentHotkey = config.hotkey;
  updateHotkeyDisplay(config.hotkey);

  if (config.triggerMode) {
    updateSegmentUI(config.triggerMode);
  } else {
    // Default to hybrid if not set
    updateSegmentUI("hybrid");
  }

  setStatus("ready", `Pronto! Pressione o atalho para gravar`);
  log("Push to Talk iniciado e pronto.");

  // Initialize auto-launch toggle
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
        // Revert toggle on failure
        autoLaunchToggle.checked = !enabled;
      }
    });
  }

  // Initialize Pre-Heat Toggle
  if (preHeatToggle) {
    // Default to true if undefined, matching main process default
    const preHeatEnabled = config.preHeatMicrophone !== false;
    preHeatToggle.checked = preHeatEnabled;

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
        // Revert on failure
        preHeatToggle.checked = !enabled;
        log("❌ Falha ao salvar configuração", "error");
      }
    });
  }

  // Initialize Models
  await loadModels(config.model);

  // Model download progress listener
  window.api.onModelDownloadProgress((data) => {
    // UI Update logic
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
        downloadStatusText.textContent = "";

        // Finalize
        unlockModelUI();

        log(`✅ Modelo ${data.model} baixado!`);
        setStatus("ready", `Modelo ${data.model} pronto!`);

        // Refresh to update button state to "Select"
        loadModels(data.model);
      }, 1000);
    }
  });

  if (modelSelect) {
    modelSelect.addEventListener("change", (e) => {
      updateModelInfoUI(e.target.value);
    });
  }

  if (modelActionBtn) {
    modelActionBtn.addEventListener("click", handleModelAction);
  }

  // Hide loading screen with smooth transition
  if (loadingScreen) {
    loadingScreen.classList.add("hidden");
  }
}

function updateSegmentUI(activeMode) {
  const segments = document.querySelectorAll(".segment-btn");
  segments.forEach((btn) => {
    if (btn.dataset.mode === activeMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  updateHelperText(activeMode);
}

function updateHelperText(mode) {
  if (!controlsHelper) return;

  const instructions = {
    hybrid: "Toque para gravar • Segure para falar",
    toggle: "Toque para iniciar • Toque novamente para parar",
    hold: "Segure o atalho pressionado para gravar",
  };

  controlsHelper.textContent = instructions[mode] || instructions.hybrid;
}

// Event listener for segments
const segmentContainer = document.querySelector(".segmented-control");
if (segmentContainer) {
  segmentContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest(".segment-btn");
    if (!btn) return;

    const mode = btn.dataset.mode;

    // Optimistic UI update
    updateSegmentUI(mode);

    const success = await window.api.setTriggerMode(mode);
    if (success) {
      log(`🔄 Modo alterado para: ${mode}`);
    } else {
      log("❌ Falha ao alterar modo", "error");
      // Revert if needed (omitted for simplicity as it rarely fails)
    }
  });
}

async function checkAndShowPermissions() {
  const permissions = await window.api.checkPermissions();
  let allGranted = true;

  // Update Microphone Step
  if (permissions.microphone) {
    stepMic.classList.add("success");
    stepMic.querySelector(".step-icon").textContent = "✅";
    stepMic.querySelector(".step-action").classList.add("hidden");
  } else {
    stepMic.classList.remove("success");
    stepMic.querySelector(".step-icon").textContent = "🎤";
    stepMic.querySelector(".step-action").classList.remove("hidden");
    allGranted = false;
  }

  // Update Accessibility Step
  if (permissions.accessibility) {
    stepAccessibility.classList.add("success");
    stepAccessibility.querySelector(".step-icon").textContent = "✅";
    stepAccessibility.querySelector(".step-action").classList.add("hidden");
  } else {
    stepAccessibility.classList.remove("success");
    stepAccessibility.querySelector(".step-icon").textContent = "♿";
    stepAccessibility.querySelector(".step-action").classList.remove("hidden");
    allGranted = false;
  }

  if (!allGranted) {
    permissionModal.classList.remove("hidden");
    setStatus("error", "Permissões necessárias!");
  } else {
    permissionModal.classList.add("hidden");
  }

  return permissions;
}

btnOpenMic.addEventListener("click", () =>
  window.api.openSettings("microphone")
);
btnOpenAccessibility.addEventListener("click", () =>
  window.api.openSettings("accessibility")
);
btnCheckPermissions.addEventListener("click", async () => {
  const permissions = await checkAndShowPermissions();
  if (permissions.microphone && permissions.accessibility) {
    setStatus("ready", "Permissões concedidas! Pronto para uso.");
  }
});

const logsHeader = document.getElementById("logs-header");
const logsWrapper = document.querySelector(".logs-wrapper");

if (logsHeader) {
  logsHeader.addEventListener("click", (e) => {
    // Prevent toggle when clicking copy button
    if (e.target.closest("#copy-log-btn")) return;
    logsWrapper.classList.toggle("expanded");
    // Auto-scroll to bottom when opening
    if (logsWrapper.classList.contains("expanded") && logsList) {
      setTimeout(() => {
        logsList.scrollTop = logsList.scrollHeight;
      }, 300); // Wait for transition
    }
  });
}

if (copyLogBtn) {
  copyLogBtn.addEventListener("click", async () => {
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
      navigator.clipboard.writeText(formattedLogs).catch(console.error);
    }
  });
}

function updateHotkeyDisplay(hotkey) {
  const clearBtn = document.getElementById("clear-shortcut-btn");

  if (!hotkey || hotkey.trim() === "") {
    // Empty hotkey - show placeholder and hide clear button
    currentKeysDisplay.textContent = "Clique para definir";
    if (clearBtn) clearBtn.classList.add("hidden");
    return;
  }

  let displayHotkey = hotkey
    .replace("CommandOrControl", "⌘")
    .replace("RightCommand", "R-⌘")
    .replace("Command", "⌘")
    .replace("RightControl", "R-⌃")
    .replace("Control", "⌃")
    .replace("Ctrl", "⌃")
    .replace("RightShift", "R-⇧")
    .replace("Shift", "⇧")
    .replace("RightOption", "R-⌥")
    .replace("Option", "⌥")
    .replace("Alt", "⌥")
    .replace(/\+/g, " ")
    .trim();

  currentKeysDisplay.textContent = displayHotkey;

  // Show clear button when we have a valid shortcut (and not recording)
  if (clearBtn && !isRecordingHotkey) {
    clearBtn.classList.remove("hidden");
  }
}

function setStatus(state, message) {
  statusIndicator.className = "status-indicator " + state;
  statusMessage.textContent = message;
}

async function loadModels(activeModelName) {
  try {
    const models = await window.api.getModels();
    availableModelsCache = models;

    // Clear options
    modelSelect.innerHTML = "";

    models.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.name;

      // Label just shows name in drop down now, details in panel
      option.textContent = m.name;
      option.dataset.exists = m.exists;
      option.dataset.size = m.size;

      if (m.active || m.name === activeModelName) {
        option.selected = true;
      }

      modelSelect.appendChild(option);
    });

    // Initialize Info Panel
    const currentVal = modelSelect.value;
    if (currentVal) {
      updateModelInfoUI(currentVal);

      // Check if current active model exists
      const currentModel = models.find((m) => m.name === activeModelName);
      if (currentModel && !currentModel.exists) {
        log(`⚠️ Modelo '${activeModelName}' não encontrado localmente.`);
        setStatus("warning", "Modelo não instalado. Baixe para usar.");

        // Ensure UI is visible/ready
        modelInfoPanel.classList.remove("hidden");

        // Auto-scroll to model section if needed?
        // For now just ensure the status and buttons are clear.
      }
    }
  } catch (err) {
    log("Erro ao carregar modelos: " + err.message, "error");
    modelSelect.innerHTML = "<option>Erro ao carregar</option>";
  }
}

function updateModelInfoUI(modelName) {
  const model = availableModelsCache.find((m) => m.name === modelName);
  if (!model) return;

  // Show panel
  modelInfoPanel.classList.remove("hidden");

  // Description
  modelDescription.textContent = getModelDescription(modelName);

  // Button State
  const currentConfig = availableModelsCache.find((m) => m.active);
  const isActive = currentConfig && currentConfig.name === modelName;

  // Icons
  const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const currentIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

  modelActionText.style.display = "flex";
  modelActionText.style.alignItems = "center";
  modelActionText.style.gap = "6px";

  if (isActive) {
    modelActionBtn.disabled = true;
    modelActionText.innerHTML = `${currentIcon} Modelo Atual`;
    modelActionBtn.classList.remove("primary-btn"); // Standard style
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
      // Instant switch success
      log("✅ Modelo alterado com sucesso.");
      setStatus("ready", "Modelo atualizado!");

      // Refresh list to update active state
      await loadModels(modelName);
      unlockModelUI();
    }
    // If download, the progress listener will handle unlock/refresh
  } catch (err) {
    log(`❌ Erro: ${err.message}`, "error");
    setStatus("error", "Falha ao mudar modelo");
    unlockModelUI();
    downloadProgressContainer.classList.add("hidden");
  }
}

// ============================================================================
// AUDIO RECORDING (Web Audio API - Raw PCM to WAV)
// PRÉ-AQUECIMENTO: Microfone mantido ativo para gravação instantânea
// ============================================================================

let audioContext = null;
let mediaStreamSource = null;
let scriptProcessor = null;
let audioBuffers = [];
let isRecording = false; // Flag to control when to actually save audio
let warmStream = null; // Keep stream reference for cleanup
let highPassFilter = null;
let compressor = null;
let gainNode = null;

// Initialize microphone once at startup (warm it up)
async function warmUpMicrophone() {
  if (
    audioContext &&
    audioContext.state === "running" &&
    warmStream &&
    warmStream.active
  ) {
    return true; // Already warm
  }

  try {
    // List devices first to pick a specific one (avoiding 'default' which can be buggy)
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");

    // Prefer a non-default device if available
    let selectedDeviceId = "default";
    const specificMic = audioInputs.find(
      (d) => d.deviceId !== "default" && d.deviceId !== "communications"
    );

    if (specificMic) {
      selectedDeviceId = specificMic.deviceId;
      log(`🎯 Microfone selecionado: ${specificMic.label}`);
    }

    // Request microphone access with specific device
    // MELHORIA 1: Ativar filtros nativos do navegador para redução de ruído
    warmStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: selectedDeviceId },
        echoCancellation: false, // Mantém desativado (não é chamada de voz)
        noiseSuppression: true, // Ativa redução de ruído nativa
        autoGainControl: true, // Ativa controle automático de ganho
        channelCount: 1,
      },
    });

    const track = warmStream.getAudioTracks()[0];
    log(`🔥 Microfone pré-aquecido: ${track.label}`);

    // Initialize AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    // Ensure context is running
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Create MediaStreamSource
    mediaStreamSource = audioContext.createMediaStreamSource(warmStream);

    // MELHORIA 2: Filtros customizados com Web Audio API
    // Filtro passa-alta para remover ruído de baixa frequência (hum de 60Hz, chiado)
    highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = "highpass";
    highPassFilter.frequency.value = 80;
    highPassFilter.Q.value = 0.7;

    // Compressor dinâmico para normalizar volume e reduzir picos
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // MELHORIA 3: Ganho para amplificar o sinal
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.5;

    // Create ScriptProcessor (bufferSize, inputChannels, outputChannels)
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      // Only save audio when actively recording
      if (!isRecording) return;

      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);

      // Clone the data because inputBuffer is reused
      const bufferCopy = new Float32Array(inputData);
      audioBuffers.push(bufferCopy);

      // Calculate RMS for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      // Scale RMS to 0-1 range (typical voice RMS is 0.01-0.3)
      const normalizedLevel = Math.min(1, rms * 5);

      // Send to main process for overlay (throttled by script processor buffer rate)
      window.api.sendAudioLevel(normalizedLevel);
    };

    // Connect the audio processing chain:
    // Source -> HighPass -> Compressor -> Gain -> ScriptProcessor -> Destination
    mediaStreamSource.connect(highPassFilter);
    highPassFilter.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    log(`✅ Microfone pronto para gravação instantânea!`);
    return true;
  } catch (err) {
    console.error("Failed to warm up microphone:", err);
    log("❌ Erro ao pré-aquecer microfone", "error");
    return false;
  }
}

async function stopMicrophone() {
  try {
    if (warmStream) {
      warmStream.getTracks().forEach((track) => track.stop());
      warmStream = null;
    }

    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }
    // Re-create context on next warmup
    audioContext = null;
    mediaStreamSource = null;
    scriptProcessor = null;

    return true;
  } catch (err) {
    console.error("Failed to stop microphone:", err);
    return false;
  }
}

// Start recording - now instant because mic is already warm
async function startAudioRecording() {
  // If not warmed up yet, do it now (fallback)
  if (!audioContext || audioContext.state === "closed") {
    await warmUpMicrophone();
  }

  // Resume context if suspended
  if (audioContext && audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Reset buffers and start recording
  audioBuffers = [];
  isRecording = true;

  console.log(`🎤 Recording started (instant)`);
  return true;
}

async function stopAudioRecording() {
  return new Promise(async (resolve) => {
    // Stop recording immediately
    isRecording = false;

    console.log("⏹️ Recording stopped");

    // Process audio
    if (audioBuffers.length === 0) {
      resolve(null);
      return;
    }

    // Flatten buffers
    const bufferLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
    const resultBuffer = new Float32Array(bufferLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      resultBuffer.set(buf, offset);
      offset += buf.length;
    }

    // Check total silence
    let sum = 0;
    for (let i = 0; i < resultBuffer.length; i++) {
      sum += resultBuffer[i] * resultBuffer[i];
    }
    const avgRms = Math.sqrt(sum / resultBuffer.length);
    log(`📊 Volume Médio: ${avgRms.toFixed(4)}`);

    if (avgRms < 0.001) {
      log("⚠️ ALERTA: Áudio praticamente silêncio absoluto!");
    }

    // Downsample to 16000Hz (required by whisper)
    const targetSampleRate = 16000;
    const downsampledBuffer = downsampleBuffer(
      resultBuffer,
      audioContext.sampleRate,
      targetSampleRate
    );

    // Encode to WAV (16-bit Mono)
    const wavBuffer = encodeWAV(downsampledBuffer, targetSampleRate);

    // Keep context warm for next recording (don't close it)
    audioBuffers = [];

    // CP: Check config to see if we should cool down
    // We need to fetch fresh config or check toggle state
    // Since we are in renderer, we can check toggle directly
    if (preHeatToggle && !preHeatToggle.checked) {
      await stopMicrophone();
    }

    resolve(wavBuffer);
  });
}

// Downsample/Resample function
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
  if (outSampleRate === sampleRate) return buffer;
  if (outSampleRate > sampleRate) return buffer;

  const sampleRateRatio = sampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count === 0 ? 0 : accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// WAV Encoder
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  floatTo16BitPCM(view, 44, samples);

  return buffer;
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// State for modifiers
const heldModifiers = new Set();
let pendingHotkey = null;

function updateHeldModifiers(event) {
  const code = event.code;
  if (event.type === "keydown") {
    if (code === "MetaLeft") heldModifiers.add("Command");
    if (code === "MetaRight") heldModifiers.add("RightCommand");
    if (code === "ControlLeft") heldModifiers.add("Control");
    if (code === "ControlRight") heldModifiers.add("RightControl");
    if (code === "AltLeft") heldModifiers.add("Option");
    if (code === "AltRight") heldModifiers.add("RightOption");
    if (code === "ShiftLeft") heldModifiers.add("Shift");
    if (code === "ShiftRight") heldModifiers.add("RightShift");
  } else if (event.type === "keyup") {
    if (code === "MetaLeft") heldModifiers.delete("Command");
    if (code === "MetaRight") heldModifiers.delete("RightCommand");
    if (code === "ControlLeft") heldModifiers.delete("Control");
    if (code === "ControlRight") heldModifiers.delete("RightControl");
    if (code === "AltLeft") heldModifiers.delete("Option");
    if (code === "AltRight") heldModifiers.delete("RightOption");
    if (code === "ShiftLeft") heldModifiers.delete("Shift");
    if (code === "ShiftRight") heldModifiers.delete("RightShift");

    // Safety clear if no meta keys are pressed according to event
    if (!event.metaKey) {
      heldModifiers.delete("Command");
      heldModifiers.delete("RightCommand");
    }
    if (!event.ctrlKey) {
      heldModifiers.delete("Control");
      heldModifiers.delete("RightControl");
    }
    if (!event.altKey) {
      heldModifiers.delete("Option");
      heldModifiers.delete("RightOption");
    }
    if (!event.shiftKey) {
      heldModifiers.delete("Shift");
      heldModifiers.delete("RightShift");
    }
  }
}

function getEventDisplayString(event) {
  const parts = [];

  // Use our held modifiers tracker if possible for better display
  if (heldModifiers.size > 0) {
    if (heldModifiers.has("Command")) parts.push("⌘");
    if (heldModifiers.has("RightCommand")) parts.push("R-⌘");
    if (heldModifiers.has("Control")) parts.push("⌃");
    if (heldModifiers.has("RightControl")) parts.push("R-⌃");
    if (heldModifiers.has("Option")) parts.push("⌥");
    if (heldModifiers.has("RightOption")) parts.push("R-⌥");
    if (heldModifiers.has("Shift")) parts.push("⇧");
    if (heldModifiers.has("RightShift")) parts.push("R-⇧");
  } else {
    // Fallback
    if (event.ctrlKey) parts.push("⌃");
    if (event.altKey) parts.push("⌥");
    if (event.shiftKey) parts.push("⇧");
    if (event.metaKey) parts.push("⌘");
  }

  const key = event.key;
  const code = event.code;

  // Don't duplicate modifiers in the "key" part
  if (!["Meta", "Control", "Shift", "Alt", "Ctrl", "Command"].includes(key)) {
    let keyName = key.toUpperCase();
    // Normalizing common keys
    if (code === "Space") keyName = "Space";
    else if (key === " ") keyName = "Space";
    else if (code.startsWith("Key")) keyName = code.replace("Key", "");
    else if (code.startsWith("Digit")) keyName = code.replace("Digit", "");

    parts.push(keyName);
  }

  return parts.join(" ");
}

function buildAcceleratorString(event) {
  const parts = [];

  // Use held modifiers if available
  if (heldModifiers.has("Command")) parts.push("Command");
  if (heldModifiers.has("RightCommand")) parts.push("RightCommand");
  if (heldModifiers.has("Control")) parts.push("Control");
  if (heldModifiers.has("RightControl")) parts.push("RightControl");
  if (heldModifiers.has("Option")) parts.push("Option");
  if (heldModifiers.has("RightOption")) parts.push("RightOption");
  if (heldModifiers.has("Shift")) parts.push("Shift");
  if (heldModifiers.has("RightShift")) parts.push("RightShift");

  // Fallback
  if (parts.length === 0) {
    if (event.metaKey) parts.push("CommandOrControl");
    if (event.ctrlKey) parts.push("Control");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
  }

  const key = event.key;
  const code = event.code;

  // Ignore if acting key itself is a modifier
  if (["Meta", "Control", "Shift", "Alt", "Ctrl", "Command"].includes(key)) {
    return parts.length > 0 ? parts.join("+") : null;
  }

  let keyName = key;
  if (code.startsWith("Key")) keyName = code.replace("Key", "");
  else if (code.startsWith("Digit")) keyName = code.replace("Digit", "");
  else if (code === "Space" || key === " ") keyName = "Space";
  else if (code.startsWith("F") && code.length <= 3) keyName = code;
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key))
    keyName = key;
  else keyName = key.toUpperCase();

  parts.push(keyName);
  return parts.join("+");
}

// Hotkey recording logic
function startRecordingHotkey() {
  if (isRecordingHotkey) return;
  isRecordingHotkey = true;
  shortcutBtn.classList.add("recording");

  // Clear previous and show waiting state
  currentKeysDisplay.classList.add("hidden");
  recordingText.textContent = "Digite o atalho...";
  recordingText.classList.remove("hidden");

  // Toggle buttons: Show Confirm (OK), Hide Clear (X)
  const confirmBtn = document.getElementById("confirm-shortcut-btn");
  const clearBtn = document.getElementById("clear-shortcut-btn");
  if (confirmBtn) confirmBtn.classList.remove("hidden");
  if (clearBtn) clearBtn.classList.add("hidden");

  // Reset pending
  pendingHotkey = null;
  heldModifiers.clear();

  window.api.setRecordingHotkey(true);
}

function stopRecordingHotkey(save = true) {
  isRecordingHotkey = false;
  shortcutBtn.classList.remove("recording");

  // Restore UI
  currentKeysDisplay.classList.remove("hidden");
  recordingText.classList.add("hidden");

  // Hide Confirm Button
  const confirmBtn = document.getElementById("confirm-shortcut-btn");
  if (confirmBtn) confirmBtn.classList.add("hidden");

  window.api.setRecordingHotkey(false);

  // Clear held modifiers
  heldModifiers.clear();
}

// Async wrapper for stop
async function finishRecording(save = true) {
  stopRecordingHotkey(save); // Sync UI updates

  if (save && pendingHotkey) {
    currentHotkey = pendingHotkey;
    updateHotkeyDisplay(currentHotkey);

    const success = await window.api.setHotkey(currentHotkey);
    if (success) {
      setStatus("ready", "Atalho salvo!");
    } else {
      setStatus("error", "Erro ao salvar");
    }
  } else {
    // Revert display
    updateHotkeyDisplay(currentHotkey);
  }
  pendingHotkey = null;
}

shortcutBtn.addEventListener("click", (e) => {
  // Ignore if clicking the buttons
  if (e.target.closest("#clear-shortcut-btn")) return;
  if (e.target.closest("#confirm-shortcut-btn")) return;

  if (isRecordingHotkey) {
    finishRecording(true);
  } else {
    startRecordingHotkey();
  }
});

// Clear button logic
const clearBtnEl = document.getElementById("clear-shortcut-btn");
if (clearBtnEl) {
  clearBtnEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();

    // Clear backend
    currentHotkey = "";
    updateHotkeyDisplay("");
    await window.api.setHotkey("");
    setStatus("ready", "Atalho limpo. Digite o novo.");

    // Start recording immediately
    startRecordingHotkey();
  });
}

// Confirm button logic
const confirmBtnEl = document.getElementById("confirm-shortcut-btn");
if (confirmBtnEl) {
  confirmBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    finishRecording(true);
  });
}

// Global click (Blur) logic
document.addEventListener("click", (e) => {
  if (isRecordingHotkey && !shortcutBtn.contains(e.target)) {
    finishRecording(true); // Auto-save on blur
  }
});

// Capture keys
document.addEventListener("keydown", async (event) => {
  if (!isRecordingHotkey) return;

  updateHeldModifiers(event);
  event.preventDefault();
  event.stopPropagation(); // Stop bubbling

  if (event.key === "Escape") {
    // Revert
    stopRecordingHotkey(false); // False = Cancel/Revert
    return;
  }

  // Update visual text only
  const displayStr = getEventDisplayString(event);
  if (displayStr) {
    recordingText.textContent = displayStr;
  }

  // Build potential accelerator
  const accelerator = buildAcceleratorString(event);
  if (accelerator) {
    pendingHotkey = accelerator;
  }
});

document.addEventListener("keyup", (event) => {
  if (!isRecordingHotkey) return;
  updateHeldModifiers(event);
  event.preventDefault();
  event.stopPropagation();

  // On key up, we might want to "finalize" if it was a combo?
  // User said "Save when leaving edit field".
  // So we just keep updating the display.
  // Exception: If they release ALL keys, maybe show what's pending?
  // Current logic just shows what is actively PRESSED.
  // Let's stick to showing held keys.

  const displayStr = getEventDisplayString(event);
  if (displayStr) {
    recordingText.textContent = displayStr;
  } else {
    // If nothing held, show pending if exists, or prompt
    recordingText.textContent = pendingHotkey
      ? pendingHotkey.replace(/\+/g, " ")
      : "Digite...";
  }
});

// Debug log
// Log Logic
const logData = [];
const logsList = document.getElementById("debug-log-list");

function log(msg, explicitType = null) {
  let type = explicitType || "info";

  // Auto-detect type if not explicit
  if (!explicitType) {
    if (msg.includes("🎤") || msg.includes("recording")) type = "recording";
    else if (msg.includes("✅") || msg.includes("success")) type = "success";
    else if (msg.includes("❌") || msg.includes("error")) type = "error";
    else if (msg.includes("⚠️")) type = "info";
  }

  // Strip emojis for clean display
  const cleanMsg = msg.replace(/^[🎤⏹️⚠️✅📊🎯🔊❌📤🤖▶️]\s*/u, "").trim();
  const timestamp = new Date().toLocaleTimeString();

  logData.push({ timestamp, message: cleanMsg, type });

  // Render to DOM
  if (logsList) {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;

    let iconSvg = "";
    // SVG Icons
    if (type === "recording") {
      // Red Recording Dot
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>`;
    } else if (type === "success") {
      // Check
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === "error") {
      // X
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    } else {
      // Info (i)
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    entry.innerHTML = `
      <span class="log-icon">${iconSvg}</span>
      <span class="log-time">${timestamp}</span>
      <span class="log-message">${cleanMsg}</span>
    `;

    logsList.appendChild(entry);
    logsList.scrollTop = logsList.scrollHeight;
  }

  console.log(`[${type}] ${cleanMsg}`);
}

// IPC Triggers
window.api.onStartRecording(async () => {
  setStatus("recording", "Gravando...");
  log("🎤 Iniciando gravação...");
  await startAudioRecording();
});

window.api.onStopRecording(async () => {
  setStatus("ready", "Processando...");
  log("⏹️ Parando gravação...");
  const audioData = await stopAudioRecording();

  if (audioData) {
    log(`✅ Áudio gerado: ${audioData.byteLength} bytes`);
    // Show debug
    if (transcriptionContainer)
      transcriptionContainer.classList.remove("hidden");
    if (playAudioBtn) playAudioBtn.classList.remove("hidden");

    // Store for playback
    lastAudioBuffer = audioData;

    log("📤 Enviando para transcrição...");
    window.api.sendAudioForTranscription(audioData);
  } else {
    log("❌ Gravação vazia (0 bytes)");
    setStatus("error", "Gravação vazia");
  }
});

window.api.onTranscription((data) => {
  if (transcriptionContainer) transcriptionContainer.classList.remove("hidden");

  // Clean up text
  const rawText = data.text ? data.text.trim() : "";
  const lowerText = rawText.toLowerCase();

  // Noise detected by main process
  const isNoise = data.isNoise;

  if (isNoise) {
    if (transcriptionText) {
      transcriptionText.textContent = rawText;
      transcriptionText.classList.add("low-confidence");
    }
    setStatus("ready", "Nenhuma fala detectada");
    log(`⚠️ Ruído filtrado: "${rawText}" -> Exibindo mensagem amigável.`);
  } else {
    if (transcriptionText) {
      transcriptionText.textContent = rawText;
      transcriptionText.classList.remove("low-confidence");
    }
    setStatus("ready", data.message || "Copiado!");
    log(`✅ Transcrição recebida: "${rawText.substring(0, 20)}..."`);
  }

  checkAndShowPermissions();
});

// Listener for main process logs
window.api.onLog((msg) => {
  log(`🤖 Main: ${msg}`);
});

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

// Footer link - open in external browser
const footerLink = document.querySelector(".footer-link");
if (footerLink) {
  footerLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.api.openExternal(footerLink.href);
  });
}

init();
