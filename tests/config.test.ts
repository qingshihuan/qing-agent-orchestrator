import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { NodeProcessRunner } from "../src/process-runner.js";

test("default config keeps real Codex execution disabled", async () => {
  const config = await loadConfig();
  assert.equal(config.executor.mode, "dry-run");
  assert.equal(config.executor.codexExec.enabled, false);
  assert.equal(config.executor.codexExec.ignoreUserConfig, true);
  assert.equal(config.executor.codexExec.skipGitRepoCheck, false);
  assert.equal(config.executor.codexExec.windowsSandbox, null);
  assert.equal(config.modelRouting.mode, "inherit");
  assert.deepEqual(config.modelRouting.candidates, []);
});

test("publishable launcher has no legacy skill path and supports bundled or project runtimes", async () => {
  const launcher = await readFile(
    resolve(".agents/skills/qing-agent-orchestrator-full/scripts/qing.ps1"),
    "utf8",
  );
  assert.doesNotMatch(launcher, /D:\\CodexTools|\.codex[\\/]skills/i);
  assert.match(launcher, /\$bundledRelay/);
  assert.match(launcher, /\$projectRelay/);
  assert.match(launcher, /QING_RELAY_HOME must be an absolute directory path/);
});

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const name of await readdir(root)) {
    const path = join(root, name);
    if ((await stat(path)).isDirectory()) result.push(...await collectFiles(path));
    else result.push(path);
  }
  return result;
}

