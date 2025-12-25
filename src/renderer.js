/**
 * Renderer process - UI logic
 * Simple IPC triggers - Audio recording is handled by Main process (via bundled FFmpeg)
 */

const statusIndicator = document.getElementById("status-indicator");
const statusMessage = document.getElementById("status-message");
const hotkeyBtn = document.getElementById("hotkey-btn");
const hotkeyDisplay = document.getElementById("hotkey");
const hotkeyRecording = document.getElementById("hotkey-recording");
const cancelHotkeyBtn = document.getElementById("cancel-hotkey");
const copyLogBtn = document.getElementById("copy-log-btn");
const transcriptionContainer = document.getElementById(
  "transcription-container"
);
const transcriptionText = document.getElementById("transcription-text");
const playAudioBtn = document.getElementById("play-audio-btn");
const permissionWarning = document.getElementById("permission-warning");
const micPermissionBtn = document.getElementById("mic-permission");
const accessibilityPermissionBtn = document.getElementById(
  "accessibility-permission"
);

let isRecordingHotkey = false;
let currentHotkey = "";

// Initialize
async function init() {
  await checkAndShowPermissions();

  const config = await window.api.getConfig();
  currentHotkey = config.hotkey;
  updateHotkeyDisplay(config.hotkey);
  setStatus("ready", `Pronto! Pressione o atalho para gravar`);
}

async function checkAndShowPermissions() {
  const permissions = await window.api.checkPermissions();
  let needsPermissions = false;

  if (!permissions.microphone) {
    micPermissionBtn.classList.remove("hidden");
    needsPermissions = true;
  }

  if (!permissions.accessibility) {
    accessibilityPermissionBtn.classList.remove("hidden");
    needsPermissions = true;
  }

  if (needsPermissions) {
    permissionWarning.classList.remove("hidden");
    setStatus("error", "Permissões necessárias!");
  } else {
    permissionWarning.classList.add("hidden");
  }

  return permissions;
}

micPermissionBtn.addEventListener("click", () =>
  window.api.openSettings("microphone")
);
accessibilityPermissionBtn.addEventListener("click", () =>
  window.api.openSettings("accessibility")
);

if (copyLogBtn) {
  copyLogBtn.addEventListener("click", async () => {
    const logText = document.getElementById("debug-log").innerText;
    try {
      await window.api.copyToClipboard(logText);
      const originalText = copyLogBtn.innerText;
      copyLogBtn.innerText = "Copiado!";
      setTimeout(() => (copyLogBtn.innerText = originalText), 2000);
    } catch (err) {
      console.error("Clipboard error:", err);
      // Fallback
      navigator.clipboard
        .writeText(logText)
        .catch((e) => setStatus("error", "Erro ao copiar"));
    }
  });
}

function updateHotkeyDisplay(hotkey) {
  let displayHotkey = hotkey
    .replace("CommandOrControl", "⌘")
    .replace("Command", "⌘")
    .replace("Control", "⌃")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .replace("Option", "⌥")
    .replace(/\+/g, "");
  hotkeyDisplay.textContent = displayHotkey;
}

function setStatus(state, message) {
  statusIndicator.className = "status-indicator " + state;
  statusMessage.textContent = message;
}

// ============================================================================
// AUDIO RECORDING (Web Audio API - Raw PCM to WAV)
// ============================================================================

let audioContext = null;
let mediaStreamSource = null;
let scriptProcessor = null;
let audioBuffers = [];

