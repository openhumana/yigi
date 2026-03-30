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
        function getSelector(e) {
          if (e.id) return '#' + e.id
          const name = e.getAttribute('name')
          if (name) return e.tagName.toLowerCase() + '[name="' + name + '"]'
          const dt = e.getAttribute('data-testid')
          if (dt) return '[data-testid="' + dt + '"]'
          const aria = e.getAttribute('aria-label')
          if (aria) return e.tagName.toLowerCase() + '[aria-label="' + aria + '"]'
          if (e.placeholder) return e.tagName.toLowerCase() + '[placeholder="' + e.placeholder + '"]'
          const role = e.getAttribute('role')
          if (role) return e.tagName.toLowerCase() + '[role="' + role + '"]'
          const cls = Array.from(e.classList).slice(0, 2).join('.')
          return e.tagName.toLowerCase() + (cls ? '.' + cls : '')
        }

        // Primary interactive elements
        const primary = Array.from(document.querySelectorAll(
          'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="searchbox"], [role="search"] *, [aria-label*="search" i], [aria-label*="Search" i], svg[aria-label], [class*="search" i] button, [class*="Search" i] button, nav button, header button'
        ))

        const seen = new Set()
        const nodes = primary.filter(el => {
          const key = el.outerHTML.slice(0, 60)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }).slice(0, 100)

        return nodes.map(el => {
          const rect = el.getBoundingClientRect()
          const visible = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight + 200
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 60),
            selector: getSelector(el),
            placeholder: el.placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            type: el.type || '',
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible,
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

// Try a list of selectors in order, return first match or null
// perSelectorMs: max ms to wait per individual selector (keep low to avoid 40s stall)
async function findElement(selectors, timeout = 12000, perSelectorMs = 2500) {
  const deadline = Date.now() + timeout
  for (const sel of selectors) {
    if (Date.now() >= deadline) break
    const remaining = deadline - Date.now()
    const wait = Math.min(perSelectorMs, remaining)
    try {
      const el = page.locator(sel).first()
      await el.waitFor({ state: 'visible', timeout: wait })
      return el
    } catch (_) {}
  }
  return null
}

// Robust click: try selector list, then coordinates, then JS click
async function robustClick(selector, x, y) {
  if (x != null && y != null) {
    await page.mouse.click(x, y)
    return
  }

  const selectors = selector ? buildSelectorVariants(selector) : []
  const el = await findElement(selectors, 12000)
  if (el) {
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await el.click({ timeout: 8000, force: false }).catch(async () => {
      await el.click({ timeout: 5000, force: true }).catch(async () => {
        const box = await el.boundingBox()
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      })
    })
    return
  }
  throw new Error(`Element not found: ${selector}`)
}

// Try to click a search-reveal trigger (magnifying glass icon, search button in nav)
async function tryRevealSearchInput() {
  // Look for common search trigger patterns
  const searchTriggerSelectors = [
    'button[aria-label*="earch" i]',
    'button[title*="earch" i]',
    '[aria-label*="earch" i]:not(input):not(textarea)',
    'a[aria-label*="earch" i]',
    '[class*="search" i][class*="icon" i]',
    '[class*="searchIcon" i]',
    '[class*="search-icon" i]',
    '[class*="SearchIcon" i]',
    'button[class*="search" i]',
    'header button',
    'nav button',
  ]
  const trigger = await findElement(searchTriggerSelectors, 6000, 800)
  if (trigger) {
    console.log('[BrowserServer] Clicking search trigger to reveal input')
    await trigger.click({ force: true }).catch(() => {})
    await page.waitForTimeout(800)
    return true
  }
  // Try clicking by coordinates — search icons are typically top-right
  const viewportSize = page.viewportSize()
  if (viewportSize) {
    // Try common search icon positions (top-right area)
    const candidates = [
      { x: viewportSize.width - 60, y: 40 },
      { x: viewportSize.width - 40, y: 40 },
      { x: viewportSize.width - 80, y: 40 },
      { x: viewportSize.width - 100, y: 40 },
    ]
    for (const pos of candidates) {
      try {
        await page.mouse.click(pos.x, pos.y)
        await page.waitForTimeout(500)
        // Check if an input appeared
        const input = await findElement(['input[type="search"]', 'input[type="text"]', '[role="searchbox"]'], 1000)
        if (input) {
          console.log(`[BrowserServer] Search revealed by clicking at ${pos.x},${pos.y}`)
          return true
        }
      } catch (_) {}
    }
  }
  return false
}

// Human-like typing: character by character with natural randomized delays
async function humanTypeTo(element, text) {
  await element.scrollIntoViewIfNeeded().catch(() => {})
  await element.click({ force: true }).catch(() => {})
  await page.waitForTimeout(200)
  // Clear existing content first
  await element.fill('', { timeout: 3000 }).catch(async () => {
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)
    await page.keyboard.press('Delete')
  })
  await page.waitForTimeout(150)
  // Type character by character
  for (const char of text) {
    await page.keyboard.type(char)
    // Realistic inter-keystroke delay: 40-120ms, occasional longer pause (punctuation / spaces)
    let delay = 40 + Math.random() * 80
    if (char === ' ') delay += Math.random() * 80
    if (char === ',' || char === '.') delay += Math.random() * 120
    if (Math.random() < 0.06) delay += 200 + Math.random() * 400 // thinking pause
    await page.waitForTimeout(delay)
  }
}

