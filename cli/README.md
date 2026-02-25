# Superserve CLI

Production infrastructure for agentic workloads. Deploy, manage, and interact with AI agents from the terminal.

## Install

```bash
bun install -g superserve
```

## Quick Start

```bash
superserve login                    # Authenticate (opens browser)
superserve init                     # Create superserve.yaml in your project
superserve deploy                   # Deploy your agent
superserve run my-agent             # Interactive chat with your agent
```

## Commands

### Authentication

| Command | Description |
| --- | --- |
| `superserve login` | Authenticate the CLI via console |
| `superserve logout` | Clear stored credentials |

### Project

| Command | Description |
| --- | --- |
| `superserve init [--name <name>]` | Create a `superserve.yaml` config |
| `superserve deploy [--dir <path>] [--json] [-y]` | Deploy an agent |

### Run

| Command | Description |
| --- | --- |
| `superserve run <agent> [prompt]` | Interactive agent session (TUI) |
| `superserve run <agent> [prompt] --single` | Single response mode |
| `superserve run <agent> [prompt] --json` | Raw JSON event stream |

### Agents

| Command | Description |
| --- | --- |
| `superserve agents list [--status <status>] [--json]` | List deployed agents |
| `superserve agents get <name> [--json]` | Get agent details |
| `superserve agents delete <name> [-y]` | Delete an agent |

### Secrets

| Command | Description |
| --- | --- |
| `superserve secrets set <agent> KEY=VALUE [...]` | Set environment secrets |
| `superserve secrets list <agent>` | List secret key names |
| `superserve secrets delete <agent> <key> [-y]` | Delete a secret |

### Sessions

| Command | Description |
| --- | --- |
| `superserve sessions list [--agent <name>] [--status <status>] [--json]` | List sessions |
| `superserve sessions get <session-id> [--json]` | Get session details |
| `superserve sessions end <session-id>` | End an active session |

### Global Flags

| Flag | Description |
| --- | --- |
| `-v, --version` | Show CLI version |
| `--no-color` | Disable colored output |
| `--json` | Output as JSON (where supported) |
| `-h, --help` | Show help text |

## Configuration

### `superserve.yaml`

```yaml
name: my-agent                    # Agent name (required)
command: python main.py           # Start command (required)
secrets:                          # Environment variables (optional)
  - ANTHROPIC_API_KEY
ignore:                           # Exclude from upload (optional)
  - .venv
```

Always excluded from uploads: `__pycache__`, `.git`, `.venv`, `venv`, `node_modules`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `dist`, `build`, `*.egg-info`, `.env*`.

## License

MIT
