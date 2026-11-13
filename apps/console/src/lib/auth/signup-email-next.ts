import { deviceReturnPath } from "@/lib/auth/device-return-path"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import { ycReturnPath } from "@/lib/yc/return-path"

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
