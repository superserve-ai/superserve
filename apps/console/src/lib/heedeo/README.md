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
   pointer reaches, or focus enters, the sign-up card or a "Continue with
   Google" button on the sign-in page (`heedeoPreloadProps`), else at the
   action. Opening a page, or password sign-in, loads nothing.
2. At the action, the page calls `captureHeedeoSignup()` beside the other
   checks: email sign-up submit, "Continue with Google" on the sign-up page, and
   the Google sign-up check on the sign-in page. It calls `identify()` (billed
   per call) with a 3 s budget (2.5 s on the sign-in page) and writes the token,
   or why there is none, to the `superserve-heedeo-signup` cookie (`Path=/auth`,
   5 minutes, the token's lifetime). The sign-in page sends its proof request
   without waiting for the capture, and waits for it only before the trip to
   Google. Password sign-in captures nothing.
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
   `Heedeo signup observation outcome` log line.

The capture cookie belongs to the browser, not to one attempt. When two tabs
sign up at the same time, one attempt can send the other's token, or none.
Both tabs are the same browser, so the observed device is the same. A
Google sign-up whose account signs in again within the five-minute OAuth
window, before its first team exists, can send a second event.

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
  `x-forwarded-for` (never `cf-connecting-ip`), the browser headers identify
  reads, and only Heedeo's `_idd` cookie, never console cookies;
- back: `content-type`, `cache-control`, `etag`, `accept-ch`,
  `access-control-*`, and only an `_idd` Set-Cookie without a `Domain`;
- 64 KB request body, 1 MB response body, 2 KB query, 3 s, no redirects;
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

Use a separate Heedeo workspace for preview and staging deployments: test
sign-ups become history that later sign-ups are scored against.
