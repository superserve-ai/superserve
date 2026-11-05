import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match"
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination"
import { expect, it } from "vitest"

import nextConfig from "../../next.config"
import { legacyRedirects } from "./legacy-redirects"

async function resolveRedirect(pathname: string) {
  const redirects = await nextConfig.redirects!()
  for (const redirect of redirects) {
    const params = getPathMatch(redirect.source)(pathname)
    if (!params) continue
    return prepareDestination({
      destination: redirect.destination,
      params,
      query: {},
      appendParamsToQuery: false,
    }).newUrl
  }
  return null
}

it.each([
  ["/plan-usage", "/billing-usage/"],
  ["/plan-usage/", "/billing-usage/"],
  ["/plan-usage/buy-credit", "/billing-usage/buy-credit/"],
  ["/plan-usage/buy-credit/", "/billing-usage/buy-credit/"],
  ["/plan-usage/upgrade/", "/billing-usage/upgrade/"],
  [
    "/plan-usage/buy-credit/receipt/details/",
    "/billing-usage/buy-credit/receipt/details/",
  ],
])("redirects %s to %s", async (source, destination) => {
  expect(await resolveRedirect(source)).toBe(destination)
})

it("registers permanent redirects without query rules or destination queries", async () => {
  const redirects = await nextConfig.redirects!()
  expect(redirects).toEqual(legacyRedirects)
  expect(redirects.length).toBeGreaterThan(0)
  expect(nextConfig.trailingSlash).toBe(true)
  for (const redirect of redirects) {
    expect(redirect.permanent).toBe(true)
    expect(redirect.destination).toMatch(/\/$/)
    expect(redirect.destination).not.toContain("?")
    expect(redirect).not.toHaveProperty("has")
    expect(redirect).not.toHaveProperty("missing")
  }
})

it.each([
  "/plan-usage-old/",
  "/billing-usage/",
  "/settings/",
  "/other/plan-usage/",
])("does not redirect unrelated path %s", async (pathname) => {
  expect(await resolveRedirect(pathname)).toBeNull()
})
