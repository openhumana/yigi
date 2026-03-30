import 'dotenv/config'
import { app, BrowserWindow, shell, ipcMain, NativeImage } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import fs from 'fs'
import { orchestrator } from './orchestrator'
import { sandbox } from './sandbox'
import { humanInteraction } from './human_interaction'
import { validateAction, detectCaptcha, detectSensitiveAction, BrowserSnapshot, ActionContext } from './validator'
import { analyzeScreenshot } from './vision'

process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

if (release().startsWith('6.1')) app.disableHardwareAcceleration()

if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preloadPath = join(__dirname, '../preload/index.js')

const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'Yogi Browser',
    width: 1440,
    height: 900,
    icon: join(process.env.PUBLIC || '', 'favicon.ico'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      devTools: true,
    },
  })

  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process gone:', details)
  })

  if (url) {
    console.log(`[Main] Connecting to Dev Server: ${url}`)
    win.loadURL(url)
    win.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
      console.error(`[Main] Failed to load URL: ${errorCode} - ${errorDescription}`)
    })
  } else {
    win.loadFile(indexHtml)
  }

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// ──────────────────────────────────────────────
// Yogi: IPC Handlers
// ──────────────────────────────────────────────

ipcMain.handle('connect-browser', async () => {
  try {
    console.log('[Main] Launching Browser Session...')
    await new Promise(resolve => setTimeout(resolve, 1500))
    return { status: 'success', message: 'Browser Connected' }
  } catch (error: any) {
    console.error('[Main] Browser Launch Failed:', error)
    return { status: 'error', message: error.message }
  }
})

ipcMain.handle('ai-request', async (_, { prompt, tier, workflow, keys }) => {
  return await orchestrator.process(prompt, tier, workflow, keys, (msg: string) => {
    win?.webContents.send('agent-thinking-log', msg)
  })
})

ipcMain.handle('terminal-exec', async (_, { command }) => {
  return await sandbox.execute(command)
})

// ── EYES: Scan the webview for interactive elements ──────────────────────────
ipcMain.handle('get-browser-state', async () => {
  try {
    const { webContents } = require('electron')
    const allWc = webContents.getAllWebContents()
    const webview = allWc.find((wc: any) => wc.getType() === 'webview')

    if (!webview) return { status: 'error', message: 'Webview not attached yet', elements: [] }

    const elements = await webview.executeJavaScript(`
      (() => {
        const nodes = Array.from(document.querySelectorAll(
          'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="menuitem"]'
        ));
        return nodes.slice(0, 60).map(el => {
          // Robust selector priority chain: #id → [name] → [data-testid] → [aria-label] → [placeholder] → tag
          let selector = '';
          if (el.id) {
            selector = '#' + el.id;
          } else if (el.getAttribute('name')) {
            selector = el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
          } else if (el.getAttribute('data-testid')) {
            selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
          } else if (el.getAttribute('aria-label')) {
            selector = el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label') + '"]';
          } else if (el.placeholder) {
            selector = el.tagName.toLowerCase() + '[placeholder="' + el.placeholder + '"]';
          } else {
            selector = el.tagName.toLowerCase();
          }
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || '').trim().slice(0, 40),
            selector: selector,
            ariaLabel: el.getAttribute('aria-label') || '',
            placeholder: el.placeholder || '',
            type: el.type || '',
          };
        });
      })()
    `)
    return { status: 'success', elements }
  } catch (error: any) {
    console.error('[Main] get-browser-state failed:', error.message)
    return { status: 'error', message: error.message, elements: [] }
  }
})

