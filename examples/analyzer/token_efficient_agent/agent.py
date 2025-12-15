"""Token-Efficient Agent with Autonomous Code Execution

This agent autonomously explores and executes Python code to analyze datasets.
The agent writes Python code directly, which is executed in a sandboxed environment.
"""

import os

# Import Ray sandbox from main package
# This file is in: examples/analyzer/token_efficient_agent/
# We need to import from: src/rayai/
import sys
from collections.abc import Generator
from pathlib import Path
from typing import Any

import ray
from openai import OpenAI

project_root = Path(__file__).parent.parent.parent.parent
src_path = project_root / "src"
if src_path.exists() and str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from rayai.sandbox import (
    execute_code as ray_execute_code,
)
from rayai.sandbox import (
    execute_shell as ray_execute_shell,
)


class TokenEfficientAgent:
    """Agent that autonomously executes code for data analysis."""

    EXECUTE_CODE_TOOL = {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "Execute Python code in a sandboxed environment. Variables persist across executions within the same session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute. Always include necessary imports. Use print() to see results.",
                    }
                },
                "required": ["code"],
            },
        },
    }

    EXECUTE_SHELL_TOOL = {
        "type": "function",
        "function": {
            "name": "execute_shell",
            "description": "Execute shell command in the sandboxed environment. Use for: file inspection (ls, head, wc), system commands. NOTE: No network access - packages must be pre-installed in Docker image.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute (e.g., 'ls -lh /mnt', 'pip list | grep pandas')",
                    }
                },
                "required": ["command"],
            },
        },
    }

    def __init__(
        self,
        session_id: str,
        datasets_path: str,
        servers_path: str,
        mcp_server_url: str = "http://localhost:8000/mcp",
        dockerfile_path: str | None = None,
        image: str | None = None,
        model: str = "gpt-4o",
        max_iterations: int = 15,
    ):
        """Initialize the token-efficient agent.

        Args:
            session_id: Unique identifier for this analysis session
            datasets_path: Path to datasets directory on host
            servers_path: Path to MCP servers directory on host
            mcp_server_url: URL of the MCP server (default: 'http://localhost:8265/mcp')
            dockerfile_path: Optional path to custom Dockerfile (will build image)
            image: Optional pre-built Docker image name (e.g., 'token-efficient-agent')
            model: OpenAI model to use
            max_iterations: Maximum number of tool calls per user message
        """
        self.session_id = session_id
        self.client = OpenAI()
        self.model = model
        self.max_iterations = max_iterations

        # Setup volume mounts (only servers - datasets accessed via MCP)
        self.datasets_path = str(Path(datasets_path).resolve())
        self.servers_path = str(Path(servers_path).resolve())
        self.volumes = {
            self.servers_path: {"bind": "/mnt/servers", "mode": "ro"},
        }

        # MCP allowlist for sidecar proxy
        self.mcp_allowlist = [mcp_server_url]

        self.image = image
        self.dockerfile = None
        if not image and dockerfile_path and os.path.exists(dockerfile_path):
            with open(dockerfile_path) as f:
                self.dockerfile = f.read()

        self.conversation_history: list[dict[str, Any]] = []

        self.system_prompt = """Data analysis assistant with Python code execution and shell access.

Environment: Python 3.12 (pandas, numpy, matplotlib), headless - use print()
IMPORTANT: No network access - all packages pre-installed

Tools Available:
- execute_code: Run Python code (variables persist across calls)
- execute_shell: Run shell commands (for ls, wc, grep, etc.)

CRITICAL - Dataset Access:
- Datasets are NOT directly mounted - DO NOT use /mnt/datasets
- Access datasets via MCP client tools in /mnt/servers/datasets_client/
- Pattern:
  import sys; sys.path.append('/mnt')
  from servers.datasets_client import list_datasets, import_dataset
  datasets = list_datasets()  # Get available datasets
  result = import_dataset('file.csv')  # Get dataset content
  # result['content'] contains the file as string

CRITICAL - Data Processing:
- NEVER print dataset content, MCP result dicts, or raw data
- DO NOT print result['content'] or the result dict itself
- DO NOT print DataFrames or large data structures
- ONLY print final answers, summaries, and statistics
- Pattern:
  from io import StringIO
  import pandas as pd
  result = import_dataset('data.csv')  # DON'T print this
  df = pd.read_csv(StringIO(result['content']))  # DON'T print this
  answer = df['column'].value_counts().idxmax()  # Analyze
  print(f"Most popular: {answer}")  # ONLY print answer

CRITICAL - Imports:
- Imports DO NOT persist between code blocks
- EVERY code block must re-import ALL needed modules
- Import pattern: sys.path.append('/mnt'); from servers.CLIENT import tool

Shell Usage:
- Check installed packages: execute_shell("pip list | grep pandas")
- System commands: execute_shell("ls -lh /mnt/servers")

Work step-by-step. Variables persist, imports don't."""

    def chat(self, user_message: str) -> Generator[str, None, None]:
        """Chat with the agent - it will autonomously explore and execute code.

        Args:
            user_message: The user's question

        Yields:
            Status messages and final response
        """
        self.conversation_history.append({"role": "user", "content": user_message})

        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1

            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        *self.conversation_history,
                    ],
                    tools=[self.EXECUTE_CODE_TOOL, self.EXECUTE_SHELL_TOOL],
                    tool_choice="auto",
                    temperature=0,
                )
            except Exception as e:
                yield f"\n[Error calling OpenAI: {e}]\n"
                return

            message = response.choices[0].message

            # Save assistant message to history
            self.conversation_history.append(message.model_dump(exclude_unset=True))

            # Handle tool calls
            if message.tool_calls:
                for tool_call in message.tool_calls:
                    import json

                    args = json.loads(tool_call.function.arguments)

                    # Dispatch to appropriate handler
                    if tool_call.function.name == "execute_code":
                        code = args.get("code", "")
                        yield f"\n[Executing code]\n```python\n{code}\n```\n"
                        result = self._execute_code(code)
                        result_content = self._format_output(result, tool_type="code")

                    elif tool_call.function.name == "execute_shell":
                        command = args.get("command", "")
                        yield f"\n[Executing shell]\n```bash\n{command}\n```\n"
                        result = self._execute_shell(command)
                        result_content = self._format_output(result, tool_type="shell")

                    else:
                        continue

                    # Yield output to user
                    for line in result_content.split("\n"):
                        if line.strip():
                            yield f"{line}\n"

                    # Add to conversation history
                    self.conversation_history.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": result_content,
                        }
                    )
            else:
                # No tool calls - agent finished
                if message.content:
                    yield f"\n{message.content}\n"
                break

        if iteration >= self.max_iterations:
            yield f"\n[Reached maximum iterations ({self.max_iterations})]\n"

    def _execute_code(self, code: str) -> dict[str, Any]:
        """Execute code using Ray.

        Args:
            code: Python code to execute

        Returns:
            Execution result dictionary
        """
        try:
            kwargs = {
                "code": code,
                "session_id": self.session_id,
                "volumes": self.volumes,
                "mcp_allowlist": self.mcp_allowlist,
                "timeout": 300,
            }

            if self.image:
                kwargs["image"] = self.image
            elif self.dockerfile:
                kwargs["dockerfile"] = self.dockerfile

            result = ray.get(ray_execute_code.remote(**kwargs))
            return result

        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "exit_code": 1,
            }

    def _execute_shell(self, command: str) -> dict[str, Any]:
        """Execute shell command using Ray.

        Args:
            command: Shell command to execute

        Returns:
            Execution result dictionary
        """
        try:
            kwargs = {
                "command": command,
                "session_id": self.session_id,
                "volumes": self.volumes,
                "mcp_allowlist": self.mcp_allowlist,
                "timeout": 300,
            }

            if self.image:
                kwargs["image"] = self.image
            elif self.dockerfile:
                kwargs["dockerfile"] = self.dockerfile

            result = ray.get(ray_execute_shell.remote(**kwargs))
            return result

        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "exit_code": 1,
            }

    def _format_output(self, result: dict[str, Any], tool_type: str = "code") -> str:
        """Format execution result for display and context.

        Args:
            result: Execution result dict
            tool_type: Type of tool ("code" or "shell")

        Returns:
            Formatted result string
        """
        if result["status"] == "success" and result.get("exit_code", 0) == 0:
            output = result.get("stdout", "").strip()
            if not output:
                return (
                    "SUCCESS - No output"
                    if tool_type == "shell"
                    else "No output. You must use print() to see results."
                )

            # Truncate large outputs
            max_chars = 2000
            max_lines = 50

            if len(output) > max_chars or len(output.split("\n")) > max_lines:
                lines = output.split("\n")
                warning = (
                    "[You printed raw dataset/large data. Only print summaries and answers!]"
                    if tool_type == "code"
                    else "[Output truncated]"
                )
                truncated = (
                    "\n".join(lines[:10])
                    + f"\n\n[... Output truncated - too large ...]\n{warning}\n\n"
                    + "\n".join(lines[-10:])
                )
                status = (
                    "ERROR: Output too large (dataset printed). Only print summaries, not raw data."
                    if tool_type == "code"
                    else f"SUCCESS (truncated)\nOutput:\n{truncated}"
                )
                return (
                    status
                    if tool_type == "code"
                    else f"SUCCESS (truncated)\nOutput:\n{truncated}"
                )

            return f"SUCCESS\nOutput:\n{output}"
        else:
            error = result.get("stderr") or result.get("error", "Unknown error")
            return f"ERROR\n{error}"

    def clear_history(self):
        """Clear conversation history (session variables persist in sandbox)."""
        self.conversation_history = []
