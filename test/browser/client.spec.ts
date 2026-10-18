// The built package in a browser, against hardcharger-server over hardcharger://.
import { expect, test } from "@playwright/test";

const server = JSON.parse(process.env["HARDCHARGER_JS_TEST_BROWSER_SERVER"] ?? "null") as {
  url: string;
  password: string;
} | null;
if (server === null) throw new Error("the global setup did not start a server");

type Api = typeof import("../../src/index.js") & { tableFromArrays: typeof import("apache-arrow").tableFromArrays };

test.beforeEach(async ({ page }) => {
  page.on("request", (request) => expect(request.url()).not.toContain(server.password));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("ready");
});

test("signs in, queries with parameters, streams a split result, ingests and cancels", async ({ page }) => {
  const result = await page.evaluate(
    async ({ url, password }) => {
      const { connect, HardchargerError, tableFromArrays } = (globalThis as unknown as { hardcharger: Api })
        .hardcharger;
      const conn = await connect({ url, username: "hardcharger_js_test", password });
      const user = String((await conn.query("SELECT HARDCHARGER_USER() AS u")).getChild("u")!.get(0));
      const greeting = String((await conn.query("SELECT ?::VARCHAR AS g", ["hello"])).getChild("g")!.get(0));
      let rows = 0;
      const stream = conn.stream("SELECT i FROM range(1000000) t(i) ORDER BY i DESC");
      for await (const batch of stream) rows += batch.numRows;
      const partitions = await stream.partitions();
      const ingested = await conn.ingest("browser_t", tableFromArrays({ v: Int32Array.from([1, 2, 3]) }), {
        mode: "replace",
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 500);
      let cancelCode = "";
      try {
        await conn.query("SELECT count(*) FROM range(1000000000000)", undefined, { signal: controller.signal });
      } catch (err) {
        cancelCode = err instanceof HardchargerError ? err.code : String(err);
      }
      let sqlCode = "";
      try {
        await conn.query("SELEC 1");
      } catch (err) {
        sqlCode = HardchargerError.is(err) ? `${err.code} ${err.status}` : String(err);
      }
      const after = Number((await conn.query("SELECT 42 AS v")).getChild("v")!.get(0));
      await conn.close();
      let wrongPassword = "";
      try {
        await connect({ url, username: "hardcharger_js_test", password: "wrong" });
      } catch (err) {
        wrongPassword = HardchargerError.is(err) ? err.code : String(err);
      }
      return { user, greeting, rows, partitions, ingested, cancelCode, sqlCode, after, wrongPassword };
    },
    { url: server.url, password: server.password },
  );
  const { partitions, ...rest } = result;
  expect(rest).toEqual({
    user: "hardcharger_js_test",
    greeting: "hello",
    rows: 1_000_000,
    ingested: 3,
    cancelCode: "statement_cancelled",
    sqlCode: "sql_error 400",
    after: 42,
    wrongPassword: "invalid_credentials",
  });
  expect(partitions).toBeGreaterThan(1);
});

test("a hardcharger+http:// URL is refused in the browser too", async ({ page }) => {
  const message = await page.evaluate(async () => {
    const { connect } = (globalThis as unknown as { hardcharger: Api }).hardcharger;
    try {
      await connect({ url: "hardcharger+http://127.0.0.1", username: "u", password: "p" });
      return "connected";
    } catch (err) {
      return `${(err as { code: string }).code}: ${(err as Error).message}`;
    }
  });
  expect(message).toContain("invalid_argument: [hardcharger] hardcharger+http:// is not a Hardcharger URI scheme");
});
