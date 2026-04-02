<div align="center">
  <br/>
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-light.svg">
  </picture>

  <br/>
  <br/>

  <p><strong>Cloud micro-VMs with checkpoint, rollback, and fork.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-OCVSAL_1.0-blue.svg)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)

</div>

## What is Superserve

Superserve is a sandbox and VM platform built on Firecracker micro-VMs. Create isolated cloud VMs in milliseconds, execute commands, transfer files, and snapshot VM state with checkpoint, rollback, and fork primitives. Designed for AI agents, CI pipelines, and any workload that needs fast, disposable compute.

## Install

CLI:

```bash
bun add -g @superserve/cli
```

TypeScript SDK:

```bash
bun add @superserve/sdk
```

Python SDK:

```bash
pip install superserve
```

## Quick Start

### CLI

```bash
# Authenticate
superserve login

# Create a VM
superserve vm create --name my-sandbox

# Run a command
superserve vm exec my-sandbox -- echo "Hello from the VM"

# Upload a file
superserve vm upload my-sandbox ./script.py /home/user/script.py

# Checkpoint the VM
superserve vm checkpoint create my-sandbox --name clean-state

# Fork the VM from a checkpoint
superserve vm fork my-sandbox --checkpoint clean-state --name forked-sandbox
```

### TypeScript SDK

```typescript
import { Superserve } from "@superserve/sdk";

const client = new Superserve({ apiKey: process.env.SUPERSERVE_API_KEY });

// Create a VM
const vm = await client.vms.create({ name: "my-sandbox" });

// Execute a command
const result = await client.vms.exec(vm.id, { command: "echo Hello" });
console.log(result.stdout);

// Upload a file
await client.files.upload(vm.id, "./script.py", "/home/user/script.py");

// Checkpoint
const cp = await client.checkpoints.create(vm.id, { name: "clean-state" });

// Fork from checkpoint
const forked = await client.vms.fork(vm.id, { checkpointId: cp.id, name: "forked-sandbox" });
```

### Python SDK

```python
from superserve import Superserve

client = Superserve(api_key=os.environ["SUPERSERVE_API_KEY"])

# Create a VM
vm = client.vms.create(name="my-sandbox")

# Execute a command
result = client.vms.exec(vm.id, command="echo Hello")
print(result.stdout)

# Upload a file
client.files.upload(vm.id, local_path="./script.py", remote_path="/home/user/script.py")

# Checkpoint
cp = client.checkpoints.create(vm.id, name="clean-state")

# Fork from checkpoint
forked = client.vms.fork(vm.id, checkpoint_id=cp.id, name="forked-sandbox")
```

## Monorepo Structure

```
packages/
  cli/                     # TypeScript CLI (@superserve/cli)
  sdk/                     # TypeScript SDK (@superserve/sdk)
  python-sdk/              # Python SDK (superserve on PyPI)
docs/                      # Mintlify documentation
examples/                  # Example projects
```

## Documentation

Full documentation is available at [docs.superserve.ai](https://docs.superserve.ai/).

## Development

This repo is a monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces) and [Turborepo](https://turbo.build/repo).

```bash
bun install               # install all dependencies
bun run build             # build all packages
bun run dev               # start all dev servers
bun run lint              # lint all packages
bun run typecheck         # type check all packages
bun run test              # run all tests
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0 - see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.
