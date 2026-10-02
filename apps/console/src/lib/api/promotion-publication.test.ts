import type { User } from "@supabase/supabase-js"
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  evidence: vi.fn(),
  register: vi.fn(),
  bind: vi.fn(),
  signup: vi.fn(),
  update: vi.fn(),
}))
vi.mock("./promotion-identity", () => ({
  publishPromotionIdentity: mocks.identity,
}))
vi.mock("./promotion-device-evidence", async (original) => ({
  ...(await original<typeof import("./promotion-device-evidence")>()),
  getPromotionSignupAccountEvidence: mocks.evidence,
  registerPromotionSignupDevice: mocks.register,
  bindPromotionSignupAccount: mocks.bind,
  registerPromotionSignupAccount: mocks.signup,
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: mocks.update } },
  }),
}))
import { PromotionEvidenceError } from "./promotion-device-evidence"
import {
  publishAccountPromotion,
  publishOriginalSignupEvidence,
} from "./promotion-publication"
const user = {
  id: "actor",
  created_at: "2026-10-02T00:00:00Z",
  app_metadata: {},
} as User
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("PROMOTION_SIGNUP_EVIDENCE_SINCE", "2026-10-01T00:00:00Z")
  mocks.evidence.mockRejectedValue(
    new PromotionEvidenceError("evidence_missing"),
  )
  mocks.update.mockResolvedValue({ error: null })
  mocks.bind.mockResolvedValue("bound")
})
it.each([
  {},
  { promotion_authority_failed: true },
  { promotion_routine_absence: true, promotion_authority_failed: true },
])(
  "withholds credit for unknown/failed new-account provenance %j",
  async (app_metadata) => {
    expect(
      await publishAccountPromotion("use", { ...user, app_metadata }, "now"),
    ).toEqual({ authorityUnavailable: true })
  },
)
it("only classifies successfully persisted routine absence as ordinary missing", async () => {
  await publishOriginalSignupEvidence(user, undefined, true)
  expect(mocks.update).toHaveBeenCalledWith(user.id, {
    app_metadata: { promotion_routine_absence: true },
  })
  expect(
    await publishAccountPromotion(
      "use",
      { ...user, app_metadata: { promotion_routine_absence: true } },
      "now",
    ),
  ).toEqual({ authorityUnavailable: false })
  expect(mocks.bind).not.toHaveBeenCalled()
})
it("preserves legacy routine absence using the fixed trusted creation cohort", async () => {
  expect(
    await publishAccountPromotion(
      "use",
      { ...user, created_at: "2026-09-30T23:59:59Z" },
      "now",
    ),
  ).toEqual({ authorityUnavailable: false })
  expect(
    await publishAccountPromotion(
      "use",
      { ...user, user_metadata: { promotion_routine_absence: true } },
      "now",
    ),
  ).toEqual({ authorityUnavailable: true })
})
it("does not bind if the initial failure marker could not be retained", async () => {
  mocks.update.mockResolvedValue({ error: new Error("unavailable") })
  await publishOriginalSignupEvidence(user, "original-attempt", false)
  expect(mocks.bind).not.toHaveBeenCalled()
  expect(await publishAccountPromotion("use", user, "now")).toEqual({
    authorityUnavailable: true,
  })
})
it("persists the failure marker before association and never clears it on success", async () => {
  await publishOriginalSignupEvidence(user, "original-attempt", false)
  expect(mocks.update).toHaveBeenCalledWith(user.id, {
    app_metadata: { promotion_authority_failed: true },
  })
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.bind.mock.invocationCallOrder[0],
  )
  expect(mocks.bind).toHaveBeenCalledWith(user.id, "original-attempt")
  expect(mocks.signup).toHaveBeenCalledWith(user.id, "original-attempt")
  expect(mocks.update).toHaveBeenCalledTimes(1)
})
it("recovers an uncertain bind only from durable original evidence and fresh regional publication", async () => {
  mocks.evidence.mockResolvedValue({ attemptId: "original" })
  const failed = { ...user, app_metadata: { promotion_authority_failed: true } }
  expect(await publishAccountPromotion("usw", failed, "now")).toEqual({
    authorityUnavailable: false,
  })
  expect(mocks.register).toHaveBeenCalledWith("usw", user.id)
  expect(mocks.bind).not.toHaveBeenCalled()
  mocks.register.mockRejectedValue(new Error("current publication failed"))
  expect(await publishAccountPromotion("usw", failed, "now")).toEqual({
    authorityUnavailable: true,
  })
})
it("never treats an old cell or transport failure as routine absence", async () => {
  mocks.evidence.mockRejectedValue(
    new PromotionEvidenceError("authority_unavailable", 404),
  )
  expect(
    await publishAccountPromotion(
      "use",
      { ...user, app_metadata: { promotion_routine_absence: true } },
      "now",
    ),
  ).toEqual({ authorityUnavailable: true })
})
it("never publishes a replacement signup attempt when the backend retained first evidence", async () => {
  mocks.bind.mockResolvedValue("first_evidence_retained")
  await publishOriginalSignupEvidence(user, "different", false)
  expect(mocks.signup).not.toHaveBeenCalled()
})
