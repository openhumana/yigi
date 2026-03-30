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

// Robust type: try selector list with fill, fall back to keyboard
async function robustType(selector, value) {
  const selectors = selector ? buildSelectorVariants(selector) : []
  // Use 1500ms per selector so 10 variants = max 15s total (but deadline stops it at 8s)
  let el = await findElement(selectors, 8000, 1500)
  if (el) {
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await el.click({ timeout: 5000, force: true }).catch(() => {})
    await page.waitForTimeout(300)
    await el.fill(value || '', { timeout: 8000 }).catch(async () => {
      await el.type(value || '', { delay: 30 }).catch(async () => {
        await page.keyboard.type(value || '', { delay: 30 })
      })
    })
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
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await el.click({ force: true }).catch(() => {})
    await page.waitForTimeout(300)
    await el.fill(value || '', { timeout: 8000 }).catch(async () => {
      await el.type(value || '', { delay: 30 }).catch(async () => {
        await page.keyboard.type(value || '', { delay: 30 })
      })
    })
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

Interactive elements on page (use these exact selectors):
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
- dom_click: click an element using selector from the elements list above (payload.selector)
- dom_type: type text into element using selector from elements list (payload.selector, payload.value)
- dom_press_enter: press Enter in element (payload.selector from elements list)
- scroll: scroll page (payload.deltaY)

IMPORTANT: Always use selectors from the elements list above. If the element you need is not in the list, use navigate to go to a different page or use dom_click on a visible button to reveal hidden elements first.`

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
        temperature: 0.2,
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
