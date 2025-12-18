# CLAUDE.md

## Purpose of This Directory

Provides runnable examples demonstrating how to:

- Register and use tools with Ray
- Run agents on Ray with different frameworks (LangChain, Pydantic AI)
- Use sandboxes for secure code execution
- Integrate with MCP (Model Context Protocol) servers
- Deploy agents with Ray Serve

These files help developers understand the expected usage patterns and serve as templates for building their own agents.

## Example Applications

### `analyzer/`

Token-efficient data analysis agent that:

- Generates and executes Python code in sandboxed containers
- Uses MCP for secure dataset access
- Maintains persistent Python sessions across interactions
- Demonstrates gVisor sandboxing with network isolation

### `finance_agent/`

Financial analysis agent that:

- Fetches stock market data via external APIs
- Executes analysis code on fetched data
- Uses Pydantic AI framework
- Demonstrates tool chaining and data processing

## Key Concepts an AI Should Know

- Examples should be minimal, clear, and runnable
- Do not add complex logic or heavy dependencies
- Examples are for learning and demonstration, not production use
- Each example should be self-contained and well-documented
- Examples should follow best practices for the framework they demonstrate

## Do / Don't

### ✅ Do:

- Add clear, simple examples that demonstrate core features
- Keep code self-contained with minimal external dependencies
- Include README files explaining how to run examples
- Use realistic but simplified use cases
- Document required environment variables and setup steps

### ❌ Don't:

- Introduce production features here
- Reference internal/private APIs from `src/rayai/`
- Add complex business logic or enterprise patterns
- Create examples that require extensive external services
- Hardcode API keys or sensitive credentials

## Related Modules

- Relies on `src/rayai/` runtime APIs
- Uses adapters from `src/rayai/adapters/` for framework integration
- May use sandbox from `src/rayai/sandbox/` for code execution
