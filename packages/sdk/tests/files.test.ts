import { afterEach, describe, expect, it, vi } from "vitest"

import { ValidationError } from "../src/errors.js"
import { Files, type FilesDeps } from "../src/files.js"

const sandboxId = "sbx-1"
const sandboxHost = "sandbox.example.com"
const accessToken = "tok-abc"

/** Build Files deps with a static token, overridable per test. */
function deps(
  token = accessToken,
  overrides: Partial<FilesDeps> = {},
): FilesDeps {
  return {
    sandboxId,
    sandboxHost,
    getAccessToken: () => token,
    refreshActivate: async () => token,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function readBodyAsBytes(
  body: BodyInit | null | undefined,
): Promise<Uint8Array> {
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
  const files = new Files(deps())

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

  it("downloadDir rejects relative paths", async () => {
    await expect(files.downloadDir("relative/dir")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("downloadDir rejects paths containing ..", async () => {
    await expect(files.downloadDir("/foo/../etc")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe("Files.downloadDir", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("GETs with format=zip and the X-Access-Token header", async () => {
    const mock = vi.fn(
      async () => new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }),
    )
    vi.stubGlobal("fetch", mock)

    const files = new Files(deps())
    await files.downloadDir("/app/output")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://boxd-${sandboxId}.${sandboxHost}/files?path=${encodeURIComponent(
        "/app/output",
      )}&format=zip`,
    )
    expect(init.method).toBe("GET")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Access-Token"]).toBe(accessToken)
  })

  it("returns the zip bytes as a Uint8Array", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(zip, { status: 200 })),
    )

    const files = new Files(deps())
    const out = await files.downloadDir("/app/output")
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it("rejects with ValidationError when the body exceeds maxBytes", async () => {
    // 8-byte streamed body, cap at 4 — the cap should trip mid-stream.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.enqueue(new Uint8Array([5, 6, 7, 8]))
        controller.close()
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    )

    const files = new Files(deps())
    await expect(
      files.downloadDir("/app/output", { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("returns the bytes unchanged when under the maxBytes cap", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(zip, { status: 200 })),
    )

    const files = new Files(deps())
    const out = await files.downloadDir("/app/output", { maxBytes: 1024 })
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it("carries X-Superserve-Sandbox-Id on a shared host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }),
      )
    vi.stubGlobal("fetch", mock)

    const files = new Files(
      deps(accessToken, { sandboxHost: "sandbox.superserve.ai" }),
    )
    await files.downloadDir("/app/output")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://sandbox.superserve.ai/files?path=${encodeURIComponent(
        "/app/output",
      )}&format=zip`,
    )
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe(accessToken)
  })
})

describe("Files.write", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls POST with correct URL and X-Access-Token header", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(deps())
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

    const files = new Files(deps())
    await files.write("/app/file.txt", "héllo")

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const bytes = await readBodyAsBytes(init.body)
    expect(new TextDecoder().decode(bytes)).toBe("héllo")
  })

  it("passes Uint8Array content through", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(deps())
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

    const files = new Files(deps())
    const out = await files.read("/app/file.bin")
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out)).toEqual([10, 20, 30])
  })

  it("rejects with ValidationError when the body exceeds maxBytes", async () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(payload, { status: 200 })),
    )

    const files = new Files(deps())
    await expect(
      files.read("/app/file.bin", { maxBytes: 2 }),
    ).rejects.toBeInstanceOf(ValidationError)
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

    const files = new Files(deps())
    const out = await files.readText("/app/file.txt")
    expect(out).toBe("héllo world")
  })
})

describe("Files auto-resume (paused sandbox)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("write resumes + retries on 503, using the rotated token", async () => {
    let refreshCalled = 0
    let token = "tok-stale"
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "sandbox is paused" } }, 503),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files({
      sandboxId,
      sandboxHost,
      getAccessToken: () => token,
      refreshActivate: async () => {
        refreshCalled += 1
        token = "tok-fresh"
        return token
      },
    })
    await files.write("/app/f.txt", "hello")

    expect(refreshCalled).toBe(1)
    expect(mock).toHaveBeenCalledTimes(2)
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(
      (secondInit.headers as Record<string, string>)["X-Access-Token"],
    ).toBe("tok-fresh")
  })

  it("read resumes + retries on 503, using the rotated token", async () => {
    let refreshCalled = 0
    let token = "tok-stale"
    const mock = vi.fn<typeof fetch>(async (_url, init) => {
      const tok = (init?.headers as Record<string, string>)?.["X-Access-Token"]
      if (tok === "tok-fresh") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      return jsonResponse({ error: { message: "sandbox is paused" } }, 503)
    })
    vi.stubGlobal("fetch", mock)

    const files = new Files({
      sandboxId,
      sandboxHost,
      getAccessToken: () => token,
      refreshActivate: async () => {
        refreshCalled += 1
        token = "tok-fresh"
        return token
      },
    })
    const out = await files.read("/app/f.bin")

    expect(Array.from(out)).toEqual([1, 2, 3])
    expect(refreshCalled).toBe(1)
  })

  it("downloadDir resumes + retries on 503, using the rotated token", async () => {
    let refreshCalled = 0
    let token = "tok-stale"
    const mock = vi.fn<typeof fetch>(async (_url, init) => {
      const tok = (init?.headers as Record<string, string>)?.["X-Access-Token"]
      if (tok === "tok-fresh") {
        return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 })
      }
      return jsonResponse({ error: { message: "sandbox is paused" } }, 503)
    })
    vi.stubGlobal("fetch", mock)

    const files = new Files({
      sandboxId,
      sandboxHost,
      getAccessToken: () => token,
      refreshActivate: async () => {
        refreshCalled += 1
        token = "tok-fresh"
        return token
      },
    })
    const out = await files.downloadDir("/app/output")

    expect(Array.from(out)).toEqual([0x50, 0x4b])
    expect(refreshCalled).toBe(1)
  })

  it("does NOT resume on a 404 (path not found)", async () => {
    let refreshCalled = 0
    const mock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "not_found", message: "no such file" } },
        404,
      ),
    )
    vi.stubGlobal("fetch", mock)

    const files = new Files({
      sandboxId,
      sandboxHost,
      getAccessToken: () => "tok-stale",
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-fresh"
      },
    })
    await expect(files.read("/missing")).rejects.toBeInstanceOf(Error)
    expect(refreshCalled).toBe(0)
  })
})

describe("Files shared-host routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses shared host + X-Superserve-Sandbox-Id when sandboxHost is supported", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const files = new Files(
      deps(accessToken, { sandboxHost: "sandbox.superserve.ai" }),
    )
    await files.write("/tmp/f.txt", "data")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://sandbox.superserve.ai/files?path=${encodeURIComponent("/tmp/f.txt")}`,
    )
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe(accessToken)
  })

  it("read also carries X-Superserve-Sandbox-Id on shared host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      )
    vi.stubGlobal("fetch", mock)

    const files = new Files(
      deps(accessToken, { sandboxHost: "sandbox.superserve.ai" }),
    )
    await files.read("/tmp/f.bin")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://sandbox.superserve.ai/files?path=${encodeURIComponent("/tmp/f.bin")}`,
    )
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
  })
})