async function startAudioRecording() {
  try {
    // List devices first to pick a specific one (avoiding 'default' which can be buggy)
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");
    log(`🎤 Dispositivos encontrados: ${audioInputs.length}`);
    audioInputs.forEach((d) => log(` - ${d.label} (${d.deviceId})`));

    // Prefer a non-default device if available
    let selectedDeviceId = "default";
    const specificMic = audioInputs.find(
      (d) => d.deviceId !== "default" && d.deviceId !== "communications"
    );

    if (specificMic) {
      selectedDeviceId = specificMic.deviceId;
      log(`🎯 Selecionando dispositivo específico: ${specificMic.label}`);
    } else {
      log("⚠️ Usando dispositivo 'default' (nenhum específico encontrado)");
    }

    // Request microphone access with specific device
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: selectedDeviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const track = audioStream.getAudioTracks()[0];
    log(`🎤 Stream ativo: ${track.label} (ReadyState: ${track.readyState})`);

    // Initialize AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000, // Try to request 16k directly to avoid resampling issues
    });

    // Ensure context is running
    if (audioContext.state === "suspended") {
      log("⚠️ AudioContext suspenso, forçando resume...");
      await audioContext.resume();
    }
    log(
      `🔊 AudioContext State: ${audioContext.state} | Rate: ${audioContext.sampleRate}`
    );

    // Create MediaStreamSource
    mediaStreamSource = audioContext.createMediaStreamSource(audioStream);

    // Create ScriptProcessor (bufferSize, inputChannels, outputChannels)
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    audioBuffers = []; // Reset buffers

    scriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);

      // Calculate RMS (Volume) for debug
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      // Only log if silence (or every N chunks to avoid spam)
      if (audioBuffers.length % 20 === 0) {
        // log(`📊 Volume atual (RMS): ${rms.toFixed(4)}`);
      }

      // Clone the data because inputBuffer is reused
      const bufferCopy = new Float32Array(inputData);

      // Debug: Log first 5 samples of first buffer
      if (audioBuffers.length === 0) {
        log(`🔍 Raw Samples [0-4]: ${bufferCopy.slice(0, 5).join(", ")}`);
      }

      audioBuffers.push(bufferCopy);
    };

    // Connect the graph
    mediaStreamSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    console.log(
      `🎤 Recording started (Sample Rate: ${audioContext.sampleRate}Hz)`
    );
    return true;
  } catch (err) {
    console.error("Failed to start recording:", err);
    setStatus("error", "Erro ao acessar microfone. Verifique permissões.");
    return false;
  }
}

async function stopAudioRecording() {
  return new Promise(async (resolve) => {
    if (!audioContext || audioContext.state === "closed") {
      resolve(null);
      return;
    }

    console.log("⏹️ Recording stopped");

    // Stop recording
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      mediaStreamSource.disconnect();
      scriptProcessor.onaudioprocess = null;
    }

    // Stop tracks
    if (mediaStreamSource && mediaStreamSource.mediaStream) {
      mediaStreamSource.mediaStream
        .getTracks()
        .forEach((track) => track.stop());
    }

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
    log(`📊 Volume Médio da Gravação: ${avgRms.toFixed(6)}`);

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

    // Close context
    await audioContext.close();
    audioContext = null;
    scriptProcessor = null;
    mediaStreamSource = null;

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
  isRecordingHotkey = true;
  hotkeyBtn.classList.add("recording");
  hotkeyRecording.classList.remove("hidden");
  hotkeyDisplay.textContent = "...";
  window.api.setRecordingHotkey(true);
}

function stopRecordingHotkey() {
  isRecordingHotkey = false;
  hotkeyBtn.classList.remove("recording");
  hotkeyRecording.classList.add("hidden");
  updateHotkeyDisplay(currentHotkey);
  window.api.setRecordingHotkey(false);
}

function buildHotkeyString(event) {
  const parts = [];
  if (event.metaKey) parts.push("CommandOrControl");
  else if (event.ctrlKey) parts.push("Control");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  const key = event.key;
  const code = event.code;

  if (["Meta", "Control", "Shift", "Alt", "Ctrl", "Command"].includes(key))
    return null;

  let keyName = key;
  if (code.startsWith("Key")) keyName = code.replace("Key", "");
  else if (code.startsWith("Digit")) keyName = code.replace("Digit", "");
  else if (code === "Space") keyName = "Space";
  else if (code.startsWith("F") && code.length <= 3) keyName = code;
  else if (key === " ") keyName = "Space";
  else keyName = key.toUpperCase();

  parts.push(keyName);

  if (parts.length < 2 && !keyName.startsWith("F")) return null;

  return parts.join("+");
}

hotkeyBtn.addEventListener("click", () => {
  if (!isRecordingHotkey) startRecordingHotkey();
});

cancelHotkeyBtn.addEventListener("click", stopRecordingHotkey);

document.addEventListener("keydown", async (event) => {
  if (!isRecordingHotkey) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    stopRecordingHotkey();
    return;
  }

  const hotkey = buildHotkeyString(event);
  if (hotkey) {
    currentHotkey = hotkey;
    updateHotkeyDisplay(hotkey);
    const success = await window.api.setHotkey(hotkey);
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
  }
});

// Debug log
function log(msg) {
  const el = document.getElementById("debug-log");
  if (el) {
    el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }
  console.log(msg);
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
  if (transcriptionText) transcriptionText.textContent = data.text;
  setStatus("ready", data.message || "Copiado!");
  log(`✅ Transcrição recebida: "${data.text.substring(0, 20)}..."`);
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

init();
