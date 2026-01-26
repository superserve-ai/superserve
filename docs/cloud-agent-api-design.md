# Cloud Agent API Design

Ray Serve deployment wrapping Claude Agent SDK with rayai sandbox integration.

## Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │         Ray Cluster                 │
                                    │                                     │
┌──────────┐    HTTP/WS            │  ┌─────────────────────────────┐    │
│  Client  │ ──────────────────────┼─►│    CloudAgentDeployment     │    │
└──────────┘                       │  │    (Ray Serve)              │    │
                                   │  │                             │    │
                                   │  │  ┌───────────────────────┐  │    │
                                   │  │  │  Claude Agent SDK     │  │    │
                                   │  │  │  - Claude Code CLI    │  │    │
                                   │  │  │  - Built-in tools     │  │    │
                                   │  │  │  - MCP: rayai sandbox │──┼────┼───►  Sandbox Pods
                                   │  │  └───────────────────────┘  │    │      (K8s/Docker)
                                   │  └─────────────────────────────┘    │
                                   │                                     │
                                   └─────────────────────────────────────┘
```

## HTTP API

### POST /agent/run

Run a single agent task (ephemeral session).

**Request:**
```json
{
  "prompt": "Fix the bug in auth.py that causes login failures",
  "options": {
    "model": "sonnet",
    "max_turns": 20,
    "max_budget_usd": 5.0,
    "allowed_tools": ["Read", "Edit", "Glob", "Grep", "Bash", "mcp__sandbox__execute_code"],
    "working_dir": "/workspace/myproject",
    "sandbox_enabled": true
  }
}
```

**Response (streaming NDJSON):**
```json
{"type": "status", "message": "Starting agent..."}
{"type": "thinking", "content": "Let me analyze the auth.py file..."}
{"type": "tool_use", "tool": "Read", "input": {"file_path": "/workspace/myproject/auth.py"}}
{"type": "tool_result", "tool": "Read", "output": "...file contents..."}
{"type": "tool_use", "tool": "mcp__sandbox__execute_code", "input": {"code": "import auth; auth.login('test', 'test')"}}
{"type": "tool_result", "tool": "mcp__sandbox__execute_code", "output": {"status": "error", "stderr": "LoginError..."}}
{"type": "thinking", "content": "Found the bug. The issue is..."}
{"type": "tool_use", "tool": "Edit", "input": {"file_path": "...", "old_string": "...", "new_string": "..."}}
{"type": "result", "status": "success", "summary": "Fixed login bug by...", "cost_usd": 0.45, "turns": 8}
```

### POST /agent/session

Create a persistent session for multi-turn conversations.

**Request:**
```json
{
  "session_name": "bugfix-auth-123",
  "options": {
    "model": "sonnet",
    "working_dir": "/workspace/myproject",
    "system_prompt": "You are a senior Python developer..."
  }
}
```

**Response:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_name": "bugfix-auth-123",
  "status": "created"
}
```

### POST /agent/session/{session_id}/message

Send a message to an existing session.

**Request:**
```json
{
  "prompt": "Now add unit tests for the fix"
}
```

**Response:** Same streaming format as `/agent/run`

### DELETE /agent/session/{session_id}

Terminate a session and cleanup resources.

### GET /agent/session/{session_id}/status

Get session status, history, and resource usage.

---

## WebSocket API (Alternative)

For real-time bidirectional communication:

```
ws://host/agent/ws?session_id=xxx

# Client sends:
{"type": "message", "prompt": "Fix the auth bug"}
{"type": "interrupt"}  # Stop current task

# Server sends:
{"type": "thinking", "content": "..."}
{"type": "tool_use", "tool": "Read", "input": {...}}
{"type": "tool_result", ...}
{"type": "result", ...}
```

---

## Implementation

### Dockerfile

```dockerfile
FROM python:3.11-slim

# Install Node.js (required for Claude Code CLI)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY src/ /app/src/
WORKDIR /app

# Run Ray Serve
CMD ["serve", "run", "src.cloud_agent:app"]
```

### Ray Serve Deployment

