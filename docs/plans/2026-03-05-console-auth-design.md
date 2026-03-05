# Console App — Auth Flow Design

## Overview

New Next.js app at `apps/console/` that replaces the platform's `/app` frontend. Handles authentication (signin, signup, device login) and a dashboard landing page with CLI install instructions and an early access form.

## Architecture

Self-contained Next.js App Router app. All auth logic lives within the console app. Uses `@superserve/ui` for all UI components. Connects to the same Supabase project and backend API as the existing platform.

## Pages

| Route | Type | Purpose |
|---|---|---|
| `/auth/signin` | Page (client) | Email/password + Google OAuth + dev auth |
| `/auth/signup` | Page (client) | Registration with email verification |
| `/auth/forgot-password` | Page (client) | Password reset request |
| `/auth/reset-password` | Page (client) | Set new password (requires valid session) |
| `/auth/callback` | Route handler | OAuth/email verification callback |
| `/auth/auth-code-error` | Page | Error page for failed auth flows |
| `/device` | Page (client) | CLI device authorization flow |
| `/` | Page (client, protected) | Dashboard: CLI install, docs link, early access form |

## Internal Structure

```
apps/console/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (fonts, providers)
│   │   ├── globals.css             # Import @superserve/ui/styles + overrides
│   │   ├── page.tsx                # Dashboard (protected)
│   │   ├── auth/
│   │   │   ├── signin/page.tsx
│   │   │   ├── signup/
│   │   │   │   ├── page.tsx
│   │   │   │   └── action.ts       # signUpWithEmail server action
│   │   │   ├── forgot-password/
│   │   │   │   ├── page.tsx
│   │   │   │   └── action.ts       # sendPasswordResetEmail server action
│   │   │   ├── reset-password/page.tsx
│   │   │   ├── callback/route.ts   # OAuth + email verification handler
│   │   │   └── auth-code-error/page.tsx
│   │   └── device/
│   │       ├── page.tsx
│   │       └── action.ts           # early access slack notification
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser client (@supabase/ssr)
│   │   │   ├── server.ts           # Server client (cookies)
│   │   │   ├── admin.ts            # Service role client
│   │   │   └── middleware.ts       # Route definitions + middleware client
│   │   ├── email/
│   │   │   ├── send.ts             # Resend send utility
│   │   │   ├── resend.ts           # Resend client init
│   │   │   └── templates/
│   │   │       ├── confirmation.tsx
│   │   │       ├── welcome.tsx
│   │   │       ├── password-reset.tsx
│   │   │       └── components/
│   │   │           └── email-layout.tsx
│   │   ├── slack/
│   │   │   └── send-to-webhook.ts  # Slack webhook utility
│   │   ├── auth-context.tsx        # Client auth state provider
│   │   └── auth-helpers.ts         # Session validation, error handling
│   ├── middleware.ts               # Supabase session refresh + route protection
│   └── components/                 # Console-specific components (if any)
├── package.json
├── next.config.ts
├── tsconfig.json
└── biome.json
```

## Auth Provider

Supabase Auth with:
- Email/password (signup with email confirmation link)
- Google OAuth
- Device code flow (for CLI)
- Dev auth mode (enabled via NEXT_PUBLIC_ENABLE_DEV_AUTH)

## Dashboard Page

After login, users land on `/` which contains:
1. CLI install command with copy button: `curl -fsSL https://superserve.ai/install | sh`
2. Link to docs
3. Expandable early access form (name, email, company, role, use case)
   - Submits directly to a Supabase table (no backend API)
   - Sends Slack notification via server action
   - Pre-fills name/email from auth session

## Email System

Resend for transactional emails:
- Confirmation email (signup verification link)
- Welcome email (after account verified)
- Password reset email

Templates built with @react-email/components.

## Analytics

PostHog for:
- User identification (Supabase user ID)
- signup_completed event
- cli_device_authorized event
- early_access_submitted event
- install_command_copied event

## UI Approach

- All components from `@superserve/ui` (Button, Input, Card, Toast, Alert, Textarea, FormField, etc.)
- Import `@superserve/ui/styles` as base CSS
- Theme: teal primary palette, styled like the playground (clean, using UI library defaults)
- Fonts: Inter (sans), Geist Mono (mono)
- No custom auth-specific component overrides — use the library as-is

## Infrastructure Changes

1. `packages/typescript-config/nextjs.json` — New preset for Next.js apps
2. `turbo.json` — Add `NEXT_PUBLIC_*` env vars to build task, add `.next/**` to outputs
3. `@superserve/ui` — Verify all exported components have `"use client"` directives where needed

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_COOKIE_DOMAIN
NEXT_PUBLIC_ENABLE_DEV_AUTH
NEXT_PUBLIC_DEV_AUTH_EMAIL
NEXT_PUBLIC_DEV_AUTH_PASSWORD
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_POSTHOG_KEY
RESEND_API_KEY
RESEND_FROM_ADDRESS
SLACK_WEBHOOK_URL
```

## Route Protection

Public routes (no auth): `/auth/*`, `/device`
Protected routes (require auth): `/`, everything else
Middleware refreshes Supabase session on every request.
