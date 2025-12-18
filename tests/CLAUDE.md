# CLAUDE.md

## Purpose of This Directory

Contains tests ensuring correctness of:

- Tool execution and Ray task distribution
- Agent adapters (LangChain, Pydantic AI)
- Sandbox behavior and security isolation
- Distributed execution workflows
- Code interpreter functionality
- Integration between components

Tests protect against regressions when modifying the core runtime and validate that the system works correctly across different scenarios.

## Test Files

- `test_code_interpreter.py` - Sandbox and code execution tests
- `test_integration.py` - End-to-end integration tests
- `test_tool_adapters.py` - Framework adapter tests
- `conftest.py` - Shared test fixtures and configuration

## Key Concepts an AI Should Know

- Tests must be deterministic and reproducible
- Avoid depending on external services (APIs, network)
- Sandbox tests should validate isolation and security boundaries
- Use pytest fixtures for shared setup (see `conftest.py`)
- Mock external dependencies when possible
- Tests should run quickly and not require manual intervention

## Do / Don't

### ✅ Do:

- Add missing tests for new runtime features
- Improve coverage for sandboxes and adapters
- Write tests that validate both success and error paths
- Use fixtures for common test setup
- Keep tests isolated and independent
- Test edge cases and boundary conditions

### ❌ Don't:

- Rewrite or delete tests unless the behavior intentionally changes
- Add tests that require internet or external services
- Create long-running tests (>30 seconds) without good reason
- Skip tests that validate security-critical functionality
- Hardcode paths or environment-specific values
- Create tests that depend on specific Docker images or external state

## Related Modules

- Tests load functions/classes from `src/rayai/`
- May use example code from `examples/` for integration testing
- Should validate behavior documented in CLAUDE.md files
