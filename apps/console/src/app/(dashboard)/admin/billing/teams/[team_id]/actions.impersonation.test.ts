import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: vi.fn(),
}))

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { createServerClient } from "@/lib/supabase/server"

import {
  assignTeamPlanAction,
  grantStaffCreditAction,
  requestPlanChangeAction,
  undoPlanChangeAction,
} from "./actions"

const team = "22222222-2222-4222-8222-222222222222"
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv("SANDBOX_API_URL", "https://api.example.com")
  vi.stubEnv("INTERNAL_API_TOKEN", "internal-token")
  vi.stubEnv("OPERATOR_API_TOKEN", "operator-token")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "ops@superserve.ai",
            app_metadata: {
              provider: "google",
              providers: ["google"],
              permissions: ["platform:billing:read", "platform:billing:write"],
            },
          },
        },
      }),
    },
  } as never)
  vi.mocked(getImpersonationTeamId).mockResolvedValue(team)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it("refuses every billing write while impersonating a team", async () => {
  const refused = { kind: "read_only_impersonation" }
  expect(
    await requestPlanChangeAction({
      region: "use",
      teamId: team,
      idempotencyKey: "key-1",
      targetPlan: "free",
      reason: "downgrade",
    }),
  ).toEqual(refused)
  expect(
    await assignTeamPlanAction({
      region: "use",
      teamId: team,
      idempotencyKey: "key-2",
      versionId: "44444444-4444-4444-8444-444444444444",
      reason: "enterprise agreement",
    }),
  ).toEqual(refused)
  expect(
    await undoPlanChangeAction({
      region: "use",
      teamId: team,
      changeId: "33333333-3333-4333-8333-333333333333",
      reason: "r",
    }),
  ).toEqual(refused)
  expect(
    await grantStaffCreditAction({
      region: "use",
      teamId: team,
      idempotencyKey: "k",
      amountCents: 100,
      reason: "r",
    }),
  ).toEqual(refused)
  expect(fetchMock).not.toHaveBeenCalled()
})
