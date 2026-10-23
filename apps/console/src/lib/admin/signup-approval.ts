import "server-only"
import type { User } from "@supabase/supabase-js"

import { isGoogleUser } from "@/lib/auth/google-signup-proof"
import { REQUESTED_OFFER_LABELS } from "@/lib/auth/requested-offer"
import {
  readSignupRequest,
  SIGNUP_AFFILIATION_LABELS,
  signupDetailsOffer,
  signupReviewStatus,
  type SignupReviewStatus,
} from "@/lib/auth/signup-review"
import { updateSignupReviewMetadata } from "@/lib/auth/signup-review-server"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { SignupApprovedEmail } from "@/lib/email/templates/signup-approved"
import { signSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"
import { createAdminClient } from "@/lib/supabase/admin"

// Inputs persisted at email signup so approval can rebuild the link it would
// have sent. Stored under `app_metadata.signup_confirmation`.
export interface StoredSignupConfirmation {
  signup_attempt_id?: string
  offer?: string
  next?: string
  device_attempt_id?: string
}

const LIST_PAGE_SIZE = 1000
// Bounds an admin-only scan; review queues are far smaller than this.
const LIST_MAX_PAGES = 100

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
}

function storedConfirmation(user: User): StoredSignupConfirmation {
  const value = user.app_metadata?.signup_confirmation
  if (!value || typeof value !== "object") return {}
  const read = (key: keyof StoredSignupConfirmation) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined
  return {
    signup_attempt_id: read("signup_attempt_id"),
    offer: read("offer"),
    next: read("next"),
    device_attempt_id: read("device_attempt_id"),
  }
}

/** The callback URL the original signup link redirected to. */
export function signupCallbackUrl(confirmation: StoredSignupConfirmation) {
  const callbackUrl = new URL("/auth/callback", appUrl())
  if (confirmation.next) callbackUrl.searchParams.set("next", confirmation.next)
  if (confirmation.offer)
    callbackUrl.searchParams.set("offer", confirmation.offer)
  return callbackUrl
}

/**
 * Same parameters as the link signup used to send. The token is a magic link
 * (signup links require the password), which also confirms the address.
 */
export function signupConfirmationUrl(
  userId: string,
  confirmation: StoredSignupConfirmation,
  tokenHash: string,
): string {
  const url = signupCallbackUrl(confirmation)
  url.searchParams.set("token_hash", tokenHash)
  url.searchParams.set("type", "magiclink")
  if (confirmation.signup_attempt_id)
    url.searchParams.set("signup_attempt_id", confirmation.signup_attempt_id)
  url.searchParams.set("utm_source", "email")
  url.searchParams.set("utm_medium", "signup_confirmation")
  if (confirmation.device_attempt_id) {
    const proof = signSignupDeviceBinding(
      userId,
      confirmation.device_attempt_id,
    )
    if (proof) {
      url.searchParams.set("device_attempt_id", confirmation.device_attempt_id)
      url.searchParams.set("device_bind_proof", proof)
    }
  }
  return url.toString()
}

export interface SignupReviewRow {
  id: string
  name: string | null
  email: string | null
  provider: string
  company: string | null
  affiliation: string | null
  ycLink: string | null
  plan: string | null
  createdAt: string
  status: SignupReviewStatus
}

function reviewRow(user: User): SignupReviewRow {
  const request = readSignupRequest(user)
  return {
    id: user.id,
    name:
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null,
    email: user.email ?? null,
    provider: isGoogleUser(user) ? "google" : "email",
    company: request?.company ?? null,
    affiliation: request
      ? SIGNUP_AFFILIATION_LABELS[request.affiliation]
      : null,
    ycLink: request?.ycLink ?? null,
    plan: request ? REQUESTED_OFFER_LABELS[signupDetailsOffer(request)] : null,
    createdAt: user.created_at,
    status: signupReviewStatus(user)!,
  }
}

/** Approved, but the account has not received or used its link yet. */
function awaitingAccess(user: User): boolean {
  return (
    signupReviewStatus(user) === "approved" &&
    (!user.email_confirmed_at || !user.app_metadata?.approval_email_sent_at)
  )
}

