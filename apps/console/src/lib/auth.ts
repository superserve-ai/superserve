// TODO(better-auth): Replace stubs with Better Auth implementation

export interface AuthUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  created_at: string
}

export interface AuthSession {
  user: AuthUser
  access_token: string
}

/** Get the current authenticated user (client-side). */
export async function getUser(): Promise<AuthUser | null> {
  // TODO(better-auth): implement
  throw new Error("Auth not implemented — pending Better Auth setup")
}

/** Get the current session (client-side). */
export async function getSession(): Promise<AuthSession | null> {
  // TODO(better-auth): implement
  throw new Error("Auth not implemented — pending Better Auth setup")
}

/** Sign out the current user. */
export async function signOut(): Promise<void> {
  // TODO(better-auth): implement
  throw new Error("Auth not implemented — pending Better Auth setup")
}

/** Sign in with email and password. */
export async function signInWithPassword(email: string, _password: string): Promise<{ error?: string }> {
  // TODO(better-auth): implement
  console.error("signInWithPassword not implemented", { email })
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Sign in with OAuth provider (e.g. Google). */
export async function signInWithOAuth(_provider: string, _redirectTo: string): Promise<{ error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Sign up with email and password. */
export async function signUp(
  _email: string,
  _password: string,
  _metadata?: Record<string, unknown>,
): Promise<{ error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Update user (e.g. password reset). */
export async function updateUser(_updates: { password?: string }): Promise<{ error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Exchange an auth code for a session (OAuth callback). */
export async function exchangeCodeForSession(_code: string): Promise<{ user?: AuthUser; error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Verify an OTP token (email confirmation, recovery). */
export async function verifyOtp(
  _tokenHash: string,
  _type: string,
): Promise<{ user?: AuthUser; error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Generate a signup confirmation link (server-side, admin). */
export async function generateSignupLink(
  _email: string,
  _password: string,
  _fullName: string,
  _redirectTo: string,
): Promise<{ tokenHash?: string; error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Generate a password recovery link (server-side, admin). */
export async function generateRecoveryLink(
  _email: string,
  _redirectTo: string,
): Promise<{ tokenHash?: string; error?: string }> {
  // TODO(better-auth): implement
  return { error: "Auth not implemented — pending Better Auth setup" }
}

/** Check if the current request has an authenticated user (middleware). */
export async function getMiddlewareUser(
  _request: Request,
): Promise<{ user: AuthUser | null }> {
  // TODO(better-auth): implement
  return { user: null }
}

export const DEV_AUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH === "true"

/** Dev-mode sign in (creates user if needed). */
export async function devSignIn(): Promise<{ success: boolean; error?: string }> {
  if (!DEV_AUTH_ENABLED) return { success: false, error: "Dev auth disabled" }
  // TODO(better-auth): implement dev auth flow
  return { success: false, error: "Auth not implemented — pending Better Auth setup" }
}
