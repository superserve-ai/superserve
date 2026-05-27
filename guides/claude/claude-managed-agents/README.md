# Claude Managed Agents on Superserve

Reference implementation for running [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) inside Superserve sandboxes as a self-hosted environment. See the [full guide](https://docs.superserve.ai/integrations/agent-harnesses/claude-managed-agents) for the architecture story; this README covers how to run the reference.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key.
- An Anthropic account with Claude Managed Agents access. Create a self-hosted environment from the Claude Console under *Workspace > Environments > New > Self-hosted*, then click *Generate environment key*.
- An Anthropic API key for `create_agent.py` and for the application that creates sessions.
- Python 3.12+.
- For webhook mode: an Anthropic webhook configured with `session.status_run_started` enabled, plus its signing secret.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Webhook mode also needs:
pip install -e ".[webhook]"

cp .env.example .env
# Fill in the values.
```

## 1. Create the environment

```bash
python create_environment.py
```

Follow the printed instructions to generate an environment key in the Claude Console, then add both values to `.env`.

## 2. Build the template

```bash
python build_template.py
```

Builds a Superserve template from `python:3.12-slim` with the Anthropic SDK and common tools pre-installed. Idempotent — skips the build if a ready template with the same name already exists. Sandboxes created from this template boot in under a second.

## 3. Create an agent

```bash
python create_agent.py my-agent
```

Creates a Sonnet 4.6 agent with `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, and `web_search` tools enabled. Edit the script to change the model, system prompt, or tool selection.

## 4. Run the orchestrator

### Polling mode

```bash
python orchestrator.py
```

Long-polls Anthropic's work queue. Works behind any NAT or firewall.

### Webhook mode

```bash
python orchestrator_webhook.py
```

Listens for `session.status_run_started` webhooks on port 5051 (configurable via `PORT`). Requires `ANTHROPIC_WEBHOOK_SECRET` in `.env`.

## What happens

1. The orchestrator claims work items from Anthropic's queue.
2. For each session, it finds an existing Superserve sandbox (resuming if paused) or creates a new one from the template.
3. It uploads `runner.py` into the sandbox and starts it with the session's credentials.
4. The runner attaches to the session's event stream and executes tool calls (`bash`, `read`, `write`, `edit`, `glob`, `grep`) against the sandbox filesystem.
5. After the turn completes, the runner exits. The sandbox stays active for the next turn.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_ENVIRONMENT_KEY` | — | Environment key for the worker |
| `ANTHROPIC_ENVIRONMENT_ID` | — | Environment ID |
| `SUPERSERVE_API_KEY` | — | Superserve API key |
| `ANTHROPIC_API_KEY` | — | API key for setup scripts and your app |
| `TEMPLATE_NAME` | `claude-managed-agent` | Template to create sandboxes from |
| `IDLE_PAUSE_SECONDS` | `300` | Seconds before the janitor pauses idle sandboxes |
| `POLL_BLOCK_MS` | `999` | Long-poll block duration (1–999) |
| `POLL_RECLAIM_OLDER_THAN_MS` | `2000` | Reclaim stale work items older than this |
| `RUNNER_MAX_IDLE_SECONDS` | `300` | Runner exits after this many idle seconds |
| `LOG_LEVEL` | `INFO` | Logging level |

## Files

| File | Runs on | Purpose |
|---|---|---|
| `create_environment.py` | Your machine | One-time: create the self-hosted environment |
| `create_agent.py` | Your machine | One-time: create the agent |
| `build_template.py` | Your machine | One-time: build the sandbox template |
| `orchestrator.py` | Your server | Long-running: polls work queue, manages sandboxes |
| `orchestrator_webhook.py` | Your server | Long-running: webhook alternative to polling |
| `runner.py` | Inside sandbox | Per-session: executes tool calls via Anthropic SDK |

## See also

- [Full integration guide](https://docs.superserve.ai/integrations/agent-harnesses/claude-managed-agents)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
- [Self-hosted sandboxes reference](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes)
- [Superserve SDK reference](https://docs.superserve.ai/sdk-reference/sandbox)
