const express = require('express')
const cors = require('cors')
const { chromium } = require('playwright-core')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const PORT = 5001
const VIEWPORT = { width: 1280, height: 800 }

let browser = null
let page = null
let browserReady = false

async function initBrowser() {
  try {
    if (browser) { try { await browser.close() } catch (_) {} }
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,800',
      ],
    })
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    })
    page = await context.newPage()
    await page.goto('about:blank')
    browserReady = true
    console.log('[BrowserServer] Chromium ready')
  } catch (err) {
    console.error('[BrowserServer] Init failed:', err.message)
    browserReady = false
  }
}

async function getPageState() {
  if (!page) return { screenshot: null, elements: [], url: '', title: '' }
  try {
    const [screenshot, url, title, elements] = await Promise.all([
      page.screenshot({ type: 'jpeg', quality: 75, fullPage: false }),
      page.url(),
      page.title(),
      page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(
          'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="searchbox"]'
        )).slice(0, 80)
        return nodes.map(el => {
          function getSelector(e) {
            if (e.id) return '#' + e.id
            const name = e.getAttribute('name')
            if (name) return e.tagName.toLowerCase() + '[name="' + name + '"]'
            const dt = e.getAttribute('data-testid')
            if (dt) return '[data-testid="' + dt + '"]'
            const aria = e.getAttribute('aria-label')
            if (aria) return e.tagName.toLowerCase() + '[aria-label="' + aria + '"]'
            if (e.placeholder) return e.tagName.toLowerCase() + '[placeholder="' + e.placeholder + '"]'
            const cls = Array.from(e.classList).slice(0, 2).join('.')
            return e.tagName.toLowerCase() + (cls ? '.' + cls : '')
          }
          const rect = el.getBoundingClientRect()
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60),
            selector: getSelector(el),
            placeholder: el.placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            type: el.type || '',
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight,
          }
        }).filter(e => e.visible)
      })
    ])
    return {
      screenshot: screenshot.toString('base64'),
      elements,
      url,
      title,
    }
  } catch (err) {
    console.error('[BrowserServer] getPageState error:', err.message)
    return { screenshot: null, elements: [], url: page?.url() || '', title: '' }
  }
}

app.get('/api/browser/status', (req, res) => {
  res.json({ ready: browserReady, url: page?.url() || '' })
})

app.post('/api/browser/navigate', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })
  if (!browserReady) await initBrowser()
  try {
    let target = url.trim()
    if (!target.startsWith('http')) target = 'https://' + target
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(1500)
    const state = await getPageState()
    res.json({ ...state, ok: true })
  } catch (err) {
    console.error('[BrowserServer] navigate error:', err.message)
    try {
      const state = await getPageState()
      res.json({ ...state, ok: false, error: err.message })
    } catch (_) {
      res.json({ screenshot: null, elements: [], url: '', title: '', ok: false, error: err.message })
    }
  }
})

app.post('/api/browser/action', async (req, res) => {
  const { type, selector, value, x, y, deltaY } = req.body
  if (!browserReady || !page) return res.status(503).json({ error: 'Browser not ready' })
  try {
    if (type === 'click') {
      if (x != null && y != null) {
        await page.mouse.click(x, y)
      } else if (selector) {
        const el = page.locator(selector).first()
        await el.click({ timeout: 5000 }).catch(async () => {
          await page.click(selector, { timeout: 5000, force: true })
        })
      }
      await page.waitForTimeout(1200)

    } else if (type === 'type') {
      if (selector) {
        const el = page.locator(selector).first()
        await el.click({ timeout: 5000 }).catch(() => {})
        await el.fill(value || '', { timeout: 5000 }).catch(async () => {
          await page.type(selector, value || '', { timeout: 5000 })
        })
      }
      await page.waitForTimeout(600)

    } else if (type === 'press_enter') {
      if (selector) {
        await page.press(selector, 'Enter').catch(() => {})
      } else {
        await page.keyboard.press('Enter')
      }
      await page.waitForTimeout(2000)

    } else if (type === 'scroll') {
      await page.mouse.wheel(0, deltaY || 400)
      await page.waitForTimeout(500)

    } else if (type === 'search') {
      const searchInput = selector || 'input[name="q"], input[type="search"], textarea[name="q"]'
      const el = page.locator(searchInput).first()
      await el.click({ timeout: 5000 }).catch(() => {})
      await el.fill(value || '', { timeout: 5000 }).catch(async () => {
        await page.fill(searchInput, value || '')
      })
      await page.waitForTimeout(400)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(2500)
    }

    const state = await getPageState()
    res.json({ ...state, ok: true })
  } catch (err) {
    console.error('[BrowserServer] action error:', type, err.message)
    try {
      const state = await getPageState()
      res.json({ ...state, ok: false, error: err.message })
    } catch (_) {
      res.json({ screenshot: null, elements: [], url: '', title: '', ok: false, error: err.message })
    }
  }
})

app.get('/api/browser/screenshot', async (req, res) => {
  if (!browserReady || !page) return res.json({ screenshot: null, elements: [], url: '' })
  const state = await getPageState()
  res.json(state)
})

app.post('/api/browser/reset', async (req, res) => {
  await initBrowser()
  res.json({ ok: browserReady })
})

// ── Groq AI endpoint — real task planning from page elements ──────────────
app.post('/api/browser/ai', async (req, res) => {
  const { userMessage, elements, pageUrl, pageTitle } = req.body
  const groqKey = process.env.DEFAULT_GROQ_KEY
  if (!groqKey) {
    return res.json({ text: 'Groq key not configured.', tasks: [], model: '' })
  }
  const elementList = (elements || []).slice(0, 50).map(el =>
    `[${el.tag}] text="${el.text}" selector="${el.selector}"${el.ariaLabel ? ` aria="${el.ariaLabel}"` : ''}${el.placeholder ? ` placeholder="${el.placeholder}"` : ''}`
  ).join('\n')

  const systemPrompt = `You are Yogi, an AI browser automation agent. The user wants you to perform tasks in their browser.

Current page: ${pageTitle || ''} — ${pageUrl || ''}

Interactive elements on page:
${elementList || 'No elements detected yet. Use navigate action to load a page.'}

Respond with JSON only:
{
  "thought": "Brief explanation of what you will do",
  "tasks": [
    {
      "action": "navigate|dom_click|dom_type|dom_press_enter|scroll",
      "description": "Human-readable description",
      "payload": { "url": "...", "selector": "...", "value": "...", "deltaY": 400 }
    }
  ]
}

Action types:
- navigate: go to a URL (payload.url)
- dom_click: click an element (payload.selector)
- dom_type: type text into element (payload.selector, payload.value)
- dom_press_enter: press Enter in element (payload.selector)
- scroll: scroll page (payload.deltaY)

Only include actions that make sense for the current page. If no elements are loaded, start with a navigate action.`

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    })
    const data = await resp.json()
    const raw = data.choices?.[0]?.message?.content || '{}'
    let parsed = { thought: '', tasks: [] }
    try { parsed = JSON.parse(raw) } catch {}
    res.json({
      text: parsed.thought || 'Ready.',
      tasks: parsed.tasks || [],
      model: data.model || 'groq',
    })
  } catch (err) {
    console.error('[BrowserServer] AI error:', err.message)
    res.json({ text: `AI error: ${err.message}`, tasks: [], model: '' })
  }
})

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[BrowserServer] Starting on port ${PORT}`)
  await initBrowser()
})
