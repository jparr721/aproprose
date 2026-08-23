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
