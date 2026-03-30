// preload/index.ts
var { ipcRenderer, contextBridge } = require("electron");
var yogi = {
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
  parsePdf: (path) => ipcRenderer.invoke("parse-pdf", { path }),
  captureScreenshot: () => ipcRenderer.invoke("capture-screenshot"),
  waitForStability: (timeoutMs) => ipcRenderer.invoke("wait-for-stability", { timeoutMs: timeoutMs || 5e3 }),
  validateAction: (action, before) => ipcRenderer.invoke("validate-action", { action, before }),
  analyzeScreenshot: (screenshotBase64, actionDescription, expectedOutcome) => ipcRenderer.invoke("analyze-screenshot", { screenshotBase64, actionDescription, expectedOutcome }),
  captureSnapshot: () => ipcRenderer.invoke("capture-snapshot"),
  showNotification: (title, body) => ipcRenderer.invoke("show-notification", { title, body }),
  getMissions: () => ipcRenderer.invoke("get-missions"),
  saveMissions: (missions) => ipcRenderer.invoke("save-missions", missions),
  getSkills: () => ipcRenderer.invoke("get-skills"),
  saveSkills: (skills) => ipcRenderer.invoke("save-skills", skills),
  injectSkills: (content) => ipcRenderer.invoke("inject-skills", { content })
};
try {
  contextBridge.exposeInMainWorld("yogi", yogi);
} catch (e) {
  window.yogi = yogi;
}
console.log("\u{1F680} [Bridge] Yogi bridge is active and attached to window.yogi");
