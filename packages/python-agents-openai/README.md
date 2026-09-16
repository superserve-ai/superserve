# Superserve Adapter for OpenAI Agents SDK

Run [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) agents inside persistent, isolated [Superserve](https://superserve.ai) Firecracker microVM sandboxes.

## Installation

```bash
pip install superserve-agents-openai
```

Or using `uv`:

```bash
uv add superserve-agents-openai
```

## Quickstart

Set your Superserve and OpenAI API keys:

```bash
export SUPERSERVE_API_KEY="ss_live_..."
export OPENAI_API_KEY="sk-..."
```

Pass `SuperserveSandboxClient` to `SandboxRunConfig`:

```python
import asyncio
from agents import Agent, Runner
from agents.run import RunConfig
from agents.sandbox import SandboxRunConfig
from superserve_agents_openai import SuperserveSandboxClient

async def main():
    agent = Agent(
        name="Engineer",
        instructions="You are a helpful coding assistant with access to a sandbox.",
    )

    client = SuperserveSandboxClient()

    result = await Runner.run(
        agent,
        "Run `uname -a` and inspect the system.",
        run_config=RunConfig(
            sandbox=SandboxRunConfig(client=client),
        ),
    )
    print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())
```

## Configuration & Options

You can customize the sandbox microVM via `SuperserveSandboxClientOptions`:

```python
from superserve_agents_openai import SuperserveSandboxClient, SuperserveSandboxClientOptions

options = SuperserveSandboxClientOptions(
    api_key="ss_live_...",          # defaults to SUPERSERVE_API_KEY env var
    base_url="https://api.superserve.ai",
    template="python-3.12",         # optional base template
    timeout_seconds=600,            # auto-pause timeout
    auto_delete_seconds=3600,       # auto-delete timeout
    metadata={"env": "dev"},
)

client = SuperserveSandboxClient(options)
```

## Running the Coding Agent Example

The repository includes a self-validating coding agent example that demonstrates file editing (`apply_patch`), skill loading, command execution, and test verification inside a live Superserve sandbox:

```bash
uv run --env-file .env python packages/python-agents-openai/examples/coding_agent/coding_task.py
```

## Running Tests

Run offline unit tests (no credentials needed):

```bash
uv run pytest packages/python-agents-openai/tests/test_options.py packages/python-agents-openai/tests/test_client.py packages/python-agents-openai/tests/test_session.py
```

Run live integration tests against Superserve cloud:

```bash
SUPERSERVE_API_KEY="ss_live_..." uv run pytest packages/python-agents-openai/tests/test_live_e2e.py
```
