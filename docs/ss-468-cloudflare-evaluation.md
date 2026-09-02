# SS-468 Cloudflare capability status

The console integration is observe-only and fail-open. It forwards bounded
browser request context to the configured observation endpoint, but it does
not claim to acquire a Turnstile Ephemeral ID: Cloudflare generates that ID
for an Enterprise Turnstile interaction and returns it from Siteverify.

As of this evaluation, Superserve has not established Enterprise Turnstile,
Account Abuse Protection, or Bot Management entitlement/trial access. Those
capabilities require account-level enablement (and may require Enterprise,
Bot Management, or Early Access). Until Cloudflare confirms entitlement and
provides credentials/site configuration, no duplicate browser challenge is
run and `ephemeral_id`/account-abuse fields remain nullable. The observation
endpoint may report `feature_not_entitled` when access is unavailable.

Before enabling a browser collection path, confirm the account tier, trial
duration, pricing, retention, and Siteverify response fields with Cloudflare.
