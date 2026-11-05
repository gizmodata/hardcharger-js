// Licensed under the Apache License, Version 2.0.
//
// What connect refuses before it sends anything, and the package's surface: the Chargewire
// client's API, re-exported, with Hardcharger names that are the same objects. No server: a
// fetch that fails the test proves nothing was sent.

import { readFileSync } from "node:fs";

import * as chargewire from "@gizmodata/chargewire";
import { describe, expect, test } from "vitest";

import * as hardcharger from "../../src/index.js";
import { type ConnectOptions, ErrorCode, HardchargerError, connect } from "../../src/index.js";

const noNetwork: typeof fetch = () => {
  throw new Error("connect sent a request it should have refused");
};

async function refused(options: unknown): Promise<HardchargerError> {
  try {
    await connect(options as ConnectOptions);
  } catch (err) {
    expect(err).toBeInstanceOf(HardchargerError);
    expect((err as HardchargerError).code).toBe(ErrorCode.clientInvalidArgument);
    return err as HardchargerError;
  }
  throw new Error("connect did not refuse");
}

describe("connect refuses before sending anything", () => {
  test("a hardcharger+http:// URL", async () => {
    const err = await refused({ url: "hardcharger+http://127.0.0.1", username: "u", password: "p", fetch: noNetwork });
    expect(err.message).toContain("hardcharger://host:port?tls=false");
  });

  test("uri instead of url", async () => {
    const err = await refused({ uri: "hardcharger://127.0.0.1", username: "u", password: "p", fetch: noNetwork });
    expect(err.message).toBe(
      '[hardcharger] the option is url, not uri: connect({ url: "hardcharger://host:31337", ... })',
    );
  });

  test("schemes of its own", async () => {
    const err = await refused({ url: "hardcharger://h", schemes: {}, username: "u", password: "p", fetch: noNetwork });
    expect(err.message).toContain("schemes is set by @gizmodata/hardcharger");
  });

  test("no options", async () => {
    expect((await refused(undefined)).message).toContain("connect takes an options object");
    expect((await refused({ fetch: noNetwork })).message).toContain("a url is required, e.g. hardcharger://host:31337");
  });

  test("credentials in the URL", async () => {
    const err = await refused({ url: "hardcharger://joe:pw@127.0.0.1", fetch: noNetwork });
    expect(err.message).toContain("credentials do not belong in the url");
  });

  // authType "mtls" is "client_certificate": the Chargewire client's own refusals for a
  // certificate sign-in prove the alias reached it.
  test.each(["mtls", "client_certificate"])('authType "%s" over plain HTTP', async (authType) => {
    const err = await refused({ url: "hardcharger://127.0.0.1?tls=false", authType, fetch: noNetwork });
    expect(err.message).toBe(
      'authType "client_certificate" needs TLS, but http://127.0.0.1:31337/chargewire is plain HTTP',
    );
  });

  test.each(["mtls", "client_certificate"])('authType "%s" without a certificate', async (authType) => {
    const err = await refused({ url: "hardcharger://127.0.0.1", authType });
    expect(err.message).toBe('authType "client_certificate" needs a client certificate: set tls.cert and tls.key');
  });

  test('authType "mtls" with a password', async () => {
    const err = await refused({
      url: "hardcharger://127.0.0.1",
      authType: "mtls",
      username: "u",
      password: "p",
      fetch: noNetwork,
    });
    expect(err.message).toContain("client_certificate");
  });

  // authType "external" is "oauth_browser": the Chargewire client's refusal proves the alias reached it.
  test.each(["external", "oauth_browser"])('authType "%s" without openUrl', async (authType) => {
    const err = await refused({ url: "hardcharger://127.0.0.1", authType, fetch: noNetwork });
    expect(err.message).toBe(
      'authType "oauth_browser" needs openUrl, a function that opens (or shows) the sign-in URL',
    );
  });

  test('authType "external" with a password', async () => {
    const err = await refused({
      url: "hardcharger://127.0.0.1",
      authType: "external",
      openUrl: () => {},
      username: "u",
      password: "p",
      fetch: noNetwork,
    });
    expect(err.message).toContain('authType "oauth_browser" signs in through the browser');
  });

  test("an unknown authType is the Chargewire client's refusal", async () => {
    const err = await refused({ url: "hardcharger://127.0.0.1", authType: "kerberos", fetch: noNetwork });
    expect(err.message).toContain("kerberos");
  });
});

