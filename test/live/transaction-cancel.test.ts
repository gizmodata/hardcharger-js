// Licensed under the Apache License, Version 2.0.
//
// Transactions and cancel over hardcharger://. A running statement holds its session, so "the
// session answers SELECT 42 at once" after a cancel means the server stopped the statement.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type Connection, ErrorCode } from "../../src/index.js";
import { type RunningServer, launchServer, open, randomName, rejection, scalar } from "./helpers.js";

const forever = "SELECT count(*) FROM range(1000000000000)";

let server: RunningServer;
let conn: Connection;

beforeAll(async () => {
  server = await launchServer();
  conn = await open(server);
});

afterAll(async () => {
  await conn?.close();
  await server?.stop();
});

describe("transactions", () => {
  test("transaction() commits", async () => {
    const name = randomName("tx_commit");
    await conn.transaction(async (tx) => {
      await tx.execute(`CREATE TABLE ${name} (a INTEGER)`);
      await tx.execute(`INSERT INTO ${name} VALUES (1), (2)`);
    });
    const other = await open(server);
    expect(await scalar(other, `SELECT count(*) FROM ${name}`)).toBe(2n);
    await other.close();
  });

  test("transaction() rolls back on a throw, and rethrows it", async () => {
    const name = randomName("tx_rollback");
    await expect(
      conn.transaction(async (tx) => {
        await tx.execute(`CREATE TABLE ${name} (a INTEGER)`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const err = await rejection(conn.query(`SELECT * FROM ${name}`));
    expect(err.code).toBe(ErrorCode.sqlError);
    expect(err.sqlstate).toBe("42P01");
  });

  test("autocommit off: other sessions see nothing until commit; rollback undoes", async () => {
    const name = randomName("tx_manual");
    await conn.execute(`CREATE TABLE ${name} (a INTEGER)`);
    const other = await open(server);
    await conn.setAutocommit(false);
    try {
      await conn.execute(`INSERT INTO ${name} VALUES (1)`);
      expect(await scalar(other, `SELECT count(*) FROM ${name}`)).toBe(0n);
      await conn.commit();
      expect(await scalar(other, `SELECT count(*) FROM ${name}`)).toBe(1n);
      await conn.execute(`INSERT INTO ${name} VALUES (2)`);
      await conn.rollback();
      expect(await scalar(conn, `SELECT count(*) FROM ${name}`)).toBe(1n);
    } finally {
      await conn.setAutocommit(true);
      await other.close();
    }
  });
});

describe("cancel", () => {
  test("an aborted signal cancels the statement on the server: statement_cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const err = await rejection(conn.query(forever, undefined, { signal: controller.signal }));
    expect(err.code).toBe(ErrorCode.statementCancelled);
    const started = Date.now();
    expect(await scalar(conn, "SELECT 42")).toBe(42);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("AbortSignal.timeout is statement_timeout", async () => {
    const err = await rejection(conn.query(forever, undefined, { signal: AbortSignal.timeout(500) }));
    expect(err.code).toBe(ErrorCode.statementTimeout);
    expect(await scalar(conn, "SELECT 42")).toBe(42);
  });

  test("statementTimeoutMs: the server stops it, statement_timeout", async () => {
    const err = await rejection(conn.query(forever, undefined, { statementTimeoutMs: 500 }));
    expect(err.code).toBe(ErrorCode.statementTimeout);
    expect(err.message).toContain("timeout");
    expect(await scalar(conn, "SELECT 42")).toBe(42);
  });

  test("the uncancelled twin finishes", async () => {
    expect(await scalar(conn, "SELECT count(*) FROM range(1000000)", undefined)).toBe(1000000n);
  });
});
