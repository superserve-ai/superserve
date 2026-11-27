import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MAX_WRITE_BYTES } from "../src/constants.js"
import { createFakeClient } from "./fake-client.js"
import { callTool, type ConnectedClient, connect } from "./harness.js"

describe("sandbox_files_write base64 validation", () => {
  let fake: ReturnType<typeof createFakeClient>
  let conn: ConnectedClient
  let id: string

  beforeEach(async () => {
    fake = createFakeClient()
    conn = await connect(fake.client)
    const result = await callTool(conn.client, "sandbox_create", { name: "t" })
    id = result.structured.id as string
  })
  afterEach(async () => {
    await conn.close()
    vi.restoreAllMocks()
  })

  it.each([
    "!!!",
    "SGVsbG8=garbage",
    "SGVs!bG8=",
    "SGVsbG8=💥",
    "A",
    "AAAAA",
    "=AAA",
    "AA=A",
    "AA=",
    "AAAA=",
    "AA===",
    "====",
  ])(
    "rejects malformed input %j without overwriting a file",
    async (content) => {
      const path = "/app/existing.bin"
      const original = new TextEncoder().encode("original content")
      fake.sandboxes.get(id)!.files.set(path, original)
      const write = vi.spyOn(fake.client, "writeFile")

      const result = await callTool(conn.client, "sandbox_files_write", {
        sandbox_id: id,
        path,
        content,
        encoding: "base64",
      })

      expect(result.isError).toBe(true)
      expect(result.text).toMatch(/invalid base64/i)
      expect(write).not.toHaveBeenCalled()
      expect(fake.sandboxes.get(id)!.files.get(path)).toEqual(original)
    },
  )

  it.each([
    ["standard padded", "+/8=", [251, 255]],
    ["standard unpadded", "+/8", [251, 255]],
    ["URL-safe padded", "-_8=", [251, 255]],
    ["URL-safe unpadded", "-_8", [251, 255]],
    ["ASCII whitespace", " \t+\r/\n8\v=\f", [251, 255]],
    ["two padding characters", "AA==", [0]],
    ["complete quartet", "AAEC", [0, 1, 2]],
    ["empty content", "", []],
    ["whitespace only", " \t\r\n", []],
  ])("writes %s content", async (_name, content, bytes) => {
    const path = "/app/binary"
    const result = await callTool(conn.client, "sandbox_files_write", {
      sandbox_id: id,
      path,
      content,
      encoding: "base64",
    })

    expect(result.isError).toBe(false)
    expect(result.structured).toEqual({ path, bytes: bytes.length })
    expect(fake.sandboxes.get(id)!.files.get(path)).toEqual(
      new Uint8Array(bytes),
    )
  })

  it.each([MAX_WRITE_BYTES, MAX_WRITE_BYTES + 1])(
    "applies the size limit to %i decoded bytes",
    async (size) => {
      const path = "/app/large.bin"
      const bytes = Buffer.alloc(size, 255)
      const write = vi.spyOn(fake.client, "writeFile")
      const result = await callTool(conn.client, "sandbox_files_write", {
        sandbox_id: id,
        path,
        content: bytes.toString("base64"),
        encoding: "base64",
      })

      if (size > MAX_WRITE_BYTES) {
        expect(result.isError).toBe(true)
        expect(result.text).toMatch(/limited to|Refusing to write/i)
        expect(write).not.toHaveBeenCalled()
      } else {
        expect(result.isError).toBe(false)
        expect(result.structured.bytes).toBe(size)
        expect(write).toHaveBeenCalledTimes(1)
        expect(fake.sandboxes.get(id)!.files.get(path)?.byteLength).toBe(size)
      }
    },
  )
})
