"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import {
  Badge,
  Button,
  Input,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@superserve/ui"
import Link from "next/link"
import { useState } from "react"

import {
  useAttachSandboxSecret,
  useDetachSandboxSecret,
} from "@/hooks/use-sandboxes"
import { useSecrets } from "@/hooks/use-secrets"
import type { SandboxSecretBindingSummary } from "@/lib/api/types"

import { SecretPicker } from "./secret-binding-editor"
import { validateEnvKey } from "./validate"

export function SecretBindingList({
  sandboxId,
  secrets,
  editable,
}: {
  sandboxId: string
  secrets: SandboxSecretBindingSummary[] | undefined
  editable: boolean
}) {
  const attach = useAttachSandboxSecret(sandboxId)
  const detach = useDetachSandboxSecret(sandboxId)
  const { data: available } = useSecrets()

  const [adding, setAdding] = useState(false)
  const [envKey, setEnvKey] = useState("")
  const [secretName, setSecretName] = useState("")

  const boundKeys = new Set((secrets ?? []).map((b) => b.env_key))
  const options = (available ?? []).map((s) => s.name)
  const trimmedKey = envKey.trim()
  const keyError = trimmedKey ? validateEnvKey(trimmedKey) : null
  const duplicate = boundKeys.has(trimmedKey)
  const canSubmit =
    !!trimmedKey && !keyError && !duplicate && !!secretName && !attach.isPending

  function reset() {
    setEnvKey("")
    setSecretName("")
    setAdding(false)
  }

  function submit() {
    attach.mutate({ envKey: trimmedKey, secretName }, { onSuccess: reset })
  }

  return (
    <div className="border-b border-border">
      <div className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Secrets</h2>
        {editable && !adding && options.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon className="size-3.5" weight="light" />
            Attach
          </Button>
        )}
      </div>

      {!secrets || secrets.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted">
          No secrets attached to this sandbox.
        </p>
      ) : (
        <div className="space-y-2 px-4 py-3">
          {secrets.map((binding) => (
            <div
              key={binding.env_key}
              className="flex items-center gap-3 font-mono text-xs"
            >
              <span className="text-foreground/80">{binding.env_key}</span>
              <span className="text-muted">←</span>
              <Link
                href={`/secrets/${binding.secret_name}`}
                className="text-foreground/80 underline-offset-2 hover:underline"
              >
                {binding.secret_name}
              </Link>
              {binding.revoked && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge variant="destructive" className="cursor-default" />
                    }
                  >
                    Revoked
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-xs text-xs">
                    This secret was deleted - requests using it are rejected.
                  </TooltipPopup>
                </Tooltip>
              )}
              {editable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto shrink-0"
                  aria-label={`Detach ${binding.env_key}`}
                  disabled={detach.isPending}
                  onClick={() => detach.mutate(binding.env_key)}
                >
                  <TrashIcon className="size-3.5 text-muted" weight="light" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && adding && (
        <form
          className="space-y-2 border-t border-border px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) submit()
          }}
        >
          <div className="flex items-start gap-2">
            <Input
              placeholder="OPENAI_API_KEY"
              value={envKey}
              wrapperClassName="flex-1"
              className="font-mono text-xs"
              error={
                keyError ??
                (duplicate ? "Already bound on this sandbox" : undefined)
              }
              onChange={(e) => setEnvKey(e.target.value)}
            />
            <div className="flex-1">
              <SecretPicker
                value={secretName}
                options={options}
                onChange={setSecretName}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Applies to processes started after attaching; a paused sandbox
            applies it on resume.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              Attach
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
