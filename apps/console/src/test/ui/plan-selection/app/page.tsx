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
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <PlanSelectionView
      step={step}
      cadence={cadence}
      busy={false}
      error={notice}
      onCadence={setCadence}
      onPro={() => setStep("payment-pending")}
      onEnterprise={() =>
        setNotice("Preview: sales scheduling opens in a new tab.")
      }
      onCheckPayment={() => setNotice("Preview: payment is still pending.")}
      onCancelPayment={() => {
        setStep("plans")
        setNotice(null)
      }}
    />
  )
}
