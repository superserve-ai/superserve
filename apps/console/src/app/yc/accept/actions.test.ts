import { beforeEach, expect, it, vi } from "vitest"

import { setActiveTeamAction } from "@/lib/api/teams-actions"
import { AcceptanceError, readOfferStatus } from "@/lib/yc/acceptance-api"
import { ids, offered } from "@/lib/yc/test-fixtures"

import { openReadyOfferConsole } from "./actions"

vi.mock("@/lib/yc/acceptance-api", async (original) => ({
  ...(await original<typeof import("@/lib/yc/acceptance-api")>()),
  readOfferStatus: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({ setActiveTeamAction: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
beforeEach(() => vi.resetAllMocks())
it("selects the freshly verified offer team before opening its Console", async () => {
  vi.mocked(readOfferStatus).mockResolvedValue(
    offered({
      state: "funding_ready",
      ready: true,
      accepted_at: "2026-10-21T12:00:00Z",
      assignment_id: ids.assignment,
      operation_id: ids.operation,
    }),
  )
  await expect(openReadyOfferConsole(ids.claim)).rejects.toThrow(
    "redirect:/sandboxes",
  )
  expect(readOfferStatus).toHaveBeenCalledWith(ids.claim)
  expect(setActiveTeamAction).toHaveBeenCalledExactlyOnceWith(ids.team, "use")
})
it.each(["forbidden", "unavailable"] as const)(
  "does not switch teams after %s authority",
  async (kind) => {
    vi.mocked(readOfferStatus).mockRejectedValue(new AcceptanceError(kind))
    await expect(openReadyOfferConsole(ids.claim)).rejects.toThrow()
    expect(setActiveTeamAction).not.toHaveBeenCalled()
  },
)
it.each([
  { state: "funding_pending" as const },
  { state: "funding_ready" as const, held: true },
  { state: "funding_ready" as const, financial_authority: null },
  {
    state: "funding_ready" as const,
    financial_authority: {
      kind: "accepted_offer" as const,
      state: "revocation_pending" as const,
      pending_invalidations: 1,
    },
  },
  {
    state: "funding_ready" as const,
    financial_authority: {
      kind: "accepted_offer" as const,
      state: "revoked" as const,
      pending_invalidations: 0,
    },
  },
])("does not switch teams from stale ready presentation", async (fields) => {
  vi.mocked(readOfferStatus).mockResolvedValue(
    offered({
      ready: true,
      accepted_at: "2026-10-21T12:00:00Z",
      assignment_id: ids.assignment,
      operation_id: ids.operation,
      ...fields,
    }),
  )
  await expect(openReadyOfferConsole(ids.claim)).rejects.toThrow()
  expect(setActiveTeamAction).not.toHaveBeenCalled()
})
