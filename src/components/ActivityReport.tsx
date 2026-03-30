import React, { useState, useCallback, useMemo } from 'react'
import { FileText, MessageSquare, Copy, Check, Trash2, Download, ExternalLink, ChevronDown, ChevronUp, X, Calendar } from 'lucide-react'

export interface ActivityEntry {
  id: string
  type: 'post' | 'comment' | 'reply'
  subreddit: string
  url: string
  title?: string
  contentPreview: string
  timestamp: number
  sessionId: string
}

interface ActivityReportProps {
  entries: ActivityEntry[]
  sessionId: string
  onClear: () => void
  onClose: () => void
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function isSameDay(ts: number, now: Date): boolean {
  const d = new Date(ts)
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

function groupBySubreddit(entries: ActivityEntry[]): Record<string, ActivityEntry[]> {
  return entries.reduce((acc, entry) => {
    const key = entry.subreddit || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(entry)
    return acc
  }, {} as Record<string, ActivityEntry[]>)
}

function generateReportText(entries: ActivityEntry[], scope: 'session' | 'today' | 'all', sessionId?: string): string {
  if (entries.length === 0) return 'No activity recorded yet.'

  const now = new Date()
  let scopedEntries = entries
  if (scope === 'session' && sessionId) {
    scopedEntries = entries.filter(e => e.sessionId === sessionId)
  } else if (scope === 'today') {
    scopedEntries = entries.filter(e => isSameDay(e.timestamp, now))
  }

  if (scopedEntries.length === 0) return scope === 'session' ? 'No activity this session yet.' : 'No activity recorded for today yet.'

  const date = formatDate(now.getTime())
  const posts = scopedEntries.filter(e => e.type === 'post')
  const comments = scopedEntries.filter(e => e.type === 'comment' || e.type === 'reply')
  const grouped = groupBySubreddit(scopedEntries)
  const subreddits = Object.keys(grouped)

  const lines: string[] = [
    scope === 'session' ? `Session Activity — ${date}` : scope === 'today' ? `Today's Activity — ${date}` : `Full Activity Log — ${date}`,
    `═══════════════════════════════════════`,
    `Summary: ${posts.length} post${posts.length !== 1 ? 's' : ''} published, ${comments.length} comment${comments.length !== 1 ? 's' : ''} left across ${subreddits.map(s => `r/${s}`).join(', ')}`,
    ``,
  ]

  for (const subreddit of subreddits) {
    const srEntries = grouped[subreddit]
    lines.push(`── r/${subreddit} (${srEntries.length} action${srEntries.length !== 1 ? 's' : ''}) ──`)
    for (const entry of srEntries) {
      const label = entry.type === 'post' ? 'POST' : 'COMMENT'
      const title = entry.title ? `"${entry.title}"` : `"${entry.contentPreview}"`
      lines.push(`  ${label}: ${title}`)
      if (entry.url) lines.push(`         ${entry.url}`)
    }
    lines.push(``)
  }

  if (posts.length > 0) {
    lines.push(`Top Posts:`)
    posts.slice(0, 5).forEach(p => {
      lines.push(`  • ${p.title || p.contentPreview} in r/${p.subreddit}`)
      if (p.url) lines.push(`    ${p.url}`)
    })
  }

  return lines.join('\n')
}

const ActivityReport: React.FC<ActivityReportProps> = ({ entries, sessionId, onClear, onClose }) => {
  const [showReport, setShowReport] = useState(false)
  const [copied, setCopied] = useState(false)
  const [collapsedSubreddits, setCollapsedSubreddits] = useState<Set<string>>(new Set())
  const [viewScope, setViewScope] = useState<'session' | 'today' | 'all'>('session')
  const [reportScope, setReportScope] = useState<'session' | 'today' | 'all'>('session')

  const now = useMemo(() => new Date(), [])

  const scopedEntries = useMemo(() => {
    if (viewScope === 'session') return entries.filter(e => e.sessionId === sessionId)
    if (viewScope === 'today') return entries.filter(e => isSameDay(e.timestamp, now))
    return entries
  }, [entries, viewScope, sessionId, now])

  const grouped = groupBySubreddit(scopedEntries)
  const subreddits = Object.keys(grouped)
  const posts = scopedEntries.filter(e => e.type === 'post')
  const comments = scopedEntries.filter(e => e.type === 'comment' || e.type === 'reply')

  const toggleSubreddit = (sr: string) => {
    setCollapsedSubreddits(prev => {
      const next = new Set(prev)
      if (next.has(sr)) next.delete(sr)
      else next.add(sr)
      return next
    })
  }

  const reportText = useMemo(() => generateReportText(entries, reportScope, sessionId), [entries, reportScope, sessionId])

  const handleCopyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(reportText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = reportText
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [reportText])

  const handleExport = useCallback(() => {
    const blob = new Blob([reportText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `yogi-activity-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [reportText])

  const openUrl = (url: string) => {
    if ((window as any).yogi?.browserNavigate) {
      (window as any).yogi.browserNavigate(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="activity-panel">
      <div className="activity-panel-header">
        <div className="activity-panel-title">
          <FileText size={14} />
          <span>Activity Log</span>
          {entries.length > 0 && (
            <span className="activity-count-badge">{entries.length}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="activity-icon-btn" title="Export log" onClick={handleExport} disabled={entries.length === 0}>
            <Download size={13} />
          </button>
          <button className="activity-icon-btn danger" title="Clear log" onClick={onClear} disabled={entries.length === 0}>
            <Trash2 size={13} />
          </button>
          <button className="activity-icon-btn" title="Close" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="activity-empty">
          <MessageSquare size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
            No activity yet. Run a mission to start logging posts and comments.
          </div>
        </div>
      ) : (
        <>
          <div className="activity-scope-tabs">
            <button
              className={`activity-scope-tab ${viewScope === 'session' ? 'active' : ''}`}
              onClick={() => setViewScope('session')}
            >
              This Session
            </button>
            <button
              className={`activity-scope-tab ${viewScope === 'today' ? 'active' : ''}`}
              onClick={() => setViewScope('today')}
            >
              <Calendar size={11} />
              Today
            </button>
            <button
              className={`activity-scope-tab ${viewScope === 'all' ? 'active' : ''}`}
              onClick={() => setViewScope('all')}
            >
              All ({entries.length})
            </button>
          </div>

          <div className="activity-summary-bar">
            <span className="activity-stat">
              <FileText size={11} />
              {posts.length} post{posts.length !== 1 ? 's' : ''}
            </span>
            <span className="activity-stat">
              <MessageSquare size={11} />
              {comments.length} comment{comments.length !== 1 ? 's' : ''}
            </span>
            <span className="activity-stat" style={{ color: 'var(--text-dim)', fontSize: 10 }}>
              {subreddits.length} subreddit{subreddits.length !== 1 ? 's' : ''}
            </span>
          </div>

          {scopedEntries.length === 0 ? (
            <div className="activity-empty" style={{ flex: 'unset', padding: '20px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
                {viewScope === 'session' ? 'No activity this session yet.' : viewScope === 'today' ? 'No activity today yet.' : 'No activity recorded.'}
              </div>
            </div>
          ) : (
            <div className="activity-entries">
              {subreddits.map(sr => (
                <div key={sr} className="activity-subreddit-group">
                  <button
                    className="activity-subreddit-header"
                    onClick={() => toggleSubreddit(sr)}
                  >
                    <span className="subreddit-badge">r/{sr}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      {grouped[sr].length}
                    </span>
                    {collapsedSubreddits.has(sr) ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>

                  {!collapsedSubreddits.has(sr) && (
                    <div className="activity-subreddit-entries">
                      {grouped[sr].map(entry => (
                        <div key={entry.id} className="activity-entry">
                          <div className="activity-entry-icon">
                            {entry.type === 'post' ? <FileText size={12} /> : <MessageSquare size={12} />}
                          </div>
                          <div className="activity-entry-body">
                            <div className="activity-entry-title">
                              {entry.title || entry.contentPreview}
                            </div>
                            <div className="activity-entry-meta">
                              <span className={`activity-type-badge ${entry.type}`}>{entry.type}</span>
                              <span>{formatTimestamp(entry.timestamp)}</span>
                            </div>
                          </div>
                          {entry.url && (
                            <button
                              className="activity-entry-link"
                              title="Open in browser"
                              onClick={() => openUrl(entry.url)}
                            >
                              <ExternalLink size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="activity-report-section">
            <div style={{ display: 'flex', gap: 6, marginBottom: showReport ? 8 : 0, alignItems: 'center' }}>
              <button
                className="activity-generate-btn"
                onClick={() => setShowReport(v => !v)}
                style={{ flex: 1 }}
              >
                <FileText size={13} />
                {showReport ? 'Hide Report' : 'Generate Report'}
                {showReport ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showReport && (
              <div className="activity-report-box">
                <div className="activity-scope-tabs" style={{ marginBottom: 8 }}>
                  <button
                    className={`activity-scope-tab ${reportScope === 'session' ? 'active' : ''}`}
                    onClick={() => setReportScope('session')}
                  >
                    This Session
                  </button>
                  <button
                    className={`activity-scope-tab ${reportScope === 'today' ? 'active' : ''}`}
                    onClick={() => setReportScope('today')}
                  >
                    <Calendar size={11} />
                    Today
                  </button>
                  <button
                    className={`activity-scope-tab ${reportScope === 'all' ? 'active' : ''}`}
                    onClick={() => setReportScope('all')}
                  >
                    All Time
                  </button>
                </div>
                <pre className="activity-report-text">{reportText}</pre>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="activity-copy-btn" onClick={handleCopyReport}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                  <button className="activity-copy-btn" onClick={handleExport} style={{ background: 'rgba(82,134,255,0.1)', borderColor: 'rgba(82,134,255,0.3)', color: 'var(--primary)' }}>
                    <Download size={13} />
                    Export
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ActivityReport
