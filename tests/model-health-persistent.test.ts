import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { candidateFingerprint, ModelHealthChecker, type ModelHealthRecord } from "../src/model-health.js";
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

const cacheOptions = (directory: string) => ({
  command: "fake-codex", cwd: directory, schemaPath: join(directory, "schema.json"),
  timeoutMs: 5_000, ttlMs: 60_000, cachePath: join(directory, "health.json"),
});

function cachedRecord(overrides: Partial<ModelHealthRecord> = {}): ModelHealthRecord {
  return {
    candidateId: candidate.id, fingerprint: candidateFingerprint(candidate, "codex-cli 9.9.9"),
    cliVersion: "codex-cli 9.9.9", state: "healthy", cacheState: "fresh",
    checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    failure: null, reason: "fixture", ...overrides,
  };
}

class CacheProbeRunner implements ProcessRunner {
  readonly calls: string[][] = [];
  failVersionOnce = false;
  failCatalogOnce = false;
  cancelledStage: "--version" | "debug" | "exec" | null = null;
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request.args);
    const result: ProcessResult = {
      exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false,
      outputLimitExceeded: false, spawnError: null,
      cancelled: request.args[0] === this.cancelledStage,
    };
    if (request.args[0] === "--version") {
      if (this.failVersionOnce) { this.failVersionOnce = false; return { ...result, exitCode: 1 }; }
      return { ...result, stdout: "codex-cli 9.9.9\n" };
    }
    if (request.args[0] === "debug") {
      if (this.failCatalogOnce) { this.failCatalogOnce = false; return { ...result, exitCode: 1 }; }
      return { ...result, stdout: JSON.stringify({ models: [{
        slug: candidate.model, minimal_client_version: "0.144.0",
        supported_reasoning_levels: [{ effort: "medium" }],
      }] }) };
    }
    assert.equal(request.args[0], "exec");
    assert.equal(request.args[request.args.indexOf("--sandbox") + 1], "read-only");
    await writeFile(request.args[request.args.indexOf("--output-last-message") + 1]!,
      JSON.stringify({ status: "ok", capabilities: ["planner", "executor", "reviewer"] }), "utf8");
    return { ...result, stdout: '{"type":"turn.completed"}\n' };
  }
}

