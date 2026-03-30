export interface BrowserElement {
  tag: string
  text: string
  selector: string
  ariaLabel?: string
  placeholder?: string
  type?: string
}

export interface BrowserSnapshot {
  url: string
  title: string
  elements: BrowserElement[]
}

export interface ValidationResult {
  status: 'success' | 'retry' | 'escalate'
  reason: string
  confidence: number
}

export interface ActionContext {
  action: string
  selector: string
  value?: string
  url?: string
  description?: string
  goal?: string
}

export function validateAction(
  action: ActionContext,
  before: BrowserSnapshot,
  after: BrowserSnapshot
): ValidationResult {
  const urlChanged = before.url !== after.url
  const titleChanged = before.title !== after.title
  const elementCountDelta = after.elements.length - before.elements.length

  const targetGoneBefore = before.elements.some(e => e.selector === action.selector)
  const targetGoneAfter = !after.elements.some(e => e.selector === action.selector)
  const targetDisappeared = targetGoneBefore && targetGoneAfter

  if (action.action === 'dom_click') {
    if (urlChanged || titleChanged) {
      return {
        status: 'success',
        reason: urlChanged
          ? `Page navigated from ${before.url} to ${after.url}`
          : `Page title changed from "${before.title}" to "${after.title}"`,
        confidence: 95,
      }
    }

    if (targetDisappeared) {
      return {
        status: 'success',
        reason: `Target element "${action.selector}" disappeared after click (likely modal/menu opened or page section changed)`,
        confidence: 85,
      }
    }

    if (Math.abs(elementCountDelta) >= 3) {
      return {
        status: 'success',
        reason: `Page structure changed significantly (${elementCountDelta > 0 ? '+' : ''}${elementCountDelta} elements)`,
        confidence: 75,
      }
    }

    const newElements = after.elements.filter(
      ae => !before.elements.some(be => be.selector === ae.selector)
    )
    if (newElements.length >= 2) {
      return {
        status: 'success',
        reason: `${newElements.length} new elements appeared after click`,
        confidence: 70,
      }
    }

    return {
      status: 'retry',
      reason: `Click on "${action.selector}" did not produce a visible page change`,
      confidence: 30,
    }
  }

  if (action.action === 'dom_type') {
    const targetAfter = after.elements.find(e => e.selector === action.selector)

    if (targetAfter && action.value) {
      const hasValue = targetAfter.text?.includes(action.value.slice(0, 20))
      if (hasValue) {
        return {
          status: 'success',
          reason: `Value "${action.value.slice(0, 30)}..." confirmed in target element`,
          confidence: 95,
        }
      }
    }

    if (targetAfter) {
      return {
        status: 'success',
        reason: `Target element "${action.selector}" still present (type action likely succeeded)`,
        confidence: 65,
      }
    }

    if (!targetAfter) {
      return {
        status: 'retry',
        reason: `Target element "${action.selector}" not found after typing`,
        confidence: 20,
      }
    }
  }

  if (action.action === 'navigate') {
    const targetUrl = action.url || action.value || ''
    if (targetUrl && after.url.includes(targetUrl)) {
      return {
        status: 'success',
        reason: `Successfully navigated to ${after.url}`,
        confidence: 95,
      }
    }
    if (urlChanged) {
      return {
        status: 'success',
        reason: `Page navigated to ${after.url}`,
        confidence: 80,
      }
    }
    return {
      status: 'retry',
      reason: `Navigation target "${targetUrl}" not reflected in current URL: ${after.url}`,
      confidence: 30,
    }
  }

  return {
    status: 'success',
    reason: `Action "${action.action}" completed (no specific validation rules)`,
    confidence: 50,
  }
}

export function detectCaptcha(snapshot: BrowserSnapshot): boolean {
  const captchaIndicators = [
    'captcha', 'recaptcha', 'hcaptcha', 'challenge', 'verify you are human',
    'i am not a robot', 'security check', 'cloudflare',
  ]

  const pageText = snapshot.elements
    .map(e => `${e.text} ${e.ariaLabel || ''} ${e.selector}`)
    .join(' ')
    .toLowerCase()

  return captchaIndicators.some(indicator => pageText.includes(indicator))
}

export function detectSensitiveAction(action: ActionContext, elements: BrowserElement[]): boolean {
  const sensitivePatterns = [
    'password', 'credit-card', 'card-number', 'cvv', 'ssn',
    'delete', 'remove', 'cancel subscription',
  ]

  const target = elements.find(e => e.selector === action.selector)
  if (!target) return false

  const context = `${target.text} ${target.ariaLabel || ''} ${target.placeholder || ''} ${target.selector} ${target.type || ''}`.toLowerCase()

  if (target.type === 'password') return true

  return sensitivePatterns.some(p => context.includes(p))
}
