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

const emptyState = {
  name: "",
  timeout: "",
  allowRules: [] as string[],
  denyRules: [] as string[],
  envEntries: [] as { key: string; value: string }[],
  metadataEntries: [] as { key: string; value: string }[],
}

describe("buildCreateSandboxRequest", () => {
  it("trims the name", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "  hi  " })
    expect(req.name).toBe("hi")
  })

  it("omits optional fields when form is minimal", () => {
    const req = buildCreateSandboxRequest({ ...emptyState, name: "x" })
    expect(req).toEqual({ name: "x" })
    expect(req.timeout).toBeUndefined()
    expect(req.network).toBeUndefined()
    expect(req.env_vars).toBeUndefined()
    expect(req.metadata).toBeUndefined()
  })

  it("includes timeout as a number when present", () => {
    const req = buildCreateSandboxRequest({
      ...emptyState,
      name: "x",
      timeout: "300",
    })
    expect(req.timeout).toBe(300)
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
      allowRules: ["api.example.com"],
      denyRules: ["malicious.test"],
      envEntries: [{ key: "API_KEY", value: "abc" }],
      metadataEntries: [{ key: "env", value: "prod" }],
    })
    expect(req).toEqual({
      name: "full",
      timeout: 600,
      network: {
        allow_out: ["api.example.com"],
        deny_out: ["malicious.test"],
      },
      env_vars: { API_KEY: "abc" },
      metadata: { env: "prod" },
    })
  })
})
