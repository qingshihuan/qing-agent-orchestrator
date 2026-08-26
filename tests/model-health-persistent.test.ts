import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { candidateFingerprint, ModelHealthChecker } from "../src/model-health.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";
import type { ModelCandidate } from "../src/types.js";

class VersionOnlyRunner implements ProcessRunner {
  calls: string[][] = [];
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request.args);
    if (request.args.length === 1 && request.args[0] === "--version") {
      return { exitCode: 0, signal: null, stdout: "codex-cli 9.9.9\n", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null };
    }
    throw new Error(`Persistent cache miss unexpectedly invoked: ${request.args.join(" ")}`);
  }
}

const candidate: ModelCandidate = {
  id: "cli-cache-fixture",
  backend: "codex-cli",
  model: "gpt-5.6-luna",
  profile: null,
  reasoningEffort: "medium",
  availability: "entitlement-dependent",
  roles: ["executor"],
  routes: ["codex"],
  categories: ["code_change"],
  complexityBands: ["normal"],
  tags: [],
  priority: 100,
  enabled: true,
  fallbacks: [],
};

test("model health cache is reused across checker instances without a model probe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  const cachePath = join(directory, "health.json");
  const fingerprint = candidateFingerprint(candidate, "codex-cli 9.9.9");
  await writeFile(cachePath, JSON.stringify({ version: "1.0", records: [{
    candidateId: candidate.id,
    fingerprint,
    cliVersion: "codex-cli 9.9.9",
    state: "healthy",
    cacheState: "fresh",
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    failure: null,
    reason: "fixture",
  }] }), "utf8");
  try {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const runner = new VersionOnlyRunner();
      const checker = new ModelHealthChecker({ command: "codex", cwd: directory, schemaPath: join(directory, "schema.json"), timeoutMs: 5_000, ttlMs: 60_000, cachePath }, runner);
      const result = await checker.check(candidate);
      assert.equal(result.state, "healthy");
      assert.equal(result.cacheState, "cached");
      assert.deepEqual(runner.calls, [["--version"]]);
    }
    const persisted = JSON.parse(await readFile(cachePath, "utf8")) as { version: string };
    assert.equal(persisted.version, "1.0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
