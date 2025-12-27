/**
 * Transcription Module - Whisper.cpp, Text Input, and Audio Processing
 */
import { spawn, exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { clipboard, Notification } from "electron";
import { getWhisperBinary, getWhisperModel } from "./core.js";
import { getMainWindow, hideOverlay } from "./ui.js";

// ============================================================================
// LOGGING
// ============================================================================

export function logToRenderer(msg) {
  getMainWindow()?.webContents.send("log", msg);
}

// ============================================================================
// TRANSCRIPTION (whisper.cpp)
// ============================================================================

export async function transcribe(config, modelManager) {
  logToRenderer("🧠 Preparando transcrição...");
  getMainWindow()?.webContents.send("status", {
    recording: false,
    message: "Transcrevendo...",
  });

  const startTime = Date.now();

  return new Promise((resolve) => {
    const whisperBin = getWhisperBinary();
    const whisperModel = getWhisperModel(modelManager, config);
    logToRenderer(`🔍 Buscando modelo em: ${whisperModel}`);

    if (fs.existsSync(whisperModel)) {
      logToRenderer("✅ Arquivo de modelo encontrado.");
    } else {
      logToRenderer(`❌ Arquivo de modelo NÃO encontrado em: ${whisperModel}`);
      const fallback = path.join(
        process.resourcesPath,
        path.basename(whisperModel)
      );
      if (fs.existsSync(fallback)) {
        logToRenderer(`⚠️ Modelo encontrado na raiz: ${fallback}`);
      }
    }

    if (!fs.existsSync(whisperBin)) {
      logToRenderer(`❌ Erro: whisper-cli não encontrado em: ${whisperBin}`);
      getMainWindow()?.webContents.send("status", {
        message: "Error: whisper.cpp not compiled",
        error: true,
      });
      resolve(null);
      return;
    }

    if (fs.existsSync(config.audioFile)) {
      const stats = fs.statSync(config.audioFile);
      logToRenderer(`📁 Arquivo de áudio: ${stats.size} bytes`);
      if (stats.size < 1000) {
        logToRenderer("⚠️ Arquivo muito pequeno, provável silêncio.");
      }
    } else {
      logToRenderer("❌ Arquivo de áudio não encontrado!");
      resolve(null);
      return;
    }

    const args = [
      "-m",
      whisperModel,
      "-f",
      config.audioFile,
      "-l",
      config.language,
      "--prompt",
      config.prompt,
      "-nt",
      "--no-prints",
    ];

    logToRenderer(
      `🚀 Executando: ${whisperBin} -m ${path.basename(whisperModel)} ...`
    );

    const proc = spawn(whisperBin, args, {
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
      logToRenderer(`❌ Falha ao iniciar processo: ${err.message}`);
      getMainWindow()?.webContents.send("status", {
        message: "Error: Failed to run whisper",
        error: true,
      });
      resolve(null);
    });

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logToRenderer(`⏱️ Tempo: ${elapsed}s, Código: ${code}`);

      if (code !== 0) {
        logToRenderer(`❌ Whisper falhou. Stderr: ${stderr}`);
        resolve(null);
        return;
      }

      const text = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .trim();

      if (!text) {
        logToRenderer("⚠️ Whisper retornou texto vazio");
        if (stderr) logToRenderer(`Stderr: ${stderr}`);
      }

      resolve(text || null);
    });
  });
}

// ============================================================================
// AUDIO ANALYSIS
// ============================================================================

export function calculateRMS(buffer) {
  const WAV_HEADER_SIZE = 44;
  const audioDataStart = WAV_HEADER_SIZE;
  const audioDataLength = buffer.length - WAV_HEADER_SIZE;

  if (audioDataLength <= 0) {
    return 0;
  }

  const numSamples = Math.floor(audioDataLength / 2);
  const samples = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const byteIndex = audioDataStart + i * 2;
    const byte1 = buffer[byteIndex];
    const byte2 = buffer[byteIndex + 1];
    const val = byte1 | (byte2 << 8);
    samples[i] = val >= 0x8000 ? val - 0x10000 : val;
  }

  let sumSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    sumSquares += samples[i] * samples[i];
  }

  const meanSquare = sumSquares / numSamples;
  return Math.sqrt(meanSquare);
}

// ============================================================================
// TEXT INSERTION
// ============================================================================

export function typeText(text) {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      const originalClipboard = clipboard.readText();
      clipboard.writeText(text);

      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;

      exec(`osascript -e '${script}'`, (error) => {
        if (error) {
          console.error("Failed to paste text:", error.message);
        }

        setTimeout(() => {
          if (originalClipboard) {
            clipboard.writeText(originalClipboard);
          }
          resolve();
        }, 200);
      });
    } else if (process.platform === "win32") {
      const escapedText = text
        .replace(/'/g, "''")
        .replace(/`/g, "``")
        .replace(/\$/g, "`$");
      exec(
        `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')"`,
        (error) => {
          if (error) {
            console.error("Failed to type text:", error.message);
            clipboard.writeText(text);
            exec(
              "powershell -command \"$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')\"",
              resolve
            );
          } else {
            resolve();
          }
        }
      );
    } else {
      const escapedText = text.replace(/'/g, "'\\''");
      exec(`xdotool type -- '${escapedText}'`, (error) => {
        if (error) {
          console.error("Failed to type text:", error.message);
          clipboard.writeText(text);
          exec("xdotool key ctrl+v", resolve);
        } else {
          resolve();
        }
      });
    }
  });
}

// ============================================================================
// MAIN RECORDING FLOW
// ============================================================================

export async function handleRecordingComplete(config, modelManager) {
  const text = await transcribe(config, modelManager);

  if (text) {
    const lowerText = text.toLowerCase();
    const noisePatterns = [
      "[música de fundo]",
      "[fundo]",
      "[music]",
      "(music)",
      "[silence]",
      "[silêncio]",
      "música",
      "music",
      "sous-titres",
      "subtitle",
      "...",
    ];

    const isNoise = noisePatterns.some((pattern) =>
      lowerText.includes(pattern)
    );

    if (isNoise) {
      logToRenderer(`⚠️ Ruído ignorado: "${text}"`);
      hideOverlay();
    } else {
      getMainWindow()?.webContents.send("transcription", {
        text,
        message: "Texto inserido!",
      });

      new Notification({
        title: "Transcrição Completa",
        body: text.length > 50 ? text.substring(0, 50) + "..." : text,
      }).show();

      await new Promise((r) => setTimeout(r, 100));
      await typeText(text);
    }
  } else {
    getMainWindow()?.webContents.send("status", {
      message: "Opa, não consegui te ouvir!",
      error: true,
    });
  }

  hideOverlay();

  setTimeout(() => {
    getMainWindow()?.webContents.send("status", {
      message: `Ready! Press ${config.hotkey} to start`,
    });
  }, 2000);
}
