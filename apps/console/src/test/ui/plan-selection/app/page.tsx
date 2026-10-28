"use client"

import { useState } from "react"

import {
  PlanSelectionView,
  type PlanCadence,
  type PlanStep,
} from "@/components/onboarding/plan-selection-view"

// Isolated visual fixture: no account, payment, or network mutation.
export default function Page() {
  const [step, setStep] = useState<PlanStep>("plans")
  const [cadence, setCadence] = useState<PlanCadence>("annual")
  const [selection, setSelection] = useState<"free" | "pro">("pro")
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <PlanSelectionView
      step={step}
      cadence={cadence}
      selection={selection}
      busy={false}
      error={notice}
      onCadence={(value) => {
        setCadence(value)
        setSelection("pro")
      }}
      onFree={() => setStep("free-billing")}
      onPro={() => setStep("payment-pending")}
      onEnterprise={() =>
        setNotice("Preview: sales scheduling opens in a new tab.")
      }
      onAddCard={() => setNotice("Preview: open PAYG billing.")}
      onSkip={() => setNotice("Preview: continue with $5 trial credit.")}
      onBack={() => {
        setStep("plans")
        setNotice(null)
      }}
      onCheckPayment={() => setNotice("Preview: payment is still pending.")}
      onCancelPayment={() => {
        setStep("plans")
        setNotice(null)
      }}
    />
  )
}
