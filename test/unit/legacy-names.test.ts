// Licensed under the Apache License, Version 2.0.
//
// What still works from before the protocol's rename (src/legacy-names.ts): the old exported
// names, and URLs written with the old scheme or base path, which the Chargewire client maps
// to the current ones and, at the default base path, falls back on for a pre-rename server.
// No server: a fetch that records each request.

import * as chargewire from "@gizmodata/chargewire";
import { describe, expect, test } from "vitest";

import * as hardcharger from "../../src/index.js";
import {
  ErrorCode,
  HardchargerError,
  type WarpSqlErrorInit,
  WarpSqlError,
  connect,
  parseUrl,
} from "../../src/index.js";

describe("the old exported names", () => {
  test("WarpSqlError is the current error class", () => {
    expect(hardcharger.WarpSqlError).toBe(chargewire.ChargewireError);
    expect(WarpSqlError).toBe(HardchargerError);
    const init: WarpSqlErrorInit = { code: ErrorCode.clientInvalidArgument, message: "m" };
    const err: WarpSqlError = new WarpSqlError(init);
    expect(err).toBeInstanceOf(HardchargerError);
    expect(WarpSqlError.is(err, ErrorCode.clientInvalidArgument)).toBe(true);
  });

  test("an error the client raises is a WarpSqlError", () => {
    let caught: unknown;
    try {
      parseUrl("hardcharger+http://h");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WarpSqlError);
  });
});

describe("URLs from before the rename", () => {
  test.each([
    ["warp://db.example.com", "https://db.example.com/chargewire"],
    ["warp://db.example.com:31337?tls=false", "http://db.example.com:31337/chargewire"],
    ["https://db.example.com:31337/warp", "https://db.example.com:31337/chargewire"],
    ["http://127.0.0.1:31337/warp/", "http://127.0.0.1:31337/chargewire"],
    ["hardcharger://db.example.com/warp", "https://db.example.com:31337/chargewire"],
    ["hardcharger://db.example.com:8443/warp?tls=false", "http://db.example.com:8443/chargewire"],
    // A custom base path is kept as it is, even one that ends in the old name.
    ["hardcharger://db.example.com/custom/warp", "https://db.example.com:31337/custom/warp"],
  ])("%s stands for %s", (url, base) => {
    expect(parseUrl(url).href).toBe(base);
  });

  // A pre-rename server answers 404 at /chargewire: the client then asks /warp. The fake
  // fails that request too (so the first answer is the error), which is enough to see that
  // this package's schemes and refusals leave the fallback alone.
  test.each([
    ["hardcharger://db.example.com?tls=false", "http://db.example.com:31337"],
    ["warp://db.example.com:31337?tls=false", "http://db.example.com:31337"],
    ["https://db.example.com:31337/warp", "https://db.example.com:31337"],
  ])("%s falls back to /warp when /chargewire is not there", async (url, origin) => {
    const seen: string[] = [];
    const oldServer: typeof fetch = (input) => {
      const href = input instanceof Request ? input.url : String(input);
      seen.push(href);
      if (new URL(href).pathname === "/chargewire") return Promise.resolve(new Response("not found", { status: 404 }));
      return Promise.reject(new TypeError("fetch failed"));
    };
    try {
      await connect({ url, username: "u", password: "p", fetch: oldServer, maxAttempts: 1 });
      throw new Error("connected");
    } catch (err) {
      expect(HardchargerError.is(err, ErrorCode.clientProtocolError)).toBe(true);
    }
    expect(seen.slice(0, 2)).toEqual([`${origin}/chargewire`, `${origin}/warp`]);
  });
});
