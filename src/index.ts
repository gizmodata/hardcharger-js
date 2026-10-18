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
  type Connection,
  type ConnectOptions as WarpConnectOptions,
  type Logger,
  connect as warpConnect,
} from "@gizmodata/warp-sql";

import { invalidArgument, parseUrl, toWarpUrl } from "./uri.js";

export { defaultPort, parseUrl, scheme, toWarpUrl } from "./uri.js";

/** This package's version. */
export const version = "0.1.0";

/**
 * `connect`'s options: the Warp SQL client's, with `url` also taking `hardcharger://` URLs and
 * `authType` also taking `"mtls"`, the name the Hardcharger ADBC and JDBC drivers accept for
 * `"client_certificate"`. `schemes` is not taken: the URL schemes are this package's to set.
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
   */
  authType?: "password" | "client_certificate" | "mtls";
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
  if (options === null || typeof options !== "object") throw invalidArgument("connect takes an options object");
  const given = options as ConnectOptions & { uri?: unknown; schemes?: unknown };
  if (given.url === undefined && given.uri !== undefined) {
    throw invalidArgument('the option is url, not uri: connect({ url: "hardcharger://host:31337", ... })');
  }
  if (given.schemes !== undefined) {
    throw invalidArgument(
      "schemes is set by @gizmodata/hardcharger (hardcharger://, warp://, https://, http://); " +
        "for other schemes use @gizmodata/warp-sql's connect",
    );
  }
  parseUrl(options.url); // a bad URL is refused here, in Hardcharger's words, before anything is sent
  const { authType, logger, url, ...rest } = options;
  const warpOptions: WarpConnectOptions = { ...rest, url: toWarpUrl(url), logger: logger ?? defaultLogger };
  if (authType !== undefined) warpOptions.authType = authType === "mtls" ? "client_certificate" : authType;
  return warpConnect(warpOptions);
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
} from "@gizmodata/warp-sql";
export type {
  ArrowInput,
  CallOptions,
  ColumnInfo,
  DiscoveryDocument,
  IngestOptions,
  JsonScalar,
  KnownErrorCode,
  Logger,
  MetadataCallOptions,
  Parameters,
  ProblemDocument,
  SessionDocument,
  SessionEndedReason,
  StatementDocument,
  StatementOptions,
  StatementState,
  TlsOptions,
  WarpSqlErrorInit,
} from "@gizmodata/warp-sql";
