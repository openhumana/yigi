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

Generate cross-platform installers using the following commands:

- **macOS (.dmg)**: `npm run electron:build -- --mac`
- **Windows (.exe)**: `npm run electron:build -- --win`

## 🛡️ Security
Yogi Browser employs a strict isolation policy. It will never execute a command containing forbidden keywords (e.g., `rm -rf`, `sudo`, `del /s`) and restricts its file-system reach to prevent accidental data loss.
