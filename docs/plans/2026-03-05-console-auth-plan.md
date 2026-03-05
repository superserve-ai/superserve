# Console Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Next.js console app at `apps/console/` with auth flows (signin, signup, forgot/reset password, device login, OAuth callback) and a dashboard landing page, using `@superserve/ui` components and the same Supabase backend as the existing platform.

**Architecture:** Self-contained Next.js App Router app. All auth logic (Supabase clients, server actions, email templates, middleware) lives within the console app. Uses `@superserve/ui` for UI components with the monorepo's existing theme. Connects to the same Supabase project/API as the platform.

**Tech Stack:** Next.js (latest), React 19, Supabase Auth (`@supabase/ssr` + `@supabase/supabase-js`), `@superserve/ui`, Resend (email), PostHog (analytics), Tailwind CSS 4, TypeScript

**Design doc:** `docs/plans/2026-03-05-console-auth-design.md`

---

### Task 1: Infrastructure — TypeScript config preset and turbo.json

**Files:**
- Create: `packages/typescript-config/nextjs.json`
- Modify: `turbo.json`

**Step 1: Create Next.js TypeScript preset**

Create `packages/typescript-config/nextjs.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "noEmit": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "plugins": [{ "name": "next" }]
  }
}
```

**Step 2: Update turbo.json to add Next.js env vars**

Add `NEXT_PUBLIC_*` vars to the build task env array:
```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "env": [
        "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_API_BASE_URL", "VITE_CONSOLE_URL", "VITE_COOKIE_DOMAIN",
        "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_API_URL",
        "NEXT_PUBLIC_COOKIE_DOMAIN", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_ENABLE_DEV_AUTH"
      ],
      "outputs": ["dist/**", ".next/**"]
    }
  }
}
```

**Step 3: Commit**
```bash
git add packages/typescript-config/nextjs.json turbo.json
git commit -m "feat: add Next.js TypeScript config preset and update turbo env vars"
```

---

### Task 2: Scaffold the Next.js console app

**Files:**
- Create: `apps/console/package.json`
- Create: `apps/console/next.config.ts`
- Create: `apps/console/tsconfig.json`
- Create: `apps/console/biome.json`
- Create: `apps/console/src/app/layout.tsx`
- Create: `apps/console/src/app/globals.css`
- Create: `apps/console/src/app/page.tsx` (placeholder)
- Create: `apps/console/public/logo.svg` (copy from platform or create placeholder)
- Create: `apps/console/.env.example`

**Step 1: Create package.json**

```json
{
  "name": "@superserve/console",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "biome check",
    "typecheck": "tsc --pretty --noEmit"
  },
  "dependencies": {
    "@superserve/ui": "workspace:*",
    "@supabase/ssr": "^0.8.0",
    "@supabase/supabase-js": "^2.95.3",
    "@react-email/components": "^1.0.7",
    "lucide-react": "^0.575.0",
    "next": "^16.1.6",
    "posthog-js": "^1.353.0",
    "posthog-node": "^5.25.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "resend": "^6.9.2"
  },
  "devDependencies": {
    "@superserve/biome-config": "workspace:*",
    "@superserve/typescript-config": "workspace:*",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/node": "^25.2.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "postcss": "^8.5",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.9.3"
  }
}
```

**Step 2: Create next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "@superserve/typescript-config/nextjs.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create biome.json**

```json
{
  "extends": ["@superserve/biome-config"]
}
```

**Step 5: Create postcss.config.mjs**

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

**Step 6: Create globals.css**

```css
@import "tailwindcss";
@import "@superserve/ui/styles";

@source "../../packages/ui/src";

:root {
  --sans-font: "Inter", ui-sans-serif, system-ui, sans-serif;
  --mono-font: "Geist Mono", ui-monospace, monospace;
  --display-font: "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

**Step 7: Create root layout**

Create `apps/console/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Suspense } from "react";
import { PostHogPageView } from "@/components/posthog-pageview";
import { PostHogProvider } from "@/components/posthog-provider";
import { ToastProvider } from "@superserve/ui";
import { cn } from "@superserve/ui";

import "./globals.css";

const sansFont = Inter({
  subsets: ["latin"],
  variable: "--sans-font",
  display: "swap",
});

const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--mono-font",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Superserve Console",
  description: "Deploy and manage your AI agents with Superserve",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PostHogProvider>
      <html lang="en" className={cn(sansFont.variable, monoFont.variable)}>
        <body className="font-sans antialiased" suppressHydrationWarning>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <ToastProvider>{children}</ToastProvider>
        </body>
      </html>
    </PostHogProvider>
  );
}
```

**Step 8: Create placeholder page**

Create `apps/console/src/app/page.tsx`:
```tsx
export default function DashboardPage() {
  return <div>Console</div>;
}
```

**Step 9: Create .env.example**

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_COOKIE_DOMAIN=
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:8000

NEXT_PUBLIC_ENABLE_DEV_AUTH=true
NEXT_PUBLIC_DEV_AUTH_EMAIL=dev-user@superserve.local
NEXT_PUBLIC_DEV_AUTH_PASSWORD=dev-password-123

NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

RESEND_API_KEY=
RESEND_FROM_ADDRESS=Superserve <team@console.superserve.ai>
SLACK_WEBHOOK_URL=
```

