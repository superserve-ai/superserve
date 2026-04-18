import { describe, expect, it } from "vitest"

import { toSandboxInfo } from "../src/types.js"

describe("toSandboxInfo", () => {
  const valid = {
    id: "sbx-1",
    name: "my-sandbox",
    status: "active",
    vcpu_count: 2,
    memory_mib: 512,
    access_token: "tok-abc",
    snapshot_id: "snap-1",
    created_at: "2026-01-01T00:00:00.000Z",
    timeout_seconds: 600,
    network: { allow_out: ["1.1.1.1"], deny_out: ["2.2.2.2"] },
    metadata: { env: "prod" },
  }

  it("converts a valid response to SandboxInfo", () => {
    const info = toSandboxInfo(valid)
    expect(info.id).toBe("sbx-1")
    expect(info.name).toBe("my-sandbox")
    expect(info.status).toBe("active")
    expect(info.vcpuCount).toBe(2)
    expect(info.memoryMib).toBe(512)
    expect(info.accessToken).toBe("tok-abc")
    expect(info.snapshotId).toBe("snap-1")
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(info.timeoutSeconds).toBe(600)
    expect(info.network).toEqual({
      allowOut: ["1.1.1.1"],
      denyOut: ["2.2.2.2"],
    })
    expect(info.metadata).toEqual({ env: "prod" })
  })

  it("throws when id is missing", () => {
    expect(() => toSandboxInfo({ ...valid, id: undefined })).toThrow(
      /missing sandbox id/,
    )
  })

  it("throws when status is missing", () => {
    expect(() => toSandboxInfo({ ...valid, status: undefined })).toThrow(
      /missing sandbox status/,
    )
  })

  it("accepts a missing access_token (list responses omit it)", () => {
    const info = toSandboxInfo({ ...valid, access_token: undefined })
    expect(info.id).toBe(valid.id)
    expect(info.accessToken).toBeUndefined()
  })

  it("defaults optional fields when missing", () => {
    const info = toSandboxInfo({
      id: "sbx-1",
      status: "active",
      access_token: "tok",
    })
    expect(info.name).toBe("")
    expect(info.vcpuCount).toBe(0)
    expect(info.memoryMib).toBe(0)
    expect(info.snapshotId).toBeUndefined()
    expect(info.timeoutSeconds).toBeUndefined()
    expect(info.network).toBeUndefined()
    expect(info.metadata).toEqual({})
  })

  it("uses current time when created_at missing", () => {
    const before = Date.now()
    const info = toSandboxInfo({
      id: "sbx-1",
      status: "active",
      access_token: "tok",
    })
    const after = Date.now()
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(info.createdAt.getTime()).toBeLessThanOrEqual(after)
  })
})
