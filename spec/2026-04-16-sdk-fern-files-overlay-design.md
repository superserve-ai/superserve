# Fern Overlay for Data-Plane File Endpoints

**Date:** 2026-04-16
**Status:** Implemented (partially — see "Known issues")
**Scope:** Add `client.files.uploadFile` / `downloadFile` to the generated TypeScript and Python SDKs, and to the Fern-generated API Reference docs, without modifying the backend repo's `openapi.yaml` and without hand-writing any SDK code.

## Goal

Users of `@superserve/sdk` and `superserve` should be able to upload and download files to a sandbox using methods that live on the same client object as every other resource, with docs rendered cohesively alongside Sandboxes / Exec / System in the Fern-generated API Reference. All of this should happen via Fern's code generation pipeline — no hand-written SDK code, no backend spec changes.

## Background: why files are a special case

Superserve has two planes:

| Plane | Host | Auth | Purpose |
|---|---|---|---|
| **Control plane** | `api.superserve.ai` (+ staging/local) | `X-API-Key` (your `SUPERSERVE_API_KEY`) | Sandbox lifecycle, exec, system health. Documented in the backend's `openapi.yaml`. |
| **Data plane** | `boxd-{sandbox_id}.sandbox.superserve.ai` | `X-Access-Token` (per-sandbox HMAC, returned in `SandboxResponse.access_token`) | Direct-to-sandbox file transfer and terminal. **Not in the backend's `openapi.yaml`.** |

Data-plane operations go direct to the sandbox's edge proxy for speed — file uploads bypass the control plane entirely, so a multi-gigabyte upload doesn't bottleneck on `api.superserve.ai`. This is the same architecture E2B and Daytona use.

The cost of this architecture: files can't simply be "just another resource" in the OpenAPI spec, because

1. The host is **per-sandbox** — `boxd-{id}.sandbox.superserve.ai`, where `{id}` is a UUID that varies per call
2. The auth scheme is **different** — `X-Access-Token` instead of `X-API-Key`
3. The request body is **raw binary** — `application/octet-stream`, not JSON or multipart

Backend changes that would eliminate this friction (adding a control-plane proxy route at `POST /sandboxes/{id}/files`, or moving the data plane into the primary `openapi.yaml` with proper `x-fern-server-name` wiring) are viable long-term options but are out of scope for this iteration — we're committed to direct-to-data-plane for speed and don't want backend churn right now.

## Design: Fern overlay with named per-endpoint server

### The overlay file

`fern/overlay-files.yaml` declares the two data-plane endpoints on top of the fetched `openapi.yaml`. It is applied via Fern's `overrides:` field in `fern/generators.yml`.

The key pieces:

1. **`x-fern-server-name` on both the top-level servers AND the per-endpoint server.** Without names on both sides, Fern silently ignores per-endpoint `servers:` overrides. With names, Fern treats them as distinct environments the generated client can switch between.

2. **Per-endpoint `servers:` block with a templated URL.** The `/files` path declares `servers: [{ url: "https://boxd-{sandbox_id}.sandbox.superserve.ai", x-fern-server-name: SandboxDataPlane, variables: { sandbox_id: { default: "" } } }]`. This tells Fern "this endpoint lives at a different host", and Fern generates a second URL slot (`sandboxDataPlane`) on the environment object.

3. **New security scheme `accessToken`.** Declared under `components.securitySchemes` with `type: apiKey, in: header, name: X-Access-Token`. Fern recognizes that the `/files` endpoints use this scheme (not the control-plane `apiKey`) and exposes `requestOptions.accessToken` on the generated methods.

4. **`application/octet-stream` request and response bodies.** Fern's generators map these to binary types — `core.BinaryResponse` in TypeScript, `Iterator[bytes]` / `AsyncIterator[bytes]` in Python. Streaming is free.

### What Fern generates from this

**TypeScript (`packages/sdk/src/api/resources/files/client/Client.ts`):**

