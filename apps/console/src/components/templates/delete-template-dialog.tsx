"use client"

import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@superserve/ui"
import { useDeleteTemplate } from "@/hooks/use-templates"
import { ApiError } from "@/lib/api/client"
import type { TemplateResponse } from "@/lib/api/types"

interface DeleteTemplateDialogProps {
  template: TemplateResponse | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: () => void
}

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
  onDeleted,
}: DeleteTemplateDialogProps) {
  const mutation = useDeleteTemplate()

  const handleDelete = async () => {
    if (!template) return
    try {
      await mutation.mutateAsync(template.id)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      // 409 "template in use" is surfaced via toast by the hook; leave
      // the dialog open so the user sees the context.
      if (!(err instanceof ApiError)) throw err
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete template</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-2 text-sm text-muted">
          This will soft-delete{" "}
          <span className="font-mono text-foreground">{template?.name}</span>.
          Sandboxes still using this template will block the delete — stop or
          delete them first.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
