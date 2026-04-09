# Auth Pages Redesign

Redesign all auth pages to match the console's dashboard design language — smaller, tighter, technical.

## Pages

- Sign In (`/auth/signin`)
- Sign Up (`/auth/signup`)
- Forgot Password (`/auth/forgot-password`)
- Reset Password (`/auth/reset-password`)
- Auth Code Error (`/auth/auth-code-error`)

## Design

### Card

- `max-w-sm`, `p-6` (down from p-8), `border border-dashed border-border bg-surface`
- `relative` for CornerBrackets positioning
- CornerBrackets `size="lg"` on the card — signature element

### Typography

- Heading: `text-sm font-medium text-foreground` (matching PageHeader size, not the current text-2xl)
- Subtitle: `text-xs text-muted`
- Both centered

### Inputs

- Drop `AUTH_INPUT_CLASS` — use default Input component styling (`h-9`)
- Delete `apps/console/src/app/(auth)/auth/styles.ts`

### Buttons

- Standard `Button` default variant, default size (`h-9`), `w-full` — no custom height/padding overrides
- Google button: `Button` outline variant, default size, `w-full`
- Both keep natural `font-mono uppercase` from Button base

### Auth Flow Order (Sign In / Sign Up)

1. Google OAuth button (first, most prominent)
2. Dashed "or" divider
3. Email/password form
4. Submit button

### Dev Login

- `variant="ghost"` `size="sm"` — small, subtle, at the very bottom
- No divider or badge — just the button with muted text
- Only visible when `DEV_AUTH_ENABLED` is true

### Inline Errors

- Field-specific: `text-xs text-destructive mt-1` below each field
- Replace `addToast` calls with local error state per field
- General auth errors (network, unknown) shown above submit button in same style

### Auth Code Error Page

- Rewrite to use the same card + CornerBrackets pattern instead of generic Card component

## Files

| Path | Action |
|---|---|
| `apps/console/src/app/(auth)/auth/signin/page.tsx` | Rewrite |
| `apps/console/src/app/(auth)/auth/signup/page.tsx` | Rewrite |
| `apps/console/src/app/(auth)/auth/forgot-password/page.tsx` | Rewrite |
| `apps/console/src/app/(auth)/auth/reset-password/page.tsx` | Rewrite |
| `apps/console/src/app/(auth)/auth/auth-code-error/page.tsx` | Rewrite |
| `apps/console/src/app/(auth)/auth/styles.ts` | Delete |
