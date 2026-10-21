import { generateKeyPairSync } from "node:crypto"

import type { Session, User } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { readProof, signProof } from "./signed-proof"
import {
  completeStaffGoogle,
  STAFF_INIT_COOKIE,
  STAFF_SESSION_COOKIE,
  verifyStaffSession,
} from "./staff-session"

const f = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  claims: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({ value: f.jar.get(name) }),
    delete: (name: string) => f.jar.delete(name),
  }),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getClaims: f.claims } }),
}))
const user = {
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01",
  id: "actor",
  email: "staff@superserve.ai",
  email_confirmed_at: "2026-01-01",
  app_metadata: { provider: "google" },
  identities: [
    {
      id: "identity",
      identity_id: "identity",
      user_id: "actor",
      created_at: "2026-01-01",
      provider: "google",
      identity_data: {
        sub: "google-user",
        email: "staff@superserve.ai",
        email_verified: true,
      },
    },
  ],
} as User
const session = {
  user,
  provider_token: "server-exchange-provider-token",
  access_token: "server-exchange-session-token",
} as Session
beforeEach(() => {
  const keys = generateKeyPairSync("ed25519")
  vi.stubEnv(
    "PROMOTION_ACCOUNT_PRIVATE_KEY",
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  )
  vi.stubEnv("YC_STAFF_UI_ENABLED", "true")
  vi.stubGlobal("fetch", f.fetch)
  f.fetch.mockReset().mockResolvedValue(
    new Response(
      JSON.stringify({
        sub: "google-user",
        email: user.email,
        email_verified: true,
      }),
    ),
  )
  f.claims.mockReset().mockResolvedValue({
    data: { claims: { sub: user.id, session_id: "google-session" } },
  })
  f.jar.clear()
  f.jar.set(
    STAFF_INIT_COOKIE,
    signProof(
      "yc-staff-google-init",
      { actor: user.id, nonce: "original-nonce" },
      300,
    ),
  )
})
describe("current Google session proof", () => {
  it("binds trusted Google response to the exact exchanged Auth session and consumes initiation", async () => {
    const proof = await completeStaffGoogle(session, "original-nonce", user)
    expect(proof).not.toBeNull()
    expect(f.claims).toHaveBeenCalledWith(session.access_token)
    expect(f.fetch).toHaveBeenCalledWith(
      "https://openidconnect.googleapis.com/v1/userinfo",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.provider_token}` },
      }),
    )
    expect(f.jar.has(STAFF_INIT_COOKIE)).toBe(false)
    f.jar.set(STAFF_SESSION_COOKIE, proof!)
    await expect(
      verifyStaffSession(user, "google-session"),
    ).resolves.toBeUndefined()
    await expect(verifyStaffSession(user, "other-session")).rejects.toThrow()
    expect(
      await completeStaffGoogle(session, "original-nonce", user),
    ).toBeNull()
  })
  it.each([
    "wrong_nonce",
    "missing_provider_token",
    "wrong_account",
    "wrong_google_subject",
    "unverified_google_email",
    "userinfo_failure",
    "wrong_auth_session",
  ])("rejects %s", async (scenario) => {
    let current = session
    if (scenario === "missing_provider_token")
      current = { ...session, provider_token: null }
    if (scenario === "wrong_account")
      current = { ...session, user: { ...user, id: "someone-else" } }
    if (scenario === "wrong_google_subject")
      f.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            sub: "other",
            email: user.email,
            email_verified: true,
          }),
        ),
      )
    if (scenario === "unverified_google_email")
      f.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            sub: "google-user",
            email: user.email,
            email_verified: false,
          }),
        ),
      )
    if (scenario === "userinfo_failure")
      f.fetch.mockRejectedValue(new Error("provider outage"))
    if (scenario === "wrong_auth_session")
      f.claims.mockResolvedValue({
        data: { claims: { sub: "other", session_id: "google-session" } },
      })
    expect(
      await completeStaffGoogle(
        current,
        scenario === "wrong_nonce" ? "different" : "original-nonce",
        user,
      ),
    ).toBeNull()
    expect(f.jar.has(STAFF_INIT_COOKIE)).toBe(false)
  })
  it("denies alternate-provider session after unlink even with a copied Google proof", async () => {
    f.jar.set(
      STAFF_SESSION_COOKIE,
      signProof(
        "yc-staff-google-session",
        { actor: user.id, session: "google-session", google: "google-user" },
        900,
      ),
    )
    await expect(verifyStaffSession(user, "github-session")).rejects.toThrow()
  })
  it("rejects tampering, wrong purpose, expiration and removed Google identity", async () => {
    const proof = signProof(
      "yc-staff-google-session",
      { actor: user.id, session: "google-session", google: "google-user" },
      900,
    )
    expect(() => readProof(proof, "yc-staff-google-init", 900)).toThrow()
    f.jar.set(STAFF_SESSION_COOKIE, `x${proof}`)
    await expect(verifyStaffSession(user, "google-session")).rejects.toThrow()
    f.jar.set(STAFF_SESSION_COOKIE, proof)
    await expect(
      verifyStaffSession({ ...user, identities: [] }, "google-session"),
    ).rejects.toThrow()
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 901000)
    await expect(verifyStaffSession(user, "google-session")).rejects.toThrow()
  })
})
