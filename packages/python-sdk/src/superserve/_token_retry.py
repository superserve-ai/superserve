"""Shared self-healing retry for data-plane operations.

A paused sandbox answers the data plane two ways: ``401`` (the per-sandbox
access token is no longer valid) or ``503`` (the VM isn't running). Both clear
by ``POST /activate``, which resumes the sandbox and rotates the access token.
So on either signal we activate once and retry the operation with the fresh
token — this is what makes "a command/file op auto-resumes a paused sandbox"
true. Any other failure (404, 409, a genuine 500, ...) propagates untouched.

``commands`` and ``files`` (sync and async) all run through this single
predicate so the resume policy can't drift between them.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

from .errors import AuthenticationError, SandboxError, ServerError

T = TypeVar("T")


def is_resumable(err: SandboxError) -> bool:
    """Does this error mean the sandbox is paused/unreachable and a
    ``POST /activate`` would fix it? 401/403 (stale token) or 503 (VM not
    running). A genuine 500 is NOT resumable — only 503 signals a paused
    sandbox.
    """
    if isinstance(err, AuthenticationError):
        return True
    if isinstance(err, ServerError):
        return err.status_code == 503
    return False


def with_token_retry(
    get_access_token: Callable[[], str],
    refresh_activate: Callable[[], str],
    send: Callable[[str], T],
) -> T:
    """Run ``send`` with the current token; on a resumable failure, activate
    (resume + rotate token) and retry exactly once with the fresh token.
    """
    try:
        return send(get_access_token())
    except SandboxError as err:
        if not is_resumable(err):
            raise
        fresh = refresh_activate()
        return send(fresh)


async def async_with_token_retry(
    get_access_token: Callable[[], str],
    refresh_activate: Callable[[], Awaitable[str]],
    send: Callable[[str], Awaitable[T]],
) -> T:
    """Async variant of :func:`with_token_retry`."""
    try:
        return await send(get_access_token())
    except SandboxError as err:
        if not is_resumable(err):
            raise
        fresh = await refresh_activate()
        return await send(fresh)
