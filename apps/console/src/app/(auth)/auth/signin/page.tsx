"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { Button, cn, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import Script from "next/script"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect, useRef, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { GoogleIcon, Spinner } from "@/components/icons"
import { normalizeSignupRequestedOffer } from "@/lib/auth/requested-offer"
import {
  SIGNUP_OFFER_PARAM,
  signInOfferDestination,
  isSelfServeSignupOffer,
} from "@/lib/auth/signup-offer"
import { inviteLinkReplayClass } from "@/lib/invite-token-redaction"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { RECAPTCHA_SITE_KEY, getRecaptchaToken } from "@/lib/recaptcha/client"
import { createBrowserClient } from "@/lib/supabase/client"

import { beginGoogleSignIn } from "./google-action"
import { sendSignInLink } from "./link-action"

type RecoveryOption = "magic_link" | "google" | "forgot_password"

function SignInContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [isEmailLoading, setIsEmailLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Shown after a wrong email or password, to offer other ways in.
  const [showRecovery, setShowRecovery] = useState(false)
  const recoveryTracked = useRef(false)
  const [isLinkSending, setIsLinkSending] = useState(false)
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const rawOffer =
    searchParams.get(SIGNUP_OFFER_PARAM) ||
    searchParams.get("offer") ||
    undefined
  const requestedOffer = normalizeSignupRequestedOffer(rawOffer)
  const posthog = usePostHog()

  const rawNext = searchParams.get("next") || "/"
  const nextUrl =
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/.test(rawNext)
      ? rawNext
      : "/"

  const signUpParams = new URLSearchParams()
  if (requestedOffer) signUpParams.set("offer", requestedOffer)
  if (rawOffer && rawOffer !== requestedOffer)
    signUpParams.set(SIGNUP_OFFER_PARAM, rawOffer)
  if (nextUrl !== "/") signUpParams.set("next", nextUrl)
  const signUpHref = `/auth/signup${signUpParams.size ? `?${signUpParams}` : ""}`

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createBrowserClient()
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()
        // Only sign out on explicit auth errors (expired/invalid token), not
        // transient network failures — otherwise a flaky connection would
        // nuke a valid session on every page load.
        if (error?.status === 401 || error?.status === 403) {
          await supabase.auth.signOut()
          return
        }
        if (user) {
          setIsEmailLoading(true)
          window.location.replace(
            nextUrl === "/" && isSelfServeSignupOffer(rawOffer)
              ? signInOfferDestination(rawOffer)
              : nextUrl,
          )
        }
      } catch {
        setIsEmailLoading(false)
        // Network error: leave the session alone.
      }
    }
    checkUser()
  }, [nextUrl, rawOffer])

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    if (!email) {
      setErrors((prev) => ({ ...prev, email: "Email is required." }))
      return
    }
    if (!password) {
      setErrors((prev) => ({ ...prev, password: "Password is required." }))
      return
    }
    setIsEmailLoading(true)
    let navigating = false
    try {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        posthog.capture(AUTH_EVENTS.SIGN_IN_FAILED, {
          method: "email",
          reason: error.message,
        })
        if (error.message.includes("Invalid login credentials")) {
          setErrors({ form: "Invalid email or password." })
          setShowRecovery(true)
          if (!recoveryTracked.current) {
            recoveryTracked.current = true
            posthog.capture(AUTH_EVENTS.SIGN_IN_RECOVERY_SHOWN, {
              method: "email",
            })
          }
        } else if (error.message.includes("Email not confirmed")) {
          setErrors({ form: "Please verify your email before signing in." })
        } else {
          setErrors({ form: "Error signing in. Please try again." })
        }
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_IN_COMPLETED, { method: "email" })
      // Discard routes prefetched before the session cookies were set.
      window.location.replace(
        nextUrl === "/" && isSelfServeSignupOffer(rawOffer)
          ? signInOfferDestination(rawOffer)
          : nextUrl,
      )
      navigating = true
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      if (!navigating) setIsEmailLoading(false)
    }
  }

  const trackRecoveryOption = (option: RecoveryOption) => {
    posthog.capture(AUTH_EVENTS.SIGN_IN_RECOVERY_OPTION_CLICKED, { option })
  }

  const handleSendSignInLink = async () => {
    trackRecoveryOption("magic_link")
    setLinkError(null)
    if (!email) {
      setErrors({ email: "Email is required." })
      return
    }
    setIsLinkSending(true)
    try {
      const recaptchaToken = await getRecaptchaToken("signin_link")
      if (RECAPTCHA_SITE_KEY && !recaptchaToken) {
        posthog.capture(AUTH_EVENTS.SIGN_IN_LINK_FAILED, {
          method: "email_link",
          reason: "captcha_unavailable",
        })
        setLinkError("We couldn't verify you're human. Please try again.")
        return
      }
      const result = await sendSignInLink(
        email,
        recaptchaToken,
        nextUrl === "/" && isSelfServeSignupOffer(rawOffer)
          ? signInOfferDestination(rawOffer)
          : nextUrl,
      )
      if (!result.success) {
        posthog.capture(AUTH_EVENTS.SIGN_IN_LINK_FAILED, {
          method: "email_link",
          reason: result.errorCode,
        })
        setLinkError(
          result.errorCode === "captcha_failed"
            ? "We couldn't verify you're human. Please try again."
            : "Could not send the link. Please try again.",
        )
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_IN_LINK_REQUESTED, {
        method: "email_link",
      })
      setLinkSentTo(email)
    } catch {
      posthog.capture(AUTH_EVENTS.SIGN_IN_LINK_FAILED, {
        method: "email_link",
        reason: "request_error",
      })
      setLinkError("Could not send the link. Please try again.")
    } finally {
      setIsLinkSending(false)
    }
  }

  const handleGoogleSignIn = async (fromRecovery = false) => {
    if (fromRecovery) trackRecoveryOption("google")
    setIsLoading(true)
    setErrors({})
    try {
      const supabase = createBrowserClient()
      const intentId = await beginGoogleSignIn()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      if (requestedOffer) callbackUrl.searchParams.set("offer", requestedOffer)
      if (rawOffer && rawOffer !== requestedOffer)
        callbackUrl.searchParams.set(SIGNUP_OFFER_PARAM, rawOffer)
      if (intentId)
        callbackUrl.searchParams.set("google_signin_intent", intentId)
      if (nextUrl && nextUrl !== "/") {
        callbackUrl.searchParams.set("next", nextUrl)
      }
      if (fromRecovery)
        callbackUrl.searchParams.set("sign_in_recovery", "google")
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
          queryParams: { prompt: "select_account" },
        },
      })
      if (error) {
        setErrors({ form: "Error signing in. Please try again." })
      }
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      {showRecovery && RECAPTCHA_SITE_KEY && (
        <Script
          src={`https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`}
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

        <h1 className="mb-6 text-center text-sm font-medium text-foreground">
          Sign in to Superserve
        </h1>

        {/* Google OAuth — first */}
        <Button
          type="button"
          variant="outline"
          onClick={() => handleGoogleSignIn()}
          disabled={isLoading || isEmailLoading || isLinkSending}
          className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
        >
          {isLoading ? <Spinner /> : <GoogleIcon />}
          {isLoading ? "Signing in..." : "Continue with Google"}
        </Button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-dashed border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-muted">or</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setLinkSentTo(null)
            }}
            disabled={isLinkSending}
            error={errors.email}
          />
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
              >
                {showPassword ? (
                  <EyeSlashIcon className="size-4" weight="light" />
                ) : (
                  <EyeIcon className="size-4" weight="light" />
                )}
              </button>
            }
          />
          <div className="flex justify-end">
            <Link
              href="/auth/forgot-password"
              className="text-xs text-muted/60 hover:text-muted"
            >
              Forgot password?
            </Link>
          </div>
          {errors.form && (
            <p className="text-xs text-destructive">{errors.form}</p>
          )}
          <Button
            type="submit"
            disabled={isEmailLoading || isLoading || isLinkSending}
            className="w-full"
          >
            {isEmailLoading ? <Spinner /> : null}
            {isEmailLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        {showRecovery && (
          <section
            aria-label="Other ways to sign in"
            className="mt-4 space-y-2 border border-dashed border-border p-3"
          >
            {linkSentTo ? (
              <p aria-live="polite" className="text-xs text-foreground">
                If an account exists, we sent a link to{" "}
                <span data-mask className="font-medium">
                  {linkSentTo}
                </span>
                .
              </p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Having trouble? Try another way to sign in.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendSignInLink}
                  disabled={isLinkSending || isLoading || isEmailLoading}
                  className="w-full gap-2"
                >
                  {isLinkSending ? <Spinner /> : null}
                  {isLinkSending ? "Sending..." : "Email me a sign-in link"}
                </Button>
                {linkError && (
                  <p className="text-xs text-destructive">{linkError}</p>
                )}
              </>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => handleGoogleSignIn(true)}
              disabled={isLoading || isEmailLoading || isLinkSending}
              className="w-full gap-2 border-solid font-sans tracking-normal normal-case"
            >
              <GoogleIcon />
              Continue with Google
            </Button>
            <div className="flex justify-center">
              <Link
                href="/auth/forgot-password"
                onClick={() => trackRecoveryOption("forgot_password")}
                className="text-xs text-muted hover:text-foreground"
              >
                Forgot password?
              </Link>
            </div>
          </section>
        )}

        {/* Sign up link */}
        <p className="mt-5 text-center text-xs text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href={signUpHref}
            className={cn(
              "font-medium text-foreground hover:underline",
              inviteLinkReplayClass(signUpHref),
            )}
          >
            Sign up
          </Link>
        </p>

        {/* Privacy */}
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
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  )
}
