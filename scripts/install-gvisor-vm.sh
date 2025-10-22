#!/bin/sh
set -e

echo "==> Updating package manager..."
apt-get update -qq

echo "==> Installing wget..."
apt-get install -y wget >/dev/null 2>&1

echo "==> Downloading gVisor binaries..."
ARCH=$(uname -m)
URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}

cd /tmp
wget -q ${URL}/runsc ${URL}/runsc.sha512 \
    ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512

echo "==> Verifying checksums..."
sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512

echo "==> Installing binaries..."
chmod +x runsc containerd-shim-runsc-v1
mv runsc containerd-shim-runsc-v1 /usr/local/bin/

echo "==> Configuring Docker daemon..."
mkdir -p /etc/docker

cat > /etc/docker/daemon.json << 'EOFCONFIG'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}
EOFCONFIG

echo ""
echo "==> Installation complete!"
echo ""
echo "Installed files:"
ls -lh /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1
echo ""
echo "Docker daemon config:"
cat /etc/docker/daemon.json
