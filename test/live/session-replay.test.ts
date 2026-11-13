// Licensed under the Apache License, Version 2.0.
//
// The current catalog and schema over hardcharger://, against a real hardcharger-server whose
// session is ended behind the client's back (as an idle eviction or a restart does):
//
//   - the session that replaces a lost one opens where the lost one was. Setting the catalog
//     moves a session to that catalog's default schema, as SQL USE does, so a schema set before
//     the catalog is not replayed (@gizmodata/chargewire 2.3.6): it used to put the new session in
//     a schema of that name in the new catalog, or, when the new catalog has none, fail every
//     request from then on;
//   - a lazy connection (a stopped GizmoData Cloud cluster) keeps that order too;
//   - a catalog and a schema given together name that catalog's schema, on every connect.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type ConnectOptions, type Connection, ErrorCode } from "../../src/index.js";
import { type RunningServer, adminUsername, launchServer, open, rejection, scalar } from "./helpers.js";

let server: RunningServer;
let home: string; // the server's default catalog

beforeAll(async () => {
  server = await launchServer();
  const setup = await open(server);
  home = (await where(setup)).split(".")[0]!;
  await setup.execute(
    "ATTACH ':memory:' AS replay_where; CREATE SCHEMA replay_both; CREATE SCHEMA replay_where.replay_both; " +
      "CREATE SCHEMA replay_only_default; CREATE SCHEMA replay_where.replay_only_here",
  );
  await setup.close();
});

afterAll(async () => {
  await server?.stop();
});

/** Where the connection's session is: its current catalog and schema, as SQL sees them. */
async function where(conn: Connection): Promise<string> {
  return String(await scalar(conn, "SELECT current_catalog() || '.' || current_schema()"));
}

