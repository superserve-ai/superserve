import { webcrypto } from "node:crypto"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import {
  createPendingMeetingContext,
  verifyPendingMeetingContext,
} from "./pending-meeting-context"

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto)
  vi.stubEnv(
    "GOOGLE_SIGNUP_PROOF_SECRET",
    "example-signing-key-at-least-thirty-two-bytes",
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("preserves a verified account across a sign-out without trusting prefill", async () => {
  const token = await createPendingMeetingContext("example-user")
  expect(await verifyPendingMeetingContext(token!)).toBe("example-user")
  expect(
    await verifyPendingMeetingContext(
      JSON.stringify({ email: "other@example.com", sub: "example-user" }),
    ),
  ).toBeNull()
  expect(
    await verifyPendingMeetingContext(
      token!.replace(/^./, token![0] === "a" ? "b" : "a"),
    ),
  ).toBeNull()
})
it("rejects expired context and fails closed without a signing secret", async () => {
  vi.useFakeTimers()
  const token = await createPendingMeetingContext("example-user")
  vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1)
  expect(await verifyPendingMeetingContext(token!)).toBeNull()
  vi.stubEnv("GOOGLE_SIGNUP_PROOF_SECRET", "")
  expect(await createPendingMeetingContext("example-user")).toBeNull()
  expect(await verifyPendingMeetingContext(token!)).toBeNull()
})
