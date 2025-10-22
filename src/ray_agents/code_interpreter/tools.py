"""Ray remote tools for code execution"""

import logging
import time
import uuid

import ray

from .config import DEFAULT_IMAGE, DEFAULT_TIMEOUT
from .executor import CodeInterpreterExecutor
from .types import (
    CleanupError,
    CleanupResult,
    ExecutionError,
    ExecutionResult,
    InstallError,
    InstallResult,
    SessionStats,
    UploadError,
    UploadResult,
)

logger = logging.getLogger(__name__)

# Namespace for all code interpreter actors
ACTOR_NAMESPACE = "code-interpreter"


def _get_or_create_executor(
    session_id: str,
    image: str = DEFAULT_IMAGE,
    dockerfile: str | None = None,
    environment: dict[str, str] | None = None,
) -> ray.actor.ActorHandle:
    """Get existing executor or create new one for session"""
    actor_name = f"code-executor-{session_id}"

    try:
        # Try to get existing actor
        executor = ray.get_actor(actor_name, namespace=ACTOR_NAMESPACE)
        logger.debug(f"Found existing executor for session {session_id}")
        return executor
    except ValueError:
        # Actor doesn't exist, create new one
        logger.info(f"Creating new executor for session {session_id}")
        executor = CodeInterpreterExecutor.options(  # type: ignore[attr-defined]
            name=actor_name,
            namespace=ACTOR_NAMESPACE,
            lifetime="detached",
        ).remote(
            session_id=session_id,
            image=image,
            dockerfile=dockerfile,
            environment=environment,
        )
        return executor


@ray.remote
def execute_code(
    code: str,
    session_id: str | None = None,
    image: str = DEFAULT_IMAGE,
    dockerfile: str | None = None,
    environment: dict[str, str] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> ExecutionResult | ExecutionError:
    """
    Execute Python code in isolated Docker container.

    Args:
        code: Python code to execute
        session_id: Session identifier for persistence (optional, auto-generated if not provided)
        image: Docker image to use (default: python:3.11-slim)
        dockerfile: Custom Dockerfile string (optional, overrides image)
        environment: Environment variables for container
        timeout: Execution timeout in seconds

    Returns:
        Execution result with stdout, stderr, status

    Example:
        >>> result = ray.get(execute_code.remote("print('Hello!')"))
        >>> print(result["stdout"])
        Hello!

        >>> # With session persistence
        >>> ray.get(execute_code.remote("x = 42", session_id="my-session"))
        >>> result = ray.get(execute_code.remote("print(x)", session_id="my-session"))
        >>> print(result["stdout"])
        42
    """
    # Generate session_id if not provided
    if session_id is None:
        session_id = f"session-{uuid.uuid4().hex[:8]}-{int(time.time())}"
        logger.info(f"Auto-generated session_id: {session_id}")
    else:
        logger.info(f"Using provided session_id: {session_id}")

    # Get or create executor for session
    executor = _get_or_create_executor(session_id, image, dockerfile, environment)

    # Execute code
    logger.info(f"Executing code in session {session_id}: {code[:50]}...")
    result: ExecutionResult | ExecutionError = ray.get(
        executor.execute.remote(code, timeout)
    )

    return result


@ray.remote
def install_package(
    package: str,
    session_id: str,
    timeout: int = 300,
) -> InstallResult | InstallError:
    """
    Install pip package in session container.

    Args:
        package: Package name (e.g., "numpy", "pandas==2.0.0")
        session_id: Session identifier
        timeout: Installation timeout in seconds (default: 300)

    Returns:
        Installation result

    Example:
        >>> ray.get(execute_code.remote("x = 1", session_id="my-session"))
        >>> ray.get(install_package.remote("numpy", session_id="my-session"))
        >>> result = ray.get(execute_code.remote(
        ...     "import numpy; print(numpy.__version__)",
        ...     session_id="my-session"
        ... ))
    """
    logger.info(
        f"install_package called with session_id: {session_id}, package: {package}"
    )

    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError as err:
        raise ValueError(
            f"Session {session_id} not found. " "Execute code first to create session."
        ) from err

    logger.info(f"Installing package {package} in session {session_id}")
    result: InstallResult | InstallError = ray.get(
        executor.install_package.remote(package, timeout=timeout)
    )

    return result


@ray.remote
def upload_file(
    path: str,
    content: bytes,
    session_id: str,
) -> UploadResult | UploadError:
    """
    Upload file to session container.

    Args:
        path: Destination path in container (e.g., "/tmp/data.csv")
        content: File content as bytes
        session_id: Session identifier

    Returns:
        Upload result

    Example:
        >>> ray.get(execute_code.remote("x = 1", session_id="my-session"))
        >>> data = b"col1,col2\\n1,2\\n3,4"
        >>> ray.get(upload_file.remote("/tmp/data.csv", data, session_id="my-session"))
        >>> result = ray.get(execute_code.remote(
        ...     "with open('/tmp/data.csv') as f: print(f.read())",
        ...     session_id="my-session"
        ... ))
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError as err:
        raise ValueError(
            f"Session {session_id} not found. " "Execute code first to create session."
        ) from err

    logger.info(f"Uploading file to {path} in session {session_id}")
    result: UploadResult | UploadError = ray.get(
        executor.upload_file.remote(path, content)
    )

    return result


@ray.remote
def get_session_stats(session_id: str) -> SessionStats:
    """
    Get statistics for a session.

    Args:
        session_id: Session identifier

    Returns:
        Session statistics

    Example:
        >>> stats = ray.get(get_session_stats.remote("my-session"))
        >>> print(f"Executions: {stats['execution_count']}")
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError as err:
        raise ValueError(f"Session {session_id} not found") from err

    stats: SessionStats = ray.get(executor.get_stats.remote())
    return stats


@ray.remote
def cleanup_session(session_id: str) -> CleanupResult | CleanupError:
    """
    Cleanup session and remove container.

    Args:
        session_id: Session identifier

    Returns:
        Cleanup result

    Example:
        >>> ray.get(cleanup_session.remote("my-session"))
        {"status": "success", "session_id": "my-session"}
    """
    try:
        executor = ray.get_actor(
            f"code-executor-{session_id}", namespace=ACTOR_NAMESPACE
        )
    except ValueError:
        return CleanupError(
            status="error",
            error=f"Session {session_id} not found",
            session_id=session_id,
        )

    logger.info(f"Cleaning up session {session_id}")

    try:
        # Cleanup container
        ray.get(executor.cleanup.remote())

        # Kill actor and wait for it to terminate
        ray.kill(executor, no_restart=True)

        # Wait for resources to be fully released
        # gVisor containers take longer to clean up than standard Docker
        time.sleep(2.0)

        return CleanupResult(
            status="success",
            session_id=session_id,
        )

    except Exception as e:
        logger.error(f"Failed to cleanup session {session_id}: {e}")
        return CleanupError(
            status="error",
            error=str(e),
            session_id=session_id,
        )
