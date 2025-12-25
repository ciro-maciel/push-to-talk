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

let isRecordingHotkey = false;
let currentHotkey = "";

// Initialize
async function init() {
  const permissions = await checkAndShowPermissions();

  // Warm up microphone for instant recording (if permissions granted)
  if (permissions.microphone) {
    await warmUpMicrophone();
  }

  const config = await window.api.getConfig();
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
  if (permissions.allGranted) {
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
  if (!hotkey) return; // Guard against null/empty
  let displayHotkey = hotkey
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Ctrl", "⌃")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .replace("Option", "⌥")
    .replace(/\+/g, " ") // Use space separator for cleaner look
    .trim();
  currentKeysDisplay.textContent = displayHotkey;
}

function setStatus(state, message) {
  statusIndicator.className = "status-indicator " + state;
  statusMessage.textContent = message;
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

// Hotkey recording logic
function startRecordingHotkey() {
  if (isRecordingHotkey) return;
  isRecordingHotkey = true;
  shortcutBtn.classList.add("recording");

  // Clear previous and show waiting state
  currentKeysDisplay.classList.add("hidden");
  recordingText.textContent = "Digite o atalho...";
  recordingText.classList.remove("hidden");

  window.api.setRecordingHotkey(true);
}

function stopRecordingHotkey() {
  isRecordingHotkey = false;
  shortcutBtn.classList.remove("recording");
  currentKeysDisplay.classList.remove("hidden");
  recordingText.classList.add("hidden");
  // Ensure we restore the display if cancelled without saving could be handled,
  // but usually we just update to whatever currentHotkey is.
  updateHotkeyDisplay(currentHotkey);
  window.api.setRecordingHotkey(false);
}

// Helper to get display string for current event state
function getEventDisplayString(event) {
  const parts = [];
  // Standard Mac sequence: Control, Option, Shift, Command
  if (event.ctrlKey) parts.push("⌃");
  if (event.altKey) parts.push("⌥");
  if (event.shiftKey) parts.push("⇧");
  if (event.metaKey) parts.push("⌘");

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

// Helper to get Electron Accelerator string
function buildAcceleratorString(event) {
  const parts = [];
  if (event.metaKey) parts.push("CommandOrControl");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key;
  const code = event.code;

  // Ignore if only modifier is pressed for the "final" check
  if (["Meta", "Control", "Shift", "Alt", "Ctrl", "Command"].includes(key))
    return null;

  let keyName = key;
  if (code.startsWith("Key")) keyName = code.replace("Key", "");
  else if (code.startsWith("Digit")) keyName = code.replace("Digit", "");
  else if (code === "Space" || key === " ") keyName = "Space";
  else if (code.startsWith("F") && code.length <= 3) keyName = code;
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key))
    keyName = key;
  else keyName = key.toUpperCase();

  parts.push(keyName);

  // Requirement: At least one modifier OR it's a Function/Special key
  // But user asked for flexibility. Electron generally requires Modifier+Key for global shortcuts
  // unless it's like F1-F12 or Media keys.
  const hasModifier = parts.length > 1; // key is 1, so >1 means modifiers exist
  const isFunctionKey = keyName.startsWith("F") && keyName.length > 1;
  const isSpecial = [
    "MediaPlayPause",
    "MediaNextTrack",
    "MediaPreviousTrack",
  ].includes(keyName);

  if (!hasModifier && !isFunctionKey && !isSpecial) return null;

  return parts.join("+");
}

shortcutBtn.addEventListener("click", () => {
  if (isRecordingHotkey) {
    stopRecordingHotkey();
  } else {
    startRecordingHotkey();
  }
});

// Capture keys for visualization and saving
document.addEventListener("keydown", async (event) => {
  if (!isRecordingHotkey) return;
  event.preventDefault();
  event.stopPropagation();

  // Cancel on Escape
  if (event.key === "Escape") {
    stopRecordingHotkey();
    return;
  }

  // Live visual update
  const displayStr = getEventDisplayString(event);
  if (displayStr) {
    recordingText.textContent = displayStr;
  }

  // Try to build valid accelerator
  const accelerator = buildAcceleratorString(event);
  if (accelerator) {
    // Valid shortcut detected
    currentHotkey = accelerator;
    updateHotkeyDisplay(accelerator);

    // Slight delay to let user see the full combo before closing
    setTimeout(async () => {
      const success = await window.api.setHotkey(accelerator);
      if (success) {
        setStatus("ready", "Atalho atualizado!");
        setTimeout(
          () => setStatus("ready", "Pronto! Pressione o atalho para gravar"),
          2000
        );
      } else {
        setStatus("error", "Falha ao registrar atalho");
      }
      stopRecordingHotkey();
    }, 150); // Small 150ms buffer for UX
  }
});

// Handle keyup to update display if user releases a key (e.g. keeps Command held but releases Shift)
document.addEventListener("keyup", (event) => {
  if (!isRecordingHotkey) return;
  event.preventDefault();
  event.stopPropagation();

  // Update display on release too, so if they let go of a key it reflects what's still held
  const displayStr = getEventDisplayString(event);
  if (displayStr) {
    recordingText.textContent = displayStr;
  } else {
    recordingText.textContent = "Digite o atalho...";
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

  // Noise patterns to filter out
  const noisePatterns = [
    "[música de fundo]",
    "[fundo]",
    "[music]",
    "(music)",
    "[silence]",
    "[silêncio]",
    "...",
  ];

  const isNoise =
    noisePatterns.some((pattern) => lowerText.includes(pattern)) ||
    rawText.length === 0;

  if (isNoise) {
    if (transcriptionText) {
      transcriptionText.textContent =
        "Nenhuma fala detectada. Tente falar mais perto do microfone.";
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
