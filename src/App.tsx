import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Send, ShieldCheck, Settings, X } from 'lucide-react'

// Detect Electron environment (window.yogi is exposed by the preload bridge)
const isElectron = !!(window as any).yogi

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
    const searchEl = elements.find(e => e.placeholder?.toLowerCase().includes('search') || e.selector.includes('search'))
    if (searchEl) tasks.push({ action: 'dom_type', description: 'Type search query into the search bar', payload: { selector: searchEl.selector, value: userInput } })
  } else {
    // Generic fallback — pick first clickable, then first typeable
    const clickable = elements.find(e => e.tag === 'button' || e.tag === 'a')
    const typeable  = elements.find(e => e.tag === 'input' || e.tag === 'textarea')
    if (clickable) tasks.push({ action: 'dom_click', description: `Click ${clickable.text || clickable.selector}`, payload: { selector: clickable.selector } })
    if (typeable)  tasks.push({ action: 'dom_type',  description: `Type into ${typeable.placeholder || typeable.selector}`, payload: { selector: typeable.selector, value: userInput } })
  }

  // Guarantee at least 2 tasks — pad with first unused clickable/typeable elements
  if (tasks.length < 2) {
    const usedSelectors = new Set(tasks.map((t: any) => t.payload?.selector))
    const clickable = elements.find(e => (e.tag === 'button' || e.tag === 'a') && !usedSelectors.has(e.selector))
    const typeable  = elements.find(e => (e.tag === 'input'  || e.tag === 'textarea') && !usedSelectors.has(e.selector))
    if (tasks.length < 1 && clickable) {
      tasks.push({ action: 'dom_click', description: `Click "${clickable.text || clickable.selector}"`, payload: { selector: clickable.selector } })
      usedSelectors.add(clickable.selector)
    }
    if (tasks.length < 2) {
      const filler = typeable ?? elements.find(e => !usedSelectors.has(e.selector))
      if (filler) tasks.push({
        action: filler.tag === 'input' || filler.tag === 'textarea' ? 'dom_type' : 'dom_click',
        description: filler.tag === 'input' || filler.tag === 'textarea'
          ? `Type into ${filler.placeholder || filler.selector}`
          : `Click "${filler.text || filler.selector}"`,
        payload: filler.tag === 'input' || filler.tag === 'textarea'
          ? { selector: filler.selector, value: userInput }
          : { selector: filler.selector },
      })
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
const ChatBubble = ({ message, role }: { message: string, role: 'agent' | 'user' }) => (
  <div className={`chat-bubble ${role}`}>
    {message}
  </div>
)

// ──────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────
const App = () => {
  const [messages, setMessages] = useState<any[]>([
    { role: 'agent', message: '🚀 Yogi is online. Ready to automate Open Humana sales. How can I help?' }
  ])
  const [input, setInput] = useState('')
  const [tasks, setTasks] = useState<any[]>([])
  const [workflow, setWorkflow] = useState('reddit_post')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<any>({})
  const [isAutomating, setIsAutomating] = useState(false)
  const [notification, setNotification] = useState<{ message: string, type: 'info' | 'alert' } | null>(null)

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(parseInt(localStorage.getItem('sidebarWidth') || '400'))
  const [isResizing, setIsResizing] = useState(false)

  // Browser state
  // In web mode we load a local mock page (external sites block iframes)
  const mockPageUrl = (wf: string) => `/mock-browser.html?workflow=${wf}`
  const [url, setUrl] = useState(isElectron ? 'https://www.reddit.com/r/sales/' : mockPageUrl('reddit_post'))
  const [inputUrl, setInputUrl] = useState(isElectron ? 'https://www.reddit.com/r/sales/' : 'reddit.com/r/sales/')

  const webviewRef = useRef<any>(null)
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

  // ── Settings ────────────────────────────────────────────
  useEffect(() => {
    const loadSettings = async () => {
      if (isElectron) {
        const res = await (window as any).yogi.getSettings()
        setSettings(res)
      } else {
        const saved = localStorage.getItem('yogi_settings')
        if (saved) setSettings(JSON.parse(saved))
      }
    }
    loadSettings()
  }, [])

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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const logsEndRef = useRef<any>(null)

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

  useEffect(() => {
    if (isDrawerOpen) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thinkingLogs, isDrawerOpen])

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight
    }
  }, [messages, isThinking])

  // ── In web mode: sync iframe to mock page when workflow changes ─────
  const WORKFLOW_DISPLAY_URLS: Record<string, string> = {
    reddit_post:  'reddit.com/r/sales/',
    reddit_reply: 'reddit.com/r/sales/comments/demo',
    linkedin:     'linkedin.com/feed/',
  }
  useEffect(() => {
    if (!isElectron) {
      const next = mockPageUrl(workflow)
      setUrl(next)
      setInputUrl(WORKFLOW_DISPLAY_URLS[workflow] ?? next)
      if (webviewRef.current) webviewRef.current.src = next
    }
  }, [workflow])

  // ── Webview navigation events (Electron only) ───────────
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !isElectron) return

    const handleNavigate = (event: any) => {
      setUrl(event.url)
      setInputUrl(event.url)
    }
    const handleFailLoad = (e: any) => {
      setNotification({ message: `Browser Error: ${e.errorDescription}`, type: 'alert' })
    }

    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFailLoad)

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [])

  // ── Main chat handler ────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim()) return

    const currentInput = input.trim()
    setMessages(prev => [...prev, { role: 'user', message: currentInput }])
    setInput('')
    setIsThinking(true)
    setThinkingLog('Scanning page for interactive elements...')

    try {
      if (!isElectron) {
        // ── MOCK MODE: full simulated pipeline (web preview) ──────────────
        // Helper: update both the transient status bubble AND the persistent drawer log
        const logStep = (msg: string) => {
          setThinkingLog(msg)
          setThinkingLogs(prev => {
            const updated = [...prev, msg]
            localStorage.setItem('thinkingLogs', JSON.stringify(updated.slice(-100)))
            return updated
          })
        }

        logStep('Scanning page for interactive elements...')
        await sleep(600)

        const elements = mockBrowserState(workflow)
        logStep(`Found ${elements.length} interactive elements on page`)
        await sleep(600)

        logStep('Analyzing page structure and mapping selectors...')
        await sleep(600)

        logStep('Sending context to AI brain...')
        await sleep(400)

        const res = await mockAIResponse(currentInput, workflow, elements)

        logStep(`Generating task queue — ${res.tasks.length} action(s) planned`)
        await sleep(300)

        setMessages(prev => [...prev, { role: 'agent', message: res.thought }])

        if (res.tasks.length > 0) {
          setTasks(res.tasks.map((t: any, i: number) => ({
            ...t,
            id: `task-${Date.now()}-${i}`
          })))
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
      const res = await (window as any).yogi.sendChatMessage(contextPrompt, 'high', workflow, settings)

      setMessages(prev => [...prev, { role: 'agent', message: res.text || 'Done.' }])

      // ── QUEUE: populate HITL approval queue ────────────
      if (res.tasks && Array.isArray(res.tasks) && res.tasks.length > 0) {
        setTasks(res.tasks.map((t: any, i: number) => ({
          ...t,
          id: `task-${Date.now()}-${i}`
        })))
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', message: `⚠️ Agent Error: ${e.message}` }])
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

  // ── HITL: approve a queued task ──────────────────────────
  const approveTask = async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return

    // Immediately remove from queue visually
    setTasks(prev => prev.filter(t => t.id !== id))

    if (!isElectron) {
      const actionLabel = task.action === 'dom_type'
        ? `TYPE "${task.payload?.value?.slice(0, 40) ?? ''}" into ${task.payload?.selector}`
        : `CLICK ${task.payload?.selector}`
      setMessages(prev => [...prev, {
        role: 'agent',
        message: `✅ Simulated: ${actionLabel}`
      }])
      return
    }

    try {
      if (task.action === 'dom_click' || task.action === 'dom_type') {
        // Route through the fixed dom-action IPC handler → executes in webview
        const result = await (window as any).yogi.domAction(
          task.payload.selector,
          task.action,
          task.payload.value || ''
        )
        if (result.status === 'error') throw new Error(result.message)
        setMessages(prev => [...prev, {
          role: 'agent',
          message: `✅ ${task.action === 'dom_click' ? 'Clicked' : 'Typed into'}: ${task.description}`
        }])
      } else if (task.action === 'navigate') {
        const targetUrl = task.payload.url
        if (webviewRef.current && isElectron) {
          webviewRef.current.loadURL(targetUrl)
        }
        setUrl(targetUrl)
        setInputUrl(targetUrl)
        setMessages(prev => [...prev, { role: 'agent', message: `🌐 Navigating to: ${targetUrl}` }])
      } else if (task.action === 'execute') {
        const output = await (window as any).yogi.executeTerminal(task.payload.command)
        setMessages(prev => [...prev, { role: 'agent', message: `💻 Terminal: ${output}` }])
      } else {
        // Fallback for legacy action types
        await (window as any).yogi.humanInteraction(task.action, task.payload)
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', message: `⚠️ Task Failed: ${e.message}` }])
    }
  }

  // ── Browser controls ─────────────────────────────────────
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let targetUrl = inputUrl.trim()
    if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`
    setInputUrl(targetUrl)
    if (isElectron && webviewRef.current) {
      webviewRef.current.loadURL(targetUrl)
    } else {
      // In web mode, external URLs can't load in an iframe — stay on mock page
      const next = mockPageUrl(workflow)
      setUrl(next)
      if (webviewRef.current) webviewRef.current.src = next
      setNotification({ message: `Web preview mode: showing mock ${workflow} page. Deploy to Electron to browse live sites.`, type: 'info' })
    }
  }

  const goBack = () => {
    if (!webviewRef.current) return
    if (isElectron) {
      webviewRef.current.canGoBack() && webviewRef.current.goBack()
    } else {
      webviewRef.current.contentWindow?.history.back()
    }
  }

  const goForward = () => {
    if (!webviewRef.current) return
    if (isElectron) {
      webviewRef.current.canGoForward() && webviewRef.current.goForward()
    } else {
      webviewRef.current.contentWindow?.history.forward()
    }
  }

  const reload = () => {
    if (!webviewRef.current) return
    if (isElectron) {
      webviewRef.current.reload()
    } else {
      // contentWindow.location is cross-origin blocked; reassigning src reloads safely
      const iframe = webviewRef.current as HTMLIFrameElement
      iframe.src = iframe.src
    }
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="app-container" style={{ '--sidebar-width': `${sidebarWidth}px` } as any}>

      {/* ── LEFT: Copilot sidebar ── */}
      <div className="sidebar" ref={sidebarRef}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Yogi Browser</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`toggle-btn ${isAutomating ? 'active' : ''}`}
                title={isAutomating ? 'Automation ON' : 'Automation OFF'}
                onClick={() => setIsAutomating(v => !v)}
              >
                {isAutomating ? <ShieldCheck size={18} /> : <RotateCw size={18} />}
              </button>
              <button className="nav-btn" title="Settings" onClick={() => setShowSettings(true)}>
                <Settings size={20} />
              </button>
            </div>
          </div>
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

        {/* ── Chat feed ── */}
        <div className="chat-feed" ref={chatFeedRef}>
          {messages.map((m, i) => (
            <ChatBubble key={i} message={m.message} role={m.role} />
          ))}

          {isThinking && (
            <div className="chat-bubble agent thinking" onClick={() => setIsDrawerOpen(true)}>
              <div className="thinking-label">YOGI IS PROCESSING…</div>
              <div className="thinking-status">{thinkingLog}</div>
            </div>
          )}
        </div>

        {/* ── Technical log drawer ── */}
        {isDrawerOpen && (
          <div className="thinking-drawer">
            <div className="drawer-header">
              <h3>Process Log</h3>
              <button
                onClick={() => setIsDrawerOpen(false)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="drawer-logs">
              {thinkingLogs.map((log, i) => (
                <div key={i} className="log-line">{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ── HITL Approval Queue ── */}
        {tasks.length > 0 && (
          <div className="task-queue">
            <div className="task-queue-label">HITL APPROVAL QUEUE ({tasks.length})</div>
            {tasks.map(t => (
              <div key={t.id} className="task-card">
                <div className="task-card-header">
                  <span className="task-action">{t.action.replace('dom_', '').toUpperCase()}</span>
                  <button className="approve-btn" onClick={() => approveTask(t.id)}>
                    <ShieldCheck size={13} style={{ marginRight: '5px' }} />
                    Approve
                  </button>
                </div>
                <p className="task-desc">{t.description}</p>
                {t.payload?.selector && (
                  <code className="task-selector">{t.payload.selector}</code>
                )}
              </div>
            ))}
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

        <div className={`resize-handle ${isResizing ? 'active' : ''}`} onMouseDown={startResizing} />
      </div>

      {/* ── RIGHT: Browser viewport ── */}
      <div className="main-view">
        <div className="browser-nav">
          <div className="nav-buttons">
            <button onClick={goBack} className="nav-btn" title="Back"><ChevronLeft size={20} /></button>
            <button onClick={goForward} className="nav-btn" title="Forward"><ChevronRight size={20} /></button>
            <button onClick={reload} className="nav-btn" title="Reload"><RotateCw size={18} /></button>
          </div>
          <form className="address-bar-container" onSubmit={handleUrlSubmit}>
            <input
              className="address-bar"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
            />
          </form>
        </div>

        <div className="browser-viewport">
          {isElectron ? (
            // Electron: native webview tag with full access to webContents
            <webview
              ref={webviewRef}
              src={url}
              webpreferences="nodeIntegration=no, contextIsolation=yes"
              allowpopups={true as any}
              style={{ width: '100%', height: '100%' }}
              useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
            />
          ) : (
            // Web preview: regular iframe
            <iframe
              ref={webviewRef}
              src={url}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="Yogi Browser Viewport"
            />
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
                <label>Google Gemini Keys (one per line)</label>
                <textarea
                  rows={2}
                  value={settings.GOOGLE_KEYS || ''}
                  onChange={(e) => setSettings((s: any) => ({ ...s, GOOGLE_KEYS: e.target.value }))}
                  placeholder="AIza..."
                />
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
