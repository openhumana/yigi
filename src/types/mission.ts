export interface LoopConfig {
  source: 'hardcoded' | 'selector' | 'previous_task'
  items?: string[]
  selector?: string
  previousTaskId?: string
  variableName: string
}

export interface ConditionConfig {
  type: 'url_contains' | 'url_matches' | 'element_exists' | 'text_contains' | 'previous_task_status'
  value: string
  thenTaskId?: string
  elseTaskId?: string
}

export interface MissionTask {
  id: string
  description: string
  targetUrl?: string
  successCriteria?: string
  maxRetries: number
  dependsOn: string[]
  type: 'action' | 'loop' | 'conditional'
  loopConfig?: LoopConfig
  conditionConfig?: ConditionConfig
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  result?: string
  loopIndex?: number
  loopTotal?: number
}

export interface Mission {
  id: string
  name: string
  description: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  tasks: MissionTask[]
  currentTaskIndex: number
  completedTaskIds: string[]
  loopCounters: Record<string, number>
  createdAt: number
  updatedAt: number
}

export interface SkillTrigger {
  type: 'url_pattern' | 'mission_type' | 'manual'
  value: string
}

export interface Skill {
  id: string
  name: string
  description: string
  content: string
  activationTriggers: SkillTrigger[]
  enabled: boolean
  priority: number
  builtIn: boolean
  createdAt: number
  updatedAt: number
}

export function createMissionTask(partial?: Partial<MissionTask>): MissionTask {
  return {
    id: `mt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: '',
    maxRetries: 3,
    dependsOn: [],
    type: 'action',
    status: 'pending',
    ...partial,
  }
}

export function createMission(partial?: Partial<Mission>): Mission {
  return {
    id: `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    description: '',
    status: 'draft',
    tasks: [],
    currentTaskIndex: 0,
    completedTaskIds: [],
    loopCounters: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  }
}

export function createSkill(partial?: Partial<Skill>): Skill {
  return {
    id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    description: '',
    content: '',
    activationTriggers: [],
    enabled: true,
    priority: 50,
    builtIn: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  }
}
