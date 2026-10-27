import { expect, it } from "vitest"

import {
  proAuthReturnPath,
  starterAuthReturnPath,
  signupPreparationReturnPath,
} from "./pro-auth-return"

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

it.each([
  "/api/onboarding/prepare/?account=owner&next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?account=owner&team=use%3Aoriginal&billing=success&next=%2Fplan-usage%2Fbuy-credit%2F%3Fteam%3Duse%253Aoriginal%26purchase%3Dsuccess",
])("retains only a bound paid preparation return: %s", (path) => {
  expect(signupPreparationReturnPath(path)).toBe(path)
})
it.each([
  null,
  "//evil.test/api/onboarding/prepare/?account=owner&next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?account=owner&next=https%3A%2F%2Fevil.test",
  "/api/onboarding/prepare/?account=owner&next=%2Fsandboxes",
  "/api/onboarding/prepare/?account=owner&next=%2Fapi%2Fonboarding%2Fprepare%2F",
  "/api/onboarding/prepare/?account=owner&account=other&next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?account=owner&approved=true&next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?account=owner&team=use%3Aother&next=%2Fbilling%2Fpro%2F%3Fteam%3Duse%253Aoriginal",
  "/api/onboarding/prepare/?account=owner&billing=paid&next=%2Fbilling%2Fpro%2F",
  "/api/onboarding/prepare/?account=owner&next=%2Fbilling%2Fpro%2F#fragment",
])("rejects unsafe or unbound preparation returns: %s", (path) => {
  expect(signupPreparationReturnPath(path)).toBeNull()
})

it.each(["success", "cancel", "portal-return"])(
  "retains bounded generic %s on both routes",
  (flow) => {
    const pro = `/billing/pro/?team=use%3Aoriginal&return=%2Fsandboxes&billing_flow=${flow}`
    const starter = `/plan-usage/buy-credit/?purchase=cancel&team=use%3Aoriginal&purchase_id=original&billing_flow=${flow}`
    expect(proAuthReturnPath(pro)).toBe(pro)
    expect(starterAuthReturnPath(starter)).toBe(starter)
  },
)
it.each([
  "unknown",
  "success&billing_flow=cancel",
  "",
  "success&approved=true",
])("rejects invalid generic marker %s on both routes", (flow) => {
  expect(
    proAuthReturnPath(`/billing/pro/?team=original&billing_flow=${flow}`),
  ).toBeNull()
  expect(
    starterAuthReturnPath(
      `/plan-usage/buy-credit/?team=original&billing_flow=${flow}`,
    ),
  ).toBeNull()
})
