"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, Input } from "@superserve/ui"

import { MAX_HOSTS } from "./custom-auth"
import { validateHost } from "./validate"

export function HostInput({
  hosts,
  onChange,
}: {
  hosts: string[]
  onChange: (hosts: string[]) => void
}) {
  return (
    <div className="space-y-2">
      {hosts.map((host, i) => {
        const trimmed = host.trim()
        return (
          <div key={i} className="flex items-start gap-2">
            <Input
              placeholder="api.example.com"
              value={host}
              wrapperClassName="flex-1"
              error={trimmed ? (validateHost(trimmed) ?? undefined) : undefined}
              onChange={(e) => {
                const updated = [...hosts]
                updated[i] = e.target.value
                onChange(updated)
              }}
            />
            {hosts.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="mt-1.5 shrink-0"
                aria-label="Remove host"
                onClick={() => onChange(hosts.filter((_, j) => j !== i))}
              >
                <TrashIcon className="size-3.5 text-muted" weight="light" />
              </Button>
            )}
          </div>
        )
      })}
      {hosts.length < MAX_HOSTS && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...hosts, ""])}
        >
          <PlusIcon className="size-3.5" weight="light" />
          Add host
        </Button>
      )}
    </div>
  )
}
