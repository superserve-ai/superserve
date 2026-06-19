import {
  ClipboardTextIcon,
  CubeIcon,
  StackIcon,
  TerminalIcon,
  LockKeyIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Badge, HighlightedCode, Separator } from "@superserve/ui"
import Link from "next/link"

import { CodeBlock } from "@/components/code-block"
import type { ActivityResponse } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import {
  ACTIVITY_STATUS_VARIANT,
  formatBytes,
  formatDuration,
} from "@/lib/sandbox-utils"

const CATEGORY_META: Record<
  string,
  { icon: React.ElementType; label: string }
> = {
  sandbox: { icon: CubeIcon, label: "Sandbox" },
  template: { icon: StackIcon, label: "Template" },
  exec: { icon: TerminalIcon, label: "Exec" },
  secret: { icon: LockKeyIcon, label: "Secret" },
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// Renders a metadata value based on its shape rather than an assumed
// per-action schema, so each action naturally surfaces its own fields.
export function formatMetadataValue(
  key: string,
  value: unknown,
): React.ReactNode {
  if (key === "command" && typeof value === "string") {
    return <CodeBlock command={value} />
  }
  if (value !== null && typeof value === "object") {
    return (
      <div className="border border-dashed border-border bg-background px-3 py-2">
        <HighlightedCode lang="typescript" code={safeJson(value)} />
      </div>
    )
  }
  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "success" : "muted"} dot>
        {String(value)}
      </Badge>
    )
  }
  if (typeof value === "number" && /(_ms$|duration)/i.test(key)) {
    return (
      <span className="font-mono tabular-nums">{formatDuration(value)}</span>
    )
  }
  if (typeof value === "number" && /(bytes|size)/i.test(key)) {
    return <span className="font-mono tabular-nums">{formatBytes(value)}</span>
  }
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    return (
      <span className="tabular-nums">
        {formatTime(new Date(value)).absolute}
      </span>
    )
  }
  if (value === null || value === undefined) {
    return <span className="text-muted">—</span>
  }
  return <span className="font-mono break-all">{String(value)}</span>
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="pt-0.5 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground/80">{children}</dd>
    </>
  )
}

export function ActivityDetail({ log }: { log: ActivityResponse }) {
  const meta = CATEGORY_META[log.category]
  const Icon = meta?.icon ?? ClipboardTextIcon
  const metadataEntries = Object.entries(log.metadata ?? {})
  const hasMetadata = metadataEntries.length > 0

  return (
    <div className="border-b border-border bg-surface/30 px-4 py-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-3.5 text-muted" weight="light" />
        <span className="font-mono text-xs text-muted uppercase">
          {meta?.label ?? log.category} &middot; {log.action}
        </span>
      </div>

      <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3">
        <Field label="Time">
          <span className="tabular-nums">
            {formatTime(new Date(log.created_at)).absolute}
          </span>
        </Field>
        {log.secret_name ? (
          <Field label="Secret">
            {log.secret_id ? (
              <Link
                href={`/secrets/${log.secret_name}`}
                className="font-mono underline-offset-2 hover:underline"
              >
                {log.secret_name}
              </Link>
            ) : (
              <span className="font-mono">
                {log.secret_name} <span className="text-muted">(deleted)</span>
              </span>
            )}
          </Field>
        ) : (
          <>
            <Field label="Sandbox">
              <span className="font-mono">{log.sandbox_name ?? "—"}</span>
            </Field>
            <Field label="Sandbox ID">
              <span className="font-mono break-all text-foreground/70">
                {log.sandbox_id ?? "—"}
              </span>
            </Field>
          </>
        )}
        <Field label="Action">
          <span className="font-mono">{log.action}</span>
        </Field>
        <Field label="Duration">
          <span className="font-mono tabular-nums">
            {formatDuration(log.duration_ms)}
          </span>
        </Field>
        <Field label="Status">
          {log.status ? (
            <Badge variant={ACTIVITY_STATUS_VARIANT[log.status] ?? "muted"} dot>
              {log.status}
            </Badge>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Field>
      </dl>

      {log.error && (
        <div className="mt-4 flex items-start gap-2 border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2">
          <WarningIcon
            className="mt-0.5 size-3.5 shrink-0 text-destructive"
            weight="light"
          />
          <p className="font-mono text-xs leading-relaxed break-all text-destructive">
            {log.error}
          </p>
        </div>
      )}

      {hasMetadata && (
        <>
          <Separator className="my-4" />
          <p className="mb-3 font-mono text-xs text-muted uppercase">
            Metadata
          </p>
          <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3">
            {metadataEntries.map(([key, value]) => (
              <Field key={key} label={prettifyKey(key)}>
                {formatMetadataValue(key, value)}
              </Field>
            ))}
          </dl>
        </>
      )}
    </div>
  )
}
