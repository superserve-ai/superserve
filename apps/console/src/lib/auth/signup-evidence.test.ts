import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const jar = new Map<string, string>()
let failCookieWrite = false
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name)! } : undefined,
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (failCookieWrite) throw new Error("Cookie write failed")
      if (options?.maxAge === 0) jar.delete(name)
      else jar.set(name, value)
    },
  }),
}))

import {
  beginSignupEvidenceAttempt,
  clearEvaluatedSignupEvidence,
  isSupersededSignupEvidenceAttempt,
  readSignupEvidence,
  readSignupEvidenceEntries,
  saveSignupEvidence,
} from "./signup-evidence"

const name = "__Host-superserve-signup-evidence"
const previous = process.env.GOOGLE_SIGNUP_PROOF_SECRET
beforeEach(() => {
  jar.clear()
  failCookieWrite = false
  process.env.GOOGLE_SIGNUP_PROOF_SECRET =
    "a-secret-with-at-least-thirty-two-characters"
})
afterEach(() => {
  vi.useRealTimers()
  if (previous === undefined) delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
  else process.env.GOOGLE_SIGNUP_PROOF_SECRET = previous
})

describe("active signup evidence", () => {
  it("reports a failed attempt start even when an older signed cookie remains", async () => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
    expect(await beginSignupEvidenceAttempt("attempt")).toBe(false)
    expect(await isSupersededSignupEvidenceAttempt("attempt")).toBe(false)

    process.env.GOOGLE_SIGNUP_PROOF_SECRET =
      "a-secret-with-at-least-thirty-two-characters"
    expect(await beginSignupEvidenceAttempt("old")).toBe(true)
    failCookieWrite = true
    expect(await beginSignupEvidenceAttempt("attempt")).toBe(false)
    expect(await isSupersededSignupEvidenceAttempt("attempt")).toBe(true)
  })

  it("recognizes only a different valid signed attempt as superseding", async () => {
    await beginSignupEvidenceAttempt("old")
    expect(await isSupersededSignupEvidenceAttempt("old")).toBe(false)
    await beginSignupEvidenceAttempt("new")
    expect(await isSupersededSignupEvidenceAttempt("old")).toBe(true)
  })

  it("holds one signed visitor bound to actor and attempt", async () => {
    await beginSignupEvidenceAttempt("attempt-1")
    await saveSignupEvidence("actor-1", "attempt-1", "event-1", "VisitorCase")
    expect([...jar.keys()]).toEqual([name])
    expect(await readSignupEvidence("actor-1", "attempt-1")).toBe("VisitorCase")
    expect(await readSignupEvidence("actor-2", "attempt-1")).toBeNull()
    expect(await readSignupEvidence("actor-1", "attempt-2")).toBeNull()
    const value = jar.get(name)!
    jar.set(name, `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`)
    expect(await readSignupEvidence("actor-1")).toBeNull()
  })

  it("supersedes older attempts and rejects late callbacks", async () => {
    await beginSignupEvidenceAttempt("old")
    await saveSignupEvidence("actor", "old", "event-old", "Old")
    await beginSignupEvidenceAttempt("new")
    await saveSignupEvidence("actor", "old", "event-old", "Late")
    expect(await readSignupEvidence("actor", "old")).toBeNull()
    await saveSignupEvidence("actor", "new", "event-new", "New")
    expect(await readSignupEvidence("actor", "new")).toBe("New")
  })

  it("does not let another actor replace an attempt's verified visitor", async () => {
    await beginSignupEvidenceAttempt("attempt")
    await saveSignupEvidence("actor-a", "attempt", "event-a", "VisitorA")
    await saveSignupEvidence("actor-b", "attempt", "event-b", "VisitorB")
    expect(await readSignupEvidence("actor-a", "attempt")).toBe("VisitorA")
    expect(await readSignupEvidence("actor-b", "attempt")).toBeNull()
  })

  it("keeps the first visitor and expiry on same-attempt retries", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"))
    await beginSignupEvidenceAttempt("attempt")
    await saveSignupEvidence("actor", "attempt", "event-1", "First")
    const signed = jar.get(name)
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"))
    await saveSignupEvidence("actor", "attempt", "event-2", "Second")
    expect(jar.get(name)).toBe(signed)
    expect(await readSignupEvidence("actor")).toBe("First")
    vi.setSystemTime(new Date("2026-01-01T00:10:01Z"))
    expect(await readSignupEvidence("actor")).toBeNull()
  })

  it("clears only the exact successfully evaluated context", async () => {
    await beginSignupEvidenceAttempt("first")
    await saveSignupEvidence("actor", "first", "event", "First")
    const first = await readSignupEvidenceEntries("actor")
    await beginSignupEvidenceAttempt("second")
    await saveSignupEvidence("actor", "second", "event", "Second")
    await clearEvaluatedSignupEvidence("actor", first)
    expect(await readSignupEvidence("actor")).toBe("Second")
    await clearEvaluatedSignupEvidence(
      "other",
      await readSignupEvidenceEntries("actor"),
    )
    expect(await readSignupEvidence("actor")).toBe("Second")
    await clearEvaluatedSignupEvidence(
      "actor",
      await readSignupEvidenceEntries("actor"),
    )
    expect(await readSignupEvidence("actor")).toBeNull()
  })
})
