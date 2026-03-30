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
- `src/types/mission.ts` — Mission, MissionTask, Skill types + factory functions
- `src/data/skills.ts` — 5 default skills (Reddit, LinkedIn, Google Research, Template)
- `src/data/missions.ts` — 3 mission templates (Reddit, LinkedIn, Competitive Research)
- `src/components/MissionEditor.tsx` — Mission CRUD panel with task editor
- `src/components/SkillsLibrary.tsx` — Skills browsing/editing panel
- `src/hooks/useMissionRunner.ts` — Mission execution engine with abort safety

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
| `show-notification` | renderer→main | Fires Electron desktop notification (clicks bring Yogi to foreground) |
| `get-missions` / `save-missions` | renderer→main | CRUD for mission workflows (electron-store) |
| `get-skills` / `save-skills` | renderer→main | CRUD for skills library (electron-store) |
| `inject-skills` | renderer→main | Injects active skill content into orchestrator system prompt |

## Automation Flow (with Verify Loop + Auto-Pilot)

```
User types command
  → handleSend() fetches browser map via get-browser-state
  → Injects element list into prompt context
  → Sends to AI (Groq/Gemini/OpenAI) via ai-request
  → If AI sets requestScreenshot=true, captures screenshot and sends to vision LLM
  → Orchestrator returns { thought, tasks[], confidence, requestScreenshot }
  → thought shown in chat; tasks appear in HITL queue

  Manual mode (Auto-Pilot OFF):
  → User clicks Approve → approveTask()

  Auto-Pilot mode (Auto-Pilot ON):
  → autoExecuteLoop processes tasks sequentially with configurable delay
  → Safety rails check: password/payment/delete → always requires manual approval
  → Confidence threshold: tasks below threshold → manual review
  → Each task runs through verify-after-action loop:
    → BEFORE: capture browser snapshot (URL, title, elements)
    → EXECUTE: dom-action IPC
    → WAIT: page stability detector (DOM mutations + network idle)
    → AFTER: re-capture browser snapshot
    → VALIDATE: compare before/after (heuristic + LLM fallback for ambiguous cases)
    → If validation=success: log + proceed to next task
    → If validation=retry: exponential backoff (1s, 2s, 4s), alternative selectors, up to 3 retries
    → If validation=escalate: pause loop, show escalation banner, fire notification, play chime
    → If confidence<50: trigger visual verification via screenshot + vision LLM

  Escalation:
  → Escalation banner with "Agent needs your help" message
  → Desktop notification (Electron Notification API / browser Notification API fallback)
  → Sound alert via Web Audio API (gentle chime)
  → User can Resume after manual intervention
  → User can toggle Auto-Pilot OFF to take over manually at any time
```

## Auto-Pilot System

- **Toggle**: Rocket icon button in sidebar header, shows ON/OFF state
- **Pulsing indicator**: Shows when auto-pilot is active with "Yogi is working autonomously..."
- **Execution log**: Expandable timeline panel showing all auto-executed actions with status icons (success/retry/escalate/skipped), timestamps, elapsed time
- **Confidence threshold**: Settings slider (0-100%, default 70%) — tasks below threshold pause for manual review
- **Step delay**: Settings slider (0.5s-10s, default 2s) — configurable pause between auto-executed steps
- **Safety rails**: Always-confirm patterns for password fields, payment forms, delete/remove buttons
- **Take-over flow**: Toggle OFF pauses after current action; remaining tasks become manual approval cards; toggle ON resumes

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

## Mission Workflow Engine (Task #5)

Multi-step mission execution with loops, conditionals, and structured task dependencies.

### Key Files

- `src/types/mission.ts` — TypeScript types for Mission, MissionTask, Skill, and factory functions
- `src/data/skills.ts` — 5 built-in skills (Reddit posting, Reddit reply, LinkedIn outreach, Google research, custom template)
- `src/data/missions.ts` — 3 mission templates (Reddit outreach, LinkedIn campaign, competitive research)
- `src/components/MissionEditor.tsx` — Full CRUD panel for creating/editing/running missions with task reordering
- `src/components/SkillsLibrary.tsx` — Skills browsing/editing panel with URL-based activation indicators
- `src/hooks/useMissionRunner.ts` — Async mission engine with abort/pause/resume, loop interrupt safety, dependency-aware task scheduling

### Mission Task Types

- **action**: Standard browser automation task (navigate, click, type)
- **loop**: Repeats over a list (hardcoded items, CSS selector on page, or previous task output with task picker)
- **conditional**: Branches based on URL patterns, element existence, or previous task status; supports thenTaskId/elseTaskId branch targets (configurable in editor)

### Task Output Capture

Every mission task captures the AI response as structured output, stored in both in-memory `taskResultsRef` and persisted `mission.taskOutputs`. This enables:
- `previous_task` loop source: reads output from a selected prior task (JSON arrays or newline-split text)
- Output survives mission pause/resume via persistence
- `getLastAIResponse()` callback provides the most recent AI response to the runner

### Per-Mission Knowledge Base