describe("connect reaches the server it names", () => {
  test.each([
    ["hardcharger://db.example.com", "https://db.example.com:31337/chargewire"],
    ["hardcharger://db.example.com:443", "https://db.example.com/chargewire"],
    ["hardcharger://db.example.com:443?tls=false", "http://db.example.com:443/chargewire"],
    ["hardcharger://db.example.com/custom?tls=false", "http://db.example.com:31337/custom"],
    ["chargewire://db.example.com", "https://db.example.com/chargewire"],
  ])("%s: the first request goes to %s", async (url, discovery) => {
    const seen: string[] = [];
    const recording: typeof fetch = (input) => {
      seen.push(input instanceof Request ? input.url : String(input));
      return Promise.reject(new TypeError("fetch failed"));
    };
    try {
      await connect({ url, username: "u", password: "p", fetch: recording, maxAttempts: 1 });
      throw new Error("connected");
    } catch (err) {
      expect(HardchargerError.is(err, ErrorCode.clientTransportError)).toBe(true);
    }
    expect(seen[0]).toBe(discovery);
  });
});

describe("browser sign-in on hardcharger:// URLs", () => {
  test("a flow goes to the server the URL names, its default port included", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fake: typeof fetch = (input, init) => {
      seen.push({
        url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
        body: new TextDecoder().decode(init?.body as Uint8Array),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            flow_id: "f_1",
            poll_secret: "secret",
            authorize_url: "https://idp.example/authorize",
            poll_interval_s: 2,
            expires_at: "2099-01-01T00:00:00Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const flow = await hardcharger.startBrowserSignIn({
      url: "hardcharger://db.example.com",
      fetch: fake,
      returnTo: "/ui/",
    });
    expect(flow.flowId).toBe("f_1");
    expect(seen).toEqual([
      {
        url: "https://db.example.com:31337/chargewire/v1/auth/oauth/flows",
        body: JSON.stringify({ return_to: "/ui/" }),
      },
    ]);
  });

  test("a bad URL is refused in Hardcharger's words, before anything is sent", async () => {
    await expect(hardcharger.startBrowserSignIn({ url: "hardcharger+http://h", fetch: noNetwork })).rejects.toThrow(
      "hardcharger://host:port?tls=false",
    );
  });

  /** A server whose flow polls answer `poll` (and whose flow creation answers a 2 s interval). */
  const flowServer =
    (poll: Record<string, unknown>): typeof fetch =>
    (input) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body = url.endsWith("/flows")
        ? {
            flow_id: "f_1",
            poll_secret: "secret",
            authorize_url: "https://idp.example/authorize",
            poll_interval_s: 2,
            expires_at: "2099-01-01T00:00:00Z",
          }
        : poll;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: url.endsWith("/flows") ? 201 : 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
  const flow = { flowId: "f_1", pollSecret: "secret" };

  async function pollRejection(poll: Record<string, unknown>): Promise<HardchargerError> {
    try {
      await hardcharger.pollBrowserSignIn({ url: "hardcharger://db.example.com", fetch: flowServer(poll), flow });
    } catch (err) {
      expect(err).toBeInstanceOf(HardchargerError);
      return err as HardchargerError;
    }
    throw new Error("the poll did not fail");
  }

  test("a failed flow throws its error.code, with no HTTP status (the poll answer was a 200)", async () => {
    for (const code of [ErrorCode.accessDenied, ErrorCode.identityProviderError, ErrorCode.invalidCredentials]) {
      const err = await pollRejection({ state: "failed", error: { code, detail: "no" } });
      expect(err.code).toBe(code);
      expect(err.status).toBeUndefined();
    }
  });

  test("a failed flow without error.code is client_protocol_error", async () => {
    expect((await pollRejection({ state: "failed", error: {} })).code).toBe(ErrorCode.clientProtocolError);
  });

  test("a flow state the client doesn't know keeps polling", async () => {
    const poll = await hardcharger.pollBrowserSignIn({
      url: "hardcharger://db.example.com",
      fetch: flowServer({ state: "awaiting_second_factor" }),
      flow,
    });
    expect(poll.state).toBe("pending");
  });

  test("a sign-in not completed in time is client_sign_in_timeout", async () => {
    const opened: string[] = [];
    const err = await hardcharger
      .browserSignIn({
        url: "hardcharger://db.example.com",
        fetch: flowServer({ state: "pending" }),
        openUrl: (url) => void opened.push(url),
        timeoutMs: 50,
      })
      .catch((e: unknown) => e);
    expect(HardchargerError.is(err, ErrorCode.clientSignInTimeout)).toBe(true);
    expect((err as HardchargerError).status).toBeUndefined();
    expect(opened).toEqual(["https://idp.example/authorize"]);
  });
});

