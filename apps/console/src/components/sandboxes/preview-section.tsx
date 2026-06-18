"use client"

import {
  ArrowSquareOutIcon,
  BrowserIcon,
  CaretRightIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button, cn, Input, useToast } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { EmptyState } from "@/components/empty-state"
import {
  MAX_PREVIEW_PORT,
  MIN_PREVIEW_PORT,
  usePreviewPorts,
} from "@/hooks/use-preview-ports"
import type { SandboxResponse } from "@/lib/api/types"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

const SANDBOX_HOST =
  process.env.NEXT_PUBLIC_SANDBOX_HOST ?? "sandbox.superserve.ai"

const DEFAULT_PORT_SUGGESTION = "3000"

function previewUrl(sandboxId: string, port: number): string {
  return `https://${port}-${sandboxId}.${SANDBOX_HOST}`
}

interface PreviewSectionProps {
  sandbox: SandboxResponse
  onStart?: () => void
}

export function PreviewSection({ sandbox, onStart }: PreviewSectionProps) {
  const isActive = sandbox.status === "active"

  return (
    <section className="border-b border-border">
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Preview</h2>
      </div>
      {isActive ? (
        <PreviewPorts sandbox={sandbox} />
      ) : (
        <EmptyState
          icon={BrowserIcon}
          title="No preview available"
          description="Start the sandbox to preview a running service on a port."
          actionLabel={
            sandbox.status === "paused" ? "Start sandbox" : undefined
          }
          onAction={sandbox.status === "paused" ? onStart : undefined}
        />
      )}
    </section>
  )
}

function PreviewPorts({ sandbox }: { sandbox: SandboxResponse }) {
  const { addToast } = useToast()
  const { ports, canAddPort, addPort, removePort } = usePreviewPorts(sandbox.id)
  const [draft, setDraft] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  const handleAdd = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    const port = Number(trimmed)
    const result = addPort(port)
    if (!result.ok) {
      addToast(result.error ?? "Could not add port", "error")
      return
    }
    setDraft("")
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_PREVIEW_PORT}
          max={MAX_PREVIEW_PORT}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={DEFAULT_PORT_SUGGESTION}
          aria-label="Port to preview"
          className="w-40 font-mono text-xs"
          disabled={!canAddPort}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!canAddPort || draft.trim() === ""}
        >
          <PlusIcon className="size-3.5" weight="light" />
          Add port
        </Button>
      </form>

      {ports.length === 0 ? (
        <p className="font-mono text-xs text-muted">
          Add the port your dev server runs on (e.g. {DEFAULT_PORT_SUGGESTION}).
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ports.map((port) => (
            <PortRow
              key={port}
              sandboxId={sandbox.id}
              port={port}
              isExpanded={expanded === port}
              onToggle={() =>
                setExpanded((current) => (current === port ? null : port))
              }
              onRemove={() => {
                removePort(port)
                setExpanded((current) => (current === port ? null : current))
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface PortRowProps {
  sandboxId: string
  port: number
  isExpanded: boolean
  onToggle: () => void
  onRemove: () => void
}

function PortRow({
  sandboxId,
  port,
  isExpanded,
  onToggle,
  onRemove,
}: PortRowProps) {
  const { addToast } = useToast()
  const posthog = usePostHog()
  const url = previewUrl(sandboxId, port)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      addToast("Preview URL copied", "success")
    } catch {
      addToast("Couldn't copy to clipboard", "error")
    }
  }

  const handleOpen = () => {
    posthog.capture(SANDBOX_EVENTS.PREVIEW_OPENED, {
      sandbox_id: sandboxId,
      port,
    })
  }

  return (
    <li className="border border-dashed border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse preview" : "Expand preview"}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
        >
          <CaretRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted transition-transform",
              isExpanded && "rotate-90",
            )}
            weight="light"
          />
          <span className="shrink-0 font-mono text-xs text-foreground tabular-nums">
            :{port}
          </span>
          <span className="truncate font-mono text-xs text-muted">{url}</span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Copy preview URL" onClick={handleCopy}>
            <CopyIcon className="size-3.5" weight="light" />
          </IconButton>
          <IconButton
            label="Open preview in new tab"
            render="anchor"
            href={url}
            onOpen={handleOpen}
          >
            <ArrowSquareOutIcon className="size-3.5" weight="light" />
          </IconButton>
          <IconButton label={`Remove port ${port}`} onClick={onRemove}>
            <TrashIcon className="size-3.5" weight="light" />
          </IconButton>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-dashed border-border p-3">
          <div className="relative border border-dashed border-border bg-surface">
            <CornerBrackets size="sm" />
            {/* Only the expanded row mounts an iframe, so we never spin up N
                heavy frames at once. No `sandbox` attribute: the framed app is
                the user's own dev server on a cross-origin, unguessable
                subdomain, so the embed should behave exactly like opening the
                URL in a new tab (same-origin storage, scripts, forms all work).
                Some apps send X-Frame-Options / CSP frame-ancestors and won't
                embed at all — "Open in new tab" above is the escape hatch (XFO
                blocks can't be reliably detected here). */}
            {/* oxlint-disable-next-line react/iframe-missing-sandbox -- intentional: faithful preview of the user's own cross-origin dev server */}
            <iframe
              src={url}
              title={`Preview of port ${port}`}
              className="h-[420px] w-full"
            />
          </div>
        </div>
      )}
    </li>
  )
}

type IconButtonProps = {
  label: string
  children: React.ReactNode
} & (
  | { render?: "button"; onClick: () => void }
  | { render: "anchor"; href: string; onOpen: () => void }
)

function IconButton(props: IconButtonProps) {
  const className =
    "flex size-7 cursor-pointer items-center justify-center text-muted transition-colors hover:bg-foreground/8 hover:text-foreground"

  if (props.render === "anchor") {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={props.label}
        title={props.label}
        onClick={props.onOpen}
        className={className}
      >
        {props.children}
      </a>
    )
  }

  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={className}
    >
      {props.children}
    </button>
  )
}
