import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  CodexExecExecutor,
  isStrictReadOnlyDiagnostic,
  redactSensitiveText,
  type CodexExecOptions,
} from "../src/executors/codex-exec-executor.js";
import {
  inspectCodexRuntimeProvenance,
  resolveCompleteWindowsRuntime,
  type CodexRuntimeProvenance,
} from "../src/codex-runtime.js";

test("complete Windows runtime selection skips WindowsApps and prepends only the child PATH", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-runtime-select-"));
  const windowsApps = join(root, "WindowsApps");
  const complete = join(root, "complete");
  await mkdir(windowsApps); await mkdir(complete);
  await writeFile(join(windowsApps, "codex.exe"), "");
  await writeFile(join(complete, "codex.exe"), "");
  await writeFile(join(complete, "codex-windows-sandbox-setup.exe"), "");
  try {
    const original = windowsApps + ";" + complete;
    const selected = await resolveCompleteWindowsRuntime("codex", { PATH: original });
    assert.equal(selected.command, join(complete, "codex.exe"));
    assert.equal(selected.environment.PATH, complete + ";" + original);
    await assert.rejects(resolveCompleteWindowsRuntime(join(windowsApps, "codex.exe"), { PATH: original }), /WindowsApps candidate rejected/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("stable Windows launcher discovers the unique complete default LocalAppData runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-runtime-default-"));
  try {
    const launcher = join(root, "Programs", "OpenAI", "Codex", "bin");
    const defaultBin = join(root, "OpenAI", "Codex", "bin");
    const incomplete = join(defaultBin, "incomplete-version");
    const complete = join(defaultBin, "opaque-version");
    await Promise.all([mkdir(launcher, { recursive: true }), mkdir(incomplete, { recursive: true }), mkdir(complete, { recursive: true })]);
    await Promise.all([
      writeFile(join(launcher, "codex.exe"), "launcher"),
      writeFile(join(incomplete, "codex.exe"), "incomplete"),
      writeFile(join(complete, "codex.exe"), "complete"),
      writeFile(join(complete, "codex-windows-sandbox-setup.exe"), "helper"),
    ]);
    const originalPath = launcher;
    const selected = await resolveCompleteWindowsRuntime("codex", { PATH: originalPath, LOCALAPPDATA: root });
    assert.equal(selected.command, join(complete, "codex.exe"));
    assert.equal(selected.directory, complete);
    assert.equal(selected.environment.PATH, complete + ";" + originalPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("default LocalAppData discovery fails closed for missing helpers and ambiguity", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-runtime-default-fail-"));
  try {
    const launcher = join(root, "launcher");
    const defaultBin = join(root, "OpenAI", "Codex", "bin");
    const first = join(defaultBin, "first");
    const second = join(defaultBin, "second");
    await Promise.all([mkdir(launcher, { recursive: true }), mkdir(first, { recursive: true }), mkdir(second, { recursive: true })]);
    await Promise.all([writeFile(join(launcher, "codex.exe"), "launcher"), writeFile(join(first, "codex.exe"), "first")]);
    const environment = { PATH: launcher, LOCALAPPDATA: root };
    await assert.rejects(resolveCompleteWindowsRuntime("codex", environment), /No complete.*direct subdirectories/i);
    await Promise.all([
      writeFile(join(first, "codex-windows-sandbox-setup.exe"), "helper"),
      writeFile(join(second, "codex.exe"), "second"),
      writeFile(join(second, "codex-windows-sandbox-setup.exe"), "helper"),
    ]);
    await assert.rejects(resolveCompleteWindowsRuntime("codex", environment), /Multiple complete.*ambiguous/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit complete runtime and complete PATH runtime retain priority over default discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "qing-runtime-priority-"));
  try {
    const pathRuntime = join(root, "path-runtime");
    const explicitRuntime = join(root, "explicit-runtime");
    const defaultRuntime = join(root, "OpenAI", "Codex", "bin", "default-version");
    await Promise.all([mkdir(pathRuntime, { recursive: true }), mkdir(explicitRuntime, { recursive: true }), mkdir(defaultRuntime, { recursive: true })]);
    for (const directory of [pathRuntime, explicitRuntime, defaultRuntime]) {
      await Promise.all([writeFile(join(directory, "codex.exe"), "binary"), writeFile(join(directory, "codex-windows-sandbox-setup.exe"), "helper")]);
    }
    const environment = { PATH: pathRuntime, LOCALAPPDATA: root };
    assert.equal((await resolveCompleteWindowsRuntime("codex", environment)).directory, pathRuntime);
    assert.equal((await resolveCompleteWindowsRuntime(join(explicitRuntime, "codex.exe"), environment)).directory, explicitRuntime);
    await rm(join(explicitRuntime, "codex-windows-sandbox-setup.exe"));
    await assert.rejects(resolveCompleteWindowsRuntime(join(explicitRuntime, "codex.exe"), environment), /missing sandbox helper/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";
import type { ExecutionResult, Handoff } from "../src/types.js";
import { validateHandoff } from "../src/validation.js";

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputLimitExceeded: false,
    spawnError: null,
    ...overrides,
  };
}

async function exampleHandoff(): Promise<Handoff> {
  const parsed = JSON.parse(await readFile("examples/game-visual-analyzer/handoff.json", "utf8"));
  const validation = validateHandoff(parsed);
  assert.ok(validation.value, validation.errors.join("\n"));
  return validation.value;
}

function successfulExecution(handoff: Handoff): ExecutionResult {
  return {
    status: "succeeded",
    summary: "Fake runner completed the declared work.",
    artifacts: [...handoff.deliverables],
    criteriaEvidence: handoff.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      status: "pass",
      evidence: "Fake process evidence for adapter testing.",
    })),
    tests: handoff.testPlan.map((command) => ({
      command,
      status: "passed",
      evidence: "Fake process test evidence.",
    })),
    proposedOperations: [],
    simulated: false,
  };
}

class FakeCodexRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];

  constructor(
    private readonly handoff: Handoff,
    private readonly authenticated = true,
    private readonly invalidFinalOutput = false,
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    if (request.args[0] === "--version") return processResult({ stdout: "codex-cli 1.2.3\n" });
    if (request.args[0] === "login") {
      return this.authenticated
        ? processResult({ stdout: "Logged in\n" })
        : processResult({ exitCode: 1, stderr: "Not logged in\n" });
    }

    const outputFlag = request.args.indexOf("--output-last-message");
    const outputPath = request.args[outputFlag + 1];
    assert.ok(outputPath);
    await writeFile(outputPath, this.invalidFinalOutput ? "{}" : JSON.stringify(successfulExecution(this.handoff)), "utf8");
    return processResult({
      stdout: '{"type":"thread.started","thread_id":"fake"}\n{"type":"turn.completed"}\n',
    });
  }
}