**Step 10: Install dependencies**

Run from repo root:
```bash
bun install
```

**Step 11: Verify app starts**

```bash
bunx turbo run dev --filter=@superserve/console
```

Expected: Next.js dev server starts on port 3001.

**Step 12: Commit**

```bash
git add apps/console/
git commit -m "feat: scaffold Next.js console app with shared configs"
```

---

### Task 3: PostHog provider and pageview components

**Files:**
- Create: `apps/console/src/components/posthog-provider.tsx`
- Create: `apps/console/src/components/posthog-pageview.tsx`

**Step 1: Create PostHog provider**

```tsx
"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import type React from "react";

if (typeof window !== "undefined") {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  if (apiKey) {
    try {
      posthog.init(apiKey, {
        api_host: host,
        person_profiles: "always",
        capture_pageview: false,
        capture_pageleave: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-mask]",
        },
      });
    } catch (error) {
      console.warn("PostHog failed to initialize:", error);
    }
  }
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }
  return <PHProvider client={posthog}>{children}</PHProvider>;
}
```

**Step 2: Create PostHog pageview tracker**

```tsx
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && typeof window !== "undefined") {
      import("posthog-js")
        .then((posthogModule) => {
          const posthog = posthogModule.default;
          if (posthog.__loaded) {
            let url = window.origin + pathname;
            if (searchParams?.toString()) {
              url = `${url}?${searchParams.toString()}`;
            }
            posthog.capture("$pageview", { $current_url: url });
          }
        })
        .catch(() => {});
    }
  }, [pathname, searchParams]);

  return null;
}
```

**Step 3: Commit**

```bash
git add apps/console/src/components/
git commit -m "feat: add PostHog provider and pageview tracking"
```

---

### Task 4: Supabase clients and middleware

**Files:**
- Create: `apps/console/src/lib/supabase/client.ts`
- Create: `apps/console/src/lib/supabase/server.ts`
- Create: `apps/console/src/lib/supabase/admin.ts`
- Create: `apps/console/src/lib/supabase/middleware.ts`
- Create: `apps/console/src/middleware.ts`

**Step 1: Create browser client**

```typescript
import { createBrowserClient } from "@supabase/ssr";

export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or anonymous key.");
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    ...(cookieDomain && {
      cookieOptions: { domain: cookieDomain },
    }),
  });
};
```

**Step 2: Create server client**

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const createClient = async () => {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or anonymous key.");
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const domainOpts = cookieDomain ? { domain: cookieDomain } : {};

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, ...domainOpts }),
          );
        } catch {
          // Called from Server Component — safe to ignore with middleware session refresh
        }
      },
    },
  });
};
```

**Step 3: Create admin client**

```typescript
import { createClient } from "@supabase/supabase-js";

export const createAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
```

**Step 4: Create middleware utilities**

```typescript
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/device",
];

export function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname.startsWith(route));
}

