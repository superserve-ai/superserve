"use client"

import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Field,
  useToast,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { useUpdateSecretValue } from "@/hooks/use-secrets"
import { ApiError } from "@/lib/api/client"
import { SECRET_EVENTS } from "@/lib/posthog/events"

import { MaskToggleInput } from "./mask-toggle-input"
import { validateSecretValue } from "./validate"

interface RotateSecretDialogProps {
  secretName: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function RotateSecretDialog({
  secretName,
  open,
  onOpenChange,
}: RotateSecretDialogProps) {
  const posthog = usePostHog()
  const { addToast } = useToast()
  const mutation = useUpdateSecretValue(secretName)

  const [value, setValue] = useState("")
  const [error, setError] = useState<string | undefined>()

  const reset = () => {
    setValue("")
    setError(undefined)
  }

  const liveError = value
    ? (validateSecretValue(value) ?? undefined)
    : undefined

  const handleRotate = async () => {
    const valueError = validateSecretValue(value)
    if (valueError) {
      setError(valueError)
      return
    }
    setError(undefined)

    try {
      await mutation.mutateAsync({ value })
      posthog.capture(SECRET_EVENTS.ROTATED)
      addToast("Secret value rotated", "success")
      onOpenChange(false)
      reset()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        return
      }
      setError("Something went wrong. Try again.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rotate value</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <p className="text-sm text-muted">
            Replace the value of{" "}
            <span className="font-mono text-foreground">{secretName}</span>.
            Running sandboxes pick up the new value within seconds.
          </p>
          <Field label="New value" required>
            <MaskToggleInput
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the new credential"
              error={error ?? liveError}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleRotate()
                }
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRotate}
            disabled={!value || !!liveError || mutation.isPending}
          >
            {mutation.isPending ? "Rotating…" : "Rotate value"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
