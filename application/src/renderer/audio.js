/**
 * Audio Module - Microphone recording, WAV encoding, and audio processing
 */

// ============================================================================
// STATE
// ============================================================================

let audioContext = null;
let mediaStreamSource = null;
let scriptProcessor = null;
let audioBuffers = [];
let isRecording = false;
let warmStream = null;
let highPassFilter = null;
let compressor = null;
let gainNode = null;

// Callback for logging
let logCallback = null;

export function setLogCallback(callback) {
  logCallback = callback;
}

function log(msg, type = null) {
  if (logCallback) {
    logCallback(msg, type);
  } else {
    console.log(msg);
  }
}

// ============================================================================
// MICROPHONE WARMUP (Pre-heat for instant recording)
// ============================================================================

/**
 * Get list of available audio input devices
 */
export async function getAvailableMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microfone ${d.deviceId.slice(0, 8)}`,
    }));
}

export async function warmUpMicrophone(preferredDeviceId = null) {
  if (
    audioContext &&
    audioContext.state === "running" &&
    warmStream &&
    warmStream.active
  ) {
    return true;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === "audioinput");

    let selectedDeviceId = preferredDeviceId || "default";

    // If no preference, find a specific mic (not default/communications)
    if (!preferredDeviceId) {
      const specificMic = audioInputs.find(
        (d) => d.deviceId !== "default" && d.deviceId !== "communications"
      );
      if (specificMic) {
        selectedDeviceId = specificMic.deviceId;
      }
    }

    const selectedMic = audioInputs.find(
      (d) => d.deviceId === selectedDeviceId
    );
    if (selectedMic) {
      log(`🎯 Microfone selecionado: ${selectedMic.label}`);
    }

    warmStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: selectedDeviceId },
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const track = warmStream.getAudioTracks()[0];
    log(`🔥 Microfone pré-aquecido: ${track.label}`);

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    mediaStreamSource = audioContext.createMediaStreamSource(warmStream);

    // High-pass filter to remove low frequency noise
    highPassFilter = audioContext.createBiquadFilter();
    highPassFilter.type = "highpass";
    highPassFilter.frequency.value = 80;
    highPassFilter.Q.value = 0.7;

    // Dynamic compressor for volume normalization
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // Gain node for amplification
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.5;

    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      if (!isRecording) return;

      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      const bufferCopy = new Float32Array(inputData);
      audioBuffers.push(bufferCopy);

      // Calculate RMS for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      const normalizedLevel = Math.min(1, rms * 5);

      window.api.sendAudioLevel(normalizedLevel);
    };

    // Connect audio processing chain
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

export async function stopMicrophone() {
  try {
    if (warmStream) {
      warmStream.getTracks().forEach((track) => track.stop());
      warmStream = null;
    }

    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }

    audioContext = null;
    mediaStreamSource = null;
    scriptProcessor = null;

    return true;
  } catch (err) {
    console.error("Failed to stop microphone:", err);
    return false;
  }
}

// ============================================================================
// RECORDING CONTROL
// ============================================================================

export async function startAudioRecording() {
  if (!audioContext || audioContext.state === "closed") {
    await warmUpMicrophone();
  }

  if (audioContext && audioContext.state === "suspended") {
    await audioContext.resume();
  }

  audioBuffers = [];
  isRecording = true;

  console.log(`🎤 Recording started (instant)`);
  return true;
}

export async function stopAudioRecording(shouldCoolDown = false) {
  return new Promise(async (resolve) => {
    isRecording = false;
    console.log("⏹️ Recording stopped");

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

    audioBuffers = [];

    if (shouldCoolDown) {
      await stopMicrophone();
    }

    resolve(wavBuffer);
  });
}

// ============================================================================
// AUDIO PROCESSING UTILITIES
// ============================================================================

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
