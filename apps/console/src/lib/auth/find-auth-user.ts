import "server-only"
import type { User } from "@supabase/supabase-js"

import { supabaseFetch } from "@/lib/supabase/fresh-fetch"

const PAGE_SIZE = 100
const MAX_PAGES = 10

// Supabase Auth puts the filter inside a SQL LIKE pattern, where `_` and `%`
// match any character. Escape them so the search is for the literal text.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// The user JSON has no is_sso_user field. SSO accounts have identities, and
// an app_metadata provider, named `sso:<provider id>`.
function isSsoUser(user: User): boolean {
  const provider = user.app_metadata?.provider
  return (
    (typeof provider === "string" && provider.startsWith("sso:")) ||
    (user.identities ?? []).some((identity) =>
      identity.provider.startsWith("sso:"),
    )
  )
}

/**
 * Finds the password account for an email address without creating a token.
 * The admin generateLink API replaces the address's current recovery token,
 * so the recovery actions look the account up first and generate a link only
 * when they are sure to send it.
 *
 * The admin user list's `filter` matches any part of the email or the full
 * name, so this keeps only exact, case-insensitive email matches. Like
 * generateLink, it skips SSO accounts. Throws when the lookup fails or more
 * than one account could be the one generateLink picks, so a caller never
 * treats an error as "no account" or checks the wrong account.
 */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    )
  }
  const wanted = email.trim().toLowerCase()
  const endpoint = `${url.replace(/\/+$/, "")}/auth/v1/admin/users`
  const matches: User[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({
      filter: escapeLikePattern(wanted),
      page: String(page),
      per_page: String(PAGE_SIZE),
    })
    const response = await supabaseFetch(`${endpoint}?${query}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    })
    if (!response.ok) {
      throw new Error(`User lookup failed with status ${response.status}`)
    }
    const body = (await response.json()) as { users?: User[] }
    const users = Array.isArray(body.users) ? body.users : []
    for (const user of users) {
      if (user.email?.toLowerCase() === wanted && !isSsoUser(user)) {
        matches.push(user)
      }
    }
    if (users.length < PAGE_SIZE) {
      if (matches.length > 1) {
        throw new Error("User lookup matched more than one account")
      }
      return matches[0] ?? null
    }
  }
  // So many partial matches is not normal; fail rather than guess.
  throw new Error("User lookup matched too many accounts")
}
