"use client"

import { CheckCircle } from "@phosphor-icons/react"
import { CodeBlock } from "@/components/code-block"

interface GetStartedStepProps {
  stepNumber: number
  title: string
  description: string
  command: string
  completed?: boolean
}

export function GetStartedStep({
  stepNumber,
  title,
  description,
  command,
  completed,
}: GetStartedStepProps) {
  const formattedNumber = String(stepNumber).padStart(2, "0")

  return (
    <div className="space-y-4">
      {/* Step header bar */}
      <div className="relative flex items-center gap-2.5 bg-surface-hover px-3.5 py-4">
        {/* Corner brackets */}
        <span className="absolute top-0 left-0 h-2 w-2 border-t border-l border-foreground/20" />
        <span className="absolute top-0 right-0 h-2 w-2 border-t border-r border-foreground/20" />
        <span className="absolute bottom-0 left-0 h-2 w-2 border-b border-l border-foreground/20" />
        <span className="absolute bottom-0 right-0 h-2 w-2 border-b border-r border-foreground/20" />

        <span className="font-mono text-sm leading-none tracking-tight text-muted">
          {formattedNumber}.
        </span>
        <span className="flex-1 text-sm leading-none tracking-tight text-foreground">
          {title}
        </span>
        {completed && (
          <CheckCircle className="size-4 text-success" weight="fill" />
        )}
      </div>

      {/* Description */}
      <p className="pl-6 text-sm leading-none tracking-tight text-muted">
        {description}
      </p>

      {/* Code snippet */}
      <div className="pl-6">
        <CodeBlock command={command} />
      </div>
    </div>
  )
}
