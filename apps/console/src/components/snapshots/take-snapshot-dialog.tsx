"use client"

import { CameraIcon } from "@phosphor-icons/react"
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
import { useState } from "react"

import { useCreateSnapshot } from "@/hooks/use-snapshots"
import type { SandboxStatus } from "@/lib/api/types"
import { SNAPSHOT_EVENTS } from "@/lib/posthog/events"

interface TakeSnapshotDialogProps {
  sandboxId: string
  status: SandboxStatus
}

export function TakeSnapshotDialog({
  sandboxId,
  status,
}: TakeSnapshotDialogProps) {
  const posthog = usePostHog()
  const mutation = useCreateSnapshot()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  const trimmed = name.trim()
  const canTake = status === "active" || status === "paused"

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (!v) setName("")
  }

  const handleTake = () => {
    posthog.capture(SNAPSHOT_EVENTS.TAKEN, { named: !!trimmed })
    mutation.mutate({ sandboxId, name: trimmed || undefined })
    // The capture can take minutes; progress shows in the list, not here.
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={!canTake || mutation.isPending}
          />
        }
      >
        <CameraIcon className="size-3.5" weight="light" />
        {mutation.isPending ? "Taking snapshot…" : "Take snapshot"}
      </DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take snapshot</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <p className="text-sm text-muted">
            Saves the sandbox&apos;s memory and disk. A running sandbox pauses
            briefly while it is captured.
          </p>
          <Field label="Name" description="Optional, up to 64 characters.">
            <Input
              placeholder="my-snapshot"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTake()
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTake}>Take snapshot</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
