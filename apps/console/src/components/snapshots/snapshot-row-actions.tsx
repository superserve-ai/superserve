"use client"

import {
  CopyIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  RocketLaunchIcon,
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
import { useRouter } from "next/navigation"
import { useState } from "react"

import type { SnapshotResponse } from "@/lib/api/types"

import { DeleteSnapshotDialog } from "./delete-snapshot-dialog"
import { RenameSnapshotDialog } from "./rename-snapshot-dialog"

export function SnapshotRowActions({
  snapshot,
}: {
  snapshot: SnapshotResponse
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const copyId = () => {
    navigator.clipboard.writeText(snapshot.id)
    addToast("ID copied", "success")
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Snapshot actions"
            />
          }
        >
          <DotsThreeVerticalIcon className="size-4" weight="bold" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            disabled={snapshot.status !== "ready"}
            onClick={() =>
              router.push(`/sandboxes?from_snapshot=${snapshot.id}`)
            }
          >
            <RocketLaunchIcon className="size-4" weight="light" />
            Create sandbox
          </MenuItem>
          <MenuItem
            disabled={snapshot.status === "deleting"}
            onClick={() => setRenameOpen(true)}
          >
            <PencilSimpleIcon className="size-4" weight="light" />
            Rename
          </MenuItem>
          <MenuItem onClick={copyId}>
            <CopyIcon className="size-4" weight="light" />
            Copy ID
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            disabled={
              snapshot.status === "creating" || snapshot.status === "deleting"
            }
            onClick={() => setDeleteOpen(true)}
            className="text-destructive hover:bg-destructive/5 focus:bg-destructive/5"
          >
            <TrashIcon className="size-4" weight="light" />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>

      <RenameSnapshotDialog
        snapshot={snapshot}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteSnapshotDialog
        snapshot={snapshot}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
