# RBAC Phase 4 Console UI

## Feature flag

The customer-facing User Management UI is disabled by default. Enable it with either environment variable:

- `NEXT_PUBLIC_ENABLE_TEAM_MANAGEMENT=true` to show the console navigation item and render `/user-management`.
- `ENABLE_TEAM_MANAGEMENT=true` for server-side route checks in environments where the public flag is not set separately.

When the flag is off, `/user-management` and `/api/team-management` fail closed with a 404-style response.

## Customer behavior

The console page uses `/api/team-management`, a console-owned proxy that resolves the authenticated user's current team server-side and forwards to the Phase 2/Phase 4 customer RBAC endpoints:

- `GET /teams/:team_id/management`
- `POST /teams/:team_id/members`
- `DELETE /teams/:team_id/members/:user_id`
- `POST /teams/:team_id/roles`
- `DELETE /teams/:team_id/roles/:assignment_id`

The browser never supplies `team_id`, `X-Actor-User-Id`, platform actor headers, or raw API keys. The proxy strips client-supplied actor/API-key headers and injects the same server-derived customer API key used by the rest of the console.

## Authorization model

The UI treats `capabilities` from `GET /teams/:team_id/management` as display hints only:

- Viewers can see members but do not see invite, deactivate, assign-role, or revoke-role controls.
- Team owners, team admins, and user admins only see controls advertised by the backend read model.
- All writes still go to the Phase 2 customer endpoints, so backend RBAC remains authoritative for 403, 404, 409, last-owner protection, inactive/invited handling, and privileged reactivation checks.

## Internal separation

The console route does not call `/internal/...` endpoints. Staff impersonation remains read-only for this surface: `GET /api/team-management` may be proxied to the impersonated team, but writes return 403 before reaching the sandbox API.

## Error handling

The frontend preserves backend error responses and maps the important RBAC statuses to clear user-facing messages:

- `403`: the actor is not allowed to perform the action.
- `404`: the team, member, role, or assignment no longer exists.
- `409`: the change conflicts with current team state, including last-owner failures.
