# CLAUDE.md

## Purpose of This Directory
This directory contains a complete example of a token-efficient data analysis agent. It demonstrates:
- Interactive CLI agent with streaming responses
- Code generation and execution in sandboxed containers
- MCP (Model Context Protocol) integration for secure dataset access
- Persistent Python sessions across interactions
- gVisor sandboxing with network isolation
- MCP sidecar proxy for controlled external access

This is a production-like example showing how to build a real agentic application with Agentic Ray.

## Directory Structure
- `token_efficient_agent/` - Main agent implementation
  - `agent.py` - Core agent with streaming and code execution
  - `cli.py` - Interactive terminal interface
  - `Dockerfile` - Container image with data analysis packages
  - `README.md` - Detailed usage instructions
- `mcp_serve.py` - Ray Serve MCP server for dataset access
- `servers/` - MCP client libraries
  - `datasets_client/` - Dataset access client
  - `mcp_client.py` - MCP protocol client
- `datasets/` - Sample datasets for analysis

## Key Concepts an AI Should Know
- **Token Efficiency**: Agent only includes summaries in context, not raw data
- **Session Persistence**: Python variables persist across code executions
- **MCP Integration**: Secure dataset access via Model Context Protocol
- **Sidecar Pattern**: Proxy container enables network-isolated sandbox to access MCP server
- **Streaming**: Real-time agent thinking and code generation
- **Sandbox Isolation**: Complete network isolation with gVisor, external access only via MCP

## Architecture Flow
```
CLI (Host)
  ↓
Agent (generates code)
  ↓
Sandbox (gVisor container, network_mode: none)
  ├── /mnt/servers (MCP clients mounted)
  └── Persistent Python session
  ↓
Unix socket (/tmp/mcp.sock)
  ↓
MCP Sidecar Proxy (auto-started)
  ↓
MCP Server (Ray Serve on :8265)
  ↓
Datasets (../datasets/)
```

## Key Components

### `token_efficient_agent/agent.py`
- `TokenEfficientAgent`: Main agent class
- Streaming response handling
- Code execution via Ray sandbox
- Session management

### `token_efficient_agent/cli.py`
- Interactive terminal interface
- Starts MCP server automatically
- Manages Ray initialization
- Handles user input/output

### `mcp_serve.py`
- Ray Serve deployment
- MCP protocol implementation
- Dataset listing and import endpoints
- Runs on port 8265

### `servers/datasets_client/`
- MCP client libraries
- Mounted in sandbox at `/mnt/servers`
- Provides `list_datasets()` and `import_dataset()` functions

## Do / Don't

### ✅ Do:
- Use this as a template for building similar agents
- Follow the MCP pattern for secure external access
- Maintain session persistence for efficiency
- Use streaming for better UX
- Document any modifications clearly

### ❌ Don't:
- Hardcode API keys or credentials
- Remove security isolation (gVisor, network isolation)
- Bypass MCP for direct dataset access
- Store sensitive data in containers
- Skip error handling for code execution

## Running the Example

See `token_efficient_agent/README.md` for detailed instructions. Quick start:
```bash
cd examples/analyzer/token_efficient_agent
./build.sh  # Pre-build Docker image
./run_cli.sh --image token-efficient-agent
```

## Customization
- **Add datasets**: Place CSV files in `datasets/` directory
- **Add Python packages**: Edit `Dockerfile` and rebuild
- **Change model**: Modify `cli.py` agent initialization
- **Adjust timeout**: Update `agent.py` execution timeout

## Related Modules
- `src/rayai/sandbox/` - Sandbox execution system
- `src/rayai/adapters/` - Framework adapters (if using LangChain/Pydantic AI)
- `examples/CLAUDE.md` - General examples documentation

