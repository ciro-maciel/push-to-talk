/**
 * Hotkey Module - Global keyboard hooks and PTT logic
 */
import pkg from "uiohook-napi";
const { uIOhook, UiohookKey } = pkg;
const uiohook = uIOhook;

import { startRecording, stopRecording, getIsRecording } from "./ui.js";

// ============================================================================
// STATE
// ============================================================================

let pressedKeys = new Set();
let recordingStartTime = 0;
let isLatched = false;
let isPaused = false;
let currentConfig = null;

// ============================================================================
// KEY MAPPING
// ============================================================================

export const KEY_MAP = {
  Space: UiohookKey.Space,
  Enter: UiohookKey.Enter,
  Escape: UiohookKey.Escape,
  Tab: UiohookKey.Tab,
  Backspace: UiohookKey.Backspace,

  // Navigation
  Home: UiohookKey.Home,
  End: UiohookKey.End,
  PageUp: UiohookKey.PageUp,
  PageDown: UiohookKey.PageDown,
  Delete: UiohookKey.Delete,
  Insert: UiohookKey.Insert,

  // Arrow Keys
  ArrowUp: UiohookKey.ArrowUp,
  ArrowDown: UiohookKey.ArrowDown,
  ArrowLeft: UiohookKey.ArrowLeft,
  ArrowRight: UiohookKey.ArrowRight,

  // F-Keys
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,

  // Modifiers (Check both Left and Right)
  CommandOrControl: [
    UiohookKey.Meta,
    UiohookKey.MetaRight,
    UiohookKey.Ctrl,
    UiohookKey.CtrlRight,
  ],
  Command: [UiohookKey.Meta, UiohookKey.MetaRight],
  Control: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  Option: [UiohookKey.Alt, UiohookKey.AltRight],

  // Specific Left/Right
  RightCommand: UiohookKey.MetaRight,
  RightControl: UiohookKey.CtrlRight,
  RightShift: UiohookKey.ShiftRight,
  RightOption: UiohookKey.AltRight,
  RightAlt: UiohookKey.AltRight,

  LeftCommand: UiohookKey.Meta,
  LeftControl: UiohookKey.Ctrl,
  LeftShift: UiohookKey.Shift,
  LeftOption: UiohookKey.Alt,
  LeftAlt: UiohookKey.Alt,
};

// ============================================================================
// HOTKEY DETECTION
// ============================================================================

function isHotkeyPressed() {
  if (!currentConfig) return false;

  const keys = currentConfig.hotkey.split("+");

  for (const k of keys) {
    const mapped =
      KEY_MAP[k] ||
      KEY_MAP[k.toUpperCase()] ||
      UiohookKey[k.length === 1 ? k.toUpperCase() : k];

    if (Array.isArray(mapped)) {
      if (!mapped.some((code) => pressedKeys.has(code))) return false;
    } else if (mapped) {
      if (!pressedKeys.has(mapped)) return false;
    } else {
      if (k.length === 1) {
        const charCode = UiohookKey[k.toUpperCase()];
        if (charCode && !pressedKeys.has(charCode)) return false;
      }
    }
  }
  return true;
}

// ============================================================================
// CONTROL FUNCTIONS
// ============================================================================

export function setPaused(paused) {
  isPaused = paused;
}

export function getPaused() {
  return isPaused;
}

export function setConfig(config) {
  currentConfig = config;
}

// ============================================================================
// UIOHOOK INITIALIZATION
// ============================================================================

export function startUiohook(config) {
  currentConfig = config;

  uiohook.on("input", (e) => {
    if (isPaused) return;

    const isRecording = getIsRecording();

    if (e.type === 4) {
      // KeyDown
      pressedKeys.add(e.keycode);

      if (isHotkeyPressed()) {
        if (!isRecording) {
          startRecording(currentConfig);
          recordingStartTime = Date.now();
          isLatched = false;
        } else if (
          isLatched &&
          (currentConfig.triggerMode === "hybrid" ||
            currentConfig.triggerMode === "toggle")
        ) {
          stopRecording(currentConfig);
          isLatched = false;
        } else if (currentConfig.triggerMode === "toggle") {
          stopRecording(currentConfig);
        }
      }
    } else if (e.type === 5) {
      // KeyUp
      const wasPressed = isHotkeyPressed();
      pressedKeys.delete(e.keycode);
      const isPressedNow = isHotkeyPressed();

      if (wasPressed && !isPressedNow && isRecording) {
        const duration = Date.now() - recordingStartTime;

        if (currentConfig.triggerMode === "toggle") {
          isLatched = true;
        } else if (currentConfig.triggerMode === "hold") {
          stopRecording(currentConfig);
        } else {
          // Hybrid Mode
          if (!isLatched) {
            if (duration < 500) {
              isLatched = true;
            } else {
              stopRecording(currentConfig);
            }
          }
        }
      }
    }
  });

  uiohook.start();
}

export function registerHotkey() {
  // Hook is already running via startUiohook
  // This function exists for compatibility
}