function options(): CodexExecOptions {
  return {
    command: "fake-codex",
    runtimeRoot: process.cwd(),
    timeoutMs: 30_000,
    probeTimeoutMs: 2_000,
    sandbox: "workspace-write",
    ephemeral: true,
    ignoreUserConfig: true,
    skipGitRepoCheck: false,
    windowsSandbox: null,
    outputSchemaPath: "schemas/executor-result.schema.json",
    maxOutputBytes: 1_048_576,
    platform: "linux",
  };
}

function strictReadOnlyDiagnostic(handoff: Handoff): Handoff {
  return {
    ...handoff,
    id: "qing-20260815135000-sandbox-diagnostic",
    category: "analysis",
    constraints: [...handoff.constraints, "Read-only diagnosis only."],
    requestedOperations: [
      {
        type: "read",
        target: "README.md",
        reason: "Read scoped diagnostic evidence.",
        risk: "low",
      },
      {
        type: "execute_tests",
        target: "Read-only Get-Item metadata checks",
        reason: "Run read-only diagnostic checks.",
        risk: "low",
      },
    ],
  };
}

function healthyWindowsRuntime(): CodexRuntimeProvenance {
  return {
    platform: "win32",
    configuredCommand: "codex",
    resolvedExecutable: "C:\\fixture\\codex.exe",
    version: "codex-cli 1.2.3",
    installKind: "standalone",
    packageRoot: "C:\\fixture\\package",
    packageExecutable: "C:\\fixture\\package\\bin\\codex.exe",
    resourcesDirectory: "C:\\fixture\\package\\codex-resources",
    sandboxHelperPath: "C:\\fixture\\package\\codex-resources\\codex-windows-sandbox-setup.exe",
    sandboxHelperExists: true,
    consistent: true,
    reason: "Fixture provenance is consistent.",
  };
}

