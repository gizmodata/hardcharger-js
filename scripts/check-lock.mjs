// Checks how @gizmodata/warp-sql is installed while it is not on npm (scripts/install-warp-sql.sh):
//
//   - package.json names the npm package with a semver range (that is what ships), never a
//     tarball, a path or a git URL;
//   - package-lock.json resolves it to .warp-sql/gizmodata-warp-sql-<version>.tgz, with no
//     integrity hash (the tarball is rebuilt from the pinned commit on each machine, so its
//     bytes may differ), and with the same range at the root.
//
// `--fix` repairs both after `npm install ./.warp-sql/gizmodata-warp-sql-<version>.tgz`
// (how the lock is made again after a repin): it puts the range ^<version> back.
import { readFileSync, writeFileSync } from "node:fs";

const name = "@gizmodata/warp-sql";
const fix = process.argv.includes("--fix");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const entry = lock.packages?.[`node_modules/${name}`];
const problems = [];

if (entry === undefined) {
  console.error(`package-lock.json has no ${name}: run scripts/install-warp-sql.sh, then npm install the tarball`);
  process.exit(1);
}
const range = /^[\^~]?\d+\.\d+\.\d+$/;
let spec = pkg.dependencies?.[name];
if (fix && !range.test(spec ?? "")) spec = pkg.dependencies[name] = `^${entry.version}`;
if (!range.test(spec ?? "")) problems.push(`package.json: ${name} must be a semver range like ^0.1.0, not ${spec}`);

const wanted = `file:.warp-sql/gizmodata-warp-sql-${entry.version}.tgz`;
if (entry.resolved !== wanted) problems.push(`package-lock.json: ${name} resolves to ${entry.resolved}, not ${wanted}`);
if (fix) {
  delete entry.integrity;
  lock.packages[""].dependencies[name] = spec;
}
if (entry.integrity !== undefined) problems.push(`package-lock.json: ${name} must have no integrity hash`);
if (lock.packages[""]?.dependencies?.[name] !== spec)
  problems.push(`package-lock.json: the root's ${name} must be ${spec}, as in package.json`);

if (fix) {
  writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`${name} ${spec}: package-lock.json resolves it to ${wanted}`);
