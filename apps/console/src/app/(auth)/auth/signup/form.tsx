"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import Script from "next/script"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { PendingReview } from "@/components/auth/pending-review"
import { GoogleIcon, Spinner } from "@/components/icons"
import { FALLBACK_PLAN_CATALOG, type PlanCatalog } from "@/lib/api/plan-catalog"
import { normalizeRequestedOffer } from "@/lib/auth/requested-offer"
import {
  clearFingerprintSignupCapture,
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

import {
  beginGoogleSignup,
  isCloudflareSignupObservationEnabled,
  signUpWithEmail,
} from "./action"
import {
  initialSignupDetails,
  PlanInterestCards,
  SignupDetailsFields,
  signupDetailsPayload,
  signupValuesOffer,
  validateSignupDetails,
  type SignupDetailsValues,
} from "./details-fields"

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY

declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (callback: () => void) => void
        execute: (
          siteKey: string,
          options: { action: string },
        ) => Promise<string>
      }
    }
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

const TURNSTILE_LOAD_TIMEOUT_MS = 1500
const TURNSTILE_TOKEN_TIMEOUT_MS = 3000

const getTurnstileToken = async (): Promise<string | undefined> => {
  if (!TURNSTILE_SITE_KEY) return undefined
  const start = Date.now()
  while (!window.turnstile && Date.now() - start < TURNSTILE_LOAD_TIMEOUT_MS)
    await new Promise((resolve) => setTimeout(resolve, 100))
  if (!window.turnstile) return undefined
  return new Promise((resolve) => {
    const container = document.createElement("div")
    container.style.position = "fixed"
    container.style.bottom = "16px"
    container.style.right = "16px"
    container.style.zIndex = "50"
    document.body.appendChild(container)
    let widgetId = ""
    const cleanup = () => {
      if (widgetId) window.turnstile?.remove(widgetId)
      container.remove()
    }
    const deadline = setTimeout(() => {
      cleanup()
      resolve(undefined)
    }, TURNSTILE_TOKEN_TIMEOUT_MS)
    try {
      widgetId = window.turnstile!.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "compact",
        appearance: "interaction-only",
        callback: (token: string) => {
          clearTimeout(deadline)
          cleanup()
          resolve(token)
        },
        "error-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
        "timeout-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
      })
    } catch {
      clearTimeout(deadline)
      cleanup()
      resolve(undefined)
    }
  })
}

const waitForGrecaptcha = async (timeoutMs = 8000): Promise<boolean> => {
  if (window.grecaptcha) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (window.grecaptcha) return true
  }
  return false
}

const RECAPTCHA_EXECUTE_TIMEOUT_MS = 8000

const getRecaptchaToken = async (
  action: string,
): Promise<string | undefined> => {
  if (!RECAPTCHA_SITE_KEY) return undefined
  if (!(await waitForGrecaptcha())) return undefined
  try {
    const tokenPromise = new Promise<string>((resolve, reject) => {
      window.grecaptcha!.enterprise.ready(() => {
        window
          .grecaptcha!.enterprise.execute(RECAPTCHA_SITE_KEY, { action })
          .then(resolve)
          .catch(reject)
      })
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("recaptcha_execute_timeout")),
        RECAPTCHA_EXECUTE_TIMEOUT_MS,
      ),
    )
    return await Promise.race([tokenPromise, timeoutPromise])
  } catch {
    return undefined
  }
}

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/"
  if (next.startsWith("/") && !next.startsWith("//")) return next
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next
  return "/"
}

