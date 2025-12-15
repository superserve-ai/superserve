"""Resource configuration loading for Ray agents."""


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
