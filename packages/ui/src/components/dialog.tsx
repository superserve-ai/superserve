"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react"
import { createContext, useContext, useState } from "react"

import { cn } from "../lib/utils"

const DialogOpenContext = createContext<boolean>(false)
export function useDialogOpen() {
  return useContext(DialogOpenContext)
}

interface DialogProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
  ...props
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  return (
    <DialogPrimitive.Root
      {...props}
      open={open}
      onOpenChange={(value) => {
        if (!isControlled) setUncontrolledOpen(value)
        onOpenChange?.(value)
      }}
    >
      <DialogOpenContext.Provider value={open}>
        {children}
      </DialogOpenContext.Provider>
    </DialogPrimitive.Root>
  )
}

const DialogTrigger = DialogPrimitive.Trigger

function DialogPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="ss-dialog-backdrop fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Popup
        className={cn(
          "ss-dialog-popup fixed left-1/2 top-1/2 z-50 w-full max-w-md bg-surface border border-dashed border-border shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-4 right-4 text-muted hover:text-foreground transition-colors">
          <XIcon weight="light" className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-6 pb-4", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex justify-end gap-3 p-6 pt-4", className)}
      {...props}
    />
  )
}

const DialogClose = DialogPrimitive.Close

export {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
