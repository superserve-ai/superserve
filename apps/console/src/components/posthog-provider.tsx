"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import type React from "react";

if (typeof window !== "undefined") {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  if (apiKey) {
    try {
      posthog.init(apiKey, {
        api_host: host,
        person_profiles: "always",
        capture_pageview: false,
        capture_pageleave: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-mask]",
        },
      });
    } catch (error) {
      console.warn("PostHog failed to initialize:", error);
    }
  }
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }
  return <PHProvider client={posthog}>{children}</PHProvider>;
}
