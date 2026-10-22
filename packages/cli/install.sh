#!/bin/sh
# Superserve CLI installer
# Usage: curl -fsSL https://superserve.ai/install | sh
set -eu

REPO="superserve-ai/superserve"
INSTALL_DIR="${SUPERSERVE_INSTALL_DIR:-$HOME/.superserve/bin}"

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
error() { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# --- Detect OS ---
OS="$(uname -s)"
case "$OS" in
  Linux*)  OS="linux" ;;
  Darwin*) OS="darwin" ;;
  *)       error "Unsupported OS: $OS" ;;
esac

# --- Detect architecture ---
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

BINARY="superserve-bun-${OS}-${ARCH}"
# The default x64 Linux build needs AVX2; older CPUs and some VMs get baseline.
if [ "$OS" = "linux" ] && [ "$ARCH" = "x64" ] && ! grep -qw avx2 /proc/cpuinfo 2>/dev/null; then
  BINARY="${BINARY}-baseline"
fi
info "Detected platform: ${OS}-${ARCH}"

# --- Resolve version ---
# CLI releases are tagged cli-vX.Y.Z; the repo's "latest" release may belong to
# another package, so pick the newest cli-v* release instead.
case "${SUPERSERVE_VERSION:-}" in
  "")     TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100" \
            | sed -n 's/.*"tag_name": *"\(cli-v[^"]*\)".*/\1/p' | head -1) \
            || error "Failed to fetch releases"
          [ -n "$TAG" ] || error "No CLI release found" ;;
  cli-v*) TAG="$SUPERSERVE_VERSION" ;;
  *)      TAG="cli-v${SUPERSERVE_VERSION#v}" ;;
esac
info "Installing superserve ${TAG}"

# --- Download binary and checksums ---
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL -o "${TMPDIR}/${BINARY}" "${BASE_URL}/${BINARY}" \
  || error "Failed to download binary: ${BASE_URL}/${BINARY}"
curl -fsSL -o "${TMPDIR}/SHA256SUMS" "${BASE_URL}/SHA256SUMS" \
  || error "Failed to download checksums"

# --- Verify checksum ---
EXPECTED=$(grep "${BINARY}$" "${TMPDIR}/SHA256SUMS" | awk '{print $1}')
[ -z "$EXPECTED" ] && error "No checksum found for ${BINARY}"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "${TMPDIR}/${BINARY}" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "${TMPDIR}/${BINARY}" | awk '{print $1}')
else
  error "No sha256sum or shasum found — cannot verify download"
fi

[ "$EXPECTED" != "$ACTUAL" ] && error "Checksum mismatch: expected ${EXPECTED}, got ${ACTUAL}"
info "Checksum verified"

# --- Install ---
mkdir -p "$INSTALL_DIR"
mv "${TMPDIR}/${BINARY}" "${INSTALL_DIR}/superserve"
chmod +x "${INSTALL_DIR}/superserve"
info "Installed to ${INSTALL_DIR}/superserve"

# --- PATH instructions ---
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    info "Add superserve to your PATH by adding this to your shell profile:"
    echo ""
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    # Detect shell and suggest the right file
    SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
    case "$SHELL_NAME" in
      zsh)  echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc" ;;
      bash) echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc" ;;
      fish) echo "  fish_add_path ${INSTALL_DIR}" ;;
      *)    echo "  # Add the export line to your shell's config file" ;;
    esac
    echo ""
    ;;
esac

info "Done! Run 'superserve --help' to get started."
