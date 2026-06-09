"use client"

import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"

import { useDeleteSecret, useSecretSandboxes } from "@/hooks/use-secrets"
import { ApiError } from "@/lib/api/client"
import { SECRET_EVENTS } from "@/lib/posthog/events"

interface DeleteSecretDialogProps {
  secretName: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: () => void
}

export function DeleteSecretDialog({
  secretName,
  open,
  onOpenChange,
  onDeleted,
}: DeleteSecretDialogProps) {
  const posthog = usePostHog()
  const mutation = useDeleteSecret()
  const { data: bindings } = useSecretSandboxes(open ? secretName : undefined)

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync(secretName)
      posthog.capture(SECRET_EVENTS.DELETED)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      // Errors are surfaced via toast by the hook; leave the dialog open.
      if (!(err instanceof ApiError)) throw err
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete secret</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-2 text-sm text-muted">
          <p>
            This deletes{" "}
            <span className="font-mono text-foreground">{secretName}</span>{" "}
            immediately. Requests that use it will be rejected.
          </p>
          {bindings && bindings.length > 0 ? (
            <p className="text-destructive">
              {bindings.length}{" "}
              {bindings.length === 1 ? "sandbox" : "sandboxes"} will lose access
              immediately.
            </p>
          ) : (
            <p>No sandboxes are currently using this secret.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
