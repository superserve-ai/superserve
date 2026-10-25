import { expect, it } from "vitest"

import { proAuthReturnPath } from "./pro-auth-return"

it.each([
  "/billing/pro",
  "/billing/pro/",
  "/billing/pro/?billing=success&team=use%3Aoriginal&return=%2Fsandboxes%3Fview%3Dactive",
  "/billing/pro?billing=cancel&team=use%3Aoriginal",
])("retains the Pro navigation locator: %s", (path) => {
  expect(proAuthReturnPath(path)).toBe(path)
})

it.each([
  null,
  "//example.com/billing/pro",
  "/billing/pro/other",
  "/billing/pro#fragment",
  "/billing/pro?billing=active",
  "/billing/pro?billing=success&billing=cancel",
  "/billing/pro?team=a&team=b",
  "/billing/pro?approved=true",
  "/billing/pro?return=https%3A%2F%2Fexample.com",
  "/billing/pro?return=%2F%2Fexample.com",
  "/billing/pro?return=%2F%5Cexample.com",
  "/billing/pro?return=%2Fsandboxes%0A",
])("rejects unrecognized or unsafe Pro returns: %s", (path) => {
  expect(proAuthReturnPath(path)).toBeNull()
})
