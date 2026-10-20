// Runs the README's examples, as written, against hardcharger-server on the default port
// 31337 with the README's credentials (HARDCHARGER_JS_TEST_SERVER_BINARY; `npm run build` and
// `npm run warp-sql` first):
//
//   - every examples/*.mjs file, and its expected output examples/*.out, must appear in
//     README.md verbatim, so the README shows exactly what runs here;
//   - they run as a user's code would: in a new project where the README's `npm install`
//     line installed this package's packed tarball (and @gizmodata/warp-sql's, from .warp-sql/);
//   - examples/quickstart.mjs against `hardcharger-server` (plain HTTP);
//   - examples/mtls.mjs against the README's certificate sign-in command line, with throwaway
//     certificates in its working directory.
//
// The servers get an empty home directory and only PATH, HOME, TMPDIR and the password in
// their environment. Any failure, a missing binary included, exits non-zero.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const binary = process.env.HARDCHARGER_JS_TEST_SERVER_BINARY;
if (!binary) fail("set HARDCHARGER_JS_TEST_SERVER_BINARY to a hardcharger-server binary");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// The README shows each example and its output verbatim.
const readme = readFileSync(join(root, "README.md"), "utf8");
const examples = readdirSync(join(root, "examples")).filter((name) => /\.(mjs|out)$/.test(name));
for (const name of examples) {
  const text = readFileSync(join(root, "examples", name), "utf8").trimEnd();
  if (!readme.includes(text)) fail(`README.md does not show examples/${name} verbatim`);
}
if (!examples.includes("quickstart.out") || !examples.includes("mtls.out")) fail("examples/*.out are missing");

const portFree = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(31337, "0.0.0.0", () => probe.close(() => resolve(true)));
  });

async function startServer(home, args) {
  if (!(await portFree())) fail("port 31337 is in use: the examples need the default port");
  const output = [];
  const child = spawn(binary, args, {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, HARDCHARGER_ADMIN_PASSWORD: "change-me" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) fail(`hardcharger-server exited:\n${output.join("")}`);
    const up = await new Promise((resolve) => {
      const socket = tcpConnect({ host: "127.0.0.1", port: 31337 }, () => (socket.destroy(), resolve(true)));
      socket.once("error", () => resolve(false));
    });
    if (up) break;
    if (Date.now() > deadline) fail(`hardcharger-server did not listen on 31337:\n${output.join("")}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    log: () => output.join(""),
    async stop() {
      child.kill("SIGTERM");
      child.kill("SIGTERM");
      await exited;
    },
  };
}

/**
 * A new project, with the packages the README's own `npm install` line names, installed from
 * this checkout's packed tarballs instead of the registry: @gizmodata/hardcharger as `npm pack`
 * makes it, and @gizmodata/warp-sql from .warp-sql/ (installed in the same command, so the
 * hardcharger package's dependency on it resolves to that tarball, not to npm).
 */
function consumerProject(dir) {
  const install = /^npm install @gizmodata\/hardcharger apache-arrow$/m.exec(readme);
  if (!install) fail("README.md has no `npm install @gizmodata/hardcharger apache-arrow` line");
  const warpTarball = readdirSync(join(root, ".warp-sql")).find((name) => name.endsWith(".tgz"));
  if (!warpTarball) fail(".warp-sql/ has no tarball: run `npm run warp-sql`");
  copyFileSync(join(root, ".warp-sql", warpTarball), join(dir, warpTarball));
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", dir], { cwd: root, encoding: "utf8" }),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "readme-examples", private: true, type: "module" }));
  console.log(`$ ${install[0]}  (from ./${packed.filename} and ./${warpTarball})`);
  execFileSync("npm", ["install", "apache-arrow", `./${warpTarball}`, `./${packed.filename}`], {
    cwd: dir,
    stdio: "inherit",
  });
  for (const name of readdirSync(join(root, "examples")).filter((n) => n.endsWith(".mjs"))) {
    copyFileSync(join(root, "examples", name), join(dir, name));
  }
}

function runExample(name, cwd) {
  const expected = readFileSync(join(root, "examples", name.replace(/\.mjs$/, ".out")), "utf8");
  let actual;
  try {
    actual = execFileSync(process.execPath, [name], { cwd, encoding: "utf8", timeout: 120_000 });
  } catch (err) {
    fail(`examples/${name} failed:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
  }
  if (actual !== expected) fail(`examples/${name} printed\n${actual}\ninstead of\n${expected}`);
  console.log(`ok examples/${name}\n${actual.replace(/^/gm, "    ")}`);
}

function openssl(dir, ...args) {
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
}

/** A CA (written as both client-ca.pem and server-ca.pem), a server certificate for localhost, and ops@example.com's. */
function certificates(dir) {
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  openssl(
    dir,
    "req",
    "-x509",
    ...ec,
    "-keyout",
    "ca-key.pem",
    "-out",
    "client-ca.pem",
    "-subj",
    "/CN=example CA",
    "-days",
    "2",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,digitalSignature",
  );
  writeFileSync(join(dir, "server-ca.pem"), readFileSync(join(dir, "client-ca.pem")));
  const issue = (name, cn, ext) => {
    writeFileSync(join(dir, `${name}.ext`), `keyUsage=critical,digitalSignature\n${ext}\n`);
    openssl(dir, "req", ...ec, "-keyout", `${name}-key.pem`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`);
    openssl(
      dir,
      "x509",
      "-req",
      "-in",
      `${name}.csr`,
      "-CA",
      "client-ca.pem",
      "-CAkey",
      "ca-key.pem",
      "-CAcreateserial",
      "-out",
      `${name}.pem`,
      "-extfile",
      `${name}.ext`,
      "-days",
      "2",
    );
  };
  issue("server", "localhost", "extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1");
  issue("client", "ops", "extendedKeyUsage=clientAuth\nsubjectAltName=email:ops@example.com");
}

const home = mkdtempSync(join(tmpdir(), "hardcharger-js-examples-"));
try {
  consumerProject(home);

  // The quick start: `HARDCHARGER_ADMIN_PASSWORD=change-me hardcharger-server`.
  let server = await startServer(home, []);
  try {
    runExample("quickstart.mjs", home);
  } finally {
    await server.stop();
  }

  // Certificate sign-in, with the README's command line.
  certificates(home);
  const command = /HARDCHARGER_ADMIN_PASSWORD=change-me hardcharger-server (--tls-cert[^\n]*\\\n[^\n]*)/.exec(readme);
  if (!command) fail("README.md has no certificate sign-in server command");
  const args = command[1].replace(/\\\n/g, " ").trim().split(/\s+/);
  server = await startServer(home, args);
  try {
    runExample("mtls.mjs", home);
  } finally {
    await server.stop();
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}
console.log("every README example ran and printed what the README shows");
