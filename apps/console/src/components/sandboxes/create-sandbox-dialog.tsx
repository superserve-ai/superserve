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
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

interface CreateSandboxDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  onCreated?: (sandboxId: string) => void
}

export function CreateSandboxDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  onCreated,
}: CreateSandboxDialogProps = {}) {
  const posthog = usePostHog()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")

  const createMutation = useCreateSandbox()

  const handleReset = () => {
    setName("")
  }

  const handleCreate = () => {
    posthog.capture(SANDBOX_EVENTS.CREATED)
    createMutation.mutate(
      { name: name.trim() },
      {
        onSuccess: (sandbox) => {
          setOpen(false)
          handleReset()
          onCreated?.(sandbox.id)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) handleReset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>Create Sandbox</DialogTrigger>
      )}
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sandbox</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 p-6 pt-2">
          <Field label="Sandbox Name" required>
            <Input
              placeholder="my-sandbox"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Snapshot" description="More snapshots coming soon">
            <Select defaultValue="base">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="base">superserve/base</SelectItem>
              </SelectPopup>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={handleCreate}
          >
            {createMutation.isPending ? "Creating..." : "Create Sandbox"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
