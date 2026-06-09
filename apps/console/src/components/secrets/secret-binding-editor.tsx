"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import {
  Button,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"

import { useSecrets } from "@/hooks/use-secrets"

import { validateEnvKey } from "./validate"

export interface SecretBindingEntry {
  key: string
  secret: string
}

/** Derive an env var name from a secret name ("my-openai-key" → "MY_OPENAI_KEY"). */
function suggestEnvKey(secretName: string): string {
  return secretName.toUpperCase().replaceAll("-", "_")
}

export function SecretBindingEditor({
  entries,
  onChange,
}: {
  entries: SecretBindingEntry[]
  onChange: (entries: SecretBindingEntry[]) => void
}) {
  const { data: secrets } = useSecrets()
  const options = secrets ?? []

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
          onClick={() =>
            onChange([
              ...entries,
              { key: suggestEnvKey(options[0].name), secret: options[0].name },
            ])
          }
        >
          <PlusIcon className="size-3.5" weight="light" />
          Add
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted">
          No secrets yet — create one on the Secrets page first.
        </p>
      ) : (
        entries.length > 0 && (
          <p className="text-xs text-muted">
            The env var holds a sandbox-scoped proxy token; the real value is
            injected at egress and never enters the sandbox.
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
              <Select
                value={entry.secret}
                onValueChange={(secret) =>
                  setEntry(i, {
                    key: entry.key.trim()
                      ? entry.key
                      : suggestEnvKey(String(secret)),
                    secret: String(secret),
                  })
                }
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {options.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
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
