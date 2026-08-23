#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [version]" >&2
  exit 2
fi

version="${1:-$(jq -r '.version' src-tauri/tauri.conf.json)}"
binary="src-tauri/target/release/aproprose"
package="aproprose-${version}-1-x86_64.pkg.tar.zst"
stage="$(mktemp -d)"

cleanup() {
  rm -rf "$stage"
}
trap cleanup EXIT

if [ ! -x "$binary" ]; then
  echo "error: $binary is missing; build the production binary first" >&2
  exit 1
fi

# Refuse to package a dev-mode binary. Tauri's build script sets `dev = !custom-protocol`,
# so a bare `cargo build --release` embeds no frontend and the app starts up trying to
# reach devUrl ("Could not connect to localhost"). Only the Tauri CLI passes that feature,
# so assert the frontend actually made it into the binary by probing for a hashed asset
# name from dist/ - embedded asset keys are stored uncompressed and are greppable.
probe=""
for asset in dist/assets/*; do
  if [ -f "$asset" ]; then
    probe="$(basename "$asset")"
    break
  fi
done
if [ -z "$probe" ]; then
  echo "error: dist/assets is empty; build the frontend first" >&2
  exit 1
fi
if ! grep -aqF "$probe" "$binary"; then
  echo "error: $binary has no embedded frontend - it was built without tauri's" >&2
  echo "       custom-protocol feature and would fail to start." >&2
  echo "       build it with 'bun run tauri build --no-bundle', not 'cargo build --release'." >&2
  exit 1
fi

install -Dm755 "$binary" "$stage/usr/bin/aproprose"
install -Dm644 packaging/arch/aproprose.desktop "$stage/usr/share/applications/aproprose.desktop"
install -Dm644 src-tauri/icons/128x128@2x.png "$stage/usr/share/icons/hicolor/256x256/apps/aproprose.png"

installed_size="$(du -sb "$stage" | cut -f1)"
build_date="$(date +%s)"

cat > "$stage/.PKGINFO" <<EOF
pkgname = aproprose
pkgbase = aproprose
pkgver = ${version}-1
pkgdesc = AI-native, block-based LaTeX novel editor
url = https://github.com/jparr721/aproprose
builddate = ${build_date}
packager = Aproprose Release Build
size = ${installed_size}
arch = x86_64
license = custom
depend = gtk3
depend = libayatana-appindicator
depend = webkit2gtk-4.1
EOF

tar --zstd --create --file "$package" --directory "$stage" .PKGINFO usr
echo "created $package"
