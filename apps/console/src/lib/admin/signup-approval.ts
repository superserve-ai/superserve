import "server-only"
import type { User } from "@supabase/supabase-js"

import {
  provisionHeldApplicantTeam,
  type ProvisionedTeam,
} from "@/lib/api/team-provisioning"
import { isGoogleUser } from "@/lib/auth/google-signup-proof"
import {
  signupReviewStatus,
  type SignupReviewStatus,
} from "@/lib/auth/signup-review"
import { updateSignupReviewMetadata } from "@/lib/auth/signup-review-server"
import { DEFAULT_REGION } from "@/lib/cells"
import { sendEmail } from "@/lib/email/send"
import {
  SignupApprovedEmail,
  signupApprovedSubject,
} from "@/lib/email/templates/signup-approved"
import { createAdminClient } from "@/lib/supabase/admin"

import { listEnterprisePlanVersions } from "./enterprise-plan"

const LIST_PAGE_SIZE = 1000
// Bounds an admin-only scan; review queues are far smaller than this.
const LIST_MAX_PAGES = 100

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
}

export interface SignupReviewRow {
  id: string
  name: string | null
  email: string | null
  provider: string
  createdAt: string
  status: SignupReviewStatus
}

function reviewRow(user: User): SignupReviewRow {
  return {
    id: user.id,
    name:
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null,
    email: user.email ?? null,
    provider: isGoogleUser(user) ? "google" : "email",
    createdAt: user.created_at,
    status: signupReviewStatus(user)!,
  }
}

export async function listPendingSignups(): Promise<SignupReviewRow[]> {
  const admin = createAdminClient()
  const pending: SignupReviewRow[] = []
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PAGE_SIZE,
    })
    if (error) throw new Error(`Unable to list users: ${error.message}`)
    for (const user of data.users)
      if (
        signupReviewStatus(user) === "pending" ||
        (signupReviewStatus(user) === "approved" &&
          !user.app_metadata?.approval_email_sent_at)
      )
        pending.push(reviewRow(user))
    if (data.users.length < LIST_PAGE_SIZE) break
  }
  return pending.toSorted(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}

/** A sign-in link, or a link that also confirms an unconfirmed address. */
async function accessUrl(user: User): Promise<string> {
  if (user.email_confirmed_at || isGoogleUser(user)) {
    const signIn = new URL("/auth/signin", appUrl())
    signIn.searchParams.set("utm_source", "email")
    signIn.searchParams.set("utm_medium", "signup_approved")
    return signIn.toString()
  }
  const callback = new URL("/auth/callback", appUrl())
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: user.email!,
    options: { redirectTo: callback.toString() },
  })
  const tokenHash = data?.properties?.hashed_token
  if (error || !tokenHash)
    throw new Error("Unable to generate a confirmation link")
  callback.searchParams.set("token_hash", tokenHash)
  callback.searchParams.set("type", "magiclink")
  callback.searchParams.set("utm_source", "email")
  callback.searchParams.set("utm_medium", "signup_approved")
  return callback.toString()
}

export type SignupReviewResult =
  | { ok: true; outcome: "approved" | "rejected" }
  | { ok: false; error: string }

async function reviewedUser(userId: string): Promise<User> {
  const { data, error } =
    await createAdminClient().auth.admin.getUserById(userId)
  if (error || !data?.user) throw new Error("User not found")
  return data.user
}

export type AssignEnterprisePlan = (
  team: ProvisionedTeam,
  planVersionId: string,
) => Promise<void>

interface ReviewDecision {
  user_id: string
  decision: "approved" | "rejected"
  staff_id: string
  plan_version_id: string | null
  region: string | null
  created_at: string
}

async function readDecision(userId: string): Promise<ReviewDecision | null> {
  const { data, error } = await createAdminClient()
    .from("signup_review_decision")
    .select("user_id,decision,staff_id,plan_version_id,region,created_at")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error("Unable to read the signup review decision")
  return data as ReviewDecision | null
}

