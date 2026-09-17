# SS-468 Cloudflare capability status

SS-560 reports that Cloudflare has enabled a two-week Enterprise trial for
Turnstile Ephemeral ID evaluation. The earlier SS-468 baseline used Free
Turnstile. Trial access does not itself confirm Ephemeral ID activation on the
existing widget or collection in the effective console deployment; that evidence
is pending below. Bot Management and Account Abuse Protection belong to SS-561.

The existing email and Google signup paths remain observe-only. The browser
obtains a Turnstile token, the server calls Siteverify, and the existing PostHog
observation stores the provider-native `metadata.ephemeral_id`, when returned,
under the shared `signup_attempt_id`. reCAPTCHA and existing signup logic retain
authority over signup allow/deny decisions.

## Configuration expectations

Use the existing Turnstile widget/site key and make only the minimum
Cloudflare-side change needed to enable Ephemeral IDs. The exact account/widget
setting and entitlement confirmation remain pending; no Cloudflare-side change
is established by this document.

Configure `NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY` and
`CLOUDFLARE_TURNSTILE_SECRET_KEY` in the effective console deployment. Runtime
observation enable/disable uses the `cloudflare_signup_observation` feature flag.
Keep the defaults from `apps/console/.env.example` until activation is confirmed:

```dotenv
CLOUDFLARE_SIGNUP_CONFIG_VERSION=v1
CLOUDFLARE_SIGNUP_CAPABILITIES=turnstile_free
```

After confirming activation for the existing widget, set both values in the
effective console deployment, using the example trial version:

```dotenv
CLOUDFLARE_SIGNUP_CONFIG_VERSION=ss-560-ephemeral-v1
CLOUDFLARE_SIGNUP_CAPABILITIES=turnstile_enterprise,ephemeral_id
```

The exact `ephemeral_id` capability declares that the signal is expected; a
returned ID never changes activation configuration automatically. These values
describe the experiment and do not enable the Cloudflare entitlement themselves.
Version subsequent capability changes so observations before and after activation
or entitlement loss remain separable.

### Activation procedure

1. Confirm the Enterprise trial entitlement and expiry date with the Cloudflare
   account owner, identify the existing widget by its configured site key, and
   confirm or enable Ephemeral IDs for that widget. Record the exact setting and
   confirmation time; do not infer activation from trial access alone.
2. Apply the active capability list and a new config version above to the
   effective console deployment, and enable `cloudflare_signup_observation`
   through the existing feature-flag mechanism.
3. Complete the existing email and Google signup paths and inspect their
   Cloudflare observations by `signup_attempt_id`. Confirm the deployed
   `config_version`, `ephemeral_id_expected=true`, and observations containing
   `ephemeral_id_present=true` with `ephemeral_id_status=success`. Record evidence
   references below. If IDs remain absent, investigate widget entitlement and
   effective configuration; do not mark collection confirmed.

## Observation semantics and expiry

`provider_outcome` preserves the Siteverify/transport outcome. Query
`ephemeral_id_status` separately for signal health:

| Observation                                                          | `ephemeral_id_status`     |
| -------------------------------------------------------------------- | ------------------------- |
| Successful Siteverify with a valid Ephemeral ID                      | `success`                 |
| Successful Siteverify without an ID, capability not declared         | `not_active`              |
| Successful Siteverify without an ID, capability declared             | `missing_expected_signal` |
| Successful Siteverify with malformed metadata or an invalid ID value | `malformed_response`      |
| Siteverify/provider/configuration failure producing an observation   | `unavailable`             |

Feature-flag lookup failure emits a separate observation-failed event with
`provider_outcome=configuration_lookup_failed`; disabled observation emits no
provider observation. Preserve `ephemeral_id_present`, `ephemeral_id_expected`,
`capabilities`, and `config_version` when analyzing coverage.

Trial expiry, entitlement removal, missing signals, provider errors, and disabled
observation must leave signup working without a deploy or emergency configuration
change. With the active declaration retained, successful responses that lose the
ID become `missing_expected_signal`. Configuration may later be updated for
accurate experiment labeling, but signup availability must not depend on it.
Never retain challenge tokens, auth tokens, cookies, secrets, or raw sensitive
response payloads as activation evidence.

### Post-trial procedure

1. Record the entitlement expiry/removal time and the last confirmed active
   config version. Retain the active declaration while checking signal loss so
   successful responses without an ID remain visible as `missing_expected_signal`.
2. Complete both existing signup paths in the unentitled/missing-field state and
   record their signup results and observation references. Confirm that no deploy
   or emergency configuration change was needed to preserve signup; distinguish
   provider failures (`unavailable`) from successful responses missing the ID.
3. After recording the evidence, remove `ephemeral_id` from the capability list
   and assign a new config version reflecting the remaining confirmed entitlement
   (use `turnstile_free` only if the widget has returned to Free). Alternatively,
   end observation using `cloudflare_signup_observation`. These are experiment
   cleanup steps, not prerequisites for signup availability.
4. Record the trial results and recommendation in SS-466, including the evidence
   gathered before and after expiry.

## Pending activation and evaluation evidence

The following evidence has not been recorded here:

- **Widget activation:** trial start/end dates, confirmation of the existing
  widget's Ephemeral ID entitlement, the exact setting changed, and activation
  time.
- **Effective deployment:** deployment identifier, activation time, capability
  list, and config version observed in production events.
- **Production collection:** representative observation references showing
  `ephemeral_id_present=true` with the expected version and joins through
  `signup_attempt_id` to reCAPTCHA, Fingerprint, and eventual user/team enrichment.
- **Expiry behavior:** a post-trial/unentitled/missing-field simulation on the
  existing signup paths, recording successful signup and diagnostic signal loss
  without a deploy or emergency config change.
- **Comparison results:** production observations and controlled scenarios for
  different emails, IP/VPN changes, cleared storage, private browsing, different
  browsers, headless automation, and two devices behind one NAT. Measure stability,
  rotation, useful lifetime, Fingerprint overlap, unique value, and false
  correlation; report findings, post-trial pricing, and a recommendation to SS-466.

Begin production observation once the Enterprise field is confirmed available;
controlled-test completeness is not a prerequisite. Pending evidence must be
completed before claiming the trial evaluation or its provider decision complete.
