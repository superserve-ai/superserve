import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { HEEDEO_BROWSER_COOKIES } from "@/lib/heedeo/shared"

import nextConfig from "../next.config"
import { config, middleware } from "./middleware"

// A request that reaches a PostHog rewrite must first pass the middleware,
// which drops the Cookie header. Heedeo keeps its token and visitor ID in
// `Path=/` cookies, so a path that rewrites without the middleware would send
// them to PostHog. This checks the real matcher and rewrites together.
async function rewritesToPostHog(path: string): Promise<boolean> {
  const rewrites = await nextConfig.rewrites!()
  if (!Array.isArray(rewrites)) throw new Error("expected a rewrite list")
  return rewrites.some(
    (route) =>
      route.destination.includes("posthog.com") &&
      buildCustomRoute(
        "rewrite",
        route,
        "",
        nextConfig.experimental?.caseSensitiveRoutes,
      ).match(path) !== false,
  )
}

async function forwardedCookie(path: string): Promise<string | null> {
  const request = new NextRequest(
    new URL(`https://console.superserve.ai${path}`),
  )
  // Set after construction: happy-dom's Request drops a cookie header.
  request.headers.set(
    "cookie",
    `${HEEDEO_BROWSER_COOKIES.map((name) => `${name}=v1`).join("; ")}; ph_x=1`,
  )
  const res = await middleware(request)
  // With overrides, Next forwards only the listed request headers.
  const overrides = res.headers.get("x-middleware-override-headers")
  if (overrides === null) return request.headers.get("cookie")
  if (!overrides.split(",").includes("cookie")) return null
  return res.headers.get("x-middleware-request-cookie")
}

const CASES = ["ingest", "INGEST", "Ingest", "InGeSt", "ingesT"]
const TAILS = ["", "/", "/e/", "/i/v0/e/", "/static/array.js", "/static/x.css"]

describe("PostHog rewrite and middleware together", () => {
  it("rewrites the lowercase paths, so the check below is not empty", async () => {
    expect(await rewritesToPostHog("/ingest/static/array.js")).toBe(true)
    expect(await rewritesToPostHog("/ingest/e/")).toBe(true)
  })

  it.each(CASES.flatMap((name) => TAILS.map((tail) => `/${name}${tail}`)))(
    "sends no Heedeo cookie to PostHog for %s",
    async (path) => {
      if (!(await rewritesToPostHog(path))) return
      expect(
        unstable_doesMiddlewareMatch({ config, url: path, nextConfig }),
      ).toBe(true)
      const cookie = await forwardedCookie(path)
      for (const name of HEEDEO_BROWSER_COOKIES)
        expect(cookie ?? "").not.toMatch(new RegExp(`(^|; )${name}=`))
    },
  )
})
