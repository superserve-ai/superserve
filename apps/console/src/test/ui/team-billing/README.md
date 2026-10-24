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
remains effective and downgrade/undo stay available while new staff assignment
is hidden. The backend still accepts idempotent assignment replays after OFF. Data is local. The fixture swaps in `actions.ts`: assigning a
plan reports the backend's switch-off refusal, and every other write reports
billing as unavailable.

Server-side authorization, request shapes and retry behaviour are covered by
Vitest.

Append `?unavailable=plans` to show a failed assignment read with no assignment
form, or `?unavailable=credits` to show a failed credit-history read with no new
grant form. Each independent successful read keeps its own controls available.

Use `?unavailable=catalog` for unknown pricing status with existing exits still
available. Failed plan reads show unavailable history; a successfully loaded
empty history keeps the empty-history message.

For Unicode boundary QA, use `?state=starter`, choose Free or a custom plan,
and paste 2,000 astral characters into Reason. The full value remains editable
and submission is enabled. Replace it with 1,999 astral characters plus two
ASCII characters: the field shows its 2,000-character error and submission is
disabled. The same rule applies to the undo form in the default fixture. The
fixture uses canned actions; actual code-point action validation and the
32 KiB UTF-8 request bound are covered by focused regression tests. Staff
credit retains its separate backend byte limits.

For staff credit byte-boundary QA, enter an amount and paste 500 astral
characters into the credit Reason. Submission is enabled at exactly 2,000
UTF-8 bytes. Append one ASCII character: a specific inline byte-limit error
appears and submission is disabled. This credit-only byte limit is separate
from the plan forms' Unicode character limit.
