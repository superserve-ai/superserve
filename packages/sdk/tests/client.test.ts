import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { Superserve } from "../src/client"
import { APIError } from "../src/errors"

const BASE_URL = "https://test.superserve.ai"
const API_KEY = "test-api-key"

function makeClient(opts?: { timeout?: number }) {
  return new Superserve({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    ...opts,
  })
}

const MOCK_API_VM = {
  id: "vm_abc123",
  name: "test-vm",
  status: "RUNNING" as const,
  vcpu_count: 2,
  mem_size_mib: 512,
  ip_address: "10.0.0.1",
  created_at: "2026-01-01T00:00:00Z",
  uptime_seconds: 3600,
  last_checkpoint_at: null,
  parent_vm_id: null,
  forked_from_checkpoint_id: null,
}

const EXPECTED_VM = {
  id: "vm_abc123",
  name: "test-vm",
  status: "RUNNING",
  vcpuCount: 2,
  memSizeMib: 512,
  ipAddress: "10.0.0.1",
  createdAt: "2026-01-01T00:00:00Z",
  uptimeSeconds: 3600,
  lastCheckpointAt: null,
  parentVmId: null,
  forkedFromCheckpointId: null,
}

const MOCK_API_CHECKPOINT = {
  id: "cp_abc123",
  vm_id: "vm_abc123",
  name: "my-checkpoint",
  type: "manual" as const,
  size_bytes: 1024,
  delta_size_bytes: 512,
  created_at: "2026-01-01T00:00:00Z",
  pinned: false,
}

const EXPECTED_CHECKPOINT = {
  id: "cp_abc123",
  vmId: "vm_abc123",
  name: "my-checkpoint",
  type: "manual",
  sizeBytes: 1024,
  deltaSizeBytes: 512,
  createdAt: "2026-01-01T00:00:00Z",
  pinned: false,
}

const originalFetch = global.fetch
let mockFetch: ReturnType<typeof mock>
let lastFetchUrl: string
let lastFetchInit: RequestInit | undefined

function setupMockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  mockFetch = mock((url: string, init?: RequestInit) => {
    // Ignore telemetry calls to PostHog
    if (url.includes("posthog.com")) {
      return Promise.resolve(new Response("", { status: 200 }))
    }
    lastFetchUrl = url
    lastFetchInit = init
    return Promise.resolve(handler(url, init))
  })
  global.fetch = mockFetch as typeof fetch
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  lastFetchUrl = ""
  lastFetchInit = undefined
})

afterEach(() => {
  global.fetch = originalFetch
})

// ==================== Auth ====================

describe("authentication", () => {
  test("sends X-API-Key header on every request", async () => {
    setupMockFetch(() => jsonResponse({ vms: [] }))
    const client = makeClient()
    await client.vms.list()

    const headers = lastFetchInit?.headers as Record<string, string>
    expect(headers["X-API-Key"]).toBe(API_KEY)
  })
})

// ==================== VM Operations ====================

describe("vms.create", () => {
  test("sends correct URL, method, and body", async () => {
    setupMockFetch(() => jsonResponse(MOCK_API_VM))
    const client = makeClient()

    const vm = await client.vms.create({
      name: "test-vm",
      image: "ubuntu:22.04",
      vcpuCount: 2,
      memSizeMib: 512,
    })

    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms`)
    expect(lastFetchInit?.method).toBe("POST")
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body).toEqual({
      name: "test-vm",
      image: "ubuntu:22.04",
      vcpu_count: 2,
      mem_size_mib: 512,
    })
    expect(vm).toEqual(EXPECTED_VM)
  })
})

describe("vms.list", () => {
  test("returns mapped VMs", async () => {
    setupMockFetch(() => jsonResponse({ vms: [MOCK_API_VM] }))
    const client = makeClient()

    const vms = await client.vms.list()
    expect(vms).toEqual([EXPECTED_VM])
    expect(lastFetchInit?.method).toBe("GET")
  })

  test("passes status query param", async () => {
    setupMockFetch(() => jsonResponse({ vms: [] }))
    const client = makeClient()

    await client.vms.list({ status: "RUNNING" })
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms?status=RUNNING`)
  })
})

describe("vms.get", () => {
  test("fetches a single VM by ID", async () => {
    setupMockFetch(() => jsonResponse(MOCK_API_VM))
    const client = makeClient()

    const vm = await client.vms.get("vm_abc123")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123`)
    expect(lastFetchInit?.method).toBe("GET")
    expect(vm).toEqual(EXPECTED_VM)
  })
})

describe("vms.delete", () => {
  test("sends DELETE request", async () => {
    setupMockFetch(() => new Response(null, { status: 204 }))
    const client = makeClient()

    await client.vms.delete("vm_abc123")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123`)
    expect(lastFetchInit?.method).toBe("DELETE")
  })
})

