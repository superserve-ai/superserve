"""Error types for the Superserve Python SDK."""


class SuperserveError(Exception):
    """Base error for all Superserve SDK errors."""


class APIError(SuperserveError):
    """An error returned by the Superserve API."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
    ) -> None:
        super().__init__(f"[{status_code}] {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
