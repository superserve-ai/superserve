#!/bin/bash
set -e

echo "==> Checking if runsc binary exists..."
if [ -f /usr/local/bin/runsc ]; then
    echo "✓ runsc found at /usr/local/bin/runsc"
    ls -lh /usr/local/bin/runsc
else
    echo "✗ runsc not found at /usr/local/bin/runsc"
fi

echo ""
echo "==> Checking containerd config..."
if [ -f /etc/containerd/config.toml ]; then
    echo "✓ config.toml exists"
    cat /etc/containerd/config.toml
else
    echo "✗ config.toml not found"
fi

echo ""
echo "==> Checking containerd process..."
if pgrep -f containerd > /dev/null; then
    echo "✓ containerd is running"
    pgrep -f containerd
else
    echo "✗ containerd not running"
fi

echo ""
echo "==> Checking available runtimes in Docker..."
docker info 2>/dev/null | grep -i runtime || echo "Could not get runtime info"
