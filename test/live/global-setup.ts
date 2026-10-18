// Licensed under the Apache License, Version 2.0.
//
// The live suites never skip: without HARDCHARGER_JS_TEST_SERVER_BINARY (or with one that
// doesn't run) the run fails here, and a run in which no test reached a server fails too.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestProject } from "vitest/node";

import { binaryEnv } from "./harness.js";

declare module "vitest" {
  export interface ProvidedContext {
    counterFile: string;
  }
}

export default function setup(project: TestProject): () => void {
  const binary = process.env[binaryEnv];
  if (binary === undefined || binary === "") {
    throw new Error(`FAIL: set ${binaryEnv} to a hardcharger-server binary; the live tests never skip`);
  }
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", env: { PATH: process.env.PATH } }).trim();
  console.log(`live tests against ${version} (${binary})`);
  const dir = mkdtempSync(join(tmpdir(), "hardcharger-js-live-"));
  const counterFile = join(dir, "reached");
  writeFileSync(counterFile, "");
  project.provide("counterFile", counterFile);
  return () => {
    const reachedCount = readFileSync(counterFile, "utf8").length;
    rmSync(dir, { recursive: true, force: true });
    if (reachedCount === 0) throw new Error("FAIL: no live test reached a server");
  };
}