```python
# src/cloud_agent.py
import asyncio
from typing import AsyncIterator
import ray
from ray import serve
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    create_sdk_mcp_server,
    tool,
)

# Create rayai sandbox MCP server
@tool("execute_code", "Execute Python code in isolated sandbox", {
    "code": str,
    "session_id": str,
    "timeout": int,
})
async def execute_code(args: dict) -> dict:
    """Execute code in rayai sandbox."""
    from rayai.sandbox import execute_code as sandbox_execute
    result = await sandbox_execute.remote(
        code=args["code"],
        session_id=args.get("session_id", "default"),
        timeout=args.get("timeout", 30),
    )
    return {"content": [{"type": "text", "text": str(ray.get(result))}]}

@tool("execute_shell", "Execute shell command in isolated sandbox", {
    "command": str,
    "session_id": str,
    "timeout": int,
})
async def execute_shell(args: dict) -> dict:
    """Execute shell in rayai sandbox."""
    from rayai.sandbox import execute_shell as sandbox_shell
    result = await sandbox_shell.remote(
        command=args["command"],
        session_id=args.get("session_id", "default"),
        timeout=args.get("timeout", 30),
    )
    return {"content": [{"type": "text", "text": str(ray.get(result))}]}

sandbox_server = create_sdk_mcp_server(
    name="sandbox",
    version="1.0.0",
    tools=[execute_code, execute_shell],
)

app = FastAPI()


class AgentRequest(BaseModel):
    prompt: str
    model: str = "sonnet"
    max_turns: int | None = None
    max_budget_usd: float | None = None
    allowed_tools: list[str] | None = None
    working_dir: str = "/workspace"
    sandbox_enabled: bool = True
    system_prompt: str | None = None


class SessionRequest(BaseModel):
    session_name: str | None = None
    model: str = "sonnet"
    working_dir: str = "/workspace"
    system_prompt: str | None = None


@serve.deployment(
    num_replicas=2,
    ray_actor_options={"num_cpus": 1, "memory": 1024 * 1024 * 1024},  # 1GB
)
@serve.ingress(app)
class CloudAgent:
    def __init__(self):
        self.sessions: dict[str, ClaudeSDKClient] = {}

    def _build_options(
        self,
        request: AgentRequest | SessionRequest,
        include_sandbox: bool = True,
    ) -> ClaudeAgentOptions:
        """Build ClaudeAgentOptions from request."""
        mcp_servers = {}
        allowed_tools = getattr(request, "allowed_tools", None) or [
            "Read", "Edit", "Write", "Glob", "Grep", "Bash"
        ]

        if include_sandbox and getattr(request, "sandbox_enabled", True):
            mcp_servers["sandbox"] = sandbox_server
            allowed_tools.extend([
                "mcp__sandbox__execute_code",
                "mcp__sandbox__execute_shell",
            ])

        return ClaudeAgentOptions(
            model=request.model,
            max_turns=getattr(request, "max_turns", None),
            max_budget_usd=getattr(request, "max_budget_usd", None),
            allowed_tools=allowed_tools,
            cwd=request.working_dir,
            system_prompt=request.system_prompt,
            mcp_servers=mcp_servers,
            permission_mode="bypassPermissions",
        )

    async def _stream_messages(
        self, client: ClaudeSDKClient
    ) -> AsyncIterator[str]:
        """Stream messages as NDJSON."""
        import json

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        yield json.dumps({
                            "type": "thinking",
                            "content": block.text
                        }) + "\n"
                    elif isinstance(block, ToolUseBlock):
                        yield json.dumps({
                            "type": "tool_use",
                            "tool": block.name,
                            "input": block.input
                        }) + "\n"

            elif isinstance(message, ResultMessage):
                yield json.dumps({
                    "type": "result",
                    "status": "success" if not message.is_error else "error",
                    "cost_usd": message.total_cost_usd,
                    "turns": message.num_turns,
                    "result": message.result,
                }) + "\n"

    @app.post("/agent/run")
    async def run(self, request: AgentRequest):
        """Run a single agent task."""
        options = self._build_options(request)

        async def generate():
            async with ClaudeSDKClient(options=options) as client:
                await client.query(request.prompt)
                async for chunk in self._stream_messages(client):
                    yield chunk

        return StreamingResponse(
            generate(),
            media_type="application/x-ndjson"
        )

    @app.post("/agent/session")
    async def create_session(self, request: SessionRequest):
        """Create a persistent session."""
        import uuid
        session_id = str(uuid.uuid4())
        options = self._build_options(request)

        client = ClaudeSDKClient(options=options)
        await client.connect()
        self.sessions[session_id] = client

        return {
            "session_id": session_id,
            "session_name": request.session_name,
            "status": "created"
        }

    @app.post("/agent/session/{session_id}/message")
    async def send_message(self, session_id: str, request: AgentRequest):
        """Send message to existing session."""
        if session_id not in self.sessions:
            raise HTTPException(status_code=404, detail="Session not found")

        client = self.sessions[session_id]

        async def generate():
            await client.query(request.prompt)
            async for chunk in self._stream_messages(client):
                yield chunk

        return StreamingResponse(
            generate(),
            media_type="application/x-ndjson"
        )

    @app.delete("/agent/session/{session_id}")
    async def delete_session(self, session_id: str):
        """Terminate session."""
        if session_id not in self.sessions:
            raise HTTPException(status_code=404, detail="Session not found")

        client = self.sessions.pop(session_id)
        await client.disconnect()
        return {"status": "deleted"}


# Create the deployment
app = CloudAgent.bind()
```

---

## Usage Example

```python
import httpx
import json

# Run a bug-fixing task
async with httpx.AsyncClient() as client:
    async with client.stream(
        "POST",
        "http://cloud-agent:8000/agent/run",
        json={
            "prompt": "Find and fix the authentication bug in src/auth.py",
            "sandbox_enabled": True,
            "max_turns": 20,
        }
    ) as response:
        async for line in response.aiter_lines():
            if line:
                event = json.loads(line)
                print(f"[{event['type']}] {event.get('content', event)}")
```

---

## Security Considerations

1. **Container Isolation**: Each Ray worker runs in isolated container
2. **Sandbox for Code Execution**: Untrusted code runs in rayai sandbox (Docker/K8s)
3. **Permission Bypass**: Only for trusted internal operations
4. **Budget Limits**: Prevent runaway costs
5. **Network Isolation**: Configure based on deployment needs

---

## Scaling

- **Horizontal**: Add Ray Serve replicas
- **Vertical**: Increase resources per replica
- **Session Affinity**: Use Ray's actor model for sticky sessions
- **Auto-scaling**: Ray Serve supports autoscaling based on load
