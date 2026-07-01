# RBAC Phase 4 Console UI

## Permission gate

The customer-facing User Management UI is shown only to staff users whose auth
claim includes `platform:teams:read`.

The console navigation item, `/user-management`, and `/api/team-management` all
fail closed with a 404-style response when the user lacks that permission.

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

The console route does not call `/internal/...` endpoints and does not forward platform actor headers from the browser.

## Error handling

The frontend preserves backend error responses and maps the important RBAC statuses to clear user-facing messages:

- `403`: the actor is not allowed to perform the action.
- `404`: the team, member, role, or assignment no longer exists.
- `409`: the change conflicts with current team state, including last-owner failures.
