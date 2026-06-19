"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, cn, Field, Input } from "@superserve/ui"

import type { AuthRuleForm, SingleAuthType } from "./custom-auth"
import { MAX_CUSTOM_HEADERS } from "./custom-auth"
import { validateHeaderName } from "./validate"

const TYPE_OPTIONS: { value: SingleAuthType; label: string }[] = [
  { value: "bearer", label: "Bearer" },
  { value: "basic", label: "Basic" },
  { value: "api-key", label: "API key" },
  { value: "custom", label: "Headers" },
]

export function AuthConfigForm({
  rule,
  onChange,
}: {
  rule: AuthRuleForm
  onChange: (rule: AuthRuleForm) => void
}) {
  const set = (patch: Partial<AuthRuleForm>) => onChange({ ...rule, ...patch })

  return (
    <div className="space-y-4">
      <Field label="Auth type">
        <div className="flex border border-dashed border-border">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set({ type: opt.value })}
              className={cn(
                "flex-1 cursor-pointer py-2 font-mono text-xs uppercase transition-colors",
                rule.type === opt.value
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {rule.type === "bearer" && (
        <p className="font-mono text-[10px] text-muted">
          Authorization: Bearer &lt;value&gt;
        </p>
      )}

      {rule.type === "basic" && (
        <Field
          label="Username"
          description="Optional. The credential becomes the Basic-auth password."
        >
          <Input
            value={rule.username}
            onChange={(e) => set({ username: e.target.value })}
            placeholder="x-access-token"
            error={
              /[:\r\n]/.test(rule.username) ? "May not contain ':'" : undefined
            }
          />
        </Field>
      )}

      {rule.type === "api-key" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Header" required>
            <Input
              value={rule.header}
              onChange={(e) => set({ header: e.target.value })}
              placeholder="x-api-key"
              error={
                rule.header.trim() && validateHeaderName(rule.header.trim())
                  ? "Not a valid header name"
                  : undefined
              }
            />
          </Field>
          <Field label="Prefix" description="Prepended verbatim to the value.">
            <Input
              value={rule.prefix}
              onChange={(e) => set({ prefix: e.target.value })}
              placeholder="Bearer "
            />
          </Field>
        </div>
      )}

      {rule.type === "custom" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Headers</span>
            {rule.headers.length < MAX_CUSTOM_HEADERS && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  set({ headers: [...rule.headers, { name: "", value: "" }] })
                }
              >
                <PlusIcon className="size-3.5" weight="light" />
                Add
              </Button>
            )}
          </div>
          {rule.headers.map((entry, i) => {
            const name = entry.name.trim()
            const nameError =
              name && validateHeaderName(name)
                ? "Not a valid header name"
                : undefined
            const valueError =
              entry.value && !entry.value.includes("{{ value }}")
                ? "Must reference {{ value }}"
                : undefined
            return (
              <div key={i} className="flex items-start gap-2">
                <Input
                  placeholder="X-Auth-Token"
                  value={entry.name}
                  wrapperClassName="flex-1"
                  error={nameError}
                  onChange={(e) => {
                    const updated = [...rule.headers]
                    updated[i] = { ...entry, name: e.target.value }
                    set({ headers: updated })
                  }}
                />
                <Input
                  placeholder="Token {{ value }}"
                  value={entry.value}
                  wrapperClassName="flex-1"
                  error={valueError}
                  onChange={(e) => {
                    const updated = [...rule.headers]
                    updated[i] = { ...entry, value: e.target.value }
                    set({ headers: updated })
                  }}
                />
                {rule.headers.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-1.5 shrink-0"
                    aria-label="Remove header"
                    onClick={() =>
                      set({ headers: rule.headers.filter((_, j) => j !== i) })
                    }
                  >
                    <TrashIcon className="size-3.5 text-muted" weight="light" />
                  </Button>
                )}
              </div>
            )
          })}
          <p className="text-xs text-muted">
            {"{{ value }}"} is replaced with your credential when the request is
            sent.
          </p>
        </div>
      )}
    </div>
  )
}
