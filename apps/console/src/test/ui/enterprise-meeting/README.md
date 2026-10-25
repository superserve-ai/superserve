# Existing Enterprise meeting visual fixture

From apps/console:

```sh
bunx next dev src/test/ui/enterprise-meeting --webpack --hostname 127.0.0.1 --port 4177
```

This renders the production PendingReview component with invented account and booking data. The Supabase client is replaced with a local sign-out stub. No account, provider, scheduling or payment requests are made. Do not click the invented reschedule URL. The widget is not mounted in this fixture.

Review the default booked view and ?state=no-link, ?state=unavailable and ?state=signin at desktop/mobile widths. These are visual examples, not verified bookings or auth/provider QA. Auth/context, provider response, and event-message behavior have separate focused Vitest coverage.
