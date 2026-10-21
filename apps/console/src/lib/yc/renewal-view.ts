export type RenewalChoice = "annual" | "monthly" | "free"
export interface RenewalInstructionView {
  choice: RenewalChoice
  terms: string
  boundary: string
}
export interface RenewalView {
  confirmed: RenewalInstructionView | null
  requested:
    | (RenewalInstructionView & {
        state:
          | "prepared"
          | "dispatched"
          | "outcome_unknown"
          | "confirmed"
          | "review_required"
          | "rejected"
      })
    | null
  options: Array<
    RenewalInstructionView & { available: boolean; unavailableReason?: string }
  >
  successor: "none" | "payment_pending" | "active" | "free" | "review_required"
}
export const renewalLabels = {
  annual: "Pro Annual",
  monthly: "Pro Monthly",
  free: "Free",
}
