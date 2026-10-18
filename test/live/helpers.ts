// Licensed under the Apache License, Version 2.0.
//
// What the vitest live suites share: a connection as the administrator, and the record that a
// test reached a server (a run where none did fails: global-setup.ts).

import { appendFileSync } from "node:fs";

import { inject } from "vitest";

import { type ConnectOptions, type Connection, HardchargerError, connect } from "../../src/index.js";
import { type RunningServer, adminUsername } from "./harness.js";

export { adminUsername, launchServer, randomName, type RunningServer } from "./harness.js";

/** Records that a test reached a server. */
export function reached(): void {
  appendFileSync(inject("counterFile"), "x");
}

/** A password connection to the server as its administrator. */
export async function open(server: RunningServer, options: Partial<ConnectOptions> = {}): Promise<Connection> {
  reached();
  return connect({ url: server.url, username: adminUsername, password: server.password, ...options });
}

/** The first column of the first row. */
export async function scalar(conn: Connection, sql: string, params?: unknown[]): Promise<unknown> {
  const table = await conn.query(sql, params as never);
  return table.getChildAt(0)?.get(0);
}

/** The HardchargerError a promise rejects with; fails if it resolves or rejects with anything else. */
export async function rejection(promise: Promise<unknown>): Promise<HardchargerError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HardchargerError) return err;
    throw new Error(`expected a HardchargerError, got ${String(err)}`, { cause: err });
  }
  throw new Error("expected a HardchargerError, but the call succeeded");
}
