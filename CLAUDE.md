# CLAUDE.md

## Purpose of This Repository

This project provides a scalable runtime for agentic workloads, including AI agents, tool execution, MCP servers, and secure coding sandboxes. It uses Ray as the underlying distributed compute engine to schedule, parallelize, and isolate tool executions.

The goal is to make tool-heavy or multi-agent systems easy to scale across CPUs/GPUs while providing optional sandboxing (gVisor-like) for safe code execution.

## Architecture Overview

- **Ray-based Distribution**: Tool calls are executed as Ray tasks/actors, enabling automatic scaling and resource management
- **Framework Adapters**: Supports multiple agent frameworks (LangChain, Pydantic AI) through adapter pattern
- **Sandbox Execution**: Secure code execution using Docker with gVisor runtime for isolation
- **MCP Integration**: Model Context Protocol support for structured tool communication
- **CLI Tools**: Command-line interface for agent creation, deployment, and management

## Key Concepts an AI Should Know

- A "tool call" maps to a Ray task/actor, enabling distributed execution
- Agents may use different frameworks (LangGraph, Pydantic AI, etc.); adapters in `src/rayai/adapters/` unify them
- Code execution happens inside controlled Docker sandboxes with gVisor for security isolation
- The repo is framework-agnostic; avoid coupling to any single agent architecture
- Tools are decorated with `@tool` or converted via adapters to become Ray remote functions
- Sandbox executor manages Docker containers with resource limits, timeouts, and network isolation

## Project Structure Overview

- `src/rayai/` – core runtime, agents, tools, sandbox logic, adapters, CLI
- `examples/` – example uses of agents and tools on Ray (analyzer, finance_agent)
- `tests/` – unit tests for runtime execution, tool adapters, sandbox behavior
- `scripts/` – developer or cluster helper scripts (gVisor setup, Docker configuration)

## Technology Stack

- **Ray**: Distributed computing framework for task scheduling and resource management
- **Ray Serve**: Model serving and deployment
- **Docker + gVisor**: Container-based sandboxing with security isolation
- **FastAPI**: HTTP API layer for agent deployments
- **LangChain/LangGraph**: Supported agent framework
- **Pydantic AI**: Supported agent framework

## Do / Don't for AI Modifying This Repo

### ✅ Do:

- Improve documentation comments and docstrings
- Refactor for clarity without breaking public APIs
- Add new adapters or sandbox capabilities behind clean interfaces
- Follow existing patterns for tool decoration and Ray integration
- Maintain security boundaries in sandbox execution
- Update examples when adding new features

### ❌ Don't:

- Create tight coupling to a specific agent framework
- Modify sandbox security boundaries without explicit review
- Introduce breaking API changes without updating examples/tests
- Add heavyweight dependencies to core runtime
- Bypass Ray's serialization requirements for tool execution
- Allow untrusted code to escape sandbox boundaries

## Related Modules

See subdirectory `CLAUDE.md` files for detailed directory purposes:

- `src/rayai/CLAUDE.md` - Core runtime implementation
- `src/rayai/adapters/CLAUDE.md` - Framework adapters
- `src/rayai/cli/CLAUDE.md` - CLI tools
- `src/rayai/sandbox/CLAUDE.md` - Sandbox execution
- `examples/CLAUDE.md` - Example applications
- `tests/CLAUDE.md` - Test suite