describe("vm actions", () => {
  for (const action of ["stop", "start", "sleep", "wake"] as const) {
    test(`vms.${action}() sends POST to correct endpoint`, async () => {
      setupMockFetch(() => jsonResponse(MOCK_API_VM))
      const client = makeClient()

      const vm = await client.vms[action]("vm_abc123")
      expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/${action}`)
      expect(lastFetchInit?.method).toBe("POST")
      expect(vm).toEqual(EXPECTED_VM)
    })
  }
})

// ==================== Exec ====================

describe("exec", () => {
  test("sends command and maps response", async () => {
    setupMockFetch(() =>
      jsonResponse({ stdout: "hello\n", stderr: "", exit_code: 0 }),
    )
    const client = makeClient()

    const result = await client.exec("vm_abc123", { command: "echo hello" })
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/exec`)
    expect(lastFetchInit?.method).toBe("POST")
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body.command).toBe("echo hello")
    expect(result).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 })
  })

  test("sends timeoutS as timeout_s in body", async () => {
    setupMockFetch(() =>
      jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
    )
    const client = makeClient()

    await client.exec("vm_abc123", { command: "sleep 5", timeoutS: 10 })
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body.timeout_s).toBe(10)
  })
})

describe("execStream", () => {
  test("sends POST to /exec/stream and returns ExecStream", () => {
    setupMockFetch(() => {
      const sseData = [
        'data: {"stdout":"hi"}',
        'data: {"finished":true,"exit_code":0}',
        "",
      ].join("\n")
      return new Response(sseData)
    })
    const client = makeClient()

    const stream = client.execStream("vm_abc123", { command: "echo hi" })
    expect(stream).toBeDefined()
    expect(typeof stream.abort).toBe("function")
    expect(stream.result).toBeInstanceOf(Promise)
  })
})

// ==================== Files ====================

describe("files.upload", () => {
  test("sends PUT with octet-stream content type", async () => {
    setupMockFetch(() => new Response(null, { status: 204 }))
    const client = makeClient()

    await client.files.upload("vm_abc123", "/app/test.txt", "hello world")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/files/app/test.txt`)
    expect(lastFetchInit?.method).toBe("PUT")
    const headers = lastFetchInit?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/octet-stream")
  })

  test("strips leading slash from remote path", async () => {
    setupMockFetch(() => new Response(null, { status: 204 }))
    const client = makeClient()

    await client.files.upload("vm_abc123", "/etc/config.json", "{}")
    expect(lastFetchUrl).toContain("/files/etc/config.json")
  })
})

describe("files.download", () => {
  test("sends GET and returns Uint8Array", async () => {
    const content = new TextEncoder().encode("file contents")
    setupMockFetch(() => new Response(content))
    const client = makeClient()

    const result = await client.files.download("vm_abc123", "/app/test.txt")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/files/app/test.txt`)
    expect(lastFetchInit?.method).toBe("GET")
    expect(result).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result)).toBe("file contents")
  })
})

// ==================== Checkpoints ====================

describe("checkpoints.list", () => {
  test("returns mapped checkpoints", async () => {
    setupMockFetch(() =>
      jsonResponse({ checkpoints: [MOCK_API_CHECKPOINT] }),
    )
    const client = makeClient()

    const checkpoints = await client.checkpoints.list("vm_abc123")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/checkpoints`)
    expect(checkpoints).toEqual([EXPECTED_CHECKPOINT])
  })
})

describe("checkpoints.create", () => {
  test("sends POST to /checkpoint with name", async () => {
    setupMockFetch(() => jsonResponse(MOCK_API_CHECKPOINT))
    const client = makeClient()

    const cp = await client.checkpoints.create("vm_abc123", { name: "my-checkpoint" })
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/checkpoint`)
    expect(lastFetchInit?.method).toBe("POST")
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body.name).toBe("my-checkpoint")
    expect(cp).toEqual(EXPECTED_CHECKPOINT)
  })
})

