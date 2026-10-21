import { expect, it } from "vitest"

import { acceptanceSchema, acceptanceState } from "./acceptance-schema"
import { ids, offered } from "./test-fixtures"

it.each([
  "offered",
  "accepted",
  "provisioning",
  "grant_pending",
  "funding_pending",
  "outcome_unknown",
] as const)(
  "does not grant access from %s even with an inconsistent ready flag",
  (state) =>
    expect(acceptanceState(offered({ state, ready: true }))).not.toBe(
      "funding_ready",
    ),
)
it("requires confirmed acceptance, assignment, operation and fresh ready flag", () => {
  expect(
    acceptanceState(offered({ state: "funding_ready", ready: true })),
  ).toBe("unavailable")
  const ready = offered({
    state: "funding_ready",
    ready: true,
    accepted_at: "2026-10-21T15:00:00Z",
    assignment_id: ids.assignment,
    operation_id: ids.operation,
  })
  expect(acceptanceState(ready)).toBe("funding_ready")
  expect(acceptanceState({ ...ready, held: true })).toBe("held")
  expect(acceptanceState({ ...ready, revoked: true })).toBe("revoked")
  expect(acceptanceState({ ...ready, control_pending: true })).toBe(
    "outcome_unknown",
  )
})
it("rejects incomplete or incompatible terms instead of substituting prices", () => {
  const offer = offered()
  expect(
    acceptanceSchema.safeParse({
      ...offer,
      terms: { ...offer.terms, monthly_allowance_cents: [100] },
    }).success,
  ).toBe(false)
  expect(
    acceptanceSchema.safeParse({
      ...offer,
      terms: { ...offer.terms, rollover: true },
    }).success,
  ).toBe(false)
  expect(
    acceptanceSchema.safeParse({
      ...offer,
      terms: { ...offer.terms, offer_version: 2 },
    }).success,
  ).toBe(false)
})

it("requires explicit valid financial authority for readiness, independent of provider state", () => {
  const ready = offered({
    state: "funding_ready",
    ready: true,
    accepted_at: "2026-10-21T15:00:00Z",
    assignment_id: ids.assignment,
    operation_id: ids.operation,
  })
  expect(acceptanceState({ ...ready, financial_authority: undefined })).toBe(
    "unavailable",
  )
  expect(acceptanceState({ ...ready, financial_authority: null })).toBe(
    "unavailable",
  )
  expect(
    acceptanceState({
      ...ready,
      revoked: true,
      control_pending: true,
      financial_authority: {
        kind: "accepted_offer",
        state: "revocation_pending",
        pending_invalidations: 2,
      },
    }),
  ).toBe("financial_revocation_pending")
  expect(
    acceptanceState({
      ...ready,
      financial_authority: {
        kind: "accepted_offer",
        state: "revoked",
        pending_invalidations: 0,
      },
    }),
  ).toBe("financial_revoked")
})

it("accepts the explicit preacceptance projection without granting readiness", () => {
  const offer = acceptanceSchema.parse(offered())
  expect(acceptanceState(offer)).toBe("acceptance_required")
  expect(
    acceptanceState({
      ...offer,
      state: "funding_ready",
      ready: true,
      accepted_at: "2026-10-21T12:00:00Z",
      assignment_id: ids.assignment,
      operation_id: ids.operation,
    }),
  ).toBe("unavailable")
})
