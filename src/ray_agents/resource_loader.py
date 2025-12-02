"""Resource configuration loading for Ray agents."""

from typing import Any


def _parse_memory(memory_str: str) -> int:
    """Parse memory string to bytes.

    Args:
        memory_str: Memory string with unit suffix

    Returns:
        Memory in bytes as integer

    Raises:
        ValueError: If memory string format is invalid
    """
    memory_str = memory_str.strip().upper()

    units = {
        "KB": 1024,
        "MB": 1024**2,
        "GB": 1024**3,
        "TB": 1024**4,
        "K": 1024,
        "M": 1024**2,
        "G": 1024**3,
        "T": 1024**4,
    }

    for unit, multiplier in units.items():
        if memory_str.endswith(unit):
            try:
                value = float(memory_str[: -len(unit)])
                return int(value * multiplier)
            except ValueError:
                raise ValueError(
                    f"Invalid memory format: {memory_str}. "
                    f"Expected format like '4GB', '512MB'"
                ) from None

    try:
        return int(memory_str)
    except ValueError:
        raise ValueError(
            f"Invalid memory format: {memory_str}. "
            f"Expected format like '4GB', '512MB', or integer bytes"
        ) from None


def get_ray_native_resources(agent_class: Any) -> dict[str, Any]:
    """Extract resource configuration from Ray's @ray.remote decorator.

    Args:
        agent_class: Agent class that may have @ray.remote decorator

    Returns:
        Dict containing resource configuration from Ray decorator.
        Empty dict if no @ray.remote decorator or no resources specified.
    """
    if not hasattr(agent_class, "_ray_remote_options"):
        return {}

    ray_options = agent_class._ray_remote_options
    if not isinstance(ray_options, dict):
        return {}

    resource_keys = ["num_cpus", "num_gpus", "memory"]
    return {key: ray_options[key] for key in resource_keys if key in ray_options}


def merge_resource_configs(
    defaults: dict[str, Any],
    ray_native: dict[str, Any],
    cli_flags: dict[str, Any],
) -> dict[str, Any]:
    """Merge resource configurations with precedence: CLI > Ray native > defaults.

    Args:
        defaults: Default resource values
        ray_native: Resources from @ray.remote decorator
        cli_flags: Resources from CLI flags

    Returns:
        Merged resource configuration
    """
    merged = defaults.copy()

    for source in [ray_native, cli_flags]:
        for key, value in source.items():
            merged[key] = value

    return merged
