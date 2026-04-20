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
import { useRebuildTemplate } from "@/hooks/use-templates"
import type { TemplateResponse } from "@/lib/api/types"
import { DeleteTemplateDialog } from "./delete-template-dialog"

interface TemplateRowActionsProps {
  template: TemplateResponse
  onLaunch: (t: TemplateResponse) => void
}

export function TemplateRowActions({ template }: TemplateRowActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const rebuild = useRebuildTemplate()
  const { addToast } = useToast()

  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value)
    addToast(`${label} copied`, "success")
  }

  const rebuildDisabled =
    rebuild.isPending ||
    template.status === "building" ||
    template.status === "pending"

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Template actions"
            />
          }
        >
          <DotsThreeVerticalIcon className="size-4" weight="bold" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            onClick={() => rebuild.mutate(template.id)}
            disabled={rebuildDisabled}
          >
            <ArrowsClockwiseIcon className="size-4" weight="light" />
            Rebuild
          </MenuItem>
          <MenuItem onClick={() => copy(template.alias, "Alias")}>
            <CopyIcon className="size-4" weight="light" />
            Copy alias
          </MenuItem>
          <MenuItem onClick={() => copy(template.id, "ID")}>
            <CopyIcon className="size-4" weight="light" />
            Copy ID
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

      <DeleteTemplateDialog
        template={template}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
