# Plan selection visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/plan-selection --webpack --hostname 127.0.0.1 --port 4176
```

The fixture renders the production plan-selection view. Free opens optional
billing; Pro opens the pending-payment view. All actions are local simulations;
no account or payment requests are sent. Inspect desktop and mobile widths,
cadence prices, keyboard focus, and the Free/pending states.

Controller, auth, proxy, and server-action behavior is covered separately by
Vitest. This fixture does not validate provider payment or production signup.
