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

## Signup device evidence and retry

Users created before the `PROMOTION_SIGNUP_EVIDENCE_SINCE` boundary retain
ordinary missing-evidence behavior.
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
