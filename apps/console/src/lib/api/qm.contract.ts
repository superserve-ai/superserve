/**
 * Binds the hand-written hosted-QM types to the generated contract.
 *
 * `types.ts` and `qm.ts` are hand-written because the console wants its own
 * naming and doc comments, but they describe qm-api's `/v1/qm/*` operations,
 * which live in another repo. Everything below is a compile-time assertion:
 * if the vendored spec changes shape, `bun run typecheck` fails here instead
 * of the console silently mis-reading a response at runtime.
 *
 * The client functions in `qm.ts` call the proxy, which rewrites
 * `/api/qm/<rest>` to `<qm-api>/v1/qm/<rest>`, so a client path of
 * `/qm/tenants` is the spec's `/v1/qm/tenants`. The hooks in
 * `hooks/use-qm-tenants.ts` take their types from those functions, so binding
 * the client covers them too.
 *
 * Nothing here is imported at runtime; the file exists only for tsc.
 */

import type * as qmClient from "./qm"
import type { components, paths } from "./qm.generated"
import type {
  CreateQmTenantRequest,
  QmAdminLink,
  QmHarness,
  QmModelProvider,
  QmSignIn,
  QmSlugAvailability,
  QmTenant,
  QmTenantDetailResponse,
  QmTenantEvent,
  QmTenantEventStatus,
  QmTenantListResponse,
  QmTenantResponse,
  QmTenantStatus,
} from "./types"

/** True only when `A` and `B` are the same type, in both directions. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

type Assert<T extends true> = T

/**
 * JSON body of a response, by path, method, and status. Resolves to `never`
 * when the operation, status, or JSON body is absent, which then fails the
 * surrounding assertion.
 */
type JsonResponse<
  P extends keyof paths,
  M extends keyof paths[P],
  S extends PropertyKey,
> = paths[P][M] extends { responses: infer R }
  ? S extends keyof R
    ? R[S] extends { content: { "application/json": infer B } }
      ? B
      : never
    : never
  : never

/** JSON request body, by path and method. `never` when there is none. */
type JsonRequest<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends {
  requestBody: { content: { "application/json": infer B } }
}
  ? B
  : never

/**
 * The verbs a generated path item actually defines. openapi-typescript emits
 * every verb as a key and types the undefined ones `never`, so a plain
 * `keyof` would not notice a method change.
 */
type DefinedMethods<P> = {
  [M in Exclude<keyof P, "parameters">]-?: P[M] extends undefined ? never : M
}[Exclude<keyof P, "parameters">]

// --- Enums -----------------------------------------------------------------

export type QmSignInMatchesSpec = Assert<
  Exact<QmSignIn, components["schemas"]["QMTenant"]["signIn"]>
>
export type QmModelProviderMatchesSpec = Assert<
  Exact<QmModelProvider, components["schemas"]["QMTenant"]["modelProvider"]>
>
export type QmHarnessMatchesSpec = Assert<
  Exact<QmHarness, components["schemas"]["QMTenant"]["harness"]>
>
export type QmTenantStatusMatchesSpec = Assert<
  Exact<QmTenantStatus, components["schemas"]["QMTenant"]["status"]>
>
export type QmTenantEventStatusMatchesSpec = Assert<
  Exact<QmTenantEventStatus, components["schemas"]["QMTenantEvent"]["status"]>
>

// --- Schemas ---------------------------------------------------------------

export type QmTenantMatchesSpec = Assert<
  Exact<QmTenant, components["schemas"]["QMTenant"]>
>
export type QmTenantEventMatchesSpec = Assert<
  Exact<QmTenantEvent, components["schemas"]["QMTenantEvent"]>
>
export type QmAdminLinkMatchesSpec = Assert<
  Exact<QmAdminLink, components["schemas"]["QMAdminLink"]>
>
export type QmSlugAvailabilityMatchesSpec = Assert<
  Exact<QmSlugAvailability, components["schemas"]["QMSlugAvailability"]>
>

// --- Operations ------------------------------------------------------------

