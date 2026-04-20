"""Typed error hierarchy for the Superserve Python SDK."""

from __future__ import annotations

from typing import Any


class SandboxError(Exception):
    """Base error for all Superserve SDK errors."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class AuthenticationError(SandboxError):
    def __init__(
        self,
        message: str = "Missing or invalid API key",
        code: str | None = None,
    ) -> None:
        super().__init__(message, status_code=401, code=code)


class ValidationError(SandboxError):
    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message, status_code=400, code=code)


class NotFoundError(SandboxError):
    def __init__(
        self,
        message: str = "Resource not found",
        code: str | None = None,
    ) -> None:
        super().__init__(message, status_code=404, code=code)


class ConflictError(SandboxError):
    def __init__(
        self,
        message: str = "Sandbox is not in a valid state for this operation",
        code: str | None = None,
    ) -> None:
        super().__init__(message, status_code=409, code=code)


class SandboxTimeoutError(SandboxError):
    """Raised when a request or polling operation times out."""

    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(message)


class ServerError(SandboxError):
    def __init__(
        self,
        message: str = "Internal server error",
        code: str | None = None,
    ) -> None:
        super().__init__(message, status_code=500, code=code)


def map_api_error(status_code: int, body: dict[str, Any]) -> SandboxError:
    """Map an HTTP status code and response body to a typed error."""
    error_data = body.get("error", {}) or {}
    message = error_data.get("message", f"API error ({status_code})")
    code = error_data.get("code")

    if status_code == 400:
        return ValidationError(message, code=code)
    elif status_code == 401:
        return AuthenticationError(message, code=code)
    elif status_code == 404:
        return NotFoundError(message, code=code)
    elif status_code == 409:
        return ConflictError(message, code=code)
    elif status_code >= 500:
        return ServerError(message, code=code)
    return SandboxError(message, status_code=status_code, code=code)
