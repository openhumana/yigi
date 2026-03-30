# Yogi Browser

A React + Vite frontend for the Yogi Browser desktop app — an AI-powered HITL (Human-in-the-Loop) sales automation tool built by OpenHumana.

## Project Overview

Originally an Electron desktop application, adapted to run as a web app in the Replit environment for preview/development. The full Electron features (native webview, IPC, terminal sandbox, electron-store) only activate in the desktop build, but the UI is fully functional as a web preview.

## Architecture

- **Frontend**: React 18 + TypeScript + Vite (port 5000 for Replit preview)
- **Styling**: Custom CSS dark theme (`src/styles/index.css`)
- **State**: React useState hooks + localStorage for persistence
- **AI**: LangChain integrations (Groq → Google Gemini → OpenAI, auto-fallback) — desktop only
- **Electron (desktop only)**: Main process (`main/`), preload bridge (`preload/`), sandboxed terminal, electron-store for settings

## Key Files

- `src/App.tsx` — Main React component. Detects Electron via `window.yogi`. Uses `<webview>` in Electron, `<iframe>` in web.
- `src/main.tsx` — React entry point
- `src/styles/index.css` — Full dark-themed CSS with CRM polish
- `vite.config.ts` — Vite config (no Electron plugin, host 0.0.0.0, port 5000, allowedHosts: true)
- `main/index.ts` — Electron main process + all IPC handlers
- `main/orchestrator.ts` — AI model orchestration with multi-key pool fallback
- `main/sandbox.ts` — Sandboxed terminal execution (blacklisted destructive commands)
- `main/human_interaction.ts` — Human interaction utilities
- `preload/index.ts` — Electron contextBridge exposing `window.yogi`

## IPC Handlers (main/index.ts)

| Channel | Direction | Purpose |
|---|---|---|
| `get-browser-state` | renderer→main | Scans webview for interactive elements, returns selectors |
| `dom-action` | renderer→main | Executes `dom_click` or `dom_type` inside the webview |
| `ai-request` | renderer→main | Routes prompt through ModelOrchestrator |
| `terminal-exec` | renderer→main | Runs sandboxed shell command |
| `get-settings` / `save-settings` | renderer→main | electron-store CRUD |
| `parse-pdf` | renderer→main | Extracts text from PDF using pdf-parse |

## Automation Flow

```
User types command
  → handleSend() fetches browser map via get-browser-state
  → Injects element list into prompt context
  → Sends to AI (Groq/Gemini/OpenAI) via ai-request
  → Orchestrator returns { thought, tasks[] }
  → thought shown in chat; tasks appear in HITL queue
  → User clicks Approve → approveTask() → dom-action IPC
  → main/index.ts executes JS inside webview webContents
```

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

## Bug Fixes Applied (March 2026)

1. **Duplicate `ipcMain.handle('dom-action')` removed** — duplicate caused IPC crash, breaking get-browser-state
2. **dom-action now correctly targets webview webContents** — not win.webContents (the React app)
3. **Template literal escaping fixed** in dom-action executeJavaScript calls
4. **Selector generation hardened** in get-browser-state (priority chain: #id → [name] → [data-testid] → [aria-label] → [placeholder] → tagname)
5. **JSON extraction regex relaxed** in orchestrator (handles spaces/newlines after ```json fence)
6. **System prompt tightened** — model told to output only a single ```json block, thought field only shown to user
