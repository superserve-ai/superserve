"use client"

import { CheckIcon, CopyIcon, KeyIcon, PlusIcon } from "@phosphor-icons/react"
import { Button, cn, HighlightedCode, useToast } from "@superserve/ui"
import { useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { PageHeader } from "@/components/page-header"
import { useCreateApiKey } from "@/hooks/use-api-keys"

type Language = "typescript" | "python"

const INSTALL_COMMANDS: Record<Language, string> = {
  typescript: "npm install @superserve/sdk",
  python: "pip install superserve",
}

function getSnippet(language: Language, apiKey: string): string {
  const key = apiKey || "ss_live_xxxxxxxx..."

  if (language === "typescript") {
    return `import { Superserve } from "@superserve/sdk"

const client = new Superserve({ apiKey: "${key}" })

const sandbox = await client.sandboxes.create({
  snapshot: "superserve/base",
})

const result = await sandbox.exec("echo 'Hello from Superserve!'")
console.log(result.stdout)

await sandbox.stop()`
  }

  return `from superserve import Superserve

client = Superserve(api_key="${key}")

sandbox = client.sandboxes.create(
    snapshot="superserve/base",
)

result = sandbox.exec("echo 'Hello from Superserve!'")
print(result.stdout)

sandbox.stop()`
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

function StepHeader({
  stepNumber,
  title,
  completed,
}: {
  stepNumber: number
  title: string
  completed?: boolean
}) {
  return (
    <div className="relative flex items-center gap-2.5 bg-surface-hover px-3.5 py-4">
      <CornerBrackets size="md" />
      <span className="font-mono text-sm leading-none tracking-tight text-muted">
        {String(stepNumber).padStart(2, "0")}.
      </span>
      <span className="flex-1 text-sm leading-none tracking-tight text-foreground">
        {title}
      </span>
      {completed && (
        <CheckIcon className="size-4 text-success" weight="light" />
      )}
    </div>
  )
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="flex items-start bg-background border border-dashed border-border px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <HighlightedCode code={code} lang={lang} />
      </div>
      <CopyButton text={code} />
    </div>
  )
}

export default function GetStartedPage() {
  const [language, setLanguage] = useState<Language>("typescript")
  const createKeyMutation = useCreateApiKey()
  const createdKey = createKeyMutation.data
    ? {
        full: createKeyMutation.data.key,
        prefix: createKeyMutation.data.prefix,
      }
    : null
  const [copied, setCopied] = useState(false)
  const { addToast } = useToast()

  const handleCreateKey = () => {
    createKeyMutation.mutate("Get Started Key")
  }

  const handleCopyKey = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.full)
    setCopied(true)
    addToast("API key copied to clipboard", "success")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Get Started" />

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm leading-none tracking-tight text-muted">
              Install the SDK and create your first sandbox
            </p>

            {/* Language Toggle */}
            <div className="flex items-center border border-border">
              <button
                type="button"
                onClick={() => setLanguage("typescript")}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer",
                  language === "typescript"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                TypeScript
              </button>
              <button
                type="button"
                onClick={() => setLanguage("python")}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer",
                  language === "python"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                Python
              </button>
            </div>
          </div>

          <div className="mt-10 space-y-10">
            {/* Step 1: Install SDK */}
            <div className="space-y-4">
              <StepHeader stepNumber={1} title="Install the SDK" />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Add the Superserve SDK to your project
              </p>
              <div className="pl-6">
                <CodeBlock code={INSTALL_COMMANDS[language]} lang="bash" />
              </div>
            </div>

            {/* Step 2: Create API Key */}
            <div className="space-y-4">
              <StepHeader
                stepNumber={2}
                title="Create an API Key"
                completed={!!createdKey}
              />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Generate an API key to authenticate with the SDK
              </p>
              <div className="pl-6">
                {createdKey ? (
                  <div className="flex items-center gap-2 bg-background border border-border px-4 py-3.5">
                    <KeyIcon
                      className="size-4 text-muted shrink-0"
                      weight="light"
                    />
                    <code className="flex-1 text-sm font-mono text-foreground/80 break-all">
                      {createdKey.full}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      aria-label={copied ? "Copied" : "Copy API key"}
                      className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
                    >
                      {copied ? (
                        <CheckIcon
                          className="size-4 text-success"
                          weight="light"
                        />
                      ) : (
                        <CopyIcon className="size-4" weight="light" />
                      )}
                    </button>
                  </div>
                ) : (
                  <Button
                    onClick={handleCreateKey}
                    size="sm"
                    disabled={createKeyMutation.isPending}
                  >
                    <PlusIcon className="size-3.5" weight="light" />
                    {createKeyMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                )}
              </div>
            </div>

            {/* Step 3: Create & Run Sandbox */}
            <div className="space-y-4">
              <StepHeader stepNumber={3} title="Create and run a sandbox" />
              <p className="pl-6 text-sm leading-none tracking-tight text-muted">
                Use the SDK to spin up a sandbox and execute code
              </p>
              <div className="pl-6">
                <CodeBlock
                  code={getSnippet(language, createdKey?.full ?? "")}
                  lang={language}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
