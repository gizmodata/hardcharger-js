// Live-server tests: test/live/harness.ts starts hardcharger-server (HARDCHARGER_JS_TEST_SERVER_BINARY)
// for each suite. Without the binary the run fails; a run in which no test reached a server
// fails too (test/live/global-setup.ts). Nothing skips.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live/**/*.test.ts"],
    globalSetup: ["test/live/global-setup.ts"],
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Timing-based tests (cancel) shouldn't compete for the server's threads, and one suite
    // holds port 31337: files run one at a time.
    fileParallelism: false,
  },
});
