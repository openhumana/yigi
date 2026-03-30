import { useRef, useCallback, useEffect } from 'react'
import { Mission, MissionTask } from '../types/mission'

interface RunnerCallbacks {
  sendChat: (prompt: string) => Promise<void>
  addLog: (msg: string, type?: string) => void
  getBrowserUrl: () => string
  saveMission: (mission: Mission) => void
  onComplete: (mission: Mission) => void
}

export function useMissionRunner(callbacks: RunnerCallbacks) {
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const missionRef = useRef<Mission | null>(null)
  const abortRef = useRef(false)
  const callbacksRef = useRef(callbacks)
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

  const evaluateCondition = useCallback(async (task: MissionTask): Promise<boolean> => {
    const config = task.conditionConfig
    if (!config) return true

    const url = callbacksRef.current.getBrowserUrl()

    switch (config.type) {
      case 'url_contains':
        return url.toLowerCase().includes(config.value.toLowerCase())
      case 'url_matches':
        try { return new RegExp(config.value).test(url) } catch { return false }
      case 'element_exists':
        return true
      case 'text_contains':
        return true
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

  const executeTask = useCallback(async (task: MissionTask): Promise<boolean> => {
    if (isAborted()) return false
    updateTask(task.id, { status: 'running' })
    callbacksRef.current.addLog(`[Mission] Running task: ${task.description}`, 'info')

    if (task.targetUrl) {
      callbacksRef.current.addLog(`[Mission] Navigating to ${task.targetUrl}`, 'info')
    }

    try {
      if (task.type === 'conditional') {
        const conditionMet = await evaluateCondition(task)
        const config = task.conditionConfig

        if (conditionMet && config?.thenTaskId) {
          callbacksRef.current.addLog(`[Mission] Condition met — proceeding to then-branch`, 'info')
          if (config.elseTaskId) updateTask(config.elseTaskId, { status: 'skipped' })
        } else if (!conditionMet && config?.elseTaskId) {
          callbacksRef.current.addLog(`[Mission] Condition not met — proceeding to else-branch`, 'info')
          if (config.thenTaskId) updateTask(config.thenTaskId, { status: 'skipped' })
        } else if (!conditionMet) {
          callbacksRef.current.addLog(`[Mission] Condition not met — skipping`, 'info')
          updateTask(task.id, { status: 'skipped' })
          return true
        }

        if (isAborted()) return false
        const prompt = buildTaskPrompt(task)
        await callbacksRef.current.sendChat(prompt)
        await sleep(2000)
        if (isAborted()) return false

        updateTask(task.id, { status: 'completed' })
        return true
      }

      if (task.type === 'loop') {
        const loopItems = resolveLoopItems(task)
        const total = loopItems.length || 1
        callbacksRef.current.addLog(`[Mission] Loop task: ${total} iterations`, 'info')

        let completedIterations = 0
        for (let i = 0; i < total; i++) {
          if (isAborted() || !runningRef.current || pausedRef.current) break

          updateTask(task.id, { loopIndex: i, loopTotal: total })
          const item = loopItems[i] || `item_${i}`
          const prompt = buildTaskPrompt(task, item, i, total)

          callbacksRef.current.addLog(`[Mission] Loop iteration ${i + 1}/${total}: ${item}`, 'info')
          await callbacksRef.current.sendChat(prompt)
          await sleep(2000)
          if (isAborted()) break
          completedIterations++
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
      await sleep(2000)
      if (isAborted()) return false

      updateTask(task.id, { status: 'completed' })
      return true
    } catch (err: any) {
      if (isAborted()) return false
      callbacksRef.current.addLog(`[Mission] Task failed: ${err.message || err}`, 'alert')
      updateTask(task.id, { status: 'failed', result: err.message || String(err) })
      return false
    }
  }, [evaluateCondition, updateTask, sleep])

  const runMission = useCallback(async (mission: Mission) => {
    abortRef.current = false
    missionRef.current = { ...mission, status: 'active', updatedAt: Date.now() }
    runningRef.current = true
    pausedRef.current = false

    callbacksRef.current.saveMission(missionRef.current)
    callbacksRef.current.addLog(`[Mission] Starting: ${mission.name}`, 'info')

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
            await sleep(1000)
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
            break
          }
        }

        await sleep(1000)
      }
    } finally {
      runningRef.current = false
    }
  }, [getNextTask, executeTask, updateMission, updateTask, sleep])

  const pauseMission = useCallback(() => {
    pausedRef.current = true
    updateMission(m => ({ ...m, status: 'paused', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Paused`, 'info')
  }, [updateMission])

  const resumeMission = useCallback(() => {
    pausedRef.current = false
    updateMission(m => ({ ...m, status: 'active', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Resumed`, 'info')
  }, [updateMission])

  const stopMission = useCallback(() => {
    abortRef.current = true
    runningRef.current = false
    pausedRef.current = false
    updateMission(m => ({ ...m, status: 'draft', updatedAt: Date.now() }))
    callbacksRef.current.addLog(`[Mission] Stopped`, 'info')
    missionRef.current = null
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

function buildTaskPrompt(task: MissionTask, loopItem?: string, loopIdx?: number, loopTotal?: number): string {
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

function resolveLoopItems(task: MissionTask): string[] {
  const config = task.loopConfig
  if (!config) return []

  if (config.source === 'hardcoded' && config.items) {
    return config.items
  }

  return ['item_1', 'item_2', 'item_3']
}
