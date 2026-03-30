import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGroq } from '@langchain/groq'
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import Store from 'electron-store'

// ──────────────────────────────────────────────────────────
// Provider Interface + GeminiProvider
// ──────────────────────────────────────────────────────────

interface ModelProvider {
  displayName: string
  complete(messages: BaseMessage[], useFlash?: boolean): Promise<string>
}

/**
 * GeminiProvider wraps both Gemini 1.5 Pro and 1.5 Flash.
 * Pro (temp=0.3) is used for creative content tasks.
 * Flash (temp=0.1) is used for DOM execution and validation (speed).
 */
class GeminiProvider implements ModelProvider {
  private pro: ChatGoogleGenerativeAI
  private flash: ChatGoogleGenerativeAI

  constructor(apiKey: string) {
    this.pro = new ChatGoogleGenerativeAI({
      modelName: 'gemini-1.5-pro',
      apiKey,
      temperature: 0.3,
    })
    this.flash = new ChatGoogleGenerativeAI({
      modelName: 'gemini-1.5-flash',
      apiKey,
      temperature: 0.1,
    })
  }

  get displayName() { return 'Gemini 1.5 Pro' }

  async complete(messages: BaseMessage[], useFlash = false): Promise<string> {
    const model = useFlash ? this.flash : this.pro
    const response = await model.invoke(messages)
    return response.content as string
  }

  async validate(): Promise<boolean> {
    try {
      const response = await Promise.race([
        this.flash.invoke([new HumanMessage('Say "ok" only.')]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]) as any
      return !!(response?.content)
    } catch {
      return false
    }
  }
}

// ──────────────────────────────────────────────────────────
// Content task detection keywords
// ──────────────────────────────────────────────────────────

const CONTENT_KEYWORDS = [
  'write', 'create', 'draft', 'post', 'plan', 'analyze', 'generate', 'reply',
  'comment', 'suggest', 'think', 'help me', 'what should', 'how should',
  'reddit', 'content', 'message', 'email', 'script', 'summarize', 'explain',
  'research', 'find', 'search for', 'look for', 'compare', 'engage',
  'respond', 'outreach', 'pitch', 'promote', 'brand', 'audience',
]

// ──────────────────────────────────────────────────────────
// Provider stats (quota tracking)
// ──────────────────────────────────────────────────────────

interface ProviderStats {
  requests: number
  estimatedTokens: number
  lastUsed: string | null
}

// ──────────────────────────────────────────────────────────
// Key pool for fallback across multiple keys
// ──────────────────────────────────────────────────────────

interface KeyInstance {
  id: string
  key: string
  provider?: GeminiProvider
  rawInstance?: any
  status: 'active' | 'quota_hit' | 'invalid'
  usageCount: number
}

interface ProviderPool {
  name: string
  instances: KeyInstance[]
  currentIndex: number
}

// ──────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────

class ModelOrchestrator {
  public store = new Store()
  private pools: Record<string, ProviderPool> = {}
  private history: BaseMessage[] = []
  private activeSkillsContent = ''

  private stats: Record<string, ProviderStats> = {
    groq:   { requests: 0, estimatedTokens: 0, lastUsed: null },
    google: { requests: 0, estimatedTokens: 0, lastUsed: null },
    openai: { requests: 0, estimatedTokens: 0, lastUsed: null },
  }

  constructor() {
    this.initProviders()
  }

  public initProviders() {
    console.log('[Vault] Re-initializing all provider pools...')
    this.initGroqPool()
    this.initGooglePool()
    this.initOpenAIPool()
  }

  private parseKeys(storeKey: string): string[] {
    const raw = this.store.get(storeKey) as string || ''
    return raw.split(/[\n,]/).map(k => k.trim()).filter(k => k.length > 5)
  }

  private initGroqPool() {
    const keys = this.parseKeys('GROQ_KEYS')
    console.log(`[Vault] GROQ Pool: ${keys.length} key(s).`)
    this.pools['groq'] = {
      name: 'groq',
      currentIndex: 0,
      instances: keys.map((key, i) => ({
        id: `groq-${i}`,
        key,
        status: 'active',
        usageCount: 0,
      })),
    }
  }

  private initGooglePool() {
    const keys = this.parseKeys('GOOGLE_KEYS')
    console.log(`[Vault] GOOGLE Pool: ${keys.length} key(s).`)
    this.pools['google'] = {
      name: 'google',
      currentIndex: 0,
      instances: keys.map((key, i) => ({
        id: `google-${i}`,
        key,
        provider: new GeminiProvider(key),
        status: 'active',
        usageCount: 0,
      })),
    }
  }

