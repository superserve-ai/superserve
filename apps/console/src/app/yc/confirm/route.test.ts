// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => vi.fn())
vi.mock("@/lib/yc-claims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/yc-claims")>()),
  ycRequest: request,
}))
import { GET, POST } from "./route"

const id = "11111111-1111-4111-8111-111111111111"
const token = "a".repeat(43)
const post = (origin = "https://console.example.test") =>
  new Request("https://console.example.test/yc/confirm", {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ id, token }),
  })
describe("YC possession confirmation", () => {
  beforeEach(() => {
    request.mockReset().mockResolvedValue({ state: "confirmed" })
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://console.example.test")
  })
  afterEach(() => vi.unstubAllEnvs())
  it("never consumes on GET and excludes analytics and third-party requests", async () => {
    const response = await GET()
    const body = await response.text()
    expect(request).not.toHaveBeenCalled()
    expect(body).toContain("location.hash")
    expect(body).toContain("history.replaceState")
    expect(body).toContain('<form method="post" action="/yc/confirm/">')
    expect(body).not.toContain("posthog")
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin")
    expect(body).toContain('<meta name="referrer" content="same-origin">')
  })
  it("rejects cross-origin confirmation before service access", async () => {
    expect((await POST(post("https://attacker.example.test"))).status).toBe(403)
    expect(request).not.toHaveBeenCalled()
  })
  it("sets a secure private cookie only after server confirmation", async () => {
    const response = await POST(post())
    expect(request).toHaveBeenCalledWith("confirm", { id, token })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://console.example.test/yc/claim",
    )
    const cookie = response.headers.get("set-cookie")!
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("SameSite=lax")
  })
  it("leaves no proof cookie after an expired token or service failure", async () => {
    request.mockRejectedValue(new Error("unavailable"))
    const response = await POST(post())
    expect(response.status).toBe(409)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it.each([
    "http://127.0.0.1:46300",
    "http://localhost:3000",
    "https://console.example.test",
  ])(
    "uses configured external origin %s behind an internal listener",
    async (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", `${origin}/`)
      const response = await POST(
        new Request("http://localhost:3000/yc/confirm", {
          method: "POST",
          headers: { origin, host: "localhost:3000" },
          body: new URLSearchParams({ id, token }),
        }),
      )
      expect(response.status).toBe(303)
      expect(request).toHaveBeenCalledExactlyOnceWith("confirm", { id, token })
      expect(response.headers.get("location")).toBe(`${origin}/yc/claim`)
      const cookie = response.headers.get("set-cookie")!
      expect(cookie).toContain("Secure")
      expect(cookie).toContain("HttpOnly")
      expect(cookie).toContain("SameSite=lax")
      expect(cookie).toContain("Path=/")
      expect(cookie).not.toContain("Domain=")
    },
  )
  it.each([
    undefined,
    "null",
    "http://localhost:3000",
    "http://127.0.0.1:46301",
    "https://127.0.0.1:46300",
    "http://127.0.0.1:46300/",
    "http://127.0.0.1:46300, https://attacker.example.test",
    "https://attacker.example.test",
  ])("rejects origin %j even with forged routing headers", async (origin) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:46300")
    const response = await POST(
      new Request("http://localhost:3000/yc/confirm", {
        method: "POST",
        headers: {
          ...(origin === undefined ? {} : { origin }),
          host: "127.0.0.1:46300",
          "x-forwarded-host": "127.0.0.1:46300",
          "x-forwarded-proto": "http",
          forwarded: 'host="127.0.0.1:46300";proto=http',
        },
        body: new URLSearchParams({ id, token }),
      }),
    )
    expect(response.status).toBe(403)
    expect(request).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
  })
  it.each([
    undefined,
    "",
    "http://console.example.test",
    "https://console.example.test/yc",
    "http://127.1:46300",
  ])(
    "fails closed for invalid app origin %j without trusting the request URL",
    async (configured) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", configured)
      const response = await POST(post())
      expect(response.status).toBe(403)
      expect(request).not.toHaveBeenCalled()
    },
  )
})