/** Ends the connection's session behind its back, with a token of the test's own. */
async function loseSession(conn: Connection): Promise<void> {
  const base = `http://127.0.0.1:${server.port}/chargewire/v1`;
  const signIn = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "password", username: adminUsername, password: server.password }),
  });
  const { access_token: token } = (await signIn.json()) as { access_token: string };
  const gone = await fetch(`${base}/sessions/${conn.sessionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(gone.status, `DELETE of session ${conn.sessionId}`).toBe(204);
}

/** A `fetch` that makes discovery say the server is stopped, as a stopped cluster's stand-in does: a lazy connection. */
const discoveryStopped: typeof fetch = async (input, init) => {
  const resp = await fetch(input, init);
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if ((init?.method ?? "GET") !== "GET" || url.pathname !== "/chargewire" || !resp.ok) return resp;
  const discovery = (await resp.json()) as Record<string, unknown>;
  return new Response(JSON.stringify({ ...discovery, state: "stopped" }), {
    status: resp.status,
    headers: { "content-type": "application/json" },
  });
};

const quiet = { warn: () => {} };

describe("a lost session's replacement opens where the lost one was", () => {
  test.each([
    {
      name: "a schema both catalogs have, then the catalog",
      sets: [{ schema: "replay_both" }, { catalog: "replay_where" }],
      want: "replay_where.main",
    },
    {
      name: "a schema only the catalog before has, then the catalog",
      sets: [{ schema: "replay_only_default" }, { catalog: "replay_where" }],
      want: "replay_where.main",
    },
    {
      name: "the catalog, then the schema (replayed: both)",
      sets: [{ catalog: "replay_where" }, { schema: "replay_both" }],
      want: "replay_where.replay_both",
    },
  ])("$name", async ({ sets, want }) => {
    const conn = await open(server, { logger: quiet });
    try {
      for (const options of sets) await conn.setOptions(options);
      expect(await where(conn), "before the loss").toBe(want);
      const old = conn.sessionId;
      await loseSession(conn);
      expect(await scalar(conn, "SELECT 5")).toBe(5);
      expect(conn.sessionReplacements).toBe(1);
      expect(conn.sessionId).not.toBe(old);
      expect(await where(conn), "the replacement session is not where the lost one was").toBe(want);
    } finally {
      await conn.close();
    }
  });

  test("a catalog the server refuses is invalid_option_value, and leaves the session and its replacement where they were", async () => {
    const conn = await open(server, { logger: quiet });
    try {
      await conn.setOptions({ schema: "replay_both" });
      const err = await rejection(conn.setOptions({ catalog: "replay_no_such_catalog" }));
      expect(err.code).toBe(ErrorCode.invalidOptionValue);
      expect(err.message).toContain('session option "catalog"');
      expect(err.message).toContain("replay_no_such_catalog");
      expect(await where(conn)).toBe(`${home}.replay_both`);
      await loseSession(conn);
      expect(await where(conn)).toBe(`${home}.replay_both`);
      expect(conn.sessionReplacements).toBe(1);
    } finally {
      await conn.close();
    }
  });
});

describe("a lazy connection opens where its options put it", () => {
  test.each([
    {
      name: "a schema both catalogs have, then the catalog",
      connect: {},
      sets: [{ schema: "replay_both" }, { catalog: "replay_where" }],
      want: "replay_where.main",
    },
    {
      name: "a schema only the catalog before has, then the catalog",
      connect: {},
      sets: [{ schema: "replay_only_default" }, { catalog: "replay_where" }],
      want: "replay_where.main",
    },
    {
      name: "a schema given to connect, then the catalog",
      connect: { schema: "replay_only_default" },
      sets: [{ catalog: "replay_where" }],
      want: "replay_where.main",
    },
    {
      name: "the catalog, then the schema (sent: both)",
      connect: {},
      sets: [{ catalog: "replay_where" }, { schema: "replay_both" }],
      want: "replay_where.replay_both",
    },
  ])("$name", async ({ connect: options, sets, want }) => {
    const conn = await open(server, { ...options, fetch: discoveryStopped, logger: quiet });
    try {
      expect(conn.sessionId, "the connection is not lazy").toBe("");
      for (const set of sets) await conn.setOptions(set);
      expect(conn.sessionId).toBe("");
      expect(await where(conn), "at the first request").toBe(want);
      await loseSession(conn);
      expect(await where(conn), "the replacement session is not where the lost one was").toBe(want);
      expect(conn.sessionReplacements).toBe(1);
    } finally {
      await conn.close();
    }
  });
});

describe("a catalog and a schema given together", () => {
  // The schema is looked up in the catalog given with it, whichever comes first. A client that
  // applied them one at a time in an order that varies would fail most of these, and pass most
  // single runs: so 40 connects of each form.
  test("name that catalog's schema, on each of 40 connects, lazy ones and a replacement session included", async () => {
    const want = "replay_where.replay_only_here";
    // The twin: alone, the schema is looked up in the default catalog, which has none of that name.
    const alone = await rejection(open(server, { schema: "replay_only_here" }));
    expect(alone.code).toBe(ErrorCode.invalidOptionValue);
    expect(alone.message).toContain("replay_only_here");

    const forms: Array<[string, Partial<ConnectOptions>]> = [
      ["catalog, schema", { catalog: "replay_where", schema: "replay_only_here" }],
      ["sessionOptions, schema first", { sessionOptions: { schema: "replay_only_here", catalog: "replay_where" } }],
      [
        "schema, catalog in sessionOptions",
        { schema: "replay_only_here", sessionOptions: { catalog: "replay_where" } },
      ],
    ];
    const landed: Record<string, number> = {};
    const note = async (form: string, options: Partial<ConnectOptions>, lose = false): Promise<void> => {
      let at: string;
      try {
        const conn = await open(server, { ...options, logger: quiet });
        try {
          at = await where(conn);
          if (lose) {
            await loseSession(conn);
            at = `${at}, then ${await where(conn)}`;
          }
        } finally {
          await conn.close();
        }
      } catch (err) {
        at = `error: ${String(err).replace(/, request \w+/u, "")}`; // without its request id, so equal errors count as one
      }
      landed[`${form} -> ${at}`] = (landed[`${form} -> ${at}`] ?? 0) + 1;
    };
    for (let i = 0; i < 40; i++) {
      for (const [form, options] of forms) {
        await note(form, options);
        await note(`lazy: ${form}`, { ...options, fetch: discoveryStopped });
      }
      await note("catalog, schema, and its replacement", forms[0]![1], true);
    }
    const expected = Object.fromEntries(
      forms.flatMap(([form]) => [form, `lazy: ${form}`]).map((f) => [`${f} -> ${want}`, 40]),
    );
    expected[`catalog, schema, and its replacement -> ${want}, then ${want}`] = 40;
    expect(landed).toEqual(expected);
  });
});
