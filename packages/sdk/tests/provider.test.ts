import { afterEach, describe, expect, it, vi } from "vitest"

import { Provider } from "../src/Provider.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Provider.list", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /providers and maps the catalog", async () => {
    const mock = vi.fn(async () =>
      jsonResponse([
        {
          name: "anthropic",
          display: "Anthropic",
          auth_type: "api-key",
          auth_config: { header: "x-api-key" },
          hosts: ["api.anthropic.com"],
          token_shape: "sk-ant-api03-...",
        },
        {
          name: "github",
          display: "GitHub",
          auth_type: "per_host",
          auth_config: {},
          hosts: ["api.github.com", "github.com"],
          token_shape: "ghp_...",
        },
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const providers = await Provider.list(commonOpts)
    expect(mock.mock.calls[0][0]).toBe("https://api.superserve.ai/providers")
    expect(providers).toHaveLength(2)
    expect(providers[0]).toEqual({
      name: "anthropic",
      display: "Anthropic",
      authType: "api-key",
      authConfig: { header: "x-api-key" },
      hosts: ["api.anthropic.com"],
      tokenShape: "sk-ant-api03-...",
    })
    expect(providers[1].authType).toBe("per_host")
    expect(providers[1].hosts).toEqual(["api.github.com", "github.com"])
  })
})
