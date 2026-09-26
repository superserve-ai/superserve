# Fingerprint signup evaluation

The browser captures an opaque Fingerprint event ID. The console resolves it once through Fingerprint's Server API and uses only the exact visitor ID returned for that event. The existing `auth_fingerprint_signup_observed` PostHog event records the observation; risk signals and returning-visitor flags do not determine signup policy.

SS-499 passes the verified visitor ID to the SS-627 signup restriction evaluator on the local provisioning cell. The backend owns the shared restriction file and effective mode:

| Mode            | Exact configured match | Signup result                                           |
| --------------- | ---------------------- | ------------------------------------------------------- |
| `off` (default) | Allowed                | Continue                                                |
| `observe`       | `would_deny`           | Record and continue                                     |
| `enforce`       | `blocked`              | Deny new standalone provisioning with a generic message |

An unmatched ID is allowed in every mode. Only a valid backend `blocked` response denies through this evaluator. The guard runs before the first standalone team, API key, or trial value is provisioned. Invites, existing-team use, and additional teams for completed accounts are outside this gate.

The server keeps one fixed-name, signed Fingerprint context for the active browser signup attempt. It binds at most one exact server-verified visitor ID to the actor and attempt for up to 600 seconds. Starting a new attempt supersedes the previous context, including across tabs; a late callback for the superseded attempt cannot overwrite the active context. Repeated callbacks for the same attempt reuse its verified visitor without extending the expiry. Denial or provisioning failure preserves valid active evidence for a retry against current policy; successful provisioning clears only the matching context. No policy verdict or prior-attempt visitor history is retained. Missing, expired, lost, or superseded evidence, Fingerprint lookup failure, and unavailable or invalid evaluator responses fail open. Google signup proof remains separate, and independent authentication, CAPTCHA, and Google signup-proof checks still apply.

Configure `NEXT_PUBLIC_FINGERPRINT_API_KEY` for the browser agent and `FINGERPRINT_SECRET_API_KEY` for the server lookup. `FINGERPRINT_SERVER_API_URL` defaults to the global Fingerprint Server API and can be overridden for regional workspaces. The evaluator uses the selected cell's server-only `INTERNAL_API_TOKEN` (or `INTERNAL_API_TOKEN_USWEST` for `usw`) and a 1500 ms request deadline. Console does not load or refresh restriction configuration.

Restriction telemetry records bounded outcomes, effective mode, and matched subject type without visitor IDs or other subject identifiers in event properties. Observation telemetry remains separate; telemetry failures cannot affect signup. Controlled browser/device correlation scenarios remain manual, and cross-account history is outside this integration.
