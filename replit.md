# Yogi Browser

A React + Vite frontend for the Yogi Browser desktop app — an AI-powered HITL (Human-in-the-Loop) sales automation tool built by OpenHumana.

## Project Overview

Originally an Electron desktop application, adapted to run as a web app in the Replit environment. The full Electron features (native webview, IPC, terminal sandbox, Electron store) only work in the desktop build, but the UI is fully functional as a web preview.

## Architecture

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Custom CSS with dark theme (`src/styles/index.css`)
- **State**: React useState hooks + localStorage for persistence
- **AI**: LangChain integrations (Google Gemini, Groq, OpenAI) — active in desktop mode only
- **Electron (desktop only)**: Main process (`main/`), preload script (`preload/`), sandboxed terminal, electron-store for settings

## Key Files

- `src/App.tsx` — Main React component (browser-aware, gracefully stubs Electron APIs)
- `src/main.tsx` — React entry point
- `src/styles/index.css` — Full dark-themed CSS
- `vite.config.ts` — Vite config (Electron plugin removed for web, host 0.0.0.0, port 5000)
- `main/index.ts` — Electron main process (desktop only)
- `main/orchestrator.ts` — AI model orchestration
- `main/sandbox.ts` — Sandboxed terminal execution
- `main/human_interaction.ts` — Human interaction utilities
- `preload/index.ts` — Electron preload bridge

## Development

```bash
npm install
npm run dev       # Starts Vite dev server on port 5000
```

## Build

```bash
npm run build     # Builds React/Vite to dist/ (for static deployment)
npm run electron:build  # Full Electron desktop build (requires Electron environment)
```

## Deployment

Configured as a **static** deployment — `npm run build` outputs to `dist/`.

## Replit Setup Notes

- Vite config has `host: '0.0.0.0'`, `port: 5000`, and `allowedHosts: true` for Replit proxy compatibility
- Electron-specific features (`window.yogi`, `webview` tag) are guarded by `isElectron` check
- `<webview>` replaced with `<iframe>` for browser rendering
- Settings persist to localStorage in web mode
