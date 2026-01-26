# Building Agents with RayAI

This guide covers how to build, configure, and deploy agents using the rayai CLI.

## Quick Start

```bash
# Install rayai
pip install rayai

# Create a new project
rayai init my_project
cd my_project

# Set up API keys
cp .env.example .env
# Edit .env with your OPENAI_API_KEY or ANTHROPIC_API_KEY

# Create your first agent
rayai create-agent my_agent --framework pydantic

# Run all agents
rayai up
```

## CLI Commands

### `rayai init <project_name>`

Initialize a new agent project.

```bash
rayai init my_project
```

Creates:
- `pyproject.toml` - Project metadata
- `.env` / `.env.example` - Environment variables for API keys
- `agents/` - Directory for your agents

### `rayai create-agent <name> [--framework <framework>]`

Create a new agent within your project.

```bash
rayai create-agent analyzer                    # Default Python agent
rayai create-agent analyzer --framework pydantic   # Pydantic AI
rayai create-agent analyzer --framework langchain  # LangChain
```

### `rayai up [options]`

Start all agents via Ray Serve.

```bash
rayai up                              # Start all agents
rayai up --port 9000                  # Custom port
rayai up --agents agent1,agent2       # Specific agents only
```

### `rayai create-mcp <name>`

Create an MCP server for secure data access.

```bash
rayai create-mcp datasets
```

## Project Structure

```
my_project/
├── pyproject.toml
├── .env                    # API keys (git-ignored)
├── agents/
│   └── my_agent/
│       ├── __init__.py
│       └── agent.py        # Must call rayai.serve()
└── mcp_servers/            # Optional
    └── datasets/
        └── server.py
```

## Setting API Keys

Create a `.env` file:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Writing Agents

### Basic Agent with Tools

```python
import rayai
from pydantic_ai import Agent

@rayai.tool(num_cpus=1)
def search(query: str) -> str:
    """Search for information."""
    return f"Results for {query}"

agent = Agent(
    "openai:gpt-4o-mini",
    system_prompt="You are a helpful assistant.",
    tools=[search],
)

rayai.serve(agent, name="my_agent", num_cpus=1, memory="2GB")
```

### The `@rayai.tool` Decorator

```python
@rayai.tool                                    # Default resources
def simple_tool(x: str) -> str: ...

@rayai.tool(num_cpus=2, memory="4GB")          # Custom resources
def heavy_tool(data: str) -> str: ...

@rayai.tool(num_gpus=1)                        # GPU tool
def ml_tool(text: str) -> str: ...
```

## Sandboxed Code Execution

Execute untrusted code safely in isolated containers. API compatible with E2B, Modal, and Kubernetes agent-sandbox.

### Basic Usage

```python
from rayai.sandbox import Sandbox

with Sandbox() as sandbox:
    result = sandbox.run_code("print('hello')")
    print(result.stdout)  # "hello"

# Session persistence - variables persist across calls
sandbox = Sandbox()
sandbox.run_code("x = 42")
result = sandbox.run_code("print(x)")
print(result.stdout)  # "42"

# Shell commands
result = sandbox.exec("ls -la /tmp")

# File upload
sandbox.upload("/tmp/data.csv", b"a,b\n1,2")

# Cleanup
sandbox.terminate()
```

### Custom Environment

```python
sandbox = Sandbox(
    dockerfile="""
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas numpy faker
"""
)

with sandbox:
    result = sandbox.run_code("import pandas; print(pandas.__version__)")
    print(result.stdout)
```

### For AI Agents

`sandbox.run_code` is a rayai.tool - pass it directly to your agent:

```python
from rayai.sandbox import Sandbox
from pydantic_ai import Agent

sandbox = Sandbox(dockerfile="FROM python:3.12-slim\nRUN pip install pandas")

agent = Agent(
    "openai:gpt-4o-mini",
    system_prompt="Execute Python code when asked.",
    tools=[sandbox.run_code],
)

rayai.serve(agent, name="code_agent")
```

### Result Object

```python
result = sandbox.run_code("print(1 + 1)")
result.stdout    # "2"
result.stderr    # ""
result.exit_code # 0
result.success   # True
result.text      # "2" (alias for stdout, E2B compatible)
```

### Sandbox Constraints

- **No network access** - Pre-install packages via Dockerfile
- **Resource limits** - Memory, CPU, timeout enforced
- **Session persistence** - Variables persist within sandbox instance

### Backend Configuration

Auto-detects Docker (local) or Kubernetes (production):

```bash
export RAYAI_SANDBOX_BACKEND=docker      # Force Docker
export RAYAI_SANDBOX_BACKEND=kubernetes  # Force Kubernetes
export RAYAI_SANDBOX_TEMPLATE=python-runtime-template
```

## Code Execution Agent Example

```python
import rayai
from pydantic_ai import Agent
from rayai.sandbox import Sandbox

SYSTEM_PROMPT = """You are a Python assistant. Use run_code to execute code.
Explain what the code does and interpret the results."""

sandbox = Sandbox(
    dockerfile="""
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas numpy faker
""",
    timeout=120,
)

agent = Agent(
    "openai:gpt-4o-mini",
    system_prompt=SYSTEM_PROMPT,
    tools=[sandbox.run_code],
)

rayai.serve(agent, name="code_executor", num_cpus=1, memory="2GB")
```

## Calling Agents via HTTP

```bash
curl -X POST http://localhost:8000/agents/my_agent/ \
  -H "Content-Type: application/json" \
  -d '{"query": "Calculate the first 10 fibonacci numbers"}'
```

**Request:**
```json
{"query": "user input", "session_id": "optional"}
```

**Response:**
```json
{"response": "agent output", "session_id": "id"}
```

## Running Agents

```bash
# Run all agents
rayai up

# Run single agent directly
python agents/my_agent/agent.py

# Run specific agents
rayai up --agents code_executor,analyzer
```
