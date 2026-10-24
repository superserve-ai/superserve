import { describe, expect, it } from "vitest"

import { teamPlanSchema } from "./billing-v2"

const response = {
  plan: {
    plan_key: "starter",
    kind: "prepaid",
    display_name: "Starter",
    limits: {
      max_concurrent: 100,
      max_vcpu: 2,
      max_memory_mib: 4096,
      max_disk_mib: 51200,
      max_templates: null,
    },
    effective_from: "2026-10-23T00:00:00Z",
  },
  period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  pending_change: null,
}

describe("customer plan response", () => {
  it("reads the assignment envelope without inventing monetary terms", () => {
    expect(teamPlanSchema.parse(response)).toMatchObject({
      key: "starter",
      kind: "prepaid",
      name: "Starter",
      limits: response.plan.limits,
      period_start: response.period.start,
      period_end: response.period.end,
      fee_cents: null,
      included_cents: null,
    })
  })

  it("keeps unassigned teams distinct from a Free assignment", () => {
    expect(teamPlanSchema.parse({ ...response, plan: null })).toBeNull()
  })

  it("accepts zero effective limits from the customer endpoint", () => {
    expect(
      teamPlanSchema.parse({
        ...response,
        plan: {
          ...response.plan,
          limits: {
            ...response.plan.limits,
            max_concurrent: 0,
            max_templates: 0,
          },
        },
      })?.limits,
    ).toMatchObject({ max_concurrent: 0, max_templates: 0 })
  })

  it("retains the pending change identity needed for undo", () => {
    const id = "34971786-dd50-492b-b934-306b63764c4b"
    expect(
      teamPlanSchema.parse({
        ...response,
        pending_change: {
          id,
          target_plan_key: "free",
          target_display_name: "Free",
          effective_at: "2026-11-01T00:00:00Z",
          undoable: true,
          pauses_running: true,
        },
      })?.pending_change,
    ).toEqual({
      id,
      plan_key: "free",
      plan_name: "Free",
      effective_at: "2026-11-01T00:00:00Z",
      undoable: true,
      pauses_running: true,
    })
  })
})
