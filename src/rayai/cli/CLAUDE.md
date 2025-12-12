# CLAUDE.md

## Purpose of This Directory
This directory contains the command-line interface (CLI) for Agentic Ray. The CLI provides commands for:
- Initializing new agent projects
- Creating agent templates
- Serving agents with Ray Serve
- Managing agent deployments

The CLI is the primary user-facing tool for interacting with the Agentic Ray runtime.

## Directory Structure
- `cli.py` - Main CLI entry point and command group
- `commands/` - Individual command implementations
  - `init.py` - Initialize new project
  - `create_agent.py` - Create agent from template
  - `serve.py` - Serve agent with Ray Serve
- `templates/` - Project and agent templates
  - `agent/` - Agent template structure

## Key Concepts an AI Should Know
- CLI uses Click framework for command-line parsing
- Entry point is `rayai` (defined in `pyproject.toml`)
- Commands are modular and live in `commands/` subdirectory
- Templates use Jinja2-style templating for code generation
- `serve` command creates Ray Serve deployments from agent classes
- Commands should be self-contained and handle errors gracefully

## Command Overview

### `rayai init <project_name>`
Initializes a new agent project with boilerplate structure.

### `rayai create-agent <agent_name>`
Creates a new agent from template with proper structure and imports.

### `rayai serve [options]`
Serves an agent using Ray Serve with FastAPI endpoints.

## Key Files
- `cli.py`: Main CLI group and entry point
- `commands/init.py`: Project initialization logic
- `commands/create_agent.py`: Agent template generation
- `commands/serve.py`: Ray Serve deployment logic
- `templates/agent/`: Template files for agent scaffolding

## Do / Don't

### ✅ Do:
- Add new commands as separate modules in `commands/`
- Follow Click patterns for command definition
- Provide clear error messages and help text
- Validate inputs before processing
- Use templates for code generation to maintain consistency
- Handle Ray initialization and cleanup properly

### ❌ Don't:
- Create commands that modify core runtime code
- Add commands that require root/admin privileges
- Hardcode paths or assume specific directory structures
- Create commands that break existing workflows
- Add heavyweight dependencies to CLI
- Skip input validation or error handling

## Adding a New Command

1. Create new file in `commands/` (e.g., `commands/mycommand.py`)
2. Define Click command function with proper decorators
3. Add command to CLI group in `cli.py`: `cli.add_command(mycommand.mycommand)`
4. Add help text and option documentation
5. Test command with various inputs and error cases
6. Update main README if command is user-facing

## Related Modules
- `src/ray_agents/deployment.py` - Ray Serve deployment utilities used by `serve` command
- `src/ray_agents/base.py` - AgentProtocol used for validation
- `examples/` - Example agents that can be served
- Templates reference core runtime APIs

