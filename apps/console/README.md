# @superserve/console

Next.js 16 App Router console for managing Superserve sandboxes.

## Development

Run from the repo root.

```bash
# Dev server — http://localhost:3001
bun --filter @superserve/console run dev

# Email template preview — http://localhost:3002
bun --filter @superserve/console run email:dev

# Lint, typecheck, test
bun --filter @superserve/console run lint
bun --filter @superserve/console run typecheck
bun --filter @superserve/console run test
```

## Email templates

Located at `src/lib/email/templates/`:

- `welcome.tsx`
- `confirmation.tsx`
- `password-reset.tsx`
- `components/email-layout.tsx` — shared layout (header, footer, fonts)

The `email:dev` script boots a [React Email](https://react.email) preview server with hot reload, multi-client previews (Gmail, Apple Mail, Outlook), dark mode toggle, and a "Send test" button that uses Resend if `RESEND_API_KEY` is set.

Templates are sent in production via Resend from server actions in `src/app/(auth)/auth/*/action.ts`.
