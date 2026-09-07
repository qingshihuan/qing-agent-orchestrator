import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexPrompt } from "../src/executors/codex-exec-executor.js";
import { logPageOptions, optionalFlag, selectEventPage } from "../src/output-efficiency.js";
import { supportedReasoningEfforts, validateModelCapability, selectModelCandidate } from "../src/model-router.js";
import { parseCodexModelCatalog, validateCandidateAgainstCatalog, validateKnownModelMinimum } from "../src/codex-model-catalog.js";
import { candidateFingerprint, ModelHealthChecker } from "../src/model-health.js";
import { loadConfig } from "../src/config.js";
import type { Handoff, ModelCandidate } from "../src/types.js";
import type { ProcessRunner } from "../src/process-runner.js";
const astra = { backend: "codex-cli", model: "gpt-6-astra", reasoningEffort: "high" } as const;
const catalog = (minimum?: string) => parseCodexModelCatalog(JSON.stringify({ models: [{
  slug: astra.model, supported_reasoning_levels: [{ effort: "high" }], ...(minimum ? { minimal_client_version: minimum } : {}),
}] }));
test("Astra is recognized but still requires the declared desktop availability and valid effort", () => {
  assert.deepEqual(supportedReasoningEfforts("desktop-child", astra.model), ["low", "medium", "high", "xhigh", "max"]);
  const desktop = { ...astra, backend: "desktop-child", profile: null, availability: "host-advertised" } as const;
  assert.equal(validateModelCapability(desktop), null);
  assert.match(validateModelCapability({ ...desktop, reasoningEffort: "ultra" })!, /unsupported/);
  assert.match(validateModelCapability({ ...desktop, availability: "entitlement-dependent" })!, /host-advertised/);
  assert.match(validateModelCapability({ ...desktop, profile: "work" })!, /profiles/);
});
test("Astra rejects old, unknown and pre-release clients even if catalog omits its floor", () => {
  for (const version of ["codex-cli 0.152.0", "unknown", "codex-cli 0.153.0-alpha.1"]) {
    assert.match(validateCandidateAgainstCatalog(astra, catalog(), version)!, /0.153.0/);
  }
  assert.equal(validateCandidateAgainstCatalog(astra, catalog(), "codex-cli 0.153.0"), null);
  assert.equal(validateKnownModelMinimum("future-catalog-model", "unknown"), null);
});
test("Astra still obeys stricter local catalog versions and exact reasoning levels", () => {
  assert.match(validateCandidateAgainstCatalog(astra, catalog("0.154.0"), "0.153.0")!, /0.154.0/);
  assert.match(validateCandidateAgainstCatalog({ ...astra, reasoningEffort: "max" }, catalog(), "0.154.0")!, /unsupported/);
  assert.match(validateCandidateAgainstCatalog(astra, { models: new Map() }, "0.154.0")!, /absent/);
});
test("Astra is opt-in and does not silently upgrade ordinary or complex default selection", async () => {
  const config = await loadConfig("config/relay.example.json");
  const entries = config.modelRouting.candidates.filter(c => c.model === astra.model);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(c => !c.enabled && c.reasoningEffort === "high" && !c.complexityBands.includes("normal")));
  const selected = selectModelCandidate(config.modelRouting.candidates, new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "normal" });
  assert.equal(selected.model, "gpt-5.6-luna");
  const demanding = selectModelCandidate(config.modelRouting.candidates.map(c => c.id === "desktop-astra-demanding" ? { ...c, enabled: true } : c), new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.equal(demanding.model, astra.model);
});
test("an old-client cached Astra record cannot bypass the compatibility floor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qing-astra-min-"));
  try {
    const config = await loadConfig("config/relay.example.json");
    const candidate = { ...config.modelRouting.candidates.find(c => c.id === "cli-astra-demanding")!, enabled: true } as ModelCandidate;
    const version = "codex-cli 0.152.0";
    const cachePath = join(dir, "cache.json");
    await writeFile(cachePath, JSON.stringify({ version: "1.0", records: [{ candidateId: candidate.id, fingerprint: candidateFingerprint(candidate, version), cliVersion: version, state: "healthy", cacheState: "fresh", checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(), failure: null, reason: "fixture" }] }));
    const calls: string[][] = [];
    const runner: ProcessRunner = { async run(request) { calls.push(request.args); assert.deepEqual(request.args, ["--version"]); return { exitCode: 0, signal: null, stdout: version, stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null }; } };
    const result = await new ModelHealthChecker({ command: "fixture", cwd: dir, cachePath, schemaPath: join(dir,"unused.json"), timeoutMs: 5000, ttlMs: 60000 }, runner).check(candidate);
    assert.notEqual(result.state, "healthy");
    assert.match(result.reason, /0.153.0/);
    assert.equal(calls.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("minified Executor context preserves the full contract and exact string values", async () => {
  const handoff = JSON.parse(await readFile("examples/game-visual-analyzer/handoff.json", "utf8")) as Handoff;
  handoff.constraints.push("保留  两个空格、中文及 emoji 🟦；不得扩大路径或权限");
  const context = { iteration: 2, revisionInstructions: ["仅修复失败断言，不重复已完成探索"] };
  const prompt = buildCodexPrompt(handoff, context);
  assert.deepEqual(JSON.parse(prompt.split("Handoff:\n")[1]!), handoff);
  assert.ok(prompt.includes(JSON.stringify(context.revisionInstructions)));
  assert.ok(prompt.includes("complete current snapshot"));
  assert.ok(prompt.includes("proposedOperations for a new human gate"));
  assert.ok(Buffer.byteLength(JSON.stringify(handoff)) < Buffer.byteLength(JSON.stringify(handoff, null, 2)));
  assert.equal(buildCodexPrompt(handoff, context), prompt);
});
test("log paging defaults are opt-in and legacy output remains available", () => {
  assert.equal(logPageOptions(["logs", "id", "--compact"]), null);
  assert.deepEqual(logPageOptions(["--after", "4"]), { after: 4, limit: 50 });
  assert.deepEqual(logPageOptions(["--limit", "20"]), { after: 0, limit: 20 });
});
test("log and candidate flags reject missing, duplicate and invalid values", () => {
  assert.throws(() => optionalFlag(["--candidate"], "--candidate"));
  assert.throws(() => optionalFlag(["--candidate", "a", "--candidate", "b"], "--candidate"));
  for (const args of [["--after", "-1"], ["--after", "1.5"], ["--after", "9007199254740992"], ["--after", "--compact"], ["--limit", "0"], ["--limit", "501"]]) assert.throws(() => logPageOptions(args));
});
test("incremental pages preserve payloads and report every remaining event without duplication", () => {
  const events = [2,4,8,9].map(sequence => ({ sequence, payload: { error: "完整故障证据 🟦", phase: "review" } }));
  const first = selectEventPage(events, { after: 0, limit: 2 });
  assert.equal(first.hasMore, true); assert.equal(first.nextAfter, 4);
  const second = selectEventPage(events, { after: first.nextAfter, limit: 2 });
  assert.equal(second.hasMore, false); assert.equal(second.nextAfter, 9);
  assert.deepEqual([...first.events, ...second.events], events);
  assert.deepEqual(selectEventPage(events, { after: 9, limit: 2 }), { events: [], nextAfter: 9, hasMore: false });
});
test("paging refuses corrupt sequence order instead of silently skipping evidence", () => {
  for (const events of [[{ sequence: 2 }, { sequence: 1 }], [{ sequence: 1 }, { sequence: 1 }], [{ sequence: NaN }]]) assert.throws(() => selectEventPage(events, { after: 0, limit: 1 }));
  assert.throws(() => selectEventPage([], { after: -1, limit: 1 }));
});
test("bounded log pages materially reduce serialized repeated history", () => {
  const events = Array.from({ length: 200 }, (_, i) => ({ sequence: i+1, type: "process.heartbeat", payload: { iteration: 1, pid: 42, evidence: "fixture" } }));
  const page = selectEventPage(events, { after: 180, limit: 20 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < Buffer.byteLength(JSON.stringify(events)) * 0.12);
  assert.equal(page.events.length, 20); assert.equal(page.hasMore, false);
});
test("entry skills keep gates while making reference loading conditional", async () => {
  for (const name of ["qing-agent-orchestrator", "qing-agent-orchestrator-full"]) {
    const source = await readFile(".agents/skills/"+name+"/SKILL.md", "utf8");
    assert.match(source, /do not preload references or schemas/);
    assert.match(source, /Never skip required review or verification/);
    assert.match(source, /Astra is opt-in/);
    assert.match(source, /same unchanged inputs, commands and environment/);
    assert.match(source, /pending independent-review obligations/);
  }
});


import { NodeProcessRunner } from "../src/process-runner.js";
test("CLI targeted disabled Astra probe never invokes an unrelated enabled candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-probe-target-"));
  try {
    const config = JSON.parse(await readFile("config/relay.example.json", "utf8"));
    config.executor.codexExec.command = "nonexistent-qing-probe-sentinel";
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(config));
    const runner = new NodeProcessRunner();
    const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 20000, maxOutputBytes: 100000 };
    const result = await runner.run({ ...base, args: ["dist/src/cli.js", "models", "probe", "--candidate", "cli-astra-demanding", "--config", path, "--compact"] });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].candidateId, "cli-astra-demanding");
    assert.notEqual(output.results[0].state, "healthy");
    const invalid = await runner.run({ ...base, args: ["dist/src/cli.js", "models", "probe", "--candidate", "unknown-id", "--config", path] });
    assert.notEqual(invalid.exitCode, 0);
    assert.match(invalid.stderr, /configured Codex CLI candidate/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
