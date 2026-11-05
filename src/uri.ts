// Licensed under the Apache License, Version 2.0.

import {
  ErrorCode,
  type SchemeMap,
  ChargewireError,
  defaultSchemes,
  parseUrl as parseChargewireUrl,
} from "@gizmodata/chargewire";

/** Hardcharger's URI scheme: `hardcharger://host[:port]` means exactly `chargewire://host:port`. */
export const scheme = "hardcharger";

/** Hardcharger's Chargewire port, used when a `hardcharger://` URI names none (`chargewire://` defaults to 443). */
export const defaultPort = 31337;

/**
 * The port a `hardcharger://` URI without one gets for a GizmoData Cloud host
 * ({@link isGizmodataCloudHost}): its clusters answer at `<host>:443`.
 */
export const gizmodataCloudPort = 443;

/**
 * Whether `host` is a GizmoData Cloud host: `gizmodata.com` or a name under it, in any case, with
 * a trailing dot allowed. Only whole labels match: `evilgizmodata.com` and
 * `gizmodata.com.example.org` are not.
 */
export function isGizmodataCloudHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/u, "");
  return name === "gizmodata.com" || name.endsWith(".gizmodata.com");
}

/**
 * The schemes `connect` accepts: `hardcharger://` (TLS unless `?tls=false`, port 31337 unless
 * the URL names one) and the Chargewire client's own `chargewire://`, `https://` and `http://`, as they
 * are. The Chargewire client does the parsing.
 */
export const schemes: SchemeMap = Object.freeze({
  [scheme]: { tls: true, tlsParameter: true, defaultPort },
  ...defaultSchemes,
});

/**
 * Parses a connection URL into the Chargewire base URL it stands for, e.g.
 * `hardcharger://db.example.com` to `https://db.example.com:31337/chargewire`.
 *
 *     hardcharger://host                     HTTPS to host:31337 (host:443 for a GizmoData Cloud host)
 *     hardcharger://host:port                HTTPS to another port
 *     hardcharger://host?tls=false           plain HTTP (development, loopback)
 *     hardcharger://host:port/custom/prefix  the server mounts Chargewire under /custom/prefix
 *     chargewire://…, https://…, http://…          the Chargewire client's own spellings, as they are
 *
 * Refuses, with a `client_invalid_argument` error: `hardcharger+http://` and other `hardcharger+…`
 * schemes (plain HTTP is `?tls=false`), JDBC URLs, `useEncryption`, credentials in the URL,
 * unknown parameters, and anything without a host.
 */
export function parseUrl(url: string): URL {
  refuseForeignSpellings(url);
  try {
    return parseChargewireUrl(url, schemesFor(url));
  } catch (err) {
    throw rebrand(err);
  }
}

/**
 * The schemes for `url`: {@link schemes}, except that a `hardcharger://` URI naming no port and a
 * GizmoData Cloud host defaults to port 443 ({@link gizmodataCloudPort}) instead of 31337. An
 * explicit port always wins.
 */
export function schemesFor(url: unknown): SchemeMap {
  if (typeof url !== "string" || !/^hardcharger:\/\//iu.test(url.trim())) return schemes;
  let parsed: URL;
  try {
    // hardcharger: is not a special scheme, so the URL keeps the port exactly as written.
    parsed = new URL(url.trim());
  } catch {
    return schemes; // the Chargewire client's parser reports it
  }
  if (parsed.port !== "" || !isGizmodataCloudHost(parsed.hostname)) return schemes;
  return { ...schemes, [scheme]: { ...schemes[scheme]!, defaultPort: gizmodataCloudPort } };
}

/** Refusals the Chargewire client would phrase without naming the Hardcharger spelling. */
function refuseForeignSpellings(url: unknown): void {
  if (typeof url !== "string") return;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  if (!match) return;
  const name = match[1]!.toLowerCase();
  if (name.startsWith(`${scheme}+`)) {
    throw clientInvalidArgument(
      `${match[1]!}:// is not a Hardcharger URI scheme: use hardcharger://host:port for HTTPS, ` +
        `or hardcharger://host:port?tls=false for plain HTTP`,
    );
  }
  if (name === "jdbc") {
    throw clientInvalidArgument(
      "a JDBC URL is not a Hardcharger URI: drop the jdbc: prefix (hardcharger://host:port), " +
        "and use ?tls=false instead of useEncryption=false",
    );
  }
  if (name === scheme && /[?&]useencryption=/i.test(url)) {
    throw clientInvalidArgument(
      `invalid url ${redact(url)}: useEncryption is not a hardcharger:// parameter (it is a JDBC property): ` +
        "TLS is on unless the url says ?tls=false",
    );
  }
}

/** The Chargewire client's own refusal, with Hardcharger's prefix and example on its message. */
function rebrand(err: unknown): unknown {
  if (!(err instanceof ChargewireError) || err.code !== ErrorCode.clientInvalidArgument) return err;
  const message = err.message.replace("e.g. chargewire://host:port", "e.g. hardcharger://host:31337");
  return err.with({ message: `[hardcharger] ${message}` });
}

/** The URL without its user info, as the Chargewire client shows it in messages. */
function redact(url: string): string {
  return url.replace(/\/\/[^/@?#]*@/, "//***@");
}

export function clientInvalidArgument(message: string): ChargewireError {
  return new ChargewireError({ code: ErrorCode.clientInvalidArgument, message: `[hardcharger] ${message}` });
}
