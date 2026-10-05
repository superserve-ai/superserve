"use client"

interface BillingSessionResponse {
  id?: string
  url: string
}

function fixtureCase(): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("ss640-ui-case="))
    ?.slice("ss640-ui-case=".length)
}

async function readSession(
  response: Response,
): Promise<BillingSessionResponse> {
  const body = (await response.json()) as {
    url?: string
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(body.error?.message ?? response.statusText)
  }
  if (!body.url)
    throw new Error("Synthetic Checkout response was missing a URL")
  return { url: body.url }
}

export async function createStripeCheckoutSession(params: {
  successUrl: string
  cancelUrl: string
}): Promise<BillingSessionResponse> {
  // Keep this failure at the fixture service boundary. A rejected promise
  // exercises useBillingPayment's real error/toast path without making
  // Chromium report a failed HTTP resource in the console.
  if (fixtureCase() === "ss640-billing-evidence-unavailable-error") {
    throw new Error("Synthetic checkout unavailable")
  }

  const response = await fetch("/api/stripe/checkout-session/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    }),
  })
  return readSession(response)
}

export async function createStripeCustomerPortalSession(params: {
  returnUrl: string
}): Promise<BillingSessionResponse> {
  const response = await fetch("/api/stripe/customer-portal-session/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ return_url: params.returnUrl }),
  })
  return readSession(response)
}
