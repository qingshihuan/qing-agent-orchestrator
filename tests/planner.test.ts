import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { CodexHandoffPlanner, planLocally, saveHandoff, type CodexPlannerOptions } from "../src/planner.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
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

class PlannerRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];

  constructor(private readonly plannerOutput?: (cwd: string) => Record<string, unknown>) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    if (request.args[0] === "--version") return result({ stdout: "codex-cli 1.2.3\n" });
    if (request.args[0] === "login") return result({ stdout: "Logged in\n" });

    const outputIndex = request.args.indexOf("--output-last-message");
    const outputPath = request.args[outputIndex + 1];
    assert.ok(outputPath);
    await writeFile(
      outputPath,
      JSON.stringify(this.plannerOutput?.(request.cwd) ?? {
        version: "1.0",
        id: "model-generated-id",
        title: "Inspect the project",
        objective: "Inspect the project without changing it.",
        category: "analysis",
        workspace: { root: request.cwd, allowedPaths: ["**/*"] },
        inputs: [{ name: "goal", type: "text", value: "Inspect the project", required: true }],
        constraints: ["Do not modify files."],
        acceptanceCriteria: [{ id: "ac-1", description: "Project is summarized.", verification: "Summary names the project.", verificationOwner: "executor", relayVerification: null }],
        requestedOperations: [{ type: "read", target: "**/*", reason: "Inspect project files.", risk: "low" }],
        deliverables: [],
        testPlan: [],
        maxIterations: 1,
      }),
      "utf8",
    );
    return result({ stdout: '{"type":"thread.started"}\n{"type":"turn.completed"}\n' });
  }
}

function modelOutput(
  cwd: string,
  criterion: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: "1.0",
    id: "model-generated-id",
    title: "Inspect the project",
    objective: "Inspect the project without changing it.",
    category: "analysis",
    workspace: { root: cwd, allowedPaths: ["**/*"] },
    inputs: [{ name: "goal", type: "text", value: "Inspect the project", required: true }],
    constraints: ["Do not modify files."],
    acceptanceCriteria: [criterion],
    requestedOperations: [{ type: "read", target: "**/*", reason: "Inspect project files.", risk: "low" }],
    deliverables: [],
    testPlan: [],
    maxIterations: 1,
  };
}

function plannerOptions(runtimeRoot: string, overrides: Partial<CodexPlannerOptions> = {}): CodexPlannerOptions {
  return {
    command: "fake-codex",
    runtimeRoot,
    timeoutMs: 30_000,
    probeTimeoutMs: 2_000,
    ephemeral: true,
    ignoreUserConfig: true,
    skipGitRepoCheck: false,
    windowsSandbox: null,
    handoffSchemaPath: "schemas/planner-output.schema.json",
    maxOutputBytes: 1_048_576,
    ...overrides,
  };
}

async function capturePlanningArgs(
  platform: NodeJS.Platform,
  windowsSandbox: CodexPlannerOptions["windowsSandbox"],
): Promise<string[]> {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    const runner = new PlannerRunner();
    await new CodexHandoffPlanner(plannerOptions(runtime, { platform, windowsSandbox }), runner).plan(
      "Inspect the project", workspace,
    );
    return runner.requests[2]?.args ?? [];
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
}

