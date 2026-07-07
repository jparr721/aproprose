#!/bin/sh
# aproprose macOS installer. Downloads the latest Apple Silicon DMG from GitHub
# Releases, copies aproprose.app into /Applications, and clears the quarantine
# attribute that makes unsigned downloads trip Gatekeeper on first launch.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jparr721/aproprose/main/install-macos.sh | sh
#
# Env vars:
#   APROPROSE_VERSION   Tag to install, for example v0.10.0 (default: latest release)
#   INSTALL_DIR         Install destination (default: /Applications)

set -eu

REPO="jparr721/aproprose"
APP_NAME="aproprose.app"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
VERSION="${APROPROSE_VERSION:-}"

err() { echo "aproprose-install: $*" >&2; exit 1; }
info() { echo "aproprose-install: $*"; }

have() { command -v "$1" >/dev/null 2>&1; }

have curl || err "curl is required"
have hdiutil || err "hdiutil is required"
have ditto || err "ditto is required"

uname_s="$(uname -s)"
uname_m="$(uname -m)"

[ "$uname_s" = "Darwin" ] || err "unsupported OS: $uname_s (this installer is macOS-only)"

case "$uname_m" in
  arm64|aarch64) arch="aarch64" ;;
  x86_64|amd64) err "Intel Macs are not supported yet; download a future x64 DMG from https://github.com/$REPO/releases when available" ;;
  *) err "unsupported arch: $uname_m" ;;
esac

if [ -z "$VERSION" ]; then
  info "resolving latest release"
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$VERSION" ] || err "failed to resolve latest release tag"
fi

version_no_v="${VERSION#v}"
asset="aproprose_${version_no_v}_${arch}.dmg"
url="https://github.com/$REPO/releases/download/${VERSION}/${asset}"

tmpdir="$(mktemp -d 2>/dev/null || mktemp -d -t aproprose)"
mountpoint=""

cleanup() {
  if [ -n "$mountpoint" ] && [ -d "$mountpoint" ]; then
    hdiutil detach "$mountpoint" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT INT TERM

info "downloading $asset"
curl -fsSL -o "$tmpdir/$asset" "$url" \
  || err "download failed: $url"

info "mounting disk image"
mountpoint="$(hdiutil attach -nobrowse -readonly "$tmpdir/$asset" \
  | awk '/\/Volumes\// { print substr($0, index($0, "/Volumes/")); exit }')"
[ -n "$mountpoint" ] || err "failed to mount disk image"

source_app="$mountpoint/$APP_NAME"
[ -d "$source_app" ] || err "$APP_NAME missing from disk image"

dest_app="$INSTALL_DIR/$APP_NAME"
sudo_cmd=""
if [ ! -w "$INSTALL_DIR" ]; then
  if have sudo; then
    sudo_cmd="sudo"
    info "$INSTALL_DIR not writable - will use sudo"
  else
    err "$INSTALL_DIR not writable and sudo not found; set INSTALL_DIR to a writable path"
  fi
fi

info "installing $APP_NAME to $INSTALL_DIR"
$sudo_cmd rm -rf "$dest_app"
$sudo_cmd ditto "$source_app" "$dest_app"

if have xattr; then
  info "clearing quarantine attribute"
  $sudo_cmd xattr -dr com.apple.quarantine "$dest_app" 2>/dev/null || true
fi

info "installed aproprose $VERSION to $dest_app"
info "next: open aproprose from Applications"
