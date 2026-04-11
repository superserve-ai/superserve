"use client"

import {
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Field,
  HighlightedCode,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@superserve/ui"
import { LayoutGroup, motion } from "motion/react"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

type Mode = "form" | "code"
type Language = "typescript" | "python" | "go"

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "Go", value: "go" },
]

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
  go: "go get github.com/superserve/superserve-go",
}

function getCreateSnippet(language: Language): string {
  if (language === "typescript") {
    return `import { Superserve } from "@superserve/sdk"

const client = new Superserve({ apiKey: "YOUR_API_KEY" })

const sandbox = await client.sandboxes.create({
  name: "my-sandbox",
})
console.log(sandbox.id)`
  }

  if (language === "python") {
    return `from superserve import Superserve

client = Superserve(api_key="YOUR_API_KEY")

sandbox = client.sandboxes.create(
    name="my-sandbox",
)
print(sandbox.id)`
  }

  return `package main

import (
	"fmt"
	ss "github.com/superserve/superserve-go"
)

func main() {
	client := ss.NewClient("YOUR_API_KEY")

	sandbox, _ := client.Sandboxes.Create(ss.CreateParams{
		Name: "my-sandbox",
	})
	fmt.Println(sandbox.ID)
}`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy"}
      className="shrink-0 cursor-pointer text-muted transition-colors hover:text-foreground"
    >
      {copied ? (
        <CheckIcon className="size-4 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-4" weight="light" />
      )}
    </button>
  )
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
  const [timeout, setTimeout] = useState("")
  const [allowRules, setAllowRules] = useState<string[]>([])
  const [denyRules, setDenyRules] = useState<string[]>([])
  const [envEntries, setEnvEntries] = useState<
    { key: string; value: string }[]
  >([])
  const [metadataEntries, setMetadataEntries] = useState<
    { key: string; value: string }[]
  >([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [mode, setMode] = useState<Mode>("form")
  const [language, setLanguage] = useState<Language>("typescript")
  const [hoveredMode, setHoveredMode] = useState<string | null>(null)
  const [hoveredLang, setHoveredLang] = useState<string | null>(null)

  const createMutation = useCreateSandbox()

  const handleReset = () => {
    setName("")
    setTimeout("")
    setAllowRules([])
    setDenyRules([])
    setEnvEntries([])
    setMetadataEntries([])
    setShowAdvanced(false)
    setMode("form")
  }

  const handleCreate = () => {
    posthog.capture(SANDBOX_EVENTS.CREATED)

    const allowList = allowRules.map((r) => r.trim()).filter(Boolean)
    const denyList = denyRules.map((r) => r.trim()).filter(Boolean)
    const hasNetwork = allowList.length > 0 || denyList.length > 0

    const envVars: Record<string, string> = {}
    for (const entry of envEntries) {
      const k = entry.key.trim()
      const v = entry.value.trim()
      if (k) envVars[k] = v
    }

    const metadata: Record<string, string> = {}
    for (const entry of metadataEntries) {
      const k = entry.key.trim()
      const v = entry.value.trim()
      if (k) metadata[k] = v
    }

    createMutation.mutate(
      {
        name: name.trim(),
        ...(timeout ? { timeout: Number(timeout) } : {}),
        ...(hasNetwork
          ? {
              network: {
                ...(allowList.length > 0 ? { allow_out: allowList } : {}),
                ...(denyList.length > 0 ? { deny_out: denyList } : {}),
              },
            }
          : {}),
        ...(Object.keys(envVars).length > 0 ? { env_vars: envVars } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
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
      <DialogPopup className="max-w-xl [&>.absolute]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between gap-4 p-6 pb-4">
          <DialogTitle>Create Sandbox</DialogTitle>
          <nav
            className="flex items-center gap-1"
            onMouseLeave={() => setHoveredMode(null)}
          >
            {(["form", "code"] as const).map((m) => {
              const isActive = mode === m
              const isHovered = hoveredMode === m
              const label = m === "form" ? "Console" : "SDK"

              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  onMouseEnter={() => setHoveredMode(m)}
                  className={cn(
                    "relative inline-flex cursor-pointer items-center px-3 py-1 font-mono text-xs transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {isHovered && (
                    <motion.span
                      className="absolute inset-0 bg-foreground/4"
                      layoutId="create-mode-hover"
                      transition={{
                        type: "spring",
                        bounce: 0.15,
                        duration: 0.4,
                      }}
                    />
                  )}
                  {isActive && !hoveredMode && (
                    <span className="absolute inset-0 bg-foreground/4" />
                  )}
                  {isActive && (
                    <motion.span
                      className="pointer-events-none absolute inset-0"
                      layoutId="create-mode-active"
                      transition={{
                        type: "spring",
                        bounce: 0.15,
                        duration: 0.5,
                      }}
                    >
                      <CornerBrackets size="sm" />
                    </motion.span>
                  )}
                  <span className="relative">{label}</span>
                </button>
              )
            })}
          </nav>
        </DialogHeader>

        {mode === "form" ? (
          <>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-4">
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

              <Field
                label="Timeout"
                description="Auto-delete after this many seconds (max 604800 = 7 days)"
              >
                <Input
                  type="number"
                  placeholder="No timeout"
                  min={1}
                  max={604800}
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                />
              </Field>

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full cursor-pointer items-center gap-1.5 border-t border-dashed border-border pt-4 font-mono text-xs uppercase text-muted hover:text-foreground"
              >
                <CaretDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    showAdvanced && "rotate-180",
                  )}
                  weight="bold"
                />
                Advanced Options
              </button>

              {showAdvanced && (
                <div className="space-y-5">
                  <div className="space-y-4">
                    <span className="block text-sm font-medium text-foreground">
                      Network
                    </span>

                    <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
                      <span className="pt-1.5 text-xs text-muted">
                        Allow — domains or CIDRs
                      </span>
                      <div className="space-y-2">
                        {allowRules.map((rule, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              placeholder="api.openai.com"
                              value={rule}
                              onChange={(e) => {
                                const updated = [...allowRules]
                                updated[i] = e.target.value
                                setAllowRules(updated)
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              onClick={() =>
                                setAllowRules(
                                  allowRules.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon
                                className="size-3.5 text-muted"
                                weight="light"
                              />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          onClick={() => setAllowRules([...allowRules, ""])}
                        >
                          <PlusIcon className="size-3.5" weight="light" />
                          Add
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
                      <span className="pt-1.5 text-xs text-muted">
                        Deny — CIDRs
                      </span>
                      <div className="space-y-2">
                        {denyRules.map((rule, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              placeholder="0.0.0.0/0"
                              value={rule}
                              onChange={(e) => {
                                const updated = [...denyRules]
                                updated[i] = e.target.value
                                setDenyRules(updated)
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              onClick={() =>
                                setDenyRules(
                                  denyRules.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <TrashIcon
                                className="size-3.5 text-muted"
                                weight="light"
                              />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          onClick={() => setDenyRules([...denyRules, ""])}
                        >
                          <PlusIcon className="size-3.5" weight="light" />
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        Environment Variables
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEnvEntries([...envEntries, { key: "", value: "" }])
                        }
                      >
                        <PlusIcon className="size-3.5" weight="light" />
                        Add
                      </Button>
                    </div>
                    {envEntries.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder="KEY"
                          value={entry.key}
                          onChange={(e) => {
                            const updated = [...envEntries]
                            updated[i] = { ...entry, key: e.target.value }
                            setEnvEntries(updated)
                          }}
                          className="flex-1"
                        />
                        <Input
                          placeholder="value"
                          value={entry.value}
                          onChange={(e) => {
                            const updated = [...envEntries]
                            updated[i] = { ...entry, value: e.target.value }
                            setEnvEntries(updated)
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          onClick={() =>
                            setEnvEntries(envEntries.filter((_, j) => j !== i))
                          }
                        >
                          <TrashIcon
                            className="size-3.5 text-muted"
                            weight="light"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        Metadata
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setMetadataEntries([
                            ...metadataEntries,
                            { key: "", value: "" },
                          ])
                        }
                      >
                        <PlusIcon className="size-3.5" weight="light" />
                        Add
                      </Button>
                    </div>
                    {metadataEntries.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder="key"
                          value={entry.key}
                          onChange={(e) => {
                            const updated = [...metadataEntries]
                            updated[i] = { ...entry, key: e.target.value }
                            setMetadataEntries(updated)
                          }}
                          className="flex-1"
                        />
                        <Input
                          placeholder="value"
                          value={entry.value}
                          onChange={(e) => {
                            const updated = [...metadataEntries]
                            updated[i] = { ...entry, value: e.target.value }
                            setMetadataEntries(updated)
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          onClick={() =>
                            setMetadataEntries(
                              metadataEntries.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <TrashIcon
                            className="size-3.5 text-muted"
                            weight="light"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
          </>
        ) : (
          <>
            {/* Language tabs */}
            <LayoutGroup id="create-lang">
              <nav
                className="mx-6 flex items-center gap-1 border-b border-dashed border-border py-2"
                onMouseLeave={() => setHoveredLang(null)}
              >
                {LANGUAGES.map((lang) => {
                  const isActive = language === lang.value
                  const isHovered = hoveredLang === lang.value

                  return (
                    <button
                      key={lang.value}
                      type="button"
                      onClick={() => setLanguage(lang.value)}
                      onMouseEnter={() => setHoveredLang(lang.value)}
                      className={cn(
                        "relative inline-flex cursor-pointer items-center px-3 py-1.5 font-mono text-xs transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {isHovered && (
                        <motion.span
                          className="absolute inset-0 bg-foreground/4"
                          layoutId="create-lang-hover"
                          transition={{
                            type: "spring",
                            bounce: 0.15,
                            duration: 0.4,
                          }}
                        />
                      )}
                      {isActive && !hoveredLang && (
                        <span className="absolute inset-0 bg-foreground/4" />
                      )}
                      {isActive && (
                        <motion.span
                          className="pointer-events-none absolute inset-0"
                          layoutId="create-lang-active"
                          transition={{
                            type: "spring",
                            bounce: 0.15,
                            duration: 0.5,
                          }}
                        >
                          <CornerBrackets size="sm" />
                        </motion.span>
                      )}
                      <span className="relative">{lang.label}</span>
                    </button>
                  )
                })}
              </nav>
            </LayoutGroup>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6 pt-4">
              {/* Step 1: Install */}
              <div className="space-y-2">
                <span className="block text-sm font-medium text-foreground">
                  Install SDK
                </span>
                <div className="flex items-start border border-dashed border-border bg-background px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <HighlightedCode
                      code={INSTALL_COMMANDS[language]}
                      lang="bash"
                    />
                  </div>
                  <CopyButton text={INSTALL_COMMANDS[language]} />
                </div>
              </div>

              {/* Step 2: Create */}
              <div className="space-y-2">
                <span className="block text-sm font-medium text-foreground">
                  Create Sandbox
                </span>
                <div className="flex items-start border border-dashed border-border bg-background px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <HighlightedCode
                      code={getCreateSnippet(language)}
                      lang={language}
                    />
                  </div>
                  <CopyButton text={getCreateSnippet(language)} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  )
}
