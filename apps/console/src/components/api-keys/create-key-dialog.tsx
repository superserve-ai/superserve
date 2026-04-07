"use client"

import { CopyIcon, PlusIcon } from "@phosphor-icons/react"
import {
  Alert,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  useToast,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"
import { useCreateApiKey } from "@/hooks/use-api-keys"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

export function CreateKeyDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [createdKey, setCreatedKey] = useState<{ full: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()
  const posthog = usePostHog()
  const createMutation = useCreateApiKey()

  const handleCreate = () => {
    if (!name.trim()) return
    posthog.capture(API_KEY_EVENTS.CREATED, { name: name.trim() })
    createMutation.mutate(name.trim(), {
      onSuccess: (data) => {
        setCreatedKey({ full: data.key })
      },
    })
  }

  const handleCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    posthog.capture(API_KEY_EVENTS.COPIED)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setOpen(false)
    setName("")
    setCreatedKey(null)
    setCopied(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>
          <PlusIcon className="size-3.5" weight="light" />
          Create Key
        </DialogTrigger>
      )}
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          {createdKey ? (
            <div className="space-y-4">
              <Alert variant="warning">
                Copy this key now. You won&apos;t be able to see it again.
              </Alert>

              <Field label="Your API Key">
                <div className="flex items-center gap-2">
                  <code className="flex-1 border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                    {createdKey.full}
                  </code>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleCopy}
                    aria-label={copied ? "Copied" : "Copy API key"}
                  >
                    <CopyIcon
                      className="size-3.5"
                      weight={copied ? "fill" : "light"}
                    />
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <Field label="Key Name" required>
              <Input
                placeholder="e.g. Production, CI/CD, Development"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
              />
            </Field>
          )}
        </div>

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
