import { describe, expect, it } from "vitest"

import config from "../../../next.config"
import { userManagementNavItem } from "./nav-config"

describe("Team navigation", () => {
  it("uses the Team label and route", () => {
    expect(userManagementNavItem).toMatchObject({
      label: "Team",
      href: "/team",
    })
  })
  it("permanently redirects the old page and nested paths", async () => {
    expect(await config.redirects!()).toEqual(
      expect.arrayContaining([
        { source: "/user-management", destination: "/team", permanent: true },
        {
          source: "/user-management/:path*",
          destination: "/team",
          permanent: true,
        },
      ]),
    )
  })
})
