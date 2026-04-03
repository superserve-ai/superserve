# Superserve SDK

TypeScript SDK for creating and managing cloud micro-VMs with checkpoint, rollback, and fork primitives.

## Install

```bash
bun add @superserve/sdk
```

## Usage

```typescript
import { Superserve } from "@superserve/sdk"

const client = new Superserve({ apiKey: process.env.SUPERSERVE_API_KEY })

// Create a VM
const vm = await client.vms.create({ name: "my-sandbox", image: "ubuntu-22.04" })

// Execute a command
const result = await client.exec(vm.id, { command: "echo hello" })
console.log(result.stdout)

// Stream command output
const stream = client.execStream(vm.id, { command: "apt-get update" })
for await (const event of stream.stdout) {
  process.stdout.write(event)
}

// Upload / download files
await client.files.upload(vm.id, "/app/script.py", "print('hello')")
const data = await client.files.download(vm.id, "/app/script.py")

// Checkpoint, rollback, fork
const cp = await client.checkpoints.create(vm.id, { name: "baseline" })
await client.rollback(vm.id, { checkpointId: cp.id })
const forks = await client.fork(vm.id, { count: 2 })

// VM lifecycle
await client.vms.stop(vm.id)
await client.vms.start(vm.id)
await client.vms.sleep(vm.id)
await client.vms.wake(vm.id)
await client.vms.delete(vm.id)
```

## Documentation

See [docs.superserve.ai](https://docs.superserve.ai) for full documentation.
