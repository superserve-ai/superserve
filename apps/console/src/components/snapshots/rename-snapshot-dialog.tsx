"use client"

import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Field,
  Input,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { useRenameSnapshot } from "@/hooks/use-snapshots"
import type { SnapshotResponse } from "@/lib/api/types"
import { SNAPSHOT_EVENTS } from "@/lib/posthog/events"

interface RenameSnapshotDialogProps {
  snapshot: SnapshotResponse
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function RenameSnapshotDialog({
  snapshot,
  open,
  onOpenChange,
}: RenameSnapshotDialogProps) {
  const posthog = usePostHog()
  const mutation = useRenameSnapshot()
  const [name, setName] = useState(snapshot.name ?? "")

  useEffect(() => {
    if (open) setName(snapshot.name ?? "")
  }, [open, snapshot.name])

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 64

  const handleRename = () => {
    if (!valid) return
    posthog.capture(SNAPSHOT_EVENTS.RENAMED)
    mutation.mutate(
      { id: snapshot.id, name: trimmed },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename snapshot</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-2">
          <Field label="Name" description="1 to 64 characters.">
            <Input
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename()
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRename}
            disabled={!valid || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
