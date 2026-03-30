import { useRef, useCallback, useEffect } from 'react'
import { Mission, MissionTask } from '../types/mission'

interface BrowserElement {
  tag: string
  text: string
  selector: string
  ariaLabel?: string
  placeholder?: string
}

interface RunnerCallbacks {
  sendChat: (prompt: string) => Promise<string>
  addLog: (msg: string, type?: string) => void
  getBrowserUrl: () => string
  getBrowserElements: () => BrowserElement[]
  navigateTo: (url: string) => void
  saveMission: (mission: Mission) => void
  onComplete: (mission: Mission) => void
  onPaused: (mission: Mission) => void
  getTaskQueueLength: () => number
  waitForTaskQueueDrain: () => Promise<void>
  getLastAIResponse: () => string
}

export function useMissionRunner(callbacks: RunnerCallbacks) {
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const missionRef = useRef<Mission | null>(null)
  const abortRef = useRef(false)
  const callbacksRef = useRef(callbacks)
  const taskResultsRef = useRef<Record<string, string>>({})
  callbacksRef.current = callbacks

  useEffect(() => {
    return () => {
      abortRef.current = true
      runningRef.current = false
    }
  }, [])

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const check = setInterval(() => {
      if (abortRef.current) {
        clearTimeout(timer)
        clearInterval(check)
        resolve()
      }
    }, 200)
    setTimeout(() => clearInterval(check), ms + 100)
  })

  const isAborted = () => abortRef.current

  const updateMission = useCallback((updater: (m: Mission) => Mission) => {
    if (!missionRef.current || abortRef.current) return
    missionRef.current = updater(missionRef.current)
    callbacksRef.current.saveMission(missionRef.current)
  }, [])

  const updateTask = useCallback((taskId: string, updates: Partial<MissionTask>) => {
    updateMission(m => ({
      ...m,
      tasks: m.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
      updatedAt: Date.now(),
    }))
  }, [updateMission])

  const waitForExecution = useCallback(async () => {
    await sleep(500)
    if (isAborted()) return

    const maxWait = 60000
    const start = Date.now()
    while (Date.now() - start < maxWait && !isAborted()) {
      const queueLen = callbacksRef.current.getTaskQueueLength()
      if (queueLen === 0) break
      callbacksRef.current.addLog(`[Mission] Waiting for ${queueLen} queued action(s) to complete...`, 'info')
      await callbacksRef.current.waitForTaskQueueDrain()
      await sleep(500)
      if (isAborted()) return
    }
  }, [])

  const evaluateCondition = useCallback(async (task: MissionTask): Promise<boolean> => {
    const config = task.conditionConfig
    if (!config) return true

    const url = callbacksRef.current.getBrowserUrl()
    const elements = callbacksRef.current.getBrowserElements()

    switch (config.type) {
      case 'url_contains':
        return url.toLowerCase().includes(config.value.toLowerCase())
      case 'url_matches':
        try { return new RegExp(config.value).test(url) } catch { return false }
      case 'element_exists': {
        const selectorLower = config.value.toLowerCase()
        return elements.some(el =>
          el.selector.toLowerCase().includes(selectorLower) ||
          (el.text && el.text.toLowerCase().includes(selectorLower)) ||
          (el.ariaLabel && el.ariaLabel.toLowerCase().includes(selectorLower))
        )
      }
      case 'text_contains': {
        const valueLower = config.value.toLowerCase()
        return elements.some(el =>
          (el.text && el.text.toLowerCase().includes(valueLower)) ||
          (el.placeholder && el.placeholder.toLowerCase().includes(valueLower))
        )
      }
      case 'previous_task_status': {
        const mission = missionRef.current
        if (!mission) return false
        const depId = task.dependsOn[task.dependsOn.length - 1]
        const dep = mission.tasks.find(t => t.id === depId)
        return dep?.status === config.value
      }
      default:
        return true
    }
  }, [])

  const getNextTask = useCallback((): MissionTask | null => {
    const mission = missionRef.current
    if (!mission) return null

    for (const task of mission.tasks) {
      if (task.status !== 'pending') continue
      const depsCompleted = task.dependsOn.every(depId => {
        const dep = mission.tasks.find(t => t.id === depId)
        return dep && (dep.status === 'completed' || dep.status === 'skipped')
      })
      if (depsCompleted) return task
    }
    return null
  }, [])

  const resolveLoopItems = useCallback((task: MissionTask): string[] => {
    const config = task.loopConfig
    if (!config) return []

    if (config.source === 'hardcoded' && config.items) {
      return config.items
    }

    if (config.source === 'selector' && config.selector) {
      const elements = callbacksRef.current.getBrowserElements()
      const selectorLower = config.selector.toLowerCase()
      const matched = elements.filter(el =>
        el.selector.toLowerCase().includes(selectorLower) ||
        (el.tag && el.tag.toLowerCase() === selectorLower)
      )
      if (matched.length > 0) {
        return matched.map(el => el.text || el.selector)
      }
      callbacksRef.current.addLog(`[Mission] Loop selector "${config.selector}" matched 0 elements`, 'alert')
      return []
    }

    if (config.source === 'previous_task' && config.previousTaskId) {
      const result = taskResultsRef.current[config.previousTaskId]
        || missionRef.current?.taskOutputs?.[config.previousTaskId]
      if (result) {
        try {
          const parsed = JSON.parse(result)
          if (Array.isArray(parsed)) return parsed.map(String)
        } catch {}
        const lines = result.split('\n').filter(line => line.trim().length > 0)
        if (lines.length > 0) return lines
      }
      callbacksRef.current.addLog(`[Mission] No usable output from task ${config.previousTaskId} for loop`, 'alert')
      return []
    }

    return []
  }, [])

  const captureTaskOutput = useCallback((taskId: string, output: string) => {
    taskResultsRef.current[taskId] = output
    updateMission(m => ({
      ...m,
      taskOutputs: { ...m.taskOutputs, [taskId]: output },
    }))
  }, [updateMission])

  const verifySuccessCriteria = useCallback((criteria: string): { met: boolean; reason: string } => {
    const url = callbacksRef.current.getBrowserUrl()
    const elements = callbacksRef.current.getBrowserElements()
    const criteriaLower = criteria.toLowerCase()

    if (criteriaLower.includes('url') && criteriaLower.includes('contains')) {
      const match = criteria.match(/contains?\s+["']?([^"']+)["']?/i)
      if (match) {
        const target = match[1].trim()
        if (url.toLowerCase().includes(target.toLowerCase())) {
          return { met: true, reason: `URL contains "${target}"` }
        }
        return { met: false, reason: `URL does not contain "${target}" (current: ${url})` }
      }
    }

    if (criteriaLower.includes('element') || criteriaLower.includes('visible') || criteriaLower.includes('present')) {
      const keywords = criteria.replace(/element|visible|present|exists|should|be|is|the|a|an|on|page/gi, '')
        .trim().split(/\s+/).filter(w => w.length > 2)
      for (const kw of keywords) {
        const found = elements.some(el =>
          el.text?.toLowerCase().includes(kw.toLowerCase()) ||
          el.selector?.toLowerCase().includes(kw.toLowerCase())
        )
        if (found) return { met: true, reason: `Found element matching "${kw}"` }
      }
      if (keywords.length > 0) {
        return { met: false, reason: `No elements matching criteria keywords: ${keywords.join(', ')}` }
      }
    }

    if (elements.length === 0) {
      return { met: false, reason: 'Cannot verify — no browser elements available' }
    }

    const pageText = elements.map(el => el.text).join(' ').toLowerCase()
    const criteriaWords = criteria.split(/\s+/).filter(w => w.length > 3)
    const matchCount = criteriaWords.filter(w => pageText.includes(w.toLowerCase())).length
    if (criteriaWords.length > 0 && matchCount / criteriaWords.length > 0.5) {
      return { met: true, reason: `Page content matches ${matchCount}/${criteriaWords.length} criteria keywords` }
    }

    return { met: false, reason: `Success criteria could not be verified: "${criteria}"` }
  }, [])

  const executeTask = useCallback(async (task: MissionTask): Promise<boolean> => {
    if (isAborted()) return false
    updateTask(task.id, { status: 'running' })
    callbacksRef.current.addLog(`[Mission] Running task: ${task.description}`, 'info')

    if (task.targetUrl) {
      callbacksRef.current.addLog(`[Mission] Navigating to ${task.targetUrl}`, 'info')
      callbacksRef.current.navigateTo(task.targetUrl)
      await sleep(3000)
      if (isAborted()) return false
    }

    try {
      if (task.type === 'conditional') {
        const conditionMet = await evaluateCondition(task)
        const config = task.conditionConfig

        callbacksRef.current.addLog(
          `[Mission] Condition "${config?.type}" = "${config?.value}": ${conditionMet ? 'MET' : 'NOT MET'}`,
          'info'
        )

        if (conditionMet && config?.thenTaskId) {
          if (config.elseTaskId) updateTask(config.elseTaskId, { status: 'skipped' })
        } else if (!conditionMet && config?.elseTaskId) {
          if (config.thenTaskId) updateTask(config.thenTaskId, { status: 'skipped' })
        } else if (!conditionMet) {
          callbacksRef.current.addLog(`[Mission] Condition not met and no else-branch — skipping`, 'info')
          updateTask(task.id, { status: 'skipped' })
          return true
        }

        if (isAborted()) return false
        const prompt = buildTaskPrompt(task)
        await callbacksRef.current.sendChat(prompt)
        await waitForExecution()
        if (isAborted()) return false

        const condOutput = callbacksRef.current.getLastAIResponse()
        captureTaskOutput(task.id, condOutput)

        updateTask(task.id, { status: 'completed' })
        return true
      }

      if (task.type === 'loop') {
        const loopItems = resolveLoopItems(task)
        const total = loopItems.length
        if (total === 0) {
          callbacksRef.current.addLog(`[Mission] Loop has 0 items — skipping`, 'info')
          updateTask(task.id, { status: 'skipped' })
          return true
        }

        callbacksRef.current.addLog(`[Mission] Loop task: ${total} iterations`, 'info')

        const startFrom = task.loopIndex || 0
        let completedIterations = startFrom
        for (let i = startFrom; i < total; i++) {
          if (isAborted() || !runningRef.current || pausedRef.current) break

          updateTask(task.id, { loopIndex: i, loopTotal: total })
          const item = loopItems[i]
          const prompt = buildTaskPrompt(task, item, i, total)

          callbacksRef.current.addLog(`[Mission] Loop iteration ${i + 1}/${total}: ${item}`, 'info')
          await callbacksRef.current.sendChat(prompt)
          await waitForExecution()
          if (isAborted()) break

          const iterOutput = callbacksRef.current.getLastAIResponse()
          const prevOutput = taskResultsRef.current[task.id] || ''
          captureTaskOutput(task.id, prevOutput ? `${prevOutput}\n${iterOutput}` : iterOutput)

          completedIterations = i + 1
        }

        if (completedIterations === total) {
          updateTask(task.id, { status: 'completed', loopIndex: total, loopTotal: total })
        } else {
          updateTask(task.id, { status: 'pending', loopIndex: completedIterations, loopTotal: total })
          return false
        }
        return true
      }

      if (isAborted()) return false
      const prompt = buildTaskPrompt(task)
      await callbacksRef.current.sendChat(prompt)
      await waitForExecution()
      if (isAborted()) return false

      const aiResponse = callbacksRef.current.getLastAIResponse()

      if (task.successCriteria) {
        const verification = verifySuccessCriteria(task.successCriteria)
        callbacksRef.current.addLog(
          `[Mission] Success criteria: ${verification.met ? 'MET' : 'NOT MET'} — ${verification.reason}`,
          verification.met ? 'info' : 'alert'
        )
        if (!verification.met) {
          captureTaskOutput(task.id, `Failed: ${verification.reason}`)
          updateTask(task.id, { status: 'failed', result: verification.reason })
          return false
        }
      }

      captureTaskOutput(task.id, aiResponse || `Completed: ${task.description}`)
      updateTask(task.id, { status: 'completed' })
      return true
    } catch (err: any) {
      if (isAborted()) return false
      callbacksRef.current.addLog(`[Mission] Task failed: ${err.message || err}`, 'alert')
      captureTaskOutput(task.id, `Error: ${err.message || String(err)}`)
      updateTask(task.id, { status: 'failed', result: err.message || String(err) })
      return false
    }
  }, [evaluateCondition, resolveLoopItems, verifySuccessCriteria, captureTaskOutput, updateTask, waitForExecution])

  const runMissionLoop = useCallback(async () => {
    try {
      while (runningRef.current && !abortRef.current) {
        if (pausedRef.current) {
          await sleep(500)
          continue
        }

        const task = getNextTask()
        if (!task) {
          const m = missionRef.current!
          const allDone = m.tasks.every(t =>
            t.status === 'completed' || t.status === 'skipped' || t.status === 'failed'
          )
          const hasBlocked = m.tasks.some(t => {
            if (t.status !== 'pending') return false
            return t.dependsOn.some(depId => {
              const dep = m.tasks.find(d => d.id === depId)
              return dep?.status === 'failed'
            })
          })

          if (allDone) {
            callbacksRef.current.addLog(`[Mission] Completed: ${m.name}`, 'info')
            updateMission(prev => ({ ...prev, status: 'completed', updatedAt: Date.now() }))
            callbacksRef.current.onComplete(missionRef.current!)
            break
          } else if (hasBlocked) {
            callbacksRef.current.addLog(`[Mission] Blocked — tasks depend on failed tasks, pausing`, 'alert')
            pausedRef.current = true
            updateMission(prev => ({ ...prev, status: 'paused', updatedAt: Date.now() }))
            callbacksRef.current.onPaused(missionRef.current!)
            break
          } else {
            await sleep(2000)
            continue
          }
        }

        const success = await executeTask(task)
        if (abortRef.current) break

        if (success) {
          updateMission(m => ({
            ...m,
            completedTaskIds: [...m.completedTaskIds, task.id],
            currentTaskIndex: m.tasks.findIndex(t => t.status === 'pending'),
            updatedAt: Date.now(),
          }))
        } else {
          let retried = false
          for (let retry = 0; retry < task.maxRetries; retry++) {
            if (!runningRef.current || abortRef.current) break
            callbacksRef.current.addLog(`[Mission] Retrying task (${retry + 1}/${task.maxRetries})`, 'info')
            updateTask(task.id, { status: 'pending' })
            await sleep(1000 * (retry + 1))
            if (abortRef.current) break
            const retrySuccess = await executeTask(task)
            if (retrySuccess) {
              retried = true
              updateMission(m => ({
                ...m,
                completedTaskIds: [...m.completedTaskIds, task.id],
                currentTaskIndex: m.tasks.findIndex(t => t.status === 'pending'),
                updatedAt: Date.now(),
              }))
              break
            }
          }
          if (!retried) {
            callbacksRef.current.addLog(`[Mission] Task failed after retries — pausing mission`, 'alert')
            pausedRef.current = true
            updateMission(m => ({ ...m, status: 'paused', updatedAt: Date.now() }))
            callbacksRef.current.onPaused(missionRef.current!)
            break
          }
        }

        await sleep(1000)
      }
    } finally {
      runningRef.current = false
    }
  }, [getNextTask, executeTask, updateMission, updateTask])

  const runMission = useCallback(async (mission: Mission) => {
    abortRef.current = false
    taskResultsRef.current = {}
    missionRef.current = {
      ...mission,
      status: 'active',
      tasks: mission.tasks.map(t => ({ ...t, status: 'pending' as const })),
      completedTaskIds: [],
      currentTaskIndex: 0,
      updatedAt: Date.now(),
    }
    runningRef.current = true
    pausedRef.current = false

    callbacksRef.current.saveMission(missionRef.current)
    callbacksRef.current.addLog(`[Mission] Starting: ${mission.name}`, 'info')

    await runMissionLoop()
  }, [runMissionLoop])

  const pauseMission = useCallback(() => {
    pausedRef.current = true
    updateMission(m => ({ ...m, status: 'paused', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Paused`, 'info')
  }, [updateMission])

  const resumeMission = useCallback(async (mission?: Mission) => {
    if (mission && !missionRef.current) {
      abortRef.current = false
      taskResultsRef.current = { ...(mission.taskOutputs || {}) }
      missionRef.current = { ...mission, status: 'active', updatedAt: Date.now() }
      runningRef.current = true
      pausedRef.current = false
      callbacksRef.current.saveMission(missionRef.current)

      const completedCount = mission.tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length
      const pendingCount = mission.tasks.filter(t => t.status === 'pending').length
      callbacksRef.current.addLog(
        `[Mission] Resuming "${mission.name}" — ${completedCount} done, ${pendingCount} remaining`,
        'info'
      )

      await runMissionLoop()
      return
    }

    pausedRef.current = false
    updateMission(m => ({ ...m, status: 'active', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Resumed`, 'info')
  }, [updateMission, runMissionLoop])

  const stopMission = useCallback(() => {
    abortRef.current = true
    runningRef.current = false
    pausedRef.current = false
    updateMission(m => ({ ...m, status: 'draft', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Stopped`, 'info')
    missionRef.current = null
    taskResultsRef.current = {}
  }, [updateMission])

  return {
    runMission,
    pauseMission,
    resumeMission,
    stopMission,
    isRunning: () => runningRef.current,
    isPaused: () => pausedRef.current,
    currentMission: () => missionRef.current,
  }
}

function buildTaskPrompt(task: MissionTask, loopItem?: string, loopIdx?: number, loopTotal?: number, missionKB?: string): string {
  let prompt = task.description

  if (task.targetUrl) {
    prompt = `Navigate to ${task.targetUrl}. Then: ${prompt}`
  }

  if (task.successCriteria) {
    prompt += `\n\nSuccess criteria: ${task.successCriteria}`
  }

  if (loopItem !== undefined && loopIdx !== undefined && loopTotal !== undefined) {
    prompt += `\n\n[Loop context: Processing item ${loopIdx + 1}/${loopTotal}: "${loopItem}"]`
  }

  if (task.type === 'conditional' && task.conditionConfig) {
    prompt += `\n\n[Conditional: Check if ${task.conditionConfig.type} = "${task.conditionConfig.value}"]`
  }

  return prompt
}
