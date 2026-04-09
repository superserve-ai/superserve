# Superserve SDK

TypeScript SDK for the [Superserve](https://superserve.ai) sandbox API — spin up isolated sandboxes, run commands in them, and tear them down from code.

## Install

```bash
npm install @superserve/sdk
# or
bun add @superserve/sdk
# or
yarn add @superserve/sdk
```

## Quick start

```ts
import { SuperserveClient } from "@superserve/sdk"

const client = new SuperserveClient({
  apiKey: process.env.SUPERSERVE_API_KEY!,
})

const sandbox = await client.sandboxes.createSandbox({
  name: "hello-world",
})

try {
  const result = await client.exec.command({
    sandbox_id: sandbox.id!,
    body: { command: "echo 'Hello from Superserve!'" },
  })
  console.log(result.stdout)
} finally {
  await client.sandboxes.deleteSandbox({ sandbox_id: sandbox.id! })
}
```

Get an API key from the [Superserve console](https://console.superserve.ai).

## Resource clients

The `SuperserveClient` exposes four resource groups:

- **`client.sandboxes`** — create, list, get, patch, pause, resume, and delete sandboxes
- **`client.exec`** — run commands inside a sandbox (`command`) or stream output (`commandStream`)
- **`client.files`** — upload and download files to and from a sandbox
- **`client.system`** — health check

## Configuration

```ts
import { SuperserveClient, SuperserveEnvironment } from "@superserve/sdk"

const client = new SuperserveClient({
  apiKey: "ss_live_...",               // required
  environment: SuperserveEnvironment.Production,  // optional
  baseUrl: "http://localhost:8080",    // optional, overrides environment
  timeoutInSeconds: 60,                // optional, default 60
  maxRetries: 2,                       // optional, default 2
})
```

Request-level overrides are supported via an optional second argument on every method:

```ts
await client.exec.command(
  { sandbox_id: "sbx_...", body: { command: "long-running-task" } },
  { timeoutInSeconds: 300, maxRetries: 0 },
)
```

## Error handling

All errors extend `SuperserveError`. Specific API error classes are exposed under the `Superserve` namespace:

```ts
import { SuperserveClient, Superserve } from "@superserve/sdk"

try {
  await client.sandboxes.getSandbox({ sandbox_id: "sbx_missing" })
} catch (err) {
  if (err instanceof Superserve.NotFoundError) {
    console.log("sandbox does not exist")
  } else if (err instanceof Superserve.BadRequestError) {
    console.error("invalid request:", err.body)
  } else {
    throw err
  }
}
```

Available error classes: `BadRequestError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`, `InternalServerError`.

## Documentation

Full docs: [docs.superserve.ai](https://docs.superserve.ai)

## License

Apache-2.0
