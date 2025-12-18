# CLAUDE.md

## Purpose of This Directory

This directory contains the core implementation of the Agentic Ray (RayAI) runtime: agent adapters, tool execution logic, distributed scheduling behavior, sandbox integration, CLI tools, batch tools, and deployment utilities.

It is the heart of the system and provides the foundational abstractions for building distributed agentic applications.

## Directory Structure

- `base.py` - Core protocols and interfaces (`AgentProtocol`)
- `adapters/` - Framework adapters and core tool-conversion logic:
  - `abc.py` - `AgentFramework` enum and `ToolAdapter`
  - `core.py` - `RayTool` IR and cross-framework conversion (`to_raytool`, `from_raytool`)
  - `langchain/` - LangChain-specific helpers
  - `pydantic/` - Pydantic AI helpers
- `batch.py` - Generic `BatchTool` for parallel execution of any registered tool
- `cli/` - Command-line interface for agent management (init, create-agent, serve, analytics)
- `sandbox/` - Secure code execution with Docker/gVisor
- `deployment.py` - Ray Serve deployment utilities with streaming support (`run_stream`, `run_stream_events`)
- `decorators.py` - `@tool` and `@agent` decorators for marking functions/classes
- `resource_loader.py` - Memory parsing utilities (`_parse_memory`)
- `utils.py` - `execute_tools()` for parallel/sequential tool execution
- `examples/` - Minimal examples directory (currently just `__init__.py`)

## Key Concepts an AI Should Know

- All external-facing abstractions should remain stable
- Tool execution must remain serializable because Ray will ship tasks to workers
- Sandbox execution must stay isolated; do not allow host-level operations unless explicitly whitelisted
- This layer should be lightweight and dependency-minimal
- The `AgentProtocol` defines the interface for servable agents (must implement `run(data: dict) -> dict`)
- **`@tool` decorator**: Converts functions to Ray remote functions with resource requirements (CPUs, GPUs, memory)
- **`@agent` decorator**: Marks classes as servable agents with resource configuration and replica count
- **`execute_tools()`**: Utility for executing multiple tools sequentially or in parallel
- **Adapters/core**: `RayTool` IR + converters handle N×M framework integration (Ray tools, LangChain, Pydantic AI, plain callables, batch tools)
- **`BatchTool`**: Lets LLMs call any registered tool by name with many inputs in parallel, returning structured success/error results
- Tools decorated with `@tool` have `_remote_func`, `_tool_metadata`, and `_original_func` attributes

## How Code Here Is Intended to Be Used

- Agents call tools → tools become Ray tasks/actors
- Sandbox module executes untrusted code safely in isolated containers
- Adapters translate frameworks (LangChain, Pydantic AI) into a unified runtime API
- CLI provides commands for initializing projects, creating agents, and serving deployments
- Deployment utilities create Ray Serve endpoints for agent serving

## Do / Don't

### ✅ Do:

- Add new capabilities behind clean interfaces
- Maintain clarity in serialization and Ray task signatures
- Expand sandbox capabilities cautiously with security in mind
- Follow existing patterns when adding new adapters
- Keep dependencies minimal in core modules
- Preserve backward compatibility for public APIs

### ❌ Don't:

- Add heavyweight dependencies to core runtime
- Break backward compatibility without migration path
- Let untrusted code escape sandbox boundaries
- Create framework-specific code outside adapters
- Modify security-critical sandbox code without review
- Introduce non-serializable objects in tool signatures

## Related Modules

- `examples/` for usage patterns and demonstrations
- `tests/` for validated expected behavior
- See subdirectory `CLAUDE.md` files for adapter, CLI, and sandbox details
