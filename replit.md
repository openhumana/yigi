# Yogi Browser

A React + Vite frontend for the Yogi Browser desktop app — an AI-powered HITL (Human-in-the-Loop) sales automation tool built by OpenHumana.

## Project Overview

Originally an Electron desktop application, adapted to run as a web app in the Replit environment for preview/development. The full Electron features (native webview, IPC, terminal sandbox, electron-store) only activate in the desktop build, but the UI is fully functional as a web preview with a real proxy browser.

## Architecture

- **Frontend**: React 18 + TypeScript + Vite (port 5000 for Replit preview)
- **Styling**: Custom CSS dark theme (`src/styles/index.css`)
- **State**: React useState hooks + localStorage for persistence
- **AI**: LangChain integrations (Groq → Google Gemini → OpenAI, auto-fallback) — desktop only
- **Electron (desktop only)**: Main process (`main/`), preload bridge (`preload/`), sandboxed terminal, electron-store for settings
- **Proxy Browser**: `/__proxy?url=` endpoint in vite.config.ts strips X-Frame-Options/CSP and injects bridge script for live DOM interaction in web preview

## Key Files

- `src/App.tsx` — Main React component. Detects Electron via `window.yogi`. Uses `<webview>` in Electron, `<iframe>` in web.
- `src/main.tsx` — React entry point
- `src/styles/index.css` — Full dark-themed CSS with CRM polish
- `vite.config.ts` — Vite config + proxy middleware for live browsing
- `main/index.ts` — Electron main process + all IPC handlers
- `main/orchestrator.ts` — AI model orchestration with multi-key pool fallback
- `main/validator.ts` — Post-action verification: heuristic comparison (URL, elements, title) + CAPTCHA detection
- `main/vision.ts` — Screenshot-based visual intelligence via GPT-4o/Gemini vision models
- `main/sandbox.ts` — Sandboxed terminal execution (blacklisted destructive commands)
- `main/human_interaction.ts` — Human-like typing (variable speed, typos) and mouse interaction
- `preload/index.ts` — Electron contextBridge exposing `window.yogi`
- `public/mock-browser.html` — Offline fallback with three realistic workflow layouts

## IPC Handlers (main/index.ts)

| Channel | Direction | Purpose |
|---|---|---|
| `get-browser-state` | renderer→main | Scans webview for interactive elements, returns selectors |
| `dom-action` | renderer→main | Executes `dom_click` or `dom_type` inside the webview |
| `ai-request` | renderer→main | Routes prompt through ModelOrchestrator |
| `terminal-exec` | renderer→main | Runs sandboxed shell command |
| `get-settings` / `save-settings` | renderer→main | electron-store CRUD |
| `parse-pdf` | renderer→main | Extracts text from PDF using pdf-parse |
| `capture-screenshot` | renderer→main | Captures webview as base64 PNG |
| `wait-for-stability` | renderer→main | Waits for DOM mutations to stop + network idle |
| `validate-action` | renderer→main | Runs verify-after-action loop (before/after comparison) |
| `analyze-screenshot` | renderer→main | Sends screenshot to vision LLM for analysis |
| `capture-snapshot` | renderer→main | Captures full browser state snapshot (URL + title + elements) |

## Automation Flow (with Verify Loop)

```
User types command
  → handleSend() fetches browser map via get-browser-state
  → Injects element list into prompt context
  → Sends to AI (Groq/Gemini/OpenAI) via ai-request
  → If AI sets requestScreenshot=true, captures screenshot and sends to vision LLM
  → Orchestrator returns { thought, tasks[], confidence, requestScreenshot }
  → thought shown in chat; tasks appear in HITL queue
  → User clicks Approve → approveTask()
    → BEFORE: capture browser snapshot (URL, title, elements)
    → EXECUTE: dom-action IPC
    → WAIT: page stability detector (DOM mutations stop for 500ms)
    → AFTER: re-capture browser snapshot
    → VALIDATE: compare before/after (URL change, element delta, target disappearance)
    → If validation=success: show green confirmation + log
    → If validation=retry: exponential backoff (1s, 2s, 4s), up to 3 retries
    → If validation=escalate: pause, notify user, show alert
    → If confidence<50: trigger visual verification via screenshot + vision LLM
```

## Validator Module (main/validator.ts)

Heuristic-based action verification:
- **dom_click**: checks URL change, title change, element count delta, target disappeared, new elements appeared
- **dom_type**: checks target element still present, value confirmed in element
- **navigate**: checks URL contains target
- **CAPTCHA detection**: scans element text for captcha/recaptcha/cloudflare indicators
- **Sensitive action detection**: flags password fields, payment forms, delete buttons

## Vision Module (main/vision.ts)

Screenshot-based visual intelligence:
- Captures webview screenshot via `capturePage()` → base64 PNG
- Sends to GPT-4o (vision) or Gemini with structured prompt
- Returns: page description, action success assessment, interactive elements list, CAPTCHA detection, error visibility
- Used for: low-confidence verification fallback, screenshot-on-demand by AI

## Development

```bash
npm install
npm run dev              # Vite web preview on port 5000
npm run electron:dev     # Full Electron desktop (requires local electron install)
```

## Build

```bash
npm run build            # Builds React/Vite to dist/ (static deployment)
npm run electron:build   # Full Electron desktop build
```

## Deployment

Configured as a **static** deployment — `npm run build` outputs to `dist/`.

## Replit Setup Notes

- Vite config: `host: '0.0.0.0'`, `port: 5000`, `allowedHosts: true`
- Electron plugin removed from vite.config.ts (would crash without Electron)
- `<webview>` rendered conditionally (Electron only); falls back to `<iframe>` in browser
- Settings persist to localStorage in web mode
- Proxy middleware: `/__proxy?url=encoded_url` strips frame-blocking headers, injects bridge script
