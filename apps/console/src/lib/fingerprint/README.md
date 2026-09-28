# Fingerprint signup evidence

Signup submission obtains a server-issued attempt and challenge before capture. The server resolves the event and checks its challenge before publishing evidence. Fingerprint failure does not reject Auth signup. The promotion backend owns eligibility and grants; a known visitor or successful signup never establishes that credit was awarded.

Configure `NEXT_PUBLIC_FINGERPRINT_API_KEY` for the browser agent and `FINGERPRINT_SECRET_API_KEY` for trusted server-side event lookup. `FINGERPRINT_SERVER_API_URL` defaults to the global Fingerprint Server API and can be overridden for regional workspaces.

Capture starts on submission, so time spent filling out the form does not age the event. Overlapping submissions share the result. A captured event retains its original attempt and challenge across retries. A lost attempt-creation response before capture may be retried with a fresh attempt. An ambiguous provider response after capture starts does not authorize replacing that attempt with a different event.

The server-only promotion adapter uses `PROMOTION_CAPTURE_TOKEN` for attempt creation and verification, `PROMOTION_ACCOUNT_TOKEN` for East account operations, and `PROMOTION_ACCOUNT_TOKEN_USWEST` for West account operations. These credentials must be distinct and must not reuse internal API tokens. `PROMOTION_ACCOUNT_PRIVATE_KEY` is an Ed25519 PKCS#8 PEM with actual newlines. Only Console holds the private key; each backend receives the matching raw 32-byte public key in standard base64.

Account reuse verifies the current Auth login before signing. Binding before email confirmation instead uses the trusted signup result. Region entry uses the original durable account evidence; it does not capture a new device or copy regional ownership. The creation adapter requires its caller to retain every server-derived creation field before sending the first request. Transport failure cannot authorize a direct insert or a replacement attempt.

Deploy shared Auth migrations and matching backend routes before activating enforcement. Readiness requires verification of every signup, provisioning and billing caller, signed interoperability, and both regions. Preserve canonical identity publication, independent signup restrictions and Checkout recovery throughout rollout.
