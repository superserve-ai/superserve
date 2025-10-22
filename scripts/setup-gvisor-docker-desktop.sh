#!/bin/bash
set -e

echo "==> Installing wget..."
apk add --no-cache wget

echo "==> Downloading gVisor binaries..."
ARCH=$(uname -m)
URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}
wget ${URL}/runsc ${URL}/runsc.sha512 \
    ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512

echo "==> Verifying checksums..."
sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
rm -f *.sha512

echo "==> Installing binaries to /usr/local/bin..."
chmod a+rx runsc containerd-shim-runsc-v1
cp runsc containerd-shim-runsc-v1 /usr/local/bin/

echo "==> Configuring Docker daemon..."
mkdir -p /etc/docker

# Create or update daemon.json
if [ -f /etc/docker/daemon.json ]; then
    echo "Backing up existing daemon.json..."
    cp /etc/docker/daemon.json /etc/docker/daemon.json.backup
fi

cat > /etc/docker/daemon.json <<'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}
EOF

echo "==> gVisor installation complete!"
echo "Docker daemon.json:"
cat /etc/docker/daemon.json
