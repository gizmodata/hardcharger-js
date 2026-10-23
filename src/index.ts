// Licensed under the Apache License, Version 2.0.

/**
 * @packageDocumentation
 * The JavaScript/TypeScript client for Hardcharger, GizmoData's DuckDB 2.0 server: a thin
 * layer on the Warp SQL client (`@gizmodata/warp-sql`) that accepts `hardcharger://` URLs,
 * with Hardcharger's port 31337 as the default. Everything else (Arrow results, bind
 * parameters, split results, ingest, transactions, cancel, TLS and client certificates) is
 * the Warp SQL client's, re-exported here so you never import it yourself.
 *
 * ```ts
 * import { connect } from "@gizmodata/hardcharger";
 *
 * const conn = await connect({ url: "hardcharger://localhost?tls=false", username: "hardcharger", password });
 * console.log((await conn.query("SELECT 42 AS answer")).toArray());
 * ```
 */

import {
  type BrowserSignInFlow,
  type BrowserSignInPoll,
  type BrowserSignInResult,
  type BrowserSignInStorage,
  type BrowserSignInTarget as WarpBrowserSignInTarget,
  type Connection,
  type ConnectOptions as WarpConnectOptions,
  type Logger,
  beginBrowserRedirectSignIn as warpBeginBrowserRedirectSignIn,
  browserSignIn as warpBrowserSignIn,
  completeBrowserRedirectSignIn as warpCompleteBrowserRedirectSignIn,
  connect as warpConnect,
  pollBrowserSignIn as warpPollBrowserSignIn,
  startBrowserSignIn as warpStartBrowserSignIn,
} from "@gizmodata/warp-sql";

import { clientInvalidArgument, parseUrl, schemes } from "./uri.js";

export { defaultPort, parseUrl, scheme, schemes } from "./uri.js";

/** This package's version. */
export const version = "2.0.2";

/**
 * `connect`'s options: the Warp SQL client's, with `url` also taking `hardcharger://` URLs and
 * `authType` also taking `"mtls"`, the name the Hardcharger ADBC and JDBC drivers accept for
 * `"client_certificate"`, and `"external"`, theirs for `"oauth_browser"`. `schemes` is not
 * taken: the URL schemes are this package's to set.
 */
export interface ConnectOptions extends Omit<WarpConnectOptions, "schemes" | "authType"> {
  /**
   * `hardcharger://host[:port][/prefix][?tls=false]` (HTTPS to port 31337 unless it says
   * otherwise), or the Warp SQL client's `warp://`, `https://` and `http://`.
   */
  url: string;
  /**
   * `"client_certificate"` (or `"mtls"`): sign in with the TLS client certificate alone, no
   * password (`tls.cert` and `tls.key` in Node, Deno and Bun; the one the user picks in a
   * browser). Default: `"password"` (or whichever credential is given).
   *
   * `"external"` (or `"oauth_browser"`): browser sign-in with the server's identity provider
   * (hardcharger-server with `--oauth-client-id`): `openUrl` opens the sign-in URL, and the
   * connection waits up to `browserSignInTimeoutMs` (default 5 minutes) for the person.
   */
  authType?: "password" | "client_certificate" | "mtls" | "external" | "oauth_browser";
}

/**
 * Opens a connection to a Hardcharger server: discovers it, signs in, and opens a session.
 *
 * ```ts
 * const conn = await connect({ url: "hardcharger://db.example.com", username: "joe", password });
 * ```
 *
 * Errors are {@link HardchargerError}s (the Warp SQL client's `WarpSqlError`), with the
 * server's code in `code`.
 */
export async function connect(options: ConnectOptions): Promise<Connection> {
  if (options === null || typeof options !== "object") throw clientInvalidArgument("connect takes an options object");
  const given = options as ConnectOptions & { uri?: unknown; schemes?: unknown };
  if (given.url === undefined && given.uri !== undefined) {
    throw clientInvalidArgument('the option is url, not uri: connect({ url: "hardcharger://host:31337", ... })');
  }
  if (given.schemes !== undefined) {
    throw clientInvalidArgument(
      "schemes is set by @gizmodata/hardcharger (hardcharger://, warp://, https://, http://); " +
        "for other schemes use @gizmodata/warp-sql's connect",
    );
  }
  parseUrl(options.url); // a bad URL is refused here, in Hardcharger's words, before anything is sent
  const { authType, logger, ...rest } = options;
  const warpOptions: WarpConnectOptions = { ...rest, schemes, logger: logger ?? defaultLogger };
  if (authType !== undefined) {
    warpOptions.authType =
      authType === "mtls" ? "client_certificate" : authType === "external" ? "oauth_browser" : authType;
  }
  return warpConnect(warpOptions);
}

