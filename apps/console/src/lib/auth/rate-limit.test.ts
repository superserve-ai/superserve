import crypto from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRpc = vi.fn()

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "default",
  cellFor: () => ({ createAdminClient: () => ({ rpc: mockRpc }) }),
}))

import { consumeAuthRateLimit } from "./rate-limit"

const LIMIT = { bucket: "test_bucket", max: 3, windowSeconds: 900 }

describe("consumeAuthRateLimit", () => {
  beforeEach(() => {
    mockRpc.mockReset()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("sends a bucket-scoped hash, never the raw key", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null })

    await expect(consumeAuthRateLimit(LIMIT, "user@example.com")).resolves.toBe(
      true,
    )

    expect(mockRpc).toHaveBeenCalledExactlyOnceWith("consume_auth_rate_limit", {
      p_bucket: "test_bucket",
      p_key_hash: crypto
        .createHash("sha256")
        .update("test_bucket:user@example.com")
        .digest("hex"),
      p_max_per_window: 3,
      p_window: "900 seconds",
    })
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain("user@example.com")
  })

  it("returns false when the budget is used up", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })

    await expect(consumeAuthRateLimit(LIMIT, "key")).resolves.toBe(false)
  })

  it.each([
    [
      "returns an error",
      () =>
        mockRpc.mockResolvedValue({
          data: null,
          error: { message: "missing function" },
        }),
    ],
    ["throws", () => mockRpc.mockRejectedValue(new Error("network"))],
  ])("allows the attempt when the store %s", async (_label, arrange) => {
    arrange()

    await expect(consumeAuthRateLimit(LIMIT, "key")).resolves.toBe(true)
  })
})
