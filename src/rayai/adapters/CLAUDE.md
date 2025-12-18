# CLAUDE.md

## Purpose of This Directory

This directory contains adapters that bridge different agent frameworks (LangChain, Pydantic AI, etc.) with Ray's distributed execution model. Adapters convert framework-specific tools and agents into Ray-compatible remote functions and callables.

The adapter pattern allows the runtime to remain framework-agnostic while supporting multiple agent ecosystems.

## Directory Structure

- `abc.py` - Adapter façade (`AgentFramework`, `ToolAdapter`) for high-level use
- `core.py` - Core tool-conversion logic and canonical `RayTool` IR
- `langchain/` - LangChain-specific helpers
  - `tools.py` - `from_langchain_tool()` function (legacy convenience wrapper)
- `pydantic/` - Pydantic AI helpers
  - `tools.py` - Helpers to convert Ray tools to Pydantic AI-compatible callables

## Key Concepts an AI Should Know

- **ToolAdapter**: Wraps Ray remote functions as framework-compatible callables
- **Framework Enum**: Defines supported frameworks (LANGCHAIN, PYDANTIC)
- **Tool Wrapping**: Converts Ray remote functions to sync callables that agents can use
- **from_langchain_tool**: Converts LangChain BaseTool instances to Ray remote functions
- Adapters handle the translation layer but don't manage agent lifecycle or conversation history
- Tools must remain serializable for Ray task distribution

## How Adapters Work

1. **Framework → Ray**: Convert framework tools (e.g., LangChain BaseTool) to Ray remote functions
2. **Ray → Framework**: Wrap Ray remote functions as framework-compatible callables
3. **Execution**: Framework agents call wrapped tools, which dispatch to Ray tasks
4. **Error Handling**: Adapters normalize error responses from Ray tasks to framework expectations

## Key Files

- `abc.py`: `ToolAdapter` class that wraps Ray tools for any framework, `AgentFramework` enum
- `core.py`: `RayTool` IR + converters (`to_raytool`, `from_raytool`, framework detection, batch support)
- `langchain/tools.py`: `from_langchain_tool()` converts LangChain `BaseTool` instances to Ray remote functions
- `langchain/__init__.py`: Exports `from_langchain_tool`
- `pydantic/tools.py`: Helpers for Pydantic AI tool integration (built on `RayTool`)
- `pydantic/__init__.py`: Exposes Pydantic helpers if needed

## Do / Don't

### ✅ Do:

- Add new framework adapters following the existing pattern
- Maintain compatibility with framework tool interfaces
- Preserve tool metadata (name, description, args_schema) during conversion
- Handle error responses consistently across frameworks
- Keep adapters lightweight and focused on translation only

### ❌ Don't:

- Add framework-specific logic outside adapter modules
- Break compatibility with existing framework tool interfaces
- Add heavyweight framework dependencies to base adapter code
- Manage agent lifecycle or conversation state in adapters
- Create tight coupling between adapters and specific framework versions

## Adding a New Framework Adapter

1. Create a new subdirectory (e.g., `crewai/`)
2. Implement converter function: `from_<framework>_tool()` that returns Ray remote
3. Update `AgentFramework` enum in `abc.py`
4. Extend `ToolAdapter.wrap_tools()` if framework needs special handling
5. Add tests in `tests/test_tool_adapters.py`
6. Document in framework's `__init__.py`

## Related Modules

- `src/rayai/base.py` - Core protocols and interfaces
- `src/rayai/decorators.py` - Tool decoration utilities
- `src/rayai/batch.py` - `BatchTool` which also uses `RayTool` IR
- `examples/` - Usage examples for each framework
- `tests/test_tool_adapters.py` - Adapter tests
