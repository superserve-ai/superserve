// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  })
  it("never consumes on GET and excludes analytics and third-party requests", async () => {
    const response = await GET()
    const body = await response.text()
    expect(request).not.toHaveBeenCalled()
    expect(body).toContain("location.hash")
    expect(body).toContain("history.replaceState")
    expect(body).not.toContain("posthog")
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
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
})