async function claimDecision(
  userId: string,
  staffId: string,
  decision: ReviewDecision["decision"],
  planVersionId: string | null,
): Promise<ReviewDecision> {
  // The central Auth database serializes competing staff decisions. Neither
  // Auth metadata nor a process-local lock can arbitrate across console hosts.
  const { error } = await createAdminClient()
    .from("signup_review_decision")
    .upsert(
      {
        user_id: userId,
        decision,
        staff_id: staffId,
        plan_version_id: planVersionId,
        region: decision === "approved" ? DEFAULT_REGION : null,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
  if (error) throw new Error("Unable to save the signup review decision")
  const winner = await readDecision(userId)
  if (!winner) throw new Error("Signup review decision was not saved")
  return winner
}

const decisionConflict: SignupReviewResult = {
  ok: false,
  error:
    "This applicant already has a saved review decision or plan. Retry the original approved plan. If it is unavailable or cannot finish, an operator must reconcile the saved decision; choosing another plan or rejecting cannot replace it.",
}

/**
 * Gives a held Enterprise applicant access: provision their team, move it to
 * the Enterprise plan, then lift the hold and email them. Each step is safe to
 * repeat, so retrying after any failure finishes the same sequence. The hold
 * stays until the plan is assigned, so the applicant never sees the team on
 * another plan.
 */
export async function approveSignup(
  userId: string,
  staffId: string,
  planVersionId: string,
  assignEnterprisePlan: AssignEnterprisePlan,
): Promise<SignupReviewResult> {
  const user = await reviewedUser(userId)
  const status = signupReviewStatus(user)
  if (status === "pending") {
    if (!planVersionId)
      return {
        ok: false,
        error:
          "Choose the Enterprise plan to assign. The applicant is still held.",
      }
    let winner = await readDecision(userId)
    if (!winner) {
      const plans = await listEnterprisePlanVersions(DEFAULT_REGION)
      if (!plans.some((plan) => plan.id === planVersionId))
        return {
          ok: false,
          error:
            "Choose a published Enterprise plan. The applicant is still held.",
        }
      winner = await claimDecision(userId, staffId, "approved", planVersionId)
    }
    if (
      winner.decision !== "approved" ||
      winner.plan_version_id !== planVersionId
    )
      return decisionConflict
    if (!winner.region || !winner.plan_version_id)
      throw new Error("Incomplete signup review decision")
    const team = await provisionHeldApplicantTeam(
      user,
      winner.region,
      winner.plan_version_id,
    )
    await assignEnterprisePlan(team, winner.plan_version_id)
    await updateSignupReviewMetadata(user.id, {
      signup_review: "approved",
      approved_by: winner.staff_id,
      approved_at: winner.created_at,
      approved_team_id: team.id,
    })
  } else if (status !== "approved" || user.app_metadata?.approval_email_sent_at)
    return { ok: false, error: "This account is not awaiting setup." }
  // Legacy approved accounts have no decision row. Email-only recovery must
  // never create a new decision, provision a team, or assign another plan.
  if (status === "approved") {
    const winner = await readDecision(userId)
    if (
      winner &&
      (winner.decision !== "approved" ||
        (planVersionId && winner.plan_version_id !== planVersionId))
    )
      return decisionConflict
  }
  if (!user.email) return { ok: false, error: "This account has no email." }
  try {
    const result = await sendEmail({
      to: user.email,
      subject: signupApprovedSubject(),
      react: SignupApprovedEmail({
        url: await accessUrl(user),
        provider: isGoogleUser(user) ? "google" : "email",
        confirm: !user.email_confirmed_at && !isGoogleUser(user),
      }),
    })
    if (!result.success) throw new Error("send failed")
  } catch (error) {
    console.error("Signup approval email failed", error)
    return {
      ok: false,
      error:
        "The account has access, but the email could not be sent. Grant access again to resend it.",
    }
  }
  await updateSignupReviewMetadata(user.id, {
    approval_email_sent_at: new Date().toISOString(),
  })
  return { ok: true, outcome: "approved" }
}

export async function rejectSignup(
  userId: string,
  staffId: string,
): Promise<SignupReviewResult> {
  const user = await reviewedUser(userId)
  if (signupReviewStatus(user) !== "pending")
    return { ok: false, error: "This account is not awaiting setup." }
  const winner = await claimDecision(userId, staffId, "rejected", null)
  if (winner.decision !== "rejected") return decisionConflict
  await updateSignupReviewMetadata(user.id, {
    signup_review: "rejected",
    rejected_by: winner.staff_id,
    rejected_at: winner.created_at,
  })
  return { ok: true, outcome: "rejected" }
}
