import { WebContents } from 'electron'

/**
 * Simulates human-like interactions with a webview's WebContents
 */
export class HumanInteractionService {
  private typing = false

  /**
   * Types text like a human: variable speed, intentional typos, and corrections.
   */
  public async type(webContents: WebContents, text: string) {
    if (this.typing) return
    this.typing = true

    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      
      // 5% chance of a typo on alphanumeric characters
      if (/[a-zA-Z0-9]/.test(char) && Math.random() < 0.05) {
        await this.makeTypo(webContents, char)
      }

      await this.sendChar(webContents, char)
      
      // Variable delay between keystrokes (80ms to 200ms)
      const delay = Math.floor(Math.random() * 120) + 80
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    this.typing = false
  }

  private async makeTypo(webContents: WebContents, correctChar: string) {
    const typos: Record<string, string> = {
      'a': 's', 's': 'd', 'd': 'f', 'f': 'g', 'g': 'h',
      'q': 'w', 'w': 'e', 'e': 'r', 'r': 't', 't': 'y',
      'z': 'x', 'x': 'c', 'c': 'v', 'v': 'b', 'b': 'n',
      '1': '2', '2': '3', '0': '9'
    }
    
    const typoChar = typos[correctChar.toLowerCase()] || 'x'
    await this.sendChar(webContents, typoChar)
    
    // Pause briefly to "notice" the mistake
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Backspace
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    webContents.sendInputEvent({ type: 'char', keyCode: 'Backspace' } as any)
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  private async sendChar(webContents: WebContents, char: string) {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: char } as any)
    webContents.sendInputEvent({ type: 'char', keyCode: char } as any)
    webContents.sendInputEvent({ type: 'keyUp', keyCode: char } as any)
  }

  /**
   * Clicks a specific coordinate like a human (could add jitter)
   */
  public async click(webContents: WebContents, x: number, y: number) {
    // Move
    webContents.sendInputEvent({ type: 'mouseMove', x, y })
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Down/Up
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await new Promise(resolve => setTimeout(resolve, 50))
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }
}

export const humanInteraction = new HumanInteractionService()
