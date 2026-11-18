"use client"

import { CheckIcon, CopyIcon, PlusIcon } from "@phosphor-icons/react"
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
import { useCallback, useEffect, useRef, useState } from "react"

import { useCreateApiKey } from "@/hooks/use-api-keys"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

type CopyTarget = "key" | "export_command"

const initialCopied = { key: false, export_command: false }

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
  const [copied, setCopied] = useState(initialCopied)
  const copyTimers = useRef<
    Partial<Record<CopyTarget, ReturnType<typeof setTimeout>>>
  >({})
  const { addToast } = useToast()
  const posthog = usePostHog()
  const createMutation = useCreateApiKey("create_dialog")
  const exportCommand = createdKey
    ? `export SUPERSERVE_API_KEY=${createdKey.full}`
    : ""

  const clearCopyTimers = useCallback(() => {
    clearTimeout(copyTimers.current.key)
    clearTimeout(copyTimers.current.export_command)
    // Pending clipboard writes can finish after the dialog closes.
    copyTimers.current = {}
  }, [])

  useEffect(() => {
    if (!open) setCopied(initialCopied)
    return clearCopyTimers
  }, [open, clearCopyTimers])

  const handleCreate = () => {
    if (!name.trim()) return
    // Click only; the server sends api_key_created once the key is stored.
    posthog.capture(API_KEY_EVENTS.CREATE_CLICKED, { name: name.trim() })
    createMutation.mutate(name.trim(), {
      onSuccess: (data) => {
        setCreatedKey({ full: data.key })
      },
    })
  }

  const handleCopy = async (target: CopyTarget, text: string) => {
    const timers = copyTimers.current
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      if (timers !== copyTimers.current) return

      clearTimeout(timers[target])
      setCopied((previous) => ({ ...previous, [target]: false }))
      addToast("Could not copy. Select the text and copy it by hand.", "error")
      return
    }

    posthog.capture(API_KEY_EVENTS.COPIED, { target })
    if (timers !== copyTimers.current) return

    setCopied((previous) => ({ ...previous, [target]: true }))
    addToast(
      target === "key"
        ? "API key copied to clipboard"
        : "Command copied to clipboard",
      "success",
    )
    clearTimeout(timers[target])
    timers[target] = setTimeout(() => {
      setCopied((previous) => ({ ...previous, [target]: false }))
    }, 2000)
  }

  const handleClose = () => {
    clearCopyTimers()
    setOpen(false)
    setName("")
    setCreatedKey(null)
    setCopied(initialCopied)
  }

  const KeyCopyIcon = copied.key ? CheckIcon : CopyIcon
  const CommandCopyIcon = copied.export_command ? CheckIcon : CopyIcon

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
            {createdKey ? "API key created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 pt-2">
          {createdKey ? (
            <div className="space-y-4">
              <Alert variant="warning">
                Copy this key now. You cannot see it again after you close this
                window.
              </Alert>

              <Field label="Your API key">
                <code
                  className="ph-no-capture block border border-dashed border-border bg-background px-3 py-2 font-mono text-xs break-all text-foreground"
                  data-mask
                >
                  {createdKey.full}
                </code>
                <Button
                  size="sm"
                  onClick={() => handleCopy("key", createdKey.full)}
                >
                  <KeyCopyIcon className="size-3.5" weight="light" />
                  {copied.key ? "Copied" : "Copy key"}
                </Button>
              </Field>

              <div className="space-y-1.5">
                <p className="text-sm">
                  Set the key in your shell, then create a sandbox:
                </p>
                <code
                  className="ph-no-capture block border border-dashed border-border bg-background px-3 py-2 font-mono text-xs break-all text-foreground"
                  data-mask
                >
                  {exportCommand}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy("export_command", exportCommand)}
                >
                  <CommandCopyIcon className="size-3.5" weight="light" />
                  {copied.export_command ? "Copied" : "Copy command"}
                </Button>
              </div>
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
            <Button variant="outline" onClick={handleClose}>
              Done
            </Button>
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
