# Claude Managed Agents on Superserve

Reference implementation for running [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) inside Superserve sandboxes as a self-hosted environment. See the [full guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents) for the architecture story.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key.
- An Anthropic account with Claude Managed Agents access.
- Python 3.12+ or Node.js 22+.
- For webhook mode: an Anthropic webhook with `session.status_run_started` enabled.

## Python

```bash
cd python
uv sync
cp .env.example .env  # fill in values
```

```bash
uv run create_environment.py     # one-time
uv run build_template.py         # one-time
uv run create_agent.py my-agent  # one-time
uv run orchestrator.py           # long-running
```

## TypeScript

```bash
cd typescript
npm install
cp .env.example .env  # fill in values
```

```bash
node create-environment.mjs     # one-time
node build-template.mjs         # one-time
node create-agent.mjs my-agent  # one-time
node orchestrator.mjs           # long-running
```

## What happens

1. The orchestrator claims work items from the environment's work queue.
2. For each session, it finds an existing Superserve sandbox (resuming if paused) or creates a new one.
3. It uploads the runner and starts it inside the sandbox.
4. The runner executes tool calls (`bash`, `read`, `write`, `edit`, `glob`, `grep`) against the sandbox filesystem.
5. A janitor pauses sandboxes that have been idle for more than 5 minutes. The next work item resumes them in under a second.

## See also

- [Full integration guide](https://docs.superserve.ai/integrations/managed-agents/claude-managed-agents)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
- [Superserve SDK reference](https://docs.superserve.ai/sdk-reference/sandbox)
