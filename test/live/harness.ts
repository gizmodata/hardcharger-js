// Licensed under the Apache License, Version 2.0.
//
// Starts hardcharger-server for the live tests: the binary named by
// HARDCHARGER_JS_TEST_SERVER_BINARY, on 127.0.0.1 and a free port (or one a test asks for), with
// a fresh administrator password that contains ':' and '@', an empty home directory (DuckDB
// keeps secrets under ~/.duckdb: a developer's own are never seen), and an environment of
// PATH, HOME, TMPDIR and HARDCHARGER_ADMIN_PASSWORD only (the server reads HARDCHARGER_*
// settings from its environment, which a developer's shell may export).
//
// Only HARDCHARGER_JS_TEST_* variables are read, never a generic name a shell may export for a
// real server. No vitest import: the browser tests' global setup (Playwright) starts servers too.

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, connect as tcpConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const binaryEnv = "HARDCHARGER_JS_TEST_SERVER_BINARY";
export const adminUsername = "hardcharger_js_test";

export interface RunningServer {
  port: number;
  password: string;
  tls: boolean;
  /** `hardcharger://127.0.0.1:<port>`, with `?tls=false` for a plain-HTTP server. */
  url: string;
  log(): string;
  stop(): Promise<void>;
}

export interface LaunchOptions {
  /** Flags after --host, --port, --health-port and --admin-username. */
  args?: string[];
  /** A fixed port instead of a free one. */
  port?: number;
  /** More environment variables (HARDCHARGER_OAUTH_CLIENT_SECRET, say). */
  env?: Record<string, string>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

export async function launchServer(options: LaunchOptions = {}): Promise<RunningServer> {
  const binary = process.env[binaryEnv];
  if (binary === undefined || binary === "") {
    throw new Error(`set ${binaryEnv} to a hardcharger-server binary to run the live tests (they never skip)`);
  }
  const extra = options.args ?? [];
  const port = options.port ?? (await freePort());
  const password = randomBytes(9).toString("hex") + ":p@ss:word";
  const tls = extra.includes("--tls-cert");
  const home = mkdtempSync(join(tmpdir(), "hardcharger-js-server-"));
  const args = ["--host", "127.0.0.1", "--port", String(port), "--health-port", "0", "--admin-username", adminUsername];
  const output: string[] = [];
  const child: ChildProcess = spawn(binary, [...args, ...extra], {
    cwd: home,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      TMPDIR: home,
      ...options.env,
      HARDCHARGER_ADMIN_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const server: RunningServer = {
    port,
    password,
    tls,
    url: `hardcharger://127.0.0.1:${port}${tls ? "" : "?tls=false"}`,
    log: () => output.join(""),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        child.kill("SIGTERM"); // the first drains, the second stops at once
        const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
        await exited;
        clearTimeout(timer);
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
  try {
    await waitListening(port, child);
  } catch (err) {
    await server.stop();
    throw new Error(`${String(err)}\nserver output:\n${server.log()}`, { cause: err });
  }
  return server;
}

async function waitListening(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`hardcharger-server exited with code ${child.exitCode}`);
    const up = await new Promise<boolean>((resolve) => {
      const socket = tcpConnect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`hardcharger-server did not listen on 127.0.0.1:${port} within 30s`);
}

export const randomName = (prefix: string): string => `${prefix}_${randomBytes(4).toString("hex")}`;
