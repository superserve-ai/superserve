import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { dataPlaneUrl, resolveConfig } from "../src/config.js"
import { AuthenticationError } from "../src/errors.js"

describe("resolveConfig", () => {
  let savedApiKey: string | undefined
  let savedBaseUrl: string | undefined

  beforeEach(() => {
    savedApiKey = process.env.SUPERSERVE_API_KEY
    savedBaseUrl = process.env.SUPERSERVE_BASE_URL
    delete process.env.SUPERSERVE_API_KEY
    delete process.env.SUPERSERVE_BASE_URL
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (savedApiKey !== undefined) process.env.SUPERSERVE_API_KEY = savedApiKey
    else delete process.env.SUPERSERVE_API_KEY
    if (savedBaseUrl !== undefined) process.env.SUPERSERVE_BASE_URL = savedBaseUrl
    else delete process.env.SUPERSERVE_BASE_URL
  })

  it("uses explicit apiKey over env var", () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "env-key")
    const cfg = resolveConfig({ apiKey: "explicit" })
    expect(cfg.apiKey).toBe("explicit")
  })

  it("falls back to SUPERSERVE_API_KEY env var", () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "env-key")
    const cfg = resolveConfig()
    expect(cfg.apiKey).toBe("env-key")
  })

  it("throws AuthenticationError when both are missing", () => {
    expect(() => resolveConfig()).toThrow(AuthenticationError)
  })

  it("uses explicit baseUrl over env var", () => {
    vi.stubEnv("SUPERSERVE_BASE_URL", "https://env.example.com")
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://explicit.example.com",
    })
    expect(cfg.baseUrl).toBe("https://explicit.example.com")
  })

  it("falls back to SUPERSERVE_BASE_URL env var", () => {
    vi.stubEnv("SUPERSERVE_BASE_URL", "https://env.example.com")
    const cfg = resolveConfig({ apiKey: "k" })
    expect(cfg.baseUrl).toBe("https://env.example.com")
  })

  it("defaults baseUrl to api.superserve.ai", () => {
    const cfg = resolveConfig({ apiKey: "k" })
    expect(cfg.baseUrl).toBe("https://api.superserve.ai")
  })

  it("derives sandboxHost for production", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://api.superserve.ai",
    })
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })

  it("derives sandboxHost for staging", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://api-staging.superserve.ai",
    })
    expect(cfg.sandboxHost).toBe("sandbox-staging.superserve.ai")
  })

  it("derives sandboxHost falls back to default for unknown URL", () => {
    const cfg = resolveConfig({
      apiKey: "k",
      baseUrl: "https://custom.example.com",
    })
    expect(cfg.sandboxHost).toBe("sandbox.superserve.ai")
  })
})

describe("dataPlaneUrl", () => {
  it("builds data plane URL from sandbox id and host", () => {
    expect(dataPlaneUrl("abc-123", "sandbox.superserve.ai")).toBe(
      "https://boxd-abc-123.sandbox.superserve.ai",
    )
  })

  it("builds staging data plane URL", () => {
    expect(dataPlaneUrl("xyz", "sandbox-staging.superserve.ai")).toBe(
      "https://boxd-xyz.sandbox-staging.superserve.ai",
    )
  })
})
