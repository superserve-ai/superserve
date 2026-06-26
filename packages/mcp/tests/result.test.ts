import { describe, expect, it } from "vitest"

import { toolError, toolOk, truncateText } from "../src/lib/result.js"

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    const r = truncateText("hello", 1024)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("hello")
    expect(r.bytes).toBe(5)
  })
  it("truncates long text head+tail with a marker", () => {
    const big = "x".repeat(5000)
    const r = truncateText(big, 1000)
    expect(r.truncated).toBe(true)
    expect(r.bytes).toBe(5000)
    expect(r.text).toContain("bytes truncated")
    expect(r.text.length).toBeLessThan(big.length)
  })
  it("never splits a UTF-16 surrogate pair", () => {
    // Each emoji is one astral codepoint = a surrogate pair (2 units, 4 bytes).
    const text = "😀".repeat(2000)
    // Mix of even and odd char budgets so a naive slice would land mid-pair.
    for (const cap of [200, 203, 205, 207, 333, 1001]) {
      const r = truncateText(text, cap)
      expect(r.truncated).toBe(true)
      // A lone surrogate does not survive a UTF-8 round-trip (becomes U+FFFD),
      // so equality here proves the output contains no half-pairs.
      expect(Buffer.from(r.text, "utf8").toString("utf8")).toBe(r.text)
    }
  })
})

describe("tool results", () => {
  it("toolOk carries text + structured content", () => {
    const r = toolOk("done", { ok: true })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toEqual({ ok: true })
    expect(r.content[0]).toMatchObject({ type: "text", text: "done" })
  })
  it("toolError marks isError", () => {
    const r = toolError("nope")
    expect(r.isError).toBe(true)
    expect(r.content[0]).toMatchObject({ type: "text", text: "nope" })
  })
})