test("codex exec adapter probes, uses safe arguments, and validates final JSON", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff);
  const executor = new CodexExecExecutor(options(), fake);
  const result = await executor.execute(handoff, { iteration: 1, revisionInstructions: [] });
  assert.equal(result.status, "succeeded");
  assert.equal(result.simulated, false);
  assert.equal(fake.requests.length, 3);
  const executionRequest = fake.requests[2];
  assert.ok(executionRequest);
  assert.ok(executionRequest.args.includes("--json"));
  assert.ok(executionRequest.args.includes("--output-schema"));
  assert.ok(executionRequest.args.includes("--ephemeral"));
  assert.ok(executionRequest.args.includes("--ignore-user-config"));
  assert.ok(!executionRequest.args.includes("--skip-git-repo-check"));
  assert.equal(executionRequest.args.at(-1), "-");
  assert.equal(executionRequest.args[executionRequest.args.indexOf("--sandbox") + 1], "workspace-write");
  assert.match(executionRequest.stdin, /game-visual-analyzer-001/);
  assert.match(executionRequest.stdin, /complete current snapshot for all acceptance criteria/);
});

test("executor propagates the selected model without changing security arguments and emits routing metadata", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff);
  const events: Array<{ type: string; value: Record<string, unknown> }> = [];
  const execution = await new CodexExecExecutor({
    ...options(),
    modelSelection: { candidateId: "executor-primary", backend: "codex-cli", model: "gpt-5.6-sol", profile: "work", reasoningEffort: "high", availability: "entitlement-dependent", role: "executor", complexityBand: "complex", reason: "healthy", cacheState: "fresh", fallbackFrom: null },
    modelHealth: [{ candidateId: "executor-primary", fingerprint: "hash", cliVersion: "codex 1", state: "healthy", cacheState: "fresh", checkedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", failure: null, reason: "passed" }],
  }, fake).execute(handoff, { iteration: 1, revisionInstructions: [], onModelEvent: (type, value) => events.push({ type, value }) });
  assert.equal(execution.status, "succeeded");
  const args = fake.requests[2]!.args;
  assert.equal(args[args.indexOf("-m") + 1], "gpt-5.6-sol");
  assert.equal(args[args.indexOf("--profile") + 1], "work");
  assert.equal(args[args.lastIndexOf("-c") + 1], 'model_reasoning_effort="high"');
  assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
  assert.ok(args.includes("--output-schema")); assert.ok(args.includes("--ephemeral")); assert.ok(args.includes("--ignore-user-config"));
  assert.deepEqual(events.map(({ type }) => type), ["model.preflight", "model.selected"]);
});

test("executor rejects unsafe model selection before any process request", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff);
  const execution = await new CodexExecExecutor({ ...options(), modelSelection: { candidateId: "bad", backend: "codex-cli", model: "good; calc", profile: null, reasoningEffort: "high", availability: "entitlement-dependent", role: "executor", complexityBand: "normal", reason: "fixture", cacheState: "fresh", fallbackFrom: null } }, fake).execute(handoff, { iteration: 1, revisionInstructions: [] });
  assert.equal(execution.status, "failed"); assert.match(execution.summary, /before process creation/);
  assert.equal(fake.requests.length, 0);
});

