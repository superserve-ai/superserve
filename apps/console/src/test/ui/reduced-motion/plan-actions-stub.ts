"use client"

// Replaces the plan-offers server actions (they need Supabase and a billing
// API). None of them ever answers, so the plan picker stays in its loading
// state.
const never = () => new Promise<never>(() => {})

export const getTeamCatalogAction = never
export const canManageTeamBillingAction = never
export const getTrialOutcomeAction = never
export type TeamCatalog =
  import("@/lib/billing/plan-offers-actions").TeamCatalog
