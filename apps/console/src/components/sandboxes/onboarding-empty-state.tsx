"use client"

import { CheckIcon, CopyIcon, PlusIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import Link from "next/link"
import { useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"

const INSTALL_COMMAND = "npm install @superserve/sdk"

const CONNECT_SNIPPET = `import { Superserve } from "@superserve/sdk"

const client = new Superserve({ apiKey: "ss_live_..." })
const sandbox = await client.sandboxes.create()
await sandbox.exec("echo 'Hello!'")
await sandbox.stop()`

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
      className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-3.5" weight="light" />
      )}
    </button>
  )
}

function StepHeader({
  stepNumber,
  title,
}: {
  stepNumber: number
  title: string
}) {
  return (
    <div className="relative flex items-center gap-2.5 bg-surface-hover px-3.5 py-3">
      <CornerBrackets size="md" />
      <span className="font-mono text-sm leading-none tracking-tight text-muted">
        {String(stepNumber).padStart(2, "0")}.
      </span>
      <span className="text-sm leading-none tracking-tight text-foreground">
        {title}
      </span>
    </div>
  )
}

interface OnboardingEmptyStateProps {
  onCreateClick: () => void
}

export function OnboardingEmptyState({
  onCreateClick,
}: OnboardingEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-lg space-y-6 px-6 py-10">
        {/* Step 1: Install the SDK */}
        <div className="space-y-3">
          <StepHeader stepNumber={1} title="Install the SDK" />
          <div className="flex items-center bg-background border border-border px-4 py-3">
            <code className="flex-1 font-mono text-sm text-foreground/80">
              <span className="text-foreground/70 mr-2 select-none">$</span>
              {INSTALL_COMMAND}
            </code>
            <CopyButton text={INSTALL_COMMAND} />
          </div>
        </div>

        {/* Step 2: Create a Sandbox */}
        <div className="space-y-3">
          <StepHeader stepNumber={2} title="Create a Sandbox" />
          <p className="text-xs leading-relaxed text-muted">
            Spin up a cloud sandbox to run code in an isolated environment.
          </p>
          <Button size="sm" onClick={onCreateClick}>
            <PlusIcon className="size-3.5" weight="light" />
            Create Sandbox
          </Button>
        </div>

        {/* Step 3: Connect & Run */}
        <div className="space-y-3">
          <StepHeader stepNumber={3} title="Connect & Run" />
          <div className="relative bg-background border border-border px-4 py-3">
            <div className="absolute top-3 right-4">
              <CopyButton text={CONNECT_SNIPPET} />
            </div>
            <code className="block font-mono text-sm text-foreground/80 whitespace-pre overflow-x-auto pr-6">
              {CONNECT_SNIPPET}
            </code>
          </div>
        </div>

        {/* Guide link */}
        <div className="pt-2 text-center">
          <Link
            href="/get-started/"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            View full guide &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}
