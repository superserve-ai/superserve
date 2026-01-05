"""Agent packaging for cloud deployment."""

from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from .types import AgentManifest, DeploymentManifest

if TYPE_CHECKING:
    from rayai.serve import AgentConfig


def package_deployment(
    project_path: Path,
    agents: list[AgentConfig],
    deployment_name: str,
) -> tuple[Path, DeploymentManifest]:
    """Package agents for cloud deployment.

    Creates a tarball containing:
    - agents/ directory with agent code
    - manifest.json with deployment metadata
    - requirements.txt (if exists)

    Args:
        project_path: Path to project root.
        agents: List of discovered agent configs.
        deployment_name: Name for the deployment.

    Returns:
        Tuple of (package_path, manifest).
    """
    manifest = DeploymentManifest(
        name=deployment_name,
        rayai_version="0.1.0",
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}",
        created_at=datetime.now(UTC).isoformat(),
        agents=[
            AgentManifest(
                name=config.name,
                route_prefix=config.route_prefix,
                num_cpus=config.num_cpus,
                num_gpus=config.num_gpus,
                memory=config.memory,
                replicas=config.replicas,
            )
            for config in agents
        ],
    )

    package_path = Path(tempfile.mktemp(suffix=".tar.gz"))

    with tarfile.open(package_path, "w:gz") as tar:
        agents_dir = project_path / "agents"
        if agents_dir.exists():
            for agent_folder in agents_dir.iterdir():
                if agent_folder.is_dir() and not agent_folder.name.startswith("__"):
                    _add_directory_to_tar(
                        tar, agent_folder, f"agents/{agent_folder.name}"
                    )

        req_file = project_path / "requirements.txt"
        if req_file.exists():
            tar.add(req_file, arcname="requirements.txt")

        pyproject_file = project_path / "pyproject.toml"
        if pyproject_file.exists():
            tar.add(pyproject_file, arcname="pyproject.toml")

        manifest_json = manifest.model_dump_json(indent=2)
        manifest_bytes = manifest_json.encode("utf-8")
        manifest_info = tarfile.TarInfo(name="manifest.json")
        manifest_info.size = len(manifest_bytes)
        tar.addfile(manifest_info, io.BytesIO(manifest_bytes))

    manifest.checksum = _calculate_checksum(package_path)

    return package_path, manifest


def _add_directory_to_tar(
    tar: tarfile.TarFile, source_path: Path, arcname: str
) -> None:
    """Add directory to tarball, excluding __pycache__ and .pyc files.

    Args:
        tar: Open tarfile.
        source_path: Source directory path.
        arcname: Archive name for the directory.
    """
    for item in source_path.rglob("*"):
        if "__pycache__" in item.parts or item.suffix == ".pyc":
            continue

        rel_path = item.relative_to(source_path)
        tar_path = f"{arcname}/{rel_path}"

        if item.is_file():
            tar.add(item, arcname=tar_path)
        elif item.is_dir():
            info = tarfile.TarInfo(name=tar_path + "/")
            info.type = tarfile.DIRTYPE
            tar.addfile(info)


def _calculate_checksum(path: Path) -> str:
    """Calculate SHA256 checksum of a file.

    Args:
        path: Path to file.

    Returns:
        Hex-encoded SHA256 checksum.
    """
    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()
