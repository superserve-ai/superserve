from __future__ import annotations

import http.server
import json
import threading
import time
from collections.abc import Callable, Iterator

import pytest

_BODY = json.dumps(
    {
        "id": "sbx-1",
        "name": "test",
        "status": "paused",
        "created_at": "2026-01-01T00:00:00Z",
        "access_token": "tok",
    }
).encode()


@pytest.fixture
def stalling_server() -> Iterator[Callable[[str], http.server.ThreadingHTTPServer]]:
    """Starts servers that send part of a response and then go quiet for 2s:
    the body after its first bytes ("body"), or the headers themselves
    ("headers"). Every server started is shut down afterwards."""
    servers: list[http.server.ThreadingHTTPServer] = []

    def start(stall_in: str) -> http.server.ThreadingHTTPServer:
        class Stall(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if stall_in == "headers":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    )
                    self.wfile.flush()
                    time.sleep(2.0)
                    rest = f"Content-Length: {len(_BODY)}\r\n\r\n".encode() + _BODY
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(_BODY)))
                    self.end_headers()
                    self.wfile.write(_BODY[:4])
                    self.wfile.flush()
                    time.sleep(2.0)
                    rest = _BODY[4:]
                try:
                    self.wfile.write(rest)
                except OSError:
                    pass

            def log_message(self, *args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stall)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()
