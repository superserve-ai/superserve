"""Tests for error hierarchy and map_api_error."""

from __future__ import annotations

import pytest
from superserve.errors import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    SandboxError,
    SandboxTimeoutError,
    ServerError,
    ValidationError,
    map_api_error,
)


class TestMapApiError:
    def test_400_returns_validation_error(self) -> None:
        err = map_api_error(400, {"error": {"message": "bad"}})
        assert isinstance(err, ValidationError)
        assert err.status_code == 400
        assert "bad" in str(err)

    def test_401_returns_authentication_error(self) -> None:
        err = map_api_error(401, {"error": {"message": "no key"}})
        assert isinstance(err, AuthenticationError)
        assert err.status_code == 401

    def test_404_returns_not_found_error(self) -> None:
        err = map_api_error(404, {"error": {"message": "nope"}})
        assert isinstance(err, NotFoundError)
        assert err.status_code == 404

    def test_409_returns_conflict_error(self) -> None:
        err = map_api_error(409, {"error": {"message": "busy"}})
        assert isinstance(err, ConflictError)
        assert err.status_code == 409

    def test_429_returns_generic_sandbox_error(self) -> None:
        err = map_api_error(429, {"error": {"message": "too many"}})
        # 429 is not specifically mapped — stays a base SandboxError with status_code
        assert isinstance(err, SandboxError)
        # But NOT any of the more specific typed errors
        assert not isinstance(
            err,
            (ValidationError, AuthenticationError, NotFoundError, ConflictError, ServerError),
        )
        assert err.status_code == 429

    def test_500_returns_server_error(self) -> None:
        err = map_api_error(500, {"error": {"message": "boom"}})
        assert isinstance(err, ServerError)
        assert err.status_code == 500

    def test_502_returns_server_error(self) -> None:
        err = map_api_error(502, {"error": {"message": "gateway"}})
        assert isinstance(err, ServerError)

    def test_code_preserved_on_unknown(self) -> None:
        err = map_api_error(418, {"error": {"message": "teapot", "code": "teapot_error"}})
        assert err.code == "teapot_error"
        assert err.status_code == 418

    def test_missing_error_body_uses_default(self) -> None:
        err = map_api_error(500, {})
        assert isinstance(err, ServerError)
        assert "500" in str(err) or "error" in str(err).lower()


class TestErrorHierarchy:
    def test_all_extend_sandbox_error(self) -> None:
        assert issubclass(AuthenticationError, SandboxError)
        assert issubclass(ValidationError, SandboxError)
        assert issubclass(NotFoundError, SandboxError)
        assert issubclass(ConflictError, SandboxError)
        assert issubclass(SandboxTimeoutError, SandboxError)
        assert issubclass(ServerError, SandboxError)

    def test_authentication_error_has_status_401(self) -> None:
        err = AuthenticationError()
        assert err.status_code == 401

    def test_validation_error_has_status_400(self) -> None:
        err = ValidationError("bad")
        assert err.status_code == 400

    def test_not_found_error_has_status_404(self) -> None:
        err = NotFoundError()
        assert err.status_code == 404

    def test_conflict_error_has_status_409(self) -> None:
        err = ConflictError()
        assert err.status_code == 409

    def test_server_error_has_status_500(self) -> None:
        err = ServerError()
        assert err.status_code == 500

    def test_sandbox_timeout_is_not_builtin(self) -> None:
        # Ensure our timeout doesn't shadow Python's builtin TimeoutError
        assert SandboxTimeoutError is not TimeoutError
        assert SandboxTimeoutError.__name__ == "SandboxTimeoutError"

    def test_sandbox_timeout_extends_sandbox_error(self) -> None:
        err = SandboxTimeoutError("slow")
        assert isinstance(err, SandboxError)


class TestSandboxErrorFields:
    def test_custom_message_preserved(self) -> None:
        err = SandboxError("custom", status_code=418, code="teapot")
        assert str(err) == "custom"
        assert err.status_code == 418
        assert err.code == "teapot"

    def test_raise_with_cause_chain(self) -> None:
        with pytest.raises(SandboxError) as info:
            try:
                raise ValueError("inner")
            except ValueError as inner:
                raise SandboxError("outer") from inner
        assert info.value.__cause__ is not None
