// Starts hardcharger-server allowing the test page's origin, and hands its address to the
// tests through the environment.
import { launchServer } from "../live/harness.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = Number(process.env["HARDCHARGER_JS_TEST_PAGE_PORT"] ?? 5174);
  const server = await launchServer({ args: ["--cors-origins", `http://127.0.0.1:${port}`] });
  process.env["HARDCHARGER_JS_TEST_BROWSER_SERVER"] = JSON.stringify({ url: server.url, password: server.password });
  return () => server.stop();
}
