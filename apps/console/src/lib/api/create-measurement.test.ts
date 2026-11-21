import { afterEach, expect, it, vi } from "vitest"

import { ApiError, apiClientCreate } from "./client"
import { correlationId } from "./create-measurement"

const attempt = "10000000-0000-4000-8000-000000000001"
const requestId = "20000000-0000-4000-8000-000000000002"
const sandboxId = "30000000-0000-4000-8000-000000000003"
afterEach(() => vi.unstubAllGlobals())

it.each([
  [201, JSON.stringify({ id: sandboxId }), "http_success", sandboxId, null],
  [
    201,
    JSON.stringify({ id: `sb-usw-${sandboxId}` }),
    "http_success",
    sandboxId,
    null,
  ],
  [
    201,
    JSON.stringify({ id: `sb-usw-${sandboxId}\n` }),
    "response_decode_unknown",
    null,
    "unknown",
  ],
  [201, "{}", "response_decode_unknown", null, "unknown"],
  [
    200,
    JSON.stringify({ id: sandboxId }),
    "response_decode_unknown",
    null,
    "unknown",
  ],
  [201, "not json", "response_decode_unknown", null, "unknown"],
  [
    402,
    JSON.stringify({ error: { code: "trial_exhausted", message: "private" } }),
    "http_error",
    null,
    "trial_exhausted",
  ],
  [
    500,
    JSON.stringify({ error: { code: "private-code" } }),
    "http_error",
    null,
    "other",
  ],
])(
  "observes status %s without inventing creation",
  async (status, body, outcome, id, code) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { status, headers: { "X-Request-ID": requestId } }),
      )
    vi.stubGlobal("fetch", fetcher)
    const onResult = vi.fn()
    await apiClientCreate(
      { method: "POST", body: "{}" },
      { attemptId: attempt, onResult },
    ).catch(() => undefined)
    expect(onResult).toHaveBeenCalledExactlyOnceWith({
      outcome,
      sandbox_id: id,
      http_status: status,
      error_code: code,
      request_dispatched: true,
      request_id: requestId,
    })
    expect(
      fetcher.mock.calls[0][1].headers.get("X-Sandbox-Create-Attempt-ID"),
    ).toBe(attempt)
  },
)

it("retains transport uncertainty, ignores malformed IDs, and cannot replace the business error", async () => {
  const error = new TypeError("private network details")
  const fetcher = vi.fn().mockRejectedValue(error)
  vi.stubGlobal("fetch", fetcher)
  const onResult = vi.fn(() => {
    throw new Error("analytics down")
  })
  await expect(
    apiClientCreate(
      { method: "POST" },
      { attemptId: "private input", onResult },
    ),
  ).rejects.toBe(error)
  expect(onResult).toHaveBeenCalledWith({
    outcome: "transport_unknown",
    request_dispatched: true,
    request_id: null,
    http_status: null,
    error_code: "unknown",
    sandbox_id: null,
  })
  expect(
    fetcher.mock.calls[0][1].headers.has("X-Sandbox-Create-Attempt-ID"),
  ).toBe(false)
  expect(correlationId("" + attempt + "-extra")).toBeNull()
})

it("preserves success and structured business errors when capture throws", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: sandboxId }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "trial_exhausted", message: "unchanged" },
          }),
          { status: 402 },
        ),
      ),
  )
  const measurement = {
    attemptId: attempt,
    onResult: () => {
      throw new Error("capture")
    },
  }
  await expect(
    apiClientCreate({ method: "POST" }, measurement),
  ).resolves.toEqual({ id: sandboxId })
  await expect(
    apiClientCreate({ method: "POST" }, measurement),
  ).rejects.toEqual(new ApiError(402, "trial_exhausted", "unchanged"))
})
