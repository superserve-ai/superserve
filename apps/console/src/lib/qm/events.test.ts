import { describe, expect, it } from "vitest"

import type { QmTenantEvent } from "@/lib/api/types"

import {
  formatElapsed,
  groupTenantEvents,
  latestFailureMessage,
  stepElapsedMs,
  stepLabel,
} from "./events"

let seq = 0
const ev = (
  step: string,
  status: QmTenantEvent["status"],
  at: string,
  message: string | null = null,
): QmTenantEvent => ({
  id: `e${++seq}`,
  step,
  status,
  message,
  detail: null,
  at,
})

describe("groupTenantEvents", () => {
  it("folds events per step in first-appearance order, latest status wins", () => {
    const steps = groupTenantEvents([
      ev("reserve_slug", "started", "2026-01-01T00:00:00Z"),
      ev("reserve_slug", "ok", "2026-01-01T00:00:02Z"),
      ev("deploy", "started", "2026-01-01T00:00:03Z"),
      ev("configure_dns", "skipped", "2026-01-01T00:00:04Z", "Already set"),
    ])
    expect(steps.map((s) => [s.step, s.status])).toEqual([
      ["reserve_slug", "ok"],
      ["deploy", "started"],
      ["configure_dns", "skipped"],
    ])
    expect(steps[0].startedAt).toBe("2026-01-01T00:00:00Z")
    expect(steps[0].endedAt).toBe("2026-01-01T00:00:02Z")
    expect(steps[1].endedAt).toBeNull()
    expect(steps[2].message).toBe("Already set")
  })

  it("orders by timestamp even when the stream arrives out of order", () => {
    const steps = groupTenantEvents([
      ev("deploy", "ok", "2026-01-01T00:00:05Z"),
      ev("deploy", "started", "2026-01-01T00:00:01Z"),
    ])
    expect(steps[0].status).toBe("ok")
  })

  it("resets a step's clock when a retry restarts it", () => {
    const steps = groupTenantEvents([
      ev("deploy", "started", "2026-01-01T00:00:00Z"),
      ev("deploy", "failed", "2026-01-01T00:00:10Z", "Image pull timed out"),
      ev("deploy", "started", "2026-01-01T00:01:00Z"),
    ])
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe("started")
    expect(steps[0].startedAt).toBe("2026-01-01T00:01:00Z")
    expect(steps[0].endedAt).toBeNull()
    // The last failure's message is kept until a newer message replaces it.
    expect(steps[0].message).toBe("Image pull timed out")
  })
})

describe("stepElapsedMs", () => {
  it("uses the terminal timestamp when finished and now while running", () => {
    const [done, running] = groupTenantEvents([
      ev("a", "started", "2026-01-01T00:00:00Z"),
      ev("a", "ok", "2026-01-01T00:00:03Z"),
      ev("b", "started", "2026-01-01T00:00:03Z"),
    ])
    const now = Date.parse("2026-01-01T00:00:10Z")
    expect(stepElapsedMs(done, now)).toBe(3000)
    expect(stepElapsedMs(running, now)).toBe(7000)
    expect(
      stepElapsedMs(
        groupTenantEvents([ev("c", "skipped", "2026-01-01T00:00:00Z")])[0],
        now,
      ),
    ).toBeNull()
  })
})

describe("formatElapsed", () => {
  it("formats compact durations", () => {
    expect(formatElapsed(400)).toBe("<1s")
    expect(formatElapsed(3_400)).toBe("3s")
    expect(formatElapsed(65_000)).toBe("1m 5s")
    expect(formatElapsed(120_000)).toBe("2m")
  })
})

describe("stepLabel", () => {
  it("maps known steps and humanizes unknown ones", () => {
    expect(stepLabel("issue_certificate")).toBe("Issue TLS certificate")
    expect(stepLabel("warm_cache")).toBe("Warm cache")
  })
})

describe("latestFailureMessage", () => {
  it("returns the most recent failed step's message", () => {
    expect(
      latestFailureMessage([
        ev("a", "ok", "2026-01-01T00:00:00Z"),
        ev("b", "failed", "2026-01-01T00:00:01Z", "DNS refused"),
      ]),
    ).toBe("DNS refused")
    expect(latestFailureMessage([ev("a", "ok", "2026-01-01T00:00:00Z")])).toBe(
      null,
    )
  })
})
