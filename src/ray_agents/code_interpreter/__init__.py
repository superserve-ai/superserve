"""
Ray Code Interpreter - Execute Python code securely in Docker containers

Basic usage:
    from ray_agents.code_interpreter import execute_code

    result = ray.get(execute_code.remote("print('Hello!')"))
    print(result["stdout"])  # "Hello!"

With sessions:
    # Session 1
    ray.get(execute_code.remote("x = 5", session_id="user-123"))
    result = ray.get(execute_code.remote("print(x)", session_id="user-123"))
    # Output: 5 (state persisted)

With custom environments:
    dockerfile = '''
    FROM python:3.11-slim
    RUN pip install numpy pandas
    '''
    result = ray.get(execute_code.remote(
        "import pandas; print(pandas.__version__)",
        dockerfile=dockerfile,
        session_id="custom-env"
    ))
"""

from .tools import (
    cleanup_session,
    execute_code,
    get_session_stats,
    install_package,
    upload_file,
)
from .types import (
    CleanupError,
    CleanupResult,
    ExecutionError,
    ExecutionResult,
    InstallError,
    InstallResult,
    SessionStats,
    UploadError,
    UploadResult,
)

__all__ = [
    # Tools
    "execute_code",
    "install_package",
    "upload_file",
    "get_session_stats",
    "cleanup_session",
    # Types
    "ExecutionResult",
    "ExecutionError",
    "InstallResult",
    "InstallError",
    "UploadResult",
    "UploadError",
    "SessionStats",
    "CleanupResult",
    "CleanupError",
]
