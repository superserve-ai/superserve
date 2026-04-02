"use client"

import { PlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { useRef, useState } from "react"

interface EnvVar {
  key: string
  value: string
}

interface CreateSandboxDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateSandboxDialog({
  open: controlledOpen,
  onOpenChange,
}: CreateSandboxDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [name, setName] = useState("")
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: "", value: "" }])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }])
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: "key" | "value", val: string) => {
    const updated = [...envVars]
    updated[index][field] = val
    setEnvVars(updated)
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
        if (eqIndex === -1) return { key: line.trim(), value: "" }
        return {
          key: line.slice(0, eqIndex).trim(),
          value: line
            .slice(eqIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        }
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
    setEnvVars([{ key: "", value: "" }])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) handleReset()
      }}
    >
      <DialogTrigger asChild>
        <Button>Create Sandbox</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sandbox</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-2">
          <FormField label="Sandbox Name" required>
            <Input
              placeholder="my-sandbox"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField label="Snapshot" description="More snapshots coming soon">
            <Select defaultValue="base">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">superserve/base</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium text-foreground">
                Environment Variables
              </span>
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=""
                  className="hidden"
                  onChange={handleImportEnv}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
                >
                  <UploadSimpleIcon className="size-3.5" weight="light" />
                  Import .env
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {envVars.map((envVar, index) => (
                <div
                  key={`env-${index}-${envVars.length}`}
                  className="flex items-center gap-2"
                >
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
                  <button
                    type="button"
                    onClick={() => removeEnvVar(index)}
                    disabled={envVars.length === 1}
                    className="p-1.5 text-muted hover:text-destructive transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="size-3.5" weight="light" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addEnvVar}
              className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <PlusIcon className="size-3.5" weight="light" />
              Add variable
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button>Create Sandbox</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
