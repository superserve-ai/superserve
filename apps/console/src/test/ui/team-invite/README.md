# Team and invitations fixture

Run from `apps/console`:

```sh
bunx next dev src/test/ui/team-invite --webpack --hostname 127.0.0.1 --port 4177
```

Open `http://127.0.0.1:4177/?scenario=page`. Scenarios:

- `page`: production Team page, three members, one removed member, two invitations.
- `modal`: production invite dialog with four rows defaulting to Team admin and an invalid email.
- `results`: mixed roles (Team admin, Viewer, Billing admin and User admin) with sent, already member, already invited and email delivery failure results.
- `legacy`: email-only invitations and the legacy Owner notice.

Webpack aliases replace data hooks and actions with local simulations. No credentials or backend connection are needed. The fixture fills the production modal with paste events and chooses roles in the shared Select with keyboard events; it does not add fixture props to the production components.

Capture and verify all scenarios while the dev server runs:

```sh
bun src/test/ui/team-invite/verify.mjs /var/tmp/team-invite-screenshots
```

Requires `google-chrome`. The script checks HTTP responses, expected UI and browser errors, saves four 1280×900 screenshots, and shuts down its Chrome process.
