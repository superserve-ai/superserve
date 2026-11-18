// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  forwardHeedeoRequest,
  HEEDEO_PROXY_BODY_MAX,
  type HeedeoProxyOptions,
  heedeoProxyOptions,
  trustedClientIp,
} from "./proxy"

const BASE = "https://console.superserve.ai/api/dv"

function options(
  upstream: typeof fetch,
  overrides: Partial<HeedeoProxyOptions> = {},
): HeedeoProxyOptions {
  return {
    enabled: true,
    secretKey: "sk_test_secret",
    clientIp: "203.0.113.7",
    fetch: upstream,
    ...overrides,
  }
}

const ok = (body = "ok", init: ResponseInit = {}) =>
  vi.fn<typeof fetch>(async () => new Response(body, init))

afterEach(() => {
  vi.useRealTimers()
  delete process.env.HEEDEO_SECRET_KEY
  delete process.env.HEEDEO_SIGNUP_OBSERVATION
  delete process.env.VERCEL
})

describe("forwardHeedeoRequest", () => {
  it("forwards the script to the fixed upstream with the key and the visitor IP", async () => {
    const upstream = ok("(()=>{})()", {
      headers: {
        "content-type": "text/javascript",
        "cache-control": "public, max-age=3600",
        "x-railway-request-id": "internal",
      },
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk_live_1`, {
        headers: {
          host: "evil.example.com",
          "user-agent": "UA",
          cookie: "sb-access-token=secret; _idd=visitor1; other=x",
          authorization: "Bearer user-token",
        },
      }),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("(()=>{})()")
    expect(response.headers.get("content-type")).toBe("text/javascript")
    expect(response.headers.get("x-railway-request-id")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("no-cache")
    const [target, init] = upstream.mock.calls[0]!
    expect(String(target)).toBe("https://app.heedeo.com/i.js?key=pk_live_1")
    const sent = new Headers(init?.headers)
    expect(sent.get("authorization")).toBe("Bearer sk_test_secret")
    expect(sent.get("x-heedeo-client-ip")).toBe("203.0.113.7")
    expect(sent.get("cookie")).toBe("_idd=visitor1")
    expect(sent.get("user-agent")).toBe("UA")
    expect(sent.get("host")).toBeNull()
    expect(init?.redirect).toBe("manual")
  })

  it("never sends console cookies upstream when there is no visitor cookie", async () => {
    const upstream = ok()
    await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`, {
        headers: { cookie: "sb-access-token=secret; __Host-x=y" },
      }),
      ["i.js"],
      options(upstream),
    )
    expect(new Headers(upstream.mock.calls[0]![1]?.headers).get("cookie")).toBe(
      null,
    )
  })

  it("posts identify with its body and passes back only the visitor cookie, host-only", async () => {
    const upstream = vi.fn<typeof fetch>(async () => {
      const headers = new Headers({
        "content-type": "application/json",
        "access-control-allow-origin": "https://console.superserve.ai",
        "x-other": "no",
      })
      headers.append(
        "set-cookie",
        "_idd=v2; Path=/; Domain=.superserve.ai; HttpOnly; Secure; SameSite=Lax",
      )
      headers.append("set-cookie", "sb-access-token=hijack; Path=/")
      return new Response('{"token":"t"}', { status: 200, headers })
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/v1/identify?key=pk`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: '{"components":{}}',
      }),
      ["v1", "identify"],
      options(upstream, { ja4: "t13d1516h2_abc" }),
    )
    expect(response.status).toBe(200)
    const [target, init] = upstream.mock.calls[0]!
    expect(String(target)).toBe("https://app.heedeo.com/v1/identify?key=pk")
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(
      '{"components":{}}',
    )
    expect(new Headers(init?.headers).get("x-heedeo-connection")).toBe(
      '{"ja4":"t13d1516h2_abc"}',
    )
    expect(response.headers.getSetCookie()).toEqual([
      "_idd=v2; Path=/; HttpOnly; Secure; SameSite=Lax",
    ])
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://console.superserve.ai",
    )
    expect(response.headers.get("x-other")).toBeNull()
  })

  it.each([
    [["v1", "visitors", "abc"]],
    [["v1", "evaluations"]],
    [[".."]],
    [["i.js", ".."]],
    [["%2F%2Fevil.example.com"]],
    [["https:", "", "evil.example.com"]],
  ])("refuses any other path without calling Heedeo: %j", async (segments) => {
    const upstream = ok()
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/x`),
      segments,
      options(upstream),
    )
    expect(response.status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("refuses other methods", async () => {
    const upstream = ok()
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js`, { method: "POST", body: "x" }),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET")
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([
    ["disabled", { enabled: false }],
    ["without a secret key", { secretKey: undefined }],
  ])(
    "answers 403, which the script does not retry elsewhere, when %s",
    async (_label, overrides) => {
      const upstream = ok()
      const response = await forwardHeedeoRequest(
        new Request(`${BASE}/i.js?key=pk`),
        ["i.js"],
        options(upstream, overrides),
      )
      expect(response.status).toBe(403)
      expect(upstream).not.toHaveBeenCalled()
    },
  )

  it("answers 503 without a trusted client IP", async () => {
    const upstream = ok()
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`),
      ["i.js"],
      options(upstream, { clientIp: null }),
    )
    expect(response.status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("refuses a body over 64 KB by its declared length or as it streams", async () => {
    const upstream = ok()
    const declared = await forwardHeedeoRequest(
      new Request(`${BASE}/v1/identify`, {
        method: "POST",
        headers: { "content-length": String(HEEDEO_PROXY_BODY_MAX + 1) },
        body: "x",
      }),
      ["v1", "identify"],
      options(upstream),
    )
    expect(declared.status).toBe(413)
    const streamed = await forwardHeedeoRequest(
      new Request(`${BASE}/v1/identify`, {
        method: "POST",
        body: "x".repeat(HEEDEO_PROXY_BODY_MAX + 1),
      }),
      ["v1", "identify"],
      options(upstream),
    )
    expect(streamed.status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("does not follow an upstream redirect", async () => {
    const upstream = ok("", {
      status: 302,
      headers: { location: "https://evil.example.com/" },
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(502)
    expect(response.headers.get("location")).toBeNull()
  })

  it("passes a 304 back with no body", async () => {
    const upstream = ok(null as unknown as string, {
      status: 304,
      headers: { etag: '"a"' },
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`, {
        headers: { "if-none-match": '"a"' },
      }),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(304)
    expect(response.headers.get("etag")).toBe('"a"')
    expect(
      new Headers(upstream.mock.calls[0]![1]?.headers).get("if-none-match"),
    ).toBe('"a"')
  })

  it("passes a 204 preflight answer back with no body", async () => {
    const upstream = ok(null as unknown as string, {
      status: 204,
      headers: { "access-control-allow-origin": "https://console.example.com" },
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/v1/identify?key=pk`, { method: "OPTIONS" }),
      ["v1", "identify"],
      options(upstream),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://console.example.com",
    )
  })

  it("fails open with 502 on a network error", async () => {
    const upstream = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed")
    })
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(502)
  })

  it("gives up at the time limit", async () => {
    const upstream = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          )
        }),
    )
    const started = Date.now()
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`),
      ["i.js"],
      options(upstream, { timeoutMs: 50 }),
    )
    expect(response.status).toBe(502)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("stops reading an upstream body that goes on past the limit", async () => {
    const chunk = new Uint8Array(256 * 1024)
    const upstream = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk)
            },
          }),
        ),
    )
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=pk`),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(502)
  })

  it("refuses an overlong query string", async () => {
    const upstream = ok()
    const response = await forwardHeedeoRequest(
      new Request(`${BASE}/i.js?key=${"a".repeat(3000)}`),
      ["i.js"],
      options(upstream),
    )
    expect(response.status).toBe(414)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe("trustedClientIp", () => {
  it("reads Vercel's headers and ignores cf-connecting-ip", () => {
    expect(
      trustedClientIp(
        new Headers({
          "cf-connecting-ip": "198.51.100.1",
          "x-real-ip": "203.0.113.7",
        }),
      ),
    ).toBe("203.0.113.7")
    expect(
      trustedClientIp(
        new Headers({ "x-forwarded-for": "2001:db8::1, 10.0.0.1" }),
      ),
    ).toBe("2001:db8::1")
    expect(
      trustedClientIp(new Headers({ "cf-connecting-ip": "198.51.100.1" })),
    ).toBeNull()
    expect(
      trustedClientIp(new Headers({ "x-real-ip": "not an ip<script>" })),
    ).toBeNull()
  })
})

describe("heedeoProxyOptions", () => {
  it("is enabled by a secret key and turned off by the kill switch", () => {
    expect(heedeoProxyOptions(new Headers()).enabled).toBe(false)
    process.env.HEEDEO_SECRET_KEY = "sk_live"
    expect(heedeoProxyOptions(new Headers()).enabled).toBe(true)
    process.env.HEEDEO_SIGNUP_OBSERVATION = "off"
    expect(heedeoProxyOptions(new Headers()).enabled).toBe(false)
  })

  it("reads the JA4 digest only on Vercel", () => {
    const headers = new Headers({ "x-vercel-ja4-digest": "t13d_abc" })
    expect(heedeoProxyOptions(headers).ja4).toBeNull()
    process.env.VERCEL = "1"
    expect(heedeoProxyOptions(headers).ja4).toBe("t13d_abc")
  })
})
