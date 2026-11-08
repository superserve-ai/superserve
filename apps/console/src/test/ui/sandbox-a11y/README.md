# Sandbox accessibility visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/sandbox-a11y --webpack --hostname 127.0.0.1 --port 4177
```

Open `http://127.0.0.1:4177/sandboxes/`.

The fixture renders the production `SandboxTableRow`, `NetworkSection`,
`MetadataSection`, and `CreateSandboxDialog` with fake sandboxes and no
network. `next.config.ts` replaces `posthog-js/react` with a no-op and the
template, snapshot and secret query hooks with empty results
(`query-stubs.ts`). `usePatchSandbox` and `useCreateSandbox` run against a
local `QueryClient`; saving or creating fails, as no API exists here.

Things to check:

- **Keyboard row navigation.** Tab from the page start to a sandbox name link
  (visible focus ring) and press Enter to open `/sandboxes/<id>/`. Clicking
  anywhere else on a row still opens it. Checkbox, Connect, Stop/Start and the
  actions menu do not navigate.
- **Icon button names.** On a detail page, the pencil buttons are exposed as
  "Edit network rules" and "Edit metadata". After you open an editor, the
  trash buttons are "Remove allow rule N", "Remove deny rule N" and
  "Remove metadata entry N". Open "Create Sandbox" > advanced options to see
  "Remove environment variable N" and the create dialog variants.

Behavior is covered separately by Vitest; this fixture is for visual and
accessibility-tree inspection only.
