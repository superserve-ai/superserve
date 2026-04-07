"use client"

import { PlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useRef, useState } from "react"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

interface EnvVar {
  id: string
  key: string
  value: string
}

function createEnvVar(key = "", value = ""): EnvVar {
  return { id: crypto.randomUUID(), key, value }
}

interface CreateSandboxDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  onCreated?: (sandboxId: string) => void
}

export function CreateSandboxDialog({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  onCreated,
}: CreateSandboxDialogProps = {}) {
  const posthog = usePostHog()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [envVars, setEnvVars] = useState<EnvVar[]>([createEnvVar()])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const createMutation = useCreateSandbox()

  const addEnvVar = () => {
    setEnvVars([...envVars, createEnvVar()])
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: "key" | "value", val: string) => {
    setEnvVars(
      envVars.map((v, i) => (i === index ? { ...v, [field]: val } : v)),
    )
  }

  const handleImportEnv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.split("\n").filter((line) => {
        const trimmed = line.trim()
        return trimmed && !trimmed.startsWith("#")
      })

      const parsed: EnvVar[] = lines.map((line) => {
        const eqIndex = line.indexOf("=")
        if (eqIndex === -1) return createEnvVar(line.trim())
        return createEnvVar(
          line.slice(0, eqIndex).trim(),
          line
            .slice(eqIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        )
      })

      if (parsed.length > 0) {
        setEnvVars(parsed)
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleReset = () => {
    setName("")
    setEnvVars([createEnvVar()])
  }

  const handleCreate = () => {
    posthog.capture(SANDBOX_EVENTS.CREATED)
    createMutation.mutate(
      { name: name.trim(), vcpu_count: 1, memory_mib: 1024 },
      {
        onSuccess: (sandbox) => {
          setOpen(false)
          handleReset()
          onCreated?.(sandbox.id)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) handleReset()
      }}
    >
      {!hideTrigger && (
        <DialogTrigger render={<Button />}>Create Sandbox</DialogTrigger>
      )}
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sandbox</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-2">
          <Field label="Sandbox Name" required>
            <Input
              placeholder="my-sandbox"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Snapshot" description="More snapshots coming soon">
            <Select defaultValue="base">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="base">superserve/base</SelectItem>
              </SelectPopup>
            </Select>
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium text-foreground">
                Environment Variables
              </span>
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleImportEnv}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadSimpleIcon className="size-3.5" weight="light" />
                  Import .env
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {envVars.map((envVar, index) => (
                <div key={envVar.id} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={envVar.key}
                    onChange={(e) => updateEnvVar(index, "key", e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                  <Input
                    placeholder="value"
                    value={envVar.value}
                    onChange={(e) =>
                      updateEnvVar(index, "value", e.target.value)
                    }
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeEnvVar(index)}
                    disabled={envVars.length === 1}
                    aria-label="Remove variable"
                    className="text-muted hover:text-destructive"
                  >
                    <TrashIcon className="size-3.5" weight="light" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={addEnvVar}
            >
              <PlusIcon className="size-3.5" weight="light" />
              Add variable
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={handleCreate}
          >
            {createMutation.isPending ? "Creating..." : "Create Sandbox"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
