# Enterprise pending-review meeting

A held Enterprise applicant should see their existing meeting and a Change or reschedule link after booking, including on later sign-ins. Scheduling never approves access. Free signup/banner copy is outside this change.

The pending page still signs the user out and preserves the existing review gate. Auth callback and the protected-route middleware issue a purpose-bound, HTTP-only, one-day meeting-context cookie after verifying the user. It authorizes only a meeting lookup. The unsigned profile cookie remains prefill, not identity. The server verifies the context, reads the current confirmed held account from Auth, and uses that account's current verified email. A different live session cannot use the old context. Missing/expired context asks for sign-in through the protected root, which issues fresh context. Missing configuration fails closed; it does not imply no booking.

Calendly is the durable booking store. Every pending-page read queries active scheduled events for the verified invitee email in the configured organization, filters the exact Enterprise event type, and checks an active matching invitee. No cookie/localStorage flag or app metadata claims a booking. Past active meetings remain evidence while review is pending; the latest active matching event is shown. Canceled events/invitees are excluded, and a rescheduled active replacement is found on the next lookup. An incomplete paginated lookup or API failure stays unavailable and does not invite a fresh booking.

The only change URL shown is a valid Calendly reschedule_url returned by the matching invitee API. Missing/invalid URLs show confirmation-email guidance. An embed event_scheduled message from the actual Calendly frame triggers a fresh server lookup, never a booked state. Embed views, selected times, clicks, client payloads and return URL parameters are not booking evidence. A manual Refresh meeting supports bookings/reschedules in a separate tab. A webhook is not required for read-through lookup, and this change adds no webhook endpoint or provider write.

## Configuration required before functional provider QA

- Existing GOOGLE_SIGNUP_PROOF_SECRET: persistent server-only signing secret, at least32 characters, already used by signup/Checkout proof. The new context has a distinct signed purpose.
- CALENDLY_API_TOKEN: server-only personal access token or usable access token with read access to the relevant organization's scheduled events and invitees. No token is passed to the browser or logged. This implementation does not implement OAuth token refresh.
- CALENDLY_ORGANIZATION_URI: exact https://api.calendly.com/organizations/<id> matching the host organization. Token scope/permissions must permit organization event reads.
- CALENDLY_ENTERPRISE_EVENT_TYPE_URI: exact https://api.calendly.com/event_types/<id> for the existing Enterprise booking page. The operator must verify this mapping; a URL/view/click is not a substitute.

This repository previously had only a public scheduling URL and widget script, with no provider read credentials or webhook contract. Source absence does not prove runtime absence. Credential presence, approved bindings and actual provider permission must be verified by the deployment owner using private configuration; never post token values. Without those bindings the page shows that meeting status could not be checked. It cannot reconstruct a real reschedule link from the public booking URL.

Provider reads are no-store, reject redirects, and use a10second total budget with5second per-request timeout. Pagination is bounded and fails unavailable on exhaustion. No new database migration, applied-migration edit, approval metadata change or financial/provider write is involved.

## Source contracts and validation

Calendly documents [scheduled event lookup](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/list-scheduled-events), [event invitees](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/list-event-invitees), [reschedule URL](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-event-invitee) and [embed messages](https://developer.calendly.com/api-docs/overview/embedding/notifying-the-parent-window).

Focused tests cover signed context forgery/expiry, current account and confirmed/held checks, repeat sign-in lookup, email/event-type isolation, cancellation, pagination, API/config failure, real-link-only rendering and event hints versus verified state. Callback/middleware/review-gate tests remain required. The local visual fixture at src/test/ui/enterprise-meeting renders invented data with a sign-out stub; it is not provider/auth QA.
