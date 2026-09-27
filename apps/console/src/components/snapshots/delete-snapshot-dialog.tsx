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
} from "@superserve/ui"
import { motion } from "motion/react"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { useDeleteSnapshot } from "@/hooks/use-snapshots"
import type { SnapshotResponse } from "@/lib/api/types"
import { SNAPSHOT_EVENTS } from "@/lib/posthog/events"

import { snapshotLabel } from "./snapshot-status-badge"

interface DeleteSnapshotDialogProps {
  snapshot: SnapshotResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteSnapshotDialog({
  snapshot,
  open,
  onOpenChange,
}: DeleteSnapshotDialogProps) {
  const posthog = usePostHog()
  const mutation = useDeleteSnapshot()
  const [input, setInput] = useState("")

  const expectedInput = snapshotLabel(snapshot)
  const isMatch = input === expectedInput

  const handleOpenChange = (v: boolean) => {
    if (!v) setInput("")
    onOpenChange(v)
  }

  const handleConfirm = () => {
    if (!isMatch) return
    posthog.capture(SNAPSHOT_EVENTS.DELETED, { id: snapshot.id })
    mutation.mutate(snapshot.id, {
      onSuccess: () => handleOpenChange(false),
    })
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
              <DialogTitle>Delete snapshot</DialogTitle>
              <DialogDescription className="mt-2">
                This action is irreversible. Sandboxes already created from this
                snapshot keep running.
              </DialogDescription>
            </div>
          </div>

          <div className="mt-4">
            <Field label={`Type "${expectedInput}" to confirm`}>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={expectedInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirm()
                }}
              />
            </Field>
          </div>

          <DialogFooter className="mt-6 p-0">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!isMatch || mutation.isPending}
            >
              {mutation.isPending ? (
                <motion.div
                  className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 0.8,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }}
                />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
