import { beforeEach, expect, it, vi } from "vitest"

import { ycOnboardingDestination } from "./onboarding"
import { ids } from "./test-fixtures"

const { request, offer } = vi.hoisted(() => ({
  request: vi.fn(),
  offer: vi.fn(),
}))
vi.mock("./acceptance-api", () => ({
  journeyEnabled: () => true,
  readOffer: offer,
}))
vi.mock("@/lib/yc-claims", () => ({ ycRequest: request }))
const context = {
  userId: ids.user,
  teamKey: `use:${ids.team}`,
  state: "selecting" as const,
  offer: null,
  requestedOffer: "yc_2026" as const,
}
beforeEach(() => {
  vi.stubEnv("YC_CONSOLE_JOURNEY_ENABLED", "true")
  offer.mockReset().mockRejectedValue(new Error("existing contract"))
  request.mockReset().mockResolvedValue({ claims: [] })
})
it("does not use a requested offer parameter to replace normal plan selection", async () =>
  expect(await ycOnboardingDestination(context)).toBeNull())
it("routes only the current team's approved claim", async () => {
  offer.mockResolvedValue({})
  request.mockImplementation(async (operation) =>
    operation === "claims"
      ? {
          claims: [
            {
              id: ids.claim,
              state: "bound",
              team_id: ids.team,
              home_region: "use",
            },
          ],
        }
      : { state: "activation_pending" },
  )
  expect(await ycOnboardingDestination(context)).toBe(
    `/yc/accept?claim=${ids.claim}`,
  )
  expect(
    await ycOnboardingDestination({ ...context, teamKey: `usw:${ids.team}` }),
  ).toBeNull()
})
it("preserves ordinary selection after rejection and fails visibly on unknown authority", async () => {
  request.mockResolvedValue({
    claims: [
      { id: ids.claim, state: "rejected", team_id: null, home_region: null },
    ],
  })
  expect(await ycOnboardingDestination(context)).toBeNull()
  request.mockRejectedValue(new Error("unavailable"))
  await expect(ycOnboardingDestination(context)).rejects.toThrow()
})

it("keeps an existing contract on the legacy claim journey", async () => {
  request.mockImplementation(async (operation) =>
    operation === "claims"
      ? {
          claims: [
            {
              id: ids.claim,
              state: "bound",
              team_id: ids.team,
              home_region: "use",
            },
          ],
        }
      : { state: "active", contract_id: ids.assignment },
  )
  expect(await ycOnboardingDestination(context)).toBe("/yc/claim")
})
