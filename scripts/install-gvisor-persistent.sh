#!/bin/sh
set -e

echo "==> Installing to persistent location..."

# Docker Desktop's /var/lib/docker persists across restarts
PERSIST_DIR="/var/lib/docker/gvisor"
mkdir -p "$PERSIST_DIR"

echo "==> Updating package manager..."
apt-get update -qq

echo "==> Installing wget..."
apt-get install -y wget >/dev/null 2>&1

echo "==> Downloading gVisor binaries..."
ARCH=$(uname -m)
URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}

cd "$PERSIST_DIR"
wget -q ${URL}/runsc ${URL}/runsc.sha512 \
    ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512

echo "==> Verifying checksums..."
sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
rm -f *.sha512

echo "==> Setting permissions..."
chmod +x runsc containerd-shim-runsc-v1

echo "==> Creating symlinks to /usr/local/bin..."
ln -sf "$PERSIST_DIR/runsc" /usr/local/bin/runsc
ln -sf "$PERSIST_DIR/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1

echo "==> Configuring Docker daemon..."
mkdir -p /etc/docker

cat > /etc/docker/daemon.json << 'EOFCONFIG'
{
  "runtimes": {
    "runsc": {
      "path": "/var/lib/docker/gvisor/runsc"
    }
  }
}
EOFCONFIG

echo ""
echo "==> Installation complete!"
echo ""
echo "Installed to persistent storage:"
ls -lh "$PERSIST_DIR/"
echo ""
echo "Symlinks in /usr/local/bin:"
ls -lh /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1 2>/dev/null || echo "Symlinks will be created on next restart"
echo ""
echo "Docker daemon config (in VM):"
cat /etc/docker/daemon.json