// ── HANDS: Execute a DOM action inside the webview ───────────────────────────
ipcMain.handle('dom-action', async (_, { selector, action, value }) => {
  try {
    const { webContents } = require('electron')
    const allWc = webContents.getAllWebContents()
    const webview = allWc.find((wc: any) => wc.getType() === 'webview')

    if (!webview) return { status: 'error', message: 'Webview not attached yet' }

    const safeSelector = String(selector).replace(/"/g, '\\"')
    const safeValue = String(value || '').replace(/`/g, '\\`').replace(/\\/g, '\\\\')

    if (action === 'dom_click') {
      const script = `
        (() => {
          const el = document.querySelector("${safeSelector}");
          if (!el) throw new Error("Selector not found: ${safeSelector}");
          el.focus();
          el.click();
          return true;
        })()
      `
      await webview.executeJavaScript(script)
    } else if (action === 'dom_type') {
      const script = `
        (() => {
          const el = document.querySelector("${safeSelector}");
          if (!el) throw new Error("Selector not found: ${safeSelector}");
          el.focus();
          el.value = \`${safeValue}\`;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `
      await webview.executeJavaScript(script)
    } else {
      return { status: 'error', message: `Unknown action: ${action}` }
    }

    return { status: 'success' }
  } catch (error: any) {
    console.error('[Main] dom-action failed:', error.message)
    return { status: 'error', message: error.message }
  }
})

ipcMain.handle('get-quotas', () => {
  return orchestrator.getQuotas()
})

ipcMain.handle('get-settings', () => {
  const settings: Record<string, any> = {}
  const keys = ['GOOGLE_KEYS', 'OPENAI_KEYS', 'GROQ_KEYS', 'MASTER_KB']
  // @ts-ignore
  keys.forEach(k => settings[k] = orchestrator.store.get(k) || '')
  return settings
})

ipcMain.handle('parse-pdf', async (_, { path }) => {
  try {
    const pdf = require('pdf-parse')
    const dataBuffer = fs.readFileSync(path)
    const data = await pdf(dataBuffer)
    return { status: 'success', text: data.text }
  } catch (error: any) {
    console.error('[Main] PDF Parse Failed:', error)
    return { status: 'error', message: error.message }
  }
})

ipcMain.handle('save-settings', (_, settings) => {
  Object.entries(settings).forEach(([k, v]) => {
    // @ts-ignore
    orchestrator.store.set(k, v)
  })
  orchestrator.initProviders()
  return { status: 'success' }
})

// ── Helper: find the active webview WebContents ──────────────────────────
function getWebview() {
  const { webContents } = require('electron')
  const allWc = webContents.getAllWebContents()
  return allWc.find((wc: any) => wc.getType() === 'webview') || null
}

// ── Helper: capture a snapshot of the current browser state ──────────────
async function captureBrowserSnapshot(): Promise<BrowserSnapshot> {
  const webview = getWebview()
  if (!webview) return { url: '', title: '', elements: [] }

  try {
    const snapshot = await webview.executeJavaScript(`
      (() => {
        const nodes = Array.from(document.querySelectorAll(
          'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="menuitem"]'
        ));
        return {
          url: location.href,
          title: document.title,
          elements: nodes.slice(0, 60).map(el => {
            let selector = '';
            if (el.id) {
              selector = '#' + el.id;
            } else if (el.getAttribute('name')) {
              selector = el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
            } else if (el.getAttribute('data-testid')) {
              selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
            } else if (el.getAttribute('aria-label')) {
              selector = el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label') + '"]';
            } else if (el.placeholder) {
              selector = el.tagName.toLowerCase() + '[placeholder="' + el.placeholder + '"]';
            } else {
              selector = el.tagName.toLowerCase();
            }
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.innerText || el.value || '').trim().slice(0, 40),
              selector,
              ariaLabel: el.getAttribute('aria-label') || '',
              placeholder: el.placeholder || '',
              type: el.type || '',
            };
          })
        };
      })()
    `)
    return snapshot
  } catch (e: any) {
    console.error('[Snapshot] Failed:', e.message)
    return { url: '', title: '', elements: [] }
  }
}

// ── SCREENSHOT: Capture the webview as a base64 PNG ──────────────────────
ipcMain.handle('capture-screenshot', async () => {
  try {
    const webview = getWebview()
    if (!webview) return { status: 'error', message: 'No webview available', image: null }

    const image: NativeImage = await webview.capturePage()
    const base64 = image.toPNG().toString('base64')
    return { status: 'success', image: base64 }
  } catch (error: any) {
    console.error('[Screenshot] Failed:', error.message)
    return { status: 'error', message: error.message, image: null }
  }
})

// ── STABILITY: Wait for the page to settle after an action ───────────────
ipcMain.handle('wait-for-stability', async (_, { timeoutMs } = { timeoutMs: 5000 }) => {
  try {
    const webview = getWebview()
    if (!webview) return { status: 'error', message: 'No webview' }

    await webview.executeJavaScript(`
      new Promise((resolve) => {
        let timer = null;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => { observer.disconnect(); resolve(true); }, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        timer = setTimeout(() => { observer.disconnect(); resolve(true); }, ${timeoutMs});
      })
    `)
    return { status: 'success' }
  } catch (error: any) {
    return { status: 'error', message: error.message }
  }
})

// ── VALIDATE: Run the verify-after-action loop ───────────────────────────
ipcMain.handle('validate-action', async (_, { action, before }) => {
  try {
    const webview = getWebview()
    if (!webview) return { status: 'error', message: 'No webview' }

    const after = await captureBrowserSnapshot()
    const result = validateAction(action as ActionContext, before as BrowserSnapshot, after)

    const captcha = detectCaptcha(after)
    if (captcha) {
      return {
        validation: { status: 'escalate', reason: 'CAPTCHA detected on page — human intervention required', confidence: 10 },
        after,
        captchaDetected: true,
      }
    }

    return { validation: result, after, captchaDetected: false }
  } catch (error: any) {
    console.error('[Validate] Failed:', error.message)
    return {
      validation: { status: 'retry', reason: `Validation error: ${error.message}`, confidence: 0 },
      after: null,
      captchaDetected: false,
    }
  }
})

// ── VISION: Analyze a screenshot with a vision LLM ───────────────────────
ipcMain.handle('analyze-screenshot', async (_, { screenshotBase64, actionDescription, expectedOutcome }) => {
  try {
    const analysis = await analyzeScreenshot(screenshotBase64, actionDescription, expectedOutcome)
    return { status: 'success', analysis }
  } catch (error: any) {
    console.error('[Vision] Analysis failed:', error.message)
    return { status: 'error', message: error.message }
  }
})

// ── SNAPSHOT: Capture current browser state for before/after comparison ──
ipcMain.handle('capture-snapshot', async () => {
  try {
    const snapshot = await captureBrowserSnapshot()
    return { status: 'success', snapshot }
  } catch (error: any) {
    return { status: 'error', message: error.message, snapshot: null }
  }
})
