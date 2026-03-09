export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function relativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function agentStatusBadge(depsStatus: string): {
  label: string
  variant: "success" | "warning" | "destructive" | "muted"
} {
  switch (depsStatus) {
    case "ready":
      return { label: "Ready", variant: "success" }
    case "building":
    case "pending":
    case "installing":
      return {
        label: depsStatus.charAt(0).toUpperCase() + depsStatus.slice(1),
        variant: "warning",
      }
    case "failed":
    case "error":
      return { label: "Failed", variant: "destructive" }
    default:
      return { label: depsStatus || "Unknown", variant: "muted" }
  }
}

export function groupByTime<T extends { updatedAt: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  )
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 86400000)

  const groups: Record<string, T[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  }

  for (const item of items) {
    const date = new Date(item.updatedAt)
    if (date >= startOfToday) groups.Today.push(item)
    else if (date >= startOfYesterday) groups.Yesterday.push(item)
    else if (date >= startOfWeek) groups["Previous 7 days"].push(item)
    else groups.Older.push(item)
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}
