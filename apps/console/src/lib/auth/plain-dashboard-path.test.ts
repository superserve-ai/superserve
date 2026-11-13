import { expect, it } from "vitest"

import { isPlainDashboardPath } from "./plain-dashboard-path"

it.each(["/", "/sandboxes", "/sandboxes?view=active#list"])(
  "accepts %s",
  (path) => {
    expect(isPlainDashboardPath(path)).toBe(true)
  },
)
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
  "/billing/pro/",
  "/billing-usage/buy-credit",
])("excludes %s", (path) => {
  expect(isPlainDashboardPath(path)).toBe(false)
})
