// Internal classification only; never infer recovery policy from upstream text.
export class SignupSetupBlockedError extends Error {
  constructor(
    readonly reason: "account_changed" | "impersonation" | "team_changed",
  ) {
    super(
      reason === "account_changed"
        ? "Your account changed. Sign in to the account that started checkout."
        : reason === "team_changed"
          ? "Your active team changed. Reload to continue."
          : "Plan setup is unavailable during impersonation",
    )
    this.name = "SignupSetupBlockedError"
  }
}
