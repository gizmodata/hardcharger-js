// Licensed under the Apache License, Version 2.0.

import { ErrorCode, type SchemeMap, WarpSqlError, defaultSchemes, parseUrl as parseWarpUrl } from "@gizmodata/warp-sql";

/** Hardcharger's URI scheme: `hardcharger://host[:port]` means exactly `warp://host:port`. */
export const scheme = "hardcharger";

/** Hardcharger's Warp SQL port, used when a `hardcharger://` URI names none (`warp://` defaults to 443). */
export const defaultPort = 31337;

/**
 * The schemes `connect` accepts: `hardcharger://` (TLS unless `?tls=false`, port 31337 unless
 * the URL names one) and the Warp SQL client's own `warp://`, `https://` and `http://`, as they
 * are. The Warp SQL client does the parsing.
 */
export const schemes: SchemeMap = Object.freeze({
  [scheme]: { tls: true, tlsParameter: true, defaultPort },
  ...defaultSchemes,
});

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
 * schemes (plain HTTP is `?tls=false`), JDBC URLs, `useEncryption`, credentials in the URL,
 * unknown parameters, and anything without a host.
 */
export function parseUrl(url: string): URL {
  refuseForeignSpellings(url);
  try {
    return parseWarpUrl(url, schemes);
  } catch (err) {
    throw rebrand(err);
  }
}

/** Refusals the Warp SQL client would phrase without naming the Hardcharger spelling. */
function refuseForeignSpellings(url: unknown): void {
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
  if (name === scheme && /[?&]useencryption=/i.test(url)) {
    throw invalidArgument(
      `invalid url ${redact(url)}: useEncryption is not a hardcharger:// parameter (it is a JDBC property): ` +
        "TLS is on unless the url says ?tls=false",
    );
  }
}

/** The Warp SQL client's own refusal, with Hardcharger's prefix and example on its message. */
function rebrand(err: unknown): unknown {
  if (!(err instanceof WarpSqlError) || err.code !== ErrorCode.invalidArgument) return err;
  const message = err.message.replace("e.g. warp://host:port", "e.g. hardcharger://host:31337");
  return err.with({ message: `[hardcharger] ${message}` });
}

/** The URL without its user info, as the Warp SQL client shows it in messages. */
function redact(url: string): string {
  return url.replace(/\/\/[^/@?#]*@/, "//***@");
}

export function invalidArgument(message: string): WarpSqlError {
  return new WarpSqlError({ code: ErrorCode.invalidArgument, message: `[hardcharger] ${message}` });
}
