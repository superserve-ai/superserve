"use client"

import { PlanPickerOptions } from "@/components/billing/plan-picker-options"

import { FixtureShell } from "../fixture-shell"

// The catalog read never answers (plan-actions-stub.ts), so the picker keeps
// its loading state.
export default function Page() {
  return (
    <FixtureShell>
      <div className="flex flex-col items-center p-8" data-testid="plan-picker">
        <PlanPickerOptions
          preselected={null}
          locator={{ account: "acct-fixture", team: "us:team-fixture" }}
        />
      </div>
    </FixtureShell>
  )
}
