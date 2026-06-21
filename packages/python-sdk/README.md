# superserve

Python SDK for Superserve — open agent infrastructure: persistent sandboxes that run any harness.

A **Sandbox** is a computer that remembers: compute plus a persistent filesystem, with exec, file, and port access. Run a command, write a file, hibernate the sandbox, then resume it later by ID with its state intact — so any agent harness (Claude Code, Codex, the Claude Agent SDK, or your own loop) gets a durable place to run. Sandboxes are isolated Firecracker MicroVMs.

> Superserve is heading toward two composable primitives on one substrate: the **Sandbox** documented here, and a durable **Actor** — a named, single-writer process that wakes on events and survives restarts. Actors are the platform direction; this SDK ships the Sandbox surface today.

## Installation

```bash
pip install superserve
# or
uv add superserve
# or
poetry add superserve
```

Requires Python ≥ 3.9.

## Quick Start

```python
from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox")

result = sandbox.commands.run("echo hello")
print(result.stdout)

sandbox.files.write("/app/data.txt", b"content")
text = sandbox.files.read_text("/app/data.txt")

sandbox.kill()
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable:

```bash
export SUPERSERVE_API_KEY=ss_live_...
```

Or pass it explicitly:

```python
sandbox = Sandbox.create(
    name="my-sandbox",
    api_key="ss_live_...",
    base_url="https://api.superserve.ai",  # optional
)
```

## Async usage

```python
import asyncio
from superserve import AsyncSandbox

async def main():
    sandbox = await AsyncSandbox.create(name="async-example")
    try:
        result = await sandbox.commands.run("echo hello")
        print(result.stdout)
    finally:
        await sandbox.kill()

asyncio.run(main())
```

## Streaming command output

```python
result = sandbox.commands.run(
    "pip install numpy",
    on_stdout=lambda data: print(data, end=""),
    on_stderr=lambda data: print(data, end=""),
    timeout_seconds=120,
)
```

## Error handling

```python
from superserve import (
    SandboxError,
    AuthenticationError,     # 401
    ValidationError,         # 400
    NotFoundError,           # 404
    ConflictError,           # 409 — invalid state for operation
    SandboxTimeoutError,     # request timed out (does not shadow builtin TimeoutError)
    ServerError,             # 500
)

try:
    sandbox.pause()
except ConflictError:
    # Sandbox is not in a pausable state
    pass
```

## Full documentation

[docs.superserve.ai](https://docs.superserve.ai/sdk/python/sandbox?utm_source=pypi&utm_medium=readme)

## Development

```bash
# From repo root:
bunx turbo run build --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
```

## License

Apache License 2.0.
