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
import { useState } from "react"

interface RevokeKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
  keyName?: string
  bulkCount?: number
}

export function RevokeKeyDialog({
  open,
  onOpenChange,
  onConfirm,
  keyName,
  bulkCount,
}: RevokeKeyDialogProps) {
  const [input, setInput] = useState("")
  const [isPending, setIsPending] = useState(false)

  const isBulk = bulkCount !== undefined && bulkCount > 0
  const expectedInput = isBulk ? `revoke ${bulkCount} keys` : (keyName ?? "")
  const isMatch = input === expectedInput

  const handleConfirm = async () => {
    if (!isMatch) return
    setIsPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsPending(false)
      setInput("")
    }
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) setInput("")
    onOpenChange(v)
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
              <DialogTitle>
                {isBulk ? `Revoke ${bulkCount} keys` : "Revoke API key"}
              </DialogTitle>
              <DialogDescription className="mt-2">
                This action is irreversible.{" "}
                {isBulk
                  ? "These keys will be permanently revoked and can no longer be used."
                  : "This key will be permanently revoked and can no longer be used."}
              </DialogDescription>
            </div>
          </div>

          <div className="mt-4">
            <Field
              label={
                isBulk
                  ? `Type "revoke ${bulkCount} keys" to confirm`
                  : `Type "${keyName}" to confirm`
              }
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={expectedInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isMatch) handleConfirm()
                }}
              />
            </Field>
          </div>

          <DialogFooter className="mt-6 p-0">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!isMatch || isPending}
            >
              {isPending ? (
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
              Revoke
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
