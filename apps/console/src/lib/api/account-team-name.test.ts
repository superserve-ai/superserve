import { describe, expect, it } from "vitest"

import {
  accountTeamFallbackName,
  accountTeamFallbackOperationId,
} from "./account-team-name"

const userId = "11111111-1111-4111-8111-111111111111"
const otherUserId = "22222222-2222-4222-8222-222222222222"

describe("accountTeamFallbackOperationId", () => {
  it("keeps a stable lowercase UUID locator distinct from both users", () => {
    const operationId = accountTeamFallbackOperationId(userId)
    expect(operationId).toBe("8eb0febd-60b4-56e8-a1d0-cba85e95fb88")
    expect(accountTeamFallbackOperationId(userId)).toBe(operationId)
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(operationId).not.toBe(userId)
    expect(accountTeamFallbackOperationId(otherUserId)).not.toBe(otherUserId)
    expect(accountTeamFallbackOperationId(otherUserId)).not.toBe(operationId)
  })
})

describe("accountTeamFallbackName", () => {
  it("keeps a stable account suffix", () => {
    const name = accountTeamFallbackName("user@example.com", userId)
    expect(name).toBe("user@example.com (11111111)")
    expect(accountTeamFallbackName("user@example.com", userId)).toBe(name)
    expect(accountTeamFallbackName("user@example.com", otherUserId)).not.toBe(
      name,
    )
  })

  it.each(["é", "界", "😀"])(
    "truncates long %s emails on a code-point boundary within 256 UTF-8 bytes",
    (point) => {
      const email = `${point.repeat(300)}@example.com`
      const suffix = " (11111111)"
      const name = accountTeamFallbackName(email, userId)
      const count = Math.floor(
        (256 - Buffer.byteLength(suffix, "utf8")) /
          Buffer.byteLength(point, "utf8"),
      )
      expect(name).toBe(`${point.repeat(count)}${suffix}`)
      expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(256)
      expect(name.trim()).not.toBe("")
    },
  )

  it.each(["", "   "])("stays non-empty for a blank email %j", (email) => {
    expect(accountTeamFallbackName(email, userId).trim()).not.toBe("")
  })
})
