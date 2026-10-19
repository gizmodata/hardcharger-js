// Licensed under the Apache License, Version 2.0.
//
// Browser sign-in (authType "external", Warp SQL §4.3) against hardcharger-server with
// --oauth-client-id and a mock OpenID Connect provider (idp.ts): the server verifies the
// provider's ID token with its JWKS and hands out its own access token.

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  HardchargerErrorCode,
  browserSignInProvider,
  connect,
  pollBrowserSignIn,
  startBrowserSignIn,
} from "../../src/index.js";
import { freePort, launchServer, type RunningServer } from "./harness.js";
import { reached, rejection, scalar } from "./helpers.js";
import { type MockIdp, startIdp } from "./idp.js";

const identity = "alice@example.com";
let idp: MockIdp;
let server: RunningServer;

beforeAll(async () => {
  idp = await startIdp();
  const port = await freePort();
  server = await launchServer({
    port,
    args: [
      "--token-allowed-issuer",
      idp.issuer,
      "--token-allowed-audience",
      idp.clientId,
      "--token-default-role",
      "admin",
      "--token-authorized-emails",
      identity,
      "--oauth-client-id",
      idp.clientId,
      "--oauth-base-url",
      `http://127.0.0.1:${port}`,
    ],
    env: { HARDCHARGER_OAUTH_CLIENT_SECRET: idp.clientSecret },
  });
});

afterAll(async () => {
  await server?.stop();
  await idp?.stop();
});

/** What a browser does with the sign-in URL: through the provider to the server's callback. */
async function browse(authorizeUrl: string): Promise<Response> {
  const atIdp = await fetch(authorizeUrl, { redirect: "manual" });
  expect(atIdp.status).toBe(302);
  const callback = atIdp.headers.get("location")!;
  expect(callback.startsWith(`http://127.0.0.1:${server.port}/warp/v1/auth/oauth/callback?`)).toBe(true);
  return fetch(callback, { redirect: "manual" });
}

describe("browser sign-in (live, Hardcharger)", () => {
  test('authType "external": signed in as the provider\'s user', async () => {
    reached();
    const discovery = (await (await fetch(`http://127.0.0.1:${server.port}/warp`)).json()) as never;
    expect(browserSignInProvider(discovery)).toBeUndefined(); // no --oauth-provider-name given
    const conn = await connect({
      url: server.url,
      authType: "external",
      openUrl: async (url) => {
        await (await browse(url)).text();
      },
    });
    try {
      expect(await scalar(conn, "SELECT HARDCHARGER_USER()")).toBe(identity);
    } finally {
      await conn.close();
    }
  });

  test("the poll secret is required, the token comes once, and an unknown user is refused", async () => {
    reached();
    const flow = await startBrowserSignIn({ url: server.url });
    await (await browse(flow.authorizeUrl)).text();
    const wrong = await rejection(pollBrowserSignIn({ url: server.url, flow: { ...flow, pollSecret: "nope" } }));
    expect(wrong.code).toBe(HardchargerErrorCode.flowNotFound);
    expect((await pollBrowserSignIn({ url: server.url, flow })).state).toBe("complete");
    expect((await rejection(pollBrowserSignIn({ url: server.url, flow }))).code).toBe(
      HardchargerErrorCode.flowNotFound,
    );

    idp.email = "mallory@example.org";
    try {
      const other = await startBrowserSignIn({ url: server.url });
      await (await browse(other.authorizeUrl)).text();
      const err = await rejection(pollBrowserSignIn({ url: server.url, flow: other }));
      expect(err.code).toBe(HardchargerErrorCode.invalidCredentials);
    } finally {
      idp.email = identity;
    }
  });
});
