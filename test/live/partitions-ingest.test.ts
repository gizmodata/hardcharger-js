// Licensed under the Apache License, Version 2.0.
//
// Split results (read in several partitions at once) and bulk ingest, over hardcharger://.

import { tableFromArrays } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type Connection, ErrorCode } from "../../src/index.js";
import { type RunningServer, launchServer, open, randomName, rejection, scalar } from "./helpers.js";

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

describe("partitioned results", () => {
  test("the server offers result_partitions", () => {
    expect(conn.capabilities.has("result_partitions")).toBe(true);
  });

  test("a large result arrives in several partitions, in ORDER BY order", async () => {
    const stream = conn.stream("SELECT i FROM range(2000000) t(i) ORDER BY i DESC");
    let expected = 1_999_999;
    let ok = true;
    for await (const batch of stream) {
      for (const v of batch.getChildAt(0)!) {
        if (Number(v) !== expected--) ok = false;
      }
    }
    expect(ok).toBe(true);
    expect(expected).toBe(-1);
    expect(await stream.partitions()).toBeGreaterThan(1);
  });

  test("resultOrder any: every row, in some order", async () => {
    const stream = conn.stream("SELECT i FROM range(1000000) t(i)", undefined, { resultOrder: "any" });
    let sum = 0n;
    for await (const batch of stream) for (const v of batch.getChildAt(0)!) sum += v as bigint;
    expect(sum).toBe(499999500000n);
    expect(await stream.partitions()).toBeGreaterThan(1);
  });

  test("resultPartitions 1 reads one stream", async () => {
    const stream = conn.stream("SELECT i FROM range(2000000) t(i)", undefined, { resultPartitions: 1 });
    const table = await stream.toTable();
    expect(table.numRows).toBe(2_000_000);
    expect(await stream.partitions()).toBe(1);
  });
});

describe("ingest", () => {
  test("creates a table from Arrow, appends, replaces", async () => {
    const name = randomName("ingest");
    const rows = tableFromArrays({
      id: Int32Array.from({ length: 100_000 }, (_, i) => i),
      label: Array.from({ length: 100_000 }, (_, i) => `row ${i}`),
    });
    expect(await conn.ingest(name, rows, { mode: "create" })).toBe(100_000);
    expect(await scalar(conn, `SELECT count(*) FROM ${name}`)).toBe(100_000n);
    expect(await scalar(conn, `SELECT label FROM ${name} WHERE id = 99999`)).toBe("row 99999");
    expect(await conn.ingest(name, rows, { mode: "append" })).toBe(100_000);
    expect(await scalar(conn, `SELECT count(*) FROM ${name}`)).toBe(200_000n);
    const one = tableFromArrays({ id: Int32Array.from([7]), label: ["seven"] });
    expect(await conn.ingest(name, one, { mode: "replace" })).toBe(1);
    expect(await scalar(conn, `SELECT label FROM ${name}`)).toBe("seven");
  });

  test("an async iterable of batches, into a temporary table", async () => {
    const name = randomName("ingest_tmp");
    async function* batches() {
      for (let b = 0; b < 4; b++) {
        yield* tableFromArrays({ v: Float64Array.from({ length: 1000 }, (_, i) => b * 1000 + i) }).batches;
      }
    }
    expect(await conn.ingest(name, batches(), { mode: "create", temporary: true })).toBe(4000);
    expect(await scalar(conn, `SELECT sum(v) FROM ${name}`)).toBe(7998000);
  });

  test("create on an existing table is sql_error (42P07), and the table is unchanged", async () => {
    const name = randomName("ingest_dup");
    const rows = tableFromArrays({ id: Int32Array.from([1, 2]) });
    expect(await conn.ingest(name, rows, { mode: "create" })).toBe(2);
    const err = await rejection(conn.ingest(name, rows, { mode: "create" }));
    expect(err.code).toBe(ErrorCode.sqlError);
    expect(err.sqlstate).toBe("42P07");
    expect(err.message).toContain("already exists");
    expect(await scalar(conn, `SELECT count(*) FROM ${name}`)).toBe(2n);
  });

  test("append to a missing table is sql_error (42P01)", async () => {
    const err = await rejection(
      conn.ingest(randomName("ingest_missing"), tableFromArrays({ id: Int32Array.from([1]) }), { mode: "append" }),
    );
    expect(err.code).toBe(ErrorCode.sqlError);
    expect(err.sqlstate).toBe("42P01");
  });

  test("an unknown mode is refused before sending (client_invalid_argument)", async () => {
    const err = await rejection(
      conn.ingest("x", tableFromArrays({ id: Int32Array.from([1]) }), { mode: "upsert" as never }),
    );
    expect(err.code).toBe(ErrorCode.clientInvalidArgument);
  });
});