test("natural-language planner is read-only and saves a normalized pending Handoff", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    const options = plannerOptions(runtime);
    const runner = new PlannerRunner();
    const planned = await new CodexHandoffPlanner(options, runner).plan("Inspect the project", workspace);
    assert.equal(runner.requests.length, 3);
    const planningRequest = runner.requests[2];
    assert.ok(planningRequest);
    assert.equal(planningRequest.args[planningRequest.args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(
      planningRequest.args[planningRequest.args.indexOf("--output-schema") + 1],
      join(runtime, "schemas", "planner-output.schema.json"),
    );
    assert.match(planningRequest.stdin, /Do not execute, edit, install, delete, deploy, push, or send anything/);
    assert.match(planningRequest.stdin, /verificationOwner as executor, relay, or hybrid/);
    assert.match(planningRequest.stdin, /event-count or event-payload/);
    assert.equal(planned.handoff.acceptanceCriteria[0]?.relayVerification, undefined);
    assert.notEqual(planned.handoff.id, "model-generated-id");
    assert.equal(planned.handoff.workspace.root, workspace);

    const saved = await saveHandoff(planned.handoff, runtime, "state");
    const persisted = JSON.parse(await readFile(saved, "utf8")) as { id: string };
    assert.equal(persisted.id, planned.handoff.id);
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Planner output schema closes every object and requires every represented property", async () => {
  const schema = JSON.parse(
    await readFile(join(process.cwd(), "schemas", "planner-output.schema.json"), "utf8"),
  ) as Record<string, unknown>;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      const properties = Object.keys((node.properties ?? {}) as Record<string, unknown>).sort();
      assert.deepEqual([...(node.required as string[])].sort(), properties);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(schema);
  assert.deepEqual((schema.properties as Record<string, unknown>).version, { type: "string", const: "1.0" });
  const criterion = (schema.properties as Record<string, any>).acceptanceCriteria.items as Record<string, any>;
  assert.ok(criterion.required.includes("verificationOwner"));
  assert.deepEqual(criterion.properties.verificationOwner.enum, ["executor", "relay", "hybrid"]);
});

test("Planner output schema stays within the Structured Outputs composition subset", async () => {
  const schema = JSON.parse(
    await readFile(join(process.cwd(), "schemas", "planner-output.schema.json"), "utf8"),
  ) as Record<string, any>;
  const forbidden = new Set(["oneOf", "allOf", "not", "if", "then", "else"]);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    for (const key of Object.keys(node)) assert.equal(forbidden.has(key), false, `forbidden keyword: ${key}`);
    for (const child of Object.values(node)) visit(child);
  };
  visit(schema);
  assert.equal(schema.type, "object");
  assert.equal("anyOf" in schema, false);

  const criterion = schema.properties.acceptanceCriteria.items;
  const relayVerification = criterion.properties.relayVerification;
  assert.deepEqual(relayVerification.anyOf[0], { type: "null" });
  assert.deepEqual(relayVerification.anyOf[1], { $ref: "#/$defs/relayVerification" });
  const unified = schema.$defs.relayVerification;
  assert.equal(unified.type, "object");
  assert.equal(unified.additionalProperties, false);
  assert.deepEqual([...unified.required].sort(), Object.keys(unified.properties).sort());
  assert.deepEqual(unified.properties.kind.enum, ["event-count", "event-payload"]);
  assert.deepEqual(unified.properties.field.anyOf.at(-1), { type: "null" });
});