Each mission has a `knowledgeBase` text field (editable in the Mission Editor) that is injected into the AI system prompt as `MISSION KNOWLEDGE BASE` whenever that mission is active. This allows users to provide mission-specific context (product info, personas, templates, guidelines) without creating separate skills.

### Skills System

Skills are context documents injected into the AI system prompt when their activation triggers match:
- **url_pattern**: Activates when the browser URL contains the pattern (e.g., "reddit.com")
- **mission_type**: Activates during missions of a matching type
- **manual**: Only activated explicitly (via Activate/Deactivate button in Skills Library)

Skills are sorted by priority (higher = loaded first), token-budgeted (8000 char max), and injected via `orchestrator.setActiveSkills()`.

### Sidebar Panel Navigation

Four panel tabs in the sidebar header: Chat (default), Missions (Target icon), Skills (Book icon), Activity (Activity icon). The active mission shows a control banner with Pause/Resume/Stop.

### Persistence

- Electron: electron-store via IPC (`get-missions`, `save-missions`, `get-skills`, `save-skills`)
- Web mode: localStorage (`yogi_missions`, `yogi_skills`)
- Default skills auto-loaded on first run if no saved skills exist

## Activity Logger (Task #12)

Persistent activity log that records every Reddit post and comment the agent makes.

### Key Files

- `src/components/ActivityReport.tsx` — Activity panel UI (entry list grouped by subreddit, Generate Report button, copy/export)
- `src/hooks/useMissionRunner.ts` — Detects Reddit post/comment URLs after each successful task; calls `appendActivityLog` callback
- `main/index.ts` — IPC handlers: `get-activity-log`, `append-activity-log`, `clear-activity-log` (persisted to `~/.yogibrowser/activity-log.json`)
- `preload/index.ts` — Bridge methods: `getActivityLog`, `appendActivityLog`, `clearActivityLog`

### Activity Entry Schema

```ts
{
  id: string          // unique ID
  type: 'post' | 'comment' | 'reply'
  subreddit: string   // extracted from reddit.com/r/{subreddit}/comments/...
  url: string         // direct link to post/comment
  title?: string      // post title if available
  contentPreview: string  // first 100 chars of task description
  timestamp: number   // ms epoch
  sessionId: string   // unique per app session
}
```

### Detection Logic

After each mission task completes successfully, the runner checks the current browser URL against the pattern `reddit.com/r/{subreddit}/comments/{postId}/{...}`. If a match is found and it hasn't been logged already (deduped by URL), a new `ActivityEntry` is appended. The type is inferred: `post` if the URL has no comment segment, `comment` if the task description mentions "comment" or "reply".

### Activity Panel Features

- Entries grouped by subreddit with collapsible sections
- Per-entry: type badge (post/comment), timestamp, content preview, external link button
- Summary bar: total posts, comments, subreddits
- "Generate Report" expands a formatted text block (standup-style summary)
- "Copy to clipboard" and "Export as .txt" buttons
- "Clear log" button (with danger styling)
- Persists across app restarts: Electron uses JSON file; web mode uses localStorage
- Activity tab badge shows live count of logged entries

## Onboarding (First-Run)

`src/components/OnboardingScreen.tsx` — shown when `isElectron && no API keys saved`.
- Step 1: Welcome screen with feature list
- Step 2: Provider picker (Groq / OpenAI / Gemini) + API key input
- Calls `yogi.saveSettings()` on completion, then dismisses
- "Skip for now" closes without saving (user can configure via Settings later)

## Electron Packaging

Build pipeline: `scripts/build-electron.mjs` (esbuild) → `vite build` → `electron-builder`

```bash
npm run build:electron-main  # Compile main/index.ts → dist-electron/main/index.js (15MB bundle)
npm run electron:build:mac   # macOS .dmg (must run on macOS)
npm run electron:build:win   # Windows .exe installer (NSIS, can cross-compile)
npm run electron:build:linux # Linux .AppImage
npm run electron:build       # All platforms
```

- `scripts/build-electron.mjs` — esbuild bundles `main/index.ts` + `preload/index.ts` with ALL Node deps bundled (only `electron` externalized). Output: `dist-electron/main/index.js` (~15MB), `dist-electron/preload/index.js` (~2.5KB)
- `electron-builder.yml` — cross-platform targets: Mac dmg (x64+arm64), Win nsis (x64), Linux AppImage (x64). Uses local `node_modules/electron/dist` to avoid re-downloading.
- Linux AppImage verified buildable at `build/YogiBrowser-Linux-1.0.0.AppImage` (~130MB)

## Development

```bash
npm install
npm run dev              # Vite web preview on port 5000
npm run electron:dev     # Full Electron desktop (requires local electron install)
```

## Replit Setup Notes

- Vite config: `host: '0.0.0.0'`, `port: 5000`, `allowedHosts: true`
- Electron plugin removed from vite.config.ts (would crash without Electron)
- `<webview>` rendered conditionally (Electron only); falls back to `<iframe>` in browser
- Settings persist to localStorage in web mode
- Proxy middleware: `/__proxy?url=encoded_url` strips frame-blocking headers, injects bridge script
