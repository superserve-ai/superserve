"use client"

import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useMemo, useRef, useState } from "react"

import { useProviders } from "@/hooks/use-providers"
import { useCreateSecret } from "@/hooks/use-secrets"
import { ApiError } from "@/lib/api/client"
import type { ProviderShortcut } from "@/lib/api/types"
import { SECRET_EVENTS } from "@/lib/posthog/events"

import { MaskToggleInput } from "./mask-toggle-input"
import { ProviderPicker } from "./provider-picker"

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

function validateName(name: string): string | null {
  if (!name) return "Name is required"
  if (name.length > 128) return "Name must be 128 characters or fewer"
  if (!NAME_RE.test(name))
    return "Use letters, digits, '_' and '-'; start with a letter or underscore"
  return null
}

function validateValue(value: string): string | null {
  if (!value) return "Value is required"
  if (new TextEncoder().encode(value).length > 8 * 1024)
    return "Value exceeds 8 KB"
  return null
}

interface CreateSecretDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

export function CreateSecretDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: CreateSecretDialogProps = {}) {
  const posthog = usePostHog()
  const create = useCreateSecret()
  const {
    data: providers,
    isPending: providersPending,
    error: providersError,
    refetch: refetchProviders,
  } = useProviders()

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [provider, setProvider] = useState<ProviderShortcut | null>(null)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [errors, setErrors] = useState<{
    name?: string
    value?: string
    form?: string
  }>({})
  const suggestedName = useRef("")

  const reset = () => {
    setProvider(null)
    setName("")
    setValue("")
    setErrors({})
    suggestedName.current = ""
  }

  const handleSelectProvider = (p: ProviderShortcut) => {
    setProvider(p)
    if (!name || name === suggestedName.current) {
      suggestedName.current = `${p.name}_api_key`
      setName(suggestedName.current)
    }
  }

  const liveNameError = useMemo(() => validateName(name.trim()), [name])
  const liveValueError = useMemo(() => validateValue(value), [value])
  const isValid = !!provider && !liveNameError && !liveValueError

  const handleCreate = async () => {
    if (!provider) return
    const nameError = validateName(name.trim())
    const valueError = validateValue(value)
    if (nameError || valueError) {
      setErrors({
        name: nameError ?? undefined,
        value: valueError ?? undefined,
      })
      return
    }
    setErrors({})

    try {
      await create.mutateAsync({
        name: name.trim(),
        value,
        provider: provider.name,
      })
      posthog.capture(SECRET_EVENTS.CREATED, { provider: provider.name })
      setOpen(false)
      reset()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrors({ name: "A secret with this name already exists." })
          return
        }
        setErrors({ form: err.message })
        return
      }
      setErrors({ form: "Something went wrong. Try again." })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>Add secret</DialogTrigger>
      )}
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add secret</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 pb-4">
          <Field
            label="Provider"
            required
            description="The credential is encrypted at rest and only ever attached to requests for the provider's hosts."
          >
            {providersError ? (
              <div className="flex items-center gap-3 border border-dashed border-destructive p-3">
                <p className="flex-1 text-xs text-destructive">
                  Failed to load providers.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchProviders()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <ProviderPicker
                providers={providers}
                isPending={providersPending}
                value={provider?.name ?? null}
                onSelect={handleSelectProvider}
              />
            )}
            {provider && (
              <p className="mt-2 font-mono text-[10px] text-muted">
                Allowed hosts: {provider.hosts.join(", ")}
              </p>
            )}
          </Field>

          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. openai_api_key"
              error={
                errors.name ?? (name ? (liveNameError ?? undefined) : undefined)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </Field>

          <Field label="Value" required>
            <MaskToggleInput
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={provider?.token_shape ?? "Paste the credential"}
              error={
                errors.value ??
                (value ? (liveValueError ?? undefined) : undefined)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </Field>

          {errors.form && (
            <p className="border border-dashed border-destructive p-3 text-xs text-destructive">
              {errors.form}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create secret"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
