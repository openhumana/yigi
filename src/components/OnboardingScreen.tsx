import React, { useState } from 'react'
import { Rocket, Key, ChevronRight, CheckCircle, ExternalLink, Zap, Brain, Globe } from 'lucide-react'

interface OnboardingScreenProps {
  onComplete: (settings: { GROQ_KEYS?: string; OPENAI_KEYS?: string; GOOGLE_KEYS?: string }) => void
}

type Provider = 'groq' | 'openai' | 'google'

const PROVIDERS = [
  {
    id: 'groq' as Provider,
    name: 'Groq',
    tagline: 'Free & ultra-fast — recommended',
    icon: Zap,
    color: '#f97316',
    getKeyUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    field: 'GROQ_KEYS',
    description: 'Llama 3 + Mixtral. Free tier generous, fastest inference.',
  },
  {
    id: 'openai' as Provider,
    name: 'OpenAI',
    tagline: 'GPT-4o — most capable',
    icon: Brain,
    color: '#10b981',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    field: 'OPENAI_KEYS',
    description: 'GPT-4o and GPT-3.5-turbo. Best reasoning, requires billing.',
  },
  {
    id: 'google' as Provider,
    name: 'Google Gemini',
    tagline: 'Gemini 1.5 — multimodal',
    icon: Globe,
    color: '#3b82f6',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...',
    field: 'GOOGLE_KEYS',
    description: 'Gemini 1.5 Pro. Great at vision tasks and long context.',
  },
]

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<'welcome' | 'keys' | 'done'>('welcome')
  const [selectedProvider, setSelectedProvider] = useState<Provider>('groq')
  const [keys, setKeys] = useState<Record<Provider, string>>({ groq: '', openai: '', google: '' })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const settings: Record<string, string> = {}
    if (keys.groq.trim())   settings.GROQ_KEYS   = keys.groq.trim()
    if (keys.openai.trim()) settings.OPENAI_KEYS  = keys.openai.trim()
    if (keys.google.trim()) settings.GOOGLE_KEYS  = keys.google.trim()
    await new Promise(r => setTimeout(r, 600))
    setSaving(false)
    setStep('done')
    setTimeout(() => onComplete(settings), 1200)
  }

  const hasAnyKey = keys.groq.trim() || keys.openai.trim() || keys.google.trim()
  const provider = PROVIDERS.find(p => p.id === selectedProvider)!

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {step === 'welcome' && (
          <div className="onboarding-step">
            <div className="onboarding-logo">
              <Rocket size={40} />
            </div>
            <h1 className="onboarding-title">Welcome to Yogi Browser</h1>
            <p className="onboarding-subtitle">
              AI-powered sales automation by <span className="onboarding-brand">OpenHumana</span>
            </p>
            <div className="onboarding-features">
              <div className="onboarding-feature">
                <CheckCircle size={16} className="feature-check" />
                <span>Tell Yogi what to do — it handles the browser for you</span>
              </div>
              <div className="onboarding-feature">
                <CheckCircle size={16} className="feature-check" />
                <span>Human-in-the-loop approval before every action</span>
              </div>
              <div className="onboarding-feature">
                <CheckCircle size={16} className="feature-check" />
                <span>Run automated missions across LinkedIn, Reddit &amp; more</span>
              </div>
            </div>
            <p className="onboarding-note">
              Yogi needs an AI key to think. Setup takes 60 seconds — Groq is free.
            </p>
            <button className="onboarding-btn-primary" onClick={() => setStep('keys')}>
              Get Started <ChevronRight size={18} />
            </button>
          </div>
        )}

        {step === 'keys' && (
          <div className="onboarding-step">
            <Key size={28} className="onboarding-step-icon" />
            <h2 className="onboarding-title">Connect your AI</h2>
            <p className="onboarding-subtitle">Pick a provider and paste your API key</p>

            <div className="provider-tabs">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className={`provider-tab ${selectedProvider === p.id ? 'active' : ''}`}
                  style={selectedProvider === p.id ? { borderColor: p.color, color: p.color } : {}}
                  onClick={() => setSelectedProvider(p.id)}
                >
                  <p.icon size={14} />
                  {p.name}
                  {p.id === 'groq' && <span className="provider-badge">Free</span>}
                </button>
              ))}
            </div>

            <div className="provider-detail">
              <p className="provider-desc">{provider.description}</p>
              <a
                href={provider.getKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="provider-link"
                style={{ color: provider.color }}
              >
                Get a {provider.name} key <ExternalLink size={12} />
              </a>
            </div>

            <input
              className="onboarding-key-input"
              type="password"
              placeholder={provider.placeholder}
              value={keys[selectedProvider]}
              onChange={e => setKeys(k => ({ ...k, [selectedProvider]: e.target.value }))}
              autoFocus
            />

            <div className="onboarding-actions">
              <button
                className="onboarding-btn-secondary"
                onClick={() => onComplete({})}
              >
                Skip for now
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={handleSave}
                disabled={!hasAnyKey || saving}
              >
                {saving ? 'Saving...' : 'Save & Launch'}
                {!saving && <ChevronRight size={18} />}
              </button>
            </div>

            <p className="onboarding-privacy">
              Keys are stored locally on your machine — never sent to OpenHumana servers.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="onboarding-step onboarding-done">
            <div className="onboarding-success">
              <CheckCircle size={48} />
            </div>
            <h2 className="onboarding-title">You're all set!</h2>
            <p className="onboarding-subtitle">Launching Yogi Browser...</p>
          </div>
        )}
      </div>
    </div>
  )
}
