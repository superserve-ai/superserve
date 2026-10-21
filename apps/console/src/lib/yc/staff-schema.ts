import { z } from "zod"

import { financialAuthoritySchema } from "./financial-authority"

export const claimID = z
  .string()
  .uuid()
  .refine((id) => !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id))
export const claimState = z.enum([
  "manual_review",
  "awaiting_confirmation",
  "confirmed",
  "bound",
  "rejected",
  "revoked",
])
export const staffClaimSchema = z.object({
  id: claimID,
  state: claimState,
  revision: z.number().int().nonnegative().safe(),
  submitted_email: z.string(),
  founder_email: z.string().nullable().optional(),
  preferred_identity_review: z
    .object({
      review_request_id: claimID,
      review_revision: z.number().int().nonnegative().safe(),
      user_id: claimID,
      email: z.string(),
      team_id: claimID,
      home_region: z.string(),
      company_identity: z.string().nullable(),
      ready: z.boolean(),
      approved_revision: z.number().int().nonnegative().nullable(),
    })
    .nullable()
    .optional(),
  company_identity: z.string().nullable(),
  team_id: claimID.nullable(),
  claimed_user_id: claimID.nullable(),
  home_region: z.string().nullable(),
  reason: z.string(),
  acceptance_required: z.boolean(),
  financial_authority: financialAuthoritySchema.optional(),
  approval_notification: z
    .object({
      status: z.string(),
      attempts: z.number(),
      sent_at: z.string().nullable(),
    })
    .nullable(),
  decisions: z
    .array(
      z.object({
        revision: z.number(),
        decision: z.string(),
        reason: z.string(),
        evidence_reference: z.string().nullable(),
      }),
    )
    .optional(),
})
export type StaffClaim = z.infer<typeof staffClaimSchema>
export const staffDecisionSchema = z
  .object({
    id: claimID,
    request_id: claimID,
    expected_revision: z.number().int().nonnegative().safe(),
    decision: z.enum(["approve", "reject", "revoke", "retry-approval-email"]),
    reason: z.string().trim().min(1).max(1000),
    evidence_reference: z.string().trim().min(1).max(1000),
    user_id: claimID.optional(),
    team_id: claimID.optional(),
    company_identity: z.string().trim().min(1).max(1000).optional(),
    review_request_id: claimID.optional(),
    review_revision: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.decision === "approve"
        ? !value.user_id || !value.team_id
        : value.user_id || value.team_id || value.company_identity
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Approval requires an account and team; other decisions cannot change the binding.",
      })
    if (
      (value.review_request_id === undefined) !==
        (value.review_revision === undefined) ||
      (value.decision !== "approve" && value.review_request_id !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Review approval requires the exact review identity and revision.",
      })
  })
export type StaffDecision = z.infer<typeof staffDecisionSchema>
