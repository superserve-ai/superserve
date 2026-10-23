# Team billing visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/team-billing --webpack --hostname 127.0.0.1 --port 4177
```

The fixture renders the production team billing view (`/admin/billing/teams/[team_id]`)
with an invented Pro team that has a scheduled move to Pro annual, an issued
credit for the current period, a card on file and recent invoices. Append
`?state=payg` for a pay-as-you-go team with the schedule form. Data is local.
The fixture swaps in `actions.ts`: choosing a plan previews it (Starter monthly
is refused, annual plans start on the yearly anniversary), and every write
reports billing as unavailable.

Server-side authorization, request shapes and retry behaviour are covered by
Vitest.
