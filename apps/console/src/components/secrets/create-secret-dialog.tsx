"use client"

import {
  Button,
  Checkbox,
  cn,
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

import { AuthConfigForm } from "./auth-config-form"
import {
  buildCustomSecretPayload,
  customFormComplete,
  emptyCustomAuthForm,
  validateCustomAuthForm,
} from "./custom-auth"
import { HostInput } from "./host-input"
import { MaskToggleInput } from "./mask-toggle-input"
import { PerHostRuleEditor } from "./per-host-rule-editor"
import { ProviderPicker } from "./provider-picker"
import { validateSecretName, validateSecretValue } from "./validate"

type Method = "provider" | "custom"

const METHOD_OPTIONS: { value: Method; label: string }[] = [
  { value: "provider", label: "Provider" },
  { value: "custom", label: "Custom" },
]

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

  const [method, setMethod] = useState<Method>("provider")
  const [provider, setProvider] = useState<ProviderShortcut | null>(null)
  const [customForm, setCustomForm] = useState(emptyCustomAuthForm)
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [errors, setErrors] = useState<{
    name?: string
    value?: string
    form?: string
  }>({})
  const suggestedName = useRef("")

  const reset = () => {
    setMethod("provider")
    setProvider(null)
    setCustomForm(emptyCustomAuthForm())
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

  const liveNameError = useMemo(() => validateSecretName(name.trim()), [name])
  const liveValueError = useMemo(() => validateSecretValue(value), [value])
  const liveCustomError = useMemo(
    () => (method === "custom" ? validateCustomAuthForm(customForm) : null),
    [method, customForm],
  )
  const methodReady =
    method === "provider"
      ? !!provider
      : customFormComplete(customForm) && !liveCustomError
  const isValid = methodReady && !liveNameError && !liveValueError

  const handleCreate = async () => {
    if (!methodReady) return
    const nameError = validateSecretName(name.trim())
    const valueError = validateSecretValue(value)
    if (nameError || valueError) {
      setErrors({
        name: nameError ?? undefined,
        value: valueError ?? undefined,
      })
      return
    }
    setErrors({})

    try {
      if (method === "provider" && provider) {
        await create.mutateAsync({
          name: name.trim(),
          value,
          provider: provider.name,
        })
        posthog.capture(SECRET_EVENTS.CREATED, { provider: provider.name })
      } else {
        await create.mutateAsync(
          buildCustomSecretPayload(name, value, customForm),
        )
        posthog.capture(SECRET_EVENTS.CREATED, {
          auth_type: customForm.perHost ? "per_host" : customForm.single.type,
        })
      }
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

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleCreate()
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
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add secret</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 pb-4">
          <div className="flex border border-dashed border-border">
            {METHOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMethod(opt.value)}
                className={cn(
                  "flex-1 cursor-pointer py-2 font-mono text-xs uppercase transition-colors",
                  method === opt.value
                    ? "bg-foreground text-background"
                    : "text-muted hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {method === "provider" ? (
            <Field
              label="Provider"
              required
              description="The credential is stored encrypted and only ever used for requests to the provider's hosts."
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
          ) : (
            <>
              <label
                htmlFor="per-host-toggle"
                className="flex cursor-pointer items-center gap-2"
              >
                <Checkbox
                  id="per-host-toggle"
                  checked={customForm.perHost}
                  onCheckedChange={(checked) =>
                    setCustomForm({ ...customForm, perHost: checked === true })
                  }
                />
                <span className="text-sm text-foreground">Per-host rules</span>
                <span className="text-xs text-muted">
                  - different auth per upstream host
                </span>
              </label>

              {customForm.perHost ? (
                <PerHostRuleEditor
                  rules={customForm.rules}
                  onChange={(rules) => setCustomForm({ ...customForm, rules })}
                />
              ) : (
                <>
                  <AuthConfigForm
                    rule={customForm.single}
                    onChange={(single) =>
                      setCustomForm({ ...customForm, single })
                    }
                  />
                  <Field
                    label="Allowed hosts"
                    required
                    description="Hostnames the credential may be sent to. Wildcards like *.example.com are supported."
                  >
                    <HostInput
                      hosts={customForm.single.hosts}
                      onChange={(hosts) =>
                        setCustomForm({
                          ...customForm,
                          single: { ...customForm.single, hosts },
                        })
                      }
                    />
                  </Field>
                </>
              )}

              {liveCustomError && (
                <p className="border border-dashed border-destructive p-3 text-xs text-destructive">
                  {liveCustomError}
                </p>
              )}
            </>
          )}

          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. openai_api_key"
              error={
                errors.name ?? (name ? (liveNameError ?? undefined) : undefined)
              }
              onKeyDown={submitOnEnter}
            />
          </Field>

          <Field label="Value" required>
            <MaskToggleInput
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                method === "provider"
                  ? (provider?.token_shape ?? "Paste the credential")
                  : "Paste the credential"
              }
              error={
                errors.value ??
                (value ? (liveValueError ?? undefined) : undefined)
              }
              onKeyDown={submitOnEnter}
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
