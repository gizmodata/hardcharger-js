// Licensed under the Apache License, Version 2.0.
//
// A hardcharger:// URL without a port reaches 31337: this suite starts a server there, and
// fails (it never skips) when something else holds the port.

import { createServer } from "node:net";

import { afterAll, beforeAll, expect, test } from "vitest";

import { ErrorCode, connect, defaultPort } from "../../src/index.js";
import { type RunningServer, adminUsername, launchServer, reached, rejection, scalar } from "./helpers.js";

let server: RunningServer;

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

beforeAll(async () => {
  if (!(await portFree(defaultPort))) {
    throw new Error(`port ${defaultPort} is in use: stop whatever holds it to run this suite (it never skips)`);
  }
  server = await launchServer({ port: defaultPort });
});

afterAll(async () => {
  await server?.stop();
});

test("hardcharger://127.0.0.1?tls=false reaches port 31337", async () => {
  reached();
  const conn = await connect({
    url: "hardcharger://127.0.0.1?tls=false",
    username: adminUsername,
    password: server.password,
  });
  expect(await scalar(conn, "SELECT 42")).toBe(42);
  await conn.close();
});

test("warp://127.0.0.1?tls=false does not: its default port is 80", async () => {
  reached();
  const err = await rejection(
    connect({ url: "warp://127.0.0.1?tls=false", username: adminUsername, password: server.password, maxAttempts: 1 }),
  );
  expect(err.code).toBe(ErrorCode.transportError);
});
