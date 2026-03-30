import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGroq } from '@langchain/groq'
import { HumanMessage } from '@langchain/core/messages'
import Store from 'electron-store'

const store = new Store()

export interface VisionAnalysis {
  description: string
  actionSucceeded: boolean | null
  interactiveElements: string[]
  captchaDetected: boolean
  errorVisible: boolean
  errorMessage?: string
}

export async function analyzeScreenshot(
  screenshotBase64: string,
  actionDescription?: string,
  expectedOutcome?: string
): Promise<VisionAnalysis> {
  const groqKeys   = (store.get('GROQ_KEYS')   as string || '').split(/[\n,]/).map(k => k.trim()).filter(k => k.length > 5)
  const openaiKeys = (store.get('OPENAI_KEYS') as string || '').split(/[\n,]/).map(k => k.trim()).filter(k => k.length > 5)
  const googleKeys = (store.get('GOOGLE_KEYS') as string || '').split(/[\n,]/).map(k => k.trim()).filter(k => k.length > 5)

  let prompt = `Analyze this browser screenshot and respond in JSON format only.`

  if (actionDescription) {
    prompt += `\n\nThe agent just performed this action: "${actionDescription}".`
  }
  if (expectedOutcome) {
    prompt += `\nThe expected outcome was: "${expectedOutcome}".`
  }

  prompt += `\n\nRespond with ONLY this JSON (no markdown fences, no other text):
{
  "description": "Brief description of what the page shows",
  "actionSucceeded": true/false/null,
  "interactiveElements": ["list of visible interactive elements like buttons, links, inputs"],
  "captchaDetected": true/false,
  "errorVisible": true/false,
  "errorMessage": "any error text visible on page or null"
}`

  const imageContent = {
    type: 'image_url' as const,
    image_url: { url: `data:image/png;base64,${screenshotBase64}` },
  }

  const textContent = {
    type: 'text' as const,
    text: prompt,
  }

  const message = new HumanMessage({
    content: [textContent, imageContent],
  })

  if (groqKeys.length > 0) {
    try {
      const model = new ChatGroq({
        apiKey: groqKeys[0],
        model: 'llama-3.2-11b-vision-preview',
        temperature: 0.1,
        maxTokens: 600,
      })
      const response = await model.invoke([message])
      return parseVisionResponse(extractTextContent(response.content))
    } catch (e: any) {
      console.error('[Vision] Groq vision failed, trying fallback:', e.message)
    }
  }

  if (openaiKeys.length > 0) {
    try {
      const model = new ChatOpenAI({
        openAIApiKey: openaiKeys[0],
        modelName: 'gpt-4o',
        temperature: 0.1,
        maxTokens: 500,
      })
      const response = await model.invoke([message])
      return parseVisionResponse(extractTextContent(response.content))
    } catch (e: any) {
      console.error('[Vision] OpenAI failed:', e.message)
    }
  }

  if (googleKeys.length > 0) {
    try {
      const model = new ChatGoogleGenerativeAI({
        apiKey: googleKeys[0],
        modelName: 'gemini-1.5-flash',
        temperature: 0.1,
        maxOutputTokens: 500,
      })
      const response = await model.invoke([message])
      return parseVisionResponse(extractTextContent(response.content))
    } catch (e: any) {
      console.error('[Vision] Google failed:', e.message)
    }
  }

  return {
    description: 'No vision model available (add OpenAI or Google API keys)',
    actionSucceeded: null,
    interactiveElements: [],
    captchaDetected: false,
    errorVisible: false,
  }
}

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text' || typeof c === 'string')
      .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
      .join('\n')
  }
  return String(content)
}

function parseVisionResponse(raw: string): VisionAnalysis {
  try {
    let jsonStr = raw.trim()
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) jsonStr = fenceMatch[1].trim()

    const parsed = JSON.parse(jsonStr)
    return {
      description: parsed.description || 'Unknown page state',
      actionSucceeded: parsed.actionSucceeded ?? null,
      interactiveElements: Array.isArray(parsed.interactiveElements) ? parsed.interactiveElements : [],
      captchaDetected: !!parsed.captchaDetected,
      errorVisible: !!parsed.errorVisible,
      errorMessage: parsed.errorMessage || undefined,
    }
  } catch (e) {
    console.error('[Vision] Failed to parse response:', raw.slice(0, 200))
    return {
      description: raw.slice(0, 200),
      actionSucceeded: null,
      interactiveElements: [],
      captchaDetected: false,
      errorVisible: false,
    }
  }
}
