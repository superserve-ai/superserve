# @superserve/console

Next.js 16 App Router console for managing Superserve sandboxes.

## Development

Run from the repo root.

```bash
# Dev server — http://localhost:3001
bun --filter @superserve/console run dev

# Email template preview — http://localhost:3002
bun --filter @superserve/console run email:dev

# Lint, typecheck, test
bun --filter @superserve/console run lint
bun --filter @superserve/console run typecheck
bun --filter @superserve/console run test
```

## Email templates

Located at `src/lib/email/templates/`:

- `welcome.tsx`
- `confirmation.tsx`
- `password-reset.tsx`
- `components/email-layout.tsx` — shared layout (header, footer, fonts)

The `email:dev` script boots a [React Email](https://react.email) preview server with hot reload, multi-client previews (Gmail, Apple Mail, Outlook), dark mode toggle, and a "Send test" button that uses Resend if `RESEND_API_KEY` is set.

Templates are sent in production via Resend from server actions in `src/app/(auth)/auth/*/action.ts`.

## Promotion identity rollout

The regional `upsert_profile_with_promotion_identity` function and the billing
`POST /stripe/checkout-session/recover` route must be deployed in every target
cell before deploying this Console version. The Console publishes authenticated
Auth observations when provisioning teams and before new Checkout generations;
profile and evidence are committed by one regional database function. Pinned
Checkout recovery uses the backend route and retains the original actor and
evidence when a new observation is unavailable.

Deploy the producer to every cell and verify existing-user, pending Checkout,
and historical reconciliation readiness before the separate backend activation
of canonical enforcement. Activation is operator controlled; this Console does
not enable it. After activation, rollback must retain a Console version that
publishes this evidence on every claim path.

## Signup device evidence and retry rollout

Deploy the backend contract from sandbox commit `ed83f5f122fb61bc03995af8952afc8ba00677b3`
(or a descendant containing those changes) in both enabled cells first. It adds
`register-signup`, durable team prepare/recover/complete operations, and
`/stripe/checkout-session/publication-decision`. Older cells are not a supported
fallback. Backend credit flags remain independent and operator controlled.

Before promoting this Console build, set `PROMOTION_SIGNUP_EVIDENCE_SINCE` to the
fixed UTC rollout boundary and retain that value on every later deployment.
Set the distinct capture/account producer tokens, Ed25519 account signing key,
and `GOOGLE_SIGNUP_PROOF_SECRET`. Production builds validate these prerequisites;
other deployment systems must run `REQUIRE_PROMOTION_CONFIG=1 bun run check:promotion-config`
with the effective deployment environment. Keep the receipt signing secret stable
while outstanding Checkouts may need recovery. Never print these credentials.

Users created before the boundary retain ordinary missing-evidence behavior.
There is no backfill. For new users, successfully persisted routine absence is
separate from a failed or unknown original association. The latter denies only
automatic credit, including when the backend's evidence-required flag is off.
Successfully bound original evidence can recover an uncertain association through
authenticated lookup; ordinary login cannot attach a replacement capture. Small
server-only Auth metadata markers record this distinction, not eligibility or a
signup continuation workflow.

Initial East team creation reserves the Auth-assigned UUID as its operation
locator. Explicit creation retains a distinct actor/region-scoped locator in
session storage before dispatch. Recovery uses the backend's original tuple and
never recomputes its credit decision. Partial membership writes remain retryable;
fixed membership and owner-assignment IDs prevent replay from replacing revoked
rows. Deleted teams are never recreated by replay. Only a confirmed name collision
allows an edited-name submission to start another intent. Lost-locator discovery
returns candidates without automatically selecting one; support must explicitly
select the intended operation, including when only one candidate exists.

Checkout first recovers an existing session. For new creation, the server signs
its publication decision and exact payer/team/region/redirects; the browser must
retain that receipt before financial dispatch. Replays renew backend authentication
without changing the decision. Publication failure permits paid access through
the backend's no-credit path. A conflict prompts an explicit next-click request
for a new intent, retaining the previous receipt; backend subscription and
reservation fences still decide whether it can proceed. Network/server failures
retain the identical intent. Cancellation revokes the activation promotion on
the backend. Neither billing nor West entry captures another Fingerprint event.
