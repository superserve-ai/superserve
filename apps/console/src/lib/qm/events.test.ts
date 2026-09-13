import { describe, expect, it } from "vitest"

import type { QmTenantEvent } from "@/lib/api/types"
import {
  failedAtStep4Events,
  failedTeardownEvents,
  qmEvent,
  successEvents,
  T,
} from "@/test/qm-fixtures"

import {
  formatElapsed,
  groupTenantEvents,
  latestRun,
  stepElapsedMs,
  stepLabel,
} from "./events"

const run = (
  status: QmTenantEvent["status"],
  at: string,
  mode: string,
  message: string | null = null,
): QmTenantEvent => ({
  ...qmEvent("run", status, at, message),
  detail: { mode },
})

describe("groupTenantEvents", () => {
  it("folds events per step in first-appearance order, latest status wins", () => {
    const steps = groupTenantEvents([
      qmEvent("database", "started", T(0)),
      qmEvent("database", "ok", T(2)),
      qmEvent("cloud_run", "started", T(3)),
      qmEvent("load_balancer", "skipped", T(4), "Already set"),
    ])
    expect(steps.map((s) => [s.step, s.status])).toEqual([
      ["database", "ok"],
      ["cloud_run", "started"],
      ["load_balancer", "skipped"],
    ])
    expect(steps[0].startedAt).toBe(T(0))
    expect(steps[0].endedAt).toBe(T(2))
    expect(steps[1].endedAt).toBeNull()
    expect(steps[2].message).toBe("Already set")
  })

  it("orders by timestamp even when the stream arrives out of order", () => {
    const steps = groupTenantEvents([
      qmEvent("cloud_run", "ok", T(5)),
      qmEvent("cloud_run", "started", T(1)),
    ])
    expect(steps[0].status).toBe("ok")
  })

  it("never lists the run pseudo-step", () => {
    expect(
      groupTenantEvents([
        run("started", T(0), "provision", "provision started"),
      ]),
    ).toEqual([])
  })
})

describe("latestRun", () => {
  it("reads the mode and lists every step of a successful provision", () => {
    const { mode, steps, failureMessage } = latestRun(successEvents())
    expect(mode).toBe("provision")
    expect(steps).toHaveLength(9)
    expect(steps.map((s) => s.step)).toEqual([
      "database",
      "service_account",
      "bucket",
      "secrets",
      "cloud_run",
      "load_balancer",
      "health_check",
      "smoke",
      "admin_link",
    ])
    expect(steps.every((s) => s.status === "ok")).toBe(true)
    expect(steps[4].label).toBe("Deploy QM")
    expect(failureMessage).toBeNull()
  })

  it("prefers the run's user-safe failure message over the step's", () => {
    const { steps, failureMessage } = latestRun(failedAtStep4Events())
    expect(steps[3]).toMatchObject({ step: "secrets", status: "failed" })
    expect(steps.slice(4).every((s) => s.status === "skipped")).toBe(true)
    expect(failureMessage).toMatch(/^Provisioning stopped at secrets/)
  })

  it("scopes to the latest run so a retry starts a fresh list", () => {
    const events = [
      ...failedAtStep4Events(),
      run("started", T(100), "provision", "provision started"),
      qmEvent("database", "started", T(101)),
      qmEvent("database", "ok", T(102)),
      qmEvent("service_account", "started", T(102)),
    ]
    const { mode, steps, failureMessage } = latestRun(events)
    expect(mode).toBe("provision")
    expect(steps.map((s) => [s.step, s.status])).toEqual([
      ["database", "ok"],
      ["service_account", "started"],
    ])
    expect(steps[0].startedAt).toBe(T(101))
    expect(failureMessage).toBeNull()
  })

  it("recognises a failed teardown and labels its steps as rollbacks", () => {
    const { mode, steps, failureMessage } = latestRun(failedTeardownEvents())
    expect(mode).toBe("deprovision")
    expect(steps[0].step).toBe("admin_link")
    expect(steps[4]).toMatchObject({
      step: "cloud_run",
      status: "failed",
      label: "Remove QM deployment",
    })
    expect(failureMessage).toMatch(/^Deprovisioning stopped at cloud_run/)
  })

  it("falls back to the message prefix when the run carries no detail", () => {
    const events = [
      {
        ...qmEvent("run", "started", T(0), "deprovision started"),
        detail: null,
      },
      qmEvent("cloud_run", "started", T(1)),
    ]
    expect(latestRun(events).mode).toBe("deprovision")
  })

  it("treats a stream without run markers as one provisioning attempt", () => {
    const { mode, steps } = latestRun([
      qmEvent("database", "started", T(0)),
      qmEvent("database", "ok", T(1)),
    ])
    expect(mode).toBeNull()
    expect(steps).toHaveLength(1)
    expect(steps[0].label).toBe("Create database")
  })
})

describe("stepElapsedMs", () => {
  it("uses the terminal timestamp when finished and now while running", () => {
    const [done, running] = groupTenantEvents([
      qmEvent("a", "started", T(0)),
      qmEvent("a", "ok", T(3)),
      qmEvent("b", "started", T(3)),
    ])
    const now = Date.parse(T(10))
    expect(stepElapsedMs(done, now)).toBe(3000)
    expect(stepElapsedMs(running, now)).toBe(7000)
    expect(
      stepElapsedMs(groupTenantEvents([qmEvent("c", "skipped", T(0))])[0], now),
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
  it("maps known steps per mode and humanizes unknown ones", () => {
    expect(stepLabel("load_balancer")).toBe("Configure load balancer")
    expect(stepLabel("load_balancer", "deprovision")).toBe(
      "Remove load balancer",
    )
    expect(stepLabel("warm_cache")).toBe("Warm cache")
  })
})
