import { financialRevocationMessages } from "./financial-authority"

// A presentation model. API adapters must derive it from authenticated server
// evidence; URL parameters and optimistic mutation results never select a state.
export type JourneyState =
  | "awaiting_confirmation"
  | "mismatch"
  | "manual_review"
  | "rejected"
  | "revoked"
  | "financial_revocation_pending"
  | "financial_revoked"
  | "acceptance_required"
  | "accepted"
  | "provisioning"
  | "outcome_unknown"
  | "review_required"
  | "grant_pending"
  | "funding_pending"
  | "funding_ready"
  | "exhausted"
  | "payment_needed"
  | "held"
  | "unavailable"

export const journeyMessages: Record<
  JourneyState,
  { title: string; description: string }
> = {
  awaiting_confirmation: {
    title: "Confirm your email",
    description:
      "Open the confirmation email sent to your founder address, then return here to continue.",
  },
  mismatch: {
    title: "Choose how to continue",
    description:
      "Sign in using your matching founder email, or request a review to use your preferred account email. Creating an account does not approve the offer.",
  },
  manual_review: {
    title: "Your claim is being reviewed",
    description:
      "Your claim is saved. We will email you when the review is complete. You can also return here to check its status.",
  },
  rejected: {
    title: "Your claim was not approved",
    description:
      "You can choose a standard plan or contact Superserve if you believe this decision is incorrect.",
  },
  financial_revocation_pending: financialRevocationMessages.pending,
  financial_revoked: financialRevocationMessages.revoked,
  revoked: {
    title: "Your approval has been revoked",
    description:
      "This offer cannot be accepted. Contact Superserve to review your claim and current account access.",
  },
  acceptance_required: {
    title: "Accept your YC offer",
    description:
      "Review your approved offer below. Accepting starts setup; you do not need to choose Free, buy Pro, or add a card first.",
  },
  accepted: {
    title: "Offer accepted",
    description:
      "Your acceptance is saved. We are preparing your Pro plan and credits. Access is not ready yet.",
  },
  provisioning: {
    title: "Setting up your Pro plan",
    description:
      "Your acceptance is saved. We are setting up your plan and credits. You can leave this page and return to check progress.",
  },
  outcome_unknown: {
    title: "We are checking your setup",
    description:
      "Setup has not been confirmed yet. Your acceptance is saved; you do not need to accept again.",
  },
  review_required: {
    title: "Your setup needs review",
    description:
      "Superserve needs to review your account before setup can continue.",
  },
  grant_pending: {
    title: "Preparing your credits",
    description:
      "Your plan is being prepared. Your current credit allowance is not confirmed yet.",
  },
  funding_pending: {
    title: "Checking your available credits",
    description:
      "We are checking your current allowance and account status before access is ready.",
  },
  funding_ready: {
    title: "Your Pro access is ready",
    description:
      "Your current credits and account eligibility are confirmed. You can start using Superserve.",
  },
  exhausted: {
    title: "Your current credits are used up",
    description:
      "Your current allowance has no remaining funds. Review team billing for available payment options. Resources do not resume automatically.",
  },
  payment_needed: {
    title: "Payment is needed",
    description:
      "Review team billing to resolve the payment required for further usage or your paid plan. Adding a card does not by itself confirm payment or access.",
  },
  held: {
    title: "Your account needs attention",
    description:
      "Setup or access is on hold. Contact Superserve for help reviewing your account.",
  },
  unavailable: {
    title: "We could not check your offer",
    description:
      "Your latest status is unavailable. Refresh to try again; no new acceptance or plan choice is needed.",
  },
}