test("Git repository check bypass is derived only for a strict read-only diagnostic", async () => {
  const handoff = strictReadOnlyDiagnostic(await exampleHandoff());
  const fake = new FakeCodexRunner(handoff);
  assert.equal(isStrictReadOnlyDiagnostic(handoff, "read-only"), true);
  await new CodexExecExecutor(options(), fake).execute(handoff, {
    iteration: 1,
    revisionInstructions: [],
  });
  const executionRequest = fake.requests[2];
  assert.ok(executionRequest);
  assert.ok(executionRequest.args.includes("--skip-git-repo-check"));

  const smokeParsed = JSON.parse(await readFile("examples/smoke-test/handoff.json", "utf8"));
  const smokeValidation = validateHandoff(smokeParsed);
  assert.ok(smokeValidation.value, smokeValidation.errors.join("\n"));
  assert.equal(isStrictReadOnlyDiagnostic(smokeValidation.value, "read-only"), true);
});

test("configured Git bypass cannot widen a mutating or non-analysis Handoff", async () => {
  const original = await exampleHandoff();
  const handoff: Handoff = {
    ...original,
    category: "code_change",
    requestedOperations: [{ type: "write", target: "src/**", reason: "Change source.", risk: "medium" }],
  };
  const fake = new FakeCodexRunner(handoff);
  assert.equal(isStrictReadOnlyDiagnostic(handoff, "workspace-write"), false);
  await new CodexExecExecutor({ ...options(), skipGitRepoCheck: true }, fake).execute(handoff, {
    iteration: 1,
    revisionInstructions: [],
  });
  const executionRequest = fake.requests[2];
  assert.ok(executionRequest);
  assert.ok(!executionRequest.args.includes("--skip-git-repo-check"));
});

