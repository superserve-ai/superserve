# Heedeo signup observation (observe-only)

Heedeo (https://docs.heedeo.com) scores who is behind a sign-up: the same
person across browsers and emails, the email, the network and the browser
environment. The console records Heedeo's answer next to the other sign-up
signals (reCAPTCHA, Cloudflare Turnstile, Fingerprint) so the signal can be
evaluated. Nothing reads the answer: no credit, trial, restriction, review or
authentication decision depends on it, and every failure fails open.

## Flow

1. The script loads from the console origin (`/api/dv/i.js`, see
   "First-party route" below), not with the page: once loaded, it identifies
   the browser in the background ahead of `identify()`. It loads when the
   pointer reaches, or focus enters, the email sign-up form or a Google button
   on the sign-up page (`heedeoPreloadProps`), else at the action. The sign-in
   page loads it only when "Continue with Google" is clicked. Opening a page,
   or password sign-in, loads nothing.
2. At the action, the page calls `captureHeedeoSignup()` beside the other
   checks: email sign-up submit, "Continue with Google" on the sign-up page, and
   the Google sign-up check on the sign-in page. It calls `identify()` (billed
   per call) with a 3 s budget (2.5 s on the sign-in page) and writes the token,
   or why there is none, to the `superserve-heedeo-signup` cookie (`Path=/auth`,
   5 minutes, the token's lifetime). Both pages send the Google proof request
   without waiting for the capture, and wait for it only after the proof
   succeeds, before the trip to Google. The email sign-up server call has to
   read the cookie, so it waits for the capture, but at most 1 s
   (`HEEDEO_SIGNUP_TAIL_MS`) after the other checks finish; past that,
   `settleHeedeoSignup` records `identify_timeout` (or the script status) and
   drops the late token. An attempt that stops before its server call or the
   trip to Google (a missing or refused bot-check, an error, a cancelled
   check, a page that unmounts) aborts its capture: if `identify()` has not
   started, it does not start, and no cookie is written. Password sign-in
   captures nothing.
3. The server reads and deletes that cookie and, after the response is sent,
   sends one `signup` event to `POST https://app.heedeo.com/v1/evaluations`:
   - email: from `signUpWithEmail`, with the email and `status` `succeeded`
     only when this attempt created the account (a held Enterprise account
     counts), with its user ID. A refusal, an error, or a retry for an older
     unconfirmed account is `failed` and has no user ID, because the browser
     has not proved it owns that account;
   - Google: from `/auth/callback` for a Google account that passed the
     sign-up proof and was created by this attempt, with
     `evidence.oauth.email_verified`. `status` is `failed` when the sign-up
     restriction check refuses it. A returning account's capture, or that of
     an account that comes back before its team exists, is deleted unsent.

   No token (blocked script, timeout) still sends the event: Heedeo scores
   the email and network and adds the `no_token` note.

4. The answer goes to PostHog as `auth_heedeo_signup_observed` and to a
   `Heedeo signup observation outcome` log line. The log line has the
   summary fields, `signup_attempt_id` and `superserve_user_id` included, so
   the evidence can be found from an account without PostHog. The user ID is
   set only when this attempt created the account.
5. A Google capture that the callback deletes unsent (a returning account)
   goes to PostHog as `auth_heedeo_capture_discarded`: its identify call was
   still made. See "Identify usage" below.

The capture cookie belongs to the browser, not to one attempt. When two tabs
sign up at the same time, one attempt can send the other's token, or none.
Both tabs are the same browser, so the observed device is the same. A
Google sign-up whose account signs in again within the five-minute OAuth
window, before its first team exists, can send a second event.
A tab that loaded the script before the kill switch was set can still send
a backup identify to `https://heedeo.dev` when the first-party call is slow.
Revoking the publishable key in Heedeo's dashboard stops that too.
Once loaded on the sign-up page, the script stays in the tab: a client-side
move to another page, such as sign-in, does not unload it, so its background
identification (see below) can still run there.

## Identify usage

Heedeo's docs say one identification is one `identify()` call and page loads
are free. They do not say whether the script's background identification
(below) counts. Confirm both in a staging workspace before relying on them.

- `identify()` runs once per sign-up action: an email sign-up submit, a
  Google button on the sign-up page, and "Continue with Google" on the sign-in
  page. The last one runs before Google says who the user is, so it also runs
  for returning accounts, whose capture the callback deletes unsent. In the
  six days to 2026-11-18, the sign-in page ran 93 Google sign-up checks and the
  sign-up page 36, for 86 new Google accounts: most Google sign-ups start on
  the sign-in page, so it keeps the capture. Telling a new account apart
  before the trip to Google needs a larger change.
- The script, once loaded, identifies in the background on load, then
  again every 3 minutes while the tab is visible and on a return to the tab,
  at most 10 more times per tab (about 30 minutes). It loads only on sign-up
  intent (see Flow).
- Compare Heedeo's usage (dashboard, or `get_usage` on its MCP server)
  with unique `signup_attempt_id`s and new accounts, not with
  `auth_heedeo_signup_observed` alone: add `auth_heedeo_capture_discarded`
  for returning accounts. Count only events whose `capture_status` is not
  `script_failed` or `script_timeout`: with those, `identify()` never ran.
  The rest of the gap is Google trips that were
  never finished and background identification, if it is billed.
- Heedeo documents no spend cap or usage alert, only rate limits (120 a
  minute per end-user address, 6,000 a minute per workspace). Over quota,
  the script does not load or `identify()` rejects, which fails open here.
  The local route cannot limit calls sent straight to Heedeo's own hosts.

## PostHog `auth_heedeo_signup_observed`

Distinct ID: the new user ID, else the sign-up attempt ID.

| Property                                                                                                              | Meaning                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `mode`                                                                                                    | `heedeo`, `observe`                                                                                                                                                                                                        |
| `signup_attempt_id`, `signup_method`, `signup_status`, `superserve_user_id`                                           | Join keys with the other provider events                                                                                                                                                                                   |
| `capture_status`                                                                                                      | Browser result: `ok`, `script_failed`, `script_timeout`, `identify_timeout`, `identify_error`, `invalid_response`, or `absent` (no cookie). Client-reported, so untrusted                                                  |
| `capture_latency_ms`, `token_present`                                                                                 | Browser timing, and whether a token was sent                                                                                                                                                                               |
| `provider_outcome`                                                                                                    | `success`, `http_<status>`, `timeout`, `malformed`, `error`                                                                                                                                                                |
| `provider_http_status`, `provider_error_code`, `provider_trace_id`, `provider_latency_ms`, `provider_attempts`        | Call details (quote `provider_trace_id` to Heedeo support)                                                                                                                                                                 |
| `heedeo_event_id`, `heedeo_visitor_id`, `visitor_confidence`                                                          | Heedeo's event and person                                                                                                                                                                                                  |
| `flagged`, `flag`, `no_token`, `score`, `threshold`, `band`, `decision_risk`, `decision_by`, `listed`, `reason_codes` | Heedeo's verdict, flattened for queries                                                                                                                                                                                    |
| `heedeo_response`                                                                                                     | The documented answer (`reasons` with text and weights, `risks`, `visitor`, `related`, `account`, `counts`, `activity`, `email`, `network`, `agent`, `environment`, ...), bounded in size; undocumented fields are dropped |
| `api_version`, `observed_at`                                                                                          | `heedeo-version` sent, and time                                                                                                                                                                                            |

The token, the email and request headers are not sent to PostHog. The
script also keeps the token and the visitor ID in its own `_idt` and `_idd`
cookies (`Path=/`). The capture deletes `_idt` when `identify()` settles, and
the `/ingest` analytics rewrite drops both (`HEEDEO_BROWSER_COOKIES` in
`middleware.ts`), as the script can write `_idt` again later.

## First-party route

`app/api/dv/[...path]/route.ts` serves Heedeo's two public paths from the
console origin, as Heedeo documents for "your own server" (section 2 of the
docs). The script posts identify relative to its own URL, so both stay
first-party. `lib/heedeo/proxy.ts` limits the route:

- fixed upstream `https://app.heedeo.com`; only `GET /i.js` and
  `POST|OPTIONS /v1/identify`; any other path is a local 404;
- up: the secret key, the visitor IP from Vercel's `x-real-ip` /
  `x-forwarded-for`, read only when `VERCEL` is set (never `cf-connecting-ip`; off Vercel the route answers 503), the browser headers identify
  reads, and only Heedeo's `_idd` cookie, never console cookies;
- back: `content-type`, `cache-control`, `etag`, `accept-ch`,
  `access-control-*`, and only an `_idd` Set-Cookie without a `Domain`;
- 64 KB request body, 1 MB response body, 2 KB query, 3 s, no redirects; a
  key or header value that is not valid also fails open with 502;
- the script is sent with `cache-control: no-cache`, so the browser
  revalidates it on each load. Its `i.js?m=1` marker, which the script reads
  back from the browser cache, keeps Heedeo's cache policy.

The script also has its own fallback to `https://heedeo.dev` (a warm-up
request and a backup identify after 1.5 s when the first-party call is slow
or fails), so some browsers still contact Heedeo's host directly. It does
not fall back after a 403, so the kill switch answers 403 rather than 404.

## Configuration

| Variable                    | Where                | Purpose                                                                            |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_HEEDEO_KEY`    | browser (build time) | Publishable key `pk_...`. Unset: no script, no capture                             |
| `HEEDEO_SECRET_KEY`         | server only          | Secret key `sk_...` for the route and the evaluation. Unset: off                   |
| `HEEDEO_SIGNUP_OBSERVATION` | server               | `off` turns everything off (the route answers 403, so no identification is billed) |

Production and staging use separate Heedeo workspaces: test sign-ups become
history that later sign-ups are scored against. Preview and Development must
use the staging workspace keys, never the production ones.

### Where the variables are set

| Place                                     | `NEXT_PUBLIC_HEEDEO_KEY` | `HEEDEO_SECRET_KEY`              | `HEEDEO_SIGNUP_OBSERVATION`       |
| ----------------------------------------- | ------------------------ | -------------------------------- | --------------------------------- |
| Vercel Production                         | production workspace     | production workspace (sensitive) | `off` until staging proves it out |
| Vercel Preview and Development            | staging workspace        | staging workspace (sensitive)    | unset (observation on)            |
| `turbo.json` `build.env`                  | yes                      | yes                              | yes                               |
| `apps/console/.env.example` (local)       | yes                      | yes                              | yes                               |
| `src/test/ui/ss640/next.config.ts` (test) | empty                    | no                               | no                                |

- Vercel builds the console with `turbo run build`. Turbo runs in strict env
  mode, so `next build` sees only the variables that `turbo.json` declares
  (and the `NEXT_PUBLIC_*` names that Turbo infers for Next.js). Declare every
  new variable there, as for the Fingerprint, Turnstile and reCAPTCHA keys.
- In each Vercel environment, use the publishable and the secret key of the
  same workspace, so each evaluation reads a token from its own workspace.
- `NEXT_PUBLIC_HEEDEO_KEY` is inlined into the browser bundle by `next build`.
  Redeploy after a change: a running deployment keeps the old value.
- To turn Production on, remove `HEEDEO_SIGNUP_OBSERVATION=off` from Production
  after the staging checks below pass, and deploy.
- `HEEDEO_SECRET_KEY` and `HEEDEO_SIGNUP_OBSERVATION` are read at request time
  in `config.ts`, which imports `server-only`, so a client import fails the
  build. The secret key never has a `NEXT_PUBLIC_` name. A change applies to the
  next deployment.
- CI builds and tests without any provider key, as for the other sign-up
  signals, so `.github/workflows` sets none. The repository has no Dockerfile,
  docker-compose, Helm, Terraform or Fly manifest and no `vercel.json` for the
  console, and the console reads these values from `process.env` directly,
  without a schema, as the other providers do.

Before Production is turned on, on a Preview deployment with the staging
workspace keys:

- check that an email sign-up, a Google sign-up and a sign-up with no token
  each give an `auth_heedeo_signup_observed` event and log line with the
  right `superserve_user_id`;
- check that a returning Google sign-in, repeated navigation and visibility
  changes, and the kill switch change Heedeo's usage as described above;
- agree a quota or budget and a usage alert with Heedeo.

A high score or a matching visitor ID is a reason to look, not proof of
abuse. `token_present` and `no_token` tell a tokenless evaluation apart from
one backed by a device.
