/**
 * Push-to-Talk (Whisper Local)
 *
 * A fully local, air-gapped speech-to-text application for macOS.
 * Press and hold F8 to record, release to transcribe.
 *
 * Stack: Bun + SoX + whisper.cpp + uiohook-napi
 */

import { spawn } from "node:child_process";
import { uIOhook, UiohookKey } from "uiohook-napi";
import clipboard from "clipboardy";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Key to trigger recording (F8)
  triggerKey: UiohookKey.F8,

  // Temporary audio file path
  audioFile: "/tmp/recording.wav",

  // whisper.cpp paths (relative to project root)
  whisperBinary: "./whisper.cpp/build/bin/whisper-cli",
  whisperModel: "./whisper.cpp/models/ggml-small.bin",

  // Audio settings for SoX (optimized for whisper)
  audio: {
    rate: 16000, // 16kHz sample rate
    channels: 1, // Mono
    bits: 16, // 16-bit depth
  },
};

// ============================================================================
// STATE
// ============================================================================

let isRecording = false;
let recProcess = null;

// ============================================================================
// AUDIO RECORDING (SoX)
// ============================================================================

/**
 * Start recording audio from the default microphone using SoX's 'rec' command.
 * Records to a temporary WAV file with settings optimized for whisper.cpp.
 */
function startRecording() {
  if (isRecording) return;

  console.log("\n🎤 Recording started... (hold F8)");
  isRecording = true;

  // SoX 'rec' command arguments
  const args = [
    "-q", // Quiet mode (no progress)
    "-r",
    CONFIG.audio.rate.toString(),
    "-c",
    CONFIG.audio.channels.toString(),
    "-b",
    CONFIG.audio.bits.toString(),
    CONFIG.audioFile,
  ];

  recProcess = spawn("rec", args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  recProcess.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("WARN")) {
      console.error(`[SoX] ${msg}`);
    }
  });

  recProcess.on("error", (err) => {
    console.error("❌ Failed to start recording:", err.message);
    console.error("   Make sure SoX is installed: brew install sox");
    isRecording = false;
    recProcess = null;
  });

  recProcess.on("close", (code) => {
    if (code !== null && code !== 0 && code !== 2) {
      // Code 2 is normal for SIGINT
      console.error(`[SoX] Process exited with code ${code}`);
    }
  });
}

/**
 * Stop the recording process gracefully.
 * Returns a promise that resolves when the process has fully terminated.
 */
function stopRecording() {
  return new Promise((resolve) => {
    if (!isRecording || !recProcess) {
      resolve();
      return;
    }

    console.log("⏹️  Recording stopped.");
    isRecording = false;

    const proc = recProcess;
    recProcess = null;

    // Give SoX a moment to flush audio buffer
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill("SIGINT");
      }

      // Wait for process to fully terminate
      proc.on("close", () => resolve());

      // Timeout fallback
      setTimeout(resolve, 500);
    }, 100);
  });
}

// ============================================================================
// TRANSCRIPTION (whisper.cpp)
// ============================================================================

/**
 * Transcribe the recorded audio using whisper.cpp.
 * Returns the transcribed text or null on failure.
 */
async function transcribe() {
  console.log("🧠 Transcribing...");
  console.time("⏱️  Inference time");

  return new Promise((resolve) => {
    const args = [
      "-m",
      CONFIG.whisperModel,
      "-f",
      CONFIG.audioFile,
      "-l",
      "pt", // Portuguese language
      "-nt", // No timestamps
      "--no-prints", // Suppress model info
    ];

    const proc = spawn(CONFIG.whisperBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      console.timeEnd("⏱️  Inference time");
      console.error("❌ Failed to run whisper.cpp:", err.message);
      console.error("   Make sure whisper.cpp is compiled:");
      console.error("   cd whisper.cpp && make");
      resolve(null);
    });

    proc.on("close", (code) => {
      console.timeEnd("⏱️  Inference time");

      if (code !== 0) {
        console.error(`❌ whisper.cpp exited with code ${code}`);
        if (stderr) console.error(stderr);
        resolve(null);
        return;
      }

      // Clean up the transcribed text
      const text = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .trim();

      resolve(text || null);
    });
  });
}

// ============================================================================
// CLIPBOARD
// ============================================================================

/**
 * Copy text to the system clipboard.
 */
async function copyToClipboard(text) {
  try {
    await clipboard.write(text);
    console.log("📋 Copied to clipboard!");
  } catch (err) {
    console.error("❌ Failed to copy to clipboard:", err.message);
  }
}

// ============================================================================
// MAIN FLOW
// ============================================================================

/**
 * Handle the complete flow after recording stops:
 * 1. Transcribe the audio
 * 2. Copy result to clipboard
 */
async function handleRecordingComplete() {
  const text = await transcribe();

  if (text) {
    console.log("\n📝 Transcription:");
    console.log(`   "${text}"\n`);
    await copyToClipboard(text);
  } else {
    console.log("⚠️  No transcription result (audio too short or unclear)");
  }

  console.log("🎧 Ready! Press and hold F8 to record...\n");
}

// ============================================================================
// KEY LISTENER SETUP
// ============================================================================

// Track F8 state to prevent repeated events
let f8Pressed = false;

uIOhook.on("keydown", (event) => {
  if (event.keycode === CONFIG.triggerKey && !f8Pressed) {
    f8Pressed = true;
    startRecording();
  }
});

uIOhook.on("keyup", async (event) => {
  if (event.keycode === CONFIG.triggerKey && f8Pressed) {
    f8Pressed = false;
    await stopRecording();
    await handleRecordingComplete();
  }
});

// ============================================================================
// STARTUP
// ============================================================================

console.log(
  "╔═══════════════════════════════════════════════════════════════╗"
);
console.log(
  "║           🎙️  Push-to-Talk (Whisper Local)                    ║"
);
console.log(
  "║                                                               ║"
);
console.log("║   Press and hold F8 to record, release to transcribe.        ║");
console.log("║   Transcribed text will be copied to your clipboard.         ║");
console.log(
  "║                                                               ║"
);
console.log(
  "║   Press Ctrl+C to exit.                                       ║"
);
console.log(
  "╚═══════════════════════════════════════════════════════════════╝"
);
console.log("");
console.log("🎧 Ready! Press and hold F8 to record...\n");

// Start the global key listener
uIOhook.start();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  uIOhook.stop();
  if (recProcess) {
    recProcess.kill("SIGINT");
  }
  process.exit(0);
});
