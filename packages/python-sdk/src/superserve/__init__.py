"""Superserve - Python SDK for cloud micro-VMs."""

import importlib.metadata

from superserve.client import Superserve
from superserve.errors import APIError, SuperserveError
from superserve.types import Checkpoint, ExecResult, ForkResult, ForkTree, Vm

try:
    __version__ = importlib.metadata.version(__name__)
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"

__all__ = [
    "__version__",
    "Superserve",
    "Vm",
    "ExecResult",
    "Checkpoint",
    "ForkResult",
    "ForkTree",
    "SuperserveError",
    "APIError",
]
