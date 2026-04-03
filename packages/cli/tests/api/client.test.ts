import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import type { SuperserveClient } from "../../src/api/client"
import { createClient } from "../../src/api/client"
import { PlatformAPIError } from "../../src/api/errors"
import * as auth from "../../src/config/auth"

const BASE_URL = "https://test.superserve.ai"
let client: SuperserveClient
let fetchMock: ReturnType<typeof spyOn>

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  spyOn(auth, "getApiKey").mockReturnValue("test-api-key")
  fetchMock = spyOn(globalThis, "fetch")
  client = createClient(BASE_URL)
})

afterEach(() => {
  mock.restore()
})

// ==================== Auth ====================

describe("auth headers", () => {
  test("sends X-API-Key header on authenticated requests", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms: [] }))
    await client.listVms()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["X-API-Key"]).toBe("test-api-key")
  })

  test("throws PlatformAPIError when not authenticated", async () => {
    mock.restore()
    spyOn(auth, "getApiKey").mockReturnValue(null)
    fetchMock = spyOn(globalThis, "fetch")

    const unauthClient = createClient(BASE_URL)
    await expect(unauthClient.listVms()).rejects.toThrow(PlatformAPIError)
  })
})

// ==================== VMs ====================

describe("VM operations", () => {
  test("createVm sends POST /v1/vms", async () => {
    const vm = { id: "vm_123", name: "test", status: "RUNNING" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.createVm({ name: "test", image: "ubuntu" })

    expect(result).toEqual(vm)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms`)
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      name: "test",
      image: "ubuntu",
    })
  })

  test("listVms sends GET /v1/vms", async () => {
    const vms = [{ id: "vm_1" }, { id: "vm_2" }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms }))

    const result = await client.listVms()

    expect(result).toEqual(vms)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toStartWith(`${BASE_URL}/v1/vms`)
  })

  test("listVms passes status filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms: [] }))
    await client.listVms("RUNNING")

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain("status=RUNNING")
  })

  test("getVm sends GET /v1/vms/:id", async () => {
    const vm = { id: "vm_123", name: "test" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.getVm("vm_123")

    expect(result).toEqual(vm)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123`)
  })

  test("deleteVm sends DELETE /v1/vms/:id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await client.deleteVm("vm_123")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123`)
    expect(init.method).toBe("DELETE")
  })

  test("stopVm sends POST /v1/vms/:id/stop", async () => {
    const vm = { id: "vm_123", status: "STOPPED" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.stopVm("vm_123")

    expect(result).toEqual(vm)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/stop`)
    expect(init.method).toBe("POST")
  })

  test("startVm sends POST /v1/vms/:id/start", async () => {
    const vm = { id: "vm_123", status: "RUNNING" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.startVm("vm_123")

    expect(result).toEqual(vm)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/start`)
  })

  test("sleepVm sends POST /v1/vms/:id/sleep", async () => {
    const vm = { id: "vm_123", status: "SLEEPING" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.sleepVm("vm_123")

    expect(result).toEqual(vm)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/sleep`)
  })

  test("wakeVm sends POST /v1/vms/:id/wake", async () => {
    const vm = { id: "vm_123", status: "RUNNING" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.wakeVm("vm_123")

    expect(result).toEqual(vm)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/wake`)
  })
})

// ==================== Exec ====================

describe("exec operations", () => {
  test("exec sends POST /v1/vms/:id/exec", async () => {
    const resp = { stdout: "hello\n", stderr: "", exit_code: 0 }
    fetchMock.mockResolvedValueOnce(jsonResponse(resp))

    const result = await client.exec("vm_123", { command: "echo hello" })

    expect(result).toEqual(resp)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/exec`)
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ command: "echo hello" })
  })

  test("execStream sends POST /v1/vms/:id/exec/stream", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"stdout":"hi"}\n\ndata: {"finished":true}\n\n',
          ),
        )
        controller.close()
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }))

    const events = []
    for await (const event of client.execStream("vm_123", {
      command: "echo hi",
    })) {
      events.push(event)
    }

    expect(events).toEqual([{ stdout: "hi" }, { finished: true }])
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/exec/stream`)
  })
})

// ==================== Files ====================

describe("file operations", () => {
  test("uploadFile sends PUT with binary body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const data = new Uint8Array([1, 2, 3])

    await client.uploadFile("vm_123", "/tmp/test.bin", data)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/files/tmp/test.bin`)
    expect(init.method).toBe("PUT")
    const headers = init.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/octet-stream")
  })

  test("uploadFile sends X-File-Mode header when mode provided", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const data = new Uint8Array([1, 2, 3])

    await client.uploadFile("vm_123", "/tmp/script.sh", data, "0755")

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["X-File-Mode"]).toBe("0755")
  })

  test("downloadFile sends GET and returns Buffer", async () => {
    const content = new Uint8Array([4, 5, 6])
    fetchMock.mockResolvedValueOnce(
      new Response(content, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    )

    const result = await client.downloadFile("vm_123", "/tmp/data.bin")

    expect(result).toBeInstanceOf(Buffer)
    expect([...result]).toEqual([4, 5, 6])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/files/tmp/data.bin`)
    expect(init.method).toBe("GET")
  })
})