export function createSupabaseClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { supabase: null, response };
  }

  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const domainOpts = cookieDomain ? { domain: cookieDomain } : {};

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, { ...options, ...domainOpts });
        }
      },
    },
  });

  return { supabase, response };
}
```

**Step 5: Create root middleware**

```typescript
import type { NextRequest } from "next/server";
import {
  PUBLIC_ROUTES,
  createSupabaseClient,
  matchesRoute,
} from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createSupabaseClient(request);
  if (!supabase) return response;

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES);

  // Redirect unauthenticated users to signin (except public routes)
  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone();
    signinUrl.pathname = "/auth/signin";
    signinUrl.searchParams.set("next", pathname);
    return Response.redirect(signinUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Step 6: Commit**

```bash
git add apps/console/src/lib/supabase/ apps/console/src/middleware.ts
git commit -m "feat: add Supabase clients and auth middleware"
```

---

### Task 5: Email system — Resend client and templates

**Files:**
- Create: `apps/console/src/lib/email/resend.ts`
- Create: `apps/console/src/lib/email/send.ts`
- Create: `apps/console/src/lib/email/templates/components/email-layout.tsx`
- Create: `apps/console/src/lib/email/templates/confirmation.tsx`
- Create: `apps/console/src/lib/email/templates/welcome.tsx`
- Create: `apps/console/src/lib/email/templates/password-reset.tsx`

**Step 1: Create Resend client**

```typescript
import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;

if (!resendApiKey) {
  console.warn("RESEND_API_KEY is not configured — emails will not be sent");
}

export const resend = resendApiKey ? new Resend(resendApiKey) : null;
```

**Step 2: Create send utility**

```typescript
import { resend } from "./resend";

interface SendEmailOptions {
  to: string;
  subject: string;
  react: React.ReactElement;
}

export const sendEmail = async ({ to, subject, react }: SendEmailOptions) => {
  const from = process.env.RESEND_FROM_ADDRESS;

  if (!resend) {
    console.warn("Resend not configured — skipping email send");
    return { success: false };
  }

  if (!from) {
    console.error("RESEND_FROM_ADDRESS is not configured");
    return { success: false };
  }

  try {
    const { error } = await resend.emails.send({ from, to, subject, react });

    if (error) {
      console.error("Failed to send email:", error);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.error("Error sending email:", err);
    return { success: false };
  }
};
```

**Step 3: Create email layout**

```tsx
import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
}

export const EmailLayout = ({ preview, children }: EmailLayoutProps) => (
  <Html>
    <Head>
      <Font
        fontFamily="Inter"
        fallbackFontFamily="Helvetica"
        webFont={{
          url: "https://fonts.gstatic.com/s/inter/v18/UcCo3FwrK3iLTcviYwY.woff2",
          format: "woff2",
        }}
        fontWeight={400}
        fontStyle="normal"
      />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={body}>
      <Container style={container}>
        <Section style={header}>
          <Img
            src="https://superserve.ai/assets/logo.png"
            width="173"
            height="32"
            alt="Superserve"
          />
        </Section>
        <Section style={card}>{children}</Section>
        <Section style={footer}>
          <Text style={footerText}>Superserve</Text>
          <Text style={footerSubtext}>
            455 Market St Ste 1940 PMB 924076, San Francisco, California
            94105-2448 US.
          </Text>
          <Text style={footerSubtext}>
            If you have any questions, we're happy to help. Contact{" "}
            <Link style={footerSubtextLink}>support@superserve.ai</Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

const body = {
  backgroundColor: "#faf8f5",
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  margin: "0",
  padding: "0",
};

const container = { maxWidth: "520px", margin: "0 auto", padding: "40px 20px" };
const header = { textAlign: "center" as const, padding: "0 0 32px 0" };
const card = {
  backgroundColor: "#fffefb",
  border: "1px dashed #e8e4df",
  padding: "40px 32px",
};
const footer = { padding: "32px 0 0 0", textAlign: "center" as const };
const footerText = {
  color: "#8a8a8a",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 8px 0",
};
const footerSubtext = {
  color: "#b0b0b0",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "0",
};
const footerSubtextLink = {
  color: "#105C60",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "0",
};
```

**Step 4: Create confirmation email template**

```tsx
import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface ConfirmationEmailProps {
  confirmationUrl: string;
}

export const ConfirmationEmail = ({
  confirmationUrl,
}: ConfirmationEmailProps) => (
  <EmailLayout preview="Confirm your Superserve account">
    <Heading style={heading}>Confirm your account</Heading>
    <Text style={paragraph}>
      We are excited for you to try Superserve! Verify your email below to get
      started.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Confirm Email Address
    </Button>
    <Text style={disclaimer}>
      You can ignore this email if you did not create a Superserve account
    </Text>
  </EmailLayout>
);

const heading = {
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  color: "#3d3d3d",
  fontSize: "22px",
  fontWeight: "600" as const,
  letterSpacing: "-0.02em",
  textAlign: "center" as const,
  margin: "0 0 24px 0",
};

const paragraph = {
  color: "#5c5c5c",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
};

const button = {
  backgroundColor: "#105C60",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "500" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "14px 24px",
  margin: "24px 0 0 0",
};

const disclaimer = {
  color: "#8a8a8a",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "24px 0 0 0",
};

export default ConfirmationEmail;
```

**Step 5: Create welcome email template**

```tsx
import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface WelcomeEmailProps {
  name: string;
  dashboardUrl: string;
}

export const WelcomeEmail = ({ name, dashboardUrl }: WelcomeEmailProps) => (
  <EmailLayout preview={`Welcome to Superserve, ${name}!`}>
    <Heading style={heading}>Welcome to Superserve</Heading>
    <Text style={paragraph}>Hi {name},</Text>
    <Text style={paragraph}>
      Thanks for signing up! Your account is ready. You can start deploying AI
      agents right away from the dashboard.
    </Text>
    <Button style={button} href={dashboardUrl}>
      Go to Dashboard
    </Button>
  </EmailLayout>
);

const heading = {
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  color: "#3d3d3d",
  fontSize: "22px",
  fontWeight: "600" as const,
  letterSpacing: "-0.02em",
  textAlign: "center" as const,
  margin: "0 0 24px 0",
};

const paragraph = {
  color: "#5c5c5c",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
};

const button = {
  backgroundColor: "#105C60",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "500" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "14px 24px",
  margin: "24px 0 0 0",
};

export default WelcomeEmail;
```

**Step 6: Create password reset email template**

```tsx
import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface PasswordResetEmailProps {
  email: string;
  resetUrl: string;
}

export const PasswordResetEmail = ({
  email,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailLayout preview="Reset your Superserve password">
    <Heading style={heading}>Reset Your Password</Heading>
    <Text style={paragraph}>
      We received a request to reset the password for the account associated
      with <strong>{email}</strong>.
    </Text>
    <Text style={paragraph}>
      Click the button below to set a new password. This link will expire in 1
      hour.
    </Text>
    <Button style={button} href={resetUrl}>
      Reset Password
    </Button>
    <Text style={disclaimer}>
      If you didn&apos;t request a password reset, you can safely ignore this
      email. Your password will remain unchanged.
    </Text>
  </EmailLayout>
);

const heading = {
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  color: "#3d3d3d",
  fontSize: "22px",
  fontWeight: "600" as const,
  letterSpacing: "-0.02em",
  textAlign: "center" as const,
  margin: "0 0 24px 0",
};

const paragraph = {
  color: "#5c5c5c",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
};

const button = {
  backgroundColor: "#105C60",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "500" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "14px 24px",
  margin: "24px 0 0 0",
};

const disclaimer = {
  color: "#8a8a8a",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "24px 0 0 0",
};

export default PasswordResetEmail;
```

**Step 7: Commit**

```bash
git add apps/console/src/lib/email/
git commit -m "feat: add Resend email client and email templates"
```

---

### Task 6: Slack webhook utility and PostHog server-side tracking

**Files:**
- Create: `apps/console/src/lib/slack/send-to-webhook.ts`
- Create: `apps/console/src/lib/posthog/actions.ts`

**Step 1: Create Slack webhook utility**

```typescript
// biome-ignore lint/suspicious/noExplicitAny: deeply nested Slack block type
const sendToSlackHook = async (message: Record<string, any>) => {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!slackWebhookUrl) {
    console.error("SLACK_WEBHOOK_URL is not configured");
    return { success: false };
  }

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status}`);
  }
  return { success: true };
};

