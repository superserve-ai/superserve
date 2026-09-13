/**
 * Generated from openapi/qm.openapi.yaml — do not edit by hand.
 * Run `bun run --cwd apps/console qm:openapi` to refresh.
 *
 * src/lib/api/qm.contract.ts binds the hand-written types in types.ts to
 * these, so a contract change fails typecheck instead of failing at runtime.
 */
export interface paths {
    "/v1/qm/slugs/{slug}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check whether a slug can be used for a new tenant
         * @description Answers across every team. A slug that fails the format rules or is reserved is reported unavailable with a reason rather than as an error, so the console can show it inline.
         */
        get: operations["checkQMSlugAvailability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/qm/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the team's hosted QM tenants
         * @description Returns every non-deleted tenant owned by the authenticated team, newest first.
         */
        get: operations["listQMTenants"];
        put?: never;
        /**
         * Create a hosted QM tenant
         * @description Creates the tenant record and queues provisioning. The response is
         *     `202` with the tenant in status `provisioning`; poll
         *     `GET /v1/qm/tenants/{id}` for progress and events.
         *
         *     One tenant per team for now: a second request answers `409`. The
         *     slug becomes the tenant's hostname under the QM base domain, so it
         *     must be a DNS label of 3–40 characters and not one of the reserved
         *     names (`www`, `api`, `admin`, `mail`, `qm`, `app`, `console`,
         *     `docs`, `status`).
         *
         *     ## Model key handling
         *
         *     `modelKey` is written straight to Secret Manager
         *     (`qm-<slug>-<PROVIDER>_API_KEY`) by this request and is never
         *     logged or stored in Postgres. The provisioner run is then started
         *     with only the tenant id: Cloud Run Job overrides are visible in
         *     execution metadata, so the key never travels through them. The key
         *     is checked for shape only here; whether the provider accepts it is
         *     verified during provisioning.
         *
         *     Authorization follows the control plane's team roles: the key's
         *     holder needs `settings:write` here and `settings:read` for the
         *     read operations. The console's read-only impersonation key
         *     receives `403`.
         */
        post: operations["createQMTenant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/qm/tenants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        /** Get a tenant and its provisioning events */
        get: operations["getQMTenant"];
        put?: never;
        post?: never;
        /**
         * Delete a tenant
         * @description Moves a `ready` or `failed` tenant to `deprovisioning` and queues
         *     the teardown, which ends in status `deleted`. A tenant whose run is
         *     still in flight answers `409`; wait for it to settle first.
         */
        delete: operations["deleteQMTenant"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/qm/tenants/{id}/admin-link": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mint an admin sign-in link for the tenant's portal
         * @description Returns a single-use link, valid for five minutes, that signs the
         *     tenant's admin into its QM portal. The link is signed with the
         *     tenant's portal session secret, which is read from Secret Manager
         *     per request and never stored. This is a `POST` so that read-only
         *     (impersonation) keys cannot mint one. The tenant must be `ready`.
         */
        post: operations["mintQMAdminLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/qm/tenants/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry a failed tenant
         * @description Re-queues the plan the tenant was last running (provision or
         *     deprovision). Every step is idempotent, so the run resumes from the
         *     step that failed. Only a `failed` tenant can be retried, and a
         *     tenant whose model key was never stored cannot be (`409`): the key
         *     is only supplied at create time, so delete it and create it again.
         */
        post: operations["retryQMTenant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        QMAdminLink: {
            /**
             * Format: uri
             * @description Open in a browser; the signed token rides in the URL fragment.
             */
            url: string;
            /** Format: date-time */
            expiresAt: string;
        };
        QMCreateTenantRequest: {
            slug: string;
            orgName: string;
            /**
             * Format: email
             * @description The organization admin; admin sign-in links are minted for this address.
             */
            adminEmail: string;
            /** @enum {string} */
            signIn: "magic_link" | "slack";
            /** @enum {string} */
            modelProvider: "anthropic" | "openai" | "openrouter";
            /** @description Provider API key. Stored in Secret Manager only; see the operation description. */
            modelKey: string;
            /**
             * @default pi
             * @enum {string}
             */
            harness?: "pi" | "claude" | "codex" | "opencode";
        };
        QMError: {
            error: string;
        };
        QMFieldError: {
            error: string;
            /** @description Field name to message for each invalid field. */
            fields: {
                [key: string]: string;
            };
        };
        QMSlugAvailability: {
            available: boolean;
            /** @description Present when `available` is false. */
            reason?: string;
        };
        QMTenant: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            teamId: string;
            /** @description DNS label; the tenant is served at `https://<slug>.<qm base domain>`. */
            slug: string;
            orgName: string;
            /** Format: email */
            adminEmail: string;
            /** @enum {string} */
            signIn: "magic_link" | "slack";
            /** @enum {string} */
            modelProvider: "anthropic" | "openai" | "openrouter";
            /** @enum {string} */
            harness: "pi" | "claude" | "codex" | "opencode";
            /** @enum {string} */
            status: "provisioning" | "ready" | "failed" | "deprovisioning" | "deleted";
            /** @description Set once the tenant's service is deployed. */
            publicUrl: string | null;
            imageTag: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        QMTenantEvent: {
            /** Format: uuid */
            id: string;
            /** @description Provisioner step name, in plan order (`secrets`, `service_account`, `database`, `bucket`, `cloud_run`, `load_balancer`, `health_check`, `smoke`, `admin_link`), or `run` for the run as a whole, `model_key` and `trigger` for the API's own bookkeeping. */
            step: string;
            /** @enum {string} */
            status: "started" | "ok" | "failed" | "skipped";
            message: string | null;
            /** @description Step-specific data; anything secret-shaped is redacted before it is stored. */
            detail: {
                [key: string]: unknown;
            } | null;
            /** Format: date-time */
            at: string;
        };
    };
    responses: {
        /** @description The tenant's status does not allow this operation */
        QMConflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
        /** @description The key's holder lacks the team permission (`settings:read` for reads, `settings:write` for mutations), or the key is the console's impersonation key, which reads only with the `platform:qm:read` scope and never mutates */
        QMForbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
        /** @description Unexpected failure */
        QMInternalError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
        /** @description No such tenant in this team (deleted tenants are not found) */
        QMNotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
        /** @description The provisioner run could not be started. If the refusal was definite the tenant is marked `failed` and can be retried; if the start merely could not be confirmed it stays in flight until the run reports or goes stale. */
        QMRunNotStarted: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
        /** @description Invalid or missing X-API-Key header */
        QMUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["QMError"];
            };
        };
    };
    parameters: {
        QMTenantID: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    checkQMSlugAvailability: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Availability */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMSlugAvailability"];
                };
            };
            401: components["responses"]["QMUnauthorized"];
            500: components["responses"]["QMInternalError"];
        };
    };
    listQMTenants: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tenants owned by the team */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenants: components["schemas"]["QMTenant"][];
                    };
                };
            };
            401: components["responses"]["QMUnauthorized"];
            500: components["responses"]["QMInternalError"];
        };
    };
    createQMTenant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QMCreateTenantRequest"];
            };
        };
        responses: {
            /** @description Tenant created; provisioning queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenant: components["schemas"]["QMTenant"];
                    };
                };
            };
            /** @description The body is not a single JSON object, or one or more fields are invalid. Field-level problems carry a `fields` map. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMFieldError"];
                };
            };
            401: components["responses"]["QMUnauthorized"];
            403: components["responses"]["QMForbidden"];
            /** @description The team already has a tenant, the slug is taken, or the team is mid-migration to another region */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMError"];
                };
            };
            /** @description The request body exceeds 32 KiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMError"];
                };
            };
            500: components["responses"]["QMInternalError"];
            /** @description The tenant was created but its model key could not be stored or the provisioning run could not be started. A definite failure leaves it in status `failed` with an event describing which; a run whose start could not be confirmed leaves it `provisioning` until it reports progress or goes stale and becomes retryable. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMError"];
                };
            };
        };
    };
    getQMTenant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tenant and its event log, oldest event first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenant: components["schemas"]["QMTenant"];
                        events: components["schemas"]["QMTenantEvent"][];
                    };
                };
            };
            401: components["responses"]["QMUnauthorized"];
            404: components["responses"]["QMNotFound"];
            500: components["responses"]["QMInternalError"];
        };
    };
    deleteQMTenant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Teardown queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenant: components["schemas"]["QMTenant"];
                    };
                };
            };
            401: components["responses"]["QMUnauthorized"];
            403: components["responses"]["QMForbidden"];
            404: components["responses"]["QMNotFound"];
            409: components["responses"]["QMConflict"];
            500: components["responses"]["QMInternalError"];
            502: components["responses"]["QMRunNotStarted"];
        };
    };
    mintQMAdminLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A fresh sign-in link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMAdminLink"];
                };
            };
            401: components["responses"]["QMUnauthorized"];
            403: components["responses"]["QMForbidden"];
            404: components["responses"]["QMNotFound"];
            409: components["responses"]["QMConflict"];
            500: components["responses"]["QMInternalError"];
            /** @description The tenant's portal session secret could not be read */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QMError"];
                };
            };
        };
    };
    retryQMTenant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["QMTenantID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenant: components["schemas"]["QMTenant"];
                    };
                };
            };
            401: components["responses"]["QMUnauthorized"];
            403: components["responses"]["QMForbidden"];
            404: components["responses"]["QMNotFound"];
            409: components["responses"]["QMConflict"];
            500: components["responses"]["QMInternalError"];
            502: components["responses"]["QMRunNotStarted"];
        };
    };
}
