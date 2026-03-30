const { ipcRenderer, contextBridge } = require('electron')

// ──────────────────────────────────────────────
// Yogi: The Preload Bridge
// ──────────────────────────────────────────────

const yogi = {
  // AI Request (Think -> Plan -> Task)
  sendChatMessage: (prompt: string, tier: string = 'high', workflow: string, keys: any) => 
    ipcRenderer.invoke('ai-request', { prompt, tier, workflow, keys }),

  // Terminal / Browser Execution
  executeTerminal: (command: string) => 
    ipcRenderer.invoke('terminal-exec', { command }),

  // Settings & Vault
  getSettings: () => 
    ipcRenderer.invoke('get-settings'),
    
  saveSettings: (settings: any) => 
    ipcRenderer.invoke('save-settings', settings),

  // Quota & Health
  getQuotas: () => 
    ipcRenderer.invoke('get-quotas'),

  // Automation Control
  connectBrowser: () => 
    ipcRenderer.invoke('connect-browser'),

  // Event Listeners (Main -> Renderer)
  onBrowserUpdate: (callback: (data: any) => void) => 
    ipcRenderer.on('browser-update', (_: any, data: any) => callback(data)),

  onTerminalOutput: (callback: (data: any) => void) => 
    ipcRenderer.on('terminal-output', (_: any, data: any) => callback(data)),
    
  onAgentLog: (callback: (data: any) => void) => 
    ipcRenderer.on('agent-thinking-log', (_: any, data: any) => callback(data)),
    
  onMainProcessMessage: (callback: (data: any) => void) =>
    ipcRenderer.on('main-process-message', (_: any, data: any) => callback(data)),

  humanInteraction: (type: string, data: any) =>
    ipcRenderer.invoke('human-interaction', { type, data }),

  getBrowserState: () => 
    ipcRenderer.invoke('get-browser-state'),

  domAction: (selector: string, action: string, value?: string) => 
    ipcRenderer.invoke('dom-action', { selector, action, value }),

  parsePdf: (path: string) =>
    ipcRenderer.invoke('parse-pdf', { path }),

  captureScreenshot: () =>
    ipcRenderer.invoke('capture-screenshot'),

  waitForStability: (timeoutMs?: number) =>
    ipcRenderer.invoke('wait-for-stability', { timeoutMs: timeoutMs || 5000 }),

  validateAction: (action: any, before: any) =>
    ipcRenderer.invoke('validate-action', { action, before }),

  analyzeScreenshot: (screenshotBase64: string, actionDescription?: string, expectedOutcome?: string) =>
    ipcRenderer.invoke('analyze-screenshot', { screenshotBase64, actionDescription, expectedOutcome }),

  captureSnapshot: () =>
    ipcRenderer.invoke('capture-snapshot'),

  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', { title, body }),

  getMissions: () =>
    ipcRenderer.invoke('get-missions'),

  saveMissions: (missions: any[]) =>
    ipcRenderer.invoke('save-missions', missions),

  getSkills: () =>
    ipcRenderer.invoke('get-skills'),

  saveSkills: (skills: any[]) =>
    ipcRenderer.invoke('save-skills', skills),

  injectSkills: (content: string) =>
    ipcRenderer.invoke('inject-skills', { content }),
}

// 🟢 THE FIX: Use both methods for maximum reliability
try {
  contextBridge.exposeInMainWorld('yogi', yogi)
} catch (e) {
  // @ts-ignore
  window.yogi = yogi
}

console.log('🚀 [Bridge] Yogi bridge is active and attached to window.yogi')
