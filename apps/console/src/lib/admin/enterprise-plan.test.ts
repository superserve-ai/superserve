import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequest = vi.fn()
vi.mock("@/lib/admin/billing-api", () => ({
  adminBillingRequest: (...args: unknown[]) => mockRequest(...args),
}))

import {
  assignEnterprisePlan,
  listEnterprisePlanVersions,
} from "./enterprise-plan"

const TEAM = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "applicant@example.com",
  region: "use",
}

describe("Enterprise plan assignment", () => {
  beforeEach(() => mockRequest.mockReset())

  it("assigns the chosen version with a key stable for the applicant", async () => {
    mockRequest.mockResolvedValue({ id: "assignment-1" })
    await assignEnterprisePlan(TEAM, "applicant-1", "version-1")
    await assignEnterprisePlan(TEAM, "applicant-1", "version-1")

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
      region: "use",
      method: "POST",
      path: `/internal/teams/${TEAM.id}/billing/plan-assignments`,
      body: {
        idempotency_key: "enterprise-approval:applicant-1",
        version_id: "version-1",
        reason: expect.any(String),
      },
    })
    expect(mockRequest.mock.calls[1][0].body).toEqual(
      mockRequest.mock.calls[0][0].body,
    )
  })

  it("offers only published, staff-assigned, fee-less versions", async () => {
    const plan = (overrides: Record<string, unknown>) => ({
      id: "v",
      display_name: "Plan",
      state: "published",
      pricing_version: "v2",
      kind: "custom",
      self_serve: false,
      display_only: false,
      monthly_fee_cents: null,
      annual_fee_cents: null,
      ...overrides,
    })
    mockRequest.mockResolvedValue({
      plans: [
        plan({ id: "enterprise", display_name: "Enterprise" }),
        plan({ id: "contact-card", display_only: true }),
        plan({ id: "draft", state: "draft" }),
        plan({ id: "legacy-enterprise", pricing_version: "legacy" }),
        plan({ id: "non-custom", kind: "free" }),
        plan({ id: "free", self_serve: true }),
        plan({ id: "pro", monthly_fee_cents: 25000 }),
      ],
    })
    await expect(listEnterprisePlanVersions()).resolves.toEqual([
      { id: "enterprise", name: "Enterprise" },
    ])
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
      path: "/internal/billing/catalog",
    })
  })
})
