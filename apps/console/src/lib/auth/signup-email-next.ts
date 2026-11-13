import { deviceReturnPath } from "@/lib/auth/device-return-path"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import { ycReturnPath } from "@/lib/yc/return-path"

import { SIGNUP_OFFER_DESTINATIONS } from "./signup-offer"

// The next path a sign-up confirmation email carries: only these steps
// survive into the link, and any other path is dropped (the callback then
// picks its default step).
export function signupEmailNextPath(
  raw: string | null | undefined,
): string | null {
  return (
    proAuthReturnPath(raw ?? null) ??
    starterAuthReturnPath(raw ?? null) ??
    ycReturnPath(raw) ??
    deviceReturnPath(raw) ??
    inviteReturnPath(raw)
  )
}

// Where a tab that follows a confirmation goes when it cannot learn the
// callback's step. With an offer, the callback may swap the offer's landing
// page for another step the team's state decides, so the dashboard entry is
// the safe step then; any other emailed next stays as it is.
export function signupFollowFallbackPath(
  emailedNext: string,
  rawOffer: string | null | undefined,
): string {
  return rawOffer &&
    (Object.values(SIGNUP_OFFER_DESTINATIONS) as string[]).includes(emailedNext)
    ? "/"
    : emailedNext
}
