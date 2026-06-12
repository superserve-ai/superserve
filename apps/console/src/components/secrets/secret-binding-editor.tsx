"use client"

import { CaretDownIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, cn, Input } from "@superserve/ui"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useSecrets } from "@/hooks/use-secrets"

import { validateEnvKey } from "./validate"

export interface SecretBindingEntry {
  key: string
  secret: string
}

// Base UI Select doesn't open inside the dialog's focus trap, so this is a
// portalled, fixed-positioned picker like the template picker in
// create-sandbox-dialog.
function SecretPicker({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setMounted(true), [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const measure = () => {
      if (triggerRef.current)
        setRect(triggerRef.current.getBoundingClientRect())
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const panel =
    open && rect && mounted
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
              zIndex: 100,
            }}
            className="max-h-60 overflow-y-auto border border-dashed border-border bg-surface shadow-lg"
          >
            {options.map((name) => {
              const selected = name === value
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left font-mono text-xs transition-colors",
                    selected
                      ? "bg-brand/10 text-foreground"
                      : "text-foreground/80 hover:bg-surface-hover",
                  )}
                >
                  {name}
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between border border-input bg-background px-3 font-mono text-xs",
          "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
          value ? "text-foreground" : "text-muted",
        )}
      >
        <span className="truncate">{value || "Select secret"}</span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
          weight="light"
        />
      </button>
      {panel}
    </>
  )
}

export function SecretBindingEditor({
  entries,
  onChange,
}: {
  entries: SecretBindingEntry[]
  onChange: (entries: SecretBindingEntry[]) => void
}) {
  const { data: secrets } = useSecrets()
  const options = (secrets ?? []).map((s) => s.name)

  const setEntry = (i: number, entry: SecretBindingEntry) => {
    const updated = [...entries]
    updated[i] = entry
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Secrets</span>
        <Button
          variant="outline"
          size="sm"
          disabled={options.length === 0}
          onClick={() => onChange([...entries, { key: "", secret: "" }])}
        >
          <PlusIcon className="size-3.5" weight="light" />
          Add
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted">
          No secrets yet - create one on the Secrets page first.
        </p>
      ) : (
        entries.length > 0 && (
          <p className="text-xs text-muted">
            Your code reads the env var like a normal key - the real value is
            never exposed inside the sandbox.
          </p>
        )
      )}
      {entries.map((entry, i) => {
        const key = entry.key.trim()
        return (
          <div key={i} className="flex items-start gap-2">
            <Input
              placeholder="OPENAI_API_KEY"
              value={entry.key}
              wrapperClassName="flex-1"
              className="font-mono text-xs"
              error={key ? (validateEnvKey(key) ?? undefined) : undefined}
              onChange={(e) => setEntry(i, { ...entry, key: e.target.value })}
            />
            <div className="flex-1">
              <SecretPicker
                value={entry.secret}
                options={options}
                onChange={(secret) => setEntry(i, { ...entry, secret })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label="Remove secret binding"
              onClick={() => onChange(entries.filter((_, j) => j !== i))}
            >
              <TrashIcon className="size-3.5 text-muted" weight="light" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
