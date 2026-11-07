"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import Script from "next/script"
import { usePostHog } from "posthog-js/react"
import { useEffect, useRef, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { GoogleIcon, Spinner } from "@/components/icons"
import { normalizeSignupRequestedOffer } from "@/lib/auth/requested-offer"
import { SIGNUP_OFFER_PARAM } from "@/lib/auth/signup-offer"
import {
  clearFingerprintSignupCapture,
  ensureFingerprintSignupCapture,
  getFingerprintSignupDiagnostics,
} from "@/lib/fingerprint/client"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

import {
  beginGoogleSignup,
  claimGoogleRecoveryContinuation,
  isCloudflareSignupObservationEnabled,
  resendSignupConfirmation,
  signUpWithEmail,
} from "./action"

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

// Copy for each reason the callback reports a first-time Google signup unchecked.
const GOOGLE_RECOVERY_MESSAGES: Record<string, string> = {
  started_from_signin:
    "Looks like you're new here. One quick check to finish creating your account.",
  expired:
    "Your signup check timed out. One quick check to finish creating your account.",
  no_proof:
    "We couldn't confirm your signup check. One quick check to finish creating your account.",
  attempt_mismatch:
    "We couldn't confirm your signup check. One quick check to finish creating your account.",
  invalid_proof:
    "We couldn't confirm your signup check. One quick check to finish creating your account.",
}

// The recovery page continues to Google on its own once per tab within this
// window, so a check that keeps failing falls back to the button.
const GOOGLE_RECOVERY_AUTO_KEY = "superserve-google-signup-auto-continue"
const GOOGLE_RECOVERY_AUTO_WINDOW_MS = 10 * 60 * 1000

// Matches the server-side cooldown between confirmation emails.
const RESEND_COOLDOWN_SECONDS = 60
const BOT_CHECK_UNAVAILABLE =
  "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again."

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

export default function SignUpContent() {
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
  // The address the account was created with. The field stays editable while
  // signup is pending, so the confirmation views and resend use this copy.
  const [submittedEmail, setSubmittedEmail] = useState("")
  // Only "sent" means a confirmation email actually went out.
  const [emailStatus, setEmailStatus] = useState<"sent" | "not_sent" | null>(
    null,
  )
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [now, setNow] = useState(0)
  const resendCooldown = Math.max(
    0,
    Math.ceil((resendAvailableAt - now) / 1000),
  )
  const [isResending, setIsResending] = useState(false)
  const [resendNotice, setResendNotice] = useState<{
    text: string
    error: boolean
  } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const posthog = usePostHog()
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextUrl = sanitizeNext(searchParams.get("next"))
  const rawOffer =
    searchParams.get(SIGNUP_OFFER_PARAM) ||
    searchParams.get("offer") ||
    undefined
  const requestedOffer = normalizeSignupRequestedOffer(rawOffer)
  const signInParams = new URLSearchParams()
  if (requestedOffer) signInParams.set("offer", requestedOffer)
  if (rawOffer && rawOffer !== requestedOffer)
    signInParams.set(SIGNUP_OFFER_PARAM, rawOffer)
  if (nextUrl !== "/") signInParams.set("next", nextUrl)
  const signInHref = `/auth/signin${signInParams.size ? `?${signInParams}` : ""}`
  const isCompleteGoogleSignup = searchParams.get("complete_google") === "1"
  const googleRecoveryReason = searchParams.get("reason") ?? ""
  // The reason comes from the URL; an inherited key like __proto__ is not one.
  const googleRecoveryMessage = Object.hasOwn(
    GOOGLE_RECOVERY_MESSAGES,
    googleRecoveryReason,
  )
    ? GOOGLE_RECOVERY_MESSAGES[googleRecoveryReason]
    : undefined
  const autoContinued = useRef(false)

  useEffect(() => {
    if (searchParams.get("error") === "link_expired") {
      setErrors({
        form: "This confirmation link expired or was already used. Sign up again with the same email and password to get a new link, or sign in if you already confirmed your email.",
      })
    }
  }, [searchParams])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    const newErrors: Record<string, string> = {}
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
        ...(rawOffer && rawOffer !== requestedOffer ? [rawOffer] : []),
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
        if ("errorCode" in result && result.errorCode === "email_not_sent") {
          setResendNotice(null)
          startResendCooldown(RESEND_COOLDOWN_SECONDS)
          setSubmittedEmail(email)
          setEmailStatus("not_sent")
          return
        }
        setErrors({ form: result.error || "Error creating account." })
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_UP_COMPLETED, {
        method: "email",
        ...(requestedOffer ? { requested_offer: requestedOffer } : {}),
      })
      clearFingerprintSignupCapture()
      setResendNotice(null)
      startResendCooldown(RESEND_COOLDOWN_SECONDS)
      setSubmittedEmail(email)
      setEmailStatus("sent")
    } catch {
      setErrors({ form: "Error creating account. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  const startResendCooldown = (seconds: number) => {
    const current = Date.now()
    setNow(current)
    setResendAvailableAt(current + seconds * 1000)
  }

  useEffect(() => {
    if (resendAvailableAt <= Date.now()) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= resendAvailableAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [resendAvailableAt])

  const handleResend = async () => {
    setIsResending(true)
    setResendNotice(null)
    try {
      const recaptchaToken = await getRecaptchaToken("signup_resend")
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        setResendNotice({ text: BOT_CHECK_UNAVAILABLE, error: true })
        return
      }
      const result = await resendSignupConfirmation(
        recaptchaToken,
        submittedEmail,
      )
      if (result.success) {
        setEmailStatus("sent")
        startResendCooldown(RESEND_COOLDOWN_SECONDS)
        setResendNotice({
          text: "We sent a new confirmation email. Links in earlier emails no longer work.",
          error: false,
        })
        return
      }
      if (
        result.errorCode === "cooldown" ||
        result.errorCode === "email_not_sent"
      )
        startResendCooldown(result.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS)
      // A failed resend may already have replaced the earlier link.
      if (result.errorCode === "email_not_sent") setEmailStatus("not_sent")
      setResendNotice({ text: result.error, error: true })
    } catch {
      setResendNotice({
        text: "We couldn't resend the email. Please try again.",
        error: true,
      })
    } finally {
      setIsResending(false)
    }
  }

  const startOver = () => {
    setEmailStatus(null)
    setResendNotice(null)
  }

  const resendControls = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleResend}
        disabled={isResending || resendCooldown > 0}
        className="mt-5 w-full gap-2"
      >
        {isResending && <Spinner />}
        {isResending
          ? "Sending..."
          : resendCooldown > 0
            ? `Resend confirmation email (${resendCooldown}s)`
            : "Resend confirmation email"}
      </Button>
      {resendNotice && (
        <p
          role={resendNotice.error ? "alert" : "status"}
          className={`mt-3 text-center text-xs ${resendNotice.error ? "text-destructive" : "text-muted"}`}
        >
          {resendNotice.text}
        </p>
      )}
      <p className="mt-5 text-center text-xs text-muted">
        Wrong email?{" "}
        <button
          type="button"
          onClick={startOver}
          disabled={isResending}
          className="font-medium text-foreground hover:underline disabled:opacity-50"
        >
          Start over
        </button>
        {" · "}Already verified?{" "}
        <Link
          href={signInHref}
          className="font-medium text-foreground hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  )

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
    setErrors({})
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
      )
      if (!proof.success) {
        setErrors({ form: proof.error || "Google signup verification failed." })
        return
      }

      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      callbackUrl.searchParams.set("signup_attempt_id", proof.signupAttemptId)
      if (requestedOffer) callbackUrl.searchParams.set("offer", requestedOffer)
      if (rawOffer && rawOffer !== requestedOffer)
        callbackUrl.searchParams.set(SIGNUP_OFFER_PARAM, rawOffer)
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

  const googleSignIn = useRef(handleGoogleSignIn)
  useEffect(() => {
    googleSignIn.current = handleGoogleSignIn
  })

  // When this browser's own callback just failed the check, run the check and
  // go back to Google without asking for another click. A link alone only
  // shows the button.
  useEffect(() => {
    if (!isCompleteGoogleSignup || !googleRecoveryMessage) return
    if (autoContinued.current) return
    autoContinued.current = true
    try {
      const last = Number(sessionStorage.getItem(GOOGLE_RECOVERY_AUTO_KEY))
      if (last && Date.now() - last < GOOGLE_RECOVERY_AUTO_WINDOW_MS) return
    } catch {
      return
    }
    void claimGoogleRecoveryContinuation(googleRecoveryReason)
      .then((claimed) => {
        if (!claimed) return
        sessionStorage.setItem(GOOGLE_RECOVERY_AUTO_KEY, String(Date.now()))
        return googleSignIn.current()
      })
      .catch(() => undefined)
  }, [isCompleteGoogleSignup, googleRecoveryMessage, googleRecoveryReason])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
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
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>
        {emailStatus === "sent" ? (
          <>
            <h1 className="text-center text-sm font-medium text-foreground">
              Check Your Email
            </h1>
            <p className="mt-2 text-center text-xs leading-relaxed text-muted">
              We&apos;ve sent a verification link to{" "}
              <strong className="text-foreground">{submittedEmail}</strong>.
              Check your inbox and click the link to verify your account.
            </p>
            {resendControls}
          </>
        ) : emailStatus === "not_sent" ? (
          <>
            <h1 className="text-center text-sm font-medium text-foreground">
              We couldn&apos;t send your confirmation email
            </h1>
            <p className="mt-2 text-center text-xs leading-relaxed text-muted">
              Your account for{" "}
              <strong className="text-foreground">{submittedEmail}</strong> was
              created, but the confirmation email did not go out. Send it again
              below. If it still fails, contact{" "}
              <a
                href="mailto:support@superserve.ai"
                className="font-medium text-foreground hover:underline"
              >
                support@superserve.ai
              </a>
              .
            </p>
            {resendControls}
          </>
        ) : isCompleteGoogleSignup ? (
          <>
            <h1 className="mb-4 text-center text-sm font-medium text-foreground">
              Complete signup
            </h1>
            <p className="mb-6 text-center text-xs leading-relaxed text-muted">
              {googleRecoveryMessage ??
                "Google sign-in succeeded. Complete signup to finish verification and provision your Superserve account."}
            </p>
            {errors.form && (
              <p className="mb-4 text-xs text-destructive">{errors.form}</p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
            >
              {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
              {isGoogleLoading
                ? "Completing signup..."
                : "Complete signup with Google"}
            </Button>
          </>
        ) : (
          <>
            <h1 className="mb-6 text-center text-sm font-medium text-foreground">
              Create your Superserve account
            </h1>
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
            >
              {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
              {isGoogleLoading ? "Signing up..." : "Continue with Google"}
            </Button>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-muted">or</span>
              </div>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <Input
                type="text"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFormValue("fullName", e.target.value)}
                error={errors.fullName}
              />
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setFormValue("email", e.target.value)}
                error={errors.email}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setFormValue("password", e.target.value)}
                error={errors.password}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted"
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="size-4" weight="light" />
                    ) : (
                      <EyeIcon className="size-4" weight="light" />
                    )}
                  </button>
                }
              />
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) =>
                  setFormValue("confirmPassword", e.target.value)
                }
                error={errors.confirmPassword}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-muted"
                  >
                    {showConfirmPassword ? (
                      <EyeSlashIcon className="size-4" weight="light" />
                    ) : (
                      <EyeIcon className="size-4" weight="light" />
                    )}
                  </button>
                }
              />
              {errors.form && (
                <p className="text-xs text-destructive">{errors.form}</p>
              )}
              <Button
                type="submit"
                disabled={isLoading || isGoogleLoading}
                className="w-full"
              >
                {isLoading ? <Spinner /> : null}
                {isLoading ? "Creating account..." : "Sign Up"}
              </Button>
            </form>
            <p className="mt-5 text-center text-xs text-muted">
              Already have an account?{" "}
              <Link
                href={signInHref}
                className="font-medium text-foreground hover:underline"
              >
                Sign in
              </Link>
            </p>
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
          </>
        )}
      </div>
    </div>
  )
}
