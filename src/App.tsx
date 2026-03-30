import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Send, ShieldCheck, Settings, X, Rocket, Play, Pause, ChevronDown, ChevronUp, Clock, CheckCircle, AlertTriangle, XCircle, Target, BookOpen, Square, Home, Activity } from 'lucide-react'
import { Mission, Skill } from './types/mission'
import { DEFAULT_SKILLS } from './data/skills'
import MissionEditor from './components/MissionEditor'
import SkillsLibrary from './components/SkillsLibrary'
import OnboardingScreen from './components/OnboardingScreen'
import BrowserHomePage from './components/BrowserHomePage'
import ActivityReport, { ActivityEntry } from './components/ActivityReport'
import { useMissionRunner, SESSION_ID } from './hooks/useMissionRunner'

// Detect Electron: window.yogi is set by the preload bridge at startup
const isElectron = !!(window as any).yogi

// Height (px) reserved for the agent action overlay banner in Electron mode
// Reduced to 0 — thinking is now shown inline in chat (ThinkingBlock)
const OVERLAY_BANNER_H = 0

// ──────────────────────────────────────────────
// MOCK MODE — Web preview simulation layer
// Active whenever isElectron is false.
// Nothing below touches real Electron APIs.
// ──────────────────────────────────────────────

type MockElement = { tag: string; text: string; selector: string; ariaLabel?: string; placeholder?: string }

const MOCK_BROWSER_MAPS: Record<string, MockElement[]> = {
  reddit_post: [
    { tag: 'button', text: 'Create Post',       selector: '.create-post-button',            ariaLabel: 'Create Post' },
    { tag: 'input',  text: '',                  selector: 'input[name="title"]',            placeholder: 'Title' },
    { tag: 'textarea', text: '',                selector: 'textarea[name="text"]',          placeholder: 'Text (optional)' },
    { tag: 'button', text: 'Post',              selector: 'button[type="submit"].submit',   ariaLabel: 'Post' },
    { tag: 'a',      text: 'r/sales',           selector: 'a[href="/r/sales/"]' },
    { tag: 'input',  text: '',                  selector: 'input[placeholder="Search"]',    placeholder: 'Search' },
    { tag: 'button', text: 'Log In',            selector: '.login-button' },
  ],
  reddit_reply: [
    { tag: 'button', text: 'Reply',             selector: 'button.reply-button',            ariaLabel: 'Reply' },
    { tag: 'textarea', text: '',                selector: 'div[contenteditable="true"].notranslate', placeholder: 'What are your thoughts?' },
    { tag: 'button', text: 'Save',              selector: 'button.save-button' },
    { tag: 'a',      text: 'View comments',     selector: 'a[data-testid="comments-page-link"]' },
    { tag: 'button', text: 'Upvote',            selector: 'button[aria-label="upvote"]',    ariaLabel: 'upvote' },
    { tag: 'button', text: 'Share',             selector: 'button[aria-label="Share"]',     ariaLabel: 'Share' },
  ],
  linkedin: [
    { tag: 'input',  text: '',                  selector: 'input#search-keywords',          placeholder: 'Search' },
    { tag: 'button', text: 'Connect',           selector: 'button[aria-label="Connect"]',   ariaLabel: 'Connect' },
    { tag: 'button', text: 'Message',           selector: 'button[aria-label="Message"]',   ariaLabel: 'Message' },
    { tag: 'textarea', text: '',               selector: 'div.msg-form__contenteditable',  placeholder: 'Write a message…' },
    { tag: 'button', text: 'Send',             selector: 'button.msg-form__send-button',   ariaLabel: 'Send' },
    { tag: 'button', text: 'Follow',           selector: 'button[aria-label="Follow"]',    ariaLabel: 'Follow' },
  ],
}

function mockBrowserState(workflow: string): MockElement[] {
  return MOCK_BROWSER_MAPS[workflow] ?? MOCK_BROWSER_MAPS['reddit_post']
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type ExecLogEntry = {
  id: string
  timestamp: number
  action: string
  description: string
  selector?: string
  status: 'running' | 'success' | 'retry' | 'escalate' | 'skipped'
  reason?: string
  confidence?: number
  retries?: number
  elapsed?: number
}

const SAFETY_PATTERNS = [
  { field: 'type', values: ['password'] },
  { field: 'selector', values: ['credit-card', 'card-number', 'cvv', 'cvc', 'expiry'] },
  { field: 'text', values: ['pay now', 'purchase', 'buy now', 'place order', 'confirm payment'] },
  { field: 'text', values: ['delete', 'remove', 'destroy', 'erase', 'permanently'] },
  { field: 'ariaLabel', values: ['delete', 'remove', 'pay', 'purchase'] },
]

function isSafetyRailTask(task: any, elements: any[]): string | null {
  const taskCtx = `${task.description || ''} ${task.payload?.selector || ''} ${task.payload?.value || ''}`.toLowerCase()
  for (const pattern of SAFETY_PATTERNS) {
    for (const val of pattern.values) {
      if (taskCtx.includes(val.toLowerCase())) {
        return `Safety rail: "${val}" detected in task — requires manual approval`
      }
    }
  }

  const sel = task.payload?.selector
  const matchEl = elements.find((e: any) => e.selector === sel)
  if (matchEl) {
    const ctx = `${matchEl.text || ''} ${matchEl.ariaLabel || ''} ${matchEl.placeholder || ''} ${matchEl.selector || ''} ${matchEl.type || ''}`.toLowerCase()
    for (const pattern of SAFETY_PATTERNS) {
      for (const val of pattern.values) {
        if (ctx.includes(val.toLowerCase())) {
          return `Safety rail: element contains "${val}" — requires manual approval`
        }
      }
    }
  }
  return null
}

function playEscalationChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)

    osc.frequency.setValueAtTime(523.25, ctx.currentTime)
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15)
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.8)
  } catch (e) {}
}

async function fireNotification(title: string, body: string) {
  if (isElectron) {
    try {
      await (window as any).yogi.showNotification(title, body)
    } catch (e) {}
  } else {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body })
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission()
        if (perm === 'granted') new Notification(title, { body })
      }
    } catch (e) {}
  }
}

async function mockAIResponse(
  userInput: string,
  workflow: string,
  elements: MockElement[]
): Promise<{ thought: string; tasks: any[] }> {
  await sleep(900) // simulate network latency

  const lower = userInput.toLowerCase()
  const tasks: any[] = []

  // Pick tasks contextually from the mock element map
  if (lower.includes('post') || lower.includes('submit') || lower.includes('create')) {
    const titleEl  = elements.find(e => e.placeholder?.toLowerCase().includes('title') || e.selector.includes('title'))
    const submitEl = elements.find(e => e.text.toLowerCase().includes('post') || e.selector.includes('submit'))
    const createEl = elements.find(e => e.text.toLowerCase().includes('create') || e.selector.includes('create'))

    if (createEl) tasks.push({
      action: 'dom_click',
      description: `Click "${createEl.text || 'Create'}" to open the post composer`,
      payload: { selector: createEl.selector },
    })
    if (titleEl) tasks.push({
      action: 'dom_type',
      description: 'Type the post title into the title field',
      payload: { selector: titleEl.selector, value: `[AI-generated title for: ${userInput.slice(0, 40)}]` },
    })
    if (submitEl) tasks.push({
      action: 'dom_click',
      description: `Click "${submitEl.text || 'Submit'}" to publish the post`,
      payload: { selector: submitEl.selector },
    })
  } else if (lower.includes('reply') || lower.includes('comment')) {
    const replyEl   = elements.find(e => e.text.toLowerCase().includes('reply') || e.selector.includes('reply'))
    const textEl    = elements.find(e => e.tag === 'textarea' || e.selector.includes('contenteditable'))
    const saveEl    = elements.find(e => e.text.toLowerCase().includes('save') || e.selector.includes('save'))

    if (replyEl)  tasks.push({ action: 'dom_click', description: 'Open the reply composer', payload: { selector: replyEl.selector } })
    if (textEl)   tasks.push({ action: 'dom_type',  description: 'Type the reply text', payload: { selector: textEl.selector, value: `[AI-generated reply to: ${userInput.slice(0, 40)}]` } })
    if (saveEl)   tasks.push({ action: 'dom_click', description: 'Submit the reply', payload: { selector: saveEl.selector } })
  } else if (lower.includes('message') || lower.includes('connect') || lower.includes('linkedin')) {
    const connectEl = elements.find(e => e.ariaLabel?.toLowerCase().includes('connect') || e.text.toLowerCase().includes('connect'))
    const msgEl     = elements.find(e => e.tag === 'textarea' || e.selector.includes('contenteditable'))
    const sendEl    = elements.find(e => e.text.toLowerCase().includes('send') || e.selector.includes('send'))

    if (connectEl) tasks.push({ action: 'dom_click', description: 'Click Connect to send a connection request', payload: { selector: connectEl.selector } })
    if (msgEl)     tasks.push({ action: 'dom_type',  description: 'Type the outreach message', payload: { selector: msgEl.selector, value: `[AI-generated outreach: ${userInput.slice(0, 40)}]` } })
    if (sendEl)    tasks.push({ action: 'dom_click', description: 'Click Send to deliver the message', payload: { selector: sendEl.selector } })
  } else if (lower.includes('search') || lower.includes('find')) {
    const searchEl = elements.find(e =>
      e.placeholder?.toLowerCase().includes('search') ||
      e.selector.toLowerCase().includes('search') ||
      e.ariaLabel?.toLowerCase().includes('search') ||
      e.text?.toLowerCase().includes('search')
    )
    const typeable = searchEl || elements.find(e => e.tag === 'input' || e.tag === 'textarea')
    if (typeable) {
      tasks.push({ action: 'dom_type', description: 'Type search query into the search bar', payload: { selector: typeable.selector, value: userInput } })
      tasks.push({ action: 'dom_press_enter', description: 'Press Enter to run the search', payload: { selector: typeable.selector, value: userInput } })
    }
  } else {
    // Generic fallback — pick first clickable, then first typeable
    const clickable = elements.find(e => e.tag === 'button' || e.tag === 'a')
    const typeable  = elements.find(e => e.tag === 'input' || e.tag === 'textarea')
    if (clickable) tasks.push({ action: 'dom_click', description: `Click ${clickable.text || clickable.selector}`, payload: { selector: clickable.selector } })
    if (typeable)  tasks.push({ action: 'dom_type',  description: `Type into ${typeable.placeholder || typeable.selector}`, payload: { selector: typeable.selector, value: userInput } })
  }

  // Guarantee at least 2 tasks — pad with first unused clickable/typeable elements
  // For search/find intents, NEVER add nav links as padding — only inputs
  const isSearchIntent = lower.includes('search') || lower.includes('find') || lower.includes('look for')
  if (tasks.length < 2) {
    const usedSelectors = new Set(tasks.map((t: any) => t.payload?.selector))
    // Skip navigation links (About, Store, Help, Sign in, etc.) to avoid accidental page nav
    const navWords = ['about', 'store', 'help', 'sign in', 'sign up', 'login', 'register', 'privacy', 'terms', 'contact']
    const isSafeClickable = (e: MockElement) =>
      (e.tag === 'button' || e.tag === 'a') &&
      !usedSelectors.has(e.selector) &&
      !navWords.some(w => e.text.toLowerCase().includes(w))
    const clickable = isSearchIntent ? null : elements.find(isSafeClickable)
    const typeable  = elements.find(e => (e.tag === 'input' || e.tag === 'textarea') && !usedSelectors.has(e.selector))
    if (tasks.length < 1) {
      if (typeable) {
        // Prefer typing over clicking nav links
        tasks.push({ action: 'dom_type', description: `Type into ${typeable.placeholder || typeable.selector}`, payload: { selector: typeable.selector, value: userInput } })
        usedSelectors.add(typeable.selector)
      } else if (clickable) {
        tasks.push({ action: 'dom_click', description: `Click "${clickable.text || clickable.selector}"`, payload: { selector: clickable.selector } })
        usedSelectors.add(clickable.selector)
      }
    }
    if (tasks.length < 2) {
      const filler = typeable && !usedSelectors.has(typeable.selector) ? typeable : null
      if (filler) {
        tasks.push({ action: 'dom_type', description: `Type into ${filler.placeholder || filler.selector}`, payload: { selector: filler.selector, value: userInput } })
      } else if (!isSearchIntent) {
        const safeEl = elements.find(e => !usedSelectors.has(e.selector) && isSafeClickable(e))
        if (safeEl) tasks.push({ action: 'dom_click', description: `Click "${safeEl.text || safeEl.selector}"`, payload: { selector: safeEl.selector } })
      }
    }
  }

  const workflowLabel: Record<string, string> = {
    reddit_post:  'Reddit Poster',
    reddit_reply: 'Reddit Replier',
    linkedin:     'LinkedIn Outreach',
  }

  const thought = tasks.length
    ? `I've planned ${tasks.length} action${tasks.length > 1 ? 's' : ''} for the ${workflowLabel[workflow] ?? workflow} workflow. Review the queue below and approve each step.`
    : `I couldn't map that request to specific page elements. Try a more specific command like "create a post" or "reply to the top comment".`

  return { thought, tasks }
}