```ts
export class FilesClient {
  public uploadFile(
    request: Superserve.UploadFileRequest,
    requestOptions?: FilesClient.RequestOptions,
  ): core.HttpResponsePromise<void> { ... }

  public downloadFile(
    request: Superserve.DownloadFileRequest,
    requestOptions?: FilesClient.RequestOptions,
  ): core.HttpResponsePromise<core.BinaryResponse> { ... }
}
```

**Python (`packages/python-sdk/src/superserve/files/client.py`):**

```python
class FilesClient:
    def upload_file(
        self,
        *,
        path: str,
        request: Union[bytes, Iterator[bytes], AsyncIterator[bytes]],
        request_options: Optional[RequestOptions] = None,
    ) -> None: ...

    def download_file(
        self,
        *,
        path: str,
        request_options: Optional[RequestOptions] = None,
    ) -> Iterator[bytes]: ...
```

Plus an async variant (`AsyncFilesClient`) with the same methods and `AsyncIterator[bytes]` return types.

**Environments (`packages/sdk/src/environments.ts`):**

The `SuperserveEnvironment` constant is now an object with two URLs per environment:

```ts
export const SuperserveEnvironment = {
  Staging:    { base: "https://api-staging.superserve.ai", sandboxDataPlane: "https://boxd-.sandbox.superserve.ai" },
  Production: { base: "https://api.superserve.ai",         sandboxDataPlane: "https://boxd-.sandbox.superserve.ai" },
  Local:      { base: "http://localhost:8080",             sandboxDataPlane: "https://boxd-.sandbox.superserve.ai" },
} as const
```

Methods on `client.sandboxes.*`, `client.exec.*`, `client.system.*` resolve URLs against `.base`; methods on `client.files.*` resolve against `.sandboxDataPlane`. This selection is automatic — Fern's generator wires each operation to the right URL based on which server block covers the path.

## The unavoidable ergonomics wart: per-call `baseUrl`

### The problem

Fern's server variables are templated at **build time**, using the variable's `default` value. The expected use case is something like "AWS region" or "API version number" — a value set once at client initialization and used for every call. Our `{sandbox_id}` is per-call, which doesn't fit this model.

As a result, the generated environment object has `sandboxDataPlane: "https://boxd-.sandbox.superserve.ai"` with the `{sandbox_id}` variable substituted to empty string at generation time. Calling `client.files.downloadFile(...)` without additional configuration would hit `https://boxd-.sandbox.superserve.ai/files` — an invalid URL.

I tried several OpenAPI shapes to make Fern substitute `sandbox_id` per-call:

1. **Declaring `sandbox_id` as a header parameter alongside the server variable.** Fern treated them as two separate things — the header got added to the request, the server URL stayed templated at build time. No link.
2. **Declaring `sandbox_id` as a path parameter.** Same result.
3. **Using `x-fern-default-url` on the per-endpoint server.** Provides a fallback URL when the variable is unset, but still no per-call substitution mechanism.

No Fern extension or OpenAPI shape I could find links a request parameter to a server variable. This appears to be a genuine gap in Fern's code generators (the docs explicitly note "Python and Java are currently supported" for dynamic server URLs, and even there the mechanism is client-init, not per-call).

### The workaround

Both generators respect a per-request `baseUrl` override. Users construct the sandbox-specific URL themselves and pass it on each call:

**TypeScript:**

```ts
import { SuperserveClient } from "@superserve/sdk"

const client = new SuperserveClient({ apiKey: process.env.SUPERSERVE_API_KEY! })

const sandbox = await client.sandboxes.createSandbox({ name: "my-sandbox" })
// access_token is populated on SandboxResponse, but users should also be
// prepared to re-fetch via getSandbox if the token is empty/stale.

await client.files.uploadFile(
  { path: "/home/user/data.txt", body: fileBytes },
  {
    baseUrl: `https://boxd-${sandbox.id}.sandbox.superserve.ai`,
    accessToken: sandbox.access_token!,
  },
)

