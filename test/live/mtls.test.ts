// Licensed under the Apache License, Version 2.0.
//
// TLS and client certificate sign-in (mutual TLS) over hardcharger://127.0.0.1:<port>: a server
// with throwaway certificates (certs.ts), certificate sign-in on, and the test client's
// identity as an administrator identity.

import { tableFromArrays } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type ConnectOptions, ErrorCode, connect } from "../../src/index.js";
import { type TestCA, clientEmail, makeCAWithCleanup } from "./certs.js";
import { type RunningServer, adminUsername, launchServer, reached, rejection, scalar } from "./helpers.js";

let ca: TestCA & { remove(): void };
let server: RunningServer;

beforeAll(async () => {
  ca = makeCAWithCleanup();
  server = await launchServer({
    args: [
      "--tls-cert",
      ca.serverCert,
      "--tls-key",
      ca.serverKey,
      "--mtls-ca-cert",
      ca.caFile,
      "--mtls-certificate-sign-in",
      "--mtls-admin-identities",
      clientEmail,
    ],
  });
});

afterAll(async () => {
  await server?.stop();
  ca?.remove();
});

function certificate(cert = ca.clientCertPem, key = ca.clientKeyPem): Partial<ConnectOptions> {
  return { tls: { ca: ca.caPem, cert, key } };
}

describe("client certificate sign-in", () => {
  test.each(["client_certificate", "mtls"] as const)(
    'authType "%s": the certificate is the credential; partitions and ingest carry it',
    async (authType) => {
      reached();
      expect(server.url).toBe(`hardcharger://127.0.0.1:${server.port}`);
      const conn = await connect({ url: server.url, authType, ...certificate() });
      try {
        expect(await scalar(conn, "SELECT HARDCHARGER_USER()")).toBe(clientEmail);
        // Each partition is read over a connection of its own: every one presents the
        // certificate, or the server answers certificate_mismatch.
        const stream = conn.stream("SELECT i FROM range(1000000) t(i) ORDER BY i");
        expect((await stream.toTable()).numRows).toBe(1_000_000);
        expect(await stream.partitions()).toBeGreaterThan(1);
        const rows = tableFromArrays({ v: Int32Array.from({ length: 50_000 }, (_, i) => i) });
        expect(await conn.ingest(`mtls_${authType}`, rows, { mode: "replace" })).toBe(50_000);
      } finally {
        await conn.close();
      }
    },
  );

  test("a certificate whose identity is no user is unknown_certificate_identity (401)", async () => {
    reached();
    const stranger = ca.issueClient("stranger", "stranger@example.com");
    const err = await rejection(
      connect({ url: server.url, authType: "client_certificate", ...certificate(stranger.certPem, stranger.keyPem) }),
    );
    expect(err.code).toBe(ErrorCode.unknownCertificateIdentity);
    expect(err.status).toBe(401);
  });

  test("a password sign-in over the same TLS server works beside it", async () => {
    reached();
    const conn = await connect({
      url: server.url,
      username: adminUsername,
      password: server.password,
      ...certificate(),
    });
    expect(await scalar(conn, "SELECT HARDCHARGER_USER()")).toBe(adminUsername);
    await conn.close();
  });

  test("without the server's CA, the handshake fails: transport_error", async () => {
    reached();
    const err = await rejection(
      connect({
        url: server.url,
        authType: "mtls",
        tls: { cert: ca.clientCertPem, key: ca.clientKeyPem },
        maxAttempts: 1,
      }),
    );
    expect(err.code).toBe(ErrorCode.transportError);
  });

  test("certificate sign-in over plain HTTP is refused before sending (invalid_argument)", async () => {
    const err = await rejection(
      connect({ url: `hardcharger://127.0.0.1:${server.port}?tls=false`, authType: "mtls", ...certificate() }),
    );
    expect(err.code).toBe(ErrorCode.invalidArgument);
    expect(err.message).toContain("needs TLS");
  });
});

describe("a TLS server without certificate sign-in", () => {
  test("certificate sign-in is not_implemented; a password works", async () => {
    const plain = await launchServer({ args: ["--tls-cert", ca.serverCert, "--tls-key", ca.serverKey] });
    try {
      reached();
      const err = await rejection(connect({ url: plain.url, authType: "client_certificate", ...certificate() }));
      expect(err.code).toBe(ErrorCode.notImplemented);
      expect(err.message).toContain("does not offer client certificate sign-in");
      const conn = await connect({
        url: plain.url,
        username: adminUsername,
        password: plain.password,
        tls: { ca: ca.caPem },
      });
      expect(await scalar(conn, "SELECT 1")).toBe(1);
      await conn.close();
    } finally {
      await plain.stop();
    }
  });
});
