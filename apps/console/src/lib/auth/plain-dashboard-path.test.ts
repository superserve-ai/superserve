import { expect, it } from "vitest"

import { isPlainDashboardPath } from "./plain-dashboard-path"

it.each([
  "/",
  "/sandboxes",
  "/sandboxes/",
  "/sandboxes/abc",
  "/sandboxes?view=active#list",
  "/settings?tab=general",
  "/templates",
  "/secrets",
  "/snapshots",
  "/audit-logs",
  "/api-keys",
  "/team",
  "/get-started",
  "/billing-usage/",
])("accepts %s", (path) => {
  expect(isPlainDashboardPath(path)).toBe(true)
})
it.each([
  "//example.com",
  "https://example.com",
  "/\\example.com",
  "/auth/signin",
  "/onboarding",
  "/api/example",
  "/invite/example",
  "/yc/claim",
  "/device",
  "/admin",
  "/%61uth/signin",
  "/sandboxesx",
  "/unknown",
  "/sandboxes?team=use:x",
  "/sandboxes?account=example",
  "/sandboxes?%74eam=use:x",
  "/sandboxes/abc%2fdef",
  "/sandboxes\n",
  "/billing",
  "/billing/pro",
  "/billing/pro/",
  "/billing/pro/?team=use:team-b#details",
  "/billing/pro/?team=use:team-b&utm_source=email",
  "/billing/pro/?utm_source=email",
  "/billing/pro/#details",
  "/billing-usage/buy-credit?team=use:team-b",
  "/billing-usage/buy-credit/",
  "/billing-usage/buy-credit/details",
  "/billing-usage/buy-credit",
])("excludes %s", (path) => {
  expect(isPlainDashboardPath(path)).toBe(false)
})