const response = await client.files.downloadFile(
  { path: "/home/user/data.txt" },
  {
    baseUrl: `https://boxd-${sandbox.id}.sandbox.superserve.ai`,
    accessToken: sandbox.access_token!,
  },
)
// response is a core.BinaryResponse — ReadableStream or Blob depending on runtime
```

**Python (sync):**

```python
from superserve import Superserve
from superserve.core.request_options import RequestOptions

client = Superserve(api_key=os.environ["SUPERSERVE_API_KEY"])

sandbox = client.sandboxes.create_sandbox(name="my-sandbox")

with open("local.txt", "rb") as f:
    client.files.upload_file(
        path="/home/user/data.txt",
        request=f.read(),
        request_options=RequestOptions(
            base_url=f"https://boxd-{sandbox.id}.sandbox.superserve.ai",
            additional_headers={"X-Access-Token": sandbox.access_token},
        ),
    )

for chunk in client.files.download_file(
    path="/home/user/data.txt",
    request_options=RequestOptions(
        base_url=f"https://boxd-{sandbox.id}.sandbox.superserve.ai",
        additional_headers={"X-Access-Token": sandbox.access_token},
    ),
):
    handle(chunk)
```

**Python (async):** identical shape, `await` the methods, `async for` the download stream.

Three extra lines per call. Not beautiful, but:

- ✅ Zero hand-written SDK code
- ✅ Cohesive API Reference docs (Files section rendered next to Sandboxes / Exec / System in the sidebar)
- ✅ Proper binary types — streaming upload and download work out of the box
- ✅ Proper auth handling — `accessToken` and `X-Access-Token` are separate from `X-API-Key`
- ✅ Typed `path` parameter, typed request/response

## File inventory

| File | Ownership | Purpose |
|---|---|---|
| `fern/overlay-files.yaml` | **Hand-written** | Declares the data-plane file endpoints. Checked into git. |
| `fern/generators.yml` | Hand-written | References the overlay via `overrides:` field. |
| `packages/sdk/src/api/resources/files/**` | Fern-generated | TypeScript `FilesClient`, request types, client exports. |
| `packages/sdk/src/environments.ts` | Fern-generated | Now a structured object with `{ base, sandboxDataPlane }` per environment. |
| `packages/sdk/src/Client.ts` | Fern-generated | `SuperserveClient` — now exposes `.files` getter alongside `.sandboxes`, `.exec`, `.system`. |
| `packages/python-sdk/src/superserve/files/**` | Fern-generated | Python `FilesClient` (sync + async). |
| `packages/python-sdk/src/superserve/environment.py` | Fern-generated | Structured `SuperserveEnvironment` class. |

## Maintenance

### Regenerating the SDK

`bun run generate` at the repo root continues to work unchanged. It curls the backend's `openapi.yaml`, Fern merges it with `overlay-files.yaml` (via the `overrides:` entry in `generators.yml`), and the generators emit the combined surface into `packages/sdk/src` and `packages/python-sdk/src/superserve`. The overlay persists across regenerations — Fern doesn't own or overwrite it.

### When the backend spec changes

If the backend team adds or changes other endpoints in `openapi.yaml`, those changes flow through to the generated SDK as normal on the next `bun run generate`. The overlay is additive — it only touches `/files`. Other endpoints are unaffected.

If the backend team adds the file endpoints to `openapi.yaml` directly (even without proper `x-fern-server-name` wiring), the overlay's operations will conflict. Fern's behavior on conflict is "overrides win" — our overlay takes precedence. To remove the overlay once the backend owns the spec, see "How to remove this overlay" below.

### When Fern's generators change

A Fern version bump could change how the generator handles per-endpoint servers, binary types, or the `environment` object shape. The failure modes to watch for on a version bump:

- The `environment.sandboxDataPlane` field disappears or gets renamed → generated `FilesClient` URL construction breaks
- Per-endpoint server override stops being respected → all methods use the top-level server → files methods hit `api.superserve.ai/files` and 404
- `core.BinaryResponse` / `Iterator[bytes]` return types change → consumer code stops compiling
- The `requestOptions.accessToken` / `request_options.additional_headers` passthrough mechanism changes

If any of these happen, inspect the generated `FilesClient.ts` or `files/client.py` by hand and confirm the URL construction still reaches the data plane. If the regression is a genuine Fern bug, pin the previous version in `fern/fern.config.json` and file an issue with Fern.

### How to remove this overlay

When it's time to retire the overlay (e.g., the backend team adds file endpoints to `openapi.yaml` with `x-fern-server-name: SandboxDataPlane` wiring of their own):

1. Delete `fern/overlay-files.yaml`
2. Remove the `overrides: ./overlay-files.yaml` line from `fern/generators.yml`
3. Run `bun run generate` to regenerate from just the backend spec
4. Delete the `baseUrl` + `accessToken` workaround paragraphs from `docs/pages/typescript-quickstart.mdx` and `docs/pages/python-quickstart.mdx`
5. Update this spec's status to "Superseded by backend-native spec"

Everything else stays. Consumer code that was using `client.files.upload_file(...)` with a per-call `baseUrl` would likely need a small update (remove the manual URL construction) but the method shape is unchanged.

## Known issues

### 1. Fern generator bugs we hit and worked around

During implementation I discovered two real bugs in Fern's code generators:

**Bug A: `upload_file` / `uploadFile` drops header parameters on operations with binary request bodies.**

The overlay declares `X-Access-Token` as a required header parameter on both `POST /files` (upload) and `GET /files` (download). Fern generated both methods, but:

- `downloadFile` (TS) / `download_file` (Python) correctly expose `X-Access-Token` as a required field on the request type / as a kwarg on the method.
- `uploadFile` (TS) / `upload_file` (Python) **silently drop the header param** — the generated `UploadFileRequest` type has only `{ path }` and the method body only sends `Content-Type: application/octet-stream`, not `X-Access-Token`.

This appears to be because the generator treats header params as request-body candidates, and the binary `application/octet-stream` request body wins. The workaround for upload is to use `requestOptions.headers` (TS) / `request_options.additional_headers` (Python) to inject the header manually:

```ts
// TS upload — header passed via requestOptions.headers
await client.files.uploadFile(
  bytes,
  { path: "/home/user/foo.txt" },
  { headers: { "X-Access-Token": sandbox.access_token! } },
)
```

```python
# Python upload — header passed via request_options.additional_headers
client.files.upload_file(
    path="/home/user/foo.txt",
    request=content,
    request_options={
        "additional_headers": {"X-Access-Token": sandbox.access_token},
    },
)
```

`downloadFile` / `download_file` take the token as a normal field/kwarg. **Both methods work end-to-end**, but the asymmetry is ugly and should be fixed upstream in Fern's generators.

**Bug B: security schemes become top-level constructor args in Python.**

My first version of the overlay declared `X-Access-Token` as a top-level security scheme under `components.securitySchemes`. Fern's Python generator promoted this to a **required kwarg on the `Superserve.__init__`** constructor — `Superserve(api_key=..., access_token=...)`. This is a fundamentally broken model since `access_token` varies per sandbox, not per client.

The workaround was to declare `X-Access-Token` as a plain header parameter on each operation instead of as a security scheme. This keeps it per-call in Python (modulo Bug A on upload). Fern's TS generator handled the security scheme version correctly via `requestOptions.accessToken` — the bug is Python-specific.

### 2. The `baseUrl` override story is language-specific and ugly

Every files call needs to hit the data-plane URL `https://boxd-${sandbox.id}.sandbox.superserve.ai`. The two generators handle this differently:

- **TypeScript**: `BaseRequestOptions` does NOT include `baseUrl`. The only way to change the host is at client construction via `new SuperserveClient({ apiKey, baseUrl: ... })`. Users instantiate a second `SuperserveClient` per sandbox for data-plane operations.
- **Python**: `RequestOptions` also has no `base_url`. The Python generator goes further and removes the top-level `base_url` constructor kwarg entirely after the overlay — instead, the client takes `environment: SuperserveEnvironment`, which is a structured object with both `base` and `sandbox_data_plane` URLs. Users instantiate a second `Superserve` per sandbox with a custom `SuperserveEnvironment` whose `sandbox_data_plane` is set to this sandbox's host.

Both patterns are documented in the quickstarts. Both work. Neither is pretty.

If ergonomics become a real pain point, the path forward is either (a) a `@superserve/sdk-helpers` companion package that wraps the generated client with a `sandbox.files.*` shim, or (b) asking the backend team to restructure the spec so Fern can generate a cleaner method shape (e.g., move files to a `/sandboxes/{id}/files` path on the control plane host with a proxy route).

### 3. Staging data-plane auth is returning 401 "invalid access token"

During validation, I built a probe that:

1. Creates a sandbox via `POST /sandboxes`
2. Waits for `status: active`
3. Fetches the sandbox via `GET /sandboxes/{id}`
4. Uses `sandbox.access_token` to call the data plane directly via `curl`

**Result:** the data plane returns `401 Unauthorized` with body `invalid access token`, using the exact token returned by the API (confirmed — tokens from CREATE and GET responses are byte-identical). This is not caused by the overlay — it's a separate issue in the staging data plane that would affect the console too.

**Impact on this design:** the overlay is architecturally validated (TLS handshake succeeds, host routing works, the edge proxy responds), but end-to-end file operations can't be tested on staging until this is resolved. The file e2e tests in `tests/sdk-e2e-ts/` and `tests/sdk-e2e-py/` have not been written yet — they'd be red on every run.

**Action item:** file a backend ticket for the staging data-plane auth issue. Once resolved, add files test coverage to both e2e suites (one sync upload+download roundtrip per language, using the per-call `baseUrl`+`accessToken` pattern).

## Implementation checklist

- [x] Write `fern/overlay-files.yaml`
- [x] Add `overrides: ./overlay-files.yaml` to `fern/generators.yml`
- [x] Run `bun run generate`, verify `FilesClient` is generated in both languages
- [x] Run `bunx turbo run typecheck` across affected packages, verify clean
- [x] Update `docs/pages/typescript-quickstart.mdx` with a "Upload and download files" section showing the per-sandbox data-plane client pattern
- [x] Update `docs/pages/python-quickstart.mdx` with the same section (Python variant with `SuperserveEnvironment`)
- [x] Add `tests/sdk-e2e-ts/tests/files.test.ts` — round-trip upload → download test, gated on credentials
- [x] Add `tests/sdk-e2e-py/test_files.py` — equivalent Python test with per-sandbox client + `additional_headers` workaround
- [x] Fix `tests/sdk-e2e-py/conftest.py` — switched from removed `base_url=` kwarg to `environment=SuperserveEnvironment(...)`
- [x] Fix TS + Python pause/resume test expectations — backend returns `"paused"` now, spec still documents `"idle"`
- [ ] Run `bun run docs:publish` — blocked, needs `FERN_TOKEN` and manual confirmation
- [ ] File a backend ticket for the staging data-plane 401
- [ ] Once the auth issue is resolved: remove the e2e files test from the "known failing" list
- [ ] Once everything works: commit all changes

## Open questions (for the backend team)

- Can the data plane auth issue on staging be investigated? Tokens from `POST /sandboxes` are byte-identical to tokens from `GET /sandboxes/{id}`, but both return `401 "invalid access token"` when sent to `https://boxd-{id}.sandbox.superserve.ai/files?path=/home/user/foo.txt`.
- Would the backend team consider adding these endpoints to the primary `api/openapi.yaml` with proper `x-fern-server-name: SandboxDataPlane` wiring? That would let us delete this overlay and have a single source of truth.
- If not, would the backend team consider adding a control-plane proxy route at `POST /sandboxes/{id}/files?path=...` that forwards to the data plane? That would give us native-shape method generation with no overlay, no per-call `baseUrl`, and no ergonomics wart — at the cost of the control plane mediating all file traffic (undoing the point of the data plane).

The first question is urgent (blocks real usage). The second and third are nice-to-haves that would eventually let us delete this design entirely.
