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