export default sendToSlackHook;
```

**Step 2: Create PostHog server-side tracking**

```typescript
"use server";

import { PostHog } from "posthog-node";

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!apiKey) return null;
  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

export async function trackEvent(
  event: string,
  distinctId: string,
  // biome-ignore lint/suspicious/noExplicitAny: PostHog properties type
  properties?: Record<string, any>,
) {
  const client = getPostHogClient();
  if (!client) {
    console.warn("PostHog not configured, skipping event tracking");
    return;
  }

  try {
    client.capture({
      distinctId,
      event,
      properties: properties || {},
    });
    await client.flush();
  } catch (error) {
    console.error("Failed to track event:", error);
  }
}
```

**Step 3: Commit**

```bash
git add apps/console/src/lib/slack/ apps/console/src/lib/posthog/
git commit -m "feat: add Slack webhook and PostHog server tracking utilities"
```

---

### Task 7: Auth helpers

**Files:**
- Create: `apps/console/src/lib/auth-helpers.ts`

**Step 1: Create auth helpers**

```typescript
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createClient } from "@/lib/supabase/client";

export interface AuthValidationResult {
  isValid: boolean;
  shouldSignOut: boolean;
  error?: string;
}

type AddToastFunction = (message: string, type: "success" | "error") => void;

export async function validateSession(): Promise<AuthValidationResult> {
  const supabase = createClient();

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      return { isValid: false, shouldSignOut: true, error: "Session corrupted" };
    }

    if (!session) {
      return { isValid: false, shouldSignOut: false, error: "No session found" };
    }

    const { error: userError } = await supabase.auth.getUser();

    if (userError?.code === "user_not_found") {
      return { isValid: false, shouldSignOut: true, error: "User no longer exists" };
    }

    if (userError) {
      return { isValid: false, shouldSignOut: true, error: "Authentication error" };
    }

    return { isValid: true, shouldSignOut: false };
  } catch (error) {
    console.error("Session validation failed:", error);
    return { isValid: false, shouldSignOut: true, error: "Session validation failed" };
  }
}

export async function handleAuthError(
  // biome-ignore lint/suspicious/noExplicitAny: error type varies
  error: any,
  router: AppRouterInstance,
  addToast?: AddToastFunction,
) {
  const supabase = createClient();

  if (error?.code === "user_not_found" || error?.shouldSignOut) {
    await supabase.auth.signOut();
    if (addToast) {
      addToast("Session expired. Please sign in again.", "error");
    }
    router.push("/auth/signin");
    return true;
  }

  return false;
}
```

**Step 2: Commit**

```bash
git add apps/console/src/lib/auth-helpers.ts
git commit -m "feat: add auth validation and error handling helpers"
```

---

### Task 8: Sign in page

**Files:**
- Create: `apps/console/src/app/auth/signin/page.tsx`

**Step 1: Create sign in page**

This is the main sign in page with email/password, Google OAuth, and dev auth.

Key adaptations from platform:
- Import `Button`, `Input`, `useToast` from `@superserve/ui` instead of local components
- Import `Eye`, `EyeOff` from `lucide-react`
- Use `@superserve/ui` styling (no custom `authInputClass` — use the library's default input styling)

```tsx
"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { createClient } from "@/lib/supabase/client";

