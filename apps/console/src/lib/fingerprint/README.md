# Fingerprint signup evaluation

The browser captures an opaque Fingerprint event ID. The console resolves it once through Fingerprint's Server API and uses only the exact visitor ID returned for that event. The existing `auth_fingerprint_signup_observed` PostHog event records the observation; risk signals and returning-visitor flags do not determine signup policy.

The console passes the verified visitor ID to the signup restriction evaluator on the local provisioning cell. The backend owns the shared restriction file and effective mode:

| Mode            | Exact configured match | Signup result                                           |
| --------------- | ---------------------- | ------------------------------------------------------- |
| `off` (default) | Allowed                | Continue                                                |
| `observe`       | `would_deny`           | Record and continue                                     |
| `enforce`       | `blocked`              | Deny new standalone provisioning with a generic message |

An unmatched ID is allowed in every mode. Only a valid backend `blocked` response denies through this evaluator. The guard runs before the first standalone team, API key, or trial value is provisioned. Invites, existing-team use, and additional teams for completed accounts are outside this gate.

The server keeps one fixed-name, signed Fingerprint context for the active browser signup attempt. It binds at most one exact server-verified visitor ID to the actor and attempt for up to 600 seconds. Starting a new attempt supersedes the previous context, including across tabs; a late callback for the superseded attempt cannot overwrite the active context. Repeated callbacks for the same attempt reuse its verified visitor without extending the expiry. Denial or provisioning failure preserves valid active evidence for a retry against current policy; successful provisioning clears only the matching context. No policy verdict or prior-attempt visitor history is retained. Missing, expired, lost, or superseded evidence, Fingerprint lookup failure, and unavailable or invalid evaluator responses fail open. Google signup proof remains separate, and independent authentication, CAPTCHA, and Google signup-proof checks still apply.

Configure `NEXT_PUBLIC_FINGERPRINT_API_KEY` for the browser agent and `FINGERPRINT_SECRET_API_KEY` for the server lookup. `FINGERPRINT_SERVER_API_URL` defaults to the global Fingerprint Server API and can be overridden for regional workspaces. The evaluator uses the selected cell's server-only `INTERNAL_API_TOKEN` (or `INTERNAL_API_TOKEN_USWEST` for `usw`) and a 1500 ms request deadline. Console does not load or refresh restriction configuration.

Restriction telemetry records bounded outcomes, effective mode, and matched subject type without visitor IDs or other subject identifiers in event properties. Observation telemetry remains separate; telemetry failures cannot affect signup. Controlled browser/device correlation scenarios remain manual, and cross-account history is outside this integration.

## Promotion evidence

Promotion capture obtains an East-issued attempt and challenge before calling the
browser agent. The same server lookup used above verifies the provider event's
`tags.signup_challenge`, exact event ID, visitor ID, and timestamp before attesting
the attempt. The existing normalized observation remains intact. These promotion
checks are separate from the known-abuse restriction policy described above.

Email signup binds only the actual newly created Auth account and registers East
ownership before confirmation; a signed, actor-bound email proof can retry that
original association. Google carries verified evidence in the signed pre-auth
proof and binds only an account created after that proof. Older-account Google
recovery still retains restriction evidence but cannot replace promotion provenance.
Each region registers the original account evidence independently. See the Console
README for rollout configuration, fail-closed credit behavior, and durable retries.

## Diagnostic events

`auth_fingerprint_signup_<stage>` events use schema version 1 and record
`outcome` (`succeeded`, `rejected`, `unknown`, or `skipped`), an allowlisted
`reason`, and `occurred_at`. The existing observation event is unchanged.

| Stage                                        | Meaning of success                                                  |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `capture`                                    | Browser reports receiving an event ID; not server verification      |
| `lookup`                                     | Server validated the provider event response                        |
| `attestation`                                | Backend acknowledged the exact challenge/attempt verification       |
| `attachment`                                 | Backend acknowledged `bound` or `replayed` for this account/attempt |
| `identity_publication`, `device_publication` | That individual publication step completed                          |

`first_evidence_retained` skips attachment of the submitted replacement attempt.
Google recovery without original-signup provenance records a skipped attachment.
A lookup success does not imply attestation, attachment, or credit eligibility.
Timeouts and lost responses remain unknown; the remote operation may have completed.

Join `signup_attempt_id`, `capture_attempt_id`, and `provider_event_id` as links,
not interchangeable identities. A capture may be reused by multiple signup attempts.
Server attachment events add the Auth-derived `superserve_user_id`; later email
confirmation can link by capture attempt and user without a signup attempt ID.
`diagnostic_run_id` groups one boundary's events and is not a user identity.
Client-reported IDs and outcomes remain untrusted even when forwarded by the server.
Use `source` to distinguish `client_reported` from `server`, and `occurred_at`
rather than arrival order (client clocks can differ from server clocks).

Browser diagnostics travel separately on the existing signup request, with at
most eight rows. They are not sent if the user never submits or leaves before
submission. Older clients and unsupported report versions record missing diagnostics;
an absent event never establishes bot use, page skipping, or a browser blocker.
No new endpoint, provider retry, or eligibility input is introduced.

Each instrumented boundary schedules at most twelve allowlisted rows in one
post-response batch, also written as structured `Fingerprint signup diagnostics`
logs. PostHog delivery has a 1500 ms request timeout and no fetch retries. Raw
errors, cookies, challenges, signed proofs, visitor IDs, and provider payloads
are excluded from these diagnostic events. Scheduling/delivery failures are
ignored and can leave gaps in the trace.
