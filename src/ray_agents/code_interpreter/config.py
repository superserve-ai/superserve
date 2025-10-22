"""Configuration for Code Interpreter"""

# Default Docker image for code execution
DEFAULT_IMAGE = "python:3.12-slim"

# Docker runtime (use "runsc" for gVisor isolation, "runc" for standard)
RUNTIME = "runsc"  # gVisor for security

# Strict mode: Fail if gVisor is unavailable
# gVisor is required for secure code execution
STRICT_GVISOR = True

# Default execution timeout in seconds
DEFAULT_TIMEOUT = 30

# Resource limits
MEMORY_LIMIT = "512m"  # 512MB
CPU_QUOTA = 100000  # 1.0 CPU (100000 = 100%)
CPU_PERIOD = 100000

# Session settings
SESSION_TIMEOUT = 3600  # 1 hour before auto-cleanup

# Network settings
NETWORK_MODE = "bridge"  # "bridge" for internet access, "none" for isolation
