import { describe, expect, it } from "vitest"

import type { TeamPlan } from "@/lib/api/billing-v2"

import { planBadge } from "./plan-badge"

const plan = (kind: TeamPlan["kind"], name: string) =>
  ({ kind, name }) as TeamPlan

describe("planBadge", () => {
  it.each([
    ["a team on its trial", null, "trial", { label: "Trial", paid: false }],
    ["Free", plan("free", "Free"), null, { label: "Free", paid: false }],
    [
      "Starter",
      plan("prepaid", "Starter"),
      null,
      { label: "Starter", paid: true },
    ],
    [
      "Developer",
      plan("subscription", "Developer"),
      null,
      { label: "Developer", paid: true },
    ],
    ["Pro", plan("subscription", "Pro"), null, { label: "Pro", paid: true }],
    [
      "a custom contract",
      plan("custom", "Acme deal"),
      null,
      { label: "Enterprise", paid: true },
    ],
    [
      "legacy pay-as-you-go with no plan",
      null,
      null,
      { label: "PAYG", paid: false },
    ],
    [
      "a legacy pay-as-you-go plan",
      plan("legacy_payg", "Pay as you go"),
      null,
      { label: "PAYG", paid: false },
    ],
  ] as const)("labels %s", (_name, p, entry, want) => {
    expect(planBadge(p, entry)).toEqual(want)
  })

  it.each([
    ["while the plan loads", undefined, null],
    ["while a paid plan activates", null, "activating"],
    ["once a trial has ended", null, "trial_ended"],
    ["while card setup is pending", null, "payment_failed"],
  ] as const)("shows nothing %s", (_name, p, entry) => {
    expect(planBadge(p, entry)).toBeNull()
  })
})