export type ListTenantsMatchesSpec = Assert<
  Exact<QmTenantListResponse, JsonResponse<"/v1/qm/tenants", "get", 200>>
>
export type CreateTenantBodyMatchesSpec = Assert<
  Exact<CreateQmTenantRequest, JsonRequest<"/v1/qm/tenants", "post">>
>
export type CreateTenantMatchesSpec = Assert<
  Exact<QmTenantResponse, JsonResponse<"/v1/qm/tenants", "post", 202>>
>
export type GetTenantMatchesSpec = Assert<
  Exact<QmTenantDetailResponse, JsonResponse<"/v1/qm/tenants/{id}", "get", 200>>
>
export type DeleteTenantMatchesSpec = Assert<
  Exact<QmTenantResponse, JsonResponse<"/v1/qm/tenants/{id}", "delete", 202>>
>
export type RetryTenantMatchesSpec = Assert<
  Exact<
    QmTenantResponse,
    JsonResponse<"/v1/qm/tenants/{id}/retry", "post", 202>
  >
>
export type AdminLinkMatchesSpec = Assert<
  Exact<
    QmAdminLink,
    JsonResponse<"/v1/qm/tenants/{id}/admin-link", "post", 200>
  >
>
export type SlugAvailabilityMatchesSpec = Assert<
  Exact<
    QmSlugAvailability,
    JsonResponse<"/v1/qm/slugs/{slug}/availability", "get", 200>
  >
>

// --- Methods ---------------------------------------------------------------
// The verb matters as much as the payload. Minting an admin link is a POST so
// that the proxy's read-only impersonation guard refuses it; if the contract
// ever moved it to GET, `getQmAdminLink` would start handing credentials to
// read-only sessions. That would break here first.

export type TenantsMethodsMatchSpec = Assert<
  Exact<DefinedMethods<paths["/v1/qm/tenants"]>, "get" | "post">
>
export type TenantMethodsMatchSpec = Assert<
  Exact<DefinedMethods<paths["/v1/qm/tenants/{id}"]>, "get" | "delete">
>
export type RetryMethodMatchesSpec = Assert<
  Exact<DefinedMethods<paths["/v1/qm/tenants/{id}/retry"]>, "post">
>
export type AdminLinkMethodMatchesSpec = Assert<
  Exact<DefinedMethods<paths["/v1/qm/tenants/{id}/admin-link"]>, "post">
>
export type SlugAvailabilityMethodMatchesSpec = Assert<
  Exact<DefinedMethods<paths["/v1/qm/slugs/{slug}/availability"]>, "get">
>

// --- Client functions ------------------------------------------------------
// What each `qm.ts` function resolves to, checked against the spec rather
// than against the hand-written aliases it happens to be annotated with.

export type ListQmTenantsMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.listQmTenants>>,
    components["schemas"]["QMTenant"][]
  >
>
export type GetQmTenantMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.getQmTenant>>,
    JsonResponse<"/v1/qm/tenants/{id}", "get", 200>
  >
>
export type CreateQmTenantMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.createQmTenant>>,
    components["schemas"]["QMTenant"]
  >
>
export type CreateQmTenantArgMatchesSpec = Assert<
  Exact<
    Parameters<typeof qmClient.createQmTenant>[0],
    JsonRequest<"/v1/qm/tenants", "post">
  >
>
export type DeleteQmTenantMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.deleteQmTenant>>,
    components["schemas"]["QMTenant"]
  >
>
export type RetryQmTenantMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.retryQmTenant>>,
    components["schemas"]["QMTenant"]
  >
>
export type GetQmAdminLinkMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.getQmAdminLink>>,
    JsonResponse<"/v1/qm/tenants/{id}/admin-link", "post", 200>
  >
>
export type CheckQmSlugMatchesSpec = Assert<
  Exact<
    Awaited<ReturnType<typeof qmClient.checkQmSlug>>,
    JsonResponse<"/v1/qm/slugs/{slug}/availability", "get", 200>
  >
>