const DEV_AUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH === "true";
const DEV_EMAIL =
  process.env.NEXT_PUBLIC_DEV_AUTH_EMAIL || "dev@superserve.local";
const DEV_PASSWORD =
  process.env.NEXT_PUBLIC_DEV_AUTH_PASSWORD || "dev-password-123";

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function Spinner() {
  return (
    <div className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full" />
  );
}

function SignInContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { addToast } = useToast();

  const nextUrl = searchParams.get("next") || "/";

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) { await supabase.auth.signOut(); return; }
        if (session) {
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          if (userError || !user) { await supabase.auth.signOut(); return; }
          if (nextUrl.startsWith("http")) { window.location.href = nextUrl; return; }
          router.push(nextUrl !== "/" ? nextUrl : "/");
        }
      } catch { await supabase.auth.signOut(); }
    };
    checkUser();
  }, [router, supabase.auth, nextUrl]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { addToast("Please enter your email and password.", "error"); return; }
    setIsEmailLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes("Invalid login credentials")) addToast("Invalid email or password.", "error");
        else if (error.message.includes("Email not confirmed")) addToast("Please verify your email before signing in.", "error");
        else addToast(error.message, "error");
        return;
      }
      if (nextUrl.startsWith("http")) { window.location.href = nextUrl; return; }
      router.push(nextUrl !== "/" ? nextUrl : "/");
    } catch (err) {
      console.error("Email sign in error:", err);
      addToast("Error signing in. Please try again.", "error");
    } finally { setIsEmailLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (nextUrl !== "/") callbackUrl.searchParams.set("next", nextUrl);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      if (error) { console.error("Error signing in:", error); addToast("Error signing in. Please try again.", "error"); }
    } catch (err) {
      console.error("Sign in error:", err);
      addToast("Error signing in. Please try again.", "error");
    } finally { setIsLoading(false); }
  };

  const handleDevSignIn = async () => {
    if (!DEV_AUTH_ENABLED) return;
    setIsDevLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          const { error: signUpError } = await supabase.auth.signUp({
            email: DEV_EMAIL, password: DEV_PASSWORD, options: { data: { full_name: "Dev User" } },
          });
          if (signUpError) { addToast("Dev auth failed. Check console.", "error"); return; }
          const { error: signInError } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
          if (signInError) { addToast("Dev auth failed. Check console.", "error"); return; }
        } else { addToast("Dev auth failed. Check console.", "error"); return; }
      }
      if (nextUrl.startsWith("http")) { window.location.href = nextUrl; return; }
      router.push(nextUrl !== "/" ? nextUrl : "/");
    } catch { addToast("Dev auth failed. Check console.", "error"); }
    finally { setIsDevLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary-bg" />
        <div className="relative z-10 flex items-center justify-center w-full h-full">
          <Link href="/">
            <img src="/logo.svg" alt="Superserve" className="h-16 w-auto" />
          </Link>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 lg:p-12">
        <div className="lg:hidden mb-8">
          <Link href="/">
            <img src="/logo.svg" alt="Superserve" className="h-8 w-auto" />
          </Link>
        </div>

        <div className="w-full max-w-sm">
          <div className="p-8 border border-dashed border-border animate-fade-in bg-surface [animation-duration:0.5s]">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2">
              Welcome Back
            </h1>
            <p className="text-center mb-8 text-sm text-muted">
              Sign in to continue to Superserve
            </p>

            <form onSubmit={handleEmailSignIn} className="space-y-4 mb-6">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                suffix={
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="p-0.5 text-muted">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                }
              />
              <div className="flex justify-end">
                <Link href="/auth/forgot-password" className="text-xs hover:underline text-primary">
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" disabled={isEmailLoading} className="w-full">
                {isEmailLoading ? <Spinner /> : null}
                {isEmailLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-surface text-muted">or</span>
              </div>
            </div>

            <Button type="button" variant="outline" onClick={handleGoogleSignIn} disabled={isLoading} className="w-full gap-3">
              {isLoading ? <Spinner /> : <GoogleIcon />}
              {isLoading ? "Signing in..." : "Continue with Google"}
            </Button>

            {DEV_AUTH_ENABLED && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-dashed border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 py-1 bg-primary-bg text-primary">Dev Only</span>
                  </div>
                </div>
                <Button type="button" onClick={handleDevSignIn} disabled={isDevLoading} className="w-full">
                  {isDevLoading ? <Spinner /> : null}
                  {isDevLoading ? "Signing in..." : "Dev Sign In"}
                </Button>
              </>
            )}

            <p className="text-sm text-center mt-6 text-muted">
              Don&apos;t have an account?{" "}
              <Link href="/auth/signup" className="hover:underline font-medium text-primary">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner /></div>}>
      <SignInContent />
    </Suspense>
  );
}
```

**Step 2: Verify the page renders**

```bash
bunx turbo run dev --filter=@superserve/console
```
Visit `http://localhost:3001/auth/signin/` — should show the sign in form.

