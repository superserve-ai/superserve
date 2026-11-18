# Heedeo signup observation (observe-only)

Heedeo (https://docs.heedeo.com) scores who is behind a sign-up: the same
person across browsers and emails, the email, the network and the browser
environment. The console records Heedeo's answer next to the other sign-up
signals (reCAPTCHA, Cloudflare Turnstile, Fingerprint) so the signal can be
evaluated. Nothing reads the answer: no credit, trial, restriction, review or
authentication decision depends on it, and every failure fails open.

## Flow

1. The sign-up and sign-in pages load Heedeo's script from the console origin
   (`/api/dv/i.js`, see "First-party route" below).
2. At the action, the page calls `captureHeedeoSignup()` beside the other
   checks: email sign-up submit, "Continue with Google" on the sign-up page, and
   the Google sign-up check on the sign-in page. It calls `identify()` (billed
   per call) with a 3 s budget (2.5 s on the sign-in page) and writes the token,
   or why there is none, to the `superserve-heedeo-signup` cookie (`Path=/auth`,
   5 minutes, the token's lifetime). Password sign-in captures nothing.
3. The server reads and deletes that cookie and, after the response is sent,
   sends one `signup` event to `POST https://app.heedeo.com/v1/evaluations`:
   - email: from `signUpWithEmail`, with the email, the new user ID and
     `status` `succeeded` when this attempt created the account (else `failed`);
   - Google: from `/auth/callback` for a first-time Google account that passed
     the sign-up proof only, with `evidence.oauth.email_verified`. A returning
     account's capture is deleted unsent.

   No token (blocked script, timeout) still sends the event: Heedeo scores
   the email and network and adds the `no_token` note.

4. The answer goes to PostHog as `auth_heedeo_signup_observed` and to a
   `Heedeo signup observation outcome` log line.

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

The token, the email and request headers are not sent to PostHog.

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
- 64 KB request body, 1 MB response body, 2 KB query, 3 s, no redirects.

The script also has its own fallback to `https://heedeo.dev` (a warm-up
request and a backup identify after 1.5 s when the first-party call is slow
or fails), so some browsers still contact Heedeo's host directly.

## Configuration

| Variable                    | Where                | Purpose                                                                            |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_HEEDEO_KEY`    | browser (build time) | Publishable key `pk_...`. Unset: no script, no capture                             |
| `HEEDEO_SECRET_KEY`         | server only          | Secret key `sk_...` for the route and the evaluation. Unset: off                   |
| `HEEDEO_SIGNUP_OBSERVATION` | server               | `off` turns everything off (the route answers 404, so no identification is billed) |

Use a separate Heedeo workspace for preview and staging deployments: test
sign-ups become history that later sign-ups are scored against.
