"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { CodeBlock } from "@/components/code-block"
import { CornerBrackets } from "@/components/corner-brackets"

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
        <CornerBrackets size="md" />

        <span className="font-mono text-sm leading-none tracking-tight text-muted">
          {formattedNumber}.
        </span>
        <span className="flex-1 text-sm leading-none tracking-tight text-foreground">
          {title}
        </span>
        {completed && (
          <CheckCircleIcon className="size-4 text-success" weight="fill" />
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
