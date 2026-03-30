import 'dotenv/config'
import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import fs from 'fs'
import { orchestrator } from './orchestrator'
import { sandbox } from './sandbox'
import { humanInteraction } from './human_interaction'

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron Main process
// │ └─┬ preload
// │   └── index.js    > Electron Preload process
// ├─┬ dist
// │ └── index.html    > Renderer process
//
process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
// Robust pathing for the preload script
// In dev mode: __dirname = dist-electron/main, preload is at dist-electron/preload/index.js
// In prod mode: __dirname = dist-electron/main, preload is at dist-electron/preload/index.js
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

    // win.webContents.openDevTools()

    // Log if the load fails
    win.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
      console.error(`[Main] Failed to load URL: ${errorCode} - ${errorDescription}`)
    })
  } else {
    win.loadFile(indexHtml)
  }

  // Test directly communication from Main process
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
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
    // Focus on the main window if the user tried to open another
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
// Yogi: Model & Sandbox IPC Listeners
// ──────────────────────────────────────────────

ipcMain.handle('connect-browser', async () => {
  try {
    console.log('[Main] Launching Browser Session...')
    // In a real scenario, this might connect to a remote debugging port
    // or simply reload the internal webview context.
    // For now, we simulate a successful connection.
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
// --- NEW DOM EXECUTION BRIDGE ---
ipcMain.handle('dom-action', async (event, { selector, action, value }) => {
  if (!win) return { status: 'error', message: 'No active window' };

  try {
    let script = '';

    if (action === 'dom_click') {
      script = `
        (function() {
          const el = document.querySelector("${selector}");
          if (el) { el.click(); return true; }
          return false;
        })();
      `;
    } else if (action === 'dom_type') {
      script = `
        (function() {
          const el = document.querySelector("${selector}");
          if (el) { 
            el.value = \`${value}\`; 
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true; 
          }
          return false;
        })();
      `;
    }

    const success = await win.webContents.executeJavaScript(script);
    if (!success) throw new Error(`Could not find element on page: ${selector}`);

    return { status: 'success' };
  } catch (error) {
    console.error("DOM Action Failed:", error);
    return { status: 'error', message: error.message };
  }
});

ipcMain.handle('get-browser-state', async () => {
  try {
    const { webContents } = require('electron')
    const allWc = webContents.getAllWebContents()
    const webview = allWc.find(wc => wc.getType() === 'webview')

    if (!webview) return { status: 'error', message: 'Webview not found' }

    const elements = await webview.executeJavaScript(`
            (() => {
                const interactables = Array.from(document.querySelectorAll('button, a, input, textarea, [role="button"]'))
                return interactables.map(el => ({
                    tag: el.tagName.toLowerCase(),
                    text: el.innerText?.slice(0, 30) || '',
                    id: el.id || '',
                    name: el.name || '',
                    placeholder: el.placeholder || '',
                    ariaLabel: el.getAttribute('aria-label') || '',
                    selector: el.id ? '#' + el.id : el.className ? (el.tagName.toLowerCase() + '.' + el.className.split(' ').join('.')) : el.tagName.toLowerCase()
                })).slice(0, 50) 
            })()
        `)
    return { status: 'success', elements }
  } catch (error: any) {
    return { status: 'error', message: error.message }
  }
})

ipcMain.handle('dom-action', async (_, { selector, action, value }) => {
  try {
    const { webContents } = require('electron')
    const allWc = webContents.getAllWebContents()
    const webview = allWc.find(wc => wc.getType() === 'webview')

    if (!webview) return { status: 'error', message: 'Webview not found' }

    await webview.executeJavaScript(\`
            (() => {
                const el = document.querySelector("\${selector}");
                if (!el) throw new Error("Selector not found: " + "\${selector}");
                if ("\${action}" === 'click') {
                   el.click();
                } else if ("\${action}" === 'type') {
                   el.focus();
                   el.value = "\${value}";
                   el.dispatchEvent(new Event('input', { bubbles: true }));
                   el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            })()
        \`)
        return { status: 'success' }
    } catch (error: any) {
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
    // 🟢 LAZY LOAD: Prevents the library from crashing on startup
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
  // Re-init providers with new multi-key pools
  orchestrator.initProviders()
  return { status: 'success' }
})
