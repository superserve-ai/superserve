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

Templates are sent from server actions in `src/app/(auth)/auth/*/action.ts` through `src/lib/email/send.ts`. `EMAIL_TRANSPORT` picks the transport: `resend` (default, production) or `smtp` (`SMTP_HOST`, `SMTP_PORT` default 25, no auth; STARTTLS is used when the server offers it and needs a certificate that verifies). When SMTP is selected, nothing falls back to Resend. A missing SMTP host or failed delivery just means the email isn't sent.

## Private single-box environments

The console runs unchanged against a single private box. Every service listens
on `127.0.0.1` there and is reached through SSH (IAP) port forwarding. The box
differs from production only in configuration: the URL scheme, hosts and ports
below, plus the SMTP transport. There are no box-specific code paths.

### Build-time and runtime configuration

`NEXT_PUBLIC_*` values are inlined into the browser bundle by `next build`, so
build the console on the box with the box's values. Everything else is read at
runtime by the server and never reaches the browser.

| Variable                                                                                                                                             | Box value                             | When read |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------- |
| `NEXT_PUBLIC_APP_URL`                                                                                                                                | `http://localhost:3000`               | build     |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                                                                           | `http://localhost:54321`              | build     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                                                                                      | box anon key                          | build     |
| `NEXT_PUBLIC_SANDBOX_SCHEME`                                                                                                                         | `http`                                | build     |
| `NEXT_PUBLIC_SANDBOX_HOST`                                                                                                                           | `sandbox.localhost`                   | build     |
| `NEXT_PUBLIC_SANDBOX_PORT`                                                                                                                           | `8090`                                | build     |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`                                                                                                                     | site key, or empty to disable         | build     |
| `NEXT_PUBLIC_COOKIE_DOMAIN`                                                                                                                          | empty (host-only cookies)             | build     |
| `SANDBOX_API_URL`                                                                                                                                    | `http://localhost:8080`               | runtime   |
| `SUPABASE_SERVICE_ROLE_KEY`, `CONSOLE_PROXY_SECRET`, `INTERNAL_API_TOKEN`, `SANDBOX_INTERNAL_API_TOKEN`, `RECAPTCHA_API_KEY`, `RECAPTCHA_PROJECT_ID` | box secrets                           | runtime   |
| `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`                                                                                                          | `smtp`, `127.0.0.1`, `1025` (Mailpit) | runtime   |

The production defaults stay the same: with the sandbox variables unset, URLs
are `https://`/`wss://` on `sandbox.superserve.ai` with no port, and email goes
through Resend. Sandboxes whose IDs carry a non-default region (`sb-usw-…`)
always resolve to that region's production host.

### Port forwarding

Forward each port to the same port on your machine:

```bash
gcloud compute ssh <box> --zone <zone> --tunnel-through-iap -- -N \
  -L 3000:127.0.0.1:3000 \
  -L 8080:127.0.0.1:8080 \
  -L 54321:127.0.0.1:54321 \
  -L 8090:127.0.0.1:8090 \
  -L 8025:127.0.0.1:8025
```

| Local URL                                    | Service                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `http://localhost:3000`                      | Console                                        |
| `http://localhost:8080`                      | API                                            |
| `http://localhost:54321`                     | Auth and data gateway (`/auth/v1`, `/rest/v1`) |
| `http://<label>-<id>.sandbox.localhost:8090` | Sandbox proxy (terminal, files, preview)       |
| `http://localhost:8025`                      | Mailpit inbox                                  |

Keep the ports and the hostname unchanged. Open the console at
`http://localhost:3000`, not `127.0.0.1`:

- **Origins:** the box is built for the origin `http://localhost:3000`. The
  sandbox proxy only accepts terminal and file requests from that origin.
- **Callbacks:** confirmation and password-reset links in Mailpit point to
  `http://localhost:3000/auth/callback`. Billing redirects return to the same
  origin.
- **Cookies:** auth cookies are host-only for `localhost`, so a session started
  there isn't sent to `127.0.0.1`. Browsers treat
  `http://localhost` as a secure context, so `Secure` and `__Host-` cookies
  still work over plain HTTP.
- **Sandbox hosts:** Chrome and Firefox resolve `*.localhost` to loopback, so
  `boxd-<id>.sandbox.localhost:8090` reaches the forwarded proxy without DNS
  or `/etc/hosts` changes. Use one of those browsers.

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