describe("the package's surface", () => {
  test("Hardcharger names are the Chargewire client's objects", () => {
    expect(hardcharger.HardchargerError).toBe(chargewire.ChargewireError);
    expect(hardcharger.ChargewireError).toBe(chargewire.ChargewireError);
    expect(hardcharger.HardchargerErrorCode).toBe(chargewire.ErrorCode);
    expect(hardcharger.HardchargerConnection).toBe(chargewire.Connection);
    for (const name of ["Capability", "Connection", "ErrorCode", "Metadata", "PreparedStatement", "ResultStream"]) {
      expect((hardcharger as Record<string, unknown>)[name], name).toBe((chargewire as Record<string, unknown>)[name]);
    }
    expect(hardcharger.connect).not.toBe(chargewire.connect);
  });

  test("every value the Chargewire client exports is here, but its connect, parseUrl, defaultSchemes and version", () => {
    const own = new Set(["connect", "parseUrl", "defaultSchemes", "version"]); // replaced by Hardcharger's
    const missing = Object.keys(chargewire).filter((name) => !own.has(name) && !(name in hardcharger));
    expect(missing).toEqual([]);
  });

  test("the client's own codes begin with client_ (Chargewire 1.0), and the server's keep theirs", () => {
    const codes = hardcharger.HardchargerErrorCode;
    expect(codes.clientInvalidArgument).toBe("client_invalid_argument");
    expect(codes.clientTransportError).toBe("client_transport_error");
    expect(codes.clientProtocolError).toBe("client_protocol_error");
    expect(codes.clientHttpError).toBe("client_http_error");
    expect(codes.clientIncompleteStream).toBe("client_incomplete_stream");
    expect(codes.clientResultBufferExceeded).toBe("client_result_buffer_exceeded");
    expect(codes.clientConnectionClosed).toBe("client_connection_closed");
    expect(codes.certificateRequired).toBe("certificate_required");
    expect(codes.statementNotFound).toBe("statement_not_found");
    expect(codes.partitionNotFound).toBe("partition_not_found");
    expect(codes.internalError).toBe("internal_error");
    expect(codes.clientSignInTimeout).toBe("client_sign_in_timeout");
    expect(codes.flowNotFound).toBe("flow_not_found");
    expect(codes.invalidReturnTo).toBe("invalid_return_to");
    expect(codes.accessDenied).toBe("access_denied");
    expect(codes.identityProviderError).toBe("identity_provider_error");
    for (const gone of [
      "invalidArgument",
      "transportError",
      "protocolError",
      "connectionClosed",
      "clientCertificateRequired",
    ]) {
      expect(codes, gone).not.toHaveProperty(gone);
    }
    expect(hardcharger.Capability).not.toHaveProperty("resultRetention");
    expect(hardcharger.Capability).not.toHaveProperty("partitionedResults");
    expect(hardcharger.Capability.resultLocations).toBe("result_locations");
  });

  test("the version is package.json's", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(hardcharger.version).toBe(pkg.version);
  });

  test("scheme and defaultPort", () => {
    expect(hardcharger.scheme).toBe("hardcharger");
    expect(hardcharger.defaultPort).toBe(31337);
  });
});

