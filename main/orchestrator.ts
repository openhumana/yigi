import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGroq } from '@langchain/groq'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import Store from 'electron-store'

interface KeyInstance {
  id: string
  key: string
  instance: any
  status: 'active' | 'quota_hit' | 'invalid'
  usageCount: number
}

interface ProviderPool {
  name: string
  instances: KeyInstance[]
  currentIndex: number
}

class ModelOrchestrator {
  public store = new Store()
  private pools: Record<string, ProviderPool> = {}
  private history: BaseMessage[] = []

  constructor() {
    this.initProviders()
  }

  public initProviders() {
    console.log('[Vault] Re-initializing all provider pools...')

    this.initPool('groq', 'GROQ_KEYS', (key) => new ChatGroq({
      model: 'llama-3.3-70b-versatile',
      apiKey: key,
      temperature: 0.1,
    }))

    this.initPool('google', 'GOOGLE_KEYS', (key) => new ChatGoogleGenerativeAI({
      modelName: 'gemini-1.5-flash',
      apiKey: key,
      temperature: 0.1,
    }))

    this.initPool('openai', 'OPENAI_KEYS', (key) => new ChatOpenAI({
      modelName: 'gpt-4o',
      openAIApiKey: key,
      temperature: 0.1,
    }))
  }

  private initPool(name: string, storeKey: string, factory: (key: string) => any) {
    const rawKeys = this.store.get(storeKey) as string || ''
    const keys = rawKeys.split(/[\n,]/).map(k => k.trim()).filter(k => k.length > 5)

    console.log(`[Vault] ${name.toUpperCase()} Pool: ${keys.length} keys active.`)

    this.pools[name] = {
      name,
      currentIndex: 0,
      instances: keys.map((key, i) => ({
        id: `${name}-${i}`,
        key,
        instance: factory(key),
        status: 'active',
        usageCount: 0
      }))
    }
  }

  public async process(prompt: string, tier: 'high' | 'low' = 'high', workflow?: string, keys?: any, onLog?: (msg: string) => void): Promise<any> {
    console.log(`\n[IPC] IPC Received Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`)

    const poolNames = ['groq', 'google', 'openai']
    let lastError = null

    if (onLog) onLog('🔍 Analyzing request...')

    for (const poolName of poolNames) {
      const pool = this.pools[poolName]
      if (!pool || pool.instances.length === 0) continue

      for (let i = 0; i < pool.instances.length; i++) {
        const instance = pool.instances[pool.currentIndex]

        if (instance.status !== 'active') {
          pool.currentIndex = (pool.currentIndex + 1) % pool.instances.length
          continue
        }

        if (poolName !== 'groq' && lastError && onLog) {
          onLog(`🔄 Fallback Triggered: Moving to ${poolName.toUpperCase()}...`)
        }

        if (onLog) onLog(`🧠 Using Vault: ${poolName} (Key ${pool.currentIndex})`)
        try {
          if (onLog) onLog('✨ Generating plan...')
          const response = await this.invokeInstance(instance, poolName, prompt, workflow, onLog)
          instance.usageCount++
          return response
        } catch (error: any) {
          console.error(`[Vault Error] Key ${instance.id} failed:`, error.message)
          if (onLog) onLog(`❌ Signal Failed: ${error.message}`)

          if (error.message.includes('429') || error.message.includes('quota') || error.message.includes('400')) {
            instance.status = 'quota_hit'
          } else {
            instance.status = 'invalid'
          }

          pool.currentIndex = (pool.currentIndex + 1) % pool.instances.length
          lastError = error
        }
      }
    }

    return {
      text: lastError ? `⚠️ Error: ${lastError.message}` : '⚠️ No AI providers available. Please add API keys in Settings.',
      tasks: null
    }
  }

