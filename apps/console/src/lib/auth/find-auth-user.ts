import "server-only"
import type { User } from "@supabase/supabase-js"

import { supabaseFetch } from "@/lib/supabase/fresh-fetch"

const PAGE_SIZE = 50
const MAX_PAGES = 5

/**
 * Finds the password account for an email address without creating a token.
 * The admin generateLink API replaces the address's current recovery token,
 * so the recovery actions look the account up first and generate a link only
 * when they are sure to send it.
 *
 * The admin user list's `filter` matches any part of the email or the full
 * name, so this keeps only an exact, case-insensitive email match. Like
 * generateLink, it skips SSO accounts. Throws when the lookup fails, so a
 * caller never treats an error as "no account".
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

  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({
      filter: wanted,
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
    const match = users.find(
      (user) => user.email?.toLowerCase() === wanted && !user.is_sso_user,
    )
    if (match) return match
    if (users.length < PAGE_SIZE) return null
  }
  // So many partial matches is not normal; fail rather than guess.
  throw new Error("User lookup matched too many accounts")
}
