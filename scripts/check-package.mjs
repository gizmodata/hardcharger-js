// Checks the package as npm would publish it (`npm pack` of the built dist/):
//
//   - it is this thin layer only: no file of the Chargewire client (@gizmodata/chargewire) and none
//     of its code, which stays a dependency, imported by name;
//   - it is small: its dist/ is a few KB (it fails above maxDistBytes);
//   - only dist/, README.md, CHANGELOG.md, LICENSE and package.json are in it;
//   - its package.json names @gizmodata/chargewire as an npm semver range, never a tarball, a
//     path or a git URL, and carries no scripts that would run on install.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const maxDistBytes = 32 * 1024;
const problems = [];
const dir = mkdtempSync(join(tmpdir(), "hardcharger-js-pack-"));
try {
  const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", dir], { encoding: "utf8" }));
  // npm 11 returns an array; npm 12 keys the same records by package name.
  const packages = Array.isArray(result) ? result : Object.values(result);
  if (packages.length !== 1 || typeof packages[0]?.filename !== "string") {
    throw new Error("npm pack did not return exactly one package with a filename");
  }
  const [packed] = packages;
  execFileSync("tar", ["-xzf", join(dir, packed.filename), "-C", dir]);
  const pkgDir = join(dir, "package");
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(pkgDir, path));
    }
  };
  walk(pkgDir);

  const allowed = /^(dist\/index\.(mjs|cjs|d\.mts|d\.cts)|README\.md|CHANGELOG\.md|LICENSE|NOTICE|package\.json)$/;
  for (const file of files) if (!allowed.test(file)) problems.push(`unexpected file in the package: ${file}`);
  const distBytes = files.filter((f) => f.startsWith("dist/")).reduce((n, f) => n + statSync(join(pkgDir, f)).size, 0);
  if (distBytes > maxDistBytes)
    problems.push(`dist/ is ${distBytes} bytes, over ${maxDistBytes}: is something bundled?`);

  // The Chargewire client's code: strings from its source that this layer never contains.
  const markers = [
    "Idempotency-Key",
    "/v1/sessions",
    "/v1/auth/token",
    "class ChargewireError",
    "class ResultStream",
    "class Connection",
    "grant_type",
    "undici",
    "fzstd",
    "apache-arrow/ipc",
    "RecordBatchReader",
  ];
  for (const file of files.filter((f) => f.startsWith("dist/"))) {
    const text = readFileSync(join(pkgDir, file), "utf8");
    for (const marker of markers)
      if (text.includes(marker)) problems.push(`${file} contains "${marker}": chargewire-js code`);
    if (!file.endsWith("ts") && !/(from|require\()\s*"@gizmodata\/chargewire"/.test(text)) {
      problems.push(`${file} does not import @gizmodata/chargewire by name`);
    }
  }

  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const spec = pkg.dependencies?.["@gizmodata/chargewire"];
  if (!/^[\^~]?\d+\.\d+\.\d+$/.test(spec ?? "")) {
    problems.push(`package.json: @gizmodata/chargewire must be an npm semver range, not ${spec}`);
  }
  for (const [name, value] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (/^(file:|link:|git|https?:|github:)|\.tgz$|\//.test(value)) problems.push(`package.json: ${name} is ${value}`);
  }
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    if (pkg.scripts?.[hook]) problems.push(`package.json: a ${hook} script would run on install`);
  }

  // Both builds load, by the package's own name, and share the Chargewire client's classes.
  const probe = (type, code) => {
    try {
      execFileSync(process.execPath, ["--input-type", type, "-e", code], { stdio: "pipe" });
    } catch (err) {
      problems.push(`the ${type} build: ${String(err.stderr ?? err)}`);
    }
  };
  probe(
    "commonjs",
    `const h = require("@gizmodata/hardcharger"), w = require("@gizmodata/chargewire");
     if (h.HardchargerError !== w.ChargewireError || typeof h.connect !== "function") process.exit(1);`,
  );
  probe(
    "module",
    `import * as h from "@gizmodata/hardcharger"; import * as w from "@gizmodata/chargewire";
     if (h.HardchargerError !== w.ChargewireError || h.parseUrl("hardcharger://h").href !== "https://h:31337/chargewire") process.exit(1);`,
  );

  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
  console.log(
    `${packed.filename}: ${packed.size} bytes packed, ${packed.unpackedSize} unpacked (dist/ ${distBytes}), ` +
      `${files.length} files; ` +
      `@gizmodata/chargewire ${spec} is a dependency, none of its code is inside`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
