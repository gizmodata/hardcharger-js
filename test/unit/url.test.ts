// Licensed under the Apache License, Version 2.0.
//
// hardcharger:// URLs: every form the Hardcharger ADBC driver accepts (hardcharger-adbc's
// go/hardcharger/uri.go and README), each turned into the Warp SQL base URL it stands for,
// and the spellings it refuses, with their messages.

import { describe, expect, test } from "vitest";

import { ErrorCode, HardchargerError, defaultPort, parseUrl, schemes } from "../../src/index.js";

describe("accepted URLs", () => {
  test.each([
    ["hardcharger://db.example.com", "https://db.example.com:31337/warp"],
    // An explicit port is kept even when it is HTTPS's default.
    ["hardcharger://db.example.com:443", "https://db.example.com/warp"],
    ["hardcharger://db.example.com:443?tls=false", "http://db.example.com:443/warp"],
    ["hardcharger://[::1]:443?tls=false", "http://[::1]:443/warp"],
    ["hardcharger://db.example.com:80?tls=false", "http://db.example.com/warp"],
    ["hardcharger://db.example.com:", "https://db.example.com:31337/warp"],
    ["hardcharger://db.example.com:8443", "https://db.example.com:8443/warp"],
    ["hardcharger://localhost?tls=false", "http://localhost:31337/warp"],
    ["hardcharger://127.0.0.1:4000?tls=false", "http://127.0.0.1:4000/warp"],
    ["hardcharger://127.0.0.1?tls=0", "http://127.0.0.1:31337/warp"],
    ["hardcharger://127.0.0.1?tls=FALSE", "http://127.0.0.1:31337/warp"],
    ["hardcharger://127.0.0.1?tls=true", "https://127.0.0.1:31337/warp"],
    ["hardcharger://127.0.0.1?tls=1", "https://127.0.0.1:31337/warp"],
    ["hardcharger://db.example.com/", "https://db.example.com:31337/warp"],
    ["hardcharger://db.example.com:31337/custom/prefix", "https://db.example.com:31337/custom/prefix"],
    ["hardcharger://db.example.com/custom/prefix/?tls=false", "http://db.example.com:31337/custom/prefix"],
    ["HARDCHARGER://DB.Example.COM", "https://db.example.com:31337/warp"],
    ["Hardcharger://db.example.com", "https://db.example.com:31337/warp"],
    ["hardcharger://[::1]", "https://[::1]:31337/warp"],
    ["hardcharger://[::1]:4000?tls=false", "http://[::1]:4000/warp"],
    // The Warp SQL client's own spellings pass through as they are, with their own defaults.
    ["warp://db.example.com:31337", "https://db.example.com:31337/warp"],
    ["warp://db.example.com", "https://db.example.com/warp"],
    ["warp://127.0.0.1:31337?tls=false", "http://127.0.0.1:31337/warp"],
    ["https://db.example.com:31337", "https://db.example.com:31337/warp"],
    ["http://127.0.0.1:31337/custom", "http://127.0.0.1:31337/custom"],
  ])("%s -> %s", (url, base) => {
    expect(parseUrl(url).href).toBe(base);
  });

  test("schemes: hardcharger:// first, then the Warp SQL client's", () => {
    expect(Object.keys(schemes)).toEqual(["hardcharger", "warp", "https", "http"]);
    expect(schemes.hardcharger).toEqual({ tls: true, tlsParameter: true, defaultPort: 31337 });
    expect(Object.isFrozen(schemes)).toBe(true);
  });

  test("the default port is Hardcharger's", () => {
    expect(defaultPort).toBe(31337);
    expect(new URL(parseUrl("hardcharger://h").href).port).toBe(String(defaultPort));
  });
});

/** The client_invalid_argument error parseUrl throws for this URL. */
function refusal(url: unknown): HardchargerError {
  try {
    parseUrl(url as string);
  } catch (err) {
    expect(err).toBeInstanceOf(HardchargerError);
    expect((err as HardchargerError).code).toBe(ErrorCode.clientInvalidArgument);
    expect((err as HardchargerError).message.startsWith("[hardcharger] ")).toBe(true);
    return err as HardchargerError;
  }
  throw new Error(`parseUrl accepted ${String(url)}`);
}

describe("refused URLs", () => {
  test.each(["hardcharger+http://db.example.com", "hardcharger+https://db.example.com:31337", "HARDCHARGER+HTTP://h"])(
    "%s: plain HTTP is ?tls=false, not a scheme of its own",
    (url) => {
      const err = refusal(url);
      expect(err.message).toContain("is not a Hardcharger URI scheme");
      expect(err.message).toContain("hardcharger://host:port?tls=false");
    },
  );

  test("a JDBC URL names the hardcharger:// spelling", () => {
    const err = refusal("jdbc:hardcharger://db.example.com:31337?useEncryption=false");
    expect(err.message).toContain("drop the jdbc: prefix");
    expect(err.message).toContain("?tls=false");
  });

  test("credentials in the URL are refused, and not repeated", () => {
    const err = refusal("hardcharger://joe:s3cret-pw@db.example.com");
    expect(err.message).toBe(
      "[hardcharger] invalid url hardcharger://***@db.example.com: credentials do not belong in the url; " +
        "use the username and password options",
    );
    expect(err.message).not.toContain("s3cret-pw");
    expect(refusal("hardcharger://joe@db.example.com").message).toContain("credentials do not belong");
  });

  test("an unknown parameter is refused, by name", () => {
    expect(refusal("hardcharger://db.example.com?tls=false&catalog=x").message).toContain(
      "unknown parameter(s) catalog",
    );
    expect(refusal("hardcharger://db.example.com?username=joe").message).toContain("unknown parameter(s) username");
  });

  test("useEncryption (the JDBC property) is refused, naming ?tls=false", () => {
    for (const url of ["hardcharger://db.example.com?useEncryption=false", "hardcharger://h:1?UseEncryption=true"]) {
      expect(refusal(url).message).toContain(
        "useEncryption is not a hardcharger:// parameter (it is a JDBC property): TLS is on unless the url says ?tls=false",
      );
    }
  });

  test("tls takes true or false", () => {
    expect(refusal("hardcharger://db.example.com?tls=maybe").message).toContain(
      'tls must be true or false, not "maybe"',
    );
    expect(refusal("hardcharger://db.example.com?tls=").message).toContain("tls must be true or false");
  });

  test("a URL needs a host", () => {
    expect(refusal("hardcharger://").message).toMatch(/invalid url|no host/);
    expect(refusal("hardcharger://:31337").message).toMatch(/invalid url|no host/);
  });

  test("a URL needs a scheme the client knows", () => {
    expect(refusal("db.example.com:31337").message).toContain("e.g. hardcharger://host:31337");
    const ftp = refusal("ftp://db.example.com");
    expect(ftp.message).toContain("the scheme must be one of hardcharger://, warp://, https://, http://");
    expect(ftp.message).toContain("ftp://db.example.com");
    expect(refusal("gizmosql://db.example.com").message).toContain("the scheme must be one of hardcharger://");
  });

  test("a port out of range is refused", () => {
    expect(refusal("hardcharger://db.example.com:99999").message).toContain("invalid url");
  });

  test("no URL at all", () => {
    expect(refusal("").message).toContain("a url is required, e.g. hardcharger://host:31337");
    expect(refusal(undefined).message).toContain("a url is required");
  });
});
