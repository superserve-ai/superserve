"use server"

import { beginGoogleSigninOrigin } from "@/lib/auth/google-signup-proof"

export async function beginGoogleSignIn(): Promise<string | undefined> {
  try {
    return await beginGoogleSigninOrigin()
  } catch {
    console.warn("Google signup origin could not be retained")
    return undefined
  }
}
