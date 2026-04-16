# superserve

Python SDK for the Superserve sandbox API.

## Installation

```bash
pip install superserve
```

## Quick Start

```python
from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox")
sandbox.wait_for_ready()

result = sandbox.commands.run("echo hello")
print(result.stdout)

sandbox.files.write("/app/data.txt", b"content")
text = sandbox.files.read_text("/app/data.txt")

sandbox.kill()
```

## Async

```python
from superserve import AsyncSandbox

sandbox = await AsyncSandbox.create(name="my-sandbox")
await sandbox.wait_for_ready()

result = await sandbox.commands.run("echo hello")
await sandbox.kill()
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable, or pass `api_key` explicitly:

```python
sandbox = Sandbox.create(name="my-sandbox", api_key="ss_live_...")
```
