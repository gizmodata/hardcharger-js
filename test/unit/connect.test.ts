// Licensed under the Apache License, Version 2.0.
//
// What connect refuses before it sends anything, and the package's surface: the Warp SQL
// client's API, re-exported, with Hardcharger names that are the same objects. No server: a
// fetch that fails the test proves nothing was sent.

import { readFileSync } from "node:fs";

import * as warp from "@gizmodata/warp-sql";
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
    expect((err as HardchargerError).code).toBe(ErrorCode.invalidArgument);
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

  // authType "mtls" is "client_certificate": the Warp SQL client's own refusals for a
  // certificate sign-in prove the alias reached it.
  test.each(["mtls", "client_certificate"])('authType "%s" over plain HTTP', async (authType) => {
    const err = await refused({ url: "hardcharger://127.0.0.1?tls=false", authType, fetch: noNetwork });
    expect(err.message).toBe('authType "client_certificate" needs TLS, but http://127.0.0.1:31337/warp is plain HTTP');
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

  // authType "external" is "oauth_browser": the Warp SQL client's refusal proves the alias reached it.
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

  test("an unknown authType is the Warp SQL client's refusal", async () => {
    const err = await refused({ url: "hardcharger://127.0.0.1", authType: "kerberos", fetch: noNetwork });
    expect(err.message).toContain("kerberos");
  });
});

describe("connect reaches the server it names", () => {
  test.each([
    ["hardcharger://db.example.com", "https://db.example.com:31337/warp"],
    ["hardcharger://db.example.com:443", "https://db.example.com/warp"],
    ["hardcharger://db.example.com:443?tls=false", "http://db.example.com:443/warp"],
    ["hardcharger://db.example.com/custom?tls=false", "http://db.example.com:31337/custom"],
    ["warp://db.example.com", "https://db.example.com/warp"],
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
      expect(HardchargerError.is(err, ErrorCode.transportError)).toBe(true);
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
      { url: "https://db.example.com:31337/warp/v1/auth/oauth/flows", body: JSON.stringify({ return_to: "/ui/" }) },
    ]);
  });

  test("a bad URL is refused in Hardcharger's words, before anything is sent", async () => {
    await expect(hardcharger.startBrowserSignIn({ url: "hardcharger+http://h", fetch: noNetwork })).rejects.toThrow(
      "hardcharger://host:port?tls=false",
    );
  });
});

describe("the package's surface", () => {
  test("Hardcharger names are the Warp SQL client's objects", () => {
    expect(hardcharger.HardchargerError).toBe(warp.WarpSqlError);
    expect(hardcharger.WarpSqlError).toBe(warp.WarpSqlError);
    expect(hardcharger.HardchargerErrorCode).toBe(warp.ErrorCode);
    expect(hardcharger.HardchargerConnection).toBe(warp.Connection);
    for (const name of ["Capability", "Connection", "ErrorCode", "Metadata", "PreparedStatement", "ResultStream"]) {
      expect((hardcharger as Record<string, unknown>)[name], name).toBe((warp as Record<string, unknown>)[name]);
    }
    expect(hardcharger.connect).not.toBe(warp.connect);
  });

  test("every value the Warp SQL client exports is here, but its connect, parseUrl and defaultSchemes", () => {
    const own = new Set(["connect", "parseUrl", "defaultSchemes"]); // replaced by Hardcharger's
    const missing = Object.keys(warp).filter((name) => !own.has(name) && !(name in hardcharger));
    expect(missing).toEqual([]);
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
