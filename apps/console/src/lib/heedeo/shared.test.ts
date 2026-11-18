import { describe, expect, it } from "vitest"

import { decodeHeedeoCapture, encodeHeedeoCapture } from "./shared"

describe("Heedeo capture cookie", () => {
  it("round-trips a capture, encoded or as the cookie store decodes it", () => {
    const capture = {
      status: "ok" as const,
      token: "ct1.AbC_d-9",
      latencyMs: 812,
    }
    const encoded = encodeHeedeoCapture(capture)
    expect(decodeHeedeoCapture(encoded)).toEqual(capture)
    expect(decodeHeedeoCapture(decodeURIComponent(encoded))).toEqual(capture)
  })

  it("keeps a failed capture without a token", () => {
    expect(
      decodeHeedeoCapture(
        encodeHeedeoCapture({
          status: "script_failed",
          token: "ignored",
          latencyMs: 4,
        }),
      ),
    ).toEqual({ status: "script_failed", token: null, latencyMs: 4 })
  })

  it.each([
    undefined,
    "",
    "not json",
    JSON.stringify({ v: 2, s: "ok", t: "a" }),
    JSON.stringify({ v: 1, s: "unknown", t: "a" }),
    JSON.stringify({ v: 1, s: "ok", t: null }),
    JSON.stringify({ v: 1, s: "ok", t: "bad token;" }),
    JSON.stringify([1]),
    "x".repeat(5000),
  ])("rejects %j", (raw) => {
    expect(decodeHeedeoCapture(raw)).toBeNull()
  })

  it("drops an implausible latency", () => {
    expect(
      decodeHeedeoCapture(JSON.stringify({ v: 1, s: "ok", t: "a", ms: -1 }))
        ?.latencyMs,
    ).toBeNull()
  })
})
