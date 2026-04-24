import { afterEach, describe, expect, it, vi } from "vitest"

import { ValidationError } from "../src/errors.js"
import { Files } from "../src/files.js"

const sandboxId = "sbx-1"
const sandboxHost = "sandbox.superserve.ai"
const accessToken = "tok-abc"

async function readBodyAsBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer())
  }
  if (body instanceof Uint8Array) {
    return body
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  // String or FormData fallback
  if (typeof body === "string") {
    return new TextEncoder().encode(body)
  }
  // Give up — tests should pass Blob/Uint8Array
  throw new Error("Unexpected body type in test helper")
}

describe("Files path validation", () => {
  const files = new Files(sandboxId, sandboxHost, accessToken)

  it("write rejects relative paths", async () => {
    await expect(files.write("relative/path", "x")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("read rejects relative paths", async () => {
    await expect(files.read("relative/path")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("readText rejects relative paths", async () => {
    await expect(files.readText("relative/path")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("write rejects paths containing ..", async () => {
    await expect(files.write("/foo/../etc", "x")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("read rejects paths containing ..", async () => {
    await expect(files.read("/foo/../etc")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("readText rejects paths containing ..", async () => {
    await expect(files.readText("/foo/../etc")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe("Files.write", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls POST with correct URL and X-Access-Token header", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(sandboxId, sandboxHost, accessToken)
    await files.write("/app/file.txt", "hello")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://boxd-${sandboxId}.${sandboxHost}/files?path=${encodeURIComponent(
        "/app/file.txt",
      )}`,
    )
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Access-Token"]).toBe(accessToken)
  })

  it("encodes string content as UTF-8 bytes", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(sandboxId, sandboxHost, accessToken)
    await files.write("/app/file.txt", "héllo")

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const bytes = await readBodyAsBytes(init.body)
    expect(new TextDecoder().decode(bytes)).toBe("héllo")
  })

  it("passes Uint8Array content through", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(sandboxId, sandboxHost, accessToken)
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await files.write("/app/binary.dat", data)

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const bytes = await readBodyAsBytes(init.body)
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5])
  })
})

describe("Files.read", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns Uint8Array", async () => {
    const payload = new Uint8Array([10, 20, 30])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(payload, { status: 200 })),
    )

    const files = new Files(sandboxId, sandboxHost, accessToken)
    const out = await files.read("/app/file.bin")
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([10, 20, 30])
  })
})

describe("Files.readText", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns UTF-8 decoded string", async () => {
    const bytes = new TextEncoder().encode("héllo world")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    )

    const files = new Files(sandboxId, sandboxHost, accessToken)
    const out = await files.readText("/app/file.txt")
    expect(out).toBe("héllo world")
  })
})
