# YC Console integration

All three server flags default off: `YC_CONSOLE_JOURNEY_ENABLED`,
`YC_CONSOLE_RENEWAL_ENABLED`, and `YC_STAFF_UI_ENABLED`. Source deployment alone
must not enable them.

The customer adapters use the authenticated claim owner, current authorized
team, and claim home region. Claims in URLs are locators only. The existing
server `PROMOTION_ACCOUNT_PRIVATE_KEY` signs short-lived, audience-separated
assertions bound to the exact method, path, and body. The backend must enforce
live permissions and immutable approval/terms revisions on every request.

Acceptance uses `/internal/yc/account/offers/{offer,accept,status,review}`;
renewal uses `/internal/yc/account/renewals/{status,submit}`. A successful offer
read may save a disclosure, but never accepts it. Existing contracts fall back
to the legacy claim status flow when new-signup admission rejects them. Unknown
mutation outcomes retain the same request identity. Only authoritative
`funding_ready` with acceptance, assignment, operation, and ready evidence
shows usable access. Holds and revocations override readiness.

Preferred-account review sends the original verification link only in the
server-action body, never in navigation or browser storage. Staff decisions
pin the preferred review request and revision. Staff signing additionally
requires a fresh, session-bound Google proof obtained by the dedicated PKCE
reauthentication path; linked provider metadata is insufficient. The proof
expires after 15 minutes, is stored in a secure HttpOnly host cookie, and uses
a separate signing purpose. The backend remains the live RBAC authority.

Before enabling, verify the deployed backend DTOs and assertion keys/audiences,
preferred-identity approval and resume, actual Google callback/session
revocation behavior, exact terms and revisions, uncertain/replayed operations,
and readiness from real provider/funding reconciliation. Renewal must resolve
the original provider boundary and expose only approved catalog choices;
requested choices do not replace the last confirmed instruction. An instruction
remains `confirmed` after the boundary; `successor_state` separately reports
`active`, `free`, or `payment_pending`. There is no `effective` instruction
state in this contract. Preserve
existing debt and payment gates. Local fixtures and UI previews do not prove
any of these runtime integrations.

`YC_CLAIM_WEBSITE_URL` optionally sets the server-side HTTPS website origin for
Submit verification. The path is always `/yc`. Unset preserves
`https://www.superserve.ai/yc`; invalid or empty values disable the link instead
of falling back to production. Credentials, paths, queries, and fragments are
not allowed. Configure the capture website's own API target and reciprocal
Console link separately; this setting changes neither API calls nor email
confirmation destinations.
