#!/usr/bin/env bash
# Builds @gizmodata/chargewire (gizmodata/chargewire-js) at the commit pinned in
# scripts/chargewire-js.commit and packs it to .chargewire/gizmodata-chargewire-<version>.tgz.
#
# Until @gizmodata/chargewire is on npm, package-lock.json resolves the dependency to that
# tarball, so `npm ci` installs it from there. package.json (and so the published package)
# keeps naming the npm package and its semver range: the tarball is a development and CI
# stand-in, never part of what ships. Run this before `npm ci`.
#
#   HARDCHARGER_JS_CHARGEWIRE_REPO   where to clone from (default: https://github.com/gizmodata/chargewire-js.git;
#                                  a local checkout works too)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
commit=$(tr -d '[:space:]' < "$root/scripts/chargewire-js.commit")
if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "scripts/chargewire-js.commit must hold one full commit SHA, not '$commit'" >&2
  exit 1
fi
repo="${HARDCHARGER_JS_CHARGEWIRE_REPO:-https://github.com/gizmodata/chargewire-js.git}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone --quiet --no-checkout "$repo" "$work/chargewire-js"
git -C "$work/chargewire-js" checkout --quiet "$commit"
[ "$(git -C "$work/chargewire-js" rev-parse HEAD)" = "$commit" ] || { echo "checkout is not $commit" >&2; exit 1; }

(
  cd "$work/chargewire-js"
  { npm ci --no-audit --no-fund && npm run build && npm pack --pack-destination "$work"; } > "$work/build.log" 2>&1 ||
    { cat "$work/build.log" >&2; echo "building chargewire-js $commit failed" >&2; exit 1; }
)
version=$(node -p 'require(process.argv[1]).version' "$work/chargewire-js/package.json")
locked=""
if [ -f "$root/package-lock.json" ]; then
  locked=$(node -p 'require(process.argv[1]).packages["node_modules/@gizmodata/chargewire"]?.version ?? ""' "$root/package-lock.json")
fi
if [ -n "$locked" ] && [ "$locked" != "$version" ]; then
  echo "chargewire-js $commit is version $version, but package-lock.json has $locked: update the lock" >&2
  exit 1
fi
mkdir -p "$root/.chargewire"
rm -f "$root"/.chargewire/gizmodata-chargewire-*.tgz
mv "$work/gizmodata-chargewire-$version.tgz" "$root/.chargewire/"
echo "@gizmodata/chargewire $version (chargewire-js ${commit:0:7}) -> .chargewire/gizmodata-chargewire-$version.tgz"
