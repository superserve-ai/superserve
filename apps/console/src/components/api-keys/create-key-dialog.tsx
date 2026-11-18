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

const QUICKSTART_DOCS_URL = "https://docs.superserve.ai/quickstart"

type CopyTarget = "key" | "export_command"
type CopyFailure = { attempt: number; scroll: boolean }

const initialCopyState = { key: false, export_command: false }
const initialCopyFailures: Record<CopyTarget, CopyFailure | null> = {
  key: null,
  export_command: null,
}
const copyError = "Could not copy. Select the text and copy it by hand."

function selectCodeText(code: HTMLElement | null) {
  const selection = window.getSelection?.()
  if (!code || !selection) return

  const range = document.createRange()
  range.selectNodeContents(code)
  selection.removeAllRanges()
  selection.addRange(range)
}

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
  const [copied, setCopied] = useState(initialCopyState)
  const [{ key: keyFailure, export_command: commandFailure }, setCopyFailures] =
    useState(initialCopyFailures)
  const [copyAnnouncement, setCopyAnnouncement] = useState<{
    id: string
    target: CopyTarget
    message: string
  } | null>(null)
  const keyCopyButton = useRef<HTMLButtonElement>(null)
  const keyCode = useRef<HTMLElement>(null)
  const commandCode = useRef<HTMLElement>(null)
  const keyAlert = useRef<HTMLParagraphElement>(null)
  const commandAlert = useRef<HTMLParagraphElement>(null)
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
      setCopied(initialCopyState)
      setCopyFailures(initialCopyFailures)
      setCopyAnnouncement(null)
    }
    return cancelCopyFeedback
  }, [open, cancelCopyFeedback])

  // Plain focus() centers the button and can scroll the one-time warning out
  // of a short window, so scroll only as far as the button needs.
  const focusKeyCopyButton = useCallback(() => {
    const button = keyCopyButton.current
    if (!button) return true
    button.focus({ preventScroll: true })
    button.scrollIntoView?.({ block: "nearest" })
    return false
  }, [])

  useLayoutEffect(() => {
    // Not while the window closes; initialFocus covers the next open.
    if (open && createdKey) focusKeyCopyButton()
  }, [open, createdKey, focusKeyCopyButton])

  useLayoutEffect(() => {
    if (keyFailure?.scroll) {
      keyAlert.current?.scrollIntoView?.({ block: "nearest" })
    }
  }, [keyFailure])

  useLayoutEffect(() => {
    if (commandFailure?.scroll) {
      commandAlert.current?.scrollIntoView?.({ block: "nearest" })
    }
  }, [commandFailure])

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
    const activeElement = document.activeElement
    // The window's scroll position now, to tell later whether the user scrolled.
    const scroller = keyCopyButton.current?.closest('[role="dialog"]')
    const startScrollTop = scroller?.scrollTop
    const { anchorNode, anchorOffset, focusNode, focusOffset } =
      window.getSelection?.() ?? {}
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      if (attempt !== copyAttempts.current[target]) return

      const focusUnchanged = document.activeElement === activeElement
      const scrollUnchanged = scroller?.scrollTop === startScrollTop
      clearTimeout(copyTimers.current[target])
      setCopied((previous) => ({ ...previous, [target]: false }))
      setCopyFailures((previous) => ({
        ...previous,
        [target]: { attempt, scroll: focusUnchanged && scrollUnchanged },
      }))
      setCopyAnnouncement((previous) =>
        previous?.target === target ? null : previous,
      )
      const selection = window.getSelection?.()
      if (
        focusUnchanged &&
        selection &&
        (selection.isCollapsed ||
          (selection.anchorNode === anchorNode &&
            selection.anchorOffset === anchorOffset &&
            selection.focusNode === focusNode &&
            selection.focusOffset === focusOffset))
      ) {
        selectCodeText(target === "key" ? keyCode.current : commandCode.current)
      }
      addToast(copyError, "error")
      return
    }

    if (attempt !== copyAttempts.current[target]) return

    const message =
      target === "key"
        ? "API key copied to clipboard"
        : "Command copied to clipboard"
    posthog.capture(API_KEY_EVENTS.COPIED, { target })
    setCopyFailures((previous) => ({ ...previous, [target]: null }))
    setCopied((previous) => ({ ...previous, [target]: true }))
    setCopyAnnouncement({ id: `${target}:${attempt}`, target, message })
    addToast(message, "success")
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
    setCopied(initialCopyState)
  }

  const KeyCopyIcon = copied.key ? CheckIcon : CopyIcon
  const CommandCopyIcon = copied.export_command ? CheckIcon : CopyIcon

  return (
    <Dialog
      disablePointerDismissal={!!createdKey}
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>
          <PlusIcon className="size-3.5" weight="light" />
          Create Key
        </DialogTrigger>
      )}
      <DialogPopup
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto"
        // A key created while the window was closed shows on reopen.
        initialFocus={createdKey ? focusKeyCopyButton : undefined}
      >
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

              <output className="sr-only" aria-live="polite">
                {copyAnnouncement && (
                  <span key={copyAnnouncement.id}>
                    {copyAnnouncement.message}
                  </span>
                )}
              </output>

              <Field label="Your API key">
                <code
                  ref={keyCode}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the group role lets the code block carry a name
                  role="group"
                  aria-label="API key"
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus selects the text for a manual copy
                  tabIndex={0}
                  onFocus={(event) => selectCodeText(event.currentTarget)}
                  className="ph-no-capture block border border-dashed border-border bg-background px-3 py-2 font-mono text-xs break-all text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                  data-mask
                >
                  {createdKey.full}
                </code>
                <Button
                  ref={keyCopyButton}
                  size="sm"
                  aria-label={copied.key ? "Copied API key" : undefined}
                  onKeyDown={(event) => {
                    // Focus lands here after Enter creates the key, so a held
                    // Enter must not copy the key without a new key press.
                    if (event.key === "Enter" && event.repeat) {
                      event.preventDefault()
                    }
                  }}
                  onClick={() => handleCopy("key", createdKey.full)}
                >
                  <KeyCopyIcon className="size-3.5" weight="light" />
                  {copied.key ? "Copied" : "Copy key"}
                </Button>
                {keyFailure !== null && (
                  <p
                    key={keyFailure.attempt}
                    ref={keyAlert}
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {copyError}
                  </p>
                )}
              </Field>

              <div className="space-y-1.5">
                <p className="text-sm">Set the key in your shell:</p>
                <code
                  ref={commandCode}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the group role lets the code block carry a name
                  role="group"
                  aria-label="Export command"
                  // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus selects the text for a manual copy
                  tabIndex={0}
                  onFocus={(event) => selectCodeText(event.currentTarget)}
                  className="ph-no-capture block border border-dashed border-border bg-background px-3 py-2 font-mono text-xs break-all text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
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
                {commandFailure !== null && (
                  <p
                    key={commandFailure.attempt}
                    ref={commandAlert}
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {copyError}
                  </p>
                )}
              </div>
              <p className="text-sm">
                Then follow the{" "}
                <a
                  href={QUICKSTART_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Quickstart (opens in a new tab)"
                  className="font-medium text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                >
                  Quickstart
                </a>{" "}
                to create your first sandbox.
              </p>
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
