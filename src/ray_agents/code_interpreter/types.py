"""Type definitions for code interpreter"""

from typing import TypedDict


class ExecutionResult(TypedDict):
    """Result from code execution"""

    status: str  # "success" or "error"
    stdout: str
    stderr: str
    exit_code: int
    execution_id: str


class ExecutionError(TypedDict):
    """Error result from code execution"""

    status: str  # "error"
    error: str
    error_type: str
    execution_id: str


class InstallResult(TypedDict):
    """Result from package installation"""

    status: str  # "success" or "error"
    stdout: str
    stderr: str
    exit_code: int


class InstallError(TypedDict):
    """Error result from package installation"""

    status: str  # "error"
    error: str
    error_type: str


class UploadResult(TypedDict):
    """Result from file upload"""

    status: str  # "success"
    path: str
    size: int


class UploadError(TypedDict):
    """Error result from file upload"""

    status: str  # "error"
    error: str
    error_type: str


class SessionStats(TypedDict):
    """Session statistics"""

    session_id: str
    execution_count: int
    created_at: float
    uptime: float
    container_status: str


class CleanupResult(TypedDict):
    """Result from session cleanup"""

    status: str  # "success" or "error"
    session_id: str


class CleanupError(TypedDict):
    """Error result from session cleanup"""

    status: str  # "error"
    error: str
    session_id: str
