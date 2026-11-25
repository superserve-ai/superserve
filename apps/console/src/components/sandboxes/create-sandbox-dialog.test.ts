/**
 * create-sandbox-dialog — payload mapping.
 *
 * Tests the pure builder that converts form state to a
 * `CreateSandboxRequest`. The dialog itself is heavy (BaseUI Dialog,
 * Select, Field, motion animations, Highlighted code), so we test the
 * logic in isolation rather than driving the UI.
 */

import { describe, expect, it } from "vitest"

import { buildCreateSandboxRequest } from "./create-sandbox-dialog"
import {
  chosenSizeLine,
  memorySteps,
  snapshotSource,
  templateSource,
} from "./sandbox-size-section"

const emptyState = {
  name: "",
  timeout: "",
  idleTimeout: "",
  autoDelete: "",
  allowRules: [] as string[],
  denyRules: [] as string[],
  secretEntries: [] as { key: string; secret: string }[],
  envEntries: [] as { key: string; value: string }[],
  metadataEntries: [] as { key: string; value: string }[],
  previewAccess: "public" as const,
}

describe("buildCreateSandboxRequest source", () => {
  it("sends from_template for a template source", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      templateRef: "superserve/base",
    })
    expect(req.from_template).toBe("superserve/base")
    expect(req).not.toHaveProperty("from_snapshot")
  })

  it("sends from_snapshot and never from_template for a snapshot source", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      templateRef: "superserve/base",
      snapshotId: "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
    })
    expect(req.from_snapshot).toBe("0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b")
    expect(req).not.toHaveProperty("from_template")
  })
})

describe("buildCreateSandboxRequest size", () => {
  const ranged = templateSource({
    vcpu: 1,
    memory_mib: 2048,
    size_range: { vcpu_max: 4, memory_max_mib: 8192 },
  })

  it("sends a fixed vcpu and memory_mib within the template range", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      templateRef: "my-env",
      size: ranged,
      vcpu: 3,
      memoryMib: 6144,
    })
    expect(req.vcpu).toBe(3)
    expect(req.memory_mib).toBe(6144)
  })

  it("sends nothing for the default or a dimension without a range", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      templateRef: "my-env",
      size: templateSource({ vcpu: 2, memory_mib: 2048, memory_max_mib: 8192 }),
      vcpu: 2,
      memoryMib: null,
    })
    expect(req).not.toHaveProperty("vcpu")
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("sends a size chosen within a snapshot's ranges", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      snapshotId: "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
      size: snapshotSource({
        vcpu_count: 2,
        memory_mib: 2048,
        vcpu_range: { min: 1, max: 4 },
      }),
      vcpu: 3,
      memoryMib: 4096,
    })
    expect(req).toMatchObject({
      from_snapshot: "0b6f3c1e-4d2a-4f7b-9a1e-2c3d4e5f6a7b",
      vcpu: 3,
    })
    // No memory range on this snapshot, so memory_mib is never sent.
    expect(req).not.toHaveProperty("memory_mib")
  })

  it("rejects a pick outside the range or off the 2 MiB grid", () => {
    for (const pick of [
      { vcpu: 5 },
      { vcpu: 1.5 },
      { memoryMib: 1024 },
      { memoryMib: 6145 },
    ]) {
      expect(() =>
        buildCreateSandboxRequest({
          ...emptyState,
          name: "x",
          templateRef: "my-env",
          size: ranged,
          ...pick,
        }),
      ).toThrow()
    }
  })
})

describe("size helpers", () => {
  it("steps memory by 256 MiB from the minimum and ends at the maximum", () => {
    expect(memorySteps(1024, 2000)).toEqual([1024, 1280, 1536, 1792, 2000])
    for (const v of memorySteps(1026, 4096)) expect((v - 1026) % 2).toBe(0)
  })

  it("describes the default size and a chosen one", () => {
    const t = { vcpu: 1, vcpu_max: 4, memory_mib: 1024, memory_max_mib: 4096 }
    expect(chosenSizeLine(templateSource(t), null, null)).toBe(
      "1 vCPU · 1 GB · can grow to 4 vCPU · 4 GB",
    )
    expect(chosenSizeLine(templateSource(t), 2, 3072)).toBe("2 vCPU · 3 GB")
    expect(
      chosenSizeLine(
        templateSource({ ...t, memory_max_mib: undefined }),
        null,
        null,
      ),
    ).toBe("1 vCPU · 1 GB · can grow to 4 vCPU")
    expect(
      chosenSizeLine(templateSource({ vcpu: 2, memory_mib: 2048 }), null, null),
    ).toBe("2 vCPU · 2 GB")
    expect(
      chosenSizeLine(
        snapshotSource({ vcpu_count: 2, memory_mib: 2048 }),
        null,
        null,
      ),
    ).toBe("2 vCPU · 2 GB · from snapshot")
  })
})

