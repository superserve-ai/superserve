"use client"

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@superserve/ui"
import { useState } from "react"

import { ConnectSandboxDialog } from "@/components/sandboxes/connect-sandbox-dialog"

import { SANDBOXES } from "../../fixtures"
import { FixtureShell } from "../fixture-shell"

export default function Page() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  return (
    <FixtureShell>
      <div className="space-y-4 p-8" data-testid="popups-fixture">
        <p className="text-sm text-muted">
          Open and close each popup. In Connect, create a fixture API key and
          switch or hover the language tabs.
        </p>
        <div className="flex items-center gap-4">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />} data-testid="open-dialog">
              Open dialog
            </DialogTrigger>
            <DialogPopup data-testid="dialog-popup">
              <DialogHeader>
                <DialogTitle>Reduced-motion dialog</DialogTitle>
                <DialogDescription>
                  This dialog keeps its backdrop and opacity fade when reduced
                  motion is enabled.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  data-testid="close-dialog"
                  onClick={() => setDialogOpen(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>

          <Button
            data-testid="open-connect-dialog"
            onClick={() => setConnectOpen(true)}
          >
            Open Connect dialog
          </Button>
          <ConnectSandboxDialog
            sandboxId={SANDBOXES[0].id}
            open={connectOpen}
            onOpenChange={setConnectOpen}
          />

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger render={<Button />} data-testid="open-popover">
              Open popover
            </PopoverTrigger>
            <PopoverPopup data-testid="popover-popup">
              <p className="mb-4 text-sm">
                This popover fades without scaling under reduced motion.
              </p>
              <Button
                data-testid="close-popover"
                onClick={() => setPopoverOpen(false)}
              >
                Close popover
              </Button>
            </PopoverPopup>
          </Popover>
        </div>
      </div>
    </FixtureShell>
  )
}
