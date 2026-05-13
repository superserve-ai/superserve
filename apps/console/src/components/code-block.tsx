"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { usePostHog } from "posthog-js/react"
import { useState } from "react"

interface CodeBlockProps {
  command: string
  eventName?: string
}

export function CodeBlock({ command, eventName }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const posthog = usePostHog()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      if (posthog && eventName) {
        posthog.capture(eventName, { command })
      }
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.warn("Failed to copy:", err)
    }
  }

  return (
    <div className="flex items-center border border-border bg-background px-4 py-3.5">
      <code className="flex-1 overflow-x-auto font-mono text-sm text-foreground/80">
        <span className="mr-2 text-foreground/70 select-none">$</span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="ml-3 shrink-0 text-muted transition-colors hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="h-4 w-4 text-success" weight="light" />
        ) : (
          <CopyIcon className="h-4 w-4" weight="light" />
        )}
      </button>
    </div>
  )
}
