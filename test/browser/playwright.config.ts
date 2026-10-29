// The built package in Chromium and WebKit: test/browser/serve.mjs bundles dist/index.mjs
// with esbuild for the browser (which picks @gizmodata/chargewire's browser build through its
// export conditions) and serves it on a page; global-setup.ts starts hardcharger-server
// (HARDCHARGER_JS_TEST_SERVER_BINARY) allowing that page's origin. Without the binary the run
// fails; it never skips. Needs `npm run build` first.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["HARDCHARGER_JS_TEST_PAGE_PORT"] ?? 5174);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node test/browser/serve.mjs",
    cwd: "../..",
    url: `http://127.0.0.1:${port}`,
    env: { HARDCHARGER_JS_TEST_PAGE_PORT: String(port) },
    reuseExistingServer: false,
  },
});
