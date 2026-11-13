import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import {
  isPlanPickerPath,
  isSignupCheckoutPath,
  isSignupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"

// A dashboard page that no flow pins to one team, so sign-in may choose the
// team it opens.
export function isPlainDashboardPath(path: string): boolean {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(path)
  )
    return false
  const pathname = new URL(path, "https://example.com").pathname
  if (/^\/(auth|onboarding|api|invite|yc|device|admin)(\/|$)/.test(pathname))
    return false
  return (
    !isSignupCheckoutPath(path) &&
    !isSignupCheckoutReturnPath(path) &&
    !isPlanPickerPath(path) &&
    proAuthReturnPath(path) === null &&
    starterAuthReturnPath(path) === null
  )
}