  private initOpenAIPool() {
    const keys = this.parseKeys('OPENAI_KEYS')
    console.log(`[Vault] OPENAI Pool: ${keys.length} key(s).`)
    this.pools['openai'] = {
      name: 'openai',
      currentIndex: 0,
      instances: keys.map((key, i) => ({
        id: `openai-${i}`,
        key,
        status: 'active',
        usageCount: 0,
      })),
    }
  }

  // ────────────────────────────────────────────────────────
  // Intent extraction: separate user's actual request from
  // browser context (which contains many selector= lines)
  // ────────────────────────────────────────────────────────

  private extractUserIntent(prompt: string): string {
    // Prompts built by the app include delimiters like:
    //   "USER REQUEST:\n..." or "MISSION TASK:\n..."
    const markers = ['USER REQUEST:', 'MISSION TASK:', 'MISSION STEP:']
    for (const marker of markers) {
      const idx = prompt.indexOf(marker)
      if (idx !== -1) {
        return prompt.slice(idx + marker.length).trim()
      }
    }
    // If no delimiter, and prompt is long (includes browser context),
    // take the last 300 chars which is more likely the user intent
    if (prompt.length > 600) return prompt.slice(-300)
    return prompt
  }

  private isContentTask(prompt: string): boolean {
    const intent = this.extractUserIntent(prompt).toLowerCase()
    return CONTENT_KEYWORDS.some(kw => intent.includes(kw))
  }

  private getPoolOrder(prompt: string): string[] {
    const strategy = (this.store.get('MODEL_STRATEGY') as string) || 'quality'
    if (strategy === 'speed') {
      // Speed mode: Groq only — no paid provider fallback
      return ['groq']
    }
    // Quality mode: Gemini Pro for content tasks, Groq for DOM execution
    if (this.isContentTask(prompt)) {
      return ['google', 'groq', 'openai']
    }
    return ['groq', 'google', 'openai']
  }

  private isFlashTask(poolName: string, prompt: string): boolean {
    const strategy = (this.store.get('MODEL_STRATEGY') as string) || 'quality'
    // Use Flash when: speed mode, or pool is not the primary choice (fallback)
    if (strategy === 'speed') return true
    if (poolName === 'google' && !this.isContentTask(prompt)) return true
    return false
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  private recordUsage(poolName: string, inputText: string, outputText: string) {
    const s = this.stats[poolName]
    if (!s) return
    s.requests++
    s.estimatedTokens += this.estimateTokens(inputText) + this.estimateTokens(outputText)
    s.lastUsed = new Date().toISOString()
  }

  // ────────────────────────────────────────────────────────
  // Main process() entry point
  // ────────────────────────────────────────────────────────

  public async process(
    prompt: string,
    tier: 'high' | 'low' = 'high',
    workflow?: string,
    keys?: any,
    onLog?: (msg: string) => void,
  ): Promise<any> {
    console.log(`\n[IPC] Received: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`)
    const poolNames = this.getPoolOrder(prompt)
    let lastError = null

    if (onLog) onLog('🔍 Analyzing request...')

    for (const poolName of poolNames) {
      const pool = this.pools[poolName]
      if (!pool || pool.instances.length === 0) continue

      for (let attempt = 0; attempt < pool.instances.length; attempt++) {
        const instance = pool.instances[pool.currentIndex]

        if (instance.status !== 'active') {
          pool.currentIndex = (pool.currentIndex + 1) % pool.instances.length
          continue
        }

        if (poolName !== poolNames[0] && lastError && onLog) {
          onLog(`🔄 Fallback → ${poolName.toUpperCase()}`)
        }

        const useFlash = this.isFlashTask(poolName, prompt)
        const displayName = this.resolveDisplayName(poolName, useFlash)
        if (onLog) onLog(`🧠 Using ${displayName}...`)

        try {
          if (onLog) onLog('✨ Generating...')
          const response = await this.invokeInstance(instance, poolName, prompt, workflow, useFlash, onLog)
          instance.usageCount++
          this.recordUsage(poolName, prompt, response.text || '')
          return { ...response, model: displayName }
        } catch (error: any) {
          console.error(`[Vault] Key ${instance.id} failed:`, error.message)
          if (onLog) onLog(`❌ ${poolName} failed: ${error.message}`)

          if (error.message?.includes('429') || error.message?.includes('quota')) {
            instance.status = 'quota_hit'
          } else if (error.message?.includes('400') || error.message?.includes('invalid') || error.message?.includes('API key')) {
            instance.status = 'invalid'
          }

          pool.currentIndex = (pool.currentIndex + 1) % pool.instances.length
          lastError = error
        }
      }
    }

    return {
      text: lastError
        ? `⚠️ Error: ${lastError.message}`
        : '⚠️ No AI providers available. Please add API keys in Settings.',
      tasks: null,
      model: '',
    }
  }

  private resolveDisplayName(poolName: string, useFlash: boolean): string {
    if (poolName === 'google') return useFlash ? 'Gemini 1.5 Flash' : 'Gemini 1.5 Pro'
    if (poolName === 'groq') return 'Groq Llama 3.3'
    if (poolName === 'openai') return 'GPT-4o'
    return poolName
  }

  private async invokeInstance(
    instance: KeyInstance,
    poolName: string,
    prompt: string,
    workflow: string | undefined,
    useFlash: boolean,
    onLog?: (msg: string) => void,
  ) {
    const lessons = this.store.get('LESSONS_LEARNED') as string[] || []
    const learningCtx = lessons.length > 0
      ? `\n🧠 RECENT SUCCESSFUL PATTERNS:\n${lessons.slice(-5).join('\n')}`
      : ''
    const systemPrompt = this.getSystemPrompt(workflow) + learningCtx
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...this.history.slice(-6),
      new HumanMessage(prompt),
    ]

    const timeoutMs = poolName === 'groq' ? 12000 : 30000
    const label = poolName === 'groq' ? '🚀 GROQ: Fast-tracking...' : '📡 Sending to AI...'
    if (onLog) onLog(label)

    let rawText: string

    if (poolName === 'google' && instance.provider) {
      rawText = await Promise.race([
        instance.provider.complete(messages, useFlash),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ])
    } else {
      let model: any
      if (poolName === 'groq') {
        model = new ChatGroq({ apiKey: instance.key, model: 'llama-3.3-70b-versatile', temperature: 0.1 })
      } else {
        model = new ChatOpenAI({ openAIApiKey: instance.key, modelName: 'gpt-4o', temperature: 0.1 })
      }
      const response = await Promise.race([
        model.invoke(messages),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]) as any
      rawText = response.content as string
    }

    if (onLog) onLog('📦 Done!')

    const tasks = this.extractTasks(rawText)
    const uiMessage = this.extractThought(rawText)
    const requestScreenshot = this.extractScreenshotRequest(rawText)
    const confidence = this.extractConfidence(rawText)

    this.history.push(new HumanMessage(prompt))
    this.history.push(new AIMessage(rawText))

    if (tasks?.length) {
      const updated = [...lessons, `- Worked: "${prompt.slice(0, 30)}..." -> ${tasks.length} actions`].slice(-20)
      this.store.set('LESSONS_LEARNED', updated)
    }

    return { text: uiMessage, tasks, requestScreenshot, confidence }
  }

