import { claimID } from "./staff-schema"

// Navigation only: staff review still requires its own proof and backend access.
export function staffReturnPath(raw: string | null): string | null {
  const match = /^\/admin\/yc\/?(?:\?claim=([^&#?]+))?$/.exec(raw ?? "")
  if (!match || (match[1] && !claimID.safeParse(match[1]).success)) return null
  return `/admin/yc${match[1] ? `?claim=${match[1]}` : ""}`
}
