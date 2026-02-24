export function formatTimestamp(ts: string, short = false): string {
  if (!ts) return ""
  try {
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return ts.slice(0, 16)
    if (short) {
      return (
        date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }) +
        " " +
        date.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      )
    }
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  } catch {
    return ts.slice(0, 16)
  }
}

export function formatRelativeTime(ts: string): string {
  if (!ts) return ""
  try {
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return ""
    const now = Date.now()
    const diffMs = now - date.getTime()
    if (diffMs < 0) return "Just now"
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return "Just now"
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 30) return `${diffDays}d ago`
    return formatTimestamp(ts, true)
  } catch {
    return ""
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = seconds / 60
  return `${minutes.toFixed(1)}m`
}

export function formatElapsed(seconds: number): string {
  const secs = Math.floor(seconds)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function formatSize(sizeBytes: number): string {
  if (sizeBytes >= 100 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${Math.round(sizeBytes / 1024)} KB`
}
