"""Run MCP servers with Ray Serve.

The `superserve mcp up` command discovers and serves all MCP servers defined in the
mcp_servers/ directory. Each server file should call `superserve.serve_mcp()` which
registers the server for deployment.

Usage:
    superserve mcp up                    # Serve all MCP servers on port 8000
    superserve mcp up --port 8001        # Serve on custom port
    superserve mcp up --servers s1,s2    # Serve specific servers only
"""

import importlib.util
import sys
from pathlib import Path

import click
from dotenv import load_dotenv

from superserve.cli.analytics import track


@click.command()
@click.argument("project_path", default=".")
@click.option("--port", default=8000, help="Port to serve on")
@click.option("--host", default="0.0.0.0", help="Host to bind to")
@click.option("--servers", help="Serve specific servers only (comma-separated)")
def up(project_path: str, port: int, host: str, servers: str | None):
    """Run MCP servers in the mcp_servers/ directory.

    Discovers server.py files in mcp_servers/*/ and deploys them with Ray Serve.
    Each server file should call superserve.serve_mcp() to register the server.

    Examples:
        superserve mcp up                    # Serve all servers
        superserve mcp up --port 8001        # Custom port
        superserve mcp up --servers s1,s2    # Specific servers only
    """
    project_dir = Path(project_path).resolve()

    # Load environment variables from .env file
    env_file = project_dir / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        click.echo(f"Loaded environment from {env_file}")

    if not project_dir.exists():
        click.echo(f"Error: Project directory not found: {project_dir}")
        sys.exit(1)

    mcp_servers_dir = project_dir / "mcp_servers"
    if not mcp_servers_dir.exists():
        click.echo("Error: mcp_servers/ directory not found")
        click.echo("Create MCP servers with: superserve create-mcp <name>")
        sys.exit(1)

    # Ensure dependencies
    if not _ensure_dependencies():
        sys.exit(1)

    # Set superserve mcp up mode before importing servers
    from superserve.mcp_serve import (
        clear_registered_mcp_servers,
        get_registered_mcp_servers,
        run,
        set_superserve_mcp_up_mode,
    )

    set_superserve_mcp_up_mode(True)
    clear_registered_mcp_servers()

    # Discover and import server modules
    server_filter = {s.strip() for s in servers.split(",")} if servers else None
    imported_count = _import_server_modules(mcp_servers_dir, server_filter)

    if imported_count == 0:
        click.echo("Error: No server modules found")
        click.echo("Create servers with: superserve create-mcp <name>")
        sys.exit(1)

    # Get registered servers
    registered = get_registered_mcp_servers()

    if not registered:
        click.echo("Error: No MCP servers registered")
        click.echo("Ensure server.py files call superserve.serve_mcp()")
        sys.exit(1)

    track("cli_mcp_up", {"server_count": len(registered)})

    click.echo(f"\nFound {len(registered)} MCP server(s):")
    for config in registered:
        click.echo(f"  - {config.name}")

    # Start serving
    try:
        run(port=port, host=host)
    except KeyboardInterrupt:
        click.echo("\nShutting down...")
    except Exception as e:
        click.echo(f"Error: {e}")
        sys.exit(1)


def _ensure_dependencies() -> bool:
    """Ensure Ray Serve and MCP dependencies are available."""
    try:
        import ray  # noqa: F401
        from fastapi import FastAPI  # noqa: F401
        from ray import serve  # noqa: F401

        return True
    except ImportError as e:
        click.echo(f"Missing dependency: {e}")
        click.echo("Install with: pip install 'superserve[serve]'")
        return False


def _import_server_modules(
    mcp_servers_dir: Path, server_filter: set[str] | None
) -> int:
    """Import server.py modules from mcp_servers/ subdirectories.

    Args:
        mcp_servers_dir: Path to mcp_servers/ directory.
        server_filter: Set of server names to include, or None for all.

    Returns:
        Number of modules successfully imported.
    """
    imported = 0

    # Add project root to path for imports
    project_dir = mcp_servers_dir.parent
    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))

    for server_folder in sorted(mcp_servers_dir.iterdir()):
        if not server_folder.is_dir():
            continue
        if server_folder.name.startswith("__"):
            continue

        server_name = server_folder.name

        # Filter if specified
        if server_filter and server_name not in server_filter:
            continue

        server_file = server_folder / "server.py"
        if not server_file.exists():
            click.echo(f"Warning: No server.py in {server_name}/, skipping")
            continue

        # Import the module
        module_name = f"mcp_servers.{server_name}.server"
        try:
            click.echo(f"Loading {server_name}...")
            _import_module_from_file(server_file, module_name)
            imported += 1
        except Exception as e:
            click.echo(f"Error loading {server_name}: {e}")
            continue

    return imported


def _import_module_from_file(file_path: Path, module_name: str):
    """Import a Python module from a file path.

    Args:
        file_path: Path to the .py file.
        module_name: Full module name (e.g., mcp_servers.weather.server).

    Raises:
        ImportError: If module cannot be imported.
    """
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot create module spec for {file_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
