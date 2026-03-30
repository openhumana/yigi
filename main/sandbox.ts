import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import fs from 'node:fs'

const WORKSPACE = join(homedir(), '.yogibrowser', 'workspace')

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE)) {
  fs.mkdirSync(WORKSPACE, { recursive: true })
}

const BLACKLIST = [
  'rm ', 'del ', 'format ', 'sudo ', '> /dev/', ':(){ :|:& };:', 'mkfs', 'dd ', 'fdisk'
]

class SandboxExecutor {
  public async execute(command: string): Promise<string> {
    const lowerCmd = command.toLowerCase()
    const blocked = BLACKLIST.find(b => lowerCmd.includes(b))

    if (blocked) {
      throw new Error(`🚫 Terminal Security: Blocked destructive command containing "${blocked}"`)
    }

    return new Promise((resolve, reject) => {
      // For demonstration, we'll assume the command is like 'python script.py' or 'pip install ...'
      const [cmd, ...args] = command.split(' ')

      const child = spawn(cmd, args, {
        cwd: WORKSPACE,
        shell: true,
        env: {
          ...process.env,
          // Restricted PATH for the sandbox
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
        }
      })

      let output = ''
      let error = ''

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        error += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output || '✅ Done (No output)')
        } else {
          reject(new Error(`Exit code ${code}: ${error || output}`))
        }
      })
    })
  }

  public getWorkspacePath() {
    return WORKSPACE
  }
}

export const sandbox = new SandboxExecutor()
