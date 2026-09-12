"use client"

import { WarningIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  Field,
  Input,
  Spinner,
} from "@superserve/ui"
import { useState } from "react"

interface DeleteTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  onConfirm: () => void | Promise<void>
}

/** Retention window quoted to the user; the backend owns the real value. */
export const QM_RETENTION_DAYS = 7

export function DeleteTenantDialog({
  open,
  onOpenChange,
  slug,
  onConfirm,
}: DeleteTenantDialogProps) {
  const [input, setInput] = useState("")
  const [isPending, setIsPending] = useState(false)
  const isMatch = input === slug

  const handleConfirm = async () => {
    if (!isMatch || isPending) return
    setIsPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // The mutation hook toasts failures; keep the dialog open to retry.
    } finally {
      setIsPending(false)
      setInput("")
    }
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) setInput("")
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-destructive/10">
              <WarningIcon
                className="h-5 w-5 text-destructive"
                weight="light"
              />
            </div>
            <div className="flex-1">
              <DialogTitle>Delete QM stack</DialogTitle>
              <DialogDescription className="mt-2">
                <span className="font-mono text-foreground/80">{slug}</span>{" "}
                goes offline immediately and everyone is signed out. Its data is
                kept for {QM_RETENTION_DAYS} days in case you need it restored,
                then permanently erased.
              </DialogDescription>
            </div>
          </div>

          <div className="mt-4">
            <Field label={`Type "${slug}" to confirm`}>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={slug}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isMatch) handleConfirm()
                }}
              />
            </Field>
          </div>

          <DialogFooter className="mt-6 p-0">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!isMatch || isPending}
            >
              {isPending && <Spinner size="sm" />}
              Delete stack
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
