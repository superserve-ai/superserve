import { generateKeyPairSync } from "node:crypto"

import { beforeEach, expect, it, vi } from "vitest"

import { acceptOffer, readOffer } from "./acceptance-api"
import { ids, offered } from "./test-fixtures"

const f = vi.hoisted(() => ({
  user: vi.fn(),
  claims: vi.fn(),
  teams: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock("@/lib/yc-claims", () => ({
  ycAccount: f.user,
  ycRequest: f.claims,
  ycTeams: f.teams,
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.example.com" }),
}))
beforeEach(() => {
  vi.stubEnv("YC_CONSOLE_JOURNEY_ENABLED", "true")
  vi.stubEnv(
    "PROMOTION_ACCOUNT_PRIVATE_KEY",
    generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
  )
  vi.stubGlobal("fetch", f.fetch)
  f.fetch
    .mockReset()
    .mockImplementation(async () => new Response(JSON.stringify(offered())))
  f.user.mockReset().mockResolvedValue({ id: ids.user })
  f.claims.mockReset().mockResolvedValue({
    claims: [
      {
        id: ids.claim,
        state: "bound",
        claimed_user_id: ids.user,
        team_id: ids.team,
        home_region: "use",
      },
    ],
  })
  f.teams.mockReset().mockResolvedValue([{ teamId: ids.team, region: "use" }])
})
it("signs only server-authorized actor/team and exact acceptance pins", async () => {
  const offer = offered()
  const input = {
    claim_id: ids.claim,
    acceptance_id: ids.acceptance,
    request_id: ids.request,
    approval_revision: offer.approval_revision,
    terms_digest: offer.terms_digest,
    renewal_terms_digest: offer.renewal_terms_digest,
  }
  await acceptOffer(input)
  const [url, options] = f.fetch.mock.calls[0]
  expect(url.pathname).toBe("/internal/yc/account/offers/accept")
  expect(JSON.parse(options.body)).toEqual({ ...input, team_id: ids.team })
  const jwt = JSON.parse(
    Buffer.from(
      options.headers["X-YC-Acceptance-Assertion"].split(".")[1],
      "base64url",
    ).toString(),
  )
  expect(jwt).toMatchObject({
    aud: "yc-acceptance",
    sub: ids.user,
    operation: "accept",
    method: "POST",
  })
  expect(jwt.exp - jwt.iat).toBe(60)
})
it.each([
  "disabled",
  "signed_out",
  "forwarded_claim",
  "unbound",
  "wrong_team",
  "changed_owner",
])("does not dispatch for %s", async (scenario) => {
  if (scenario === "disabled") vi.stubEnv("YC_CONSOLE_JOURNEY_ENABLED", "false")
  if (scenario === "signed_out") f.user.mockResolvedValue(null)
  if (scenario === "forwarded_claim") f.claims.mockResolvedValue({ claims: [] })
  if (scenario === "wrong_team")
    f.teams.mockResolvedValue([{ teamId: ids.team, region: "usw" }])
  if (scenario === "unbound" || scenario === "changed_owner")
    f.claims.mockResolvedValue({
      claims: [
        {
          id: ids.claim,
          state: scenario === "unbound" ? "manual_review" : "bound",
          claimed_user_id:
            scenario === "changed_owner" ? ids.request : ids.user,
          team_id: ids.team,
          home_region: "use",
        },
      ],
    })
  await expect(readOffer(ids.claim)).rejects.toThrow()
  expect(f.fetch).not.toHaveBeenCalled()
})
it("rejects a cross-tenant response and changed disclosure", async () => {
  f.fetch.mockResolvedValue(
    new Response(JSON.stringify(offered({ team_id: ids.request }))),
  )
  await expect(readOffer(ids.claim)).rejects.toMatchObject({
    kind: "forbidden",
  })
  f.fetch.mockResolvedValue(
    new Response(JSON.stringify(offered({ terms_digest: "c".repeat(64) }))),
  )
  await expect(
    acceptOffer({
      claim_id: ids.claim,
      acceptance_id: ids.acceptance,
      request_id: ids.request,
      approval_revision: 3,
      terms_digest: "a".repeat(64),
      renewal_terms_digest: "b".repeat(64),
    }),
  ).rejects.toMatchObject({ kind: "conflict" })
})
it("treats a lost response as unknown and never replays a write automatically", async () => {
  f.fetch.mockRejectedValue(new Error("lost"))
  await expect(readOffer(ids.claim)).rejects.toMatchObject({
    kind: "unavailable",
  })
  expect(f.fetch).toHaveBeenCalledTimes(1)
})

it.each([
  ["revocation_pending", 1, "financial_revocation_pending"],
  ["revoked", 0, "financial_revoked"],
] as const)(
  "projects financial %s after checking the bound actor and team",
  async (state, pending, expected) => {
    f.claims.mockResolvedValue({
      claims: [
        {
          id: ids.claim,
          state: "revoked",
          claimed_user_id: ids.user,
          team_id: ids.team,
          home_region: "use",
          financial_authority: {
            kind: "accepted_offer",
            state,
            pending_invalidations: pending,
          },
        },
      ],
    })
    await expect(readOffer(ids.claim)).rejects.toMatchObject({
      state: expected,
    })
    expect(f.fetch).not.toHaveBeenCalled()
    f.teams.mockResolvedValue([])
    await expect(readOffer(ids.claim)).rejects.toMatchObject({
      kind: "forbidden",
    })
  },
)
it("preserves legacy revocation when there is no automated shared acceptance", async () => {
  f.claims.mockResolvedValue({
    claims: [
      {
        id: ids.claim,
        state: "revoked",
        financial_authority: null,
        team_id: null,
        home_region: null,
        claimed_user_id: null,
      },
    ],
  })
  await expect(readOffer(ids.claim)).rejects.toMatchObject({ state: "revoked" })
  expect(f.fetch).not.toHaveBeenCalled()
})
