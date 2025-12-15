"""
MCP Sidecar Proxy Server

Bridges Unix socket communication from sandbox to HTTP MCP Ray Serve endpoints.
Enforces allowlist of approved MCP servers and logs all requests for auditing.
"""

import json
import logging
import os
import socket
import sys
from pathlib import Path
from typing import Any

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class MCPProxyServer:
    """
    Sidecar proxy server for MCP communication.

    Listens on Unix socket and forwards requests to allowed MCP HTTP endpoints.
    """

    def __init__(
        self,
        socket_path: str,
        allowlist: list[str],
        max_message_size: int = 10 * 1024 * 1024,  # 10MB
    ):
        """
        Initialize MCP proxy server.

        Args:
            socket_path: Path to Unix socket file
            allowlist: List of allowed MCP server URLs
            max_message_size: Maximum message size in bytes
        """
        self.socket_path = socket_path
        self.allowlist = set(allowlist)
        self.max_message_size = max_message_size
        self.sock: socket.socket | None = None

        logger.info(f"Initializing MCP proxy with socket: {socket_path}")
        logger.info(f"Allowlist: {self.allowlist}")

    def start(self) -> None:
        """Start the proxy server."""
        # Remove socket file if it exists
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
            logger.info(f"Removed existing socket: {self.socket_path}")

        # Create socket directory if needed
        socket_dir = os.path.dirname(self.socket_path)
        if socket_dir:
            Path(socket_dir).mkdir(parents=True, exist_ok=True)

        # Create Unix socket
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(self.socket_path)

        # Make socket accessible (important for Docker volume mounts)
        # Note: chmod may fail on some Docker volume types (e.g., macOS), but socket will still work
        try:
            os.chmod(self.socket_path, 0o666)
        except OSError as e:
            logger.warning(
                f"Could not chmod socket (this is normal on some platforms): {e}"
            )

        self.sock.listen(5)
        logger.info(f"MCP proxy listening on {self.socket_path}")

        try:
            while True:
                conn, _ = self.sock.accept()
                logger.debug("Accepted new connection")
                try:
                    self._handle_connection(conn)
                except Exception as e:
                    logger.error(f"Error handling connection: {e}", exc_info=True)
                finally:
                    conn.close()
        except KeyboardInterrupt:
            logger.info("Shutting down MCP proxy")
        finally:
            self.cleanup()

    def _handle_connection(self, conn: socket.socket) -> None:
        """Handle a single client connection."""
        # Read message length (4 bytes, big-endian)
        length_bytes = conn.recv(4)
        if not length_bytes:
            return

        message_length = int.from_bytes(length_bytes, byteorder="big")

        if message_length > self.max_message_size:
            error = {
                "error": f"Message too large: {message_length} bytes (max: {self.max_message_size})"
            }
            self._send_response(conn, error)
            return

        # Read message data
        data = b""
        while len(data) < message_length:
            chunk = conn.recv(min(4096, message_length - len(data)))
            if not chunk:
                break
            data += chunk

        if len(data) != message_length:
            error = {"error": "Incomplete message received"}
            self._send_response(conn, error)
            return

        # Parse request
        try:
            request = json.loads(data.decode("utf-8"))
        except json.JSONDecodeError as e:
            error = {"error": f"Invalid JSON: {e}"}
            self._send_response(conn, error)
            return

        # Process request
        response = self._process_request(request)
        self._send_response(conn, response)

    def _process_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """
        Process MCP request and forward to HTTP endpoint.

        Args:
            request: MCP request with 'url', 'tool', and 'arguments'

        Returns:
            MCP response or error
        """
        url = request.get("url")
        tool = request.get("tool")
        arguments = request.get("arguments", {})

        if not url:
            return {"error": "Missing 'url' in request"}
        if not tool:
            return {"error": "Missing 'tool' in request"}

        # Check allowlist
        if url not in self.allowlist:
            logger.warning(f"Blocked request to unauthorized URL: {url}")
            return {
                "error": f"URL not in allowlist: {url}",
                "allowed_urls": list(self.allowlist),
            }

        # Log request for auditing
        logger.info(f"Forwarding request: {tool} -> {url}")
        logger.debug(f"Arguments: {arguments}")

        # Forward request to MCP server
        try:
            response = requests.post(
                f"{url}/tools/call",
                json={"tool": tool, "arguments": arguments},
                timeout=30,
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"Request successful: {tool}")
            logger.debug(f"Response: {result}")

            return {"result": result}

        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {tool} -> {url}")
            return {"error": "Request timeout (30s)"}

        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error: {tool} -> {url}: {e}")
            return {"error": f"Cannot connect to MCP server: {url}"}

        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error: {tool} -> {url}: {e}")
            return {"error": f"MCP server error: {e}"}

        except Exception as e:
            logger.error(f"Unexpected error: {tool} -> {url}: {e}", exc_info=True)
            return {"error": f"Unexpected error: {e}"}

    def _send_response(self, conn: socket.socket, response: dict[str, Any]) -> None:
        """Send response back to client."""
        response_bytes = json.dumps(response).encode("utf-8")
        length_bytes = len(response_bytes).to_bytes(4, byteorder="big")

        conn.sendall(length_bytes + response_bytes)

    def cleanup(self) -> None:
        """Clean up socket and resources."""
        if self.sock:
            self.sock.close()
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        logger.info("Cleanup complete")


def main() -> None:
    """Main entry point for sidecar proxy."""
    # Get configuration from environment variables
    socket_path = os.getenv("MCP_SOCKET_PATH", "/tmp/mcp.sock")
    allowlist_str = os.getenv("MCP_ALLOWLIST", "")

    if not allowlist_str:
        logger.error("MCP_ALLOWLIST environment variable not set")
        sys.exit(1)

    # Parse allowlist (comma-separated URLs)
    allowlist = [url.strip() for url in allowlist_str.split(",") if url.strip()]

    if not allowlist:
        logger.error("MCP_ALLOWLIST is empty")
        sys.exit(1)

    # Start server
    server = MCPProxyServer(socket_path, allowlist)
    server.start()


if __name__ == "__main__":
    main()
