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

type RunnerMode =
  | "ok"
  | "timeout"
  | "auth"
  | "long-process"
  | "jsonl"
  | "schema"
  | "catalog-process"
  | "catalog-schema"
  | "old-client"
  | "missing-model"
  | "unsupported-effort";

class HealthRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly mode: RunnerMode = "ok") {}
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    if (request.args[0] === "--version") {
      return result({ stdout: this.mode === "old-client" ? "codex-cli 0.143.9\n" : "codex-cli 1.2.3\n" });
    }
    if (request.args[0] === "debug") {
      if (this.mode === "catalog-process") return result({ exitCode: 2, stderr: "unknown subcommand models" });
      if (this.mode === "catalog-schema") return result({ stdout: "{}" });
      const slug = this.mode === "missing-model" ? "another-model" : "gpt-5.6-sol";
      const efforts = this.mode === "unsupported-effort" ? ["low"] : ["low", "medium", "high", "xhigh", "max", "ultra"];
      return result({ stdout: JSON.stringify({
        models: [{
          slug,
          supported_reasoning_levels: efforts.map((effort) => ({ effort })),
          minimal_client_version: "0.144.0",
        }],
      }) });
    }
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

test("preflight validates the bundled catalog, then uses shell-free model/profile/reasoning boundaries", async () => {
  const runner = new HealthRunner();
  const checker = new ModelHealthChecker(options, runner);
  const record = await checker.check(candidate);
  assert.equal(record.state, "healthy");
  assert.deepEqual(runner.requests[1]!.args, ["debug", "models", "--bundled"]);
  assert.ok(runner.requests[1]!.maxOutputBytes >= 8 * 1024 * 1024);
  const probe = runner.requests[2]!;
  assert.equal(probe.command, "fake-codex");
  assert.deepEqual(probe.args.slice(probe.args.indexOf("-m"), probe.args.indexOf("-m") + 7), ["-m", "gpt-5.6-sol", "--profile", "work", "-c", 'model_reasoning_effort="high"', "--ephemeral"]);
  assert.equal(probe.args.includes("--sandbox"), true);
  assert.equal(probe.args[probe.args.indexOf("--sandbox") + 1], "read-only");
  assert.match(record.reason, /catalog validation/);
});

test("preflight caches by CLI version and candidate fingerprint and deduplicates catalog/probe concurrency", async () => {
  const runner = new HealthRunner();
  const checker = new ModelHealthChecker(options, runner);
  const [first, second] = await Promise.all([checker.check(candidate), checker.check(candidate)]);
  assert.equal(first.state, "healthy"); assert.equal(second.state, "healthy");
  assert.equal(runner.requests.filter(({ args }) => args[0] === "debug").length, 1);
  assert.equal(runner.requests.filter(({ args }) => args[0] === "exec").length, 1);
  const third = await checker.check(candidate);
  assert.equal(third.cacheState, "cached");
  assert.equal(runner.requests.filter(({ args }) => args[0] === "exec").length, 1);
});

test("catalog command, schema, model, effort, and minimum-version mismatches fail before exec", async () => {
  for (const mode of ["catalog-process", "catalog-schema", "old-client", "missing-model", "unsupported-effort"] as const) {
    const runner = new HealthRunner(mode);
    const record = await new ModelHealthChecker(options, runner).check(candidate);
    assert.equal(record.state, "unhealthy", mode);
    assert.equal(record.failure, "capability", mode);
    assert.equal(runner.requests.some(({ args }) => args[0] === "exec"), false, mode);
  }
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

test("malicious tokens and non-CLI backends are rejected locally while catalog-valid future efforts remain expressible", () => {
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "good; calc", profile: null, reasoningEffort: "high", availability: "entitlement-dependent" }), /unsafe/);
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "gpt-5.6-sol", profile: "bad profile", reasoningEffort: "high", availability: "entitlement-dependent" }), /unsafe/);
  assert.throws(() => modelSelectionArgs({ backend: "codex-cli", model: "gpt-5.6-sol", profile: null, reasoningEffort: "none", availability: "entitlement-dependent" }), /unsupported/);
  assert.doesNotThrow(() => modelSelectionArgs({ backend: "codex-cli", model: "gpt-5.6-sol", profile: null, reasoningEffort: "ultra", availability: "entitlement-dependent" }));
  assert.throws(() => modelSelectionArgs({ backend: "desktop-child", model: "gpt-5.6-sol", profile: null, reasoningEffort: "high", availability: "host-advertised" }), /codex-cli/);
});
