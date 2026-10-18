// Licensed under the Apache License, Version 2.0.

import { ErrorCode, type SchemeMap, WarpSqlError, defaultSchemes, parseUrl as parseWarpUrl } from "@gizmodata/warp-sql";

/** Hardcharger's URI scheme: `hardcharger://host[:port]` means exactly `warp://host:port`. */
export const scheme = "hardcharger";

/** Hardcharger's Warp SQL port, used when a `hardcharger://` URI names none (`warp://` defaults to 443). */
export const defaultPort = 31337;

/**
 * Translates a `hardcharger://` URL into the Warp SQL client's own spelling of the same place:
 * `https://host:port/prefix`, or `http://…` with `?tls=false`, with the default port 31337
 * when the URL names none. `hardcharger://host:port` means exactly what `warp://host:port`
 * means (HTTPS unless `?tls=false`), as in the Hardcharger ADBC driver (`ToWarpURI`).
 * `warp://`, `https://` and `http://` URLs pass through unchanged. The Warp SQL client validates
 * the rest (credentials, other parameters); {@link parseUrl} does both.
 */
export function toWarpUrl(url: string): string {
  refuseForeignSpellings(url);
  const match = /^hardcharger:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/i.exec(url);
  if (!match) return url;
  let authority = match[1]!;
  // The port is the authority's last ":digits", outside an IPv6 literal's brackets and after
  // any user info (which the Warp SQL client refuses). Read from the text: a WHATWG URL parser
  // drops a port that is its scheme's default, so hardcharger://host:443 must not go through
  // one before the port is settled.
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const port = /^(?:\[[^\]]*\]|[^:[\]]*):(\d*)$/.exec(hostPort);
  if (port === null) authority += `:${defaultPort}`;
  else if (port[1] === "") authority += String(defaultPort);

  let tls = true;
  const params = new URLSearchParams(match[3] ?? "");
  if ([...params.keys()].some((key) => key.toLowerCase() === "useencryption")) {
    throw invalidArgument(
      `invalid url ${redact(url)}: useEncryption is not a hardcharger:// parameter (it is a JDBC property): ` +
        "TLS is on unless the url says ?tls=false",
    );
  }
  const value = params.get("tls");
  if (value !== null) {
    const lower = value.toLowerCase();
    if (lower === "false" || lower === "0") tls = false;
    else if (lower !== "true" && lower !== "1") {
      throw invalidArgument(`invalid url ${redact(url)}: tls must be true or false, not ${JSON.stringify(lower)}`);
    }
    params.delete("tls");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return `${tls ? "https" : "http"}://${authority}${match[2]!}${query}${match[4] ?? ""}`;
}

/**
 * Parses a connection URL into the Warp SQL base URL it stands for, e.g.
 * `hardcharger://db.example.com` to `https://db.example.com:31337/warp`.
 *
 *     hardcharger://host                     HTTPS to host:31337
 *     hardcharger://host:port                HTTPS to another port
 *     hardcharger://host?tls=false           plain HTTP (development, loopback)
 *     hardcharger://host:port/custom/prefix  the server mounts Warp SQL under /custom/prefix
 *     warp://…, https://…, http://…          the Warp SQL client's own spellings, as they are
 *
 * Refuses, with an `invalid_argument` error: `hardcharger+http://` and other `hardcharger+…`
 * schemes (plain HTTP is `?tls=false`), JDBC URLs, credentials in the URL, unknown
 * parameters, and anything without a host.
 */
export function parseUrl(url: string): URL {
  if (typeof url !== "string" || url === "") throw invalidArgument("a url is required, e.g. hardcharger://host:31337");
  const warpUrl = toWarpUrl(url);
  try {
    return parseWarpUrl(warpUrl, schemes);
  } catch (err) {
    throw rebrand(err, url, warpUrl);
  }
}

/** The schemes the Warp SQL client is asked to accept: its own (a `hardcharger://` URL reaches it as `https://` or `http://`). */
const schemes: SchemeMap = defaultSchemes;

/** Refusals the Warp SQL client would phrase without naming the Hardcharger spelling. */
export function refuseForeignSpellings(url: unknown): void {
  if (typeof url !== "string") return;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  if (!match) return;
  const name = match[1]!.toLowerCase();
  if (name.startsWith(`${scheme}+`)) {
    throw invalidArgument(
      `${match[1]!}:// is not a Hardcharger URI scheme: use hardcharger://host:port for HTTPS, ` +
        `or hardcharger://host:port?tls=false for plain HTTP`,
    );
  }
  if (name === "jdbc") {
    throw invalidArgument(
      "a JDBC URL is not a Hardcharger URI: drop the jdbc: prefix (hardcharger://host:port), " +
        "and use ?tls=false instead of useEncryption=false",
    );
  }
}

/**
 * The Warp SQL client's own refusal, in Hardcharger's words: the URL as given (not its warp://
 * translation), and hardcharger:// among the schemes.
 */
function rebrand(err: unknown, url: string, warpUrl: string): unknown {
  if (!(err instanceof WarpSqlError) || err.code !== ErrorCode.invalidArgument) return err;
  let message = err.message;
  if (warpUrl !== url) message = message.split(redact(warpUrl)).join(redact(url));
  message = message
    .replace("e.g. warp://host:port", "e.g. hardcharger://host:31337")
    .replace("the scheme must be one of ", "the scheme must be one of hardcharger://, ");
  return err.with({ message: `[hardcharger] ${message}` });
}

/** The URL without its user info, as the Warp SQL client shows it in messages. */
function redact(url: string): string {
  return url.replace(/\/\/[^/@?#]*@/, "//***@");
}

export function invalidArgument(message: string): WarpSqlError {
  return new WarpSqlError({ code: ErrorCode.invalidArgument, message: `[hardcharger] ${message}` });
}