  // ────────────────────────────────────────────────────────
  // Response parsers
  // ────────────────────────────────────────────────────────

  private extractThought(text: string): string {
    try {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        const parsed = JSON.parse(match[1].trim())
        if (parsed.thought) return parsed.thought
      }
    } catch {}
    const before = text.split('```json')[0].trim()
    return before || text.trim() || 'Processing...'
  }

  private extractTasks(text: string): any[] | null {
    try {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        const parsed = JSON.parse(match[1].trim())
        return Array.isArray(parsed.tasks) && parsed.tasks.length > 0 ? parsed.tasks : null
      }
    } catch (e) {
      console.error('[Orchestrator] extractTasks:', e)
    }
    return null
  }

  private extractScreenshotRequest(text: string): boolean {
    try {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        const parsed = JSON.parse(match[1].trim())
        return !!(parsed.requestScreenshot || parsed.screenshot)
      }
    } catch {}
    return false
  }

  private extractConfidence(text: string): number {
    try {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        const parsed = JSON.parse(match[1].trim())
        return typeof parsed.confidence === 'number' ? parsed.confidence : 75
      }
    } catch {}
    return 75
  }

  // ────────────────────────────────────────────────────────
  // Active skills
  // ────────────────────────────────────────────────────────

  public setActiveSkills(content: string) {
    this.activeSkillsContent = content
  }

  private getSystemPrompt(workflow?: string): string {
    const masterKB = this.store.get('MASTER_KB') as string || ''
    const skillsBlock = this.activeSkillsContent
      ? `\n\nACTIVE SKILLS:\n${this.activeSkillsContent}`
      : ''

    return `You are Yogi, an Actionable Sales Automation Agent for Open Humana.
Your goal is to act like "Replit Agent": the user gives an English command, and you translate it into browser DOM actions.

WORKFLOW: ${workflow || 'General'}
KNOWLEDGE BASE: ${masterKB || '(none yet — upload a PDF in Settings)'}
${skillsBlock}
OPERATING PROTOCOL:
1. The user's message will include a BROWSER CONTEXT block listing interactive elements and their CSS selectors.
2. Use those selectors to build precise dom_click or dom_type tasks.
3. ALWAYS respond with EXACTLY ONE \`\`\`json code block — no other text outside it.
4. The "thought" field is the ONLY thing shown to the user — keep it friendly and concise (one sentence).
5. Never include raw JSON outside the code fence.
6. Each task MUST include a "confidence" field (0-100).
7. If BROWSER CONTEXT shows 0 elements, set "requestScreenshot": true.

VERIFY-AFTER-ACTION SYSTEM:
After each action, the system automatically waits for page stabilization, re-scans, validates success, and retries up to 3 times. You do NOT need to add verification steps.

AVAILABLE ACTIONS:
- dom_click: { "selector": "CSS_SELECTOR" }
- dom_type: { "selector": "CSS_SELECTOR", "value": "text" }
- navigate: { "url": "https://..." }
- execute: { "command": "cmd" }

STRICT RESPONSE FORMAT:
\`\`\`json
{
  "thought": "One friendly sentence.",
  "confidence": 85,
  "requestScreenshot": false,
  "tasks": [
    { "id": "t1", "action": "dom_click", "description": "label", "confidence": 90, "payload": { "selector": "#btn" } }
  ]
}
\`\`\``
  }

  // ────────────────────────────────────────────────────────
  // Validation (used for HITL verify-after-action)
  // ────────────────────────────────────────────────────────

  public async validateWithLLM(
    action: any,
    before: any,
    after: any,
  ): Promise<{ status: 'success' | 'retry' | 'escalate'; reason: string; confidence: number } | null> {
    const prompt = `Validate whether this browser automation action succeeded.

ACTION: ${action.action} on "${action.selector}"${action.value ? ` value="${action.value}"` : ''}
DESCRIPTION: ${action.description || 'N/A'}
BEFORE: URL=${before.url}, Title=${before.title}, Elements=${before.elements?.length || 0}
AFTER:  URL=${after.url}, Title=${after.title}, Elements=${after.elements?.length || 0}
URL changed: ${before.url !== after.url}
Title changed: ${before.title !== after.title}
Element delta: ${(after.elements?.length || 0) - (before.elements?.length || 0)}

Respond ONLY with valid JSON (no markdown):
{"status": "success"|"retry"|"escalate", "reason": "brief", "confidence": 0-100}`

    for (const poolName of ['groq', 'google', 'openai']) {
      const pool = this.pools[poolName]
      if (!pool) continue
      const instance = pool.instances.find(i => i.status === 'active')
      if (!instance) continue

      try {
        let rawText: string

        if (poolName === 'google' && instance.provider) {
          rawText = await Promise.race([
            instance.provider.complete([new HumanMessage(prompt)], true), // use Flash for validation
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ])
        } else {
          let model: any
          if (poolName === 'groq') {
            model = new ChatGroq({ apiKey: instance.key, model: 'llama-3.3-70b-versatile', temperature: 0.1 })
          } else {
            model = new ChatOpenAI({ openAIApiKey: instance.key, modelName: 'gpt-4o', temperature: 0.1 })
          }
          const res = await Promise.race([
            model.invoke([new HumanMessage(prompt)]),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ]) as any
          rawText = typeof res.content === 'string' ? res.content : String(res.content)
        }

        const m = rawText.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          if (['success', 'retry', 'escalate'].includes(parsed.status)) {
            return {
              status: parsed.status,
              reason: `[LLM] ${parsed.reason || 'Validated'}`,
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 70,
            }
          }
        }
      } catch (e: any) {
        console.error(`[Validator] ${poolName} failed:`, e.message)
      }
    }
    return null
  }

  // ────────────────────────────────────────────────────────
  // Gemini key validation (used by Settings "Test" button)
  // ────────────────────────────────────────────────────────

  public async testGeminiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const provider = new GeminiProvider(apiKey)
      const ok = await provider.validate()
      return ok ? { ok: true } : { ok: false, error: 'No response from Gemini' }
    } catch (e: any) {
      return { ok: false, error: e.message || 'Unknown error' }
    }
  }

  // ────────────────────────────────────────────────────────
  // Quota / stats reporting
  // ────────────────────────────────────────────────────────

  public getQuotas() {
    const result: Record<string, any> = {}
    Object.keys(this.pools).forEach(poolName => {
      const pool = this.pools[poolName]
      const s = this.stats[poolName] || { requests: 0, estimatedTokens: 0, lastUsed: null }
      result[poolName] = {
        keys: pool.instances.map(i => ({ id: i.id, status: i.status, usage: i.usageCount })),
        totalRequests: s.requests,
        estimatedTokens: s.estimatedTokens,
        lastUsed: s.lastUsed,
      }
    })
    return result
  }
}

export const orchestrator = new ModelOrchestrator()
