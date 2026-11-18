"use client"

import Script from "next/script"

import { HEEDEO_SCRIPT_SRC, markHeedeoScriptFailed } from "./client"

/**
 * Loads Heedeo's script from the console origin for `captureHeedeoSignup`.
 * Renders nothing when `NEXT_PUBLIC_HEEDEO_KEY` is unset. Loading identifies
 * nobody; only `identify()` at the sign-up action does (and is billed).
 */
export function HeedeoScript() {
  if (!HEEDEO_SCRIPT_SRC) return null
  return (
    <Script
      src={HEEDEO_SCRIPT_SRC}
      strategy="afterInteractive"
      onError={markHeedeoScriptFailed}
    />
  )
}
