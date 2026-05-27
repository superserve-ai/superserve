# Claude Managed Agents on Superserve

Reference implementation for running [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) inside Superserve sandboxes as a self-hosted environment. See the [full guide](https://docs.superserve.ai/integrations/agent-harnesses/claude-managed-agents) for the architecture story; this README covers how to run the reference.

## Prerequisites

- A [Superserve account](https://console.superserve.ai) and API key.
- An Anthropic account with Claude Managed Agents access.
- Python 3.12+.
- For webhook mode: an Anthropic webhook with `session.status_run_started` enabled, plus its signing secret.

## Setup

```bash
uv sync

# Webhook mode also needs:
uv sync --extra webhook

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

Builds a Superserve template from `python:3.12-slim` with the Anthropic SDK and common tools pre-installed.

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

Listens for webhooks on port 5051. Set `ANTHROPIC_WEBHOOK_SECRET` in `.env`. Includes a fallback drain loop so work is never missed even if a webhook delivery fails.

## What happens

1. The orchestrator claims work items from Anthropic's queue.
2. For each session, it finds an existing Superserve sandbox (resuming if paused) or creates a new one.
3. It checks whether a runner from a previous turn is still alive. If not, it uploads `runner.py` and starts it.
4. The runner executes tool calls (`bash`, `read`, `write`, `edit`, `glob`, `grep`) against the sandbox filesystem.
5. A janitor pauses sandboxes that have been idle for 5 minutes. The next work item resumes them in under a second.

## Production features

- **File locking** — prevents two orchestrators from racing on the same environment.
- **PID file + exit code tracking** — knows exactly whether a runner is alive, exited cleanly, or crashed. Reads `runner.log` on failure.
- **Process group management** — stops runners via `kill -TERM "-$pgid"` so child processes are cleaned up, with `SIGKILL` fallback.
- **State tracking metadata** — each sandbox carries `cma.mode`, `cma.work_id`, `cma.paused_at` for full audit trail.
- **Exponential backoff** — retries transient poll errors with increasing delay up to 60 seconds.
- **Activity-based janitor** — only pauses sandboxes confirmed idle (no running runner, no recent work items). Stamps `cma.paused_at` on pause.
- **Prepared sandboxes** — pass `superserve.sandbox_id` in session metadata to attach a pre-seeded sandbox.
- **Drain lock** — webhook mode serializes concurrent drain calls to avoid duplicate work.
- **Fallback drain** — webhook mode polls every 30 seconds as a safety net for missed deliveries.
- **Clean shutdown** — SIGTERM/SIGINT drain in-flight work before stopping.

## See also

- [Full integration guide](https://docs.superserve.ai/integrations/agent-harnesses/claude-managed-agents)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
- [Superserve SDK reference](https://docs.superserve.ai/sdk-reference/sandbox)
