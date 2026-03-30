import React, { useState } from 'react'
import { Mission, MissionTask, createMission, createMissionTask } from '../types/mission'
import { MISSION_TEMPLATES } from '../data/missions'
import { ChevronLeft, Plus, Play, Trash2, GripVertical, ChevronDown, ChevronUp, Copy } from 'lucide-react'

interface Props {
  missions: Mission[]
  onSave: (mission: Mission) => void
  onDelete: (id: string) => void
  onRun: (mission: Mission) => void
  onClose: () => void
}

const MissionEditor: React.FC<Props> = ({ missions, onSave, onDelete, onRun, onClose }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Mission | null>(null)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  const selected = selectedId ? missions.find(m => m.id === selectedId) : null

  const handleNew = () => {
    const m = createMission({ name: 'New Mission' })
    setEditing(m)
    setSelectedId(null)
  }

  const handleImportTemplate = (template: Mission) => {
    const m = createMission({
      ...template,
      id: `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tasks: template.tasks.map(t => ({ ...t, status: 'pending' as const })),
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    onSave(m)
    setShowTemplates(false)
    setSelectedId(m.id)
  }

  const handleEdit = (m: Mission) => {
    setEditing({ ...m, tasks: m.tasks.map(t => ({ ...t })) })
  }

  const handleSave = () => {
    if (!editing) return
    editing.updatedAt = Date.now()
    onSave(editing)
    setSelectedId(editing.id)
    setEditing(null)
  }

  const addTask = () => {
    if (!editing) return
    const task = createMissionTask({ description: 'New task' })
    setEditing({ ...editing, tasks: [...editing.tasks, task] })
    setExpandedTask(task.id)
  }

  const updateTask = (taskId: string, updates: Partial<MissionTask>) => {
    if (!editing) return
    setEditing({
      ...editing,
      tasks: editing.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t),
    })
  }

  const removeTask = (taskId: string) => {
    if (!editing) return
    setEditing({
      ...editing,
      tasks: editing.tasks.filter(t => t.id !== taskId),
    })
  }

  const moveTask = (taskId: string, direction: 'up' | 'down') => {
    if (!editing) return
    const idx = editing.tasks.findIndex(t => t.id === taskId)
    if (idx < 0) return
    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    if (newIdx < 0 || newIdx >= editing.tasks.length) return
    const tasks = [...editing.tasks]
    ;[tasks[idx], tasks[newIdx]] = [tasks[newIdx], tasks[idx]]
    setEditing({ ...editing, tasks })
  }

  const statusColor: Record<string, string> = {
    draft: '#94949e',
    active: '#10b981',
    paused: '#f59e0b',
    completed: '#5286ff',
  }

  if (showTemplates) {
    return (
      <div className="mission-panel">
        <div className="mission-panel-header">
          <button className="mission-back-btn" onClick={() => setShowTemplates(false)}>
            <ChevronLeft size={16} /> Back
          </button>
          <span className="mission-panel-title">Mission Templates</span>
        </div>
        <div className="mission-list">
          {MISSION_TEMPLATES.map(t => (
            <div key={t.id} className="mission-card" onClick={() => handleImportTemplate(t)}>
              <div className="mission-card-name">{t.name}</div>
              <div className="mission-card-desc">{t.description}</div>
              <div className="mission-card-meta">
                <Copy size={10} /> Import · {t.tasks.length} tasks
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="mission-panel">
        <div className="mission-panel-header">
          <button className="mission-back-btn" onClick={() => setEditing(null)}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="mission-save-btn" onClick={handleSave}>Save</button>
        </div>
        <div className="mission-editor-form">
          <div className="mission-field">
            <label>Mission Name</label>
            <input
              type="text"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g., Reddit Sales Outreach"
            />
          </div>
          <div className="mission-field">
            <label>Description / Goal</label>
            <textarea
              value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder="What should this mission accomplish?"
              rows={3}
            />
          </div>
          <div className="mission-field">
            <label>Knowledge Base (mission-specific context for AI)</label>
            <textarea
              value={editing.knowledgeBase || ''}
              onChange={e => setEditing({ ...editing, knowledgeBase: e.target.value })}
              placeholder="Add product info, personas, templates, guidelines, etc. This context is injected into every AI prompt during this mission."
              rows={4}
            />
          </div>

          <div className="mission-tasks-header">
            <span>Tasks ({editing.tasks.length})</span>
            <button className="mission-add-task-btn" onClick={addTask}>
              <Plus size={12} /> Add Task
            </button>
          </div>

          <div className="mission-tasks-list">
            {editing.tasks.map((task, idx) => (
              <div key={task.id} className="mission-task-item">
                <div
                  className="mission-task-header"
                  onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                >
                  <GripVertical size={12} className="grip-icon" />
                  <span className="mission-task-num">{idx + 1}</span>
                  <span className="mission-task-type-badge">{task.type}</span>
                  <span className="mission-task-desc-preview">
                    {task.description || 'Untitled task'}
                  </span>
                  <div className="mission-task-actions">
                    <button onClick={e => { e.stopPropagation(); moveTask(task.id, 'up') }} disabled={idx === 0}>
                      <ChevronUp size={12} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); moveTask(task.id, 'down') }} disabled={idx === editing.tasks.length - 1}>
                      <ChevronDown size={12} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); removeTask(task.id) }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {expandedTask === task.id && (
                  <div className="mission-task-details">
                    <div className="mission-field">
                      <label>Description</label>
                      <textarea
                        value={task.description}
                        onChange={e => updateTask(task.id, { description: e.target.value })}
                        placeholder="What should the agent do?"
                        rows={2}
                      />
                    </div>
                    <div className="mission-field">
                      <label>Target URL (optional)</label>
                      <input
                        type="text"
                        value={task.targetUrl || ''}
                        onChange={e => updateTask(task.id, { targetUrl: e.target.value || undefined })}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="mission-field">
                      <label>Success Criteria</label>
                      <input
                        type="text"
                        value={task.successCriteria || ''}
                        onChange={e => updateTask(task.id, { successCriteria: e.target.value || undefined })}
                        placeholder="How to verify this task succeeded"
                      />
                    </div>
                    <div className="mission-field-row">
                      <div className="mission-field">
                        <label>Type</label>
                        <select
                          value={task.type}
                          onChange={e => updateTask(task.id, { type: e.target.value as any })}
                        >
                          <option value="action">Action</option>
                          <option value="loop">Loop</option>
                          <option value="conditional">Conditional</option>
                        </select>
                      </div>
                      <div className="mission-field">
                        <label>Max Retries</label>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={task.maxRetries}
                          onChange={e => updateTask(task.id, { maxRetries: parseInt(e.target.value) || 3 })}
                        />
                      </div>
                    </div>

                    {task.type === 'loop' && (
                      <div className="mission-field">
                        <label>Loop Source</label>
                        <select
                          value={task.loopConfig?.source || 'hardcoded'}
                          onChange={e => updateTask(task.id, {
                            loopConfig: {
                              ...task.loopConfig,
                              source: e.target.value as any,
                              variableName: task.loopConfig?.variableName || 'item',
                            }
                          })}
                        >
                          <option value="hardcoded">Hardcoded list</option>
                          <option value="selector">CSS selector on page</option>
                          <option value="previous_task">Output from previous task</option>
                        </select>
                        {task.loopConfig?.source === 'hardcoded' && (
                          <textarea
                            value={(task.loopConfig?.items || []).join('\n')}
                            onChange={e => updateTask(task.id, {
                              loopConfig: {
                                ...task.loopConfig!,
                                items: e.target.value.split('\n').filter(Boolean),
                              }
                            })}
                            placeholder="One item per line"
                            rows={3}
                          />
                        )}
                        {task.loopConfig?.source === 'selector' && (
                          <input
                            type="text"
                            value={task.loopConfig?.selector || ''}
                            onChange={e => updateTask(task.id, {
                              loopConfig: { ...task.loopConfig!, selector: e.target.value }
                            })}
                            placeholder="CSS selector (e.g., .post-list a)"
                          />
                        )}
                        {task.loopConfig?.source === 'previous_task' && (
                          <select
                            value={task.loopConfig?.previousTaskId || ''}
                            onChange={e => updateTask(task.id, {
                              loopConfig: { ...task.loopConfig!, previousTaskId: e.target.value || undefined }
                            })}
                          >
                            <option value="">Select source task...</option>
                            {editing.tasks.filter(t => t.id !== task.id).map(t => (
                              <option key={t.id} value={t.id}>
                                {editing.tasks.indexOf(t) + 1}. {t.description || 'Untitled'}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {task.type === 'conditional' && (
                      <>
                        <div className="mission-field">
                          <label>Condition</label>
                          <select
                            value={task.conditionConfig?.type || 'element_exists'}
                            onChange={e => updateTask(task.id, {
                              conditionConfig: {
                                ...task.conditionConfig,
                                type: e.target.value as any,
                                value: task.conditionConfig?.value || '',
                              }
                            })}
                          >
                            <option value="url_contains">URL contains</option>
                            <option value="url_matches">URL matches pattern</option>
                            <option value="element_exists">Element exists</option>
                            <option value="text_contains">Page text contains</option>
                            <option value="previous_task_status">Previous task status</option>
                          </select>
                          <input
                            type="text"
                            value={task.conditionConfig?.value || ''}
                            onChange={e => updateTask(task.id, {
                              conditionConfig: { ...task.conditionConfig!, value: e.target.value }
                            })}
                            placeholder="Value to check"
                          />
                        </div>
                        <div className="mission-field-row">
                          <div className="mission-field">
                            <label>If True → Task</label>
                            <select
                              value={task.conditionConfig?.thenTaskId || ''}
                              onChange={e => updateTask(task.id, {
                                conditionConfig: {
                                  ...task.conditionConfig!,
                                  thenTaskId: e.target.value || undefined,
                                }
                              })}
                            >
                              <option value="">Continue (next task)</option>
                              {editing.tasks.filter(t => t.id !== task.id).map((t, i) => (
                                <option key={t.id} value={t.id}>
                                  {editing.tasks.indexOf(t) + 1}. {t.description || 'Untitled'}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mission-field">
                            <label>If False → Task</label>
                            <select
                              value={task.conditionConfig?.elseTaskId || ''}
                              onChange={e => updateTask(task.id, {
                                conditionConfig: {
                                  ...task.conditionConfig!,
                                  elseTaskId: e.target.value || undefined,
                                }
                              })}
                            >
                              <option value="">Skip (no else-branch)</option>
                              {editing.tasks.filter(t => t.id !== task.id).map((t, i) => (
                                <option key={t.id} value={t.id}>
                                  {editing.tasks.indexOf(t) + 1}. {t.description || 'Untitled'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="mission-field">
                      <label>Depends On (task numbers, comma-separated)</label>
                      <input
                        type="text"
                        value={task.dependsOn.map(depId => {
                          const depIdx = editing.tasks.findIndex(t => t.id === depId)
                          return depIdx >= 0 ? depIdx + 1 : depId
                        }).join(', ')}
                        onChange={e => {
                          const nums = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          const ids = nums.map(n => {
                            const idx = parseInt(n) - 1
                            return idx >= 0 && idx < editing.tasks.length ? editing.tasks[idx].id : n
                          })
                          updateTask(task.id, { dependsOn: ids })
                        }}
                        placeholder="e.g., 1, 2"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <div className="mission-panel">
        <div className="mission-panel-header">
          <button className="mission-back-btn" onClick={() => setSelectedId(null)}>
            <ChevronLeft size={16} /> All Missions
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="mission-edit-btn" onClick={() => handleEdit(selected)}>Edit</button>
            {selected.status === 'draft' && (
              <button className="mission-run-btn" onClick={() => onRun(selected)}>
                <Play size={12} /> Run
              </button>
            )}
          </div>
        </div>
        <div className="mission-detail">
          <h3>{selected.name}</h3>
          <div className="mission-status-badge" style={{ color: statusColor[selected.status] }}>
            {selected.status.toUpperCase()}
          </div>
          <p className="mission-detail-desc">{selected.description}</p>

          <div className="mission-tasks-header">
            <span>Tasks ({selected.tasks.length})</span>
          </div>
          <div className="mission-tasks-list">
            {selected.tasks.map((task, idx) => {
              const taskStatusIcon = task.status === 'completed' ? '✓' :
                task.status === 'running' ? '▶' :
                task.status === 'failed' ? '✗' :
                task.status === 'skipped' ? '⊘' : '○'
              const taskStatusColor = task.status === 'completed' ? '#10b981' :
                task.status === 'running' ? '#5286ff' :
                task.status === 'failed' ? '#ef4444' :
                task.status === 'skipped' ? '#94949e' : '#4a4a54'
              return (
                <div key={task.id} className="mission-task-view">
                  <span className="mission-task-status-icon" style={{ color: taskStatusColor }}>
                    {taskStatusIcon}
                  </span>
                  <span className="mission-task-num">{idx + 1}</span>
                  <span className="mission-task-type-badge">{task.type}</span>
                  <span className="mission-task-desc-preview">{task.description}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mission-panel">
      <div className="mission-panel-header">
        <span className="mission-panel-title">Missions</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="mission-template-btn" onClick={() => setShowTemplates(true)}>
            <Copy size={12} /> Templates
          </button>
          <button className="mission-new-btn" onClick={handleNew}>
            <Plus size={12} /> New
          </button>
        </div>
      </div>
      <div className="mission-list">
        {missions.length === 0 ? (
          <div className="mission-empty">
            No missions yet. Create one or import a template to get started.
          </div>
        ) : (
          missions.map(m => (
            <div key={m.id} className="mission-card" onClick={() => setSelectedId(m.id)}>
              <div className="mission-card-top">
                <span className="mission-card-name">{m.name}</span>
                <span className="mission-card-status" style={{ color: statusColor[m.status] }}>
                  {m.status}
                </span>
              </div>
              <div className="mission-card-desc">{m.description}</div>
              <div className="mission-card-meta">
                {m.tasks.length} tasks · {m.completedTaskIds.length}/{m.tasks.length} done
                <button
                  className="mission-card-delete"
                  onClick={e => { e.stopPropagation(); onDelete(m.id) }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default MissionEditor