test("desktop standard skill source contains no CLI launcher or runtime material", async () => {
  const root = resolve(".agents/skills/qing-agent-orchestrator");
  const names = await readdir(root);
  assert.equal(names.includes("scripts"), false);
  assert.equal(names.includes("runtime"), false);
  const files = await collectFiles(root);
  const content = (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(content, /codex\s+exec|Codex CLI|QING_RELAY_HOME|qing\.ps1/i);
});

test("strict model routing accepts catalog-validated CLI pairs and rejects unsafe configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-model-config-"));
  const baseCandidate = {
    id: "primary", backend: "codex-cli", model: "gpt-5.6-sol", profile: "work", reasoningEffort: "high", availability: "entitlement-dependent",
    roles: ["planner", "executor"], routes: ["codex", "hybrid"], categories: ["code_change"], complexityBands: ["complex"], tags: [],
    priority: 10, enabled: true, fallbacks: ["fallback"],
  };
  const write = async (name: string, value: unknown): Promise<string> => {
    const path = join(directory, name); await writeFile(path, JSON.stringify(value), "utf8"); return path;
  };
  try {
    const valid = await loadConfig(await write("valid.json", { modelRouting: { mode: "explicit", healthTtlMs: 60_000, probeTimeoutMs: 5_000, candidates: [baseCandidate, { ...baseCandidate, id: "fallback", profile: null, reasoningEffort: "medium", priority: 1, fallbacks: [] }] } }));
    assert.equal(valid.modelRouting.candidates.length, 2);

    const maximum = await loadConfig(await write("max.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, reasoningEffort: "max", fallbacks: [] }] } }));
    assert.equal(maximum.modelRouting.candidates[0]?.reasoningEffort, "max");

    const futureCatalogModel = await loadConfig(await write("future.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, model: "future-catalog-model", reasoningEffort: "ultra", fallbacks: [] }] } }));
    assert.equal(futureCatalogModel.modelRouting.candidates[0]?.model, "future-catalog-model");

    await assert.rejects(loadConfig(await write("unknown.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, provider: "forbidden" }] } })), /unknown or forbidden fields.*provider/);
    await assert.rejects(loadConfig(await write("secret.json", { apiKey: "secret" })), /unknown or forbidden fields.*apiKey/);
    await assert.rejects(loadConfig(await write("effort.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, reasoningEffort: "none" }] } })), /capability mismatch.*unsupported/);
    await assert.rejects(loadConfig(await write("duplicate.json", { modelRouting: { mode: "explicit", candidates: [baseCandidate, baseCandidate] } })), /duplicate IDs/);
    await assert.rejects(loadConfig(await write("dangling.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, fallbacks: ["missing"] }] } })), /dangling fallback/);
    await assert.rejects(loadConfig(await write("cycle.json", { modelRouting: { mode: "explicit", candidates: [baseCandidate, { ...baseCandidate, id: "fallback", fallbacks: ["primary"] }] } })), /fallback cycle/);
    await assert.rejects(loadConfig(await write("cross-backend.json", { modelRouting: { mode: "explicit", candidates: [baseCandidate, { ...baseCandidate, id: "fallback", backend: "desktop-child", model: "gpt-5.6-sol", profile: null, availability: "host-advertised", fallbacks: [] }] } })), /crosses model backends/);
    await assert.rejects(loadConfig(await write("inherit-candidate.json", { modelRouting: { mode: "inherit", candidates: [{ ...baseCandidate, fallbacks: [] }] } })), /inherit never silently selects/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows sandbox override accepts only official values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-config-windows-sandbox-"));
  try {
    for (const value of ["unelevated", "elevated"] as const) {
      const path = join(directory, `${value}.json`);
      await writeFile(path, JSON.stringify({ executor: { codexExec: { windowsSandbox: value } } }), "utf8");
      const config = await loadConfig(path);
      assert.equal(config.executor.codexExec.windowsSandbox, value);
    }
    const invalidPath = join(directory, "invalid.json");
    await writeFile(invalidPath, JSON.stringify({ executor: { codexExec: { windowsSandbox: "admin" } } }), "utf8");
    await assert.rejects(loadConfig(invalidPath), /windowsSandbox must be unelevated, elevated, or null/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy Git bypass setting parses but does not grant executor scope by itself", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-config-git-test-"));
  const path = join(directory, "relay.json");
  try {
    await writeFile(
      path,
      JSON.stringify({ executor: { codexExec: { skipGitRepoCheck: true } } }),
      "utf8",
    );
    const config = await loadConfig(path);
    assert.equal(config.executor.codexExec.skipGitRepoCheck, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy run refuses real execution regardless of config", async () => {
  const runner = new NodeProcessRunner();
  const baseRequest = {
    command: process.execPath,
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 10_000,
    maxOutputBytes: 65_536,
  };
  const disabled = await runner.run({
    ...baseRequest,
    args: [
      "dist/src/cli.js",
      "run",
      "examples/game-visual-analyzer/handoff.json",
      "--executor",
      "codex-exec",
      "--allow-real-execution",
    ],
  });
  assert.equal(disabled.exitCode, 1);
  assert.match(disabled.stderr, /Legacy run cannot start real codex-exec/i);

  const directory = await mkdtemp(join(tmpdir(), "qing-config-test-"));
  const path = join(directory, "relay.json");
  try {
    await writeFile(
      path,
      JSON.stringify({ executor: { mode: "codex-exec", codexExec: { enabled: true } } }),
      "utf8",
    );
    const noFlag = await runner.run({
      ...baseRequest,
      args: [
        "dist/src/cli.js",
        "run",
        "examples/game-visual-analyzer/handoff.json",
        "--config",
        path,
      ],
    });
    assert.equal(noFlag.exitCode, 1);
    assert.match(noFlag.stderr, /Legacy run cannot start real codex-exec/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("execute requires the exact Handoff approval before real executor preflight", async () => {
  const runner = new NodeProcessRunner();
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 10_000, maxOutputBytes: 65_536 };
  const handoff = "examples/smoke-test/handoff.json";
  const missing = await runner.run({ ...base, args: ["dist/src/cli.js", "execute", handoff] });
  assert.equal(missing.exitCode, 1); assert.match(missing.stderr, /--approve-handoff relay-read-only-smoke-001/);
  const wrong = await runner.run({ ...base, args: ["dist/src/cli.js", "execute", handoff, "--approve-handoff", "wrong"] });
  assert.equal(wrong.exitCode, 1); assert.match(wrong.stderr, /--approve-handoff relay-read-only-smoke-001/);
  const exact = await runner.run({ ...base, args: ["dist/src/cli.js", "execute", handoff, "--approve-handoff", "relay-read-only-smoke-001"] });
  assert.equal(exact.exitCode, 1); assert.match(exact.stderr, /codex-exec is disabled|--allow-real-execution/);
});
