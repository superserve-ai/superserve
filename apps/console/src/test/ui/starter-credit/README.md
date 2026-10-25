# Starter credit visual fixture

From `apps/console`, run:

```sh
bunx next dev src/test/ui/starter-credit --webpack --hostname 127.0.0.1 --port 4177
```

Open `http://127.0.0.1:4177/plan-usage/buy-credit/?scenario=first`. Scenarios:

| Scenario   | State                                                                 |
| ---------- | --------------------------------------------------------------------- |
| `first`    | No balance, no saved card, auto-recharge unavailable until a purchase |
| `active`   | Positive balance, saved card, auto-recharge on, purchase history      |
| `declined` | Low balance, auto-recharge turned off after a declined charge         |

The fixture renders the production Starter purchase page over local responses.
Buying is simulated and returns an error instead of opening Stripe; saving
auto-recharge echoes the settings. No account or payment requests are sent.
