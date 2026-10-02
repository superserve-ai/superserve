"""Shared retry policy for command and file operations.

Authentication failures and proven pre-dispatch routing failures activate once
before retrying. Hinted requests require a specific error code for 503 responses;
unhinted requests retain the legacy 503 auto-resume behavior.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

from ._routing_hint import routing_hint_expired
from .errors import AuthenticationError, SandboxError, ServerError

T = TypeVar("T")


def is_resumable(err: SandboxError, hinted: bool = False) -> bool:
    """Whether activation can resolve a pre-dispatch failure."""
    if err.status_code == 404 and err.code == "sandbox_route_stale":
        return True
    if isinstance(err, AuthenticationError):
        return True
    if isinstance(err, ServerError):
        return err.status_code == 503 and (
            not hinted or err.code == "sandbox_unavailable"
        )
    return False


def with_token_retry(
    get_access_token: Callable[[], str],
    refresh_activate: Callable[[], str],
    send: Callable[[str], T],
    get_routing_hint: Callable[[], str | None] = lambda: None,
    refresh_expired_hint: Callable[[], str] | None = None,
) -> T:
    """Run ``send`` with the current token; on a resumable failure, activate
    (resume + rotate token) and retry exactly once with the fresh token.
    """
    if routing_hint_expired(get_routing_hint):
        (refresh_expired_hint or refresh_activate)()
    hinted = bool(get_routing_hint())
    try:
        return send(get_access_token())
    except SandboxError as err:
        if not is_resumable(err, hinted):
            raise
        fresh = refresh_activate()
        return send(fresh)


async def async_with_token_retry(
    get_access_token: Callable[[], str],
    refresh_activate: Callable[[], Awaitable[str]],
    send: Callable[[str], Awaitable[T]],
    get_routing_hint: Callable[[], str | None] = lambda: None,
    refresh_expired_hint: Callable[[], Awaitable[str]] | None = None,
) -> T:
    """Async variant of :func:`with_token_retry`."""
    if routing_hint_expired(get_routing_hint):
        await (refresh_expired_hint or refresh_activate)()
    hinted = bool(get_routing_hint())
    try:
        return await send(get_access_token())
    except SandboxError as err:
        if not is_resumable(err, hinted):
            raise
        fresh = await refresh_activate()
        return await send(fresh)
