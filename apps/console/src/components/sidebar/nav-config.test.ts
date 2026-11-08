import { expect, it } from "vitest"

import { bottomNavItems, mainNavItems } from "./nav-config"

it("links Billing & Usage to its current route", () => {
  expect(
    mainNavItems.find((item) => item.label === "Billing & Usage"),
  ).toMatchObject({
    href: "/billing-usage",
  })
  expect(
    [...mainNavItems, ...bottomNavItems].some(
      (item) => item.label === "Plan & Usage",
    ),
  ).toBe(false)
})
