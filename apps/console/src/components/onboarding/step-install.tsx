"use client"

import { Button } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { ONBOARDING_EVENTS } from "@/lib/posthog/events"
import { CodeBlock } from "../code-block"

interface StepInstallProps {
  onComplete: () => void
}

export function StepInstall({ onComplete }: StepInstallProps) {
  const posthog = usePostHog()
  return (
    <div className="px-4 pb-6 pt-6 space-y-2">
      <p className="text-muted text-sm">
        Install Superserve to deploy agents from your terminal.
      </p>

      <CodeBlock
        command="curl -fsSL https://superserve.ai/install | sh"
        eventName="install_command_copied"
      />

      <p className="text-muted text-sm mt-4">
        Then log in to connect your account:
      </p>

      <CodeBlock command="superserve login" eventName="login_command_copied" />

      <div className="mt-8">
        <Button
          onClick={() => {
            posthog.capture(ONBOARDING_EVENTS.STEP_COMPLETED, { step: 1 })
            onComplete()
          }}
          size="sm"
        >
          Mark as done
        </Button>
      </div>
    </div>
  )
}
