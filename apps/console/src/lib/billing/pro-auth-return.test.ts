import { expect, it } from "vitest"

import { proAuthReturnPath, starterAuthReturnPath } from "./pro-auth-return"

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

it.each([
  "/plan-usage/buy-credit",
  "/plan-usage/buy-credit/?purchase=success&team=use%3Aoriginal",
  "/plan-usage/buy-credit?purchase=cancel&team=use%3Aoriginal",
])("retains the Starter team locator: %s", (path) => {
  expect(starterAuthReturnPath(path)).toBe(path)
})
it.each([
  "//external/plan-usage/buy-credit",
  "/plan-usage/buy-credit#paid",
  "/plan-usage/buy-credit?purchase=success&purchase=cancel",
  "/plan-usage/buy-credit?team=a&team=b",
  "/plan-usage/buy-credit?payment_authorized=true",
])("rejects unsafe Starter returns: %s", (path) => {
  expect(starterAuthReturnPath(path)).toBeNull()
})