// Robust type: try selector list with fill, fall back to keyboard
async function robustType(selector, value) {
  const selectors = selector ? buildSelectorVariants(selector) : []
  // Use 1500ms per selector so 10 variants = max 15s total (but deadline stops it at 8s)
  let el = await findElement(selectors, 8000, 1500)
  if (el) {
    await humanTypeTo(el, value || '')
    return
  }

  // No direct match — try to reveal hidden search input by clicking search icon
  console.log(`[BrowserServer] Selector "${selector}" not found, attempting search reveal`)
  await tryRevealSearchInput()

  // Retry finding any input after reveal attempt
  const inputSelectors = [
    ...selectors,
    'input[type="search"]', 'input[type="text"]', 'textarea',
    '[role="searchbox"]', '[role="textbox"]',
    'input[placeholder*="earch"]', 'input[aria-label*="earch"]',
    'input[aria-label*="Search"]', 'input[placeholder*="Search"]',
    'input:visible',
  ]
  el = await findElement(inputSelectors, 6000, 1000)
  if (el) {
    await humanTypeTo(el, value || '')
    return
  }

  throw new Error(`Cannot find element to type into: ${selector}. The search field may be hidden — try clicking a search icon first.`)
}

// Build multiple selector variants to increase match chances
function buildSelectorVariants(selector) {
  if (!selector) return []
  const variants = [selector]

  // If selector is input[type='search'], also try these
  if (selector.includes('type=') && selector.includes('search')) {
    variants.push(
      'input[type="search"]',
      'input[role="searchbox"]',
      '[role="searchbox"]',
      'input[name*="search"]',
      'input[placeholder*="earch"]',
      'input[aria-label*="earch"]',
      '.search-input',
      '#search-input',
      'input.search',
    )
  }

  // Generic input fallbacks
  if (selector.startsWith('input') || selector.includes('[type=')) {
    variants.push(
      selector.replace(/'/g, '"'),
      selector.replace(/"/g, "'"),
    )
  }

  return [...new Set(variants)]
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
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 })
    // Wait for network idle (JS-heavy sites like humana.com need time to render)
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1000)
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
      await robustClick(selector, x, y)
      // Wait for possible navigation or DOM change
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(800)

    } else if (type === 'type') {
      await robustType(selector, value)
      await page.waitForTimeout(400)

    } else if (type === 'press_enter') {
      if (selector) {
        const selectors = buildSelectorVariants(selector)
        const el = await findElement(selectors, 8000)
        if (el) {
          await el.press('Enter').catch(() => page.keyboard.press('Enter'))
        } else {
          await page.keyboard.press('Enter')
        }
      } else {
        await page.keyboard.press('Enter')
      }
      // After pressing enter, wait for navigation or results
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(1500)

    } else if (type === 'scroll') {
      await page.mouse.wheel(0, deltaY || 400)
      await page.waitForTimeout(500)

    } else if (type === 'search') {
      const searchSelectors = [
        ...(selector ? buildSelectorVariants(selector) : []),
        'input[name="q"]', 'input[type="search"]', 'textarea[name="q"]',
        '[role="searchbox"]', 'input[role="searchbox"]',
        'input[placeholder*="earch"]', 'input[aria-label*="earch"]',
      ]
      const el = await findElement(searchSelectors, 10000)
      if (el) {
        await el.click({ force: true }).catch(() => {})
        await page.waitForTimeout(300)
        await el.fill(value || '', { timeout: 8000 }).catch(async () => {
          await el.type(value || '', { delay: 30 })
        })
        await page.waitForTimeout(400)
        await page.keyboard.press('Enter')
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {})
        await page.waitForTimeout(2000)
      } else {
        throw new Error('Could not find a search input on this page')
      }
    }

    const state = await getPageState()
    res.json({ ...state, ok: true })
  } catch (err) {
    console.error('[BrowserServer] action error:', type, err.message)
    try {
      const state = await getPageState()
      // Return ok:false but include page state so the UI can still show the screenshot
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

// DOM evaluation endpoint for debugging and smart element discovery
app.post('/api/browser/eval', async (req, res) => {
  const { script } = req.body
  if (!browserReady || !page) return res.status(503).json({ error: 'Browser not ready' })
  try {
    const result = await page.evaluate(script)
    res.json({ result, ok: true })
  } catch (err) {
    res.json({ error: err.message, ok: false })
  }
})

// ── Groq AI endpoint — reactive step-by-step agent planning ──────────────
app.post('/api/browser/ai', async (req, res) => {
  const { userMessage, elements, pageUrl, pageTitle, goal, history, stepMode } = req.body
  const groqKey = process.env.DEFAULT_GROQ_KEY
  if (!groqKey) {
    return res.json({ text: 'Groq key not configured.', tasks: [], isDone: false, model: '' })
  }

  const elementList = (elements || []).slice(0, 60).map((el, i) =>
    `${i + 1}. [${el.tag}] "${el.text || el.ariaLabel || el.placeholder || ''}" → selector: "${el.selector}"${el.placeholder ? ` placeholder="${el.placeholder}"` : ''}${el.ariaLabel ? ` aria="${el.ariaLabel}"` : ''} (x:${el.x} y:${el.y})`
  ).join('\n')

  const noElements = !elements || elements.length === 0

  // In stepMode (reactive loop): plan only 1-2 next actions based on current screen
  const systemPrompt = stepMode ? `You are Yogi, an AI browser automation agent working step-by-step like a human.

GOAL: ${goal || userMessage}

STEPS COMPLETED SO FAR:
${(history || []).length > 0 ? (history || []).map((h, i) => `${i + 1}. ${h}`).join('\n') : '(none yet — just starting)'}

WHAT YOU SEE NOW:
Page: "${pageTitle || 'unknown'}" — ${pageUrl || 'about:blank'}
${noElements ? 'No elements detected on screen yet.' : `${elements.length} interactive elements visible:\n${elementList}`}

Based on what you see NOW, decide the NEXT 1-2 actions to make progress toward the goal.
Think like a human: what would you look at and click or type next?

RULES:
- Only plan 1-2 actions maximum
- Only use selectors from the elements list above for dom_click/dom_type
- If you need a hidden element (like a search bar), first dom_click on whatever opens it
- After clicking a link or pressing Enter, the next step will see the new page — don't pre-plan it now
- If the goal looks accomplished based on the current page, set isDone: true
- SMART NAVIGATION: If the current page doesn't have what you need but you know where it is (e.g., careers.humana.com, google.com, etc.), use "navigate" with a direct URL instead of clicking around — it's faster and more reliable
- For job searches, go directly to the company's careers site (e.g., careers.humana.com) rather than exploring from the homepage
- If you find yourself on a Google search results page, look for the actual link to click

Respond with JSON only:
{
  "thought": "What I see on screen and what I will do next",
  "isDone": false,
  "tasks": [
    {
      "action": "navigate|dom_click|dom_type|dom_press_enter|scroll",
      "description": "Human-readable description of this step",
      "payload": { "url": "...", "selector": "...", "value": "...", "deltaY": 400 }
    }
  ]
}` : `You are Yogi, an AI browser automation agent.

Current page: "${pageTitle || 'unknown'}" — ${pageUrl || 'about:blank'}

${noElements ? 'No elements detected on screen yet. Start with a navigate action.' : `Interactive elements visible on page:\n${elementList}`}

Plan the next 1-3 browser actions to accomplish the user's request.

Respond with JSON only:
{
  "thought": "Brief explanation of what you will do",
  "isDone": false,
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
- dom_click: click an element (payload.selector from elements list)
- dom_type: type text into element (payload.selector, payload.value) — uses human-like typing
- dom_press_enter: press Enter (payload.selector)
- scroll: scroll page (payload.deltaY)

IMPORTANT: Only use selectors from the elements list. If needed element is not visible, click a button to reveal it first.`

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
          { role: 'user', content: goal || userMessage },
        ],
        max_tokens: 800,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    const data = await resp.json()
    const raw = data.choices?.[0]?.message?.content || '{}'
    let parsed = { thought: '', tasks: [], isDone: false }
    try { parsed = JSON.parse(raw) } catch {}
    // Enforce max 2 tasks in stepMode
    const tasks = stepMode ? (parsed.tasks || []).slice(0, 2) : (parsed.tasks || []).slice(0, 5)
    res.json({
      text: parsed.thought || 'Ready.',
      tasks,
      isDone: parsed.isDone || false,
      model: data.model || 'groq',
    })
  } catch (err) {
    console.error('[BrowserServer] AI error:', err.message)
    res.json({ text: `AI error: ${err.message}`, tasks: [], isDone: false, model: '' })
  }
})

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[BrowserServer] Starting on port ${PORT}`)
  await initBrowser()
})
