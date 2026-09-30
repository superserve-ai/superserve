"use client"

import { Button, Input } from "@superserve/ui"
import { type ReactNode, useEffect, useState } from "react"

import {
  clearFingerprintSignupCapture,
  registerFingerprintGetData,
  type SignupFingerprintCapture,
} from "../../../lib/fingerprint/client"

export { Button, Input }

export const syntheticSignupValues = {
  fullName: "Synthetic account",
  email: "fixture@example.test",
  password: "synthetic-form-value",
  confirmPassword: "synthetic-form-value",
}

export const productionSignupCases = new Set([
  "ss640-email-idle",
  "ss640-email-loading",
  "ss640-email-confirmation",
  "ss640-email-captcha-error",
  "ss640-email-auth-error",
  "ss640-email-error-retry",
  "ss640-email-missing-capture",
  "ss640-email-failed-capture",
  "ss640-google-loading",
  "ss640-google-first-team",
  "ss640-google-recovery",
  "ss640-google-recovery-complete",
])

// Private diagnostics contain no form values and are not financial evidence.
export const signupTrace = {
  attempts: 0,
  captures: 0,
  submissions: [] as Array<SignupFingerprintCapture | undefined>,
}

const attempt = {
  attemptId: "synthetic-attempt",
  challenge: "synthetic-challenge",
}

function caseId() {
  return (
    new URLSearchParams(window.location.search).get("ui_case") ??
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("ss640-ui-case="))
      ?.slice("ss640-ui-case=".length) ??
    sessionStorage.getItem("ss640-ui-case")
  )
}

export async function createSignupFingerprintAttempt() {
  signupTrace.attempts += 1
  return attempt
}

export async function isCloudflareSignupObservationEnabled() {
  return false
}

export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
  _recaptcha?: string,
  _turnstile?: string,
  capture?: SignupFingerprintCapture,
) {
  if (
    email !== syntheticSignupValues.email ||
    password !== syntheticSignupValues.password ||
    name !== syntheticSignupValues.fullName
  )
    throw new Error("synthetic_form_state_not_initialized")
  signupTrace.submissions.push(capture ? { ...capture } : undefined)
  if (caseId() === "ss640-email-captcha-error") {
    return {
      success: false,
      error:
        "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
    }
  }
  if (
    caseId() === "ss640-email-auth-error" ||
    (caseId() === "ss640-email-error-retry" &&
      signupTrace.submissions.length === 1)
  ) {
    return {
      success: false,
      error: "Error creating account. Please try again.",
    }
  }
  // Simulate the action response only. Auth binding and email delivery are not
  // executed here and still require the runner's canonical action tests.
  return { success: true }
}

export async function beginGoogleSignup(): Promise<{
  success: boolean
  error?: string
  signupAttemptId?: string
}> {
  if (caseId() === "ss640-google-loading") return new Promise(() => {})
  return { success: true, signupAttemptId: "synthetic-oauth-attempt" }
}

export function createBrowserClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => ({ error: null }),
      signInWithOAuth: async ({
        options,
      }: {
        options: { redirectTo: string }
      }) => {
        const url = new URL(options.redirectTo)
        if (
          url.origin !== window.location.origin ||
          url.pathname !== "/auth/callback"
        )
          throw new Error("Synthetic OAuth must remain local")
        // The approved redirect contains no fixture query. Keep the case in
        // private session transport and use a same-origin cookie for the route.
        document.cookie = `ss640-ui-case=${encodeURIComponent(caseId() ?? "")}; Path=/; SameSite=Lax`
        window.location.assign(url.pathname + "/")
        return { error: null }
      },
    },
  }
}

export function usePostHog() {
  return { capture: () => {} }
}

// No third-party scripts may load in the isolated fixture runtime.
export default function SyntheticScript() {
  return null
}

export function SyntheticBrowserDependencies({
  children,
}: {
  children: ReactNode
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelPendingCapture: (() => void) | undefined
    let loginFillFrame: number | undefined
    // Each declared case is entered with a full navigation. StrictMode may
    // repeat this effect before interaction, which must not create an attempt.
    const requestedCase = new URLSearchParams(window.location.search).get(
      "ui_case",
    )
    if (requestedCase) sessionStorage.setItem("ss640-ui-case", requestedCase)
    if (requestedCase === "ss640-existing-email-login") {
      // The approved login case intentionally has no fill actions. Seed the
      // real controlled inputs through normal DOM input events with fixed
      // fixture values; the production submit handler remains authoritative.
      const fill = () => {
        const setValue = (selector: string, value: string) => {
          const input = document.querySelector<HTMLInputElement>(selector)
          if (!input) return false
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set
          setter?.call(input, value)
          input.dispatchEvent(new Event("input", { bubbles: true }))
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return true
        }
        return (
          setValue('input[placeholder="Email"]', syntheticSignupValues.email) &&
          setValue(
            'input[placeholder="Password"]',
            syntheticSignupValues.password,
          )
        )
      }
      // SignInPage is rendered by the child of this provider. The first
      // animation frame observes its mounted, editable controls.
      loginFillFrame = requestAnimationFrame(fill)
    }
    // The production client keeps the provider callback module-scoped so a
    // retry can reuse one capture. Reset that fixture seam at each isolated
    // navigation; otherwise a missing-capture case could inherit the prior
    // case's synthetic provider.
    registerFingerprintGetData(undefined)
    clearFingerprintSignupCapture()
    signupTrace.attempts = 0
    signupTrace.captures = 0
    signupTrace.submissions = []
    window.grecaptcha = {
      enterprise: {
        ready: (callback) => callback(),
        execute: async () => {
          if (caseId() === "ss640-email-captcha-error") {
            throw new Error("synthetic_captcha_unavailable")
          }
          return "synthetic-captcha"
        },
      },
    }
    if (caseId() !== "ss640-email-missing-capture") {
      registerFingerprintGetData(async (options) => {
        signupTrace.captures += 1
        if (options?.tag.signup_challenge !== attempt.challenge) {
          throw new Error("synthetic_challenge_mismatch")
        }
        if (caseId() === "ss640-email-loading") {
          // Keep the approved loading case pending while it is mounted, but
          // settle the synthetic provider when the runner navigates to the
          // next isolated case. Without this cleanup, the production capture
          // singleton would retain a never-ending promise across cases.
          return new Promise<{ event_id?: string }>((resolve) => {
            cancelPendingCapture = () => resolve({})
          })
        }
        if (caseId() === "ss640-email-failed-capture") {
          throw new Error("synthetic_provider_failure")
        }
        return { event_id: "synthetic-event" }
      })
    }
    setReady(true)
    return () => {
      if (loginFillFrame !== undefined) cancelAnimationFrame(loginFillFrame)
      cancelPendingCapture?.()
      registerFingerprintGetData(undefined)
      delete window.grecaptcha
    }
  }, [])
  return ready ? <>{children}</> : null
}
