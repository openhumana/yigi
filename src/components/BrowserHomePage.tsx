import React, { useState, useRef } from 'react'

interface BrowserHomePageProps {
  onNavigate: (url: string) => void
}

const QUICK_LINKS = [
  { label: 'DuckDuckGo', url: 'https://duckduckgo.com', icon: '🦆' },
  { label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '📖' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com', icon: '🔶' },
  { label: 'GitHub', url: 'https://github.com', icon: '🐙' },
]

export default function BrowserHomePage({ onNavigate }: BrowserHomePageProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    if (/^https?:\/\//.test(q) || /^[a-z0-9-]+(\.[a-z]{2,})/.test(q)) {
      onNavigate(q.startsWith('http') ? q : `https://${q}`)
    } else {
      onNavigate(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`)
    }
  }

  return (
    <div className="browser-home">
      <div className="browser-home-inner">
        <div className="browser-home-logo">
          <span className="browser-home-logo-text">Yogi</span>
          <span className="browser-home-logo-sub">Browser</span>
        </div>

        <form className="browser-home-search-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="browser-home-search"
            type="text"
            autoFocus
            placeholder="Search or enter a URL…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <div className="browser-home-links">
          {QUICK_LINKS.map((link) => (
            <button
              key={link.url}
              className="browser-home-link"
              onClick={() => onNavigate(link.url)}
            >
              <span className="browser-home-link-icon">{link.icon}</span>
              <span className="browser-home-link-label">{link.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
