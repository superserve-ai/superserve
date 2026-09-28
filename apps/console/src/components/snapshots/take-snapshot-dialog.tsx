"use client"

import { CameraIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

import { useSandboxesPage } from "@/hooks/use-sandboxes"
import { useCreateSnapshot, useIsTakingSnapshot } from "@/hooks/use-snapshots"
import type { SandboxStatus } from "@/lib/api/types"
import { SNAPSHOT_EVENTS } from "@/lib/posthog/events"

interface TakeSnapshotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The sandbox to snapshot; when omitted, the dialog asks which. */
  sandboxId?: string
}

export function TakeSnapshotDialog({
  open,
  onOpenChange,
  sandboxId,
}: TakeSnapshotDialogProps) {
  const posthog = usePostHog()
  const mutation = useCreateSnapshot()
  const [name, setName] = useState("")
  const [picked, setPicked] = useState("")

  const target = sandboxId ?? picked
  const trimmed = name.trim()

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v)
    if (!v) {
      setName("")
      setPicked("")
    }
  }

  const handleTake = () => {
    if (!target) return
    posthog.capture(SNAPSHOT_EVENTS.TAKEN, { named: !!trimmed })
    mutation.mutate({ sandboxId: target, name: trimmed || undefined })
    // The capture can take minutes; progress shows in the list, not here.
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take snapshot</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <p className="text-sm text-muted">
            Saves the sandbox&apos;s memory and disk. A running sandbox pauses
            briefly while the snapshot is taken.
          </p>
          {sandboxId === undefined && (
            <Field label="Sandbox" description="Active or paused sandboxes.">
              <SandboxPicker value={picked} onChange={setPicked} />
            </Field>
          )}
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
          <Button onClick={handleTake} disabled={!target}>
            Take snapshot
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so the list is fetched on demand. */
function SandboxPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  // ponytail: the 100 newest sandboxes; page or search here if teams outgrow it.
  const { data, isPending } = useSandboxesPage({
    page: 1,
    pageSize: 100,
    sort: "created_at",
    order: "desc",
  })
  const sandboxes = (data?.items ?? []).filter(
    (s) => s.status === "active" || s.status === "paused",
  )
  const selected = sandboxes.find((s) => s.id === value)
  const placeholder = isPending
    ? "Loading…"
    : sandboxes.length > 0
      ? "Select a sandbox"
      : "No active or paused sandboxes"

  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger aria-label="Sandbox">
        <SelectValue>{() => selected?.name ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {sandboxes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}

interface TakeSnapshotButtonProps {
  /** The sandbox to snapshot; when omitted, the dialog asks which. */
  sandboxId?: string
  status?: SandboxStatus
}

export function TakeSnapshotButton({
  sandboxId,
  status,
}: TakeSnapshotButtonProps) {
  const [open, setOpen] = useState(false)
  const taking = useIsTakingSnapshot(sandboxId) && sandboxId !== undefined
  const canTake =
    status === undefined || status === "active" || status === "paused"

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!canTake || taking}
        onClick={() => setOpen(true)}
      >
        <CameraIcon className="size-3.5" weight="light" />
        {taking ? "Taking snapshot…" : "Take snapshot"}
      </Button>
      <TakeSnapshotDialog
        open={open}
        onOpenChange={setOpen}
        sandboxId={sandboxId}
      />
    </>
  )
}
