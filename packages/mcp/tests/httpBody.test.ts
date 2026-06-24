/** Unit tests for the bounded request-body readers (web + node). */

import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"

import { describe, expect, it } from "vitest"

import {
  parseJsonBody,
  readNodeRequestBody,
  readWebRequestBody,
} from "../src/lib/httpBody.js"

describe("readWebRequestBody", () => {
  const post = (body: string): Request =>
    new Request("https://x/", { method: "POST", body })

  it("returns the bytes when under the cap", async () => {
    const r = await readWebRequestBody(post("hello"), 1024)
    expect(r.ok).toBe(true)
    if (r.ok) expect(new TextDecoder().decode(r.bytes)).toBe("hello")
  })

  it("refuses a streamed body that exceeds the cap", async () => {
    const r = await readWebRequestBody(post("x".repeat(100)), 10)
    expect(r.ok).toBe(false)
  })
})

/** Minimal `IncomingMessage` stand-in that emits the given chunks. */
function fakeNodeReq(
  chunks: string[],
  headers: Record<string, string> = {},
): IncomingMessage {
  const ee = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>
    destroy: () => void
  }
  ee.headers = headers
  ee.destroy = () => {}
  queueMicrotask(() => {
    for (const c of chunks) ee.emit("data", Buffer.from(c))
    ee.emit("end")
  })
  return ee as unknown as IncomingMessage
}

describe("readNodeRequestBody", () => {
  it("returns the bytes when under the cap", async () => {
    const r = await readNodeRequestBody(fakeNodeReq(["he", "llo"]), 1024)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Buffer.from(r.bytes).toString()).toBe("hello")
  })

  it("refuses a body whose chunks exceed the cap", async () => {
    const r = await readNodeRequestBody(
      fakeNodeReq(["x".repeat(8), "y".repeat(8)]),
      10,
    )
    expect(r.ok).toBe(false)
  })

  it("refuses early on an over-cap Content-Length", async () => {
    const r = await readNodeRequestBody(
      fakeNodeReq(["tiny"], { "content-length": "999999" }),
      10,
    )
    expect(r.ok).toBe(false)
  })
})

describe("parseJsonBody", () => {
  it("parses valid JSON", () => {
    expect(parseJsonBody(new TextEncoder().encode('{"a":1}'))).toEqual({
      value: { a: 1 },
    })
  })
  it("returns null for invalid JSON", () => {
    expect(parseJsonBody(new TextEncoder().encode("{bad"))).toBeNull()
  })
})