describe("a server that is resuming (resumeTimeout, onResuming)", () => {
  /** A Hardcharger front door that answers the first `times` sign-ins with server_resuming. */
  function resumingServer(times: number, retryAfter: string): { fetch: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    let logins = 0;
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    const fake: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      urls.push(url);
      const path = new URL(url).pathname;
      const method = init?.method ?? "GET";
      if (path === "/chargewire")
        return Promise.resolve(json(200, { protocol: "chargewire", protocol_versions: ["1"], capabilities: [] }));
      if (path === "/chargewire/v1/auth/token") {
        return Promise.resolve(
          ++logins <= times
            ? json(
                503,
                { code: "server_resuming", status: 503, detail: "the cluster is starting" },
                { "retry-after": retryAfter },
              )
            : json(200, { access_token: "t1", token_type: "Bearer", expires_in: 3600 }),
        );
      }
      if (path === "/chargewire/v1/sessions" && method === "POST")
        return Promise.resolve(json(201, { session_id: "s1", options: {}, transaction: "none" }));
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    return { fetch: fake, urls };
  }

  test("onResuming is told each wait, and the sign-in goes through once the server is back", async () => {
    const server = resumingServer(2, "1");
    const events: hardcharger.ResumingEvent[] = [];
    const conn = await connect({
      url: "hardcharger://db.example.com",
      username: "joe",
      password: "pw",
      fetch: server.fetch,
      resumeTimeout: 30,
      onResuming: (event) => events.push(event),
    });
    expect(events.map((e) => [e.attempt, e.retryAfterMs, e.resumeTimeoutMs, e.detail])).toEqual([
      [1, 1000, 30_000, "the cluster is starting"],
      [2, 1000, 30_000, "the cluster is starting"],
    ]);
    expect(events[0]!.elapsedMs).toBe(0);
    expect(events[1]!.elapsedMs).toBeGreaterThanOrEqual(900);
    // The hardcharger:// URL's default port, every time.
    expect(server.urls.every((u) => u.startsWith("https://db.example.com:31337/chargewire"))).toBe(true);
    await conn.close();
  }, 15_000);

  test("a GizmoData Cloud host without a port is reached at 443; an explicit port wins; look-alikes get 31337", async () => {
    const cases: Array<[string, string]> = [
      ["hardcharger://my-cluster.gizmodata.com", "https://my-cluster.gizmodata.com/chargewire"],
      ["hardcharger://my-cluster.gizmodata.com:31337", "https://my-cluster.gizmodata.com:31337/chargewire"],
      ["hardcharger://evilgizmodata.com", "https://evilgizmodata.com:31337/chargewire"],
      ["hardcharger://gizmodata.com.example.org", "https://gizmodata.com.example.org:31337/chargewire"],
    ];
    for (const [url, base] of cases) {
      const server = resumingServer(0, "1");
      const conn = await connect({ url, username: "joe", password: "pw", fetch: server.fetch });
      expect(server.urls.length, url).toBeGreaterThan(0);
      expect(
        server.urls.every((u) => u.startsWith(base)),
        `${url}: ${server.urls.join(", ")}`,
      ).toBe(true);
      await conn.close();
    }
    // Browser sign-in goes to the same place.
    const seen: string[] = [];
    await hardcharger
      .startBrowserSignIn({
        url: "hardcharger://my-cluster.gizmodata.com",
        fetch: (input) => {
          seen.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
          return Promise.resolve(new Response("{}", { status: 500 }));
        },
      })
      .catch(() => undefined);
    expect(seen[0]).toBe("https://my-cluster.gizmodata.com/chargewire/v1/auth/oauth/flows");
  });

  test("resumeTimeout 0 reports the first server_resuming at once", async () => {
    const server = resumingServer(1, "1");
    let called = 0;
    await expect(
      connect({
        url: "hardcharger://db.example.com",
        username: "joe",
        password: "pw",
        fetch: server.fetch,
        resumeTimeout: 0,
        onResuming: () => called++,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.serverResuming, status: 503 });
    expect(called).toBe(0);
  });

  test("connect's signal stops the wait at once", async () => {
    const server = resumingServer(Number.MAX_SAFE_INTEGER, "60");
    const controller = new AbortController();
    const started = performance.now();
    const work = connect({
      url: "hardcharger://db.example.com",
      username: "joe",
      password: "pw",
      fetch: server.fetch,
      signal: controller.signal,
      onResuming: () => setTimeout(() => controller.abort(), 20),
    });
    await expect(work).rejects.toMatchObject({ code: ErrorCode.statementCancelled });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
