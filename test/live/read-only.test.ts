// Licensed under the Apache License, Version 2.0.

import { afterAll, beforeAll, expect, test } from "vitest";

import { type RunningServer, launchServer, open, rejection, scalar } from "./helpers.js";

let server: RunningServer;
beforeAll(async () => {
  server = await launchServer();
});
afterAll(async () => {
  await server?.stop();
});

test("hardcharger URLs preserve confirmed read-only sessions", async () => {
  const conn = await open(server, { sessionOptions: { read_only: true } });
  try {
    expect((await conn.getSession()).options?.["read_only"]).toBe(true);
    expect(Number(await scalar(conn, "SELECT 42"))).toBe(42);
    expect((await rejection(conn.execute("CREATE TABLE wrapper_reader_write (n INTEGER)"))).code).toBe("read_only");
    expect((await rejection(conn.setOptions({ read_only: false }))).code).toBe("read_only");
  } finally {
    await conn.close();
  }
});

test("an ordinary writer can become a reader", async () => {
  const conn = await open(server);
  try {
    await conn.execute("CREATE TABLE wrapper_writer (n INTEGER)");
    await conn.execute("INSERT INTO wrapper_writer VALUES (42)");
    await conn.setOptions({ read_only: true });
    expect(Number(await scalar(conn, "SELECT n FROM wrapper_writer"))).toBe(42);
    expect((await rejection(conn.execute("INSERT INTO wrapper_writer VALUES (43)"))).code).toBe("read_only");
  } finally {
    await conn.close();
  }
});
