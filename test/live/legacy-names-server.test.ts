// Licensed under the Apache License, Version 2.0.
//
// A Hardcharger released before the protocol's rename (2.2.0 and earlier), reached with this
// package: the Chargewire client finds nothing at /chargewire, falls back to /warp and speaks
// the old spelling there. Current URLs, URLs written before the rename and the old error
// class name all work against it.
//
// The server is one that is already running, plain HTTP (the image, say):
//
//   HARDCHARGER_JS_TEST_OLD_SERVER            host:port, e.g. 127.0.0.1:31347
//   HARDCHARGER_JS_TEST_OLD_SERVER_PASSWORD   its administrator's password
//   HARDCHARGER_JS_TEST_OLD_SERVER_USERNAME   its administrator (default: hardcharger)
//
// Without HARDCHARGER_JS_TEST_OLD_SERVER these tests skip on a developer's machine, and fail
// in CI (CI=true), where the workflow starts the server: a gate never skips. With it, a
// fallback that doesn't work fails them.

import { tableFromArrays } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type Connection, ErrorCode, WarpSqlError, connect } from "../../src/index.js";
import { reached, rejection, scalar } from "./helpers.js";

const address = process.env["HARDCHARGER_JS_TEST_OLD_SERVER"] ?? "";
const password = process.env["HARDCHARGER_JS_TEST_OLD_SERVER_PASSWORD"] ?? "";
const username = process.env["HARDCHARGER_JS_TEST_OLD_SERVER_USERNAME"] || "hardcharger";
const configured = address !== "";
const inCi = process.env["CI"] === "true";

if (!configured) {
  if (inCi) {
    test("a server from before the rename is configured", () => {
      throw new Error("FAIL: set HARDCHARGER_JS_TEST_OLD_SERVER (host:port) in CI; this gate never skips there");
    });
  } else {
    console.log("skipping the pre-rename server tests: HARDCHARGER_JS_TEST_OLD_SERVER is not set");
  }
}

interface Seen {
  method: string;
  path: string;
  sent: string[];
}

describe.skipIf(!configured)("a Hardcharger from before the rename", () => {
  let conn: Connection;
  const seen: Seen[] = [];
  const recording: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    seen.push({ method: init?.method ?? "GET", path: url.pathname, sent: [...new Headers(init?.headers).keys()] });
    return fetch(input, init);
  };

  beforeAll(async () => {
    if (password === "") throw new Error("set HARDCHARGER_JS_TEST_OLD_SERVER_PASSWORD too");
    reached();
    conn = await connect({ url: `hardcharger://${address}?tls=false`, username, password, fetch: recording });
  });

  afterAll(async () => {
    await conn?.close();
  });

  test("a current hardcharger:// URL connects: one 404 at /chargewire, then /warp", async () => {
    expect(seen.slice(0, 2).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /chargewire", "GET /warp"]);
    expect(seen.slice(2).every((r) => r.path.startsWith("/warp/"))).toBe(true);
    expect(seen.flatMap((r) => r.sent).some((name) => name.startsWith("chargewire-"))).toBe(false);
    expect(conn.server.protocol).toBe("chargewire");
    expect(conn.server.server?.name).toBe("Hardcharger");
    expect(await scalar(conn, "SELECT 42")).toBe(42);
  });

  test("a small query", async () => {
    const table = await conn.query("SELECT range AS i, 'n' || range AS s FROM range(5) ORDER BY i");
    expect(table.numRows).toBe(5);
    expect(table.getChild("s")!.toArray()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
  });

  test("a prepared statement with parameters", async () => {
    await conn.execute("CREATE OR REPLACE TABLE legacy_p (id INTEGER, name VARCHAR)");
    const insert = await conn.prepare("INSERT INTO legacy_p VALUES (?, ?)");
    await insert.execute([1, "one"]);
    await insert.execute([2, "two"]);
    await insert.close();
    const select = await conn.prepare("SELECT name FROM legacy_p WHERE id = ?");
    expect((await select.query([2])).getChild("name")!.get(0)).toBe("two");
    await select.close();
  });

  test("an upload (ingest)", async () => {
    const rows = tableFromArrays({ k: Int32Array.from([1, 2, 3]), v: ["a", "b", "c"] });
    expect(await conn.ingest("legacy_i", rows, { mode: "replace" })).toBe(3);
    expect(await scalar(conn, "SELECT CAST(sum(k) AS INTEGER) FROM legacy_i")).toBe(6);
  });

  test("a SQL error is a WarpSqlError (and a HardchargerError) with the current type", async () => {
    const err = await rejection(conn.query("SELECT * FROM no_such_table_here"));
    expect(err).toBeInstanceOf(WarpSqlError);
    expect(err.code).toBe(ErrorCode.sqlError);
    expect(err.type).toBe("urn:chargewire:error:sql_error");
    expect(await scalar(conn, "SELECT 1")).toBe(1);
  });

  test.each([
    `warp://${address}?tls=false`,
    `http://${address}/warp`,
    `hardcharger://${address}/warp?tls=false`,
    `http://${address}`,
  ])("a URL written before the rename connects: %s", async (url) => {
    reached();
    const old = await connect({ url, username, password });
    expect(await scalar(old, "SELECT 3")).toBe(3);
    await old.close();
  });
});
