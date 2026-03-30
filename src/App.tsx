import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, Send, ShieldCheck, Settings, X } from 'lucide-react'

const isElectron = !!(window as any).yogi

const ChatBubble = ({ message, role }: { message: string, role: 'agent' | 'user' }) => (
  <div className={`chat-bubble ${role}`}>
    {message}
  </div>
)

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

  const [sidebarWidth, setSidebarWidth] = useState(parseInt(localStorage.getItem('sidebarWidth') || '400'))
  const [isResizing, setIsResizing] = useState(false)

  const [url, setUrl] = useState('https://www.reddit.com/r/sales/')
  const [inputUrl, setInputUrl] = useState('https://www.reddit.com/r/sales/')

  const webviewRef = useRef<any>(null)
  const sidebarRef = useRef<any>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

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
  }

  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLog, setThinkingLog] = useState('Yogi is starting...')
  const [thinkingLogs, setThinkingLogs] = useState<string[]>(JSON.parse(localStorage.getItem('thinkingLogs') || '[]'))
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const logsEndRef = useRef<any>(null)

  useEffect(() => {
    if (isElectron && (window as any).yogi) {
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

  const handleSend = async () => {
    if (!input) return
    const userMsg = { role: 'user', message: input }
    setMessages(prev => [...prev, userMsg])

    const currentInput = input
    setInput('')
    setIsThinking(true)
    setThinkingLog('Scanning current page for elements...')

    try {
      if (isElectron) {
        let pageMap = {}
        try {
          pageMap = await (window as any).yogi.getBrowserState()
        } catch (e) {
          console.warn("Could not retrieve browser state context", e)
        }

        const contextPrompt = `
        BROWSER CONTEXT (Current Page Elements):
        ${JSON.stringify(pageMap)}

        USER REQUEST:
        ${currentInput}
        `

        const res = await (window as any).yogi.sendChatMessage(contextPrompt, 'high', workflow, settings)

        setMessages(prev => [...prev, { role: 'agent', message: res.text }])

        if (res.tasks && Array.isArray(res.tasks)) {
          setTasks(res.tasks.map((t: any, i: number) => ({
            ...t,
            id: `task-${Date.now()}-${i}`
          })))
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'agent',
          message: `⚠️ Desktop mode required: Yogi's AI automation runs as a desktop app. Configure your API keys in Settings and run the Electron app to enable full automation.`
        }])
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', message: `⚠️ Agent Error: ${e.message}` }])
    } finally {
      setIsThinking(false)
    }
  }

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files as any)?.[0]
    if (!file) return
    setIsThinking(true)
    setThinkingLog(`Parsing PDF Knowledge...`)
    try {
      if (isElectron) {
        const res = await (window as any).yogi.parsePdf(file.path)
        if (res.status === 'success') {
          setSettings({ ...settings, MASTER_KB: (settings.MASTER_KB || '') + '\n\n' + res.text })
          setNotification({ message: `Successfully synced PDF context!`, type: 'info' })
        }
      } else {
        setNotification({ message: `PDF parsing requires the desktop app.`, type: 'info' })
      }
    } catch (err: any) {
      setNotification({ message: `Error: ${err.message}`, type: 'alert' })
    } finally {
      setIsThinking(false)
    }
  }

  const approveTask = async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return

    try {
      if (!isElectron) {
        setTasks(prev => prev.filter(t => t.id !== id))
        return
      }
      if (task.action === 'dom_click' || task.action === 'dom_type') {
        const result = await (window as any).yogi.domAction(
          task.payload.selector,
          task.action,
          task.payload.value || ""
        )
        if (result.status === 'error') throw new Error(result.message)
      } else if (task.action === 'execute') {
        await (window as any).yogi.executeTerminal(task.payload.command)
      } else if (task.action === 'navigate') {
        setUrl(task.payload.url)
        setInputUrl(task.payload.url)
      } else if (['type', 'click', 'scroll'].includes(task.action)) {
        await (window as any).yogi.humanInteraction(task.action, task.payload)
      }
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', message: `⚠️ Task Failed: ${e.message}` }])
    }
  }

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let targetUrl = inputUrl
    if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`
    setUrl(targetUrl)
    setInputUrl(targetUrl)
  }

  const goBack = () => {
    if (webviewRef.current) {
      if (isElectron) {
        webviewRef.current.canGoBack() && webviewRef.current.goBack()
      } else {
        webviewRef.current.contentWindow?.history.back()
      }
    }
  }

  const goForward = () => {
    if (webviewRef.current) {
      if (isElectron) {
        webviewRef.current.canGoForward() && webviewRef.current.goForward()
      } else {
        webviewRef.current.contentWindow?.history.forward()
      }
    }
  }

  const reload = () => {
    if (webviewRef.current) {
      if (isElectron) {
        webviewRef.current.reload()
      } else {
        webviewRef.current.contentWindow?.location.reload()
      }
    }
  }

  return (
    <div className="app-container" style={{ '--sidebar-width': `${sidebarWidth}px` } as any}>
      <div className="sidebar" ref={sidebarRef}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Yogi Browser</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className={`toggle-btn ${isAutomating ? 'active' : ''}`} onClick={() => setIsAutomating(!isAutomating)}>
                {isAutomating ? <ShieldCheck size={18} /> : <RotateCw size={18} />}
              </button>
              <button className="nav-btn" onClick={() => setShowSettings(true)}><Settings size={20} /></button>
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

        <div className="chat-feed">
          {messages.map((m, i) => <ChatBubble key={i} message={m.message} role={m.role} />)}
          {isThinking && (
            <div className="chat-bubble agent thinking" onClick={() => setIsDrawerOpen(true)}>
              <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--primary)' }}>YOGI IS PROCESSING...</div>
              <div>{thinkingLog}</div>
            </div>
          )}
          {isDrawerOpen && (
            <div className="thinking-drawer">
              <div className="drawer-header">
                <h3>Technical Process Log</h3>
                <button onClick={() => setIsDrawerOpen(false)} style={{ background: 'none', border: 'none', color: 'white' }}><X size={16} /></button>
              </div>
              <div className="drawer-logs">
                {thinkingLogs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        {tasks.length > 0 && (
          <div className="task-queue">
            <div className="task-queue-label">HITL APPROVAL QUEUE</div>
            {tasks.map(t => (
              <div key={t.id} className="task-card">
                <div className="task-card-header">
                  <span className="task-action">{t.action.replace('dom_', '').toUpperCase()}</span>
                  <button className="approve-btn" onClick={() => approveTask(t.id)}>
                    <ShieldCheck size={14} style={{ marginRight: '4px' }} /> Approve
                  </button>
                </div>
                <p>{t.description}</p>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-container">
          <input className="chat-input" placeholder="Tell Yogi what to do..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
          <button className="send-btn" onClick={handleSend}><Send size={18} /></button>
        </div>
        <div className={`resize-handle ${isResizing ? 'active' : ''}`} onMouseDown={startResizing} />
      </div>

      <div className="main-view">
        <div className="browser-nav">
          <div className="nav-buttons">
            <button onClick={goBack} className="nav-btn"><ChevronLeft size={20} /></button>
            <button onClick={goForward} className="nav-btn"><ChevronRight size={20} /></button>
            <button onClick={reload} className="nav-btn"><RotateCw size={18} /></button>
          </div>
          <form className="address-bar-container" onSubmit={handleUrlSubmit}>
            <input className="address-bar" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} />
          </form>
        </div>
        <div className="browser-viewport">
          <iframe
            ref={webviewRef}
            src={url}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Yogi Browser Viewport"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
          />
        </div>
      </div>

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Agent Configuration</h3>
              <button className="nav-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div className="settings-field">
                <label>Google Gemini Vault</label>
                <textarea className="key-vault-input" rows={2} value={settings.GOOGLE_KEYS || ''} onChange={(e) => setSettings({ ...settings, GOOGLE_KEYS: e.target.value })} />
              </div>
              <div className="settings-field">
                <label>Master Knowledge Base</label>
                <textarea rows={5} value={settings.MASTER_KB || ''} onChange={(e) => setSettings({ ...settings, MASTER_KB: e.target.value })} />
                <div style={{ marginTop: '12px' }}>
                  <input type="file" accept="application/pdf" onChange={handlePdfUpload} style={{ display: 'none' }} id="pdf-upload" />
                  <label htmlFor="pdf-upload" className="approve-btn" style={{ cursor: 'pointer', background: 'rgba(82,134,255,0.2)', color: 'var(--primary)' }}>Upload & Extract PDF</label>
                </div>
              </div>
              <button type="submit" className="approve-btn" style={{ width: '100%', marginTop: '10px' }}>Save & Rotate</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
