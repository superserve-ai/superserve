import type { BadgeVariant } from "@superserve/ui"
import type { SandboxStatus } from "@/lib/api/types"

export const STATUS_BADGE_VARIANT: Record<SandboxStatus, BadgeVariant> = {
  active: "success",
  pausing: "warning",
  idle: "muted",
  deleted: "destructive",
  failed: "destructive",
}

export const STATUS_LABEL: Record<SandboxStatus, string> = {
  active: "Active",
  pausing: "Pausing",
  idle: "Idle",
  deleted: "Deleted",
  failed: "Failed",
}

export const ACTIVITY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  success: "success",
  error: "destructive",
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
