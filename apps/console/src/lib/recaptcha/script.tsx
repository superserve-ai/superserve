"use client"

import Script from "next/script"

import { markRecaptchaScriptFailed, RECAPTCHA_SITE_KEY } from "./client"

/**
 * Loads reCAPTCHA Enterprise for `getRecaptchaToken`. Every page that loads
 * the script uses this component: Next.js loads a script src only once per
 * document and calls only the first loader's `onError`, so a failure on one
 * auth page must be recorded there for the next page to see it.
 */
export function RecaptchaScript() {
  if (!RECAPTCHA_SITE_KEY) return null
  return (
    <Script
      src={`https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`}
      strategy="afterInteractive"
      onError={markRecaptchaScriptFailed}
    />
  )
}
