import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ apiClient: api }))

import {
  previewPlanChange,
  schedulePlanChange,
  undoPlanChange,
} from "./plan-changes"

const limits = {
  max_concurrent: 1,
  max_vcpu: 1,
  max_memory_mib: 1024,
  max_disk_mib: 4096,
  max_templates: null,
}
const change = {
  id: "34971786-dd50-492b-b934-306b63764c4b",
  target_plan_key: "free",
  target_display_name: "Free",
  target_kind: "free",
  effective_at: "2026-11-01T00:00:00.123456789Z",
  pauses_running: true,
  state: "scheduled",
  undoable: true,
  limits,
}
const previewToken = "a".repeat(64)

beforeEach(() => api.mockReset())

describe("customer plan changes", () => {
  it("requests and parses the bound flat preview contract", async () => {
    const preview = {
      target_plan_key: "free",
      target_display_name: "Free",
      target_kind: "free",
      timing: "end_of_billing_period",
      effective_at: "2026-11-01T00:00:00.123456789Z",
      pauses_running: true,
      limits,
      preview_token: previewToken,
    }
    api.mockResolvedValue(preview)
    expect(await previewPlanChange("free", "use:team-a")).toEqual(preview)
    expect(api).toHaveBeenCalledWith(
      "/billing/plan-change-preview?target_plan=free&expected_team=use%3Ateam-a",
      { cache: "no-store" },
    )
  })

  it("sends consent and parses the authoritative flat change response", async () => {
    api.mockResolvedValue(change)
    expect(
      await schedulePlanChange(
        "free",
        "use:team-a",
        "operation-1",
        previewToken,
        true,
        change.effective_at,
      ),
    ).toEqual(change)
    expect(api).toHaveBeenCalledWith(
      "/billing/plan-changes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          target_plan: "free",
          expected_team: "use:team-a",
          idempotency_key: "operation-1",
          preview_token: previewToken,
          confirm_pauses_running: true,
          expected_effective_at: change.effective_at,
        }),
      }),
    )
  })

  it("omits the date precondition for immediate changes", async () => {
    api.mockResolvedValue({ ...change, state: "applied" })
    await schedulePlanChange(
      "free",
      "use:team-a",
      "immediate-1",
      previewToken,
      true,
    )
    const body = JSON.parse(api.mock.calls[0][1].body)
    expect(body).not.toHaveProperty("expected_effective_at")
    expect(body.preview_token).toBe(previewToken)
  })

  it("undoes the identified change and parses its flat result", async () => {
    api.mockResolvedValue({ ...change, state: "undone", undoable: false })
    expect(await undoPlanChange(change.id, "use:team-a")).toMatchObject({
      id: change.id,
      state: "undone",
    })
    expect(api).toHaveBeenCalledWith(
      `/billing/plan-changes/${change.id}/undo`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_team: "use:team-a" }),
      }),
    )
  })

  it("rejects a plan envelope in place of a completed write response", async () => {
    api.mockResolvedValue({ plan: null, period: {}, pending_change: null })
    await expect(
      schedulePlanChange(
        "free",
        "use:team-a",
        "operation-1",
        previewToken,
        true,
        change.effective_at,
      ),
    ).rejects.toThrow()
  })
})
