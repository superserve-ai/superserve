import "server-only"
import type { User } from "@supabase/supabase-js"

import { isGoogleUser } from "@/lib/auth/google-signup-proof"
import {
  signupReviewStatus,
  type SignupReviewStatus,
} from "@/lib/auth/signup-review"
import { updateSignupReviewMetadata } from "@/lib/auth/signup-review-server"
import { sendEmail } from "@/lib/email/send"
import {
  SignupApprovedEmail,
  signupApprovedSubject,
} from "@/lib/email/templates/signup-approved"
import { createAdminClient } from "@/lib/supabase/admin"

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
      if (signupReviewStatus(user) === "pending") pending.push(reviewRow(user))
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

async function pendingUser(userId: string): Promise<User | null> {
  const { data, error } =
    await createAdminClient().auth.admin.getUserById(userId)
  if (error || !data?.user) throw new Error("User not found")
  return signupReviewStatus(data.user) === "pending" ? data.user : null
}

/**
 * Gives a held Enterprise applicant access. The decision is recorded before
 * the email goes out so the link never reaches a still-pending account.
 */
export async function approveSignup(
  userId: string,
  staffId: string,
): Promise<SignupReviewResult> {
  const user = await pendingUser(userId)
  if (!user) return { ok: false, error: "This account is not awaiting setup." }
  if (!user.email) return { ok: false, error: "This account has no email." }
  await updateSignupReviewMetadata(user.id, {
    signup_review: "approved",
    approved_by: staffId,
    approved_at: new Date().toISOString(),
  })
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
        "The account has access, but the email could not be sent. Let them know directly.",
    }
  }
  return { ok: true, outcome: "approved" }
}

export async function rejectSignup(
  userId: string,
  staffId: string,
): Promise<SignupReviewResult> {
  const user = await pendingUser(userId)
  if (!user) return { ok: false, error: "This account is not awaiting setup." }
  await updateSignupReviewMetadata(user.id, {
    signup_review: "rejected",
    rejected_by: staffId,
    rejected_at: new Date().toISOString(),
  })
  return { ok: true, outcome: "rejected" }
}