describe("buildCreateSandboxRequest", () => {
  it("trims the name", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "  hi  " })
    expect(req.name).toBe("hi")
  })

  it("omits optional fields when form is minimal", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "x" })
    expect(req).toEqual({ name: "x", preview_access: "public" })
    expect(req.timeout_seconds).toBeUndefined()
    expect(req.network).toBeUndefined()
    expect(req.env_vars).toBeUndefined()
    expect(req.metadata).toBeUndefined()
  })

  it("includes the selected private preview policy", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      previewAccess: "private",
    })
    expect(req.preview_access).toBe("private")
  })

  it("includes timeout_seconds as a number when present", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      timeout: "300",
    })
    expect(req.timeout_seconds).toBe(300)
  })

  it("includes idle_timeout_seconds when present and omits it when blank", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      idleTimeout: "600",
    })
    expect(req.idle_timeout_seconds).toBe(600)
    expect(
      buildCreateSandboxRequest({ ...emptyState, name: "x" })
        .idle_timeout_seconds,
    ).toBeUndefined()
  })

  it("rejects an idle timeout under a minute", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        idleTimeout: "30",
      }),
    ).toThrow()
  })

  it("includes auto_delete_seconds as a number when present", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      autoDelete: "3600",
    })
    expect(req.auto_delete_seconds).toBe(3600)
  })

  it("accepts auto_delete_seconds of 0 (delete on pause)", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      autoDelete: "0",
    })
    expect(req.auto_delete_seconds).toBe(0)
  })

  it("throws on a non-finite window ('1e309' → Infinity → null)", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "1e309",
      }),
    ).toThrow(/whole number/)
  })

  it("throws on a fractional window", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "1.5",
      }),
    ).toThrow(/whole number/)
  })

  it("throws on an out-of-range window", () => {
    expect(() =>
      buildCreateSandboxRequest({
        ...emptyState,
        name: "x",
        autoDelete: "2592001",
      }),
    ).toThrow(/whole number/)
  })

  it("throws when timeout is below its minimum of 1", () => {
    expect(() =>
      buildCreateSandboxRequest({ ...emptyState, name: "x", timeout: "0" }),
    ).toThrow(/whole number/)
  })

  it("omits network when all rules are empty strings", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: ["", "  "],
      denyRules: [""],
    })
    expect(req.network).toBeUndefined()
  })

  it("includes network.allow_out only (not deny_out) when no deny rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: ["api.example.com", "*.github.com"],
    })
    expect(req.network).toEqual({
      allow_out: ["api.example.com", "*.github.com"],
    })
    expect(req.network?.deny_out).toBeUndefined()
  })

  it("includes network.deny_out only (not allow_out) when no allow rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      denyRules: ["malicious.test"],
    })
    expect(req.network).toEqual({ deny_out: ["malicious.test"] })
  })

  it("trims and drops blank network rules", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      allowRules: [" api.example.com ", "", "   "],
    })
    expect(req.network?.allow_out).toEqual(["api.example.com"])
  })

  it("omits env_vars when no entry has a key", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      envEntries: [
        { key: "", value: "v" },
        { key: "   ", value: "" },
      ],
    })
    expect(req.env_vars).toBeUndefined()
  })

  it("includes env_vars with trimmed keys/values", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      envEntries: [
        { key: " API_KEY ", value: " abc " },
        { key: "DEBUG", value: "" },
      ],
    })
    expect(req.env_vars).toEqual({ API_KEY: "abc", DEBUG: "" })
  })

  it("omits secrets when no entry is complete", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      secretEntries: [
        { key: "", secret: "openai_api_key" },
        { key: "OPENAI_API_KEY", secret: "" },
      ],
    })
    expect(req.secrets).toBeUndefined()
  })

  it("includes secrets with trimmed env keys", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      secretEntries: [{ key: " OPENAI_API_KEY ", secret: "openai_api_key" }],
    })
    expect(req.secrets).toEqual({ OPENAI_API_KEY: "openai_api_key" })
  })

  it("includes metadata with trimmed keys/values", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      metadataEntries: [
        { key: "env", value: "prod" },
        { key: "owner ", value: " team-a " },
      ],
    })
    expect(req.metadata).toEqual({ env: "prod", owner: "team-a" })
  })

  it("builds a full request with everything set", () => {
    const req = buildCreateSandboxRequest({
      name: "full",
      timeout: "600",
      idleTimeout: "900",
      autoDelete: "3600",
      allowRules: ["api.example.com"],
      denyRules: ["malicious.test"],
      secretEntries: [{ key: "GITHUB_TOKEN", secret: "github_pat" }],
      envEntries: [{ key: "API_KEY", value: "abc" }],
      metadataEntries: [{ key: "env", value: "prod" }],
      previewAccess: "private",
    })
    expect(req).toEqual({
      name: "full",
      preview_access: "private",
      timeout_seconds: 600,
      idle_timeout_seconds: 900,
      auto_delete_seconds: 3600,
      network: {
        allow_out: ["api.example.com"],
        deny_out: ["malicious.test"],
      },
      secrets: { GITHUB_TOKEN: "github_pat" },
      env_vars: { API_KEY: "abc" },
      metadata: { env: "prod" },
    })
  })
})
