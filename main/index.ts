import 'dotenv/config'
import { app, BrowserWindow, shell, ipcMain, NativeImage, Notification, Menu, session } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import fs from 'fs'
import { orchestrator } from './orchestrator'
import { sandbox } from './sandbox'
import { humanInteraction } from './human_interaction'
import { validateAction, detectCaptcha, detectSensitiveAction, type BrowserSnapshot, type ActionContext } from './validator'
import { analyzeScreenshot } from './vision'

// ── Mac / Apple Silicon compatibility flags ────────────────────────────────
// Must be set BEFORE app is ready
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// ── Path resolution ────────────────────────────────────────────────────────
// Use app.getAppPath() for reliable resolution inside .asar packages
process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = app.isPackaged
  ? join(app.getAppPath(), 'dist')
  : join(__dirname, '../../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(__dirname, '../../public')
  : process.env.DIST

if (release().startsWith('6.1')) app.disableHardwareAcceleration()

if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preloadPath = app.isPackaged
  ? join(app.getAppPath(), 'dist-electron', 'preload', 'index.js')
  : join(__dirname, '../preload/index.js')

const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'Yogi Browser',
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      devTools: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      spellcheck: false,
    },
  })

  // ── Mac: remove default menu bar ────────────────────────────────────────
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ]))
  } else {
    Menu.setApplicationMenu(null)
  }

  // ── Mac: grant all permissions for webview automation ───────────────────
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process gone:', details)
    if (details.reason !== 'clean-exit') {
      setTimeout(() => { if (win) win.reload() }, 1000)
    }
  })

  win.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
    console.error(`[Main] Failed to load: ${errorCode} - ${errorDescription}`)
    console.error('[Main] Attempted path:', indexHtml)
    console.error('[Main] DIST:', process.env.DIST)
    console.error('[Main] isPackaged:', app.isPackaged)
    console.error('[Main] appPath:', app.getAppPath())
  })

  if (url) {
    console.log(`[Main] Dev mode: connecting to ${url}`)
    win.loadURL(url)
  } else {
    console.log(`[Main] Production: loading ${indexHtml}`)
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

// ── Default API key seeding ───────────────────────────────────────────────
// If no keys are saved yet, use the default key compiled in at build time.
// Set DEFAULT_GROQ_KEY env var before running `npm run electron:build`.
function seedDefaultKeys() {
  const DEFAULT_GROQ  = (process.env.DEFAULT_GROQ_KEY  || '').trim()
  const DEFAULT_OAI   = (process.env.DEFAULT_OPENAI_KEY || '').trim()
  const DEFAULT_GMN   = (process.env.DEFAULT_GOOGLE_KEY || '').trim()

  if (DEFAULT_GROQ && !orchestrator.store.get('GROQ_KEYS')) {
    orchestrator.store.set('GROQ_KEYS', DEFAULT_GROQ)
    console.log('[Keys] Seeded default Groq key from build config')
  }
  if (DEFAULT_OAI && !orchestrator.store.get('OPENAI_KEYS')) {
    orchestrator.store.set('OPENAI_KEYS', DEFAULT_OAI)
    console.log('[Keys] Seeded default OpenAI key from build config')
  }
  if (DEFAULT_GMN && !orchestrator.store.get('GOOGLE_KEYS')) {
    orchestrator.store.set('GOOGLE_KEYS', DEFAULT_GMN)
    console.log('[Keys] Seeded default Google key from build config')
  }

  orchestrator.initProviders()
}

app.whenReady().then(() => {
  seedDefaultKeys()
  createWindow()
})

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
        const maxTimeout = ${timeoutMs || 5000};
        let domQuiet = false;
        let netIdle = false;
        let domTimer = null;
        let pendingRequests = 0;

        function checkDone() {
          if (domQuiet && netIdle) { cleanup(); resolve(true); }
        }

        const observer = new MutationObserver(() => {
          clearTimeout(domTimer);
          domTimer = setTimeout(() => { domQuiet = true; checkDone(); }, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        domTimer = setTimeout(() => { domQuiet = true; checkDone(); }, 500);

        const origFetch = window.fetch;
        window.fetch = function() {
          pendingRequests++;
          return origFetch.apply(this, arguments).finally(() => {
            pendingRequests--;
            if (pendingRequests <= 0) { netIdle = true; checkDone(); }
          });
        };

        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function() { return origOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function() {
          pendingRequests++;
          this.addEventListener('loadend', () => {
            pendingRequests--;
            if (pendingRequests <= 0) { netIdle = true; checkDone(); }
          }, { once: true });
          return origSend.apply(this, arguments);
        };

        setTimeout(() => { netIdle = true; checkDone(); }, 1500);

        function cleanup() {
          observer.disconnect();
          clearTimeout(domTimer);
          window.fetch = origFetch;
          XMLHttpRequest.prototype.open = origOpen;
          XMLHttpRequest.prototype.send = origSend;
        }

        setTimeout(() => { cleanup(); resolve(true); }, maxTimeout);
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
    let result = validateAction(action as ActionContext, before as BrowserSnapshot, after)

    const captcha = detectCaptcha(after)
    if (captcha) {
      return {
        validation: { status: 'escalate', reason: 'CAPTCHA detected on page — human intervention required', confidence: 10 },
        after,
        captchaDetected: true,
      }
    }

    const sensitive = detectSensitiveAction(after, action as ActionContext)
    if (sensitive) {
      return {
        validation: { status: 'escalate', reason: `Sensitive action detected: ${sensitive}`, confidence: 5 },
        after,
        captchaDetected: false,
        sensitiveDetected: true,
      }
    }

    if (result.confidence > 30 && result.confidence < 60) {
      try {
        const llmResult = await orchestrator.validateWithLLM(action, before, after)
        if (llmResult) result = llmResult
      } catch (e: any) {
        console.error('[Validate] LLM fallback failed:', e.message)
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

// ── NOTIFICATION: Fire a desktop notification ────────────────────────────
ipcMain.handle('show-notification', async (_, { title, body }) => {
  try {
    const notif = new Notification({ title: title || 'Yogi Browser', body: body || '' })
    notif.on('click', () => {
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
    notif.show()
    return { status: 'success' }
  } catch (error: any) {
    console.error('[Notification] Failed:', error.message)
    return { status: 'error', message: error.message }
  }
})

// ── MISSIONS & SKILLS PERSISTENCE ─────────────────────────────────────
import { homedir } from 'node:os'
import * as yaml from 'yaml'

const SKILLS_DIR = join(homedir(), '.yogibrowser', 'skills')

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true })
  }
}

function skillToMarkdown(skill: any): string {
  const frontmatter: any = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    priority: skill.priority,
    builtIn: skill.builtIn,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    activationTriggers: skill.activationTriggers,
  }
  return `---\n${yaml.stringify(frontmatter)}---\n\n${skill.content}`
}

function markdownToSkill(fileContent: string): any | null {
  const match = fileContent.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/)
  if (!match) return null
  try {
    const meta = yaml.parse(match[1])
    return {
      id: meta.id || '',
      name: meta.name || '',
      description: meta.description || '',
      content: match[2] || '',
      activationTriggers: meta.activationTriggers || [],
      enabled: meta.enabled !== false,
      priority: meta.priority ?? 50,
      builtIn: meta.builtIn || false,
      createdAt: meta.createdAt || Date.now(),
      updatedAt: meta.updatedAt || Date.now(),
    }
  } catch {
    return null
  }
}

function loadSkillsFromFs(): any[] {
  ensureSkillsDir()
  const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))
  const skills: any[] = []
  for (const file of files) {
    const content = fs.readFileSync(join(SKILLS_DIR, file), 'utf-8')
    const skill = markdownToSkill(content)
    if (skill) skills.push(skill)
  }
  return skills
}

function saveSkillToFs(skill: any) {
  ensureSkillsDir()
  const safeName = skill.id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filePath = join(SKILLS_DIR, `${safeName}.md`)
  fs.writeFileSync(filePath, skillToMarkdown(skill), 'utf-8')
}

function saveAllSkillsToFs(skills: any[]) {
  ensureSkillsDir()
  const existing = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))
  for (const f of existing) {
    fs.unlinkSync(join(SKILLS_DIR, f))
  }
  for (const skill of skills) {
    saveSkillToFs(skill)
  }
}

ipcMain.handle('get-missions', () => {
  return (orchestrator.store.get('missions') as any[]) || []
})

ipcMain.handle('save-missions', (_, missions) => {
  orchestrator.store.set('missions', missions)
  return { status: 'success' }
})

ipcMain.handle('get-skills', () => {
  try {
    const fsSkills = loadSkillsFromFs()
    if (fsSkills.length > 0) return fsSkills
  } catch (e: any) {
    console.warn('[Skills] Filesystem load failed, falling back to store:', e.message)
  }
  return (orchestrator.store.get('skills') as any[]) || []
})

ipcMain.handle('save-skills', (_, skills) => {
  try {
    saveAllSkillsToFs(skills)
  } catch (e: any) {
    console.warn('[Skills] Filesystem save failed, falling back to store:', e.message)
  }
  orchestrator.store.set('skills', skills)
  return { status: 'success' }
})

ipcMain.handle('inject-skills', (_, { content }) => {
  orchestrator.setActiveSkills(content || '')
  return { status: 'success' }
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
