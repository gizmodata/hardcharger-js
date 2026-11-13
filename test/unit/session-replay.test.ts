// Licensed under the Apache License, Version 2.0.
//
// What a connection made through this package replays when the server replaces a lost session,
// and what a lazy one sends when its first request opens the session: the current catalog and
// schema in the order they were set. Setting the catalog moves the session to that catalog's
// default schema, as SQL USE does, so a schema set before it is forgotten (@gizmodata/chargewire
// 2.3.6); replayed, it would open the new session in another schema, or fail every request.
// No server: a fetch that answers as a cluster does, and records what it was sent.

import { describe, expect, test } from "vitest";

import { connect } from "../../src/index.js";

/** A cluster that loses session s1 at its first statement, or a stopped one (lazy connect). */
function cluster(state?: "stopped") {
  const sent: Array<{ request: string; body: unknown }> = [];
  let sessions = 0;
  const json = (status: number, body: unknown, type = "application/json"): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": type } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const body: unknown =
      init?.body instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(init.body)) : undefined;
    sent.push({ request: `${method} ${url.pathname}`, body });
    if (url.pathname === "/chargewire") {
      return json(200, {
        protocol: "chargewire",
        protocol_versions: ["1"],
        capabilities: ["transactions"],
        auth: { grant_types: ["password"] },
        ...(state !== undefined ? { state } : {}),
      });
    }
    if (url.pathname.endsWith("/auth/token"))
      return json(200, { access_token: "t1", token_type: "Bearer", expires_in: 3600 });
    if (method === "POST" && url.pathname === "/chargewire/v1/sessions") {
      return json(201, { session_id: `s${++sessions}`, options: {}, transaction: "none", idle_timeout_s: 900 });
    }
    if (method === "PATCH") return json(200, { options: (body as { options: unknown }).options, errors: {} });
    if (url.pathname.endsWith("/statements")) {
      // An open cluster loses its first session; the replacement (and a lazy one's first) runs it.
      if (state === undefined && url.pathname.includes("/sessions/s1/")) {
        return json(
          404,
          { status: 404, code: "session_not_found", detail: "no such session" },
          "application/problem+json",
        );
      }
      return json(200, { statement_id: "q1", state: "succeeded", result: { kind: "update", rows_affected: 1 } });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const bodies = (request: string): unknown[] => sent.filter((s) => s.request === request).map((s) => s.body);
  return { sent, bodies, fetchImpl };
}

const quiet = { warn: () => {} };

describe("the current catalog and schema are replayed in the order they were set", () => {
  test.each([
    {
      name: "the schema, then the catalog: the schema is forgotten",
      sets: [{ schema: "raw" }, { catalog: "lake" }],
      replayed: { catalog: "lake" },
    },
    {
      name: "the catalog, then the schema: both",
      sets: [{ catalog: "lake" }, { schema: "raw" }],
      replayed: { catalog: "lake", schema: "raw" },
    },
    {
      name: "both in one call, after another schema: both",
      sets: [{ schema: "old" }, { schema: "raw", catalog: "lake" }],
      replayed: { catalog: "lake", schema: "raw" },
    },
  ])("a lost session's replacement: $name", async ({ sets, replayed }) => {
    const server = cluster();
    const conn = await connect({
      url: "hardcharger://my-cluster.test.invalid:31337",
      username: "u",
      password: "p",
      fetch: server.fetchImpl,
      logger: quiet,
    });
    for (const options of sets) await conn.setOptions(options);
    expect(await conn.execute("UPDATE t SET x = 1")).toBe(1);
    expect(conn.sessionReplacements).toBe(1);
    expect(conn.sessionId).toBe("s2");
    expect(server.bodies("POST /chargewire/v1/sessions")).toEqual([{ options: {} }, { options: replayed }]);
    await conn.close();
  });

  test.each([
    {
      name: "the schema, then the catalog: the schema is not sent",
      sets: [{ schema: "raw" }, { catalog: "lake" }],
      opened: { catalog: "lake" },
    },
    {
      name: "the catalog, then the schema: both",
      sets: [{ catalog: "lake" }, { schema: "raw" }],
      opened: { catalog: "lake", schema: "raw" },
    },
  ])("a stopped cluster's first statement: $name", async ({ sets, opened }) => {
    const server = cluster("stopped");
    const conn = await connect({
      url: "hardcharger://my-cluster.test.invalid:31337",
      username: "u",
      password: "p",
      fetch: server.fetchImpl,
      logger: quiet,
    });
    for (const options of sets) await conn.setOptions(options);
    expect(server.sent.map((s) => s.request)).toEqual(["GET /chargewire"]);
    expect(await conn.execute("UPDATE t SET x = 1")).toBe(1);
    expect(server.bodies("POST /chargewire/v1/sessions")).toEqual([{ options: {} }]);
    expect(server.bodies("PATCH /chargewire/v1/sessions/s1")).toEqual([{ options: opened }]);
    await conn.close();
  });
});
