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
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { useCreateSandbox } from "@/hooks/use-sandboxes"
import type { CreateSandboxRequest } from "@/lib/api/types"
import { SANDBOX_EVENTS } from "@/lib/posthog/events"

type Mode = "form" | "code"
type Language = "typescript" | "python"

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
]

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
}

function getCreateSnippet(language: Language): string {
  if (language === "typescript") {
    return `import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "YOUR_API_KEY",
})
console.log(sandbox.id)`
  }

  return `from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox", api_key="YOUR_API_KEY")
print(sandbox.id)`
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

interface FormState {
  name: string
  timeout: string
  allowRules: string[]
  denyRules: string[]
  envEntries: { key: string; value: string }[]
  metadataEntries: { key: string; value: string }[]
}

/**
 * Build the CreateSandboxRequest payload from the dialog's form state.
 *
 * Exported for unit testing. Keeps the network/env/metadata branches in
 * one place so we can assert shape without driving the full dialog UI.
 *
 * Rules:
 *  - `name` is trimmed.
 *  - `timeout` is only included when set (coerced to number).
 *  - `network` is only included when at least one allow or deny rule is
 *    non-empty. Within it, `allow_out` / `deny_out` are each only included
 *    when that specific list has entries.
 *  - `env_vars` / `metadata` are only included when at least one entry has
 *    a non-empty key. Empty string values are allowed but empty keys are
 *    dropped.
 */
export function buildCreateSandboxRequest(
  state: FormState,
): CreateSandboxRequest {
  const allowList = state.allowRules.map((r) => r.trim()).filter(Boolean)
  const denyList = state.denyRules.map((r) => r.trim()).filter(Boolean)
  const hasNetwork = allowList.length > 0 || denyList.length > 0

  const envVars: Record<string, string> = {}
  for (const entry of state.envEntries) {
    const k = entry.key.trim()
    if (k) envVars[k] = entry.value.trim()
  }

  const metadata: Record<string, string> = {}
  for (const entry of state.metadataEntries) {
    const k = entry.key.trim()
    if (k) metadata[k] = entry.value.trim()
  }

  return {
    name: state.name.trim(),
    ...(state.timeout ? { timeout: Number(state.timeout) } : {}),
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
  }
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
    const payload = buildCreateSandboxRequest({
      name,
      timeout,
      allowRules,
      denyRules,
      envEntries,
      metadataEntries,
    })

    posthog.capture(SANDBOX_EVENTS.CREATED, {
      has_timeout: !!timeout,
      has_network_rules: !!payload.network,
      allow_rule_count: payload.network?.allow_out?.length ?? 0,
      deny_rule_count: payload.network?.deny_out?.length ?? 0,
      env_var_count: payload.env_vars
        ? Object.keys(payload.env_vars).length
        : 0,
      metadata_key_count: payload.metadata
        ? Object.keys(payload.metadata).length
        : 0,
      advanced_expanded: showAdvanced,
    })

    createMutation.mutate(payload, {
      onSuccess: (sandbox) => {
        setOpen(false)
        handleReset()
        onCreated?.(sandbox.id)
      },
    })
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

              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div
                    key="advanced"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
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
                              setEnvEntries([
                                ...envEntries,
                                { key: "", value: "" },
                              ])
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
                                setEnvEntries(
                                  envEntries.filter((_, j) => j !== i),
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
                  </motion.div>
                )}
              </AnimatePresence>
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
