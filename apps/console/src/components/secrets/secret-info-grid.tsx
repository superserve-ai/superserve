import type { SecretResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"

export function SecretInfoGrid({
  secret,
  providerDisplay,
}: {
  secret: SecretResponse
  providerDisplay?: string
}) {
  const created = formatTime(new Date(secret.created_at))
  const updated = formatTime(new Date(secret.updated_at))
  const lastUsed = secret.last_used_at
    ? formatTime(new Date(secret.last_used_at))
    : null

  return (
    <div className="border-b border-border">
      <div className="grid grid-cols-4">
        <div className="border-r border-border px-4 py-4">
          <p className="text-xs text-muted">Provider</p>
          <p className="mt-2 text-sm text-foreground/80">
            {providerDisplay ?? secret.provider_shortcut ?? "Custom"}
          </p>
        </div>
        <div
          className="border-r border-border px-4 py-4"
          title={created.absolute}
        >
          <p className="text-xs text-muted">Created</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {created.relative}
          </p>
        </div>
        <div
          className="border-r border-border px-4 py-4"
          title={updated.absolute}
        >
          <p className="text-xs text-muted">Last rotated</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {updated.relative}
          </p>
        </div>
        <div className="px-4 py-4" title={lastUsed?.absolute}>
          <p className="text-xs text-muted">Last used</p>
          <p className="mt-2 text-sm text-foreground/80 tabular-nums">
            {lastUsed ? lastUsed.relative : "Never"}
          </p>
        </div>
      </div>
    </div>
  )
}
