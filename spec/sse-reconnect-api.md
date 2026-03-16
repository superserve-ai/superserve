# SSE Reconnect: Required API Endpoint

## Context

The CLI needs to auto-reconnect SSE streams when a connection drops mid-stream (network issues, proxy timeouts, server restarts). To resume without replaying already-received events, the server must support fetching events from a given offset.

## Required Endpoint

### `GET /v1/sessions/{session_id}/events?after=N`

Resume an active session's event stream from a sequence offset.

**Path parameters:**
- `session_id` (string, required): The session ID.

**Query parameters:**
- `after` (integer, optional): Sequence number to resume from. Only events with a sequence number greater than `after` are returned. Defaults to `0` (all events).

**Response:**
- Content-Type: `text/event-stream`
- Streams SSE events in the same format as `POST /sessions/{id}/messages`.
- Events must be ordered by sequence number.
- The stream should remain open until a terminal event (`run.completed`, `run.failed`, `run.cancelled`) is sent.

**Status codes:**
- `200` — Streaming response.
- `401` — Unauthorized.
- `404` — Session not found or already ended.
- `410` — Session expired / cleaned up.

**Behavior notes:**
- If the session's run already completed while the client was disconnected, the endpoint should immediately replay any remaining events (including the terminal event) and close.
- The server must buffer or persist events for at least the duration of a run so that reconnecting clients can resume.
- Heartbeat events should continue on the reconnected stream to keep the connection alive.

## How the CLI Uses This

1. CLI streams events from `POST /sessions/{id}/messages` and increments a local `lastSequence` counter per event.
2. On `ConnectionError` / `ChunkedEncodingError`, the CLI calls `GET /sessions/{id}/events?after=lastSequence` to resume.
3. Retries use exponential backoff: `min(2 * 2^(attempt-1), 30)` seconds, max 10 attempts.
4. 4xx errors from this endpoint cause immediate failure (non-retriable). 5xx errors trigger continued retries.

## Reference

Originally implemented for the Python CLI in PR #120 (`pavitra/cli-sse-reconnect`), which was closed due to monorepo migration conflicts. The Python client method:

```python
def stream_session_events(self, session_id: str, after: int = 0) -> Iterator[RunEvent]:
    params = {}
    if after > 0:
        params["after"] = str(after)
    resp = self._request("GET", f"/sessions/{session_id}/events", params=params, stream=True)
    yield from self._parse_sse_stream(resp)
```
