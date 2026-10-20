#!/usr/bin/env bash
# Builds @gizmodata/warp-sql (gizmodata/warp-sql-js) at the commit pinned in
# scripts/warp-sql-js.commit and packs it to .warp-sql/gizmodata-warp-sql-<version>.tgz.
#
# Until @gizmodata/warp-sql is on npm, package-lock.json resolves the dependency to that
# tarball, so `npm ci` installs it from there. package.json (and so the published package)
# keeps naming the npm package and its semver range: the tarball is a development and CI
# stand-in, never part of what ships. Run this before `npm ci`.
#
#   HARDCHARGER_JS_WARP_SQL_REPO   where to clone from (default: https://github.com/gizmodata/warp-sql-js.git;
#                                  a local checkout works too)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
commit=$(tr -d '[:space:]' < "$root/scripts/warp-sql-js.commit")
if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "scripts/warp-sql-js.commit must hold one full commit SHA, not '$commit'" >&2
  exit 1
fi
repo="${HARDCHARGER_JS_WARP_SQL_REPO:-https://github.com/gizmodata/warp-sql-js.git}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone --quiet --no-checkout "$repo" "$work/warp-sql-js"
git -C "$work/warp-sql-js" checkout --quiet "$commit"
[ "$(git -C "$work/warp-sql-js" rev-parse HEAD)" = "$commit" ] || { echo "checkout is not $commit" >&2; exit 1; }

(
  cd "$work/warp-sql-js"
  { npm ci --no-audit --no-fund && npm run build && npm pack --pack-destination "$work"; } > "$work/build.log" 2>&1 ||
    { cat "$work/build.log" >&2; echo "building warp-sql-js $commit failed" >&2; exit 1; }
)
version=$(node -p 'require(process.argv[1]).version' "$work/warp-sql-js/package.json")
locked=""
if [ -f "$root/package-lock.json" ]; then
  locked=$(node -p 'require(process.argv[1]).packages["node_modules/@gizmodata/warp-sql"]?.version ?? ""' "$root/package-lock.json")
fi
if [ -n "$locked" ] && [ "$locked" != "$version" ]; then
  echo "warp-sql-js $commit is version $version, but package-lock.json has $locked: update the lock" >&2
  exit 1
fi
mkdir -p "$root/.warp-sql"
rm -f "$root"/.warp-sql/gizmodata-warp-sql-*.tgz
mv "$work/gizmodata-warp-sql-$version.tgz" "$root/.warp-sql/"
echo "@gizmodata/warp-sql $version (warp-sql-js ${commit:0:7}) -> .warp-sql/gizmodata-warp-sql-$version.tgz"
