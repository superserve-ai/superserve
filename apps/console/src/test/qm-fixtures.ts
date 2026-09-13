import type {
  QmTenant,
  QmTenantDetailResponse,
  QmTenantEvent,
} from "@/lib/api/types"

export const qmTenant = (overrides: Partial<QmTenant> = {}): QmTenant => ({
  id: "t1",
  teamId: "team-a",
  slug: "acme",
  orgName: "Acme",
  adminEmail: "admin@example.com",
  signIn: "magic_link",
  modelProvider: "anthropic",
  harness: "pi",
  status: "ready",
  publicUrl: "https://acme.qm.superserve.ai",
  imageTag: "v0.4.2",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:05:00.000Z",
  ...overrides,
})

let seq = 0
export const qmEvent = (
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

/** Seconds after the fixture epoch, as an ISO timestamp. */
export const T = (s: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()

const run = (
  status: QmTenantEvent["status"],
  at: string,
  mode: "provision" | "deprovision",
  message: string,
): QmTenantEvent => ({
  ...qmEvent("run", status, at, message),
  detail: { mode },
})

/** The provision plan in qm-api's order. */
export const PROVISION_STEPS = [
  "database",
  "service_account",
  "bucket",
  "secrets",
  "cloud_run",
  "load_balancer",
  "health_check",
  "smoke",
  "admin_link",
] as const

/** Every provisioning step succeeded and the run closed ready. */
export const successEvents = (): QmTenantEvent[] => {
  const out = [run("started", T(0), "provision", "provision started")]
  PROVISION_STEPS.forEach((step, i) => {
    out.push(qmEvent(step, "started", T(i * 10 + 1)))
    out.push(qmEvent(step, "ok", T(i * 10 + 1 + (i === 4 ? 9 : 2))))
  })
  out.push(run("ok", T(100), "provision", "provision complete; tenant ready"))
  return out
}

/** Steps 1–3 succeeded, step 4 (secrets) failed; the rest were skipped. */
export const failedAtStep4Events = (): QmTenantEvent[] => [
  run("started", T(0), "provision", "provision started"),
  qmEvent("database", "started", T(1)),
  qmEvent("database", "ok", T(3)),
  qmEvent("service_account", "started", T(3)),
  qmEvent("service_account", "ok", T(5)),
  qmEvent("bucket", "started", T(5)),
  qmEvent("bucket", "ok", T(7)),
  qmEvent("secrets", "started", T(7)),
  qmEvent("secrets", "failed", T(37), "secrets failed"),
  qmEvent("cloud_run", "skipped", T(37), "not run: secrets failed"),
  qmEvent("load_balancer", "skipped", T(37), "not run: secrets failed"),
  qmEvent("health_check", "skipped", T(37), "not run: secrets failed"),
  qmEvent("smoke", "skipped", T(37), "not run: secrets failed"),
  qmEvent("admin_link", "skipped", T(37), "not run: secrets failed"),
  run(
    "failed",
    T(37),
    "provision",
    "Provisioning stopped at secrets. Retry to continue from where it left off, or delete the tenant.",
  ),
]

/** Still running: three done, the fourth in progress. */
export const inProgressEvents = (): QmTenantEvent[] =>
  failedAtStep4Events().slice(0, 8)

/** A ready stack whose teardown stalled on the second rollback step. */
export const failedTeardownEvents = (): QmTenantEvent[] => [
  ...successEvents(),
  run("started", T(200), "deprovision", "deprovision started"),
  qmEvent("admin_link", "started", T(201)),
  qmEvent("admin_link", "skipped", T(201), "nothing to roll back"),
  qmEvent("smoke", "started", T(201)),
  qmEvent("smoke", "skipped", T(201), "nothing to roll back"),
  qmEvent("health_check", "started", T(201)),
  qmEvent("health_check", "skipped", T(201), "nothing to roll back"),
  qmEvent("load_balancer", "started", T(202)),
  qmEvent("load_balancer", "ok", T(210)),
  qmEvent("cloud_run", "started", T(210)),
  qmEvent("cloud_run", "failed", T(240), "cloud_run failed"),
  qmEvent("secrets", "skipped", T(240), "not run: cloud_run failed"),
  qmEvent("bucket", "skipped", T(240), "not run: cloud_run failed"),
  qmEvent("service_account", "skipped", T(240), "not run: cloud_run failed"),
  qmEvent("database", "skipped", T(240), "not run: cloud_run failed"),
  run(
    "failed",
    T(240),
    "deprovision",
    "Deprovisioning stopped at cloud_run. Retry to continue the teardown.",
  ),
]

export const qmDetail = (
  tenant: QmTenant,
  events: QmTenantEvent[] = [],
): QmTenantDetailResponse => ({ tenant, events })
