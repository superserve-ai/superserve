"use client"

import {
  ArrowsClockwiseIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  useToast,
} from "@superserve/ui"
import { useState } from "react"

import type { SecretResponse } from "@/lib/api/types"

import { DeleteSecretDialog } from "./delete-secret-dialog"
import { RotateSecretDialog } from "./rotate-secret-dialog"

export function SecretRowActions({ secret }: { secret: SecretResponse }) {
  const [rotateOpen, setRotateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { addToast } = useToast()

  const copyName = () => {
    navigator.clipboard.writeText(secret.name)
    addToast("Name copied", "success")
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Secret actions"
            />
          }
        >
          <DotsThreeVerticalIcon className="size-4" weight="bold" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setRotateOpen(true)}>
            <ArrowsClockwiseIcon className="size-4" weight="light" />
            Rotate value
          </MenuItem>
          <MenuItem onClick={copyName}>
            <CopyIcon className="size-4" weight="light" />
            Copy name
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-destructive hover:bg-destructive/5 focus:bg-destructive/5"
          >
            <TrashIcon className="size-4" weight="light" />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>

      <RotateSecretDialog
        secretName={secret.name}
        open={rotateOpen}
        onOpenChange={setRotateOpen}
      />
      <DeleteSecretDialog
        secretName={secret.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
