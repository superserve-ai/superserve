from superserve import _http


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
