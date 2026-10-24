"use client"

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  Field,
  Textarea,
} from "@superserve/ui"
import { useState } from "react"

export interface ReasonRequest {
  title: string
  description: string
  onConfirm: (reason: string) => void
}

export function ReasonDialog({
  request,
  onClose,
}: {
  request: ReasonRequest | null
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const trimmed = reason.trim()
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("")
          onClose()
        }
      }}
    >
      <DialogPopup>
        <form
          className="space-y-4 p-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!request || !trimmed) return
            request.onConfirm(trimmed)
            setReason("")
            onClose()
          }}
        >
          <DialogTitle>{request?.title ?? ""}</DialogTitle>
          <DialogDescription>{request?.description ?? ""}</DialogDescription>
          <Field
            label="Reason"
            htmlFor="catalog-reason"
            description="Recorded with your name in the catalog audit."
          >
            <Textarea
              id="catalog-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <DialogFooter className="p-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReason("")
                onClose()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
