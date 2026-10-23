"use client"

import { Button } from "@superserve/ui"

import { CornerBrackets } from "@/components/corner-brackets"
import { CARD_BONUS_USD, TRIAL_CREDIT_USD } from "@/lib/api/plan-catalog"

export function ClaimCreditView({
  busy,
  error,
  onAddCard,
  onSkip,
}: {
  busy: boolean
  error?: string | null
  onAddCard: () => void
  onSkip: () => void
}) {
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <p className="mb-10 font-mono text-xs tracking-[0.2em] text-brand uppercase">
          Superserve
        </p>
        <section className="relative border border-dashed border-border bg-surface p-6 sm:p-10">
          <CornerBrackets size="lg" />
          <p className="font-mono text-xs tracking-[0.12em] text-muted uppercase">
            You&apos;re approved
          </p>
          <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
            Add your payment to claim ${CARD_BONUS_USD} in free compute
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            You won&apos;t be charged. Usage beyond your credit is billed to
            this card at standard rates.
          </p>
          {error ? (
            <div
              role="alert"
              className="mt-6 border border-dashed border-destructive/50 p-4 text-sm"
            >
              {error}
            </div>
          ) : null}
          <Button
            className="mt-8 w-full"
            size="lg"
            disabled={busy}
            onClick={onAddCard}
          >
            Add payment method
          </Button>
          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-sm text-foreground underline underline-offset-4 disabled:opacity-50"
              disabled={busy}
              onClick={onSkip}
            >
              Continue with ${TRIAL_CREDIT_USD} trial credit
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