export async function listSignupReviews(): Promise<{
  pending: SignupReviewRow[]
  awaiting: SignupReviewRow[]
}> {
  const admin = createAdminClient()
  const pending: SignupReviewRow[] = []
  const awaiting: SignupReviewRow[] = []
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PAGE_SIZE,
    })
    if (error) throw new Error(`Unable to list users: ${error.message}`)
    for (const user of data.users) {
      if (signupReviewStatus(user) === "pending") pending.push(reviewRow(user))
      else if (awaitingAccess(user)) awaiting.push(reviewRow(user))
    }
    if (data.users.length < LIST_PAGE_SIZE) break
  }
  const byNewest = (a: SignupReviewRow, b: SignupReviewRow) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt)
  return {
    pending: pending.toSorted(byNewest),
    awaiting: awaiting.toSorted(byNewest),
  }
}

async function sendApprovalEmail(user: User): Promise<void> {
  if (!user.email) throw new Error("This account has no email address")
  if (!user.email_confirmed_at) {
    // A fresh link: the signup-time token may have expired during review.
    const confirmation = storedConfirmation(user)
    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
      options: { redirectTo: signupCallbackUrl(confirmation).toString() },
    })
    const tokenHash = data?.properties?.hashed_token
    if (error || !tokenHash)
      throw new Error("Unable to generate a confirmation link")
    const result = await sendEmail({
      to: user.email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({
        confirmationUrl: signupConfirmationUrl(
          user.id,
          confirmation,
          tokenHash,
        ),
      }),
    })
    if (!result.success) throw new Error("Unable to send the approval email")
    return
  }
  const signIn = new URL("/auth/signin", appUrl())
  signIn.searchParams.set("utm_source", "email")
  signIn.searchParams.set("utm_medium", "signup_approved")
  const result = await sendEmail({
    to: user.email,
    subject: "Your Superserve account is approved",
    react: SignupApprovedEmail({
      signInUrl: signIn.toString(),
      provider: isGoogleUser(user) ? "google" : "email",
    }),
  })
  if (!result.success) throw new Error("Unable to send the approval email")
}

export type SignupReviewResult =
  | { ok: true; outcome: "approved" | "resent" | "rejected" }
  | { ok: false; error: string }

async function reviewedUser(userId: string): Promise<User> {
  const { data, error } =
    await createAdminClient().auth.admin.getUserById(userId)
  if (error || !data?.user) throw new Error("User not found")
  return data.user
}

/**
 * Approves a pending account, or resends the link to an approved account that
 * has not received or used one. Approval is recorded before the email goes
 * out so the link never reaches a still-pending account.
 */
export async function approveSignup(
  userId: string,
  staffId: string,
): Promise<SignupReviewResult> {
  const user = await reviewedUser(userId)
  const status = signupReviewStatus(user)
  if (status === "approved" && !awaitingAccess(user))
    return { ok: false, error: "This account is already approved." }
  if (status !== "pending" && status !== "approved")
    return { ok: false, error: "This account is not awaiting review." }
  if (status === "pending")
    await updateSignupReviewMetadata(user.id, {
      signup_review: "approved",
      approved_by: staffId,
      approved_at: new Date().toISOString(),
    })
  try {
    await sendApprovalEmail(user)
  } catch (error) {
    console.error("Signup approval email failed", error)
    return {
      ok: false,
      error:
        "The account is approved, but the email could not be sent. Try resending.",
    }
  }
  await updateSignupReviewMetadata(user.id, {
    approval_email_sent_at: new Date().toISOString(),
  })
  return { ok: true, outcome: status === "pending" ? "approved" : "resent" }
}

export async function rejectSignup(
  userId: string,
  staffId: string,
): Promise<SignupReviewResult> {
  const user = await reviewedUser(userId)
  if (signupReviewStatus(user) !== "pending")
    return { ok: false, error: "This account is not awaiting review." }
  await updateSignupReviewMetadata(user.id, {
    signup_review: "rejected",
    rejected_by: staffId,
    rejected_at: new Date().toISOString(),
  })
  return { ok: true, outcome: "rejected" }
}
