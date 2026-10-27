#!/bin/sh
# Superserve CLI installer
# Usage: curl -fsSL https://superserve.ai/install | sh
# Set SUPERSERVE_NO_LOGIN=1 to skip the browser sign-in at the end, and
# SUPERSERVE_NO_MODIFY_PATH=1 to leave your shell profile untouched.
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

# --- PATH ---
# Add the install dir to the shell profile once so new terminals find
# `superserve`. SUPERSERVE_NO_MODIFY_PATH=1 leaves dotfiles alone.
ON_PATH=""
case ":${PATH}:" in *":${INSTALL_DIR}:"*) ON_PATH=1 ;; esac
UPDATED=""
add_to_profile() {
  if ! grep -qsxF "$LINE" "$1"; then
    mkdir -p "$(dirname "$1")"
    printf '\n# superserve\n%s\n' "$LINE" >> "$1"
    info "Added ${INSTALL_DIR} to your PATH in $1"
  fi
  UPDATED=1
}
# The first login startup file that exists, which is the only one Bash reads.
bash_login_file() {
  for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [ -f "$f" ]; then echo "$f"; return; fi
  done
}
# Single-quote the directory so a profile never re-parses it as shell code.
SQ_DIR="'$(printf '%s' "$INSTALL_DIR" | sed "s/'/'\\\\''/g")'"
LINE="export PATH=${SQ_DIR}:\"\$PATH\""
SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
if [ "$SHELL_NAME" = "fish" ]; then
  LINE="fish_add_path '$(printf '%s' "$INSTALL_DIR" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")'"
fi
if [ -z "${SUPERSERVE_NO_MODIFY_PATH:-}" ]; then
  case "$SHELL_NAME" in
    zsh)
      # .zshenv may set ZDOTDIR without exporting it, so ask zsh where it reads.
      # The answer comes back on fd 3 so anything .zshenv prints is dropped.
      ZDIR="$(zsh -c 'printf %s "${ZDOTDIR:-$HOME}" >&3' 3>&1 >/dev/null 2>&1 || true)"
      add_to_profile "${ZDIR:-${ZDOTDIR:-$HOME}}/.zshrc"
      ;;
    bash)
      # Interactive shells read .bashrc; login shells (macOS terminals, SSH)
      # read only the first login file that exists, so never shadow one.
      DEFAULT_LOGIN="$HOME/.profile"
      [ "$OS" = "darwin" ] && DEFAULT_LOGIN="$HOME/.bash_profile"
      LOGIN_FILE="$(bash_login_file)"
      add_to_profile "$HOME/.bashrc"
      add_to_profile "${LOGIN_FILE:-$DEFAULT_LOGIN}"
      ;;
    fish)
      add_to_profile "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      ;;
  esac
fi
if [ -z "$ON_PATH" ] && [ -z "$UPDATED" ]; then
  echo ""
  info "Add superserve to your PATH in your shell profile:"
  echo "  $LINE"
fi

# An older install earlier on PATH (e.g. the 1.x npm package) would keep
# answering to plain `superserve`.
OTHER="$(command -v superserve 2>/dev/null || true)"
if [ -n "$OTHER" ] && [ "$OTHER" != "${INSTALL_DIR}/superserve" ]; then
  echo ""
  info "Note: another superserve at ${OTHER} comes first on your PATH. Remove it (for example 'npm uninstall -g @superserve/cli') so 'superserve' runs this one."
fi

# --- Sign in ---
# A person at a terminal goes straight to the browser login, which also signs
# new users up. Under `curl | sh` stdin is this script, so login reads the tty.
# whoami is a network call, so it only runs when login would.
SUPERSERVE="${INSTALL_DIR}/superserve"
if [ -n "${SUPERSERVE_NO_LOGIN:-}" ] || [ ! -t 1 ] || ! (: </dev/tty) 2>/dev/null; then
  info "Done! Run 'superserve login' to sign in (agents and scripts: 'superserve login --no-wait')."
elif "$SUPERSERVE" whoami >/dev/null 2>&1; then
  info "Done! You're already signed in."
else
  echo ""
  "$SUPERSERVE" login </dev/tty || info "Run 'superserve login' to sign in."
fi

# This shell's PATH can't change from here; a new one reads the profile.
if [ -n "$UPDATED" ] && [ -z "$ON_PATH" ]; then
  echo ""
  info "Open a new terminal, or run 'exec \$SHELL -l', to start using superserve."
fi
