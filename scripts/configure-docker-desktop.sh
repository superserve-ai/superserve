#!/bin/bash
set -e

DOCKER_CONFIG="$HOME/.docker/daemon.json"

echo "==> Configuring Docker Desktop daemon.json..."

# Create .docker directory if it doesn't exist
mkdir -p "$HOME/.docker"

# Backup existing config if present
if [ -f "$DOCKER_CONFIG" ]; then
    echo "Backing up existing daemon.json..."
    cp "$DOCKER_CONFIG" "$DOCKER_CONFIG.backup.$(date +%s)"
fi

# Check if config exists and has content
if [ -f "$DOCKER_CONFIG" ] && [ -s "$DOCKER_CONFIG" ]; then
    echo "Merging with existing configuration..."
    # Use jq to merge if available, otherwise warn
    if command -v jq >/dev/null 2>&1; then
        jq '. + {"runtimes": {"runsc": {"path": "/var/lib/docker/gvisor/runsc"}}}' "$DOCKER_CONFIG" > "$DOCKER_CONFIG.tmp"
        mv "$DOCKER_CONFIG.tmp" "$DOCKER_CONFIG"
    else
        echo "WARNING: jq not found. Creating new config (existing settings will be lost)"
        cat > "$DOCKER_CONFIG" << 'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/var/lib/docker/gvisor/runsc"
    }
  }
}
EOF
    fi
else
    echo "Creating new daemon.json..."
    cat > "$DOCKER_CONFIG" << 'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/var/lib/docker/gvisor/runsc"
    }
  }
}
EOF
fi

echo ""
echo "Docker Desktop daemon.json configuration:"
cat "$DOCKER_CONFIG"
echo ""
echo "Configuration saved to: $DOCKER_CONFIG"
