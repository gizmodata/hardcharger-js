// Unit tests: no server, no network.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/unit/**/*.test.ts"], passWithNoTests: false },
});
