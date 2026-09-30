import httpx
import pytest
import respx
from superserve import AsyncSnapshot, _http, async_connection_pool

from .test_snapshots import API, SNAP, _snap


def test_calls_share_one_client_per_process(monkeypatch):
    monkeypatch.setattr(_http, "_shared", None)
    first = _http.shared_client()
    assert _http.shared_client() is first


def test_a_forked_child_gets_its_own_client_and_a_free_lock(monkeypatch):
    monkeypatch.setattr(_http, "_shared", None)
    parent = _http.shared_client()
    # A parent thread held the lock at the moment of the fork.
    assert _http._shared_lock.acquire(blocking=False)
    _http._reset_shared_client()
    child = _http.shared_client()
    assert child is not parent


@pytest.mark.asyncio
async def test_async_calls_share_the_pool_inside_the_block_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)
    made: list[httpx.AsyncClient] = []
    real = httpx.AsyncClient

    def counting(*args: object, **kwargs: object) -> httpx.AsyncClient:
        client = real(*args, **kwargs)  # type: ignore[arg-type]
        made.append(client)
        return client

    monkeypatch.setattr(_http.httpx, "AsyncClient", counting)
    with respx.mock() as router:
        router.get(f"{API}/snapshots/{SNAP}").mock(
            return_value=httpx.Response(200, json=_snap())
        )
        async with async_connection_pool():
            for _ in range(3):
                await AsyncSnapshot.get(SNAP)
        assert len(made) == 1 and made[0].is_closed
        for _ in range(2):
            await AsyncSnapshot.get(SNAP)
        assert len(made) == 3
