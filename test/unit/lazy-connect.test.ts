// Licensed under the Apache License, Version 2.0.
//
// Lazy connect through this package: a GizmoData Cloud cluster stopped while idle is answered by a
// stand-in whose discovery says "state": "stopped". connect() then sends only discovery, even with
// session options and a session tag, and the first statement signs in, opens the session, sends
// the options and runs. Nothing this package adds to connect may send a request before that.

import { describe, expect, test } from "vitest";

import { connect } from "../../src/index.js";

function stoppedCluster() {
  const sent: string[] = [];
  const bodies: Record<string, unknown> = {};
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    sent.push(key);
    if (init?.body instanceof Uint8Array) bodies[key] = JSON.parse(new TextDecoder().decode(init.body)) as unknown;
    if (url.pathname === "/chargewire") {
      return json(200, {
        protocol: "chargewire",
        protocol_versions: ["1"],
        capabilities: ["transactions"],
        auth: { grant_types: ["password"] },
        state: "stopped",
      });
    }
    if (url.pathname.endsWith("/auth/token"))
      return json(200, { access_token: "t1", token_type: "Bearer", expires_in: 3600 });
    if (key === "POST /chargewire/v1/sessions") {
      return json(201, { session_id: "s1", options: {}, transaction: "none", idle_timeout_s: 900 });
    }
    if (method === "PATCH") return json(200, { options: {}, errors: {} });
    if (url.pathname.endsWith("/statements")) {
      return json(200, { statement_id: "q1", state: "succeeded", result: { kind: "update", rows_affected: 1 } });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { sent, bodies, fetchImpl };
}

describe("lazy connect to a stopped cluster", () => {
  test("connect with session options and a tag sends only discovery; the first statement sends sign-in, session, setup, statement", async () => {
    const cluster = stoppedCluster();
    const conn = await connect({
      url: "hardcharger://my-cluster.test.invalid:31337",
      username: "u",
      password: "p",
      catalog: "lake",
      sessionOptions: { session_tag: { app: "pool" } },
      fetch: cluster.fetchImpl,
    });
    await conn.setOptions({ schema: "analytics" });
    expect(cluster.sent).toEqual(["GET /chargewire"]);
    expect(await conn.execute("UPDATE t SET x = 1")).toBe(1);
    expect(cluster.sent.slice(0, 5)).toEqual([
      "GET /chargewire",
      "POST /chargewire/v1/auth/token",
      "POST /chargewire/v1/sessions",
      "PATCH /chargewire/v1/sessions/s1",
      "POST /chargewire/v1/sessions/s1/statements",
    ]);
    expect(cluster.bodies["POST /chargewire/v1/sessions"]).toEqual({
      options: { session_tag: { app: "pool" }, catalog: "lake" },
    });
    expect(cluster.bodies["PATCH /chargewire/v1/sessions/s1"]).toEqual({ options: { schema: "analytics" } });
    await conn.close();
  });
});
