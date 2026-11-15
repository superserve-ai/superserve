import { describe, expect, it } from "vitest"

import { STATUS_BADGE_VARIANT } from "./sandbox-utils"

describe("STATUS_BADGE_VARIANT", () => {
  it("maps a running sandbox to the mint 'active' badge variant", () => {
    expect(STATUS_BADGE_VARIANT.active).toBe("active")
  })

  it("maps a paused sandbox to the cyan 'info' badge variant", () => {
    expect(STATUS_BADGE_VARIANT.paused).toBe("info")
  })

  it("keeps the other non-running statuses on their existing variants", () => {
    expect(STATUS_BADGE_VARIANT.resuming).toBe("warning")
    expect(STATUS_BADGE_VARIANT.failed).toBe("destructive")
  })
})