  private async invokeInstance(instance: KeyInstance, poolName: string, prompt: string, workflow?: string, onLog?: (msg: string) => void) {
    let model: any
    const modelConfig = { apiKey: instance.key, temperature: 0.1 }

    if (poolName === 'groq') {
      model = new ChatGroq({ ...modelConfig, model: 'llama-3.3-70b-versatile' })
    } else if (poolName === 'google') {
      model = new ChatGoogleGenerativeAI({ apiKey: instance.key, modelName: 'gemini-1.5-flash', temperature: 0.1 })
    } else {
      model = new ChatOpenAI({ openAIApiKey: instance.key, modelName: 'gpt-4o', temperature: 0.1 })
    }

    const lessons = this.store.get('LESSONS_LEARNED') as string[] || []
    const learningContext = lessons.length > 0 ? `\n🧠 RECENT SUCCESSFUL PATTERNS:\n${lessons.slice(-5).join('\n')}` : ''

    const messages = [
      new SystemMessage(this.getSystemPrompt(workflow) + learningContext),
      ...this.history.slice(-6),
      new HumanMessage(prompt),
    ]

    try {
      const isGroq = poolName === 'groq'
      if (onLog) onLog(isGroq ? '🚀 GROQ SIGNAL: Fast-tracking...' : '📡 AI SIGNAL: Sending...')

      const timeoutMs = isGroq ? 12000 : 25000
      const responsePromise = model.invoke(messages)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000}s`)), timeoutMs)
      )

      const response = await Promise.race([responsePromise, timeoutPromise]) as any
      const rawText = response.content as string

      // Robust extraction — handles spaces/newlines after ```json fence
      const tasks = this.extractTasks(rawText)
      const uiMessage = this.extractThought(rawText)

      if (onLog) onLog('📦 Done!')
      this.history.push(new HumanMessage(prompt))
      this.history.push(response)

      if (tasks && tasks.length > 0) {
        const updatedLessons = [...lessons, `- Worked: "${prompt.slice(0, 30)}..." -> ${tasks.length} actions`].slice(-20)
        this.store.set('LESSONS_LEARNED', updatedLessons)
      }

      return {
        text: uiMessage,
        tasks: tasks,
      }
    } catch (e: any) {
      throw e
    }
  }

  /**
   * Extract the user-visible "thought" string from the model's response.
   * Only shows the thought field — never raw JSON.
   */
  private extractThought(text: string): string {
    // Match ```json (with optional spaces/newlines) ... ``` robustly
    const match = text.match(/```json\s*([\s\S]*?)```/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1].trim())
        if (parsed.thought) return parsed.thought
        // If JSON parsed but no thought, show nothing sensitive
        return 'Processing your request...'
      } catch (e) {
        // JSON parse failed — strip the raw block, show any text before it
        const before = text.split('```json')[0].trim()
        return before || 'Processing your request...'
      }
    }
    // No JSON block at all — show the full response as a chat message
    return text.trim()
  }

  /**
   * Extract the tasks array from the model's JSON response.
   * Handles ```json fences with or without trailing whitespace/newlines.
   */
  private extractTasks(text: string): any[] | null {
    try {
      const match = text.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        const parsed = JSON.parse(match[1].trim())
        return Array.isArray(parsed.tasks) && parsed.tasks.length > 0 ? parsed.tasks : null
      }
    } catch (e) {
      console.error('[Orchestrator] extractTasks parse error:', e)
    }
    return null
  }

  private getSystemPrompt(workflow?: string): string {
    const masterKB = this.store.get('MASTER_KB') as string || ''

    return `You are Yogi, an Actionable Sales Automation Agent for Open Humana.
Your goal is to act like "Replit Agent": the user gives an English command, and you translate it into browser DOM actions.

WORKFLOW: ${workflow || 'General'}
KNOWLEDGE BASE: ${masterKB || '(none yet — upload a PDF in Settings)'}

OPERATING PROTOCOL:
1. The user's message will include a BROWSER CONTEXT block listing interactive elements and their CSS selectors.
2. Use those selectors to build precise dom_click or dom_type tasks.
3. ALWAYS respond with EXACTLY ONE \`\`\`json code block — no other text outside it.
4. The "thought" field is the ONLY thing shown to the user — keep it friendly and concise (one sentence).
5. Never include raw JSON outside the code fence. Never include explanations outside the code fence.

AVAILABLE ACTIONS:
- dom_click: clicks an element  →  payload: { "selector": "CSS_SELECTOR" }
- dom_type: types into an element  →  payload: { "selector": "CSS_SELECTOR", "value": "text to type" }
- navigate: loads a URL  →  payload: { "url": "https://..." }
- execute: runs a sandboxed terminal command  →  payload: { "command": "cmd" }

STRICT RESPONSE FORMAT — output ONLY this, nothing else:
\`\`\`json
{
  "thought": "One friendly sentence describing what you are about to do.",
  "tasks": [
    {
      "id": "t1",
      "action": "dom_click",
      "description": "Short human-readable label",
      "payload": { "selector": "#submit-btn" }
    }
  ]
}
\`\`\``
  }

  public getQuotas() {
    const status: any = {}
    Object.keys(this.pools).forEach(p => {
      status[p] = this.pools[p].instances.map(i => ({ status: i.status, usage: i.usageCount }))
    })
    return status
  }
}

export const orchestrator = new ModelOrchestrator()
