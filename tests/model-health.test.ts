import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { ModelHealthChecker, modelSelectionArgs } from "../src/model-health.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";
import type { ModelCandidate } from "../src/types.js";

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, ...overrides };
}

const candidate: ModelCandidate = {
  id: "primary", backend: "codex-cli", model: "gpt-5.6-sol", profile: "work", reasoningEffort: "high", availability: "entitlement-dependent", roles: ["planner", "executor"],
  routes: ["codex"], categories: ["code_change"], complexityBands: ["complex"], tags: [], priority: 1, enabled: true, fallbacks: [],
};

class HealthRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly mode: "ok" | "timeout" | "auth" | "long-process" | "jsonl" | "schema" = "ok") {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    if (request.args[0] === "--version") return result({ stdout: "codex 1.2.3\n" });
    if (this.mode === "timeout") return result({ exitCode: null, timedOut: true });
    if (this.mode === "auth") return result({ exitCode: 1, stderr: "401 OPENAI_API_KEY=secret-value" });
    if (this.mode === "long-process") return result({
      exitCode: 37,
      spawnError: "launcher wrapper reported a child failure",
      stderr: "secondary diagnostic stream",
      stdout: `${"PowerShell warning line\n".repeat(80)}FINAL ACTIONABLE ERROR: model alias rejected OPENAI_API_KEY=tail-secret`,
    });
    const output = request.args[request.args.indexOf("--output-last-message") + 1]!;
    await writeFile(output, this.mode === "schema" ? JSON.stringify({ status: "wrong", capabilities: [] }) : JSON.stringify({ status: "ok", capabilities: ["planner", "executor", "reviewer"] }), "utf8");
    return result({ stdout: this.mode === "jsonl" ? "not-json\n" : '{"type":"turn.completed"}\n' });
  }
}

const options = { command: "fake-codex", cwd: process.cwd(), schemaPath: "schemas/model-health.schema.json", timeoutMs: 2_000, ttlMs: 10_000 };

test("preflight uses shell-free argument boundaries and passes model/profile/reasoning safely", async () => {
  const runner = new HealthRunner();
  const checker = new ModelHealthChecker(options, runner);
  const record = await checker.check(candidate);
  assert.equal(record.state, "healthy");
  const probe = runner.requests[1]!;
  assert.equal(probe.command, "fake-codex");
  assert.deepEqual(probe.args.slice(probe.args.indexOf("-m"), probe.args.indexOf("-m") + 7), ["-m", "gpt-5.6-sol", "--profile", "work", "-c", 'model_reasoning_effort="high"', "--ephemeral"]);
  assert.equal(probe.args.includes("--sandbox"), true);
  assert.equal(probe.args[probe.args.indexOf("--sandbox") + 1], "read-only");
});

test("preflight caches by CLI version and candidate fingerprint and deduplicates concurrency", async () => {
  const runner = new HealthRunner();
  const checker = new ModelHealthChecker(options, runner);
  const [first, second] = await Promise.all([checker.check(candidate), checker.check(candidate)]);
  assert.equal(first.state, "healthy"); assert.equal(second.state, "healthy");
  assert.equal(runner.requests.filter(({ args }) => args[0] === "exec").length, 1);
  const third = await checker.check(candidate);
  assert.equal(third.cacheState, "cached");
  assert.equal(runner.requests.filter(({ args }) => args[0] === "exec").length, 1);
});

test("timeout, authentication, JSONL, and schema failures are fail closed and redacted", async () => {
  const cases = [["timeout", "timeout"], ["auth", "authentication"], ["jsonl", "jsonl"], ["schema", "schema"]] as const;
  for (const [mode, expected] of cases) {
    const record = await new ModelHealthChecker(options, new HealthRunner(mode)).check(candidate);
    assert.equal(record.state, "unhealthy"); assert.equal(record.failure, expected);
    assert.match(record.reason, /exit=(?:null|\d+)/);
    assert.doesNotMatch(record.reason, /secret-value/);
  }
});

test("long process diagnostics include exit status, every stream, a bounded head and actionable redacted tail", async () => {
  const record = await new ModelHealthChecker(options, new HealthRunner("long-process")).check(candidate);
  assert.equal(record.failure, "process");
  assert.match(record.reason, /exit=37/);
  assert.match(record.reason, /\[spawnError\].*launcher wrapper/s);
  assert.match(record.reason, /\[stderr\].*secondary diagnostic/s);
  assert.match(record.reason, /\[stdout\].*PowerShell warning/s);
  assert.match(record.reason, /tail preserved/);
  assert.match(record.reason, /FINAL ACTIONABLE ERROR: model alias rejected OPENAI_API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(record.reason, /tail-secret/);
  assert.ok(record.reason.length < 2_000);
});

test("malicious model/profile and unsupported effort are rejected before a runner exists", () => {
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "good; calc", profile: null, reasoningEffort: "high", availability: "entitlement-dependent" }), /unsafe/);
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "gpt-5.6-sol", profile: "bad profile", reasoningEffort: "high", availability: "entitlement-dependent" }), /unsafe/);
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "gpt-5.6-sol", profile: null, reasoningEffort: "ultra", availability: "entitlement-dependent" }), /unsupported/);
  assert.throws(() => modelSelectionArgs({ backend: "desktop-child", model: "gpt-5.6-sol", profile: null, reasoningEffort: "high", availability: "host-advertised" }), /codex-cli/);
});
