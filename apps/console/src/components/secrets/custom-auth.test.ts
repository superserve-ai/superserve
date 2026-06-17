/**
 * custom-auth — validation + payload mapping for the custom create path.
 *
 * Tests the pure helpers that gate the create-secret dialog's Custom tab
 * and convert its form state into a `CreateSecretRequest`. The dialog
 * itself is heavy (BaseUI Dialog, Field), so the logic is tested in
 * isolation rather than driving the UI.
 */

import { describe, expect, it } from "vitest"

import type { AuthRuleForm, CustomAuthForm } from "./custom-auth"
import {
  buildCustomSecretPayload,
  customFormComplete,
  emptyCustomAuthForm,
  emptyRule,
  validateCustomAuthForm,
} from "./custom-auth"
import { patternsOverlap, validateHost } from "./validate"

function rule(patch: Partial<AuthRuleForm>): AuthRuleForm {
  return { ...emptyRule(), ...patch }
}

function singleForm(patch: Partial<AuthRuleForm>): CustomAuthForm {
  return { ...emptyCustomAuthForm(), single: rule(patch) }
}

function perHostForm(rules: AuthRuleForm[]): CustomAuthForm {
  return { ...emptyCustomAuthForm(), perHost: true, rules }
}

describe("validateHost", () => {
  it("accepts exact hosts and wildcards", () => {
    expect(validateHost("api.example.com")).toBeNull()
    expect(validateHost("*.example.com")).toBeNull()
  })

  it("rejects malformed hosts", () => {
    expect(validateHost("not a host")).not.toBeNull()
    expect(validateHost("-bad.example.com")).not.toBeNull()
    expect(validateHost("single-label")).not.toBeNull()
    expect(validateHost("*.com")).not.toBeNull()
  })
})

describe("patternsOverlap", () => {
  it("matches the backend's wildcard-aware semantics", () => {
    expect(patternsOverlap("api.example.com", "api.example.com")).toBe(true)
    expect(patternsOverlap("api.example.com", "web.example.com")).toBe(false)
    expect(patternsOverlap("*.example.com", "api.example.com")).toBe(true)
    // A wildcard never matches its bare domain.
    expect(patternsOverlap("*.example.com", "example.com")).toBe(false)
    expect(patternsOverlap("*.example.com", "*.api.example.com")).toBe(true)
    expect(patternsOverlap("*.example.com", "*.example.org")).toBe(false)
  })
})

describe("customFormComplete", () => {
  it("requires at least one host", () => {
    expect(customFormComplete(emptyCustomAuthForm())).toBe(false)
    expect(customFormComplete(singleForm({ hosts: ["api.x.com"] }))).toBe(true)
  })

  it("requires a header name for api-key", () => {
    const base = { hosts: ["api.x.com"], type: "api-key" as const }
    expect(customFormComplete(singleForm(base))).toBe(false)
    expect(customFormComplete(singleForm({ ...base, header: "x-key" }))).toBe(
      true,
    )
  })

  it("requires at least one filled header for custom", () => {
    const base = { hosts: ["api.x.com"], type: "custom" as const }
    expect(customFormComplete(singleForm(base))).toBe(false)
    expect(
      customFormComplete(
        singleForm({
          ...base,
          headers: [{ name: "X-Auth", value: "{{ value }}" }],
        }),
      ),
    ).toBe(true)
  })

  it("requires every per-host rule to be complete", () => {
    expect(
      customFormComplete(perHostForm([rule({ hosts: ["a.x.com"] }), rule({})])),
    ).toBe(false)
    expect(
      customFormComplete(
        perHostForm([
          rule({ hosts: ["a.x.com"] }),
          rule({ hosts: ["b.x.com"] }),
        ]),
      ),
    ).toBe(true)
  })
})

describe("validateCustomAuthForm", () => {
  it("passes a clean single-rule form", () => {
    expect(
      validateCustomAuthForm(singleForm({ hosts: ["api.x.com"] })),
    ).toBeNull()
  })

  it("flags an invalid hostname", () => {
    expect(
      validateCustomAuthForm(singleForm({ hosts: ["not a host"] })),
    ).toMatch(/not a valid hostname/i)
  })

  it("flags ':' in the basic username", () => {
    expect(
      validateCustomAuthForm(
        singleForm({ type: "basic", username: "a:b", hosts: ["api.x.com"] }),
      ),
    ).toMatch(/username/)
  })

  it("flags custom header values without the placeholder", () => {
    expect(
      validateCustomAuthForm(
        singleForm({
          type: "custom",
          hosts: ["api.x.com"],
          headers: [{ name: "X-Auth", value: "no-placeholder" }],
        }),
      ),
    ).toMatch(/\{\{ value \}\}/)
  })

  it("flags overlapping hosts across per-host rules", () => {
    expect(
      validateCustomAuthForm(
        perHostForm([
          rule({ hosts: ["*.example.com"] }),
          rule({ hosts: ["api.example.com"] }),
        ]),
      ),
    ).toMatch(/overlaps/)
  })

  it("allows disjoint per-host rules", () => {
    expect(
      validateCustomAuthForm(
        perHostForm([
          rule({ hosts: ["api.github.com"] }),
          rule({ hosts: ["github.com"], type: "basic", username: "x" }),
        ]),
      ),
    ).toBeNull()
  })
})

describe("buildCustomSecretPayload", () => {
  it("builds a single-rule payload with trimmed hosts", () => {
    const req = buildCustomSecretPayload(
      " my_secret ",
      "v",
      singleForm({ hosts: [" api.x.com ", ""] }),
    )
    expect(req).toEqual({
      name: "my_secret",
      value: "v",
      hosts: ["api.x.com"],
      auth: { type: "bearer" },
    })
  })

  it("includes only the fields the type accepts", () => {
    const req = buildCustomSecretPayload(
      "s",
      "v",
      singleForm({
        type: "api-key",
        header: " x-api-key ",
        prefix: "Bearer ",
        hosts: ["api.x.com"],
      }),
    )
    expect(req.auth).toEqual({
      type: "api-key",
      header: "x-api-key",
      prefix: "Bearer ",
    })
  })

  it("derives the allowlist from per-host rule hosts", () => {
    const req = buildCustomSecretPayload(
      "s",
      "v",
      perHostForm([
        rule({ hosts: ["api.github.com"] }),
        rule({ hosts: ["github.com"], type: "basic", username: "x" }),
      ]),
    )
    expect(req.hosts).toEqual(["api.github.com", "github.com"])
    expect(req.auth).toEqual({
      per_host: [
        { hosts: ["api.github.com"], type: "bearer" },
        { hosts: ["github.com"], type: "basic", username: "x" },
      ],
    })
  })

  it("drops empty custom header rows", () => {
    const req = buildCustomSecretPayload(
      "s",
      "v",
      singleForm({
        type: "custom",
        hosts: ["api.x.com"],
        headers: [
          { name: "X-Auth", value: "Token {{ value }}" },
          { name: "", value: "" },
        ],
      }),
    )
    expect(req.auth).toEqual({
      headers: { "X-Auth": "Token {{ value }}" },
      type: "custom",
    })
  })
})
