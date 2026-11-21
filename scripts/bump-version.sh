#!/usr/bin/env sh
# Set the version in every package and crate that carries the project's version.
# Usage: scripts/bump-version.sh 3.1.0, or a prerelease: scripts/bump-version.sh 6.0.0-rc.0
set -e
v="$1"; [ -n "$v" ] || { echo "usage: $0 <version>" >&2; exit 1; }
echo "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' || { echo "$0: $v isn't a version (1.2.3 or 1.2.3-rc.0)" >&2; exit 1; }
# A version as written in a file: digits and dots, with a prerelease after a hyphen.
V='[0-9][0-9A-Za-z.-]*'
editors="editors/vscode/package.json editors/devtools/manifest.json editors/devtools/package.json"
case "$v" in
  # The Marketplace and the browser stores take only numbers (1.2.3), so a prerelease leaves the
  # editor extensions on the last release; release.yml doesn't publish them for one.
  *-*) editors= ;;
esac
for f in compiler/package.json create/package.json plugin/package.json runtime/package.json server/package.json actions/package.json sync/package.json router/package.json editors/language-server/package.json $editors prettier-plugin/package.json; do
  sed -i -E "0,/\"version\": \"$V\"/s//\"version\": \"$v\"/" "$f"
done
sed -i -E "0,/^version = \"$V\"/s//version = \"$v\"/" Cargo.toml
for f in compiler/package-lock.json plugin/package-lock.json runtime/package-lock.json server/package-lock.json actions/package-lock.json sync/package-lock.json router/package-lock.json prettier-plugin/package-lock.json editors/language-server/package-lock.json; do
  # the root package appears twice at the top of a lockfile (lines 3 and 9)
  sed -i -E "1,12s/\"version\": \"$V\"/\"version\": \"$v\"/" "$f"
done
# The VS Code extension stays on its last release for a prerelease, but its linked language server
# follows the checkout's version. On a stable release the extension's lockfile root moves too.
case "$v" in
  *-*) ;;
  *) sed -i -E "1,12s/\"version\": \"$V\"/\"version\": \"$v\"/" editors/vscode/package-lock.json ;;
esac
perl -0pi -e "s#(\"\\.\\./language-server\": \\{\\s*\"name\": \"\@zubra/language-server\",\\s*\"version\": \")$V\"#\${1}$v\"#" editors/vscode/package-lock.json
# sync installs the repository's packages as copies (its .npmrc), so its lockfile records their
# versions too, beside "resolved": "file:../…".
perl -0pi -e "s/\"version\": \"[0-9][0-9A-Za-z.-]*\",(\s*\"resolved\": \"file:)/\"version\": \"$v\",\1/g" sync/package-lock.json
sed -i -E "/^name = \"zubra\"$/{n;s/^version = \"$V\"/version = \"$v\"/}" Cargo.lock
# The Axum example is its own workspace with its own lockfile, which names this crate's version:
# left behind, its `cargo test --locked` fails on the first build after a release.
sed -i -E "/^name = \"zubra\"$/{n;s/^version = \"$V\"/version = \"$v\"/}" examples/backends/axum-garden/Cargo.lock
# zubra-macros compiles with exactly this release of the compiler.
sed -i -E "s/^(zubra = \{ path = \"\.\.\", version = \"=)$V\"/\\1$v\"/" macros/Cargo.toml
# The packages that need the compiler, runtime or server ask for this release or later in its major.
# A prerelease asks for itself or later (^6.0.0-rc.0): npm matches a prerelease only against a
# range that names one of the same 6.0.0, so ^6.0.0 would refuse it.
case "$v" in
  *-*) range="^$v" ;;
  *) range="^$(echo "$v" | sed -E 's/^([0-9]+\.[0-9]+)\..*/\1.0/')" ;;
esac
for f in plugin/package.json plugin/package-lock.json server/package.json server/package-lock.json actions/package.json actions/package-lock.json sync/package.json sync/package-lock.json router/package.json router/package-lock.json; do
  sed -i -E "s#(\"@zubra/(compiler|runtime|server)\": \")\^$V\"#\1$range\"#g" "$f"
done
# The compiler asks, where a runtime is installed at all, for one no older than itself: a module
# is compiled for its compiler's release (a patch can add to the interface), and a runtime runs
# what older compilers wrote, never what a later one writes. Optional, so the compiler alone
# (`zubra compile`, a server in another language) installs no runtime.
for f in compiler/package.json compiler/package-lock.json; do
  sed -i -E "s#(\"@zubra/runtime\": \")>=$V\"#\\1>=$v\"#" "$f"
done
echo "version $v"
