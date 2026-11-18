import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem"
import { describe, expect, it } from "vitest"

import nextConfig from "../next.config"

// The same route builder the Next server uses, with this config's case
// setting, so the test follows what production matches.
async function rewriteMatches(path: string): Promise<boolean> {
  const rewrites = await nextConfig.rewrites!()
  if (!Array.isArray(rewrites)) throw new Error("expected a rewrite list")
  return rewrites.some(
    (route) =>
      buildCustomRoute(
        "rewrite",
        route,
        "",
        nextConfig.experimental?.caseSensitiveRoutes,
      ).match(path) !== false,
  )
}

describe("next.config PostHog rewrites", () => {
  it("matches routes by exact case", () => {
    expect(nextConfig.experimental?.caseSensitiveRoutes).toBe(true)
  })

  it.each(["/ingest/static/array.js", "/ingest/e/", "/ingest/i/v0/e/"])(
    "rewrites %s",
    async (path) => {
      expect(await rewriteMatches(path)).toBe(true)
    },
  )

  it.each(["/INGEST/static/array.js", "/Ingest/e/", "/INGEST/e/"])(
    "does not rewrite %s with the console's cookies",
    async (path) => {
      expect(await rewriteMatches(path)).toBe(false)
    },
  )
})
