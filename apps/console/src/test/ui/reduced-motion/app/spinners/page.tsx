"use client"

import { Spinner as UiSpinner } from "@superserve/ui"

import { Spinner } from "@/components/icons"

import { FixtureShell } from "../fixture-shell"

export default function Page() {
  return (
    <FixtureShell>
      <div className="flex items-center gap-12 p-8">
        <div className="flex items-center gap-3" data-testid="console-spinner">
          <Spinner className="border-foreground" />
          <span className="text-sm">Console Spinner (CSS spin)</span>
        </div>
        <div className="flex items-center gap-3" data-testid="ui-spinner">
          <UiSpinner size="lg" />
          <span className="text-sm">@superserve/ui Spinner (animate-spin)</span>
        </div>
      </div>
    </FixtureShell>
  )
}
