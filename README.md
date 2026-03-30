# Yogi Browser — Open Humana Sales Machine

Yogi Browser is a secure, cross-platform Electron desktop application designed for Human-in-the-Loop (HITL) outbound sales automation.

## 🚀 Key Features

- **Sandboxed Execution**: AI-generated terminal scripts (Python/Node) are restricted to `~/.yogibrowser/workspace/`.
- **Multi-Model Orchestration**: Built-in support for Gemini, Groq, and OpenRouter with automatic provider rotation.
- **HITL Sales Cycle**: The agent follows a strict **Think → Suggest → Queue** protocol. Action is only taken after you approve the specifically cited Open Humana sales fact.
- **Dedicated Workflows**:
    - **A: Hiring Intent**: Pivot job board leads to AI digital employees.
    - **B: LinkedIn Broken Math**: Target dial volume pain points.
    - **C: Tech Stack Backdoor**: Replace legacy dialers with personalized AI voicemails.
    - **D: Local Web-Form**: Infiltrate local service business forms with live-transfer pitches.

## 🛠️ Setup & Installation

1. **Install Node.js**: Ensure you have Node.js (v18+) installed on your machine.
2. **Clone/Move to Project**:
   ```bash
   cd yogi-browser
   ```
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Configure Keys**:
   - Run the app using `npm run dev`.
   - Open the **Settings** menu and input your API keys (Google Gemini, Groq, etc.).
   - Upload your specific sales pitches to the **Master Knowledge Base**.

## 📦 Build Instructions

### Prerequisites
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **npm install** — run once after cloning

### Build desktop installers

```bash
# Install dependencies (first time only)
npm install

# macOS → build/YogiBrowser-Mac-1.0.0.dmg
npm run electron:build:mac

# Windows → build/YogiBrowser-Win-Setup-1.0.0.exe
npm run electron:build:win

# Linux → build/YogiBrowser-Linux-1.0.0.AppImage
npm run electron:build:linux

# All platforms at once
npm run electron:build
```

> **Note for macOS builds:** Must be run on macOS. Use an Apple Silicon Mac for arm64 support.
> **Note for Windows builds:** Can be cross-compiled from Linux/macOS.

### How the build works

1. `node scripts/build-electron.mjs` — esbuild compiles `main/index.ts` + `preload/index.ts` → `dist-electron/`, bundling all Node.js dependencies (LangChain, electron-store, etc.) into a single file.
2. `vite build` — bundles the React renderer → `dist/`
3. `electron-builder` — packages everything into a native installer using `electron-builder.yml`

### First run
On first launch, Yogi Browser shows an **onboarding screen** to enter your AI API key:
- **Groq** (free, recommended) — get a key at [console.groq.com/keys](https://console.groq.com/keys)
- **OpenAI** — get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Google Gemini** — get a key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

Keys are stored locally at `~/.yogibrowser/` via electron-store. They are never sent to OpenHumana servers.

## 🛡️ Security
Yogi Browser employs a strict isolation policy. It will never execute a command containing forbidden keywords (e.g., `rm -rf`, `sudo`, `del /s`) and restricts its file-system reach to prevent accidental data loss.