test("connected Planner normalizes unified relay verification into strict internal shapes", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-normalization-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-normalization-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    const cases = [
      {
        name: "executor",
        criterion: { id: "ac", description: "executor", verification: "fixture", verificationOwner: "executor", relayVerification: null },
        expected: undefined,
      },
      {
        name: "event-count",
        criterion: {
          id: "ac", description: "count", verification: "fixture", verificationOwner: "relay",
          relayVerification: { kind: "event-count", eventType: "process.exited", field: null, operator: "gte", expected: 1 },
        },
        expected: { kind: "event-count", eventType: "process.exited", operator: "gte", expected: 1 },
      },
      {
        name: "event-payload",
        criterion: {
          id: "ac", description: "payload", verification: "fixture", verificationOwner: "hybrid",
          relayVerification: { kind: "event-payload", eventType: "process.exited", field: "exitCode", operator: "eq", expected: 0 },
        },
        expected: { kind: "event-payload", eventType: "process.exited", field: "exitCode", operator: "eq", expected: 0 },
      },
    ];
    for (const fixture of cases) {
      const runner = new PlannerRunner((cwd) => modelOutput(cwd, fixture.criterion));
      const planned = await new CodexHandoffPlanner(plannerOptions(runtime), runner).plan(fixture.name, workspace);
      assert.deepEqual(planned.handoff.acceptanceCriteria[0]?.relayVerification, fixture.expected, fixture.name);
    }
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("connected Planner normalization keeps malformed relay evidence fail-closed", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-invalid-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-invalid-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    const invalidCriteria: Record<string, unknown>[] = [
      {
        id: "ac", description: "executor evidence", verification: "fixture", verificationOwner: "executor",
        relayVerification: { kind: "event-count", eventType: "process.exited", field: null, operator: "eq", expected: 1 },
      },
      {
        id: "ac", description: "invalid count operator", verification: "fixture", verificationOwner: "relay",
        relayVerification: { kind: "event-count", eventType: "process.exited", field: null, operator: "ne", expected: 1 },
      },
      {
        id: "ac", description: "missing payload field", verification: "fixture", verificationOwner: "relay",
        relayVerification: { kind: "event-payload", eventType: "process.exited", field: null, operator: "eq", expected: 0 },
      },
      {
        id: "ac", description: "unknown evidence key", verification: "fixture", verificationOwner: "relay",
        relayVerification: { kind: "event-count", eventType: "process.exited", field: null, operator: "eq", expected: 1, unknown: true },
      },
    ];
    for (const criterion of invalidCriteria) {
      const runner = new PlannerRunner((cwd) => modelOutput(cwd, criterion));
      await assert.rejects(
        new CodexHandoffPlanner(plannerOptions(runtime), runner).plan("Inspect", workspace),
        /invalid Handoff/i,
      );
    }
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("internal Handoff schema keeps Planner-only strict fields optional", async () => {
  const schema = JSON.parse(
    await readFile(join(process.cwd(), "schemas", "handoff.schema.json"), "utf8"),
  ) as {
    required: string[];
    properties: {
      inputs: { items: { required: string[] } };
    };
  };
  assert.equal(schema.required.includes("metadata"), false);
  assert.equal(schema.properties.inputs.items.required.includes("required"), false);
});

test("Planner nonzero exits include bounded redacted stderr and actionable JSONL stdout", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    class FailingRunner extends PlannerRunner {
      override async run(request: ProcessRequest): Promise<ProcessResult> {
        if (request.args[0] !== "exec") return super.run(request);
        return result({
          exitCode: 1,
          stderr: `warning: retrying with token=secret-value ${"w".repeat(2_000)}`,
          stdout: `${"x".repeat(2_000)}\n{"type":"error","code":"invalid_json_schema","message":"schema must have a type key","authorization":"Bearer hidden-secret"}\n`,
        });
      }
    }
    await assert.rejects(
      new CodexHandoffPlanner(plannerOptions(runtime), new FailingRunner()).plan("Inspect", workspace),
      (error: Error) => {
        assert.match(error.message, /stderr:/);
        assert.match(error.message, /stdout JSONL:/);
        assert.match(error.message, /invalid_json_schema/);
        assert.match(error.message, /schema must have a type key/);
        assert.doesNotMatch(error.message, /secret-value|hidden-secret/);
        assert.ok(error.message.length < 3_100);
        return true;
      },
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("planner applies reviewed Windows sandbox modes as one-shot arguments", async () => {
  for (const windowsSandbox of ["unelevated", "elevated"] as const) {
    const args = await capturePlanningArgs("win32", windowsSandbox);
    assert.deepEqual(args, [
      "exec", "--json", "--sandbox", "read-only",
      "--output-schema", args[5], "--output-last-message", args[7],
      "--ephemeral", "--ignore-user-config",
      "-c", `windows.sandbox=${windowsSandbox}`, "-",
    ]);
  }
});

test("planner omits the Windows sandbox override when unset or on non-Windows platforms", async () => {
  const unsetWindowsArgs = await capturePlanningArgs("win32", null);
  const linuxArgs = await capturePlanningArgs("linux", "unelevated");
  for (const args of [unsetWindowsArgs, linuxArgs]) {
    assert.equal(args.includes("-c"), false);
    assert.equal(args.some((arg) => arg.startsWith("windows.sandbox=")), false);
    assert.deepEqual(args.slice(0, 4), ["exec", "--json", "--sandbox", "read-only"]);
    assert.ok(args.includes("--output-schema"));
    assert.ok(args.includes("--output-last-message"));
    assert.ok(args.includes("--ephemeral"));
    assert.ok(args.includes("--ignore-user-config"));
    assert.equal(args.at(-1), "-");
  }
});

test("planner propagates an explicitly selected model, profile, and reasoning effort", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-model-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-model-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    const runner = new PlannerRunner();
    await new CodexHandoffPlanner(plannerOptions(runtime, { modelSelection: { candidateId: "planner-primary", backend: "codex-cli", model: "gpt-5.6-sol", profile: "work", reasoningEffort: "xhigh", availability: "entitlement-dependent", role: "planner", complexityBand: "complex", reason: "healthy primary", cacheState: "cached", fallbackFrom: null } }), runner).plan("Inspect", workspace);
    const args = runner.requests[2]!.args;
    assert.equal(args[args.indexOf("-m") + 1], "gpt-5.6-sol");
    assert.equal(args[args.indexOf("--profile") + 1], "work");
    assert.equal(args[args.lastIndexOf("-c") + 1], 'model_reasoning_effort="xhigh"');
    assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
    assert.ok(args.includes("--output-schema"));
  } finally {
    await rm(runtime, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true });
  }
});

test("local fallback creates a conservative plan but refuses external actions", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-local-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-local-workspace-"));
  try {
    const planned = await planLocally("实现一个本地状态页面并运行测试", workspace, runtime);
    assert.equal(planned.handoff.category, "code_change");
    assert.equal(planned.handoff.metadata?.source, "qing-local-fallback-planner");
    assert.deepEqual(
      planned.handoff.requestedOperations.map((operation) => operation.type),
      ["read", "write", "execute_tests"],
    );
    const analysis = await planLocally("只读检查 README 是否完整", workspace, runtime);
    assert.equal(analysis.handoff.category, "analysis");
    await assert.rejects(
      planLocally("发送邮件通知客户", workspace, runtime),
      /refuses 'external_action'/i,
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("connected Planner rejects relay owners without a valid relayVerification", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "qing-planner-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "qing-planner-workspace-"));
  try {
    await mkdir(join(runtime, "schemas"), { recursive: true });
    await writeFile(join(runtime, "schemas", "planner-output.schema.json"), "{}", "utf8");
    class InvalidRelayRunner extends PlannerRunner {
      override async run(request: ProcessRequest): Promise<ProcessResult> {
        if (request.args[0] !== "exec") return super.run(request);
        const outputPath = request.args[request.args.indexOf("--output-last-message") + 1]!;
        await writeFile(outputPath, JSON.stringify({
          version: "1.0", id: "invalid", title: "Invalid", objective: "Invalid relay output", category: "analysis",
          workspace: { root: request.cwd, allowedPaths: ["README.md"] },
          inputs: [{ name: "goal", type: "text", value: "inspect", required: true }], constraints: ["read only"],
          acceptanceCriteria: [{ id: "ac", description: "relay", verification: "fixture", verificationOwner: "relay", relayVerification: null }],
          requestedOperations: [{ type: "read", target: "README.md", reason: "inspect", risk: "low" }], deliverables: [], testPlan: [], maxIterations: 1,
        }), "utf8");
        return result({ stdout: '{"type":"turn.completed"}\n' });
      }
    }
    await assert.rejects(new CodexHandoffPlanner(plannerOptions(runtime), new InvalidRelayRunner()).plan("Inspect", workspace), /invalid Handoff.*relayVerification/i);
    const local = await planLocally("只读检查 README", workspace, runtime);
    assert.ok(local.handoff.acceptanceCriteria.every(({ verificationOwner, relayVerification }) => verificationOwner === "executor" && relayVerification === undefined));
  } finally {
    await rm(runtime, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
