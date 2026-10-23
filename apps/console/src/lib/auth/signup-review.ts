import type { User } from "@supabase/supabase-js"
import * as z from "zod"

import type { PlanCadence } from "@/lib/api/signup-plan"

import type { RequestedOffer } from "./requested-offer"

// Review state lives in app_metadata, which only the service role can write.
// Accounts without `signup_review` predate review and are never gated.
export type SignupReviewStatus = "pending" | "approved" | "rejected"

export type SignupPlanChoice = "starter" | "pro" | "enterprise"
export type SignupAffiliation = "yc" | "other"

export const SIGNUP_AFFILIATION_LABELS: Record<SignupAffiliation, string> = {
  yc: "YC",
  other: "Other",
}

export const SIGNUP_PLAN_LABELS: Record<SignupPlanChoice, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
}

export const SIGNUP_REVIEW_PENDING_MESSAGE =
  "Your account is pending review. We'll email you as soon as it's approved."

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

// Blank optional answers arrive as "" from the form; treat them as absent.
const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && !value.trim() ? undefined : value

export const signupDetailsSchema = z
  .object({
    company: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .trim()
        .max(200, "Company must be 200 characters or fewer.")
        .optional(),
    ),
    affiliation: z.preprocess(
      blankAsUndefined,
      z
        .enum(["yc", "other"], {
          errorMap: () => ({ message: "Choose an affiliation." }),
        })
        .optional(),
    ),
    ycLink: z.preprocess(
      blankAsUndefined,
      z.string().trim().max(2048).optional(),
    ),
    plan: z.enum(["starter", "pro", "enterprise"], {
      errorMap: () => ({ message: "Choose a plan." }),
    }),
    cadence: z.enum(["monthly", "annual"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.affiliation === "yc" && value.ycLink && !isHttpUrl(value.ycLink))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ycLink"],
        message: "Enter a valid http(s) URL.",
      })
    if (value.plan !== "enterprise" && !value.cadence)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cadence"],
        message: "Choose monthly or annual billing.",
      })
  })
  .transform(
    (value): SignupDetails => ({
      ...(value.company ? { company: value.company } : {}),
      ...(value.affiliation ? { affiliation: value.affiliation } : {}),
      ...(value.affiliation === "yc" && value.ycLink
        ? { ycLink: value.ycLink }
        : {}),
      plan: value.plan,
      ...(value.plan !== "enterprise" ? { cadence: value.cadence } : {}),
    }),
  )

// Only the plan of interest is required; the rest helps staff review.
export interface SignupDetails {
  company?: string
  affiliation?: SignupAffiliation
  ycLink?: string
  plan: SignupPlanChoice
  cadence?: PlanCadence
}

/** Stored shape under `app_metadata.signup_request`. */
export interface StoredSignupRequest {
  company?: string
  affiliation?: SignupAffiliation
  yc_link?: string
  plan: SignupPlanChoice
  cadence?: PlanCadence
  submitted_at: string
}

export function parseSignupDetails(
  value: unknown,
): { success: true; data: SignupDetails } | { success: false; error: string } {
  const parsed = signupDetailsSchema.safeParse(value)
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: parsed.error.issues[0].message }
}

export function signupDetailsOffer(
  details: Pick<SignupDetails, "plan" | "cadence">,
): RequestedOffer {
  if (details.plan === "enterprise" || !details.cadence) return "enterprise"
  return `${details.plan}_${details.cadence}`
}

export function storedSignupRequest(
  details: SignupDetails,
  submittedAt = new Date(),
): StoredSignupRequest {
  return {
    ...(details.company ? { company: details.company } : {}),
    ...(details.affiliation ? { affiliation: details.affiliation } : {}),
    ...(details.ycLink ? { yc_link: details.ycLink } : {}),
    plan: details.plan,
    ...(details.cadence ? { cadence: details.cadence } : {}),
    submitted_at: submittedAt.toISOString(),
  }
}

type MetadataUser = Pick<User, "app_metadata"> | null | undefined

export function signupReviewStatus(
  user: MetadataUser,
): SignupReviewStatus | undefined {
  const status = user?.app_metadata?.signup_review
  return status === "pending" || status === "approved" || status === "rejected"
    ? status
    : undefined
}

/** Pending and rejected accounts get the same treatment, so neither is revealed. */
export function isSignupReviewBlocked(user: MetadataUser): boolean {
  const status = signupReviewStatus(user)
  return status === "pending" || status === "rejected"
}

export function readSignupRequest(
  user: MetadataUser,
): SignupDetails | undefined {
  const stored = user?.app_metadata?.signup_request as
    | Partial<StoredSignupRequest>
    | undefined
  if (!stored || typeof stored !== "object") return undefined
  const parsed = signupDetailsSchema.safeParse({
    company: stored.company,
    affiliation: stored.affiliation,
    ycLink: stored.yc_link,
    plan: stored.plan,
    cadence: stored.cadence,
  })
  return parsed.success ? parsed.data : undefined
}

/**
 * Plan preference for accounts that chose a plan during reviewed signup;
 * undefined for accounts that predate review.
 */
export function reviewedSignupPlan(
  user: MetadataUser,
): { offer?: RequestedOffer } | undefined {
  if (!signupReviewStatus(user)) return undefined
  const request = readSignupRequest(user)
  return { offer: request ? signupDetailsOffer(request) : undefined }
}

export class SignupReviewPendingError extends Error {
  constructor() {
    super(SIGNUP_REVIEW_PENDING_MESSAGE)
    this.name = "SignupReviewPendingError"
  }
}

export function assertSignupReviewCleared(user: MetadataUser): void {
  if (isSignupReviewBlocked(user)) throw new SignupReviewPendingError()
}
