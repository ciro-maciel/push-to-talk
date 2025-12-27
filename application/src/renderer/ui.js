/**
 * UI Module - Hotkey recording, Models UI, Permissions, and Logging
 */

// ============================================================================
// MODEL METADATA
// ============================================================================

export const MODEL_METADATA = {
  tiny: "⚡ Ultra Rápido e Leve\nResposta quase instantânea. Ideal para comandos de voz curtos e frases simples.",
  base: "⚖️ Balanceado (Padrão)\nO melhor equilíbrio para o dia a dia. Rápido o suficiente e com boa precisão para ditados gerais.",
  small:
    "🎯 Alta Precisão\nEntende nuances, sotaques e fala rápida muito melhor. Ótima escolha se o 'Base' estiver errando.",
  medium:
    "🧠 Qualidade Profissional\nTranscrição extremamente detalhada e fiel. Ideal para textos longos, artigos ou conteúdo técnico complexo.",
  "large-v3-turbo":
    "🚀 Inteligência Máxima\nO modelo mais avançado disponível. Capacidade de compreensão superior, quase humana.",
};

export function getModelDescription(name) {
  if (MODEL_METADATA[name]) return MODEL_METADATA[name];
  if (name.includes("q5"))
    return "Versão quantizada (mais leve) do modelo. Menor consumo de memória.";
  if (name.includes(".en"))
    return "Modelo otimizado apenas para o idioma Inglês.";
  return "Modelo de transcrição Whisper.";
}

// ============================================================================
// LOGGING SYSTEM
// ============================================================================

const logData = [];
let logsList = null;

export function initLogger(logsListElement) {
  logsList = logsListElement;
}

export function getLogData() {
  return logData;
}

export function log(msg, explicitType = null) {
  let type = explicitType || "info";

  if (!explicitType) {
    if (msg.includes("🎤") || msg.includes("recording")) type = "recording";
    else if (msg.includes("✅") || msg.includes("success")) type = "success";
    else if (msg.includes("❌") || msg.includes("error")) type = "error";
    else if (msg.includes("⚠️")) type = "info";
  }

  const cleanMsg = msg.replace(/^[🎤⏹️⚠️✅📊🎯🔊❌📤🤖▶️]\s*/u, "").trim();
  const timestamp = new Date().toLocaleTimeString();

  logData.push({ timestamp, message: cleanMsg, type });

  if (logsList) {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;

    let iconSvg = "";
    if (type === "recording") {
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>`;
    } else if (type === "success") {
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === "error") {
      iconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    } else {
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

// ============================================================================
// STATUS MANAGEMENT
// ============================================================================

let statusIndicator = null;
let statusMessage = null;

export function initStatusElements(indicatorEl, messageEl) {
  statusIndicator = indicatorEl;
  statusMessage = messageEl;
}

export function setStatus(state, message) {
  if (statusIndicator) statusIndicator.className = "status-indicator " + state;
  if (statusMessage) statusMessage.textContent = message;
}

// ============================================================================
// HOTKEY DISPLAY
// ============================================================================

export function updateHotkeyDisplay(
  hotkey,
  currentKeysDisplay,
  clearBtn,
  isRecordingHotkey
) {
  if (!hotkey || hotkey.trim() === "") {
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

  if (clearBtn && !isRecordingHotkey) {
    clearBtn.classList.remove("hidden");
  }
}

// ============================================================================
// SEGMENT UI (Trigger Mode)
// ============================================================================

export function updateSegmentUI(activeMode, controlsHelper) {
  const segments = document.querySelectorAll(".segment-btn");
  segments.forEach((btn) => {
    if (btn.dataset.mode === activeMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  if (controlsHelper) {
    const instructions = {
      hybrid: "Toque para gravar • Segure para falar",
      toggle: "Toque para iniciar • Toque novamente para parar",
      hold: "Segure o atalho pressionado para gravar",
    };
    controlsHelper.textContent =
      instructions[activeMode] || instructions.hybrid;
  }
}

// ============================================================================
// PERMISSIONS UI
// ============================================================================

export async function checkAndShowPermissions(
  stepMic,
  stepAccessibility,
  permissionModal,
  setStatusFn
) {
  const permissions = await window.api.checkPermissions();
  let allGranted = true;

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
    setStatusFn("error", "Permissões necessárias!");
  } else {
    permissionModal.classList.add("hidden");
  }

  return permissions;
}

// ============================================================================
// HOTKEY RECORDING STATE
// ============================================================================

const heldModifiers = new Set();

export function updateHeldModifiers(event) {
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

export function clearHeldModifiers() {
  heldModifiers.clear();
}

export function getEventDisplayString(event) {
  const parts = [];

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
    if (event.ctrlKey) parts.push("⌃");
    if (event.altKey) parts.push("⌥");
    if (event.shiftKey) parts.push("⇧");
    if (event.metaKey) parts.push("⌘");
  }

  const key = event.key;
  const code = event.code;

  if (!["Meta", "Control", "Shift", "Alt", "Ctrl", "Command"].includes(key)) {
    let keyName = key.toUpperCase();
    if (code === "Space") keyName = "Space";
    else if (key === " ") keyName = "Space";
    else if (code.startsWith("Key")) keyName = code.replace("Key", "");
    else if (code.startsWith("Digit")) keyName = code.replace("Digit", "");
    parts.push(keyName);
  }

  return parts.join(" ");
}

export function buildAcceleratorString(event) {
  const parts = [];

  if (heldModifiers.has("Command")) parts.push("Command");
  if (heldModifiers.has("RightCommand")) parts.push("RightCommand");
  if (heldModifiers.has("Control")) parts.push("Control");
  if (heldModifiers.has("RightControl")) parts.push("RightControl");
  if (heldModifiers.has("Option")) parts.push("Option");
  if (heldModifiers.has("RightOption")) parts.push("RightOption");
  if (heldModifiers.has("Shift")) parts.push("Shift");
  if (heldModifiers.has("RightShift")) parts.push("RightShift");

  if (parts.length === 0) {
    if (event.metaKey) parts.push("CommandOrControl");
    if (event.ctrlKey) parts.push("Control");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
  }

  const key = event.key;
  const code = event.code;

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
