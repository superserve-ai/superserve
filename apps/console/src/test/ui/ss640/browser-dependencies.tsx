"use client"

import { Button, Input as ConsoleInput } from "@superserve/ui"
import {
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import {
  clearFingerprintSignupCapture,
  registerFingerprintGetData,
  type SignupFingerprintCapture,
} from "../../../lib/fingerprint/client"

export { Button }

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
  return new URLSearchParams(window.location.search).get("ui_case")
}

export async function createSignupFingerprintAttempt() {
  signupTrace.attempts += 1
  return attempt
}

export async function isCloudflareSignupObservationEnabled() {
  return false
}

export async function signUpWithEmail(
  _email: string,
  _password: string,
  _name: string,
  _recaptcha?: string,
  _turnstile?: string,
  capture?: SignupFingerprintCapture,
) {
  signupTrace.submissions.push(capture ? { ...capture } : undefined)
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
  return {
    success: false,
    error: "Synthetic OAuth is not configured for this case.",
  }
}

export function createBrowserClient() {
  return {
    auth: {
      signInWithOAuth: async () => ({
        error: { message: "Synthetic OAuth only" },
      }),
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

export function Input(props: ComponentProps<typeof ConsoleInput>) {
  const seeded = useRef(false)
  const { onChange, placeholder } = props
  useLayoutEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const value = placeholder?.includes("Password")
      ? "synthetic-form-value"
      : "Synthetic account"
    onChange?.({ target: { value } } as ChangeEvent<HTMLInputElement>)
  }, [onChange, placeholder])

  // Seed React state through the original callbacks, never through DOM edits.
  // The real control preserves its styles/errors; credential values stay private.
  return (
    <ConsoleInput
      {...props}
      type="text"
      value=""
      readOnly
      autoComplete="off"
      onChange={undefined}
    />
  )
}

export function SyntheticBrowserDependencies({
  children,
}: {
  children: ReactNode
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Each declared case is entered with a full navigation. StrictMode may
    // repeat this effect before interaction, which must not create an attempt.
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
        if (caseId() === "ss640-email-loading")
          return new Promise<{ event_id?: string }>(() => {})
        if (caseId() === "ss640-email-failed-capture") {
          throw new Error("synthetic_provider_failure")
        }
        return { event_id: "synthetic-event" }
      })
    }
    setReady(true)
    return () => {
      delete window.grecaptcha
    }
  }, [])
  return ready ? <>{children}</> : null
}
