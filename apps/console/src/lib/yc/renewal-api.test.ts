import { beforeEach, expect, it, vi } from "vitest"

import { readRenewal, submitRenewal } from "./renewal-api"
import { ids, offered, renewal } from "./test-fixtures"

const f = vi.hoisted(() => ({
  resolve: vi.fn(),
  status: vi.fn(),
  post: vi.fn(),
}))
vi.mock("./acceptance-api", async (original) => ({
  ...(await original<typeof import("./acceptance-api")>()),
  resolveAcceptedClaim: f.resolve,
  readOfferStatus: f.status,
}))
vi.mock("./customer-request", async (original) => ({
  ...(await original<typeof import("./customer-request")>()),
  postYCAccount: f.post,
}))
beforeEach(() => {
  vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", "true")
  f.resolve.mockReset().mockResolvedValue({
    user: { id: ids.user },
    claim: { id: ids.claim, team_id: ids.team, home_region: "use" },
  })
  f.status.mockReset().mockResolvedValue(
    offered({
      accepted_at: "2026-10-20T12:00:00Z",
      assignment_id: ids.assignment,
    }),
  )
  f.post.mockReset().mockResolvedValue(renewal())
})
it("asks the backend for the actual boundary without computing it from acceptance time", async () => {
  await readRenewal(ids.claim)
  expect(f.post).toHaveBeenCalledWith(ids.user, "use", "renewals", "status", {
    team_id: ids.team,
    assignment_id: ids.assignment,
  })
})
it("pins the displayed boundary and revisions while omitting client actor and economics", async () => {
  const value = renewal()
  await submitRenewal({
    claim_id: ids.claim,
    assignment_id: ids.assignment,
    acceptance_id: ids.acceptance,
    expected_approval_revision: 3,
    expected_choice_revision: 1,
    intended_boundary: value.intended_boundary,
    request_id: ids.request,
    choice: "free",
  })
  const body = f.post.mock.calls[0][4]
  expect(body).toEqual({
    team_id: ids.team,
    assignment_id: ids.assignment,
    acceptance_id: ids.acceptance,
    expected_approval_revision: 3,
    expected_choice_revision: 1,
    intended_boundary: value.intended_boundary,
    request_id: ids.request,
    choice: "free",
  })
})
it("blocks absent integration before dispatch", async () => {
  vi.stubEnv("YC_CONSOLE_RENEWAL_ENABLED", "false")
  await expect(readRenewal(ids.claim)).rejects.toThrow()
  expect(f.post).not.toHaveBeenCalled()
})
it("rejects a stale approval before a write or a changed assignment response", async () => {
  await expect(
    submitRenewal({
      claim_id: ids.claim,
      assignment_id: ids.assignment,
      acceptance_id: ids.acceptance,
      expected_approval_revision: 2,
      expected_choice_revision: 1,
      intended_boundary: renewal().intended_boundary,
      request_id: ids.request,
      choice: "free",
    }),
  ).rejects.toMatchObject({ kind: "conflict" })
  expect(f.post).not.toHaveBeenCalled()
  f.post.mockResolvedValue(renewal({ assignment_id: ids.request }))
  await expect(readRenewal(ids.claim)).rejects.toMatchObject({
    kind: "conflict",
  })
})
