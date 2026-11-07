import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const jar = new Map<string, string>()
const writes: { name: string; options: Record<string, unknown> }[] = []
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      writes.push({ name, options })
      if (options.maxAge === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
}))

import {
  clearSignupResendTicket,
  readSignupResendTicket,
  saveSignupResendTicket,
} from "./signup-resend"

const name = "__Host-superserve-signup-resend"
const ticket = {
  user: "user-1",
  type: "signup" as const,
  redirect: "https://console.example.test/auth/callback?offer=pro_monthly",
  attempt: "attempt-1",
}
const previous = process.env.GOOGLE_SIGNUP_PROOF_SECRET
beforeEach(() => {
  jar.clear()
  writes.length = 0
  process.env.GOOGLE_SIGNUP_PROOF_SECRET =
    "a-secret-with-at-least-thirty-two-characters"
})
afterEach(() => {
  vi.useRealTimers()
  if (previous === undefined) delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
  else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previous
})

describe("signup resend ticket", () => {
  it("round-trips in a host-only, HTTP-only cookie", async () => {
    expect(await saveSignupResendTicket({ ...ticket, device: "d-1" })).toBe(
      true,
    )
    expect(writes[0]).toEqual({
      name,
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 3600,
      },
    })
    expect(await readSignupResendTicket()).toEqual({
      ...ticket,
      device: "d-1",
    })
  })

  it("rejects a changed ticket", async () => {
    await saveSignupResendTicket(ticket)
    const [encoded, mac] = jar.get(name)!.split(".")
    const changed = JSON.parse(Buffer.from(encoded, "base64url").toString())
    changed.user = "someone-else"
    jar.set(
      name,
      `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${mac}`,
    )
    expect(await readSignupResendTicket()).toBeNull()
  })

  it("does not accept a value signed for another purpose", async () => {
    await saveSignupResendTicket(ticket)
    const [encoded] = jar.get(name)!.split(".")
    const crypto = await import("node:crypto")
    const plain = crypto
      .createHmac("sha256", process.env.GOOGLE_SIGNUP_PROOF_SECRET!)
      .update(encoded)
      .digest("base64url")
    jar.set(name, `${encoded}.${plain}`)
    expect(await readSignupResendTicket()).toBeNull()
  })

  it("expires after an hour", async () => {
    vi.useFakeTimers()
    await saveSignupResendTicket(ticket)
    vi.advanceTimersByTime(3601 * 1000)
    expect(await readSignupResendTicket()).toBeNull()
  })

  it("stores nothing without a signing secret", async () => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
    expect(await saveSignupResendTicket(ticket)).toBe(false)
    expect(jar.has(name)).toBe(false)
    expect(await readSignupResendTicket()).toBeNull()
  })

  it("clears the ticket", async () => {
    await saveSignupResendTicket(ticket)
    await clearSignupResendTicket()
    expect(await readSignupResendTicket()).toBeNull()
  })
})
