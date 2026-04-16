# @superserve/sdk

TypeScript SDK for the Superserve sandbox API.

## Installation

```bash
npm install @superserve/sdk
```

## Quick Start

```typescript
import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({ name: "my-sandbox" })
await sandbox.waitForReady()

const result = await sandbox.commands.run("echo hello")
console.log(result.stdout)

await sandbox.files.write("/app/data.txt", "content")
const text = await sandbox.files.readText("/app/data.txt")

await sandbox.kill()
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable, or pass `apiKey` explicitly:

```typescript
const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "ss_live_...",
})
```