test("concurrent first checks all await the persistent cache without extra probes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const options = cacheOptions(directory);
    await writeFile(options.cachePath, JSON.stringify({ version: "1.0", records: [cachedRecord()] }));
    const runner = new VersionOnlyRunner();
    const checker = new ModelHealthChecker(options, runner);
    const results = await Promise.all(Array.from({ length: 16 }, () => checker.check(candidate)));
    assert.ok(results.every(({ state, cacheState }) => state === "healthy" && cacheState === "cached"));
    assert.deepEqual(runner.calls, [["--version"]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("equivalent candidate aliases share a probe but keep their own audit identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const runner = new CacheProbeRunner();
    const checker = new ModelHealthChecker(cacheOptions(directory), runner);
    const alias = { ...candidate, id: "another-id" };
    const results = await Promise.all([checker.check(candidate), checker.check(alias)]);
    assert.deepEqual(results.map(({ candidateId }) => candidateId), [candidate.id, alias.id]);
    assert.equal((await checker.check(alias)).candidateId, alias.id);
    assert.equal(checker.status(alias).candidateId, alias.id);
    assert.equal(checker.status(alias).state, "healthy");
    assert.equal(runner.calls.filter(([command]) => command === "exec").length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("status does not reuse health after a candidate is disabled or reconfigured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const checker = new ModelHealthChecker(cacheOptions(directory), new CacheProbeRunner());
    await checker.check(candidate);
    assert.equal(checker.status({ ...candidate, enabled: false }).state, "unverified");
    for (const changed of [
      { ...candidate, model: "another-model" }, { ...candidate, profile: "another-profile" },
      { ...candidate, reasoningEffort: "high" as const }, { ...candidate, roles: ["reviewer" as const] },
    ]) assert.equal(checker.status(changed).state, "unverified");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cache write failure preserves the real probe result and in-memory reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const options = cacheOptions(directory);
    // A directory where a file should be is a portable replacement failure.
    await mkdir(options.cachePath);
    const runner = new CacheProbeRunner();
    const checker = new ModelHealthChecker(options, runner);
    assert.equal((await checker.check(candidate)).state, "healthy");
    assert.equal((await checker.check(candidate)).cacheState, "cached");
    assert.equal(runner.calls.filter(([command]) => command === "exec").length, 1);
    assert.ok((await readdir(directory)).every((name) => !name.endsWith(".tmp")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent distinct probes persist a complete snapshot without temporary collisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const options = cacheOptions(directory);
    const checker = new ModelHealthChecker(options, new CacheProbeRunner());
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...candidate, id: `candidate-${index}`, profile: `profile-${index}`,
    }));
    const results = await Promise.all(candidates.map((item) => checker.check(item)));
    assert.ok(results.every(({ state }) => state === "healthy"));
    const stored = JSON.parse(await readFile(options.cachePath, "utf8")) as { records: ModelHealthRecord[] };
    assert.equal(stored.records.length, candidates.length);
    assert.equal(new Set(stored.records.map(({ fingerprint }) => fingerprint)).size, candidates.length);
    assert.ok((await readdir(directory)).every((name) => !name.endsWith(".tmp")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed version discovery can recover on a later explicit check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const runner = new CacheProbeRunner();
    runner.failVersionOnce = true;
    const checker = new ModelHealthChecker(cacheOptions(directory), runner);
    await assert.rejects(checker.check(candidate));
    assert.equal(runner.calls.length, 1); // no hidden retry
    assert.equal((await checker.check(candidate)).state, "healthy");
    assert.equal(runner.calls.filter(([command]) => command === "--version").length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed catalog discovery can recover after its negative cache expires", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    let now = Date.now();
    const runner = new CacheProbeRunner();
    runner.failCatalogOnce = true;
    const checker = new ModelHealthChecker({ ...cacheOptions(directory), now: () => now }, runner);
    assert.equal((await checker.check(candidate)).state, "unhealthy");
    assert.equal((await checker.check(candidate)).cacheState, "cached");
    assert.equal(runner.calls.filter(([command]) => command === "exec").length, 0);
    now += 60_001;
    assert.equal((await checker.check(candidate)).state, "healthy");
    assert.equal(runner.calls.filter(([command]) => command === "debug").length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancellation cannot become healthy evidence even with exit code zero", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    for (const stage of ["--version", "debug", "exec"] as const) {
      const runner = new CacheProbeRunner();
      runner.cancelledStage = stage;
      const checker = new ModelHealthChecker({ ...cacheOptions(directory), cachePath: join(directory, stage + ".json") }, runner);
      if (stage === "--version") await assert.rejects(checker.check(candidate));
      else assert.equal((await checker.check(candidate)).state, "unhealthy", stage);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("malformed persistent health records are ignored and re-probed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  try {
    const options = cacheOptions(directory);
    for (const overrides of [
      { state: "unexpected" }, { failure: "process" }, { checkedAt: "invalid" },
      { cliVersion: null }, { expiresAt: "2000-01-01T00:00:00Z" },
    ]) {
      await writeFile(options.cachePath, JSON.stringify({ version: "1.0", records: [{ ...cachedRecord(), ...overrides }] }));
      const runner = new CacheProbeRunner();
      const result = await new ModelHealthChecker(options, runner).check(candidate);
      assert.equal(result.state, "healthy");
      assert.equal(result.cacheState, "fresh");
      assert.equal(runner.calls.filter(([command]) => command === "exec").length, 1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("explicit force refresh bypasses health cache once and persists the new result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-force-health-"));
  try {
    const runner = new CacheProbeRunner();
    const checker = new ModelHealthChecker(cacheOptions(directory), runner);
    assert.equal((await checker.check(candidate)).state, "healthy");
    assert.equal((await checker.check(candidate)).cacheState, "cached");
    assert.equal(runner.calls.filter(args => args[0] === "exec").length, 1);
    assert.equal((await checker.check(candidate, true)).state, "healthy");
    assert.equal(runner.calls.filter(args => args[0] === "exec").length, 2);
    const cachedRunner = new VersionOnlyRunner();
    assert.equal((await new ModelHealthChecker(cacheOptions(directory), cachedRunner).check(candidate)).state, "healthy");
    assert.deepEqual(cachedRunner.calls, [["--version"]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
