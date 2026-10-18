// Licensed under the Apache License, Version 2.0.
//
// Password sign-in, queries, bind parameters and error mapping over hardcharger:// against a
// real hardcharger-server.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type Connection, ErrorCode, HardchargerError, WarpSqlError, connect } from "../../src/index.js";
import { type RunningServer, adminUsername, launchServer, open, reached, rejection, scalar } from "./helpers.js";

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

describe("password sign-in", () => {
  // The password (harness.ts) contains ':' and '@': it travels as a JSON field, never split.
  test("signs in over hardcharger://127.0.0.1:<port>?tls=false as the administrator", async () => {
    expect(server.url).toBe(`hardcharger://127.0.0.1:${server.port}?tls=false`);
    expect(await scalar(conn, "SELECT HARDCHARGER_USER()")).toBe(adminUsername);
    const info = await conn.metadata.serverInfo();
    expect(info.server_name).toBe("Hardcharger");
    expect(info.protocol).toBe("warp-sql");
  });

  test("a wrong password is invalid_credentials (401), beside a right one", async () => {
    reached();
    const err = await rejection(connect({ url: server.url, username: adminUsername, password: "not-it" }));
    expect(err.code).toBe(ErrorCode.invalidCredentials);
    expect(err.status).toBe(401);
    expect(err.message).toContain("the user name or password is not correct");
    const right = await open(server);
    expect(await scalar(right, "SELECT 1")).toBe(1);
    await right.close();
  });

  test("an unknown user is invalid_credentials (401)", async () => {
    reached();
    const err = await rejection(connect({ url: server.url, username: "nobody", password: server.password }));
    expect(err.code).toBe(ErrorCode.invalidCredentials);
    expect(err.status).toBe(401);
  });

  test("TLS against a plain-HTTP server is a transport_error", async () => {
    reached();
    const err = await rejection(
      connect({
        url: `hardcharger://127.0.0.1:${server.port}`,
        username: adminUsername,
        password: server.password,
        maxAttempts: 1,
      }),
    );
    expect(err.code).toBe(ErrorCode.transportError);
  });
});

describe("queries", () => {
  test("query returns an Arrow table", async () => {
    const table = await conn.query("SELECT 42 AS answer, 'hello' AS greeting");
    expect(table.numRows).toBe(1);
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ answer: 42, greeting: "hello" }]);
  });

  test("stream reads a result batch by batch", async () => {
    let rows = 0;
    for await (const batch of conn.stream("SELECT * FROM range(1000000)", undefined, { resultPartitions: 1 })) {
      rows += batch.numRows;
    }
    expect(rows).toBe(1_000_000);
  });

  test("execute returns the rows changed", async () => {
    await conn.execute("CREATE OR REPLACE TABLE q_exec (a INTEGER)");
    expect(await conn.execute("INSERT INTO q_exec SELECT * FROM range(5)")).toBe(5);
    expect(await conn.execute("DELETE FROM q_exec WHERE a < 2")).toBe(2);
  });

  test("prepared statements run once per row", async () => {
    await conn.execute("CREATE OR REPLACE TABLE q_prep (id INTEGER, name VARCHAR)");
    const insert = await conn.prepare("INSERT INTO q_prep VALUES (?, ?)");
    expect(
      await insert.executeBatch([
        [1, "a"],
        [2, "b"],
        [3, null],
      ]),
    ).toBe(3);
    await insert.close();
    expect(await scalar(conn, "SELECT count(*) FROM q_prep WHERE name IS NULL")).toBe(1n);
  });
});

describe("bind parameters", () => {
  test("positional ? and $1", async () => {
    const table = await conn.query("SELECT ?::INTEGER + 1 AS n, ?::VARCHAR AS s", [41, "hi"]);
    expect(table.toArray().map((row) => row.toJSON())).toEqual([{ n: 42, s: "hi" }]);
    expect(await scalar(conn, "SELECT $1::VARCHAR || $2::VARCHAR", ["a", "b"])).toBe("ab");
  });

  test("named $name", async () => {
    expect(
      await conn.query("SELECT $a::INTEGER + $b::INTEGER AS s", { a: 1, b: 2 }).then((t) => t.get(0)?.toJSON()),
    ).toEqual({ s: 3 });
  });

  test("a bigint is sent exactly", async () => {
    expect(await scalar(conn, "SELECT ?::BIGINT", [9007199254740993n])).toBe(9007199254740993n);
  });

  test("a value is never SQL text", async () => {
    expect(await scalar(conn, "SELECT ?::VARCHAR", ["'); DROP TABLE q_exec; --"])).toBe("'); DROP TABLE q_exec; --");
    expect(await scalar(conn, "SELECT count(*) FROM q_exec")).toBe(3n);
  });
});

describe("errors", () => {
  test("bad SQL is sql_error (400) with the SQLSTATE, and the session goes on", async () => {
    const err = await rejection(conn.query("SELEC 1"));
    expect(err).toBeInstanceOf(HardchargerError);
    expect(err).toBeInstanceOf(WarpSqlError);
    expect(HardchargerError.is(err, ErrorCode.sqlError)).toBe(true);
    expect(err.code).toBe("sql_error");
    expect(err.status).toBe(400);
    expect(err.sqlstate).toBe("42601");
    expect(err.message).toContain('syntax error at or near "SELEC"');
    expect(err.requestId).toMatch(/^r_/);
    expect(await scalar(conn, "SELECT 1")).toBe(1);
  });

  test("a missing table is sql_error with SQLSTATE 42P01", async () => {
    const err = await rejection(conn.query("SELECT * FROM no_such_table"));
    expect(err.code).toBe(ErrorCode.sqlError);
    expect(err.sqlstate).toBe("42P01");
    expect(err.message).toContain("no_such_table does not exist");
  });

  test("a wrong parameter count is refused by the server, not run", async () => {
    const err = await rejection(conn.query("SELECT ?::INTEGER, ?::INTEGER", [1]));
    expect([ErrorCode.sqlError, ErrorCode.badRequest]).toContain(err.code);
    expect(err.status).toBe(400);
  });

  test("a closed connection is connection_closed", async () => {
    const other = await open(server);
    await other.close();
    const err = await rejection(other.query("SELECT 1"));
    expect(err.code).toBe(ErrorCode.connectionClosed);
  });
});
