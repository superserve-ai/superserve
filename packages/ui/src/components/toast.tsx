"use client"

import { CheckIcon, InfoIcon, WarningIcon, XIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

export type ToastVariant = "success" | "info" | "warning" | "error"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  actions?: ToastAction[]
}

type AddToastInput =
  | string
  | {
      title: string
      description?: string
      variant?: ToastVariant
      actions?: ToastAction[]
    }

interface ToastContextType {
  addToast: (input: AddToastInput, variant?: ToastVariant) => void
  removeToast: (id: string) => void
  toasts: Toast[]
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback(
    (input: AddToastInput, variant: ToastVariant = "info") => {
      const id = crypto.randomUUID()

      let newToast: Toast

      if (typeof input === "string") {
        newToast = { id, title: input, variant }
      } else {
        newToast = {
          id,
          title: input.title,
          description: input.description,
          variant: input.variant || variant,
          actions: input.actions,
        }
      }

      setToasts((prev) => [...prev, newToast])

      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
      }, 5000)
    },
    [],
  )

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const value = useMemo(
    () => ({ addToast, removeToast, toasts }),
    [addToast, removeToast, toasts],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: Toast[]
  removeToast: (id: string) => void
}) {
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </AnimatePresence>
    </div>
  )
}

const variantConfig = {
  success: {
    icon: CheckIcon,
    iconColor: "text-success",
  },
  info: {
    icon: InfoIcon,
    iconColor: "text-primary",
  },
  warning: {
    icon: WarningIcon,
    iconColor: "text-warning",
  },
  error: {
    icon: XIcon,
    iconColor: "text-destructive",
  },
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast
  onRemove: (id: string) => void
}) {
  const config = variantConfig[toast.variant]
  const Icon = config.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="pointer-events-auto max-w-[420px] min-w-[320px] border border-dashed border-border bg-surface/80 backdrop-blur-lg"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Icon
            className={`h-5 w-5 flex-shrink-0 ${config.iconColor}`}
            weight="light"
          />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{toast.title}</p>
            {toast.description && (
              <p className="mt-1 text-sm text-muted">{toast.description}</p>
            )}

            {toast.actions && toast.actions.length > 0 && (
              <div className="mt-3 flex items-center gap-4">
                {toast.actions.map((action, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => {
                      action.onClick()
                      onRemove(toast.id)
                    }}
                    className="text-sm font-medium text-primary transition-colors hover:underline"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(toast.id)}
            className="shrink-0 p-1 text-muted transition-colors hover:text-foreground"
            aria-label="Dismiss notification"
          >
            <XIcon className="h-4 w-4" weight="light" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