/** Which server a browser sign-in is for: the Warp SQL client's, with `hardcharger://` URLs. */
export type BrowserSignInTarget = Omit<WarpBrowserSignInTarget, "schemes">;

function target<T extends BrowserSignInTarget>(options: T): T & { schemes: typeof schemes } {
  if (options === null || typeof options !== "object")
    throw clientInvalidArgument("browser sign-in takes an options object");
  parseUrl(options.url);
  return { ...options, schemes };
}

/** Starts a browser sign-in flow (the Warp SQL client's `startBrowserSignIn`, for `hardcharger://` URLs). */
export async function startBrowserSignIn(
  options: BrowserSignInTarget & { returnTo?: string },
): Promise<BrowserSignInFlow> {
  return warpStartBrowserSignIn(target(options));
}

/** Polls a browser sign-in flow once; a failed sign-in throws its code. */
export async function pollBrowserSignIn(
  options: BrowserSignInTarget & { flow: Pick<BrowserSignInFlow, "flowId" | "pollSecret"> },
): Promise<BrowserSignInPoll> {
  return warpPollBrowserSignIn(target(options));
}

/** The whole browser sign-in: `openUrl` opens the sign-in URL; resolves with the server's access token. */
export async function browserSignIn(
  options: BrowserSignInTarget & { openUrl: (url: string) => void | Promise<void>; timeoutMs?: number },
): Promise<BrowserSignInResult> {
  return warpBrowserSignIn(target(options));
}

/** For a web page: starts a flow that comes back to `returnTo` and goes to the identity provider. */
export async function beginBrowserRedirectSignIn(
  options: BrowserSignInTarget & { returnTo?: string; storage?: BrowserSignInStorage; assign?: (url: string) => void },
): Promise<void> {
  return warpBeginBrowserRedirectSignIn(target(options));
}

/** For the page the sign-in returned to: collects the token, or undefined when there is none for this tab. */
export async function completeBrowserRedirectSignIn(
  options: BrowserSignInTarget & { href?: string; storage?: BrowserSignInStorage; replaceUrl?: (url: string) => void },
): Promise<BrowserSignInResult | undefined> {
  return warpCompleteBrowserRedirectSignIn(target(options));
}

const defaultLogger: Logger = {
  warn: (message, fields) => console.warn(`[hardcharger] ${message}`, fields ?? ""),
};

// Everything else is the Warp SQL client's, re-exported under its own names and, where a
// Hardcharger name reads better, under that too. The aliases are the same classes and
// objects, so `instanceof` and `HardchargerError.is` work on every error the client raises.
export {
  Capability,
  Connection,
  Connection as HardchargerConnection,
  ErrorCode,
  Metadata,
  PreparedStatement,
  ResultStream,
  WarpSqlError,
  WarpSqlError as HardchargerError,
  ErrorCode as HardchargerErrorCode,
  browserSignInFragmentKey,
  browserSignInProvider,
  takeBrowserSignInFlowId,
} from "@gizmodata/warp-sql";
export type {
  ArrowInput,
  BrowserSignInFlow,
  BrowserSignInPoll,
  BrowserSignInResult,
  BrowserSignInStorage,
  CallOptions,
  CancelReason,
  ColumnInfo,
  DiscoveryDocument,
  IngestOptions,
  InvalidTokenReason,
  JsonScalar,
  KnownErrorCode,
  Logger,
  MetadataCallOptions,
  Parameters,
  ProblemDocument,
  ServerInfo,
  SessionDocument,
  SessionEndedReason,
  StatementDocument,
  StatementOptions,
  StatementState,
  TlsOptions,
  TransactionState,
  WarpSqlErrorInit,
} from "@gizmodata/warp-sql";
