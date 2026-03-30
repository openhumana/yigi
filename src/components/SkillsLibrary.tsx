import React, { useState } from 'react'
import { Skill, createSkill } from '../types/mission'
import { ChevronLeft, Plus, BookOpen, ToggleLeft, ToggleRight } from 'lucide-react'

interface Props {
  skills: Skill[]
  currentUrl: string
  onSave: (skill: Skill) => void
  onDelete: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onClose: () => void
}

const SkillsLibrary: React.FC<Props> = ({ skills, currentUrl, onSave, onDelete, onToggle, onClose }) => {
  const [editing, setEditing] = useState<Skill | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  const isActive = (skill: Skill): boolean => {
    if (!skill.enabled) return false
    return skill.activationTriggers.some(trigger => {
      if (trigger.type === 'url_pattern') return currentUrl.toLowerCase().includes(trigger.value.toLowerCase())
      if (trigger.type === 'manual') return false
      return false
    })
  }

  const handleNew = () => {
    const skill = createSkill({
      name: 'New Skill',
      description: 'Describe what this skill teaches the agent.',
      content: `# New Skill\n\n## Guidelines\n\n1. First guideline\n2. Second guideline\n\n## Examples\n\nAdd examples here.`,
      activationTriggers: [{ type: 'manual', value: 'custom' }],
    })
    setEditing(skill)
    setShowEditor(true)
  }

  const handleEdit = (skill: Skill) => {
    setEditing({ ...skill })
    setShowEditor(true)
  }

  const handleSave = () => {
    if (!editing) return
    editing.updatedAt = Date.now()
    onSave(editing)
    setShowEditor(false)
    setEditing(null)
  }

  const updateTrigger = (idx: number, field: string, value: string) => {
    if (!editing) return
    const triggers = [...editing.activationTriggers]
    triggers[idx] = { ...triggers[idx], [field]: value }
    setEditing({ ...editing, activationTriggers: triggers })
  }

  const addTrigger = () => {
    if (!editing) return
    setEditing({
      ...editing,
      activationTriggers: [...editing.activationTriggers, { type: 'url_pattern', value: '' }],
    })
  }

  const removeTrigger = (idx: number) => {
    if (!editing) return
    setEditing({
      ...editing,
      activationTriggers: editing.activationTriggers.filter((_, i) => i !== idx),
    })
  }

  if (showEditor && editing) {
    return (
      <div className="skills-panel">
        <div className="skills-panel-header">
          <button className="mission-back-btn" onClick={() => { setShowEditor(false); setEditing(null) }}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="mission-save-btn" onClick={handleSave}>Save</button>
        </div>
        <div className="skills-editor-form">
          <div className="mission-field">
            <label>Skill Name</label>
            <input
              type="text"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g., Reddit Posting"
            />
          </div>
          <div className="mission-field">
            <label>Description</label>
            <input
              type="text"
              value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder="Brief description of what this skill does"
            />
          </div>
          <div className="mission-field">
            <label>Priority (higher = loaded first)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={editing.priority}
              onChange={e => setEditing({ ...editing, priority: parseInt(e.target.value) || 50 })}
            />
          </div>

          <div className="skills-triggers-section">
            <div className="mission-tasks-header">
              <span>Activation Triggers</span>
              <button className="mission-add-task-btn" onClick={addTrigger}>
                <Plus size={12} /> Add
              </button>
            </div>
            {editing.activationTriggers.map((trigger, idx) => (
              <div key={idx} className="skill-trigger-row">
                <select
                  value={trigger.type}
                  onChange={e => updateTrigger(idx, 'type', e.target.value)}
                >
                  <option value="url_pattern">URL contains</option>
                  <option value="mission_type">Mission type</option>
                  <option value="manual">Manual only</option>
                </select>
                {trigger.type !== 'manual' && (
                  <input
                    type="text"
                    value={trigger.value}
                    onChange={e => updateTrigger(idx, 'value', e.target.value)}
                    placeholder={trigger.type === 'url_pattern' ? 'e.g., reddit.com' : 'e.g., outreach'}
                  />
                )}
                <button className="skill-trigger-remove" onClick={() => removeTrigger(idx)}>×</button>
              </div>
            ))}
          </div>

          <div className="mission-field">
            <label>Skill Content (Markdown)</label>
            <textarea
              className="skill-content-editor"
              value={editing.content}
              onChange={e => setEditing({ ...editing, content: e.target.value })}
              placeholder="Write the skill instructions in markdown..."
              rows={16}
            />
          </div>
        </div>
      </div>
    )
  }

  const activeSkills = skills.filter(s => isActive(s))
  const inactiveSkills = skills.filter(s => !isActive(s))

  return (
    <div className="skills-panel">
      <div className="skills-panel-header">
        <span className="mission-panel-title">Skills Library</span>
        <button className="mission-new-btn" onClick={handleNew}>
          <Plus size={12} /> New Skill
        </button>
      </div>

      {activeSkills.length > 0 && (
        <div className="skills-section">
          <div className="skills-section-label">ACTIVE ON THIS PAGE</div>
          {activeSkills.map(skill => (
            <div key={skill.id} className="skill-card skill-card-active" onClick={() => handleEdit(skill)}>
              <div className="skill-card-top">
                <BookOpen size={14} />
                <span className="skill-card-name">{skill.name}</span>
                <button
                  className="skill-toggle"
                  onClick={e => { e.stopPropagation(); onToggle(skill.id, !skill.enabled) }}
                >
                  {skill.enabled ? <ToggleRight size={18} color="#10b981" /> : <ToggleLeft size={18} color="#94949e" />}
                </button>
              </div>
              <div className="skill-card-desc">{skill.description}</div>
              {skill.builtIn && <span className="skill-builtin-badge">Built-in</span>}
            </div>
          ))}
        </div>
      )}

      <div className="skills-section">
        <div className="skills-section-label">
          {activeSkills.length > 0 ? 'ALL SKILLS' : 'SKILLS'}
        </div>
        {inactiveSkills.length === 0 && activeSkills.length === 0 && (
          <div className="mission-empty">No skills yet. Create one to teach Yogi new behaviors.</div>
        )}
        {(activeSkills.length > 0 ? inactiveSkills : skills).map(skill => (
          <div key={skill.id} className="skill-card" onClick={() => handleEdit(skill)}>
            <div className="skill-card-top">
              <BookOpen size={14} />
              <span className="skill-card-name">{skill.name}</span>
              <button
                className="skill-toggle"
                onClick={e => { e.stopPropagation(); onToggle(skill.id, !skill.enabled) }}
              >
                {skill.enabled ? <ToggleRight size={18} color="#10b981" /> : <ToggleLeft size={18} color="#94949e" />}
              </button>
            </div>
            <div className="skill-card-desc">{skill.description}</div>
            <div className="skill-card-meta">
              {skill.activationTriggers.map(t =>
                t.type === 'url_pattern' ? t.value :
                t.type === 'mission_type' ? `mission:${t.value}` : 'manual'
              ).join(' · ')}
              {skill.builtIn && <span className="skill-builtin-badge">Built-in</span>}
              {!skill.builtIn && (
                <button
                  className="mission-card-delete"
                  onClick={e => { e.stopPropagation(); onDelete(skill.id) }}
                  style={{ marginLeft: 'auto' }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SkillsLibrary
