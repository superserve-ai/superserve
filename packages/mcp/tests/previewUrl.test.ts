import { describe, expect, it } from "vitest"

import {
  buildPreviewUrl,
  deriveSandboxHost,
  PreviewUrlError,
} from "../src/lib/previewUrl.js"

describe("deriveSandboxHost", () => {
  it("maps prod and staging control planes to their sandbox apex", () => {
    expect(deriveSandboxHost("https://api.superserve.ai")).toBe(
      "sandbox.superserve.ai",
    )
    expect(deriveSandboxHost("https://api-staging.superserve.ai")).toBe(
      "staging-sandbox.superserve.ai",
    )
  })

  it("falls back to the prod sandbox host for unknown or invalid base URLs", () => {
    expect(deriveSandboxHost("https://example.test")).toBe(
      "sandbox.superserve.ai",
    )
    expect(deriveSandboxHost("not-a-url")).toBe("sandbox.superserve.ai")
  })
})

describe("buildPreviewUrl", () => {
  it("builds {port}-{id}.{host} on the default (prod) host", () => {
    expect(buildPreviewUrl("a1b2c3", 8080)).toBe(
      "https://8080-a1b2c3.sandbox.superserve.ai",
    )
  })

  it("uses the staging apex when given the staging base URL", () => {
    expect(
      buildPreviewUrl("a1b2c3", 4000, "https://api-staging.superserve.ai"),
    ).toBe("https://4000-a1b2c3.staging-sandbox.superserve.ai")
  })

  it("rejects out-of-range and non-integer ports", () => {
    expect(() => buildPreviewUrl("id", 0)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", 65536)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", 80.5)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("id", -1)).toThrow(PreviewUrlError)
  })

  // A sandbox id is caller-controlled; a `.`/`/`/`@` could re-point the host.
  it("rejects a sandbox id that is not host-safe", () => {
    expect(() => buildPreviewUrl("evil.example.com", 80)).toThrow(
      PreviewUrlError,
    )
    expect(() => buildPreviewUrl("id/../../x", 80)).toThrow(PreviewUrlError)
    expect(() => buildPreviewUrl("a@b", 80)).toThrow(PreviewUrlError)
  })
})
