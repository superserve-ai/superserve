# Promotion identity rollout

Canonical promotion enforcement starts disabled. Deploy and verify each stage before advancing; publishing identity evidence does not activate enforcement or consume a promotion.

## 1. Deploy the regional prerequisites

Apply the additive promotion identity, redemption, and Checkout fence migrations in every target cell before deploying a Console version that calls `upsert_profile_with_promotion_identity`. Deploy the service-only writer and `POST /stripe/checkout-session/recover` in those cells as well. Confirm that the writer accepts authenticated Auth observations and that the recovery route is present before routing Console traffic to a cell. A missing writer or route is a deployment failure; do not bypass evidence publication or send a failed-publication request to the combined Checkout endpoint.

## 2. Deploy and verify every producer

Deploy the Console publisher to every serving instance and target cell. Confirm the deployed version publishes trusted Auth evidence before claim-bearing team provisioning through first-login, proxy, lazy API-key, and explicit creation paths, and before new Checkout creation for the actual authenticated payer in the selected cell. Check returning and invited users even when a regional profile or team already exists. Verify that ordinary existing-team reads, API-key listing, and customer-portal entry continue without mandatory evidence refresh.

Use synthetic accounts in each cell to check that the regional profile and evidence commit together, including raw Auth email changes and known unverified email. A failed or unavailable Auth observation must block a new claim and new Checkout generation. With ordinary authentication and billing authorization intact, verify that an existing pinned Checkout can recover through the recovery-only route even when fresh evidence publication fails. Only a recovery `409` with code `checkout_recovery_unavailable` permits fresh evidence publication to be attempted; a new Checkout generation requires that publication to succeed. A `409` alone neither proves an ambiguous create failed nor clears its fence. An older-cell `404` or another recovery error must not start a new generation.

## 3. Establish activation readiness

Check existing-user evidence coverage and complete the separate historical reconciliation before enabling enforcement. Verify readiness for pending Checkout and billing generations under their original pinned actor and evidence, including delayed webhook and retry cases. Record the deployed writer and Console versions for every cell and confirm that no active claim path still uses a version without evidence publication. Confirm the operator's readiness and rollback plan, including `all_writers_ready` and `rollback_ready`, before the separate backend activation step. Exact-head validation and all-cell deployment evidence are prerequisites; a successful build alone does not establish production readiness.

## 4. Activate and preserve the rollback boundary

An administrator enables canonical enforcement only after the readiness gate succeeds. Console deployment does not call the activation operation. After activation, rollback may use only a Console version that publishes trusted evidence on every claim path in every cell. Do not roll back to an older Console writer or remove the regional writer or recovery route while enforcement depends on them. If readiness is incomplete, leave enforcement disabled and repair the missing producer, cell, historical state, or pending billing case before attempting activation.