describe("checkpoints.delete", () => {
  test("sends DELETE request", async () => {
    setupMockFetch(() => new Response(null, { status: 204 }))
    const client = makeClient()

    await client.checkpoints.delete("vm_abc123", "cp_abc123")
    expect(lastFetchUrl).toContain("/v1/vms/vm_abc123/checkpoints/cp_abc123")
    expect(lastFetchInit?.method).toBe("DELETE")
  })

  test("passes force=true as query param", async () => {
    setupMockFetch(() => new Response(null, { status: 204 }))
    const client = makeClient()

    await client.checkpoints.delete("vm_abc123", "cp_abc123", { force: true })
    expect(lastFetchUrl).toBe(
      `${BASE_URL}/v1/vms/vm_abc123/checkpoints/cp_abc123?force=true`,
    )
  })
})

// ==================== Rollback ====================

describe("rollback", () => {
  test("sends POST with snake_case body and maps response", async () => {
    setupMockFetch(() => jsonResponse(MOCK_API_VM))
    const client = makeClient()

    const vm = await client.rollback("vm_abc123", {
      checkpointId: "cp_abc123",
      preserveNewer: true,
    })
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/rollback`)
    expect(lastFetchInit?.method).toBe("POST")
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body.checkpoint_id).toBe("cp_abc123")
    expect(body.preserve_newer).toBe(true)
    expect(vm).toEqual(EXPECTED_VM)
  })
})

// ==================== Fork ====================

describe("fork", () => {
  test("sends POST and maps ForkResult", async () => {
    setupMockFetch(() =>
      jsonResponse({
        source_vm_id: "vm_abc123",
        checkpoint_id: "cp_abc123",
        vms: [MOCK_API_VM],
      }),
    )
    const client = makeClient()

    const result = await client.fork("vm_abc123", { count: 1 })
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_abc123/fork`)
    const body = JSON.parse(lastFetchInit?.body as string)
    expect(body.count).toBe(1)
    expect(result).toEqual({
      sourceVmId: "vm_abc123",
      checkpointId: "cp_abc123",
      vms: [EXPECTED_VM],
    })
  })
})

describe("forkTree", () => {
  test("maps recursive tree structure", async () => {
    setupMockFetch(() =>
      jsonResponse({
        vm_id: "vm_parent",
        name: "parent",
        status: "RUNNING",
        forked_from_checkpoint_id: null,
        children: [
          {
            vm_id: "vm_child",
            name: "child",
            status: "RUNNING",
            forked_from_checkpoint_id: "cp_abc123",
            children: [],
          },
        ],
      }),
    )
    const client = makeClient()

    const tree = await client.forkTree("vm_parent")
    expect(lastFetchUrl).toBe(`${BASE_URL}/v1/vms/vm_parent/tree`)
    expect(lastFetchInit?.method).toBe("GET")
    expect(tree).toEqual({
      vmId: "vm_parent",
      name: "parent",
      status: "RUNNING",
      forkedFromCheckpointId: null,
      children: [
        {
          vmId: "vm_child",
          name: "child",
          status: "RUNNING",
          forkedFromCheckpointId: "cp_abc123",
          children: [],
        },
      ],
    })
  })
})

// ==================== Error Handling ====================

describe("error handling", () => {
  test("throws APIError with status, message, and details from {error} format", async () => {
    setupMockFetch(() =>
      jsonResponse(
        { error: { code: "vm_not_found", message: "VM not found" } },
        404,
      ),
    )
    const client = makeClient()

    try {
      await client.vms.get("vm_missing")
      expect(true).toBe(false) // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(APIError)
      const apiErr = err as APIError
      expect(apiErr.status).toBe(404)
      expect(apiErr.message).toBe("VM not found")
      expect(apiErr.details).toEqual({ code: "vm_not_found", message: "VM not found" })
    }
  })

  test("falls back to statusText when no error body", async () => {
    setupMockFetch(
      () => new Response("not json", { status: 500, statusText: "Internal Server Error" }),
    )
    const client = makeClient()

    try {
      await client.vms.get("vm_abc123")
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(APIError)
      expect((err as APIError).status).toBe(500)
      expect((err as APIError).message).toBe("Internal Server Error")
    }
  })

  test("throws APIError on network failure", async () => {
    mockFetch = mock(() => Promise.reject(new TypeError("fetch failed")))
    global.fetch = mockFetch as typeof fetch
    const client = makeClient()

    try {
      await client.vms.list()
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(APIError)
      expect((err as APIError).message).toBe("Network request failed")
    }
  })
})

// ==================== Base URL ====================

describe("base URL handling", () => {
  test("strips trailing slashes from base URL", async () => {
    setupMockFetch(() => jsonResponse({ vms: [] }))
    const client = new Superserve({
      apiKey: API_KEY,
      baseUrl: "https://test.superserve.ai///",
    })

    await client.vms.list()
    expect(lastFetchUrl).toStartWith("https://test.superserve.ai/v1/vms")
  })
})
