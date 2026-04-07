"use client"

import {
  CheckIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  TerminalIcon,
} from "@phosphor-icons/react"
import {
  Button,
  cn,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@superserve/ui"
import { motion } from "motion/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { useApiKeys, useCreateApiKey } from "@/hooks/use-api-keys"

type Language = "typescript" | "python" | "go"

const LANGUAGES: { label: string; value: Language; icon: string }[] = [
  { label: "TypeScript", value: "typescript", icon: "TS" },
  { label: "Python", value: "python", icon: "PY" },
  { label: "Go", value: "go", icon: "GO" },
]

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
  go: "go get github.com/superserve/superserve-go",
}

function getConnectSnippet(
  language: Language,
  apiKey: string,
  sandboxId: string,
): string {
  const key = apiKey || "ss_live_xxxxxxxx..."

  if (language === "typescript") {
    return `import { Superserve } from "@superserve/sdk"

const client = new Superserve({ apiKey: "${key}" })

const sandbox = await client.sandboxes.get("${sandboxId}")
const result = await sandbox.exec("echo 'Hello from Superserve!'")
console.log(result.stdout)`
  }

  if (language === "python") {
    return `from superserve import Superserve

client = Superserve(api_key="${key}")

sandbox = client.sandboxes.get("${sandboxId}")
result = sandbox.exec("echo 'Hello from Superserve!'")
print(result.stdout)`
  }

  return `package main

import (
	"fmt"
	ss "github.com/superserve/superserve-go"
)

func main() {
	client := ss.NewClient("${key}")

	sandbox, _ := client.Sandboxes.Get("${sandboxId}")
	result, _ := sandbox.Exec("echo 'Hello from Superserve!'")
	fmt.Println(result.Stdout)
}`
}

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      aria-label={copied ? "Copied" : (label ?? "Copy")}
      className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
    >
      {copied ? (
        <CheckIcon className="size-4 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-4" weight="light" />
      )}
    </button>
  )
}

interface ConnectSandboxDialogProps {
  sandboxId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectSandboxDialog({
  sandboxId,
  open,
  onOpenChange,
}: ConnectSandboxDialogProps) {
  const router = useRouter()
  const [language, setLanguage] = useState<Language>("typescript")
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const createKeyMutation = useCreateApiKey()
  const { data: existingKeys } = useApiKeys()
  const [copiedKey, setCopiedKey] = useState(false)

  // Check if user has a non-dashboard API key
  const userKey = existingKeys?.find((k) => k.name !== "__console_dashboard__")
  const newlyCreatedKey = createKeyMutation.data?.key ?? ""
  const snippetKey = newlyCreatedKey || (userKey ? "YOUR_API_KEY" : "")
  const hasKey = !!userKey || !!newlyCreatedKey

  const handleCreateKey = () => {
    createKeyMutation.mutate("SDK Key")
  }

  const handleCopyKey = async () => {
    if (!newlyCreatedKey) return
    await navigator.clipboard.writeText(newlyCreatedKey)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to Sandbox</DialogTitle>
        </DialogHeader>

        {/* Language Tabs */}
        <nav
          className="flex items-center gap-1 mx-6 border-b border-dashed border-border py-2"
          onMouseLeave={() => setHoveredTab(null)}
        >
          {LANGUAGES.map((lang) => {
            const isActive = language === lang.value
            const isHovered = hoveredTab === lang.value

            return (
              <button
                key={lang.value}
                type="button"
                onClick={() => setLanguage(lang.value)}
                onMouseEnter={() => setHoveredTab(lang.value)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer",
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {isHovered && (
                  <motion.span
                    className="absolute inset-0 bg-foreground/4"
                    layoutId="connect-lang-hover"
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.4,
                    }}
                  />
                )}
                {isActive && !hoveredTab && (
                  <span className="absolute inset-0 bg-foreground/4" />
                )}
                {isActive && (
                  <motion.span
                    className="absolute inset-0 pointer-events-none"
                    layoutId="connect-lang-active"
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

        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6">
          {/* API Key */}
          {!hasKey && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                API Key
              </span>
              <p className="text-xs text-muted">
                Create an API key to authenticate with the SDK
              </p>
              <Button
                onClick={handleCreateKey}
                variant="outline"
                size="sm"
                disabled={createKeyMutation.isPending}
              >
                <PlusIcon className="size-3.5" weight="light" />
                {createKeyMutation.isPending ? "Creating..." : "Create API Key"}
              </Button>
            </div>
          )}

          {newlyCreatedKey && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">
                API Key
              </span>
              <div className="flex items-center gap-2 bg-background border border-border px-4 py-3">
                <KeyIcon
                  className="size-4 text-muted shrink-0"
                  weight="light"
                />
                <code className="flex-1 text-sm font-mono text-foreground/80 break-all">
                  {newlyCreatedKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  aria-label={copiedKey ? "Copied" : "Copy API key"}
                  className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
                >
                  {copiedKey ? (
                    <CheckIcon className="size-4 text-success" weight="light" />
                  ) : (
                    <CopyIcon className="size-4" weight="light" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Install SDK */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              Install SDK
            </span>
            <div className="flex items-start bg-background border border-dashed border-border px-4 py-3">
              <code className="flex-1 text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre">
                <span className="text-foreground/70 mr-2 select-none">$</span>
                {INSTALL_COMMANDS[language]}
              </code>
              <CopyButton text={INSTALL_COMMANDS[language]} />
            </div>
          </div>

          {/* Connect & Run */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">
              Connect and Run
            </span>
            <div className="flex items-start bg-background border border-dashed border-border px-4 py-3 h-[220px] overflow-y-auto">
              <code className="flex-1 text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre">
                {getConnectSnippet(language, snippetKey, sandboxId)}
              </code>
              <CopyButton
                text={getConnectSnippet(language, snippetKey, sandboxId)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => router.push(`/sandboxes/${sandboxId}/terminal/`)}
          >
            <TerminalIcon className="size-3.5" weight="light" />
            Open Terminal
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