export default function SignUpContent({
  catalog = FALLBACK_PLAN_CATALOG,
}: {
  catalog?: PlanCatalog
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [formValues, setFormValues] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const { fullName, email, password, confirmPassword } = formValues
  const setFormValue = (key: keyof typeof formValues, value: string) =>
    setFormValues((current) => ({ ...current, [key]: value }))
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pendingReview, setPendingReview] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const posthog = usePostHog()
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextUrl = sanitizeNext(searchParams.get("next"))
  const requestedOffer = normalizeRequestedOffer(searchParams.get("offer"))
  const [details, setDetails] = useState(() =>
    initialSignupDetails(requestedOffer),
  )
  const setDetail = <K extends keyof SignupDetailsValues>(
    key: K,
    value: SignupDetailsValues[K],
  ) => setDetails((current) => ({ ...current, [key]: value }))
  const signInParams = new URLSearchParams()
  if (requestedOffer) signInParams.set("offer", requestedOffer)
  if (nextUrl !== "/") signInParams.set("next", nextUrl)
  const signInHref = `/auth/signin${signInParams.size ? `?${signInParams}` : ""}`
  const isCompleteGoogleSignup = searchParams.get("complete_google") === "1"
  // A new Google account that started from sign-in has no signup details yet.
  const detailsRequired = searchParams.get("details") === "required"

  useEffect(() => {
    if (searchParams.get("error") === "link_expired") {
      setErrors({ form: "Verification link expired or invalid." })
    }
  }, [searchParams])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    const newErrors: Record<string, string> = validateSignupDetails(details)
    if (!fullName) newErrors.fullName = "Name is required."
    if (!email) newErrors.email = "Email is required."
    if (!password) newErrors.password = "Password is required."
    else if (password.length < 8)
      newErrors.password = "Must be at least 8 characters."
    if (password && password !== confirmPassword)
      newErrors.confirmPassword = "Passwords do not match."
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setIsLoading(true)
    try {
      const capture = await ensureFingerprintSignupCapture()
      const fingerprintDiagnostics = getFingerprintSignupDiagnostics()
      const recaptchaToken = await getRecaptchaToken("signup")
      const turnstileEnabled = await isCloudflareSignupObservationEnabled()
      const turnstileToken = turnstileEnabled
        ? await getTurnstileToken()
        : undefined
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setErrors({
          form: "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
        })
        return
      }
      const result = await signUpWithEmail(
        email,
        password,
        fullName,
        recaptchaToken,
        turnstileToken,
        capture,
        requestedOffer,
        fingerprintDiagnostics,
        nextUrl,
        signupDetailsPayload(details),
      )
      if (!result.success) {
        posthog.capture(AUTH_EVENTS.SIGN_UP_FAILED, {
          method: "email",
          reason: result.error,
        })
        if ("errorCode" in result && result.errorCode === "blocked_email") {
          router.push("/auth/auth-code-error?reason=signup_blocked")
          return
        }
        setErrors({ form: result.error || "Error creating account." })
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_UP_COMPLETED, {
        method: "email",
        requested_offer: signupValuesOffer(details),
      })
      clearFingerprintSignupCapture()
      setPendingReview(true)
    } catch {
      setErrors({ form: "Error creating account. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  // Recovery for an existing account carries no details; new signups must.
  const handleGoogleSignIn = async (withDetails: boolean) => {
    setErrors({})
    if (withDetails) {
      const detailErrors = validateSignupDetails(details)
      if (Object.keys(detailErrors).length > 0) {
        setErrors({
          ...detailErrors,
          form: "Fix your details above before continuing with Google.",
        })
        return
      }
    }
    const offer = withDetails ? signupValuesOffer(details) : requestedOffer
    setIsGoogleLoading(true)
    try {
      const capture = await ensureFingerprintSignupCapture()
      const fingerprintDiagnostics = getFingerprintSignupDiagnostics()
      const recaptchaToken = await getRecaptchaToken("signup_google")
      const turnstileEnabled = await isCloudflareSignupObservationEnabled()
      const turnstileToken = turnstileEnabled
        ? await getTurnstileToken()
        : undefined
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setErrors({
          form: "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
        })
        return
      }

      const proof = await beginGoogleSignup(
        recaptchaToken,
        turnstileToken,
        capture,
        fingerprintDiagnostics,
        ...(withDetails ? [signupDetailsPayload(details)] : []),
      )
      if (!proof.success) {
        setErrors({ form: proof.error || "Google signup verification failed." })
        return
      }

      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      callbackUrl.searchParams.set("signup_attempt_id", proof.signupAttemptId)
      if (offer) callbackUrl.searchParams.set("offer", offer)
      if (nextUrl && nextUrl !== "/") {
        callbackUrl.searchParams.set("next", nextUrl)
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: { prompt: "select_account" },
        },
      })
      if (error) {
        setErrors({ form: "Error signing in. Please try again." })
      } else {
        clearFingerprintSignupCapture()
      }
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      setIsGoogleLoading(false)
    }
  }

  if (pendingReview) return <PendingReview name={fullName} email={email} />

  const busy = isLoading || isGoogleLoading
  const googleButton = (label: string, loadingLabel: string) => (
    <Button
      type="button"
      variant="outline"
      onClick={() => handleGoogleSignIn(!isCompleteGoogleSignup)}
      disabled={busy}
      className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
    >
      {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
      {isGoogleLoading ? loadingLabel : label}
    </Button>
  )
  const planCards = (
    <PlanInterestCards
      values={details}
      catalog={catalog}
      disabled={busy}
      onChange={setDetail}
    />
  )
  const detailsFields = (
    <SignupDetailsFields
      values={details}
      errors={errors}
      disabled={busy}
      onChange={setDetail}
    />
  )
  const formError = errors.form && (
    <p className="text-xs text-destructive">{errors.form}</p>
  )
  const passwordToggle = (shown: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      className="text-muted"
      aria-label={shown ? "Hide password" : "Show password"}
    >
      {shown ? (
        <EyeSlashIcon className="size-4" weight="light" />
      ) : (
        <EyeIcon className="size-4" weight="light" />
      )}
    </button>
  )

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {RECAPTCHA_SITE_KEY && (
        <Script
          src={`https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`}
          strategy="afterInteractive"
        />
      )}
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
        />
      )}
      <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-10 lg:px-12">
        <Link href="/" className="inline-block">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={120}
            height={24}
            className="h-6 w-auto"
          />
        </Link>
        {isCompleteGoogleSignup ? (
          <div className="mx-auto mt-24 max-w-sm text-center">
            <h1 className="mb-4 text-sm font-medium text-foreground">
              Complete signup
            </h1>
            <p className="mb-6 text-xs leading-relaxed text-muted">
              Google sign-in succeeded. Complete signup to finish verification
              and provision your Superserve account.
            </p>
            {errors.form && (
              <p className="mb-4 text-xs text-destructive">{errors.form}</p>
            )}
            {googleButton(
              "Complete signup with Google",
              "Completing signup...",
            )}
          </div>
        ) : (
          <>
            <div className="mt-14">{planCards}</div>
            <div className="mx-auto mt-14 max-w-md">
              {detailsRequired ? (
                <>
                  <h2 className="text-sm font-medium text-foreground">
                    Complete your details
                  </h2>
                  <p className="mt-2 mb-6 text-xs leading-relaxed text-muted">
                    We need a few details before we can review your account.
                    Fill them in and continue with Google again.
                  </p>
                  <div className="space-y-3">{detailsFields}</div>
                  {errors.form && <div className="mt-4">{formError}</div>}
                  <div className="mt-6">
                    {googleButton("Continue with Google", "Signing up...")}
                  </div>
                </>
              ) : (
                <>
                  <form onSubmit={handleSignUp} className="space-y-3">
                    <Input
                      type="text"
                      placeholder="Full name"
                      aria-label="Full name"
                      value={fullName}
                      onChange={(e) => setFormValue("fullName", e.target.value)}
                      error={errors.fullName}
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      aria-label="Email"
                      value={email}
                      onChange={(e) => setFormValue("email", e.target.value)}
                      error={errors.email}
                    />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      aria-label="Password"
                      value={password}
                      onChange={(e) => setFormValue("password", e.target.value)}
                      error={errors.password}
                      suffix={passwordToggle(showPassword, () =>
                        setShowPassword(!showPassword),
                      )}
                    />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm password"
                      aria-label="Confirm password"
                      value={confirmPassword}
                      onChange={(e) =>
                        setFormValue("confirmPassword", e.target.value)
                      }
                      error={errors.confirmPassword}
                      suffix={passwordToggle(showConfirmPassword, () =>
                        setShowConfirmPassword(!showConfirmPassword),
                      )}
                    />
                    <div className="space-y-3 pt-3">{detailsFields}</div>
                    {formError}
                    <div className="pt-3">
                      <Button type="submit" disabled={busy} className="w-full">
                        {isLoading ? <Spinner /> : null}
                        {isLoading ? "Creating account..." : "Sign Up"}
                      </Button>
                    </div>
                  </form>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-dashed border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-background px-3 text-muted">or</span>
                    </div>
                  </div>
                  {googleButton("Continue with Google", "Signing up...")}
                  <p className="mt-6 text-center text-xs text-muted">
                    Already have an account?{" "}
                    <Link
                      href={signInHref}
                      className="font-medium text-foreground hover:underline"
                    >
                      Sign in
                    </Link>
                  </p>
                </>
              )}
              <p className="mt-6 text-center text-xs leading-relaxed text-muted/60">
                By continuing, you agree to our{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_WEBSITE_URL}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </a>
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
