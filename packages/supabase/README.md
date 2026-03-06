# @superserve/supabase

Shared Supabase client factories for Superserve apps. Handles env var validation, cookie domain config, and Next.js cookie integration.

## Setup

Add to your app's `package.json`:

```json
"@superserve/supabase": "workspace:*"
```

### Environment Variables

| Variable | Required | Context | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | All | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | All | Supabase anonymous key |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | No | All | Cookie domain (e.g. `.superserve.ai`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Only for admin | Server only | Service role key (never expose to client) |

## Usage

### Browser Client

For client components and event handlers. Runs in the browser.

```ts
import { createBrowserClient } from "@superserve/supabase";

const supabase = createBrowserClient();
const { data } = await supabase.auth.getSession();
```

### Server Client

For server components, route handlers, and server actions. Uses Next.js `cookies()` for auth.

```ts
import { createServerClient } from "@superserve/supabase/server";

const supabase = await createServerClient();
const { data: { user } } = await supabase.auth.getUser();
```

### Admin Client

For server-side operations that bypass Row Level Security (e.g. generating auth links, managing users). Uses the service role key — never use in client code.

```ts
import { createAdminClient } from "@superserve/supabase/admin";

const supabase = createAdminClient();
const { data } = await supabase.auth.admin.generateLink({ ... });
```

### Middleware Client

For Next.js middleware auth guards. Returns `{ supabase, response }` — returns `null` supabase if env vars are missing (graceful degradation).

```ts
import { createMiddlewareClient, matchesRoute } from "@superserve/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  if (!supabase) return response;

  const { data: { user } } = await supabase.auth.getUser();
  // ... auth logic
  return response;
}
```

`matchesRoute(pathname, routes)` is a helper that checks if a pathname starts with any route in the array.

## Exports

| Import path | Function | Context |
|---|---|---|
| `@superserve/supabase` | `createBrowserClient()` | Client components |
| `@superserve/supabase/server` | `createServerClient()` | Server components, route handlers |
| `@superserve/supabase/admin` | `createAdminClient()` | Server actions (bypasses RLS) |
| `@superserve/supabase/middleware` | `createMiddlewareClient()`, `matchesRoute()` | Next.js middleware |
