export type Scenario = {
  kind: "signup" | "dashboard" | "west" | "login"
  state: "idle" | "loading" | "success" | "error" | "uncertain"
  message?: string
}

export const scenarios: Record<string, Scenario> = {
  "ss640-email-idle": { kind: "signup", state: "idle" },
  "ss640-email-loading": { kind: "signup", state: "loading" },
  "ss640-email-confirmation": { kind: "signup", state: "success" },
  "ss640-email-captcha-error": {
    kind: "signup",
    state: "error",
    message:
      "We couldn't load our bot-check. If you're using a content or ad blocker, please disable it for this site and try again.",
  },
  "ss640-email-auth-error": {
    kind: "signup",
    state: "error",
    message: "Error creating account. Please try again.",
  },
  "ss640-email-error-retry": { kind: "signup", state: "success" },
  "ss640-email-missing-capture": { kind: "signup", state: "success" },
  "ss640-email-failed-capture": { kind: "signup", state: "success" },
  "ss640-email-confirmed-entry": { kind: "dashboard", state: "success" },
  "ss640-google-loading": { kind: "signup", state: "loading" },
  "ss640-google-first-team": { kind: "dashboard", state: "success" },
  "ss640-google-recovery": { kind: "signup", state: "error" },
  "ss640-google-recovery-complete": { kind: "dashboard", state: "success" },
  "ss640-google-auth-error": {
    kind: "signup",
    state: "error",
    message: "Authentication Error",
  },
  "ss640-google-directory-error": {
    kind: "signup",
    state: "error",
    message: "Authentication Error",
  },
  "ss640-google-existing-replay": { kind: "dashboard", state: "success" },
  "ss640-east-loading": { kind: "dashboard", state: "loading" },
  "ss640-east-eligible": { kind: "dashboard", state: "success" },
  "ss640-east-duplicate": { kind: "dashboard", state: "success" },
  "ss640-east-missing-evidence": { kind: "dashboard", state: "success" },
  "ss640-east-registration-unavailable": {
    kind: "dashboard",
    state: "success",
  },
  "ss640-east-uncertain": { kind: "dashboard", state: "uncertain" },
  "ss640-east-uncertain-retry": { kind: "dashboard", state: "success" },
  "ss640-west-loading": { kind: "west", state: "loading" },
  "ss640-west-eligible": { kind: "west", state: "success" },
  "ss640-west-duplicate": { kind: "west", state: "success" },
  "ss640-west-missing-evidence": { kind: "west", state: "success" },
  "ss640-west-registration-unavailable": { kind: "west", state: "success" },
  "ss640-west-uncertain": { kind: "west", state: "uncertain" },
  "ss640-west-uncertain-retry": { kind: "west", state: "success" },
  "ss640-existing-email-login": { kind: "login", state: "success" },
  "ss640-existing-google-login": { kind: "dashboard", state: "success" },
  "ss640-email-repair-submit": { kind: "signup", state: "loading" },
  "ss640-email-repair-errors": {
    kind: "signup",
    state: "error",
    message: "Error creating account. Please try again.",
  },
  "ss640-email-repair-missing-capture": { kind: "signup", state: "success" },
  "ss640-google-repair-first-team": { kind: "dashboard", state: "success" },
  "ss640-google-repair-recovery": {
    kind: "signup",
    state: "error",
    message: "Complete signup",
  },
  "ss640-google-repair-existing-replay": {
    kind: "dashboard",
    state: "success",
  },
  "ss640-east-repair-eligible": { kind: "dashboard", state: "success" },
  "ss640-east-repair-zero-credit": { kind: "dashboard", state: "success" },
  "ss640-east-repair-authority-unavailable": {
    kind: "dashboard",
    state: "success",
  },
  "ss640-east-repair-uncertain-retry": { kind: "dashboard", state: "success" },
  "ss640-west-repair-eligible": { kind: "west", state: "success" },
  "ss640-west-repair-zero-credit": { kind: "west", state: "success" },
  "ss640-west-repair-authority-unavailable": { kind: "west", state: "success" },
  "ss640-west-repair-uncertain-retry": { kind: "west", state: "success" },
  "ss640-existing-login-repair-navigation": { kind: "login", state: "success" },
}
