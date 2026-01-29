"""
Superserve Sandbox - Secure code execution in isolated containers.

API compatible with E2B, Modal, and Kubernetes agent-sandbox patterns.
Automatically selects Docker (local) or Kubernetes (production) backend.

Basic usage:
    from superserve.sandbox import Sandbox

    with Sandbox() as sandbox:
        result = sandbox.run_code("print('hello')")
        print(result.stdout)  # "hello"

With custom environment:
    sandbox = Sandbox(
        dockerfile="FROM python:3.12-slim\\nRUN pip install pandas numpy"
    )
    with sandbox:
        result = sandbox.run_code("import pandas; print(pandas.__version__)")
        print(result.stdout)

For AI agents (run_code is a superserve.tool):
    from superserve.sandbox import Sandbox
    from pydantic_ai import Agent

    sandbox = Sandbox(dockerfile="FROM python:3.12-slim\\nRUN pip install pandas")
    agent = Agent("openai:gpt-4o-mini", tools=[sandbox.run_code])
    superserve.serve(agent, name="my_agent")

Session persistence:
    sandbox = Sandbox()
    sandbox.run_code("x = 42")
    result = sandbox.run_code("print(x)")  # Variables persist
    print(result.stdout)  # "42"

Shell commands:
    result = sandbox.exec("ls -la /tmp")
    print(result.stdout)

File upload:
    sandbox.upload("/tmp/data.csv", b"a,b\\n1,2")
    sandbox.run_code("import pandas as pd; print(pd.read_csv('/tmp/data.csv'))")

Backend configuration:
    export SUPERSERVE_SANDBOX_BACKEND=kubernetes  # Force Kubernetes
    export SUPERSERVE_SANDBOX_BACKEND=docker      # Force Docker
    export SUPERSERVE_SANDBOX_TEMPLATE=python-runtime-template  # K8s template
"""

from .backend import SandboxBackend, get_backend_type
from .sandbox import ExecutionResult, Sandbox
from .tools import (
    cleanup_session,
    create_execute_python_tool,
    execute_code,
    execute_shell,
    get_session_stats,
    upload_file,
)
from .types import (
    CleanupError,
    CleanupResult,
    ExecutionError,
    SessionStats,
    UploadError,
    UploadResult,
)

__all__ = [
    # Standard API
    "Sandbox",
    "ExecutionResult",
    # Tools (ray.remote) - low-level API
    "execute_code",
    "execute_shell",
    "upload_file",
    "get_session_stats",
    "cleanup_session",
    # Tools (superserve.tool) - deprecated, use Sandbox instead
    "create_execute_python_tool",
    # Types
    "ExecutionResult",
    "ExecutionError",
    "UploadResult",
    "UploadError",
    "SessionStats",
    "CleanupResult",
    "CleanupError",
    # Backend
    "SandboxBackend",
    "get_backend_type",
]
