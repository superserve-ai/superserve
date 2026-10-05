import { beforeEach, describe, expect, it, vi } from "vitest"

const rpc = vi.fn()
vi.mock("@/lib/cells", () => ({
  cellFor: (region: string) => ({
    createAdminClient: () => ({
      rpc: (name: string, args: unknown) => rpc(region, name, args),
    }),
  }),
}))

import { publishPromotionIdentity } from "./promotion-identity"

const revision = "2024-01-01T00:00:00Z" // A valid unchanged Auth user may be old.
const user = {
  id: "actor",
  email: "Raw+Tag@Example.COM",
  email_confirmed_at: revision,
  updated_at: revision,
}

describe("promotion identity publication", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({
      data: [{ outcome: "applied", evidence_version: "evidence-id" }],
      error: null,
    })
  })

  it("sends raw authenticated evidence to the selected cell", async () => {
    const observed = new Date().toISOString()
    await publishPromotionIdentity("usw", "actor", user as never, observed)
    expect(rpc).toHaveBeenCalledWith(
      "usw",
      "upsert_profile_with_promotion_identity",
      {
        p_user_id: "actor",
        p_email: "Raw+Tag@Example.COM",
        p_email_verified: true,
        p_auth_updated_at: revision,
        p_observed_at: observed,
      },
    )
  })

  it("accepts a replayed publication for an idempotent retry", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "replayed", evidence_version: "evidence-id" }],
      error: null,
    })

    await expect(
      publishPromotionIdentity(
        "usw",
        "actor",
        user as never,
        new Date().toISOString(),
      ),
    ).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledOnce()
  })

  it("represents missing email as ineligible evidence", async () => {
    await publishPromotionIdentity(
      "use",
      "actor",
      { ...user, email: undefined, email_confirmed_at: undefined } as never,
      new Date().toISOString(),
    )
    expect(rpc.mock.calls[0][2]).toMatchObject({
      p_email: null,
      p_email_verified: false,
    })
  })

  it("retains a present raw email without treating it as verified", async () => {
    await publishPromotionIdentity(
      "use",
      "actor",
      { ...user, email_confirmed_at: undefined } as never,
      new Date().toISOString(),
    )
    expect(rpc.mock.calls[0][2]).toMatchObject({
      p_email: "Raw+Tag@Example.COM",
      p_email_verified: false,
    })
  })

  it("ignores user metadata that claims an unverified email is verified", async () => {
    await publishPromotionIdentity(
      "use",
      "actor",
      {
        ...user,
        email_confirmed_at: undefined,
        user_metadata: { email_verified: true },
      } as never,
      new Date().toISOString(),
    )
    expect(rpc.mock.calls[0][2]).toMatchObject({
      p_email: "Raw+Tag@Example.COM",
      p_email_verified: false,
    })
  })

  it("rejects a mismatched actor, stale or future observation, or missing source revision", async () => {
    await expect(
      publishPromotionIdentity(
        "use",
        "other",
        user as never,
        new Date().toISOString(),
      ),
    ).rejects.toThrow(/actor mismatch/)
    await expect(
      publishPromotionIdentity(
        "use",
        "actor",
        user as never,
        new Date(Date.now() - 301_000).toISOString(),
      ),
    ).rejects.toThrow(/observation unavailable/)
    await expect(
      publishPromotionIdentity(
        "use",
        "actor",
        user as never,
        new Date(Date.now() + 31_000).toISOString(),
      ),
    ).rejects.toThrow(/observation unavailable/)
    await expect(
      publishPromotionIdentity(
        "use",
        "actor",
        { ...user, updated_at: "" } as never,
        new Date().toISOString(),
      ),
    ).rejects.toThrow(/observation unavailable/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("fails closed on RPC errors and invalid outcomes", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "private" },
    })
    await expect(
      publishPromotionIdentity(
        "use",
        "actor",
        user as never,
        new Date().toISOString(),
      ),
    ).rejects.toThrow("Promotion identity publication failed; please retry")
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "unexpected", evidence_version: "id" }],
      error: null,
    })
    await expect(
      publishPromotionIdentity(
        "use",
        "actor",
        user as never,
        new Date().toISOString(),
      ),
    ).rejects.toThrow("Promotion identity publication failed; please retry")
  })

  it("reports bounded cell and failure classes without identity or provider details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      for (const [code, category] of [
        ["PGRST202", "schema_unavailable"],
        ["22023", "invalid_evidence"],
        ["55000", "authority_unavailable"],
        ["XX000", "persistence_failed"],
      ]) {
        rpc.mockResolvedValueOnce({
          data: null,
          error: {
            code,
            message: "Raw+Tag@Example.COM secret-token SQL parameters",
          },
        })
        await expect(
          publishPromotionIdentity(
            "usw",
            "actor",
            user as never,
            new Date().toISOString(),
          ),
        ).rejects.toThrow("Promotion identity publication failed; please retry")
        expect(log).toHaveBeenLastCalledWith(
          "Promotion identity publication failed",
          {
            operation: "upsert_profile_with_promotion_identity",
            cell: "usw",
            error: category,
          },
        )
      }

      rpc.mockRejectedValueOnce(new Error("secret-token provider failure"))
      await expect(
        publishPromotionIdentity(
          "usw",
          "actor",
          user as never,
          new Date().toISOString(),
        ),
      ).rejects.toThrow("Promotion identity publication failed; please retry")
      expect(log).toHaveBeenLastCalledWith(
        "Promotion identity publication failed",
        {
          operation: "upsert_profile_with_promotion_identity",
          cell: "usw",
          error: "transport_failed",
        },
      )

      rpc.mockResolvedValueOnce({ data: [], error: null })
      await expect(
        publishPromotionIdentity(
          "usw",
          "actor",
          user as never,
          new Date().toISOString(),
        ),
      ).rejects.toThrow("Promotion identity publication failed; please retry")
      expect(log).toHaveBeenLastCalledWith(
        "Promotion identity publication failed",
        {
          operation: "upsert_profile_with_promotion_identity",
          cell: "usw",
          error: "invalid_response",
        },
      )
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /Raw\+Tag@Example\.COM|secret-token|SQL parameters/,
      )
    } finally {
      log.mockRestore()
    }
  })
})
