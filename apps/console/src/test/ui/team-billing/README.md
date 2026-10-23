# Team billing visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/team-billing --webpack --hostname 127.0.0.1 --port 4177
```

The fixture renders the production team billing view (`/admin/billing/teams/[team_id]`)
with invented data and pricing v2 on. By default it shows a Pro team with a pending,
undoable move to Free, plan history and staff credit (one pending, one issued).
Append `?state=starter` for a Starter team with the plan change and custom plan
forms, or `?state=legacy` for a team while pricing v2 is off (no plan assigned,
no plan writes). Add `&switch=off` to an assigned state to check that its plan
remains effective and downgrade/undo stay available while new assignment is
hidden. Data is local. The fixture swaps in `actions.ts`: assigning a
plan reports the backend's switch-off refusal, and every other write reports
billing as unavailable.

Server-side authorization, request shapes and retry behaviour are covered by
Vitest.
