// Licensed under the Apache License, Version 2.0.
//
// A session the server ends because its transaction sat idle past
// --idle-in-transaction-session-timeout (Hardcharger 2.7.0): the statement that finds it ended
// fails with session_ended, reason idle_in_transaction, and is never run again; the next
// statement runs on a new session (@gizmodata/chargewire 2.1.0). The server checks every 5 s,
// so a session idle for 1 s is ended within about 6 s.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type Connection, ErrorCode } from "../../src/index.js";
import { type RunningServer, launchServer, open, randomName, rejection, scalar } from "./helpers.js";

const idleSeconds = 1;
// Past the limit and the server's 5 s sweep, with room for a slow runner.
const pastTheLimitMs = (idleSeconds + 5 + 3) * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: RunningServer;
let other: Connection;

beforeAll(async () => {
  server = await launchServer({ args: ["--idle-in-transaction-session-timeout", String(idleSeconds)] });
  other = await open(server);
});

afterAll(async () => {
  await other?.close();
  await server?.stop();
});

async function count(table: string): Promise<bigint> {
  return (await scalar(other, `SELECT count(*) FROM ${table}`)) as bigint;
}

describe("idle_in_transaction", () => {
  test("a busy transaction is not ended: it commits (the twin of the tests below)", async () => {
    const name = randomName("idle_busy");
    await other.execute(`CREATE TABLE ${name} (a INTEGER)`);
    const conn = await open(server);
    try {
      await conn.execute("BEGIN");
      await conn.execute(`INSERT INTO ${name} VALUES (1)`);
      await conn.execute("COMMIT");
      expect(await count(name)).toBe(1n);
    } finally {
      await conn.close();
    }
  });

  test("autocommit off: session_ended (idle_in_transaction), rolled back; the next statement runs", async () => {
    const name = randomName("idle_autocommit");
    await other.execute(`CREATE TABLE ${name} (a INTEGER)`);
    const conn = await open(server);
    try {
      await conn.setAutocommit(false);
      await conn.execute(`INSERT INTO ${name} VALUES (1)`);
      await sleep(pastTheLimitMs);
      const err = await rejection(conn.execute(`INSERT INTO ${name} VALUES (2)`));
      expect(err.code).toBe(ErrorCode.sessionEnded);
      expect(err.reason).toBe("idle_in_transaction");
      // The transaction was rolled back and the failed statement never ran again.
      expect(await count(name)).toBe(0n);
      // The connection goes on, on a new session, with no token renewal (password sign-in).
      expect(await scalar(conn, "SELECT 42")).toBe(42);
    } finally {
      await conn.close();
    }
  });

  test("BEGIN in SQL: the statement that finds the session ended is not run again in autocommit", async () => {
    const name = randomName("idle_begin");
    await other.execute(`CREATE TABLE ${name} (a INTEGER)`);
    const conn = await open(server);
    try {
      await conn.execute("BEGIN");
      await conn.execute(`INSERT INTO ${name} VALUES (1)`);
      await sleep(pastTheLimitMs);
      const err = await rejection(conn.execute(`INSERT INTO ${name} VALUES (2)`));
      expect(err.code).toBe(ErrorCode.sessionEnded);
      expect(err.reason).toBe("idle_in_transaction");
      // Run again on a new session it would have committed on its own: it must not have.
      expect(await count(name)).toBe(0n);
      expect(await conn.execute(`INSERT INTO ${name} VALUES (3)`)).toBe(1);
      expect(await count(name)).toBe(1n);
    } finally {
      await conn.close();
    }
  });
});
