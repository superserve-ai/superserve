"""Typed error hierarchy for the Superserve Python SDK."""

from __future__ import annotations

from typing import Any, Dict, Optional


class SandboxError(Exception):
    """Base error for all Superserve SDK errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class AuthenticationError(SandboxError):
    def __init__(self, message: str = "Missing or invalid API key") -> None:
        super().__init__(message, status_code=401)


class ValidationError(SandboxError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class NotFoundError(SandboxError):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, status_code=404)


class ConflictError(SandboxError):
    def __init__(
        self, message: str = "Sandbox is not in a valid state for this operation"
    ) -> None:
        super().__init__(message, status_code=409)


class TimeoutError(SandboxError):
    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(message)


class ServerError(SandboxError):
    def __init__(self, message: str = "Internal server error") -> None:
        super().__init__(message, status_code=500)


def map_api_error(status_code: int, body: Dict[str, Any]) -> SandboxError:
    """Map an HTTP status code and response body to a typed error."""
    error_data = body.get("error", {})
    message = error_data.get("message", f"API error ({status_code})")

    if status_code == 400:
        return ValidationError(message)
    elif status_code == 401:
        return AuthenticationError(message)
    elif status_code == 404:
        return NotFoundError(message)
    elif status_code == 409:
        return ConflictError(message)
    elif status_code >= 500:
        return ServerError(message)
    return SandboxError(message, status_code=status_code)
