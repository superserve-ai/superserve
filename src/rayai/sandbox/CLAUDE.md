# CLAUDE.md

## Purpose of This Directory
This directory contains the secure code execution sandbox system. It manages Docker containers with gVisor runtime to execute untrusted Python code in isolated environments with resource limits, network isolation, and timeout controls.

The sandbox is critical for security - it prevents untrusted code from accessing the host system or network.

## Directory Structure
- `executor.py` - Main CodeInterpreterExecutor Ray Actor that manages containers
- `config.py` - Sandbox configuration (timeouts, limits, runtime settings)
- `types.py` - Type definitions (ExecutionResult, ExecutionError, etc.)
- `tools.py` - Tool definitions for sandbox operations
- `mcp_proxy.py` - MCP (Model Context Protocol) proxy for secure external access
- `Dockerfile.sidecar` - Sidecar container for MCP communication

## Key Concepts an AI Should Know
- **CodeInterpreterExecutor**: Ray Actor that manages Docker container lifecycle
- **gVisor Runtime**: Security-focused container runtime (`runsc`) for isolation
- **Network Isolation**: Containers run with `network_mode: none` by default
- **MCP Sidecar**: Proxy container that enables controlled external access via Unix sockets
- **Session Persistence**: Python session state persists across code executions
- **Resource Limits**: CPU, memory, and timeout constraints enforced
- **Security First**: All code execution must be isolated; no host access allowed

## How Sandbox Works
1. **Container Creation**: Executor creates Docker container with gVisor runtime
2. **Code Execution**: Python code is executed inside isolated container
3. **Resource Limits**: CPU, memory, and time limits enforced
4. **Network Isolation**: No network access unless MCP sidecar is used
5. **Session State**: Variables and imports persist across executions
6. **Cleanup**: Containers are automatically cleaned up after timeout or completion

## Key Files
- `executor.py`: `CodeInterpreterExecutor` Ray Actor - main sandbox manager
- `config.py`: Configuration constants (DEFAULT_IMAGE, RUNTIME, MEMORY_LIMIT, etc.)
- `types.py`: Data classes for execution results and errors
- `mcp_proxy.py`: MCP sidecar proxy for secure external communication
- `tools.py`: Ray remote functions for sandbox operations

## Security Considerations
- **gVisor Required**: Uses `runsc` runtime for security isolation
- **Network Isolation**: Default `network_mode: none` prevents network access
- **Resource Limits**: CPU and memory quotas prevent resource exhaustion
- **Timeout Enforcement**: Code execution has strict time limits
- **No Host Access**: Containers cannot access host filesystem or processes
- **MCP Proxy**: Only controlled external access via sidecar with allowlist

## Configuration
Key settings in `config.py`:
- `DEFAULT_IMAGE`: Base Docker image for execution
- `RUNTIME`: Container runtime (`runsc` for gVisor)
- `STRICT_GVISOR`: Fail if gVisor unavailable
- `MEMORY_LIMIT`: Memory constraint (default 512MB)
- `CPU_QUOTA/CPU_PERIOD`: CPU limits
- `DEFAULT_TIMEOUT`: Execution timeout (default 30s)
- `NETWORK_MODE`: Network isolation (`none` by default)

## Do / Don't

### ✅ Do:
- Maintain strict security boundaries
- Validate all inputs before execution
- Enforce resource limits consistently
- Clean up containers properly
- Log security-relevant events
- Test isolation thoroughly
- Use gVisor runtime for production

### ❌ Don't:
- Allow host filesystem access
- Bypass network isolation without MCP proxy
- Remove resource limits
- Skip container cleanup
- Execute code without container isolation
- Modify security boundaries without review
- Use `runc` runtime in production (use `runsc`)

## Adding Sandbox Features

1. **New Execution Capabilities**: Add to `CodeInterpreterExecutor` methods
2. **Configuration**: Update `config.py` with new settings
3. **Types**: Add to `types.py` if new data structures needed
4. **Security Review**: All changes must maintain isolation
5. **Tests**: Add tests in `tests/test_code_interpreter.py`
6. **Documentation**: Update this file and main README

## Related Modules
- `src/rayai/base.py` - Core protocols
- `examples/analyzer/` - Example using sandbox for code execution
- `tests/test_code_interpreter.py` - Sandbox tests
- `scripts/` - gVisor setup scripts