// ==================== Checkpoints ====================

describe("checkpoint operations", () => {
  test("listCheckpoints sends GET /v1/vms/:id/checkpoints", async () => {
    const checkpoints = [{ id: "cp_1" }, { id: "cp_2" }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ checkpoints }))

    const result = await client.listCheckpoints("vm_123")

    expect(result).toEqual(checkpoints)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/checkpoints`)
  })

  test("createCheckpoint sends POST /v1/vms/:id/checkpoint", async () => {
    const cp = { id: "cp_1", name: "snap1" }
    fetchMock.mockResolvedValueOnce(jsonResponse(cp))

    const result = await client.createCheckpoint("vm_123", { name: "snap1" })

    expect(result).toEqual(cp)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/checkpoint`)
    expect(init.method).toBe("POST")
  })

  test("deleteCheckpoint sends DELETE with force param", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await client.deleteCheckpoint("vm_123", "cp_1", true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/checkpoints/cp_1?force=true`)
    expect(init.method).toBe("DELETE")
  })

  test("deleteCheckpoint without force has no query param", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await client.deleteCheckpoint("vm_123", "cp_1")

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toStartWith(`${BASE_URL}/v1/vms/vm_123/checkpoints/cp_1`)
    expect(url).not.toContain("force")
  })
})

// ==================== Rollback ====================

describe("rollback", () => {
  test("rollback sends POST /v1/vms/:id/rollback", async () => {
    const vm = { id: "vm_123", status: "RUNNING" }
    fetchMock.mockResolvedValueOnce(jsonResponse(vm))

    const result = await client.rollback("vm_123", { checkpoint_id: "cp_1" })

    expect(result).toEqual(vm)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/rollback`)
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ checkpoint_id: "cp_1" })
  })
})

// ==================== Fork ====================

describe("fork operations", () => {
  test("fork sends POST /v1/vms/:id/fork", async () => {
    const resp = {
      source_vm_id: "vm_123",
      checkpoint_id: "cp_1",
      vms: [{ id: "vm_456" }],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(resp))

    const result = await client.fork("vm_123", { count: 1 })

    expect(result).toEqual(resp)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/fork`)
    expect(init.method).toBe("POST")
  })

  test("getForkTree sends GET /v1/vms/:id/tree", async () => {
    const tree = { vm_id: "vm_123", name: "root", children: [] }
    fetchMock.mockResolvedValueOnce(jsonResponse(tree))

    const result = await client.getForkTree("vm_123")

    expect(result).toEqual(tree)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`${BASE_URL}/v1/vms/vm_123/tree`)
  })
})

// ==================== Error handling ====================

describe("error handling", () => {
  test("throws PlatformAPIError with parsed error object", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(404, "not_found", "VM not found"),
    )

    try {
      await client.getVm("vm_999")
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(PlatformAPIError)
      const err = e as PlatformAPIError
      expect(err.statusCode).toBe(404)
      expect(err.message).toBe("VM not found")
      expect(err.details).toEqual({
        code: "not_found",
        message: "VM not found",
      })
    }
  })

  test("500 errors return user-friendly message", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(500, "internal", "stack trace here"),
    )

    try {
      await client.listVms()
      expect(true).toBe(false)
    } catch (e) {
      const err = e as PlatformAPIError
      expect(err.statusCode).toBe(500)
      expect(err.message).not.toContain("stack trace")
    }
  })

  test("clears cached API key on 401", async () => {
    // First call succeeds
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms: [] }))
    await client.listVms()

    // Second call returns 401
    fetchMock.mockResolvedValueOnce(
      errorResponse(401, "unauthorized", "Invalid key"),
    )
    await expect(client.listVms()).rejects.toThrow(PlatformAPIError)

    // Third call should re-read the API key (getApiKey called again)
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms: [] }))
    await client.listVms()

    // getApiKey should have been called more than once (initially + after cache clear)
    expect(
      (auth.getApiKey as ReturnType<typeof spyOn>).mock.calls.length,
    ).toBeGreaterThan(1)
  })

  test("network error throws PlatformAPIError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))

    try {
      await client.listVms()
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(PlatformAPIError)
      const err = e as PlatformAPIError
      expect(err.statusCode).toBe(0)
      expect(err.message).toContain("Cannot connect")
    }
  })
})