// ──────────────────────────────────────────────
// Chat Bubble Component
// ──────────────────────────────────────────────
const MODEL_BADGE_COLORS: Record<string, string> = {
  'Gemini 1.5 Pro':   '#4285f4',
  'Gemini 1.5 Flash': '#4285f4',
  'Groq Llama 3.3':   '#f55036',
  'GPT-4o':           '#10a37f',
}

const ChatBubble = ({ message, role, model }: { message: string, role: 'agent' | 'user', model?: string }) => (
  <div className={`chat-bubble ${role}`}>
    {message}
    {role === 'agent' && model && (
      <span className="model-badge" style={{ background: MODEL_BADGE_COLORS[model] || 'rgba(255,255,255,0.1)' }}>
        {model}
      </span>
    )}
  </div>
)

// ──────────────────────────────────────────────
// ThinkingBlock: inline collapsible reasoning block
// ──────────────────────────────────────────────
const ThinkingBlock = ({ logs, logsStart, status, summary }: {
  logs: string[]
  logsStart: number
  status: 'thinking' | 'done'
  summary?: string
}) => {
  const [expanded, setExpanded] = useState(true)
  const logsRef = useRef<HTMLDivElement>(null)
  const myLogs = logs.slice(logsStart)

  useEffect(() => {
    if (status === 'done') setExpanded(false)
  }, [status])

  useEffect(() => {
    if (expanded && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [myLogs.length, expanded])

  return (
    <div className={`thinking-block ${status}`}>
      <button type="button" className="thinking-block-header" onClick={() => setExpanded(v => !v)}>
        <span className={`thinking-block-dot ${status === 'thinking' ? 'pulse' : ''}`} />
        <span className="thinking-block-title">
          {status === 'thinking' ? 'Thinking…' : 'Thought process'}
        </span>
        {status === 'done' && summary && (
          <span className="thinking-block-summary">{summary.length > 55 ? summary.slice(0, 55) + '…' : summary}</span>
        )}
        <ChevronDown size={12} className={`thinking-block-chevron ${expanded ? 'open' : ''}`} />
      </button>
      {expanded && myLogs.length > 0 && (
        <div className="thinking-block-logs" ref={logsRef}>
          {myLogs.map((log, i) => (
            <div key={i} className="thinking-block-log-line">
              <span className="thinking-log-prefix">&gt;</span>
              {log}
            </div>
          ))}
          {status === 'thinking' && <div className="thinking-cursor-line"><span className="thinking-cursor" /></div>}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// PlanCard: inline per-task approval card
// ──────────────────────────────────────────────
const PlanCard = ({ planId, tasks, onApprove, autoPilotOn }: {
  planId: string
  tasks: any[]
  onApprove: (planId: string, taskId: string) => void
  autoPilotOn: boolean
}) => {
  const doneCount = tasks.filter((t: any) => t.status === 'done').length
  const allDone = doneCount === tasks.length && tasks.length > 0

  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <span className="plan-card-title">Plan</span>
        <span className="plan-card-count">{doneCount}/{tasks.length} done</span>
        {autoPilotOn && !allDone && <span className="plan-auto-pill">AUTO</span>}
      </div>
      <div className="plan-card-tasks">
        {tasks.map((t: any, i: number) => (
          <div key={t.id} className={`plan-task plan-task-${t.status || 'pending'}`}>
            <div className="plan-task-num">{i + 1}</div>
            <div className="plan-task-body">
              <span className="plan-task-action">{(t.action || '').replace('dom_', '').toUpperCase()}</span>
              <div className="plan-task-desc">{t.description}</div>
              {t.payload?.selector && <code className="task-selector">{t.payload.selector}</code>}
              {t.confidence != null && (
                <span className="plan-task-conf">{t.confidence}% confidence</span>
              )}
            </div>
            <div className="plan-task-ctrl">
              {(t.status == null || t.status === 'pending') && (
                <button type="button" className="approve-btn" onClick={() => onApprove(planId, t.id)}>
                  <ShieldCheck size={12} style={{ marginRight: 4 }} />Approve
                </button>
              )}
              {t.status === 'running' && (
                <span className="plan-badge running"><RotateCw size={11} className="spin" style={{ marginRight: 3 }} />Running</span>
              )}
              {t.status === 'done' && <span className="plan-badge done"><CheckCircle size={12} /></span>}
              {t.status === 'failed' && <span className="plan-badge failed"><XCircle size={12} /></span>}
              {t.status === 'skipped' && <span className="plan-badge skipped"><Pause size={11} /></span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// InlineErrorBlock: retry/problem notification
// ──────────────────────────────────────────────
const InlineErrorBlock = ({ what, retry }: { what: string; retry: string }) => (
  <div className="inline-error-block">
    <div className="inline-error-header">
      <AlertTriangle size={13} />
      <span>Problem encountered</span>
    </div>
    <div className="inline-error-what">{what}</div>
    {retry && <div className="inline-error-retry">→ {retry}</div>}
  </div>
)

// ──────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────
const App = () => {
  const [messages, setMessages] = useState<any[]>([
    { id: 'init', type: 'message', role: 'agent', message: '🚀 Yogi is online. Ready to automate Open Humana sales. How can I help?' }
  ])
  const messagesRef = useRef<any[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])
  const [input, setInput] = useState('')
  const [tasks, setTasks] = useState<any[]>([])
  const [workflow, setWorkflow] = useState('reddit_post')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<any>({})
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [geminiKeyError, setGeminiKeyError] = useState('')
  const [quotas, setQuotas] = useState<any>(null)
  const [notification, setNotification] = useState<{ message: string, type: 'info' | 'alert' } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const [autoPilot, setAutoPilot] = useState(false)
  const autoPilotRef = useRef(false)
  const [escalation, setEscalation] = useState<{ message: string; taskId?: string } | null>(null)

  const [sidePanel, setSidePanel] = useState<'chat' | 'missions' | 'skills' | 'activity'>('chat')
  const [missions, setMissions] = useState<Mission[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeMission, setActiveMission] = useState<Mission | null>(null)
  const [executionLog, setExecutionLog] = useState<ExecLogEntry[]>([])
  const [showExecLog, setShowExecLog] = useState(false)
  const [autoExecuting, setAutoExecuting] = useState(false)
  const autoExecutingRef = useRef(false)
  const sessionStartRef = useRef<number>(Date.now())

  const [activityLog, setActivityLog] = useState<ActivityEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('yogi_activity_log') || '[]')
    } catch { return [] }
  })

  useEffect(() => { autoPilotRef.current = autoPilot }, [autoPilot])
  useEffect(() => { autoExecutingRef.current = autoExecuting }, [autoExecuting])

  const addExecLog = useCallback((entry: Omit<ExecLogEntry, 'id' | 'timestamp'>) => {
    setExecutionLog(prev => [...prev, {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    }])
  }, [])

  const updateExecLog = useCallback((id: string, updates: Partial<ExecLogEntry>) => {
    setExecutionLog(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
  }, [])

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(parseInt(localStorage.getItem('sidebarWidth') || '400'))
  const [isResizing, setIsResizing] = useState(false)

  // Browser state
  // In web mode all pages go through the /__proxy endpoint (strips X-Frame-Options)
  const proxyUrl = (target: string) => `/__proxy?url=${encodeURIComponent(target)}`
  const HOME_URL = 'yogi://home'
  const [url, setUrl] = useState(HOME_URL)
  const [inputUrl, setInputUrl] = useState('')

  // Real DOM elements reported by the Yogi bridge script inside the proxy iframe
  const proxyElementsRef = useRef<any[]>([])
  const [proxyElements, setProxyElements] = useState<any[]>([])

  const cachedBrowserElementsRef = useRef<any[]>([])

  const refreshBrowserElements = useCallback(async () => {
    if (isElectron) {
      try {
        const state = await (window as any).yogi.getBrowserState()
        if (state?.status === 'success' && state.elements) {
          cachedBrowserElementsRef.current = state.elements
        }
      } catch {}
    } else {
      cachedBrowserElementsRef.current = proxyElementsRef.current
    }
    return cachedBrowserElementsRef.current
  }, [])

  const webviewRef = useRef<any>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<any>(null)
  const chatFeedRef = useRef<any>(null)

  // ── Resize sidebar ──────────────────────────────────────
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => setIsResizing(false), [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX
      if (newWidth > 280 && newWidth < 800) {
        setSidebarWidth(newWidth)
        localStorage.setItem('sidebarWidth', newWidth.toString())
      }
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize)
      window.addEventListener('mouseup', stopResizing)
    } else {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  // ── BrowserView: unified bounds computation ──────────────────────────────
  // Single source of truth for where the BrowserView should be placed.
  // Refs allow the resize observer callback to always read the latest state
  // without being torn down and recreated on every state change.
  const showSettingsRef = useRef(showSettings)
  const isThinkingRef = useRef(false) // populated below after isThinking is declared
  useEffect(() => { showSettingsRef.current = showSettings }, [showSettings])

  const applyBrowserBounds = useCallback(() => {
    if (!isElectron) return
    const yogi = (window as any).yogi
    if (!yogi?.browserSetBounds) return
    if (showSettingsRef.current) {
      // Push off-screen so modals are not obscured
      yogi.browserSetBounds(0, 0, 0, 0)
      return
    }
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    // When the agent is thinking, reserve OVERLAY_BANNER_H px at the top of the
    // viewport for the DOM overlay banner (BrowserView is a native layer that
    // would otherwise cover it). This is an intentional product tradeoff:
    // the topmost strip of the viewport shows the status banner rather than
    // browser content while the agent is active.
    const topOffset = isThinkingRef.current ? OVERLAY_BANNER_H : 0
    yogi.browserSetBounds(
      Math.round(r.left),
      Math.round(r.top) + topOffset,
      Math.round(r.width),
      Math.round(r.height) - topOffset,
    )
  }, [])

  // ── BrowserView: send pixel bounds on resize / layout changes ────────────
  useEffect(() => {
    if (!isElectron) return

    const ro = new ResizeObserver(applyBrowserBounds)
    if (viewportRef.current) ro.observe(viewportRef.current)
    window.addEventListener('resize', applyBrowserBounds)
    // Delay the initial bounds read with two chained rAFs + 500ms safety timeout
    // so the bounds are only sent after win.maximize() has fully completed and
    // the React flex layout has settled. This prevents the 0,0 flash.
    let raf1: number, raf2: number
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        applyBrowserBounds()
      })
    })
    const t = setTimeout(applyBrowserBounds, 500)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', applyBrowserBounds)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(t)
    }
  }, [isElectron, applyBrowserBounds])

  // ── BrowserView: listen for URL/load events from main process ────────────
  useEffect(() => {
    if (!isElectron) return
    const yogi = (window as any).yogi
    yogi?.onBrowserUrlChanged?.((newUrl: string) => {
      // Ignore the file:// URL from start.html — the UI state stays at HOME_URL
      if (newUrl.includes('start.html') && newUrl.startsWith('file://')) return
      setUrl(newUrl)
      setInputUrl(newUrl)
    })
    yogi?.onBrowserLoadFailed?.((data: any) => {
      if (data.errorCode !== -3) {
        setNotification({ message: `Browser error: ${data.errorDescription}`, type: 'alert' })
      }
    })
  }, [isElectron])

  // ── BrowserView: initial page load ──────────────────────────────────────
  // Navigate to the home sentinel on startup. In the main process this resolves
  // to file://...public/start.html which loads instantly without any network request.
  useEffect(() => {
    if (!isElectron) return
    const yogi = (window as any).yogi
    if (yogi?.browserNavigate) {
      yogi.browserNavigate(HOME_URL)
    }
  }, [isElectron])

  // ── BrowserView: re-apply bounds when modal state changes ────────────────
  useEffect(() => {
    applyBrowserBounds()
  }, [showSettings, applyBrowserBounds])

  // ── Settings ────────────────────────────────────────────
  useEffect(() => {
    const loadSettings = async () => {
      if (isElectron) {
        const res = await (window as any).yogi.getSettings()
        setSettings(res)
        const hasKeys = !!(res.GROQ_KEYS || res.OPENAI_KEYS || res.GOOGLE_KEYS)
        if (!hasKeys) setShowOnboarding(true)
      } else {
        const saved = localStorage.getItem('yogi_settings')
        if (saved) setSettings(JSON.parse(saved))
      }
    }
    loadSettings()
  }, [])

  const handleOnboardingComplete = useCallback(async (newSettings: any) => {
    if (Object.keys(newSettings).length > 0) {
      const merged = { ...settings, ...newSettings }
      setSettings(merged)
      if (isElectron) {
        await (window as any).yogi.saveSettings(merged)
      }
    }
    setShowOnboarding(false)
  }, [settings])

  const saveMissions = useCallback(async (missionList: Mission[]) => {
    setMissions(missionList)
    if (isElectron) {
      await (window as any).yogi.saveMissions(missionList)
    } else {
      localStorage.setItem('yogi_missions', JSON.stringify(missionList))
    }
  }, [])

  const saveSkills = useCallback(async (skillList: Skill[]) => {
    setSkills(skillList)
    if (isElectron) {
      await (window as any).yogi.saveSkills(skillList)
    } else {
      localStorage.setItem('yogi_skills', JSON.stringify(skillList))
    }
  }, [])

  useEffect(() => {
    const loadMissions = async () => {
      if (isElectron) {
        const m = await (window as any).yogi.getMissions()
        if (m && m.length) setMissions(m)
      } else {
        const saved = localStorage.getItem('yogi_missions')
        if (saved) setMissions(JSON.parse(saved))
      }
    }
    const loadSkills = async () => {
      if (isElectron) {
        const s = await (window as any).yogi.getSkills()
        setSkills(s && s.length ? s : DEFAULT_SKILLS)
      } else {
        const saved = localStorage.getItem('yogi_skills')
        setSkills(saved ? JSON.parse(saved) : DEFAULT_SKILLS)
      }
    }
    loadMissions()
    loadSkills()
  }, [])

  const [manuallyActivatedSkills, setManuallyActivatedSkills] = useState<Set<string>>(new Set())

  const handleManualSkillToggle = useCallback((skillId: string, active: boolean) => {
    setManuallyActivatedSkills(prev => {
      const next = new Set(prev)
      if (active) next.add(skillId)
      else next.delete(skillId)
      return next
    })
  }, [])

  useEffect(() => {
    const activeMissionType = activeMission?.name?.toLowerCase() || ''
    const MAX_SKILL_CHARS = 8000

    const activeSkills = skills
      .filter(s => s.enabled)
      .filter(s => {
        if (manuallyActivatedSkills.has(s.id)) return true
        return s.activationTriggers.some(t => {
          if (t.type === 'url_pattern') return inputUrl.toLowerCase().includes(t.value.toLowerCase())
          if (t.type === 'mission_type' && activeMissionType) return activeMissionType.includes(t.value.toLowerCase())
          if (t.type === 'manual') return manuallyActivatedSkills.has(s.id)
          return false
        })
      })
      .sort((a, b) => b.priority - a.priority)

    let totalChars = 0
    const budgetedSkills: typeof activeSkills = []
    for (const s of activeSkills) {
      const entryLen = s.name.length + s.content.length + 20
      if (totalChars + entryLen > MAX_SKILL_CHARS) {
        break
      }
      budgetedSkills.push(s)
      totalChars += entryLen
    }

    let content = budgetedSkills.map(s => `--- SKILL: ${s.name} ---\n${s.content}`).join('\n\n')

    if (activeMission?.knowledgeBase) {
      content = `--- MISSION KNOWLEDGE BASE: ${activeMission.name} ---\n${activeMission.knowledgeBase}\n\n${content}`
    }

    if (isElectron) {
      (window as any).yogi.injectSkills(content)
    }
  }, [inputUrl, skills, activeMission, manuallyActivatedSkills])

  const handleSaveMission = useCallback((mission: Mission) => {
    setMissions(prev => {
      const exists = prev.findIndex(m => m.id === mission.id)
      const updated = exists >= 0 ? prev.map(m => m.id === mission.id ? mission : m) : [...prev, mission]
      if (isElectron) {
        (window as any).yogi.saveMissions(updated)
      } else {
        localStorage.setItem('yogi_missions', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const handleDeleteMission = useCallback((id: string) => {
    setMissions(prev => {
      const updated = prev.filter(m => m.id !== id)
      if (isElectron) {
        (window as any).yogi.saveMissions(updated)
      } else {
        localStorage.setItem('yogi_missions', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const handleSaveSkill = useCallback((skill: Skill) => {
    setSkills(prev => {
      const exists = prev.findIndex(s => s.id === skill.id)
      const updated = exists >= 0 ? prev.map(s => s.id === skill.id ? skill : s) : [...prev, skill]
      if (isElectron) {
        (window as any).yogi.saveSkills(updated)
      } else {
        localStorage.setItem('yogi_skills', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const handleDeleteSkill = useCallback((id: string) => {
    setSkills(prev => {
      const updated = prev.filter(s => s.id !== id)
      if (isElectron) {
        (window as any).yogi.saveSkills(updated)
      } else {
        localStorage.setItem('yogi_skills', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const handleToggleSkill = useCallback((id: string, enabled: boolean) => {
    setSkills(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, enabled, updatedAt: Date.now() } : s)
      if (isElectron) {
        (window as any).yogi.saveSkills(updated)
      } else {
        localStorage.setItem('yogi_skills', JSON.stringify(updated))
      }
      return updated
    })
  }, [])

  const appendActivityLog = useCallback((entry: ActivityEntry) => {
    setActivityLog(prev => {
      const updated = [...prev, entry]
      if (isElectron) {
        (window as any).yogi?.appendActivityLog?.(entry)
      } else {
        localStorage.setItem('yogi_activity_log', JSON.stringify(updated.slice(-500)))
      }
      return updated
    })
  }, [])

  const clearActivityLog = useCallback(async () => {
    setActivityLog([])
    if (isElectron) {
      await (window as any).yogi?.clearActivityLog?.()
    } else {
      localStorage.removeItem('yogi_activity_log')
    }
  }, [])

  useEffect(() => {
    const loadActivityLog = async () => {
      if (isElectron) {
        try {
          const entries = await (window as any).yogi?.getActivityLog?.()
          if (Array.isArray(entries)) setActivityLog(entries)
        } catch {}
      }
    }
    loadActivityLog()
  }, [])

  const taskQueueRef = useRef<any[]>([])
  useEffect(() => { taskQueueRef.current = tasks }, [tasks])

  const taskDrainResolversRef = useRef<Array<() => void>>([])
  const lastAIResponseRef = useRef<string>('')

  useEffect(() => {
    if (tasks.length === 0 && taskDrainResolversRef.current.length > 0) {
      const resolvers = [...taskDrainResolversRef.current]
      taskDrainResolversRef.current = []
      resolvers.forEach(r => r())
    }
  }, [tasks])

  const missionRunner = useMissionRunner({
    sendChat: async (prompt: string): Promise<string> => {
      setInput('')
      setMessages(prev => [...prev, { role: 'agent', message: `[Mission] ${prompt.slice(0, 100)}...` }])
      let responseText = ''

      const elements = await refreshBrowserElements()
      const elementsContext = elements.length > 0
        ? `BROWSER CONTEXT — ${elements.length} interactive elements found:\n` +
          elements.map((el: any) =>
            `  [${el.tag}] text="${el.text}" selector="${el.selector}"${el.ariaLabel ? ` aria="${el.ariaLabel}"` : ''}${el.placeholder ? ` placeholder="${el.placeholder}"` : ''}`
          ).join('\n')
        : `BROWSER CONTEXT — No interactive elements detected on current page.`
      const contextPrompt = `${elementsContext}\n\nMISSION TASK:\n${prompt}`

      if (isElectron) {
        const res = await (window as any).yogi.sendChatMessage(contextPrompt, 'high', workflow, settings)
        if (res.text) {
          responseText = res.text
          setMessages(prev => [...prev, { role: 'agent', message: res.text, model: res.model || '' }])
        }
        if (res.tasks?.length) {
          setTasks(res.tasks.map((t: any, i: number) => ({
            ...t,
            id: `task-${Date.now()}-${i}`,
            confidence: typeof t.confidence === 'number' ? t.confidence : undefined,
          })))
        }
      } else {
        const mockElements = elements.length > 0 ? elements : mockBrowserState(workflow)
        const mockRes = await mockAIResponse(prompt, workflow, mockElements)
        responseText = mockRes.thought
        setMessages(prev => [...prev, { role: 'agent', message: `[Mission] ${mockRes.thought}` }])
        if (mockRes.tasks.length > 0) {
          setTasks(mockRes.tasks.map((t: any, i: number) => ({
            ...t,
            id: `task-${Date.now()}-${i}`,
          })))
        }
      }
      lastAIResponseRef.current = responseText
      return responseText
    },
    addLog: (msg: string, type?: string) => {
      setThinkingLog(msg)
      setThinkingLogs(prev => [...prev, msg])
      if (type === 'alert') {
        setNotification({ message: msg, type: 'alert' })
      }
    },
    getBrowserUrl: () => inputUrl,
    getBrowserElements: () => cachedBrowserElementsRef.current,
    navigateTo: (targetUrl: string) => {
      if (isElectron) {
        ;(window as any).yogi?.browserNavigate(targetUrl)
      } else {
        const next = proxyUrl(targetUrl)
        setUrl(next)
        setInputUrl(targetUrl)
        if (webviewRef.current) webviewRef.current.src = next
      }
      setInputUrl(targetUrl)
    },
    saveMission: (m: Mission) => handleSaveMission(m),
    onComplete: (m: Mission) => {
      setActiveMission(null)
      setNotification({ message: `Mission "${m.name}" completed!`, type: 'info' })
    },
    onPaused: (m: Mission) => {
      setActiveMission(m)
      const completedCount = m.tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length
      setNotification({
        message: `Mission "${m.name}" paused at task ${completedCount}/${m.tasks.length}`,
        type: 'alert'
      })
    },
    getTaskQueueLength: () => taskQueueRef.current.length,
    waitForTaskQueueDrain: () => {
      if (taskQueueRef.current.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        taskDrainResolversRef.current.push(resolve)
        setTimeout(resolve, 60000)
      })
    },
    getLastAIResponse: () => lastAIResponseRef.current,
    refreshBrowserElements: refreshBrowserElements,
    appendActivityLog: appendActivityLog,
  })

  const [resumeBanner, setResumeBanner] = useState<Mission | null>(null)

  useEffect(() => {
    const interrupted = missions.find(m =>
      m.status === 'active' || m.status === 'paused'
    )
    if (interrupted && !activeMission && !missionRunner.isRunning()) {
      setResumeBanner(interrupted)
    }
  }, [missions])

  const handleResumeMission = useCallback((mission: Mission) => {
    setResumeBanner(null)
    setActiveMission(mission)
    setSidePanel('chat')
    if (!autoPilotRef.current) {
      setAutoPilot(true)
      autoPilotRef.current = true
    }
    missionRunner.resumeMission(mission)
  }, [missionRunner])

  const handleDismissResume = useCallback((mission: Mission) => {
    setResumeBanner(null)
    handleSaveMission({ ...mission, status: 'draft', updatedAt: Date.now() })
  }, [handleSaveMission])

  const handleRunMission = useCallback((mission: Mission) => {
    setActiveMission(mission)
    setSidePanel('chat')
    if (!autoPilotRef.current) {
      setAutoPilot(true)
      autoPilotRef.current = true
    }
    missionRunner.runMission(mission)
  }, [missionRunner])

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isElectron) {
      await (window as any).yogi.saveSettings(settings)
    } else {
      localStorage.setItem('yogi_settings', JSON.stringify(settings))
    }
    setShowSettings(false)
    setNotification({ message: 'Settings saved. Provider pool reloaded.', type: 'info' })
  }

  // ── Thinking log ────────────────────────────────────────
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLog, setThinkingLog] = useState('Yogi is starting...')
  const [thinkingLogs, setThinkingLogs] = useState<string[]>(
    JSON.parse(localStorage.getItem('thinkingLogs') || '[]')
  )

  // Refs for tracking inline thinking/plan message IDs
  const thinkingMsgIdRef = useRef<string>('')
  const thinkingLogsLenRef = useRef<number>(0)
  const currentPlanMsgIdRef = useRef<string>('')

  // Keep thinkingLogsLenRef in sync
  useEffect(() => { thinkingLogsLenRef.current = thinkingLogs.length }, [thinkingLogs])

  useEffect(() => {
    if (isElectron) {
      (window as any).yogi.onAgentLog((msg: string) => {
        setThinkingLog(msg)
        setThinkingLogs(prev => {
          const updated = [...prev, msg]
          localStorage.setItem('thinkingLogs', JSON.stringify(updated.slice(-100)))
          return updated
        })
      })
    }
  }, [])

  // Keep isThinkingRef in sync so the unified applyBrowserBounds callback
  // always reads the latest value without needing to be recreated.
  useEffect(() => {
    isThinkingRef.current = isThinking
    applyBrowserBounds()
  }, [isThinking, applyBrowserBounds])

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight
    }
  }, [messages, isThinking])

  // ── In web mode: handle messages from the Yogi bridge inside the proxy iframe ─
  useEffect(() => {
    if (isElectron) return
    const handleMessage = (e: MessageEvent) => {
      if (!e.data?.type) return
      if (e.data.type === 'yogi-dom') {
        const els = e.data.elements || []
        proxyElementsRef.current = els
        setProxyElements(els)
        if (e.data.url) {
          // location.href inside the proxy iframe is the proxy URL —
          // extract the real target URL from the ?url= parameter
          try {
            const parsed = new URL(e.data.url)
            const realUrl = parsed.searchParams.get('url')
            setInputUrl(realUrl || e.data.url)
          } catch {
            setInputUrl(e.data.url)
          }
        }
      }
      if (e.data.type === 'yogi-navigate') {
        const next = proxyUrl(e.data.url)
        setUrl(next)
        setInputUrl(e.data.url)
        if (webviewRef.current) webviewRef.current.src = next
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])


  // ── Main chat handler ────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim()) return

    const currentInput = input.trim()
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, type: 'message', role: 'user', message: currentInput }])
    setInput('')
    setIsThinking(true)

    // Push inline thinking block into chat feed
    const thinkingId = `thinking-${Date.now()}`
    const logsStart = thinkingLogsLenRef.current
    thinkingMsgIdRef.current = thinkingId
    setMessages(prev => [...prev, { id: thinkingId, type: 'thinking', status: 'thinking', logsStart }])

    // Helper to push an inline plan card into chat and optionally set tasks state
    const pushPlan = (rawTasks: any[], confidence?: number) => {
      const planId = `plan-${Date.now()}`
      currentPlanMsgIdRef.current = planId
      const planTasks = rawTasks.map((t: any, i: number) => ({
        ...t,
        id: `task-${Date.now()}-${i}`,
        confidence: typeof t.confidence === 'number' ? t.confidence : confidence,
        status: 'pending',
      }))
      setMessages(prev => [...prev, { id: planId, type: 'plan', tasks: planTasks }])
      if (autoPilotRef.current) {
        setTasks(planTasks)
      }
    }

    // Helper to finalize the thinking block and push the agent response
    const finalizeThinking = (responseText: string, model?: string) => {
      setMessages(prev => prev.map(m =>
        m.id === thinkingId ? { ...m, status: 'done', summary: responseText } : m
      ))
      thinkingMsgIdRef.current = ''
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}`,
        type: 'message',
        role: 'agent',
        message: responseText,
        model: model || '',
      }])
    }

    setThinkingLog('Scanning page for interactive elements...')

    try {
      if (!isElectron) {
        // ── WEB MODE: proxy browser + simulated AI pipeline ───────────────
        const logStep = (msg: string) => {
          setThinkingLog(msg)
          setThinkingLogs(prev => {
            const updated = [...prev, msg]
            localStorage.setItem('thinkingLogs', JSON.stringify(updated.slice(-100)))
            return updated
          })
        }

        // Request fresh DOM from proxy iframe, then wait for it to arrive
        if (webviewRef.current?.contentWindow) {
          webviewRef.current.contentWindow.postMessage({ type: 'yogi-dom-request' }, '*')
        }
        logStep('Scanning page for interactive elements...')
        await sleep(800)

        // Use real proxy elements if available, else fall back to mock map
        const elements = proxyElementsRef.current.length > 0
          ? proxyElementsRef.current
          : mockBrowserState(workflow)
        const isLive = proxyElementsRef.current.length > 0

        logStep(`Found ${elements.length} interactive elements on ${isLive ? 'live page' : 'mock page'}`)
        await sleep(600)

        logStep('Analyzing page structure and mapping selectors...')
        await sleep(600)

        logStep('Sending context to AI brain...')
        await sleep(400)

        const res = await mockAIResponse(currentInput, workflow, elements)

        logStep(`Generating task queue — ${res.tasks.length} action(s) planned`)
        await sleep(300)

        finalizeThinking(res.thought)

        if (res.tasks.length > 0) {
          pushPlan(res.tasks, typeof res.confidence === 'number' ? res.confidence : undefined)
        }
        return
      }

      // ── EYES: fetch browser map ─────────────────────────
      let browserMap: any = { status: 'error', message: 'Not fetched' }
      try {
        setThinkingLog('Fetching page element map...')
        browserMap = await (window as any).yogi.getBrowserState()
      } catch (e: any) {
        console.warn('[Yogi] getBrowserState error:', e.message)
      }

      const elementsContext = browserMap.status === 'success' && browserMap.elements?.length
        ? `BROWSER CONTEXT — ${browserMap.elements.length} interactive elements found:\n` +
          browserMap.elements.map((el: any) =>
            `  [${el.tag}] text="${el.text}" selector="${el.selector}"${el.ariaLabel ? ` aria="${el.ariaLabel}"` : ''}${el.placeholder ? ` placeholder="${el.placeholder}"` : ''}`
          ).join('\n')
        : `BROWSER CONTEXT — Page scan failed (${browserMap.message || 'no webview'}). Use navigate action to load a page first.`

      const contextPrompt = `${elementsContext}

USER REQUEST:
${currentInput}`

      setThinkingLog('Sending to AI brain...')

      // ── BRAIN: ask the AI ───────────────────────────────
      let res = await (window as any).yogi.sendChatMessage(contextPrompt, 'high', workflow, settings)

      if (res.requestScreenshot) {
        setThinkingLog('📸 AI requested visual analysis — capturing screenshot...')
        try {
          let screenshotRes: { status: string; image?: string }
          if (isElectron) {
            screenshotRes = await (window as any).yogi.captureScreenshot()
          } else {
            screenshotRes = await captureWebScreenshot()
          }
          if (screenshotRes.status === 'success' && screenshotRes.image) {
            if (isElectron) {
              const visionRes = await (window as any).yogi.analyzeScreenshot(
                screenshotRes.image,
                `User requested: ${currentInput}`,
                undefined
              )
              if (visionRes.status === 'success' && visionRes.analysis) {
                setThinkingLog(`👁 Visual context: ${visionRes.analysis.description}`)
                const visualContext = `${elementsContext}\n\nVISUAL ANALYSIS OF PAGE:\n${visionRes.analysis.description}\nVisually identified elements: ${visionRes.analysis.interactiveElements.join(', ')}\nCAPTCHA detected: ${visionRes.analysis.captchaDetected}\n\nUSER REQUEST:\n${currentInput}`
                res = await (window as any).yogi.sendChatMessage(visualContext, 'high', workflow, settings)
              }
            } else {
              setThinkingLog(`👁 Web screenshot captured (${Math.round((screenshotRes.image.length * 3) / 4 / 1024)}KB) — visual context available`)
              const visualContext = `${elementsContext}\n\nVISUAL SCREENSHOT: A page screenshot was captured for analysis. The page contains ${proxyElementsRef.current.length} interactive elements.\n\nUSER REQUEST:\n${currentInput}`
              res = await (window as any).yogi.sendChatMessage(visualContext, 'high', workflow, settings)
            }
          }
        } catch (e: any) {
          setThinkingLog(`👁 Vision unavailable: ${e.message}`)
        }
      }

      finalizeThinking(res.text || 'Done.', res.model || '')

      // ── QUEUE: populate HITL approval queue ────────────
      if (res.tasks && Array.isArray(res.tasks) && res.tasks.length > 0) {
        pushPlan(res.tasks, typeof res.confidence === 'number' ? res.confidence : undefined)
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m =>
        m.id === thinkingId ? { ...m, status: 'done', summary: `Error: ${(e as any).message}` } : m
      ))
      thinkingMsgIdRef.current = ''
      setMessages(prev => [...prev, { id: `err-${Date.now()}`, type: 'message', role: 'agent', message: `⚠️ Agent Error: ${e.message}` }])
    } finally {
      setIsThinking(false)
    }
  }

  // ── PDF upload ───────────────────────────────────────────
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files as any)?.[0]
    if (!file) return
    setIsThinking(true)
    setThinkingLog('Parsing PDF knowledge...')
    try {
      if (isElectron) {
        const res = await (window as any).yogi.parsePdf(file.path)
        if (res.status === 'success') {
          setSettings((prev: any) => ({ ...prev, MASTER_KB: (prev.MASTER_KB || '') + '\n\n' + res.text }))
          setNotification({ message: 'PDF synced to Knowledge Base!', type: 'info' })
        } else {
          setNotification({ message: `PDF Error: ${res.message}`, type: 'alert' })
        }
      } else {
        setNotification({ message: 'PDF parsing requires the desktop app.', type: 'info' })
      }
    } catch (err: any) {
      setNotification({ message: `Error: ${err.message}`, type: 'alert' })
    } finally {
      setIsThinking(false)
    }
  }

  // ── Plan task state management ──────────────────────────
  const updatePlanTask = useCallback((planId: string, taskId: string, status: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== planId || m.type !== 'plan') return m
      return { ...m, tasks: m.tasks.map((t: any) => t.id === taskId ? { ...t, status } : t) }
    }))
  }, [])


  // ── Verification logging helper ─────────────────────────
  const logVerification = (msg: string) => {
    setThinkingLog(msg)
    setThinkingLogs(prev => {
      const updated = [...prev, msg]
      localStorage.setItem('thinkingLogs', JSON.stringify(updated.slice(-100)))
      return updated
    })
  }

  // ── Web mode: capture snapshot from proxy iframe ───────
  const captureWebSnapshot = (): { url: string; title: string; elements: any[] } => {
    return {
      url: inputUrl,
      title: document.title,
      elements: proxyElementsRef.current.map(e => ({
        tag: e.tag,
        text: e.text || '',
        selector: e.selector,
        ariaLabel: e.ariaLabel || '',
        placeholder: e.placeholder || '',
        type: e.type || '',
      })),
    }
  }

  const captureWebScreenshot = (): Promise<{ status: string; image?: string; message?: string }> => {
    return new Promise((resolve) => {
      const iframe = webviewRef.current as HTMLIFrameElement | null
      if (!iframe?.contentWindow) {
        resolve({ status: 'error', message: 'No iframe available' })
        return
      }

      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler)
        resolve({ status: 'error', message: 'Screenshot timeout' })
      }, 10000)

      const handler = (ev: MessageEvent) => {
        if (ev.data?.type === 'yogi-screenshot-result') {
          clearTimeout(timeout)
          window.removeEventListener('message', handler)
          resolve({ status: ev.data.status, image: ev.data.image, message: ev.data.message })
        }
      }

      window.addEventListener('message', handler)
      iframe.contentWindow.postMessage({ type: 'yogi-screenshot-request' }, '*')
    })
  }

  // ── Web mode: wait for proxy DOM to stabilize after action ─
  const waitForWebStability = async () => {
    await sleep(800)
    const iframe = webviewRef.current as HTMLIFrameElement | null
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'yogi-dom-request' }, '*')
    }
    await sleep(600)
  }

  // ── Heuristic validator for web mode ──────────────────
  const validateWebAction = (
    action: { action: string; selector: string; value?: string },
    before: { url: string; title: string; elements: any[] },
    after: { url: string; title: string; elements: any[] }
  ): { status: string; reason: string; confidence: number } => {
    const urlChanged = before.url !== after.url
    const elementCountDelta = after.elements.length - before.elements.length

    if (action.action === 'dom_click') {
      if (urlChanged) return { status: 'success', reason: `Page navigated to ${after.url}`, confidence: 95 }
      if (Math.abs(elementCountDelta) >= 3) return { status: 'success', reason: `Page changed (${elementCountDelta > 0 ? '+' : ''}${elementCountDelta} elements)`, confidence: 75 }
      const newEls = after.elements.filter((ae: any) => !before.elements.some((be: any) => be.selector === ae.selector))
      if (newEls.length >= 2) return { status: 'success', reason: `${newEls.length} new elements appeared`, confidence: 70 }
      return { status: 'retry', reason: `Click on "${action.selector}" — no visible change detected`, confidence: 30 }
    }
    if (action.action === 'dom_type') {
      const target = after.elements.find((e: any) => e.selector === action.selector)
      if (target) return { status: 'success', reason: `Target element still present after typing`, confidence: 65 }
      return { status: 'retry', reason: `Target "${action.selector}" not found after typing`, confidence: 20 }
    }
    return { status: 'success', reason: 'Action completed', confidence: 50 }
  }

  // ── Retry engine: exponential backoff ─────────────────
  const MAX_RETRIES = 3
  const RETRY_DELAYS = [1000, 2000, 4000]

  type ApproveResult = { status: 'success' | 'escalated' | 'error'; retries?: number; reason?: string }

  const approveTask = async (idOrTask: string | any, onRetry?: (attempt: number, reason: string) => void): Promise<ApproveResult> => {
    let task: any
    if (typeof idOrTask === 'string') {
      task = tasks.find(t => t.id === idOrTask)
      if (!task) return { status: 'error', reason: 'Task not found' }
    } else {
      task = idOrTask
    }

    setTasks(prev => prev.filter(t => t.id !== task.id))

    if (!isElectron) {
      const iframe = webviewRef.current as HTMLIFrameElement | null
      const isLive = proxyElementsRef.current.length > 0

      if (isLive && iframe?.contentWindow) {
        const beforeSnapshot = captureWebSnapshot()
        logVerification(`▶ Executing: ${task.description}`)

        let lastResult: { status: string; reason: string; confidence: number } = { status: 'retry', reason: '', confidence: 0 }
        let currentSelector = task.payload?.selector
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            const retryReason = lastResult.reason || 'Verification failed'
            logVerification(`🔄 Retry ${attempt}/${MAX_RETRIES} — waiting ${RETRY_DELAYS[attempt - 1]}ms...`)
            onRetry?.(attempt, retryReason)
            await sleep(RETRY_DELAYS[attempt - 1])

            if (iframe?.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'yogi-dom-request' }, '*')
              await sleep(600)
            }
            const freshElements = proxyElementsRef.current
            if (freshElements.length > 0) {
              const altEl = freshElements.find((el: any) => {
                const descLower = (task.description || '').toLowerCase()
                const textMatch = el.text && descLower.includes(el.text.toLowerCase())
                const ariaMatch = el.ariaLabel && descLower.includes(el.ariaLabel.toLowerCase())
                return (textMatch || ariaMatch) && el.selector !== task.payload?.selector
              })
              if (altEl) {
                currentSelector = altEl.selector
                logVerification(`🔄 Trying alternative selector: ${currentSelector}`)
              }
            }
          }

          if (task.action === 'dom_click') {
            iframe.contentWindow!.postMessage({ type: 'yogi-click', selector: currentSelector }, '*')
          } else if (task.action === 'dom_type') {
            iframe.contentWindow!.postMessage({ type: 'yogi-type', selector: currentSelector, value: task.payload?.value ?? '' }, '*')
          } else if (task.action === 'dom_press_enter') {
            iframe.contentWindow!.postMessage({ type: 'yogi-press-enter', selector: currentSelector }, '*')
            // Direct-navigation fallback: if pressing Enter on a search field,
            // build the search URL ourselves and navigate through the proxy
            const searchValue = task.payload?.value ?? ''
            if (searchValue) {
              const currentRawUrl = inputUrl.replace(/^https?:\/\//, '').split('?')[0]
              const isGoogleSearch = currentRawUrl.includes('google.com')
              const isBingSearch = currentRawUrl.includes('bing.com')
              const isDDGSearch = currentRawUrl.includes('duckduckgo.com')
              if (isGoogleSearch) {
                setTimeout(() => {
                  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchValue)}`
                  setUrl(proxyUrl(searchUrl))
                  setInputUrl(searchUrl)
                  if (webviewRef.current) (webviewRef.current as any).src = proxyUrl(searchUrl)
                }, 1200)
              } else if (isBingSearch) {
                setTimeout(() => {
                  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchValue)}`
                  setUrl(proxyUrl(searchUrl))
                  setInputUrl(searchUrl)
                  if (webviewRef.current) (webviewRef.current as any).src = proxyUrl(searchUrl)
                }, 1200)
              } else if (isDDGSearch) {
                setTimeout(() => {
                  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchValue)}`
                  setUrl(proxyUrl(searchUrl))
                  setInputUrl(searchUrl)
                  if (webviewRef.current) (webviewRef.current as any).src = proxyUrl(searchUrl)
                }, 1200)
              }
            }
          }

          await waitForWebStability()

          const afterSnapshot = captureWebSnapshot()
          lastResult = validateWebAction(
            { action: task.action, selector: task.payload?.selector, value: task.payload?.value },
            beforeSnapshot,
            afterSnapshot
          )

          if (lastResult.status === 'success') {
            logVerification(`✓ Verified: ${lastResult.reason} (confidence: ${lastResult.confidence}%)`)
            setMessages(prev => [...prev, {
              role: 'agent',
              message: `✅ ${task.action === 'dom_click' ? 'Clicked' : task.action === 'dom_type' ? 'Typed into' : 'Pressed Enter on'}: ${task.description}`
            }])
            return { status: 'success', retries: attempt }
          }

          logVerification(`✗ Verification failed: ${lastResult.reason}`)
        }

        logVerification(`⚠ ESCALATE: ${lastResult.reason} — needs human help`)
        const escMsg = `Action failed after ${MAX_RETRIES} retries: ${task.description}. ${lastResult.reason}`
        setNotification({ message: escMsg, type: 'alert' })
        setMessages(prev => [...prev, { role: 'agent', message: `⚠️ ${escMsg}` }])
        return { status: 'escalated', retries: MAX_RETRIES, reason: lastResult.reason }
      } else {
        const actionLabel = task.action === 'dom_type'
          ? `TYPE "${task.payload?.value?.slice(0, 40) ?? ''}" into ${task.payload?.selector}`
          : `CLICK ${task.payload?.selector}`
        setMessages(prev => [...prev, { role: 'agent', message: `✅ Simulated: ${actionLabel}` }])
      }
      return { status: 'success' }
    }

    // ── Electron mode: full verify-after-action loop ──────────
    try {
      if (task.action === 'dom_click' || task.action === 'dom_type') {
        logVerification(`▶ Capturing pre-action snapshot...`)
        const beforeRes = await (window as any).yogi.captureSnapshot()
        const beforeSnapshot = beforeRes.snapshot || { url: '', title: '', elements: [] }

        const isSensitive = beforeSnapshot.elements.some((el: any) => {
          if (el.selector !== task.payload?.selector) return false
          const ctx = `${el.text} ${el.ariaLabel || ''} ${el.placeholder || ''} ${el.selector} ${el.type || ''}`.toLowerCase()
          return el.type === 'password' || ['credit-card', 'card-number', 'cvv', 'delete', 'remove'].some(p => ctx.includes(p))
        })
        if (isSensitive) {
          logVerification(`🛡 Sensitive action detected — requires manual confirmation`)
          setNotification({ message: `Sensitive action: "${task.description}" — confirm manually`, type: 'alert' })
          setTasks(prev => [{ ...task, id: task.id, sensitive: true }, ...prev])
          return { status: 'escalated', reason: 'Sensitive action requires manual confirmation' }
        }

        let lastValidation: any = { status: 'retry', reason: 'Not executed', confidence: 0 }
        let currentSelector = task.payload.selector
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            const retryReason2 = lastValidation.reason || 'Verification failed'
            logVerification(`🔄 Retry ${attempt}/${MAX_RETRIES} — waiting ${RETRY_DELAYS[attempt - 1]}ms...`)
            onRetry?.(attempt, retryReason2)
            await sleep(RETRY_DELAYS[attempt - 1])

            logVerification(`🔍 Re-scanning page for alternative selectors...`)
            try {
              const freshState = await (window as any).yogi.getBrowserState()
              if (freshState.status === 'success' && freshState.elements?.length > 0) {
                const altEl = freshState.elements.find((el: any) => {
                  const descLower = (task.description || '').toLowerCase()
                  const textMatch = el.text && descLower.includes(el.text.toLowerCase())
                  const ariaMatch = el.ariaLabel && descLower.includes(el.ariaLabel.toLowerCase())
                  const placeholderMatch = el.placeholder && descLower.includes(el.placeholder.toLowerCase())
                  return (textMatch || ariaMatch || placeholderMatch) && el.selector !== task.payload.selector
                })
                if (altEl) {
                  currentSelector = altEl.selector
                  logVerification(`🔄 Trying alternative selector: ${currentSelector}`)
                }
              }
            } catch (e: any) {
              logVerification(`🔍 Re-scan failed: ${e.message}`)
            }
          }

          logVerification(`▶ Executing: ${task.description}`)
          const result = await (window as any).yogi.domAction(
            currentSelector,
            task.action,
            task.payload.value || ''
          )
          if (result.status === 'error') {
            logVerification(`✗ DOM action error: ${result.message}`)
            lastValidation = { status: 'retry', reason: result.message, confidence: 0 }
            continue
          }

          logVerification(`⏳ Waiting for page to stabilize...`)
          await (window as any).yogi.waitForStability(5000)

          logVerification(`🔍 Validating action result...`)
          const validation = await (window as any).yogi.validateAction(
            { action: task.action, selector: currentSelector, value: task.payload.value, url: task.payload.url, description: task.description },
            beforeSnapshot
          )

          lastValidation = validation.validation

          if (validation.captchaDetected) {
            logVerification(`🛑 CAPTCHA detected — escalating to human`)
            const captchaMsg = 'CAPTCHA detected! Please solve it manually, then retry.'
            setNotification({ message: captchaMsg, type: 'alert' })
            setMessages(prev => [...prev, { role: 'agent', message: `🛑 CAPTCHA detected — please solve it manually` }])
            return { status: 'escalated', retries: attempt, reason: 'CAPTCHA detected' }
          }

          if (lastValidation.status === 'success') {
            logVerification(`✓ Verified: ${lastValidation.reason} (confidence: ${lastValidation.confidence}%)`)
            setMessages(prev => [...prev, {
              role: 'agent',
              message: `✅ ${task.action === 'dom_click' ? 'Clicked' : 'Typed into'}: ${task.description}`
            }])

            if (lastValidation.confidence < 50) {
              logVerification(`📸 Low confidence — requesting visual verification...`)
              try {
                const screenshotRes = await (window as any).yogi.captureScreenshot()
                if (screenshotRes.status === 'success' && screenshotRes.image) {
                  const vision = await (window as any).yogi.analyzeScreenshot(
                    screenshotRes.image,
                    task.description,
                    `The action "${task.description}" should have completed successfully`
                  )
                  if (vision.status === 'success' && vision.analysis) {
                    logVerification(`👁 Visual: ${vision.analysis.description}`)
                    if (vision.analysis.captchaDetected) {
                      logVerification(`🛑 Vision detected CAPTCHA`)
                      setNotification({ message: 'CAPTCHA detected visually! Please solve it.', type: 'alert' })
                      return { status: 'escalated', retries: attempt, reason: 'CAPTCHA detected via vision' }
                    }
                  }
                }
              } catch (visionErr: any) {
                logVerification(`👁 Vision unavailable: ${visionErr.message}`)
              }
            }
            return { status: 'success', retries: attempt }
          }

          logVerification(`✗ Verification: ${lastValidation.reason}`)
        }

        logVerification(`⚠ ESCALATE: ${lastValidation.reason} — needs human help`)
        const escMsg2 = `Action failed after ${MAX_RETRIES} retries: ${task.description}. ${lastValidation.reason}`
        setNotification({ message: escMsg2, type: 'alert' })
        setMessages(prev => [...prev, { role: 'agent', message: `⚠️ ${escMsg2}` }])
        return { status: 'escalated', retries: MAX_RETRIES, reason: lastValidation.reason }
      } else if (task.action === 'navigate') {
        const targetUrl = task.payload.url
        if (isElectron) {
          ;(window as any).yogi?.browserNavigate(targetUrl)
        }
        setUrl(targetUrl)
        setInputUrl(targetUrl)
        logVerification(`✓ Navigated to: ${targetUrl}`)
        setMessages(prev => [...prev, { role: 'agent', message: `🌐 Navigating to: ${targetUrl}` }])
      } else if (task.action === 'execute') {
        const output = await (window as any).yogi.executeTerminal(task.payload.command)
        logVerification(`✓ Terminal command executed`)
        setMessages(prev => [...prev, { role: 'agent', message: `💻 Terminal: ${output}` }])
      } else {
        await (window as any).yogi.humanInteraction(task.action, task.payload)
      }
      return { status: 'success' } as ApproveResult
    } catch (e: any) {
      logVerification(`⚠ Error: ${e.message}`)
      setMessages(prev => [...prev, { role: 'agent', message: `⚠️ Task Failed: ${e.message}` }])
      return { status: 'error', reason: e.message } as ApproveResult
    }
  }

  // ── Plan task approval (for inline PlanCard) ────────────
  const approvePlanTask = useCallback(async (planId: string, taskId: string) => {
    const planMsg = messagesRef.current.find(m => m.id === planId)
    const task = planMsg?.tasks?.find((t: any) => t.id === taskId)
    if (!task) return

    updatePlanTask(planId, taskId, 'running')

    const result = await approveTask(task, (attempt: number, reason: string) => {
      setMessages(prev => [...prev, {
        id: `retry-${Date.now()}`,
        type: 'error',
        what: `"${task.description}" failed (attempt ${attempt}/${MAX_RETRIES})`,
        retry: reason,
      }])
    })

    updatePlanTask(planId, taskId, result.status === 'success' ? 'done' : 'failed')
  }, [updatePlanTask])

  const autoExecuteLoop = useCallback(async (taskQueue: any[], planMsgId?: string) => {
    if (autoExecutingRef.current) return
    setAutoExecuting(true)
    sessionStartRef.current = Date.now()

    const stepDelay = settings.autoStepDelay || 2000
    const confThreshold = settings.confidenceThreshold ?? 70

    for (let i = 0; i < taskQueue.length; i++) {
      if (!autoPilotRef.current) {
        addExecLog({ action: 'pause', description: 'Auto-Pilot turned OFF — paused', status: 'skipped' })
        break
      }

      let currentElements: any[] = proxyElementsRef.current
      if (isElectron) {
        try {
          const state = await (window as any).yogi.getBrowserState()
          if (state?.status === 'success' && state.elements) currentElements = state.elements
        } catch (e) {}
      }

      const task = taskQueue[i]
      const safetyReason = isSafetyRailTask(task, currentElements)
      if (safetyReason) {
        addExecLog({
          action: task.action,
          description: task.description,
          selector: task.payload?.selector,
          status: 'skipped',
          reason: safetyReason,
        })
        setTasks(prev => {
          const exists = prev.some(t => t.id === task.id)
          if (exists) return prev.map(t => t.id === task.id ? { ...t, sensitive: true } : t)
          return [{ ...task, sensitive: true }, ...prev]
        })
        setNotification({ message: `${safetyReason}: "${task.description}" — needs manual approval`, type: 'alert' })
        continue
      }

      if (typeof task.confidence === 'number' && task.confidence < confThreshold) {
        const confMsg = `Low confidence (${task.confidence}%) — needs manual review: "${task.description}"`
        addExecLog({
          action: task.action,
          description: task.description,
          selector: task.payload?.selector,
          status: 'skipped',
          reason: `Confidence ${task.confidence}% below threshold ${confThreshold}%`,
          confidence: task.confidence,
        })
        setTasks(prev => {
          const exists = prev.some(t => t.id === task.id)
          if (exists) return prev.map(t => t.id === task.id ? { ...t, sensitive: true } : t)
          return [{ ...task, sensitive: true }, ...prev]
        })
        setNotification({ message: confMsg, type: 'alert' })
        setEscalation({ message: confMsg, taskId: task.id })
        playEscalationChime()
        fireNotification('Yogi needs your review', confMsg)
        setAutoExecuting(false)
        return
      }

      const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const startTime = Date.now()
      setExecutionLog(prev => [...prev, {
        id: logId,
        timestamp: Date.now(),
        action: task.action,
        description: task.description,
        selector: task.payload?.selector,
        status: 'running',
      }])

      // Mark task as running in plan card
      if (planMsgId) {
        setMessages(prev => prev.map(m =>
          m.id === planMsgId && m.type === 'plan'
            ? { ...m, tasks: m.tasks.map((t: any) => t.id === task.id ? { ...t, status: 'running' } : t) }
            : m
        ))
      }

      let result: ApproveResult
      try {
        result = await approveTask(task, (attempt, reason) => {
          addExecLog({
            action: task.action,
            description: `Retry ${attempt}/${MAX_RETRIES}: ${task.description}`,
            selector: task.payload?.selector,
            status: 'retry',
            reason,
          })
          setMessages(prev => [...prev, {
            id: `retry-${Date.now()}`,
            type: 'error',
            what: `"${task.description}" failed (attempt ${attempt}/${MAX_RETRIES})`,
            retry: reason,
          }])
        })
      } catch (e: any) {
        result = { status: 'error', reason: e.message }
      }

      const elapsed = Date.now() - startTime

      if (result.status === 'escalated' || result.status === 'error') {
        updateExecLog(logId, {
          status: 'escalate',
          reason: result.reason || 'Unknown error',
          elapsed,
          retries: result.retries,
        })
        // Mark task as failed in plan card
        if (planMsgId) {
          setMessages(prev => prev.map(m =>
            m.id === planMsgId && m.type === 'plan'
              ? { ...m, tasks: m.tasks.map((t: any) => t.id === task.id ? { ...t, status: 'failed' } : t) }
              : m
          ))
        }
        if (!escalation) {
          const escMsg = result.reason || `Action failed: ${task.description}`
          setEscalation({ message: escMsg, taskId: task.id })
          playEscalationChime()
          fireNotification('Yogi needs your help', escMsg)
        }
        setAutoExecuting(false)
        return
      }

      // Mark task as done in plan card
      if (planMsgId) {
        setMessages(prev => prev.map(m =>
          m.id === planMsgId && m.type === 'plan'
            ? { ...m, tasks: m.tasks.map((t: any) => t.id === task.id ? { ...t, status: 'done' } : t) }
            : m
        ))
      }

      updateExecLog(logId, { status: 'success', elapsed, retries: result.retries })

      if (i < taskQueue.length - 1 && autoPilotRef.current) {
        await sleep(stepDelay)
      }
    }

    setAutoExecuting(false)
  }, [settings, addExecLog, updateExecLog])

  useEffect(() => {
    if (!autoPilot || tasks.length === 0 || autoExecutingRef.current) return
    const executableTasks = tasks.filter(t => !t.sensitive)
    if (executableTasks.length === 0) return
    autoExecuteLoop(executableTasks, currentPlanMsgIdRef.current)
  }, [autoPilot, tasks, autoExecuteLoop])

  useEffect(() => {
    if (settings.autoPilot === true) {
      setAutoPilot(true)
      autoPilotRef.current = true
    }
  }, [settings.autoPilot])

  const toggleAutoPilot = useCallback(() => {
    setAutoPilot(prev => {
      const next = !prev
      setSettings((s: any) => {
        const updated = { ...s, autoPilot: next }
        if (isElectron) {
          (window as any).yogi.saveSettings(updated)
        } else {
          localStorage.setItem('yogi_settings', JSON.stringify(updated))
        }
        return updated
      })
      if (!next && autoExecutingRef.current) {
        addExecLog({ action: 'pause', description: 'Auto-Pilot paused by user', status: 'skipped' })
      }
      if (next) {
        setEscalation(null)
        sessionStartRef.current = Date.now()
      }
      return next
    })
  }, [addExecLog])

  const resumeAfterEscalation = useCallback(() => {
    setEscalation(null)
    if (autoPilotRef.current && tasks.length > 0) {
      const tasksCopy = [...tasks]
      autoExecuteLoop(tasksCopy, currentPlanMsgIdRef.current)
    }
  }, [tasks, autoExecuteLoop])

  // ── Browser controls ─────────────────────────────────────
  const goHome = () => {
    setUrl(HOME_URL)
    setInputUrl('')
    // In Electron: load start.html via the home sentinel so BrowserView shows it
    if (isElectron) {
      ;(window as any).yogi?.browserNavigate(HOME_URL)
    }
  }

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let targetUrl = inputUrl.trim()
    // Empty bar → go home
    if (!targetUrl) {
      goHome()
      return
    }
    if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`
    setInputUrl(targetUrl)
    if (isElectron) {
      setUrl(targetUrl)
      ;(window as any).yogi?.browserNavigate(targetUrl)
    } else {
      const next = proxyUrl(targetUrl)
      setUrl(next)
      proxyElementsRef.current = []
      setProxyElements([])
      if (webviewRef.current) webviewRef.current.src = next
    }
  }

  const goBack = () => {
    if (isElectron) {
      ;(window as any).yogi?.browserBack()
    } else {
      webviewRef.current?.contentWindow?.history.back()
    }
  }

  const goForward = () => {
    if (isElectron) {
      ;(window as any).yogi?.browserForward()
    } else {
      webviewRef.current?.contentWindow?.history.forward()
    }
  }

  const reload = () => {
    if (isElectron) {
      ;(window as any).yogi?.browserReload()
    } else {
      const iframe = webviewRef.current as HTMLIFrameElement
      if (iframe) iframe.src = iframe.src
    }
  }

  // ── Render ───────────────────────────────────────────────
  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="app-container" style={{ '--sidebar-width': `${sidebarWidth}px` } as any}>

      {/* ── LEFT: Copilot sidebar ── */}
      <div className="sidebar" ref={sidebarRef}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Yogi Browser</h2>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                className={`panel-tab-btn ${sidePanel === 'chat' ? 'active' : ''}`}
                title="Chat"
                onClick={() => setSidePanel('chat')}
              >
                <Send size={14} />
              </button>
              <button
                className={`panel-tab-btn ${sidePanel === 'missions' ? 'active' : ''}`}
                title="Missions"
                onClick={() => setSidePanel('missions')}
              >
                <Target size={14} />
              </button>
              <button
                className={`panel-tab-btn ${sidePanel === 'skills' ? 'active' : ''}`}
                title="Skills"
                onClick={() => setSidePanel('skills')}
              >
                <BookOpen size={14} />
              </button>
              <button
                className={`panel-tab-btn ${sidePanel === 'activity' ? 'active' : ''}`}
                title="Activity Log"
                onClick={() => setSidePanel('activity')}
                style={{ position: 'relative' }}
              >
                <Activity size={14} />
                {activityLog.length > 0 && (
                  <span className="panel-tab-badge">{activityLog.length > 99 ? '99+' : activityLog.length}</span>
                )}
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
              <button
                className={`autopilot-toggle ${autoPilot ? 'active' : ''}`}
                title={autoPilot ? 'Auto-Pilot ON — click to pause' : 'Auto-Pilot OFF — click to enable'}
                onClick={toggleAutoPilot}
              >
                <Rocket size={16} />
                <span className="autopilot-label">{autoPilot ? 'ON' : 'OFF'}</span>
              </button>
              <button className="nav-btn" title="Settings" onClick={() => setShowSettings(true)}>
                <Settings size={20} />
              </button>
            </div>
          </div>
          {autoPilot && (
            <div className="autopilot-status">
              <div className="autopilot-pulse" />
              <span>{autoExecuting ? 'Yogi is working autonomously...' : 'Auto-Pilot ready — waiting for tasks'}</span>
            </div>
          )}
          {activeMission && (
            <div className="mission-running-banner">
              <Target size={12} />
              <span>Mission: {activeMission.name}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {missionRunner.isPaused() ? (
                  <button className="mission-banner-btn" onClick={() => missionRunner.resumeMission()}>
                    <Play size={11} /> Resume
                  </button>
                ) : (
                  <button className="mission-banner-btn" onClick={() => missionRunner.pauseMission()}>
                    <Pause size={11} /> Pause
                  </button>
                )}
                <button className="mission-banner-btn stop" onClick={() => { missionRunner.stopMission(); setActiveMission(null) }}>
                  <Square size={11} /> Stop
                </button>
              </div>
            </div>
          )}
          <select className="workflow-select" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            <option value="reddit_post">F: Reddit Poster</option>
            <option value="reddit_reply">E: Reddit Replier</option>
            <option value="linkedin">B: LinkedIn Outreach</option>
          </select>
        </div>

        {notification && (
          <div className={`notification ${notification.type}`} onClick={() => setNotification(null)}>
            {notification.message}
          </div>
        )}

        {escalation && (
          <div className="escalation-banner">
            <div className="escalation-icon"><AlertTriangle size={18} /></div>
            <div className="escalation-content">
              <div className="escalation-title">Agent needs your help</div>
              <div className="escalation-message">{escalation.message}</div>
            </div>
            <button className="escalation-resume" onClick={resumeAfterEscalation}>
              <Play size={14} /> Resume
            </button>
          </div>
        )}

        {resumeBanner && (
          <div className="mission-resume-banner">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '12px' }}>Resume interrupted mission?</div>
              <div style={{ fontSize: '11px', opacity: 0.8, marginTop: 2 }}>
                "{resumeBanner.name}" — {resumeBanner.tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length}/{resumeBanner.tasks.length} tasks done
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="mission-banner-btn" onClick={() => handleResumeMission(resumeBanner)}>
                <Play size={11} /> Resume
              </button>
              <button className="mission-banner-btn stop" onClick={() => handleDismissResume(resumeBanner)}>
                <X size={11} /> Dismiss
              </button>
            </div>
          </div>
        )}

        {sidePanel === 'missions' && (
          <MissionEditor
            missions={missions}
            onSave={handleSaveMission}
            onDelete={handleDeleteMission}
            onRun={handleRunMission}
            onClose={() => setSidePanel('chat')}
          />
        )}

        {sidePanel === 'skills' && (
          <SkillsLibrary
            skills={skills}
            currentUrl={inputUrl}
            manuallyActivated={manuallyActivatedSkills}
            onSave={handleSaveSkill}
            onDelete={handleDeleteSkill}
            onToggle={handleToggleSkill}
            onManualToggle={handleManualSkillToggle}
            onClose={() => setSidePanel('chat')}
          />
        )}

        {sidePanel === 'activity' && (
          <ActivityReport
            entries={activityLog}
            sessionId={SESSION_ID}
            onClear={clearActivityLog}
            onClose={() => setSidePanel('chat')}
          />
        )}

        {sidePanel === 'chat' && (
          <>
            {/* ── Chat feed ── */}
            <div className="chat-feed" ref={chatFeedRef}>
              {messages.map((m, i) => {
                const msgType = m.type || 'message'
                if (msgType === 'thinking') {
                  return (
                    <ThinkingBlock
                      key={m.id || i}
                      logs={thinkingLogs}
                      logsStart={m.logsStart || 0}
                      status={m.status || 'thinking'}
                      summary={m.summary}
                    />
                  )
                }
                if (msgType === 'plan') {
                  return (
                    <PlanCard
                      key={m.id || i}
                      planId={m.id}
                      tasks={m.tasks || []}
                      onApprove={approvePlanTask}
                      autoPilotOn={autoPilot}
                    />
                  )
                }
                if (msgType === 'error') {
                  return (
                    <InlineErrorBlock
                      key={m.id || i}
                      what={m.what || ''}
                      retry={m.retry || ''}
                    />
                  )
                }
                return (
                  <ChatBubble key={m.id || i} message={m.message} role={m.role} model={m.model} />
                )
              })}
            </div>

            {/* ── Execution Log Panel ── */}
            {executionLog.length > 0 && (
              <div className="exec-log-panel">
                <div className="exec-log-header" onClick={() => setShowExecLog(v => !v)}>
                  <div className="exec-log-title">
                    <Clock size={13} />
                    <span>EXECUTION LOG ({executionLog.length})</span>
                  </div>
                  {showExecLog ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </div>
                {showExecLog && (
                  <div className="exec-log-entries">
                    {executionLog.slice().reverse().map(entry => (
                      <div key={entry.id} className={`exec-log-entry exec-log-${entry.status}`}>
                        <div className="exec-log-entry-icon">
                          {entry.status === 'success' && <CheckCircle size={12} />}
                          {entry.status === 'running' && <RotateCw size={12} className="spin" />}
                          {entry.status === 'retry' && <AlertTriangle size={12} />}
                          {entry.status === 'escalate' && <XCircle size={12} />}
                          {entry.status === 'skipped' && <Pause size={12} />}
                        </div>
                        <div className="exec-log-entry-content">
                          <div className="exec-log-entry-desc">{entry.description}</div>
                          <div className="exec-log-entry-meta">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                            {entry.elapsed != null && ` · ${(entry.elapsed / 1000).toFixed(1)}s`}
                            {entry.retries != null && entry.retries > 0 && ` · ${entry.retries} ${entry.retries === 1 ? 'retry' : 'retries'}`}
                            {entry.reason && ` · ${entry.reason}`}
                            {entry.confidence != null && ` · ${entry.confidence}%`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


            {/* ── Chat input ── */}
            <div className="chat-input-container">
              <input
                className="chat-input"
                placeholder="Tell Yogi what to do…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <button className="send-btn" onClick={handleSend} disabled={isThinking}>
                <Send size={18} />
              </button>
            </div>
          </>
        )}

        <div className={`resize-handle ${isResizing ? 'active' : ''}`} onMouseDown={startResizing} />
      </div>

      {/* ── RIGHT: Browser viewport ── */}
      <div className="main-view">
        <div className="browser-nav">
          <div className="nav-buttons">
            <button onClick={goBack} className="nav-btn" title="Back"><ChevronLeft size={20} /></button>
            <button onClick={goForward} className="nav-btn" title="Forward"><ChevronRight size={20} /></button>
            <button onClick={reload} className="nav-btn" title="Reload"><RotateCw size={18} /></button>
            <button onClick={goHome} className="nav-btn" title="Home"><Home size={17} /></button>
          </div>
          <form className="address-bar-container" onSubmit={handleUrlSubmit}>
            <input
              className="address-bar"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
          </form>
        </div>

        <div className="browser-viewport" ref={viewportRef}>
          {isElectron ? (
            // Electron: BrowserView rendered by the main process at these bounds.
            // This div is a transparent placeholder — the main process positions
            // the BrowserView to exactly cover it (including start.html for home).
            null
          ) : url === HOME_URL ? (
            // Web preview + home sentinel: show the React home page component
            <BrowserHomePage onNavigate={(target) => {
              setInputUrl(target)
              const next = proxyUrl(target)
              setUrl(next)
              proxyElementsRef.current = []
              setProxyElements([])
              if (webviewRef.current) webviewRef.current.src = next
            }} />
          ) : (
            // Web preview: regular iframe
            <iframe
              ref={webviewRef}
              src={url}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Yogi Browser Viewport"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-modals"
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={() => {
                // Request DOM state from the newly loaded page
                setTimeout(() => {
                  webviewRef.current?.contentWindow?.postMessage({ type: 'yogi-dom-request' }, '*')
                }, 800)
              }}
            />
          )}
          {isThinking && (
            <div className="agent-active-dot-overlay">
              <span className="agent-active-dot" title={thinkingLog} />
            </div>
          )}
        </div>
      </div>

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Agent Configuration</h3>
              <button className="nav-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div className="settings-field">
                <label>Groq API Keys (one per line)</label>
                <textarea
                  rows={2}
                  value={settings.GROQ_KEYS || ''}
                  onChange={(e) => setSettings((s: any) => ({ ...s, GROQ_KEYS: e.target.value }))}
                  placeholder="gsk_..."
                />
              </div>
              <div className="settings-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Google Gemini API Key
                  {geminiKeyStatus === 'ok' && <span style={{ color: '#10b981', fontSize: '11px', fontWeight: 700 }}>✓ Valid</span>}
                  {geminiKeyStatus === 'fail' && <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>✗ {geminiKeyError}</span>}
                </label>
                <textarea
                  rows={2}
                  value={settings.GOOGLE_KEYS || ''}
                  onChange={(e) => { setSettings((s: any) => ({ ...s, GOOGLE_KEYS: e.target.value })); setGeminiKeyStatus('idle') }}
                  placeholder="AIza... (get from Google AI Studio — aistudio.google.com)"
                />
                {isElectron && (
                  <button
                    type="button"
                    className="approve-btn"
                    style={{ marginTop: '6px', fontSize: '11px', padding: '5px 12px', opacity: geminiKeyStatus === 'testing' ? 0.6 : 1 }}
                    disabled={geminiKeyStatus === 'testing' || !settings.GOOGLE_KEYS}
                    onClick={async () => {
                      setGeminiKeyStatus('testing')
                      setGeminiKeyError('')
                      const key = (settings.GOOGLE_KEYS || '').split(/[\n,]/)[0].trim()
                      const result = await (window as any).yogi.testGeminiKey(key)
                      if (result.ok) {
                        setGeminiKeyStatus('ok')
                      } else {
                        setGeminiKeyStatus('fail')
                        setGeminiKeyError(result.error || 'Failed')
                      }
                    }}
                  >
                    {geminiKeyStatus === 'testing' ? 'Testing...' : 'Test Key'}
                  </button>
                )}
              </div>
              <div className="settings-field">
                <label>Model Strategy</label>
                <select
                  value={settings.MODEL_STRATEGY || 'quality'}
                  onChange={(e) => setSettings((s: any) => ({ ...s, MODEL_STRATEGY: e.target.value }))}
                  className="settings-select"
                >
                  <option value="quality">Quality — Gemini 1.5 Pro for writing, Groq for execution</option>
                  <option value="speed">Speed — Groq only (fastest, free)</option>
                </select>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                  Quality mode uses Gemini Pro for Reddit posts and planning. Requires a Gemini API key.
                </div>
              </div>
              <div className="settings-field">
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Usage Stats</span>
                  {isElectron && (
                    <button
                      type="button"
                      className="approve-btn"
                      style={{ fontSize: '10px', padding: '3px 8px' }}
                      onClick={async () => {
                        const q = await (window as any).yogi.getQuotas()
                        setQuotas(q)
                      }}
                    >Refresh</button>
                  )}
                </label>
                {quotas ? (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {Object.entries(quotas).map(([provider, data]: [string, any]) => (
                      <div key={provider} style={{
                        background: '#111114',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        flex: '1',
                        minWidth: '100px',
                      }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '4px' }}>{provider}</div>
                        <div style={{ fontSize: '12px', color: '#e8f0ff' }}>{data.totalRequests} reqs</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>~{(data.estimatedTokens / 1000).toFixed(1)}k tokens</div>
                        <div style={{ fontSize: '10px', color: data.keys?.some((k: any) => k.status === 'active') ? '#10b981' : '#ef4444', marginTop: '3px' }}>
                          {data.keys?.filter((k: any) => k.status === 'active').length}/{data.keys?.length} keys active
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>Click Refresh to load usage stats</div>
                )}
              </div>
              <div className="settings-field">
                <label>OpenAI Keys (one per line)</label>
                <textarea
                  rows={2}
                  value={settings.OPENAI_KEYS || ''}
                  onChange={(e) => setSettings((s: any) => ({ ...s, OPENAI_KEYS: e.target.value }))}
                  placeholder="sk-..."
                />
              </div>
              <div className="settings-field">
                <label>Master Knowledge Base</label>
                <textarea
                  rows={5}
                  value={settings.MASTER_KB || ''}
                  onChange={(e) => setSettings((s: any) => ({ ...s, MASTER_KB: e.target.value }))}
                  placeholder="Paste your sales facts, objection handlers, scripts…"
                />
                <div style={{ marginTop: '10px' }}>
                  <input type="file" accept="application/pdf" onChange={handlePdfUpload} style={{ display: 'none' }} id="pdf-upload" />
                  <label htmlFor="pdf-upload" className="approve-btn" style={{ cursor: 'pointer', background: 'rgba(82,134,255,0.2)', color: 'var(--primary)', border: '1px solid rgba(82,134,255,0.3)' }}>
                    Upload & Extract PDF
                  </label>
                </div>
              </div>
              <div className="settings-field">
                <label>Minimum Confidence to Auto-Execute ({settings.confidenceThreshold ?? 70}%)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settings.confidenceThreshold ?? 70}
                  onChange={(e) => setSettings((s: any) => ({ ...s, confidenceThreshold: Number(e.target.value) }))}
                  className="settings-slider"
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)' }}>
                  <span>0% (execute all)</span>
                  <span>100% (manual only)</span>
                </div>
              </div>
              <div className="settings-field">
                <label>Auto-Pilot Step Delay ({((settings.autoStepDelay ?? 2000) / 1000).toFixed(1)}s)</label>
                <input
                  type="range"
                  min={500}
                  max={10000}
                  step={500}
                  value={settings.autoStepDelay ?? 2000}
                  onChange={(e) => setSettings((s: any) => ({ ...s, autoStepDelay: Number(e.target.value) }))}
                  className="settings-slider"
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)' }}>
                  <span>0.5s (fast)</span>
                  <span>10s (careful)</span>
                </div>
              </div>
              <button type="submit" className="approve-btn" style={{ width: '100%', marginTop: '12px', justifyContent: 'center' }}>
                Save & Reload Providers
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
