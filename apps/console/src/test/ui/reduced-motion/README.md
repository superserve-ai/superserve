# Reduced-motion visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/reduced-motion --webpack --hostname 127.0.0.1 --port 4178
```

Routes: `/sandboxes/` (list), `/sandboxes/sbx-7f3a91c2/` (detail), `/spinners/`.

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
