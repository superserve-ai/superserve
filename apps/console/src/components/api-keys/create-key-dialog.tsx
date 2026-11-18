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
import { useCallback, useLayoutEffect, useRef, useState } from "react"

import { useCreateApiKey } from "@/hooks/use-api-keys"
import { API_KEY_EVENTS } from "@/lib/posthog/events"

type CopyTarget = "key" | "export_command"

const initialCopied = { key: false, export_command: false }
const copyError = "Could not copy. Select the text and copy it by hand."

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
  const [copyFailed, setCopyFailed] = useState(false)
  const copyAttempts = useRef({ key: 0, export_command: 0 })
  const copyTimers = useRef<
    Partial<Record<CopyTarget, ReturnType<typeof setTimeout>>>
  >({})
  const { addToast } = useToast()
  const posthog = usePostHog()
  const createMutation = useCreateApiKey("create_dialog")
  const exportCommand = createdKey
    ? `export SUPERSERVE_API_KEY=${createdKey.full}`
    : ""

  const cancelCopyFeedback = useCallback(() => {
    clearTimeout(copyTimers.current.key)
    clearTimeout(copyTimers.current.export_command)
    copyTimers.current = {}
    // Invalidate pending clipboard writes.
    copyAttempts.current.key++
    copyAttempts.current.export_command++
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setCopied(initialCopied)
      setCopyFailed(false)
    }
    return cancelCopyFeedback
  }, [open, cancelCopyFeedback])

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
    const attempt = ++copyAttempts.current[target]
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      if (attempt !== copyAttempts.current[target]) return

      clearTimeout(copyTimers.current[target])
      setCopied((previous) => ({ ...previous, [target]: false }))
      setCopyFailed(true)
      addToast(copyError, "error")
      return
    }

    if (attempt !== copyAttempts.current[target]) return

    posthog.capture(API_KEY_EVENTS.COPIED, { target })
    setCopyFailed(false)
    setCopied((previous) => ({ ...previous, [target]: true }))
    addToast(
      target === "key"
        ? "API key copied to clipboard"
        : "Command copied to clipboard",
      "success",
    )
    clearTimeout(copyTimers.current[target])
    copyTimers.current[target] = setTimeout(() => {
      setCopied((previous) => ({ ...previous, [target]: false }))
    }, 2000)
  }

  const handleClose = () => {
    cancelCopyFeedback()
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
      <DialogPopup className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
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
                  aria-label={copied.key ? "Copied API key" : undefined}
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
                  aria-label={
                    copied.export_command ? "Copied export command" : undefined
                  }
                  onClick={() => handleCopy("export_command", exportCommand)}
                >
                  <CommandCopyIcon className="size-3.5" weight="light" />
                  {copied.export_command ? "Copied" : "Copy command"}
                </Button>
              </div>
              {copyFailed && (
                <p role="alert" className="text-xs text-destructive">
                  {copyError}
                </p>
              )}
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
