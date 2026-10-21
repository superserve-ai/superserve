import { expect, it } from "vitest"

import {
  financialAuthoritySchema,
  financialRevocationMessage,
} from "./financial-authority"

it("distinguishes pending regional acknowledgment from confirmed revocation", () => {
  const pending = financialAuthoritySchema.parse({
    kind: "accepted_offer",
    state: "revocation_pending",
    pending_invalidations: 2,
  })
  const confirmed = financialAuthoritySchema.parse({
    kind: "accepted_offer",
    state: "revoked",
    pending_invalidations: 0,
  })
  expect(financialRevocationMessage(pending)?.title).toBe("Revocation pending")
  expect(financialRevocationMessage(confirmed)?.title).toBe(
    "Revocation confirmed",
  )
  expect(financialRevocationMessage(pending)?.description).toContain(
    "New activation is blocked",
  )
  expect(financialRevocationMessage(confirmed)?.description).toContain(
    "does not confirm cancellation or a refund",
  )
})
it.each(["acceptance_pending", "valid", "revoked"])(
  "rejects %s while financial acknowledgments remain outstanding",
  (state) => {
    expect(
      financialAuthoritySchema.safeParse({
        kind: "accepted_offer",
        state,
        pending_invalidations: 1,
      }).success,
    ).toBe(false)
  },
)
it("leaves legacy null and valid authorization presentation unchanged", () => {
  expect(
    financialRevocationMessage(financialAuthoritySchema.parse(null)),
  ).toBeNull()
  expect(
    financialRevocationMessage({
      kind: "accepted_offer",
      state: "valid",
      pending_invalidations: 0,
    }),
  ).toBeNull()
})

it("does not confuse acceptance pending with revocation or readiness", () => {
  const authority = financialAuthoritySchema.parse({
    kind: "accepted_offer",
    state: "acceptance_pending",
    pending_invalidations: 0,
  })
  expect(financialRevocationMessage(authority)).toBeNull()
})