test("executor accepts a specific target project outside the Relay runtime", async () => {
  const external = await mkdtemp(join(tmpdir(), "qing-external-executor-"));
  try {
    const original = await exampleHandoff();
    const handoff = { ...original, workspace: { ...original.workspace, root: external } };
    const fake = new FakeCodexRunner(handoff);
    const execution = await new CodexExecExecutor(options(), fake).execute(handoff, {
      iteration: 1,
      revisionInstructions: [],
    });
    assert.equal(execution.status, "succeeded");
    assert.equal(fake.requests[2]?.cwd, external);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});

test("analysis Handoffs are forced to read-only sandbox", async () => {
  const handoff = { ...(await exampleHandoff()), category: "analysis" as const };
  const fake = new FakeCodexRunner(handoff);
  await new CodexExecExecutor(options(), fake).execute(handoff, { iteration: 1, revisionInstructions: [] });
  const executionRequest = fake.requests[2];
  assert.ok(executionRequest);
  assert.equal(executionRequest.args[executionRequest.args.indexOf("--sandbox") + 1], "read-only");
});

test("Windows sandbox mode is a one-shot CLI override", async () => {
  const original = await exampleHandoff();
  const handoff = { ...original, category: "code_change" as const };
  const fake = new FakeCodexRunner(handoff);
  await new CodexExecExecutor(
    { ...options(), platform: "win32", windowsSandbox: "unelevated" },
    fake,
    async () => healthyWindowsRuntime(),
  ).execute(handoff, { iteration: 1, revisionInstructions: [] });
  const executionRequest = fake.requests[2];
  assert.ok(executionRequest);
  const configIndex = executionRequest.args.indexOf("-c");
  assert.ok(configIndex >= 0);
  assert.equal(executionRequest.args[configIndex + 1], 'windows.sandbox="unelevated"');
});

test("Windows workspace-write fails closed before executor spawn when runtime provenance is inconsistent", async () => {
  const original = await exampleHandoff();
  const handoff = { ...original, category: "code_change" as const };
  const fake = new FakeCodexRunner(handoff);
  const observed: unknown[] = [];
  const execution = await new CodexExecExecutor(
    { ...options(), platform: "win32" },
    fake,
    async () => ({ ...healthyWindowsRuntime(), consistent: false, sandboxHelperExists: false, reason: "helper missing" }),
  ).execute(handoff, {
    iteration: 1,
    revisionInstructions: [],
    onSandboxPreflight: (value) => observed.push(value),
  });
  assert.equal(execution.status, "failed");
  assert.match(execution.summary, /runtime provenance failed/i);
  assert.equal(fake.requests.length, 2);
  assert.equal(observed.length, 1);
  assert.match(JSON.stringify(observed[0]), /helper missing/);
});

test("standalone runtime provenance resolves a command alias through a version-matched package manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-runtime-standalone-"));
  try {
    const launcher = join(directory, "launcher");
    const codexHome = join(directory, "codex-home");
    const packageRoot = join(codexHome, "packages", "standalone", "releases", "fixture-release");
    await Promise.all([
      mkdir(launcher, { recursive: true }),
      mkdir(join(packageRoot, "bin"), { recursive: true }),
      mkdir(join(packageRoot, "codex-resources"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(launcher, "codex.exe"), "launcher", "utf8"),
      writeFile(join(packageRoot, "bin", "codex.exe"), "binary", "utf8"),
      writeFile(join(packageRoot, "codex-resources", "codex-windows-sandbox-setup.exe"), "helper", "utf8"),
      writeFile(join(packageRoot, "codex-package.json"), JSON.stringify({
        version: "9.9.9",
        entrypoint: "bin/codex.exe",
        resourcesDir: "codex-resources",
      }), "utf8"),
    ]);
    const result = await inspectCodexRuntimeProvenance({
      command: "codex",
      version: "codex-cli 9.9.9",
      platform: "win32",
      environment: { PATH: launcher, PATHEXT: ".exe", CODEX_HOME: codexHome },
    });
    assert.equal(result.installKind, "standalone");
    assert.equal(result.consistent, true);
    assert.equal(result.packageRoot, packageRoot);
    assert.match(result.sandboxHelperPath ?? "", /codex-windows-sandbox-setup\.exe$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("app-colocated and missing-helper layouts are distinguished without hard-coded paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-runtime-layout-"));
  try {
    const appDirectory = join(directory, "app", "resources");
    await mkdir(appDirectory, { recursive: true });
    const executable = join(appDirectory, "codex.exe");
    const helper = join(appDirectory, "codex-windows-sandbox-setup.exe");
    await Promise.all([writeFile(executable, "binary", "utf8"), writeFile(helper, "helper", "utf8")]);
    const colocated = await inspectCodexRuntimeProvenance({
      command: executable,
      version: "codex-cli 1.2.3",
      platform: "win32",
      environment: {},
    });
    assert.equal(colocated.installKind, "app-colocated");
    assert.equal(colocated.consistent, true);

    await rm(helper, { force: true });
    const missing = await inspectCodexRuntimeProvenance({
      command: executable,
      version: "codex-cli 1.2.3",
      platform: "win32",
      environment: { CODEX_HOME: join(directory, "empty-home") },
    });
    assert.equal(missing.installKind, "unknown");
    assert.equal(missing.consistent, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime provenance is explicitly not applicable outside Windows", async () => {
  const result = await inspectCodexRuntimeProvenance({
    command: "codex",
    version: "codex-cli 1.2.3",
    platform: "linux",
    environment: {},
  });
  assert.equal(result.installKind, "not-applicable");
  assert.equal(result.consistent, true);
});

test("missing CLI authentication prevents task submission", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff, false);
  const result = await new CodexExecExecutor(options(), fake).execute(handoff, { iteration: 1, revisionInstructions: [] });
  assert.equal(result.status, "failed");
  assert.match(result.summary, /authentication/i);
  assert.equal(fake.requests.length, 2);
});

test("invalid final JSON is converted to a failed executor result", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff, true, true);
  const result = await new CodexExecExecutor(options(), fake).execute(handoff, { iteration: 1, revisionInstructions: [] });
  assert.equal(result.status, "failed");
  assert.match(result.summary, /failed validation/i);
});

test("diagnostic text redacts common credential forms", () => {
  const redacted = redactSensitiveText(
    'Bearer abc.def.ghi OPENAI_API_KEY=secret-value sk-abcdefghij {"access_token":"private"}',
  );
  assert.doesNotMatch(redacted, /secret-value|sk-abcdefghij|private|abc\.def\.ghi/);
  assert.match(redacted, /REDACTED/);
});
