# Reduced-motion visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/reduced-motion --webpack --hostname 127.0.0.1 --port 4178
```

Routes: `/sandboxes/` (list), `/sandboxes/sbx-7f3a91c2/` (detail), `/spinners/`,
`/terminal/`, `/plans/`, `/plans/fallback/` and `/dialogs/` (see below).

The fixture renders the production sandbox list and detail pages inside the
production `MotionProvider` and Console `globals.css`. A route handler at
`/api/*` fakes the control plane, and `activity-stub.ts` and `stubs.ts`
replace the activity server action and PostHog.

The banner shows `matchMedia('(prefers-reduced-motion: reduce)').matches` and
a `data:` switch (cookie `fx`): `loaded`, `sections loading` (sandbox loads,
snapshots/files/network/activity never answer) and `loading` (nothing answers,
so the full skeletons stay up).

Toggle the OS setting in Chrome with CDP
`Emulation.setEmulatedMedia` (`prefers-reduced-motion`: `reduce` /
`no-preference`) and reload; motion/react reads the setting once at startup.

Things to check with reduce **on**: skeletons and the ping halo are static,
both spinners stop, and the toolbar tab / row hover highlight jumps instead of
springing. With reduce **off**, all of these animate as before.

## Terminal, plan picker, choose-plan fallback and dialogs

- `/terminal/` mounts the real `SandboxTerminal`. A fake `WebSocket` opens at
  once and sends a prompt, so the component focuses xterm itself and the cursor
  shows. Check the `.xterm-cursor-blink` class and its animation on the focused
  cursor, and flip the emulated media on one page load (no reload) to see
  `cursorBlink` follow it.
- `/plans/` mounts the real `PlanPickerOptions`. `plan-actions-stub.ts`
  replaces the plan-offers server actions with ones that never answer, so the
  catalog loading state stays up.
- `/plans/fallback/` mounts the real choose-plan page. `navigation-stub.ts`
  (applied only to that page's `next/navigation` import) makes `useSearchParams`
  suspend forever, so the page's own Suspense fallback stays up.
- `/dialogs/?d=sandbox|snapshot|key` opens the real `DeleteSandboxDialog`,
  `DeleteSnapshotDialog` or `RevokeKeyDialog`, types the confirmation text and
  presses the confirm button. The request behind it never answers (the API route
  hangs `DELETE`, the other two take a never-resolving `onConfirm`), so the
  button spinner stays up. Reload after switching the query string.
