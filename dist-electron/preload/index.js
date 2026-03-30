"use strict";
const { ipcRenderer, contextBridge } = require("electron");
const yogi = {
  // AI Request (Think -> Plan -> Task)
  sendChatMessage: (prompt, tier = "high", workflow, keys) => ipcRenderer.invoke("ai-request", { prompt, tier, workflow, keys }),
  // Terminal / Browser Execution
  executeTerminal: (command) => ipcRenderer.invoke("terminal-exec", { command }),
  // Settings & Vault
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  // Quota & Health
  getQuotas: () => ipcRenderer.invoke("get-quotas"),
  // Automation Control
  connectBrowser: () => ipcRenderer.invoke("connect-browser"),
  // Event Listeners (Main -> Renderer)
  onBrowserUpdate: (callback) => ipcRenderer.on("browser-update", (_, data) => callback(data)),
  onTerminalOutput: (callback) => ipcRenderer.on("terminal-output", (_, data) => callback(data)),
  onAgentLog: (callback) => ipcRenderer.on("agent-thinking-log", (_, data) => callback(data)),
  onMainProcessMessage: (callback) => ipcRenderer.on("main-process-message", (_, data) => callback(data)),
  humanInteraction: (type, data) => ipcRenderer.invoke("human-interaction", { type, data }),
  getBrowserState: () => ipcRenderer.invoke("get-browser-state"),
  domAction: (selector, action, value) => ipcRenderer.invoke("dom-action", { selector, action, value }),
  parsePdf: (path) => ipcRenderer.invoke("parse-pdf", { path })
};
try {
  contextBridge.exposeInMainWorld("yogi", yogi);
} catch (e) {
  window.yogi = yogi;
}
console.log("🚀 [Bridge] Yogi bridge is active and attached to window.yogi");
