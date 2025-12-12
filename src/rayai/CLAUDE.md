# CLAUDE.md

## Purpose of This Directory

This directory contains the core implementation of the Agentic Ray runtime: agent adapters, tool execution logic, distributed scheduling behavior, sandbox integration, CLI tools, and deployment utilities.

It is the heart of the system and provides the foundational abstractions for building distributed agentic applications.

## Directory Structure

- `base.py` - Core protocols and interfaces (AgentProtocol)
- `adapters/` - Framework adapters for LangChain, Pydantic AI, etc.
- `cli/` - Command-line interface for agent management
- `sandbox/` - Secure code execution with Docker/gVisor
- `deployment.py` - Ray Serve deployment utilities
- `decorators.py` - Tool decoration utilities
- `resource_loader.py` - Resource loading utilities
- `utils.py` - Shared utility functions

## Key Concepts an AI Should Know

- All external-facing abstractions should remain stable
- Tool execution must remain serializable because Ray will ship tasks to workers
- Sandbox execution must stay isolated; do not allow host-level operations unless explicitly whitelisted
- This layer should be lightweight and dependency-minimal
- The `AgentProtocol` defines the interface for servable agents (must implement `run(data: dict) -> dict`)
- Tools are decorated with `@tool` to become Ray remote functions
- Adapters bridge between agent frameworks and Ray's execution model

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
