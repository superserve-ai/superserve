import asyncio

from superserve import _http


def test_calls_share_one_client_per_process(monkeypatch):
    monkeypatch.setattr(_http, "_shared", None)
    first = _http.shared_client()
    assert _http.shared_client() is first
    # A forked child must not reuse the parent's pooled sockets.
    monkeypatch.setattr(_http.os, "getpid", lambda: -1)
    assert _http.shared_client() is not first


def test_async_calls_share_one_client_per_event_loop():
    async def pair():
        return _http.shared_async_client(), _http.shared_async_client()

    a1, a2 = asyncio.run(pair())
    b1, _ = asyncio.run(pair())
    assert a1 is a2
    assert b1 is not a1