**Step 3: Commit**

```bash
git add apps/console/src/app/auth/signin/
git commit -m "feat: add sign in page with email, Google OAuth, and dev auth"
```

---

### Task 9: Sign up page and server action

**Files:**
- Create: `apps/console/src/app/auth/signup/page.tsx`
- Create: `apps/console/src/app/auth/signup/action.ts`

**Step 1: Create signup server action**

Adapted from platform — uses admin client to generate signup link, sends confirmation email, notifies Slack.

```typescript
"use server";

import { sendEmail } from "@/lib/email/send";
import { ConfirmationEmail } from "@/lib/email/templates/confirmation";
import { WelcomeEmail } from "@/lib/email/templates/welcome";
import sendToSlackHook from "@/lib/slack/send-to-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
  redirectTo: string,
) => {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { full_name: fullName },
        redirectTo,
      },
    });

    if (error) {
      if (error.message.includes("already registered")) {
        return { success: false, error: "An account with this email already exists." };
      }
      return { success: false, error: error.message };
    }

    const tokenHash = data?.properties?.hashed_token;
    if (!tokenHash) {
      return { success: false, error: "Failed to generate confirmation link." };
    }

    const confirmationUrl = `${redirectTo}?token_hash=${tokenHash}&type=signup`;

    await sendEmail({
      to: email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({ confirmationUrl }),
    });

    notifySlack(email, fullName).catch(() => {});

    return { success: true };
  } catch (err) {
    console.error("Signup error:", err);
    return { success: false, error: "Error creating account. Please try again." };
  }
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const dashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai";
    await sendEmail({
      to: email,
      subject: "Welcome to Superserve!",
      react: WelcomeEmail({ name: name || "there", dashboardUrl }),
    });
  } catch (error) {
    console.error("Error sending welcome email:", error);
  }
};

const notifySlack = async (email: string, fullName: string) => {
  try {
    await sendToSlackHook({
      text: "New User Sign Up",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "New User Sign Up", emoji: true } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Email:* ${email}` },
          { type: "mrkdwn", text: `*Name:* ${fullName || "N/A"}` },
          { type: "mrkdwn", text: "*Provider:* email" },
        ]},
        { type: "divider" },
        { type: "context", elements: [{ type: "mrkdwn", text: `Signed up on ${new Date().toLocaleString()}` }] },
      ],
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
};
```

**Step 2: Create sign up page**

Same pattern as sign in — use `@superserve/ui` components. Includes email/password form, Google OAuth, email verification confirmation state. See platform's `signup/page.tsx` for the full UI structure — adapt by replacing `@/components/ui/*` imports with `@superserve/ui` imports and using the UI library's default styling (no `authInputClass`).

**Step 3: Commit**

```bash
git add apps/console/src/app/auth/signup/
git commit -m "feat: add sign up page with email verification and Google OAuth"
```

---

### Task 10: Forgot password and reset password pages

**Files:**
- Create: `apps/console/src/app/auth/forgot-password/page.tsx`
- Create: `apps/console/src/app/auth/forgot-password/action.ts`
- Create: `apps/console/src/app/auth/reset-password/page.tsx`

**Step 1: Create forgot password server action**

```typescript
"use server";

import { sendEmail } from "@/lib/email/send";
import { PasswordResetEmail } from "@/lib/email/templates/password-reset";
import { createAdminClient } from "@/lib/supabase/admin";

export const sendPasswordResetEmail = async (
  email: string,
  redirectTo: string,
) => {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error || !data?.properties?.hashed_token) {
      console.error("Error generating reset link:", error?.message);
      return { success: true }; // Always return success to prevent email enumeration
    }

    const resetUrlObj = new URL(redirectTo);
    resetUrlObj.searchParams.set("token_hash", data.properties.hashed_token);
    resetUrlObj.searchParams.set("type", "recovery");

    await sendEmail({
      to: email,
      subject: "Reset your Superserve password",
      react: PasswordResetEmail({ email, resetUrl: resetUrlObj.toString() }),
    });

    return { success: true };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return { success: true }; // Always return success to prevent email enumeration
  }
};
```

**Step 2: Create forgot password page**

Same split-layout pattern. Email input, sends reset link, shows confirmation. Import from `@superserve/ui`. See platform's `forgot-password/page.tsx` for full structure.

**Step 3: Create reset password page**

Same split-layout pattern. New password + confirm password with visibility toggles. Uses client-side `supabase.auth.updateUser()`. See platform's `reset-password/page.tsx` for full structure.

**Step 4: Commit**

```bash
git add apps/console/src/app/auth/forgot-password/ apps/console/src/app/auth/reset-password/
git commit -m "feat: add forgot password and reset password pages"
```

---

### Task 11: Auth callback route and error page

**Files:**
- Create: `apps/console/src/app/auth/callback/route.ts`
- Create: `apps/console/src/app/auth/auth-code-error/page.tsx`

**Step 1: Create auth callback route handler**

Adapted from platform. Key change: redirect new users to `/` (dashboard) instead of `/early-access`.

```typescript
import { NextResponse } from "next/server";
import { sendWelcomeEmail } from "@/app/auth/signup/action";
import { notifySlackOfNewUser } from "@/app/auth/signin/action";
import { trackEvent } from "@/lib/posthog/actions";
import { createClient } from "@/lib/supabase/server";

const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/;

function buildRedirectUrl(origin: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || origin;
  return `${base}${path}`;
}

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/";
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next;
  return "/";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "signup" | "recovery" | "invite" | "magiclink" | "email" | null;
  let next = sanitizeNext(searchParams.get("next"));

  if (code || tokenHash) {
    const supabase = await createClient();

    let error = null;
    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code);
      error = result.error;
    } else if (tokenHash && type) {
      const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      error = result.error;
    }

    if (error) {
      console.error("Auth callback error:", error.message, { code: !!code, tokenHash: !!tokenHash, type });
    }

    if (!error) {
      if (next === "/auth/reset-password" || type === "recovery") {
        return NextResponse.redirect(buildRedirectUrl(origin, "/auth/reset-password"));
      }

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const createdAt = new Date(user.created_at);
        const now = new Date();
        const isNewUser = now.getTime() - createdAt.getTime() < 30000;

        if (isNewUser) {
          const provider = code ? user.app_metadata?.provider || "google" : "email";
          await trackEvent("signup_completed", user.id, { provider, email: user.email });
          await notifySlackOfNewUser(
            user.email || "",
            user.user_metadata?.full_name || null,
            user.app_metadata?.provider || null,
          );
          sendWelcomeEmail(user.email || "", user.user_metadata?.full_name || "there").catch(() => {});
        }

        if (next.startsWith("/device") || next.startsWith("https://")) {
          // keep redirect as-is
        } else {
          next = "/";
        }
      }

      if (next.startsWith("https://")) {
        return NextResponse.redirect(next);
      }
      return NextResponse.redirect(buildRedirectUrl(origin, next));
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
```

**Step 2: Create signin/action.ts for Slack notification**

```typescript
"use server";

import sendToSlackHook from "@/lib/slack/send-to-webhook";

export const notifySlackOfNewUser = async (
  email: string,
  fullName: string | null,
  provider: string | null,
) => {
  try {
    if (!email) return;
    await sendToSlackHook({
      text: "New User Sign Up",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "New User Sign Up", emoji: true } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Email:* ${email}` },
          { type: "mrkdwn", text: `*Name:* ${fullName || "N/A"}` },
          { type: "mrkdwn", text: `*Provider:* ${provider || "N/A"}` },
        ]},
        { type: "divider" },
        { type: "context", elements: [{ type: "mrkdwn", text: `Signed up on ${new Date().toLocaleString()}` }] },
      ],
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
};

export default notifySlackOfNewUser;
```

**Step 3: Create auth error page**

```tsx
import Link from "next/link";
import { Button, Card, CardContent } from "@superserve/ui";

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="text-center p-8">
          <h1 className="text-2xl font-bold mb-4">Authentication Error</h1>
          <p className="text-muted mb-6">
            Something went wrong during sign in. Please try again.
          </p>
          <Button asChild>
            <Link href="/auth/signin">Try Again</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add apps/console/src/app/auth/callback/ apps/console/src/app/auth/auth-code-error/ apps/console/src/app/auth/signin/action.ts
git commit -m "feat: add auth callback route handler and error page"
```

---

### Task 12: Device authorization page

**Files:**
- Create: `apps/console/src/app/device/page.tsx`

**Step 1: Create device page**

Adapted from platform's device page. Key points:
- Multi-state component: checking session, no code, not signed in, authorize, authorized
- Google OAuth and dev auth for inline sign-in
- Calls `NEXT_PUBLIC_API_URL/v1/auth/device-authorize` to authorize device
- PostHog tracking for `cli_device_authorized` event
- Use `@superserve/ui` components (Button, useToast)
- Use the UI library's styling instead of `bg-cream`, `bg-warm-white` — use `bg-background`, `bg-surface`

See platform's `device/page.tsx` for complete implementation. Adapt imports from `@superserve/ui`.

**Step 2: Commit**

```bash
git add apps/console/src/app/device/
git commit -m "feat: add CLI device authorization page"
```

---

### Task 13: Dashboard page (landing page after login)

**Files:**
- Modify: `apps/console/src/app/page.tsx`
- Create: `apps/console/src/app/action.ts` (early access Slack notification)

**Step 1: Create early access Slack action**

```typescript
"use server";

import sendToSlackHook from "@/lib/slack/send-to-webhook";

export const sendEarlyAccessToSlack = async (
  name: string,
  email: string,
  company: string,
  role: string,
  useCase: string,
) => {
  try {
    if (!name || !email) return;
    await sendToSlackHook({
      text: "New Early Access Request",
      blocks: [
        { type: "header", text: { type: "plain_text", text: "New Early Access Request", emoji: true } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Name:* ${name}` },
          { type: "mrkdwn", text: `*Email:* ${email}` },
          { type: "mrkdwn", text: `*Company:* ${company || "N/A"}` },
          { type: "mrkdwn", text: `*Role:* ${role || "N/A"}` },
        ]},
        { type: "section", text: { type: "mrkdwn", text: `*Use Case:*\n${useCase || "N/A"}` } },
        { type: "divider" },
        { type: "context", elements: [{ type: "mrkdwn", text: `Submitted on ${new Date().toLocaleString()}` }] },
      ],
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
};
```

**Step 2: Create dashboard page**

Adapted from platform's early-access page. Key changes:
- This IS the dashboard (`/`), not a gate — it's what everyone sees after login
- Uses `@superserve/ui` components (Button, Input, Textarea, FormField, Alert)
- Early access form submits directly to Supabase (insert into `early_access_requests` table)
- Also sends Slack notification via server action
- CLI install section with copy button
- Pre-fills name/email from Supabase auth session
- Uses `usePostHog` for analytics

Content sections:
1. Logo + header
2. CLI install command with copy button
3. Dashed divider
4. "Request dashboard access" expandable form (name, email, company, role, use case)
5. Footer with "Schedule a call" link

**Step 3: Verify page renders after login**

```bash
bunx turbo run dev --filter=@superserve/console
```
Sign in and verify redirect to dashboard with CLI install section and early access form.

**Step 4: Commit**

```bash
git add apps/console/src/app/page.tsx apps/console/src/app/action.ts
git commit -m "feat: add dashboard page with CLI install and early access form"
```

---

### Task 14: Static assets and final verification

**Files:**
- Create: `apps/console/public/logo.svg` (copy from platform)
- Create: `apps/console/public/favicon.svg` (copy from platform)

**Step 1: Copy static assets from platform**

```bash
cp /Users/nirnejak/Code/superserve/platform/app/public/logo.svg apps/console/public/logo.svg
cp /Users/nirnejak/Code/superserve/platform/app/public/favicon.svg apps/console/public/favicon.svg
```

If `favicon.svg` doesn't exist, create a simple one or copy whatever icon exists.

**Step 2: Run typecheck**

```bash
bunx turbo run typecheck --filter=@superserve/console
```
Expected: No type errors.

**Step 3: Run lint**

```bash
bunx turbo run lint --filter=@superserve/console
```
Expected: No lint errors. Fix any issues.

**Step 4: Run build**

```bash
bunx turbo run build --filter=@superserve/console
```
Expected: Build succeeds.

**Step 5: Manual verification checklist**

Start the dev server and verify each flow:
- [ ] `/auth/signin` — renders sign in form
- [ ] `/auth/signup` — renders sign up form
- [ ] `/auth/forgot-password` — renders forgot password form
- [ ] `/auth/reset-password` — renders reset password form
- [ ] `/device?code=test` — renders device authorization page
- [ ] `/device` (no code) — shows "Invalid Request" message
- [ ] `/auth/auth-code-error` — shows error page with retry button
- [ ] `/` — redirects to `/auth/signin` when not authenticated
- [ ] Sign in flow works end-to-end (with dev auth if configured)
- [ ] After login, dashboard shows CLI install + early access form

**Step 6: Commit**

```bash
git add apps/console/public/
git commit -m "feat: add static assets and verify console app"
```

---

### Task 15: Update root workspace awareness

**Step 1: Verify workspace resolution**

```bash
bun install
```
Ensure no workspace resolution errors.

**Step 2: Verify turbo recognizes the new app**

```bash
bunx turbo run build --filter=@superserve/console --dry
```
Expected: Shows `@superserve/console` in the build plan with `@superserve/ui` as dependency.

**Step 3: Final commit**

```bash
git add bun.lock
git commit -m "chore: update lockfile for console app"
```
