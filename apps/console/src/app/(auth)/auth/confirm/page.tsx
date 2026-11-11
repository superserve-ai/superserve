import { EnvelopeSimpleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@superserve/ui"
import type { Metadata } from "next"
import { cookies } from "next/headers"
import Image from "next/image"
import Link from "next/link"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import {
  decodePendingEmailLink,
  EMAIL_LINK_CALLBACK_PATH,
  EMAIL_LINK_CSRF_FIELD,
  emailLinkCookieName,
  isEmailLinkType,
  type EmailLinkType,
} from "@/lib/auth/email-link-confirm"

export const metadata: Metadata = { title: "Continue" }

const COPY: Record<EmailLinkType, { title: string; body: string }> = {
  signup: {
    title: "Confirm your email",
    body: "Press Continue to confirm your email and finish creating your account.",
  },
  recovery: {
    title: "Reset your password",
    body: "Press Continue to choose a new password.",
  },
  magiclink: {
    title: "Sign in to Superserve",
    body: "Press Continue to finish signing in.",
  },
  invite: {
    title: "Accept your invitation",
    body: "Press Continue to finish signing in.",
  },
  email: {
    title: "Sign in to Superserve",
    body: "Press Continue to finish signing in.",
  },
}

const FALLBACK_COPY = {
  title: "Continue to Superserve",
  body: "Press Continue to finish.",
}

export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { retry } = await searchParams
  const jar = await cookies()
  // The callback sets the __Host- name over HTTPS and the plain name in local
  // HTTP development.
  const pending = decodePendingEmailLink(
    jar.get(emailLinkCookieName(true))?.value ??
      jar.get(emailLinkCookieName(false))?.value,
  )
  const type = pending ? new URLSearchParams(pending.query).get("type") : null
  const copy = isEmailLinkType(type) ? COPY[type] : FALLBACK_COPY

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
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

        {pending ? (
          <form
            method="post"
            action={EMAIL_LINK_CALLBACK_PATH}
            className="flex flex-col items-center"
          >
            <EnvelopeSimpleIcon
              className="mb-3 size-8 text-muted"
              weight="light"
            />
            <h1 className="text-center text-sm font-medium text-foreground">
              {copy.title}
            </h1>
            <p className="mt-2 text-center text-xs text-muted">{copy.body}</p>
            {retry === "1" && (
              <p role="alert" className="mt-2 text-center text-xs text-muted">
                We could not check that request. Press Continue again.
              </p>
            )}
            <input
              type="hidden"
              name={EMAIL_LINK_CSRF_FIELD}
              value={pending.csrf}
            />
            <Button type="submit" size="sm" className="mt-5">
              Continue
            </Button>
          </form>
        ) : (
          <div className="flex flex-col items-center">
            <WarningIcon className="mb-3 size-8 text-muted" weight="light" />
            <h1 className="text-center text-sm font-medium text-foreground">
              Open your email link again
            </h1>
            <p className="mt-2 text-center text-xs text-muted">
              This step expired or was opened in another browser. Open the link
              from your email again in this browser.
            </p>
            <Button
              render={<Link href="/auth/signin" />}
              size="sm"
              className="mt-5"
            >
              Go to sign in
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
