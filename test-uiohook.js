import pkg from "uiohook-napi";
console.log("Default export:", pkg);
try {
  const { uiohook, UiohookKey } = pkg;
  console.log("uiohook:", uiohook);
  console.log("UiohookKey:", UiohookKey);
} catch (e) {
  console.log("Destructuring failed:", e.message);
}

import * as namespace from "uiohook-napi";
console.log("Namespace import:", namespace);
