# Superserve Python SDK

Python SDK for the [Superserve](https://superserve.ai) sandbox API — spin up isolated sandboxes, run commands in them, and tear them down from code.

## Install

```bash
pip install superserve
# or
uv add superserve
# or
poetry add superserve
```

Requires Python 3.9+.

## Quick start

```python
import os
from superserve import Superserve

client = Superserve(api_key=os.environ["SUPERSERVE_API_KEY"])

sandbox = client.sandboxes.create_sandbox(name="hello-world")

try:
    result = client.exec.command(
        sandbox_id=sandbox.id,
        body={"command": "echo 'Hello from Superserve!'"},
    )
    print(result.stdout)
finally:
    client.sandboxes.delete_sandbox(sandbox.id)
```

Get an API key from the [Superserve console](https://console.superserve.ai).

## Resource clients

The `Superserve` client exposes four resource groups:

- **`client.sandboxes`** — create, list, get, patch, pause, resume, and delete sandboxes
- **`client.exec`** — run commands inside a sandbox (`command`) or stream output (`command_stream`)
- **`client.files`** — upload and download files to and from a sandbox
- **`client.system`** — health check

## Configuration

```python
from superserve import Superserve
from superserve.environment import SuperserveEnvironment

client = Superserve(
    api_key="ss_live_...",                            # required
    environment=SuperserveEnvironment.PRODUCTION,     # optional
    base_url="http://localhost:8080",                 # optional, overrides environment
    timeout=60.0,                                     # optional, default 60
    httpx_client=None,                                # optional, inject a custom httpx.Client
)
```

## Async client

`AsyncSuperserve` mirrors every method on `Superserve` with `async`/`await`:

```python
import asyncio
import os
from superserve import AsyncSuperserve

async def main():
    client = AsyncSuperserve(api_key=os.environ["SUPERSERVE_API_KEY"])

    sandbox = await client.sandboxes.create_sandbox(name="async-example")
    try:
        result = await client.exec.command(
            sandbox_id=sandbox.id,
            body={"command": "uname -a"},
        )
        print(result.stdout)
    finally:
        await client.sandboxes.delete_sandbox(sandbox.id)

asyncio.run(main())
```

## Error handling

```python
from superserve import Superserve
from superserve.errors import BadRequestError, NotFoundError

client = Superserve(api_key=os.environ["SUPERSERVE_API_KEY"])

try:
    client.sandboxes.get_sandbox("sbx_missing")
except NotFoundError:
    print("sandbox does not exist")
except BadRequestError as err:
    print("invalid request:", err.body)
```

Available error classes: `BadRequestError`, `UnauthorizedError`, `NotFoundError`, `ConflictError`, `InternalServerError`.

## Documentation

Full docs: [docs.superserve.ai](https://docs.superserve.ai)

## License

Apache-2.0
