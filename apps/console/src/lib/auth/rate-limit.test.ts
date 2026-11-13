import crypto from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockRpc = vi.fn()
const mockCount = vi.fn()
const mockFrom = vi.fn()

// A minimal stand-in for the PostgREST count query: each filter records
// itself, and the last filter (gt) resolves with mockCount's result.
function countQuery() {
  const filters: unknown[][] = []
  const query = {
    select: (...args: unknown[]) => {
      filters.push(["select", ...args])
      return query
    },
    eq: (...args: unknown[]) => {
      filters.push(["eq", ...args])
      return query
    },
    gt: async (...args: unknown[]) => {
      filters.push(["gt", ...args])
      return mockCount(filters)
    },
  }
  return query
}

vi.mock("@/lib/cells", () => ({
  DEFAULT_REGION: "default",
  cellFor: () => ({
    createAdminClient: () => ({
      rpc: mockRpc,
      from: (table: string) => {
        mockFrom(table)
        return countQuery()
      },
    }),
  }),
}))

const LIMIT = { bucket: "test_bucket", max: 3, windowSeconds: 900 }
const SECRET = "test-rate-limit-secret"

const hmac = (value: string) =>
  crypto.createHmac("sha256", SECRET).update(value).digest("hex")

async function loadModule() {
  vi.resetModules()
  return import("./rate-limit")
}

describe("auth rate limits", () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockCount.mockReset()
    mockFrom.mockReset()
    vi.stubEnv("AUTH_RATE_LIMIT_KEY_SECRET", SECRET)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe("consumeAuthRateLimit", () => {
    it("sends a keyed, bucket-scoped hash, never the raw key", async () => {
      const { consumeAuthRateLimit } = await loadModule()
      mockRpc.mockResolvedValue({ data: true, error: null })

      await expect(
        consumeAuthRateLimit(LIMIT, "user@example.com"),
      ).resolves.toBe(true)

      expect(mockRpc).toHaveBeenCalledExactlyOnceWith(
        "consume_auth_rate_limit",
        {
          p_bucket: "test_bucket",
          p_key_hash: hmac("test_bucket:user@example.com"),
          p_max_per_window: 3,
          p_window: "900 seconds",
        },
      )
      expect(JSON.stringify(mockRpc.mock.calls)).not.toContain(
        "user@example.com",
      )
      expect(JSON.stringify(mockRpc.mock.calls)).not.toContain(
        crypto
          .createHash("sha256")
          .update("test_bucket:user@example.com")
          .digest("hex"),
      )
    })

    it("falls back to plain SHA-256 and logs once when the secret is not set", async () => {
      vi.stubEnv("AUTH_RATE_LIMIT_KEY_SECRET", " ")
      const { consumeAuthRateLimit } = await loadModule()
      mockRpc.mockResolvedValue({ data: true, error: null })

      await consumeAuthRateLimit(LIMIT, "key-a")
      await consumeAuthRateLimit(LIMIT, "key-b")

      expect(mockRpc.mock.calls[0][1].p_key_hash).toBe(
        crypto.createHash("sha256").update("test_bucket:key-a").digest("hex"),
      )
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "AUTH_RATE_LIMIT_KEY_SECRET is not set; auth rate limit keys use plain SHA-256",
      )
    })

    it("returns false when the budget is used up", async () => {
      const { consumeAuthRateLimit } = await loadModule()
      mockRpc.mockResolvedValue({ data: false, error: null })

      await expect(consumeAuthRateLimit(LIMIT, "key")).resolves.toBe(false)
      expect(mockFrom).not.toHaveBeenCalled()
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
      const { consumeAuthRateLimit } = await loadModule()
      arrange()

      await expect(consumeAuthRateLimit(LIMIT, "key")).resolves.toBe(true)
    })
  })

  describe("consumeAuthRateLimitOutcome", () => {
    it("returns allowed without a count when the store allows", async () => {
      const { consumeAuthRateLimitOutcome } = await loadModule()
      mockRpc.mockResolvedValue({ data: true, error: null })

      await expect(consumeAuthRateLimitOutcome(LIMIT, "key")).resolves.toBe(
        "allowed",
      )
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it("returns refused when the key's rows in the window reach the budget", async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"))
      const { consumeAuthRateLimitOutcome } = await loadModule()
      mockRpc.mockResolvedValue({ data: false, error: null })
      mockCount.mockReturnValue({ count: 3, error: null })

      await expect(consumeAuthRateLimitOutcome(LIMIT, "key")).resolves.toBe(
        "refused",
      )
      expect(mockFrom).toHaveBeenCalledExactlyOnceWith("auth_rate_limit_event")
      expect(mockCount).toHaveBeenCalledExactlyOnceWith([
        ["select", "bucket", { count: "exact", head: true }],
        ["eq", "bucket", "test_bucket"],
        ["eq", "key_hash", hmac("test_bucket:key")],
        ["gt", "created_at", "2026-11-11T11:45:00.000Z"],
      ])
    })

    it("returns busy when the store refused with budget left", async () => {
      const { consumeAuthRateLimitOutcome } = await loadModule()
      mockRpc.mockResolvedValue({ data: false, error: null })
      mockCount.mockReturnValue({ count: 2, error: null })

      await expect(consumeAuthRateLimitOutcome(LIMIT, "key")).resolves.toBe(
        "busy",
      )
    })

    it.each([
      ["returns an error", { count: null, error: { message: "denied" } }],
      ["returns no count", { count: null, error: null }],
    ])(
      "returns busy when the count %s, so the caller retries",
      async (_label, result) => {
        const { consumeAuthRateLimitOutcome } = await loadModule()
        mockRpc.mockResolvedValue({ data: false, error: null })
        mockCount.mockReturnValue(result)

        await expect(consumeAuthRateLimitOutcome(LIMIT, "key")).resolves.toBe(
          "busy",
        )
        expect(console.error).toHaveBeenCalledWith(
          "Auth rate limit count failed:",
          "test_bucket",
          expect.anything(),
        )
      },
    )

    it("allows the attempt when the store fails", async () => {
      const { consumeAuthRateLimitOutcome } = await loadModule()
      mockRpc.mockRejectedValue(new Error("network"))

      await expect(consumeAuthRateLimitOutcome(LIMIT, "key")).resolves.toBe(
        "allowed",
      )
      expect(mockFrom).not.toHaveBeenCalled()
    })
  })
})
