import { afterEach, describe, expect, it } from "vitest"

import {
  signSignupDeviceBinding,
  validSignupDeviceBinding,
} from "./binding-proof"

const priorSecret = process.env.GOOGLE_SIGNUP_PROOF_SECRET

afterEach(() => {
  if (priorSecret === undefined) delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
  else process.env.GOOGLE_SIGNUP_PROOF_SECRET = priorSecret
})

describe("signup device binding proof", () => {
  it("binds the callback attempt to the actual Auth user", () => {
    process.env.GOOGLE_SIGNUP_PROOF_SECRET = "s".repeat(32)
    const proof = signSignupDeviceBinding("user-a", "attempt-a")!
    expect(validSignupDeviceBinding("user-a", "attempt-a", proof)).toBe(true)
    expect(validSignupDeviceBinding("user-b", "attempt-a", proof)).toBe(false)
    expect(validSignupDeviceBinding("user-a", "attempt-b", proof)).toBe(false)
  })

  it("fails closed when the signing secret is unavailable", () => {
    delete process.env.GOOGLE_SIGNUP_PROOF_SECRET
    expect(signSignupDeviceBinding("user-a", "attempt-a")).toBeUndefined()
    expect(validSignupDeviceBinding("user-a", "attempt-a", "forged")).toBe(
      false,
    )
  })
})
