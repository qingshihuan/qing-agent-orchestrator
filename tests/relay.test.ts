import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { DryRunExecutor } from "../src/executors/dry-run-executor.js";
import { MockExecutor } from "../src/executors/mock-executor.js";
import { Relay } from "../src/relay.js";
import { RuleBasedReviewer } from "../src/reviewer.js";
import type { Reviewer } from "../src/reviewer.js";
import { RunStore } from "../src/run-store.js";
import type { ExecutionResult, Handoff, Review } from "../src/types.js";
import type { ExecutionContext, Executor } from "../src/executors/executor.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";
import { validateHandoff } from "../src/validation.js";

async function exampleHandoff(): Promise<Handoff> {
  const result = validateHandoff(JSON.parse(await readFile("examples/game-visual-analyzer/handoff.json", "utf8")));
  assert.ok(result.value, result.errors.join("\n"));
  return result.value;
}

test("mock executor demonstrates a bounded revise-then-pass loop", async () => {
  const relay = new Relay(new MockExecutor(), new RuleBasedReviewer());
  const result = await relay.run(await exampleHandoff(), { maxIterations: 3, approvedGateIds: [] });
  assert.equal(result.status, "MAX_ITERATIONS");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts[0]?.review.verdict, "REVISE");
  assert.equal(result.attempts[1]?.review.verdict, "REVISE");
});

test("dry-run evidence never becomes a completed task", async () => {
  const relay = new Relay(new DryRunExecutor(), new RuleBasedReviewer());
  const result = await relay.run(await exampleHandoff(), { maxIterations: 2, approvedGateIds: [] });
  assert.equal(result.status, "MAX_ITERATIONS");
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts.every((attempt) => attempt.review.verdict === "REVISE"));
});

test("Relay persists reachable phase reclassification and retains the review obligation through REVISE", async () => {
  const handoff = await exampleHandoff();
  handoff.maxIterations = 2;
  const result = await new Relay(new MockExecutor(), new RuleBasedReviewer()).run(handoff, {
    maxIterations: 2,
    approvedGateIds: [],
  });
  assert.equal(result.status, "MAX_ITERATIONS");
  assert.ok(result.phaseDecisions.some(({ milestone, tier }) => milestone === "before-child-creation" && tier === "direct"));
  const reviews = result.phaseDecisions.filter(({ milestone }) => milestone === "before-review");
  assert.equal(reviews.length, 2);
  assert.ok(reviews.every(({ tier, pendingIndependentReview }) => tier === "full" && pendingIndependentReview));
});

class CountingExecutor implements Executor {
  readonly name = "counting";
  calls = 0;
  constructor(readonly proposedOperations: ExecutionResult["proposedOperations"] = []) {}
  async execute(handoff: Handoff): Promise<ExecutionResult> {
    this.calls += 1;
    return {
      status: "succeeded", summary: "counting fixture", artifacts: handoff.deliverables,
      criteriaEvidence: handoff.acceptanceCriteria.map((criterion) => ({ id: criterion.id, status: "pass" as const, evidence: "fixture" })),
      tests: handoff.testPlan.map((command) => ({ command, status: "passed" as const, evidence: "fixture" })),
      proposedOperations: this.proposedOperations, simulated: false,
    };
  }
}

class CountingReviewer implements Reviewer {
  calls = 0;
  async review(): Promise<Review> {
    this.calls += 1;
    throw new Error("Reviewer must not run for an enforced Direct or Lite phase.");
  }
}

test("v0.8 enforced Direct and Lite phases change Relay control flow and child invocation counts", async () => {
  const directHandoff = await exampleHandoff();
  directHandoff.metadata = { ...directHandoff.metadata, orchestrationPolicyVersion: "0.8" };
  directHandoff.objective = "汇总当前已冻结的本地证据";
  const directExecutor = new CountingExecutor();
  const directReviewer = new CountingReviewer();
  const direct = await new Relay(directExecutor, directReviewer).run(directHandoff, { maxIterations: 1, approvedGateIds: [] });
  assert.equal(direct.status, "PARENT_ACTION_REQUIRED");
  assert.equal(directExecutor.calls, 0);
  assert.equal(directReviewer.calls, 0);
  assert.match(direct.message, /parent must complete and verify/i);

  const liteHandoff = await exampleHandoff();
  liteHandoff.metadata = { ...liteHandoff.metadata, orchestrationPolicyVersion: "0.8" };
  liteHandoff.objective = "先规划接口，然后实现并测试剩余的本地修复";
  const liteExecutor = new CountingExecutor([{ type: "read", target: "src/game-visual-analyzer/fixture.ts", reason: "Verify a local fixture before parent acceptance.", risk: "low" }]);
  const liteReviewer = new CountingReviewer();
  const lite = await new Relay(liteExecutor, liteReviewer).run(liteHandoff, { maxIterations: 1, approvedGateIds: [] });
  assert.equal(lite.status, "PARENT_VERIFICATION_REQUIRED");
  assert.equal(liteExecutor.calls, 1);
  assert.equal(liteReviewer.calls, 0);
  assert.equal(lite.attempts.length, 0);
  assert.equal(lite.pendingParentVerification?.reviewerInvoked, false);
  assert.equal(lite.pendingParentVerification?.execution.summary, "counting fixture");
  assert.deepEqual(lite.pendingParentVerification?.execution.proposedOperations, liteExecutor.proposedOperations);
  assert.equal(lite.pendingParentVerification?.postExecutionGate?.outcome, "ALLOW");
  assert.match(lite.message, /parent must verify/i);
});

test("Relay persists sandbox runtime provenance and terminal evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-relay-store-"));
  const handoff = await exampleHandoff();
  handoff.deliverables = [];
  class EvidenceExecutor implements Executor {
    readonly name = "evidence";
    async execute(value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      context.onModelEvent?.("model.preflight", { candidateId: "primary", state: "healthy", cacheState: "cached", reason: "Bearer secret-token" });
      context.onModelEvent?.("model.selected", { candidateId: "primary", model: "gpt-example", reasoningEffort: "high", role: "executor", reason: "healthy priority" });
      context.onSandboxPreflight?.({
        ok: true,
        runtimeProvenance: { consistent: true, sandboxHelperExists: true },
      });
      return {
        status: "succeeded",
        summary: "Persisted evidence fixture completed.",
        artifacts: [...value.deliverables],
        criteriaEvidence: value.acceptanceCriteria.map((criterion) => ({
          id: criterion.id,
          status: "pass",
          evidence: "Persisted fixture evidence.",
        })),
        tests: value.testPlan.map((command) => ({ command, status: "passed", evidence: "Persisted fixture test." })),
        proposedOperations: [],
        simulated: false,
      };
    }
  }
  try {
    const store = new RunStore(directory);
    const runHandle = await store.createRun(handoff);
    const result = await new Relay(new EvidenceExecutor(), new RuleBasedReviewer()).run(handoff, {
      maxIterations: 1,
      approvedGateIds: [],
      runHandle,
    });
    assert.equal(result.status, "COMPLETED");
    const preflight = JSON.parse(await readFile(runHandle.artifacts.sandboxPreflight, "utf8"));
    assert.equal(preflight.runtimeProvenance.consistent, true);
    const events = await store.readEvents(runHandle.runId);
    assert.ok(events.some((event) => event.type === "sandbox.preflight"));
    assert.ok(events.some((event) => event.type === "model.preflight" && event.payload?.candidateId === "primary"));
    assert.ok(events.some((event) => event.type === "model.selected" && event.payload?.reasoningEffort === "high"));
    assert.doesNotMatch(JSON.stringify(events), /secret-token/);
    const record = await runHandle.readRecord();
    assert.equal(record.status, "completed");
    assert.equal(record.phase, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Relay persists bound criterion evidence and Reviewer safely merges relay and hybrid owners", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-criterion-evidence-"));
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [
    { id: "relay-ac", description: "Relay observation", verification: "fixture", verificationOwner: "relay", relayVerification: { kind: "event-count", eventType: "process.started", operator: "eq", expected: 1 } },
    { id: "hybrid-ac", description: "Both observations", verification: "fixture", verificationOwner: "hybrid", relayVerification: { kind: "event-payload", eventType: "process.exited", field: "exitCode", operator: "eq", expected: 0 } },
  ];
  handoff.deliverables = [];
  handoff.testPlan = [];
  class OwnerExecutor implements Executor {
    readonly name = "owner-fixture";
    async execute(_value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      context.onProcessStart?.({ pid: 77, command: process.execPath, args: [], cwd: directory, startedAt: "2026-08-15T01:02:03.000Z" });
      context.onProcessExit?.({ pid: 77, endedAt: "2026-08-15T01:02:04.000Z", exitCode: 0, signal: null, cancelled: false, timedOut: false, outputLimitExceeded: false });
      return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [
        { id: "relay-ac", status: "not_verified", evidence: "Relay-owned." },
        { id: "hybrid-ac", status: "pass", evidence: "Executor half." },
      ], tests: [], proposedOperations: [], simulated: false };
    }
  }
  try {
    const handle = await new RunStore(directory).createRun(handoff);
    const evidence = (evidenceId: string, criterionId: string, result: "pass" | "fail") => ({ version: "1.0", evidenceId, source: "relay", runId: handle.runId, handoffId: handoff.id, criterionId, iteration: 1, result, evidence: "Relay fixture observation.", recordedAt: "2026-08-15T01:02:03.000Z" });
    const result = await new Relay(new OwnerExecutor(), new RuleBasedReviewer()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.attempts[0]?.review.verdict, "PASS");
    assert.deepEqual(result.attempts[0]?.review.criterionAudit.map(({ relayEvidenceIds }) => relayEvidenceIds), [["relay-1-relay-ac"], ["relay-1-hybrid-ac"]]);
    const reloadedEvidence = await new RunStore(directory).readCriterionEvidence(handle.runId);
    assert.equal(reloadedEvidence.length, 2);
    const reloadedReview = await new RuleBasedReviewer().review(handoff, result.attempts[0]!.execution, 1, reloadedEvidence);
    assert.equal(reloadedReview.verdict, result.attempts[0]?.review.verdict);
    assert.deepEqual(reloadedReview.criterionAudit, result.attempts[0]?.review.criterionAudit);
    const orderedEvents = await new RunStore(directory).readEvents(handle.runId);
    const exited = orderedEvents.findIndex(({ type }) => type === "process.exited");
    const collection = orderedEvents.findIndex(({ type }) => type === "relay-collector.started");
    const appended = orderedEvents.findIndex(({ type }) => type === "criterion-evidence.appended");
    const reviewed = orderedEvents.findIndex(({ type }) => type === "review.completed");
    assert.ok(exited >= 0 && exited < collection && collection < appended && appended < reviewed);
    await assert.rejects(handle.appendCriterionEvidence(evidence("relay-1-relay-ac", "relay-ac", "pass")), /replay/);
    await assert.rejects(handle.appendCriterionEvidence({ ...evidence("bad", "relay-ac", "pass"), runId: "other" }), /runId/);
    await assert.rejects(handle.appendCriterionEvidence({ ...evidence("bad-source", "relay-ac", "pass"), source: "executor" }), /source/);
    await assert.rejects(handle.appendCriterionEvidence(evidence("unknown", "unknown-ac", "pass")), /unknown/);
    const otherHandoff = structuredClone(handoff);
    otherHandoff.id = "other-handoff";
    const otherHandle = await new RunStore(directory).createRun(otherHandoff);
    await assert.rejects(otherHandle.appendCriterionEvidence({ ...evidence("cross-handoff", "relay-ac", "pass"), runId: otherHandle.runId }), /handoffId/);
    assert.equal((await new RunStore(directory).readCriterionEvidence(handle.runId)).length, 2);
    const rejectionEvents = await new RunStore(directory).readEvents(handle.runId);
    assert.ok(rejectionEvents.filter(({ type }) => type === "criterion-evidence.rejected").length >= 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("collector reads only the current RunHandle and other run events cannot satisfy a criterion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-current-run-only-"));
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [{ id: "current", description: "current run start", verification: "fixture", verificationOwner: "relay", relayVerification: { kind: "event-count", eventType: "process.started", operator: "gte", expected: 1 } }];
  handoff.deliverables = []; handoff.testPlan = [];
  class QuietExecutor implements Executor {
    readonly name = "quiet";
    async execute(): Promise<ExecutionResult> { return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [], tests: [], proposedOperations: [], simulated: false }; }
  }
  try {
    const store = new RunStore(directory);
    const other = await store.createRun({ ...handoff, id: "other-run-handoff" });
    await other.appendEvent("process.started", "executing", 1, "other run", { pid: 9 });
    const current = await store.createRun(handoff);
    const result = await new Relay(new QuietExecutor(), new RuleBasedReviewer()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: current });
    assert.equal(result.status, "MAX_ITERATIONS");
    assert.equal(result.attempts[0]?.review.criteria[0]?.status, "fail");
    const evidence = await current.readCriterionEvidence();
    assert.equal(evidence[0]?.result, "fail");
    assert.match(evidence[0]?.evidence ?? "", /Observed 0 process.started/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failure evidence is monotonic and external evidence cannot satisfy executor owners", async () => {
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [{ id: "ac", description: "owned", verification: "fixture", verificationOwner: "relay" } as any];
  handoff.deliverables = []; handoff.testPlan = [];
  const execution: ExecutionResult = { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "ac", status: "pass", evidence: "executor" }], tests: [], proposedOperations: [], simulated: false };
  const external = (result: "pass" | "fail", evidenceId: string) => ({ version: "1.0" as const, evidenceId, source: "relay" as const, runId: "r", handoffId: handoff.id, criterionId: "ac", iteration: 1, result, evidence: result, recordedAt: "2026-08-15T01:02:03.000Z" });
  let review = await new RuleBasedReviewer().review(handoff, execution, 1, [external("fail", "f"), external("pass", "p")]);
  assert.equal(review.criteria[0]?.status, "fail");
  (handoff.acceptanceCriteria[0] as any).verificationOwner = "executor";
  execution.criteriaEvidence[0]!.status = "not_verified";
  review = await new RuleBasedReviewer().review(handoff, execution, 1, [external("pass", "only-relay")]);
  assert.equal(review.verdict, "REVISE");
});

test("hybrid criteria require both sources and preserve either source failure", async () => {
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [{ id: "hybrid-ac", description: "Both observations", verification: "fixture", verificationOwner: "hybrid", relayVerification: { kind: "event-count", eventType: "process.started", operator: "eq", expected: 1 } }];
  handoff.deliverables = [];
  handoff.testPlan = [];
  const execution: ExecutionResult = { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "hybrid-ac", status: "pass", evidence: "executor" }], tests: [], proposedOperations: [], simulated: false };
  const relay = (result: "pass" | "fail") => ({ version: "1.0" as const, evidenceId: `relay-${result}`, source: "relay" as const, runId: "run", handoffId: handoff.id, criterionId: "hybrid-ac", iteration: 1, result, evidence: result, recordedAt: "2026-08-15T01:02:03.000Z" });
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 1, [])).verdict, "REVISE");
  execution.criteriaEvidence[0]!.status = "not_verified";
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 1, [relay("pass")])).verdict, "REVISE");
  execution.criteriaEvidence[0]!.status = "fail";
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 1, [relay("pass")])).criteria[0]?.status, "fail");
  execution.criteriaEvidence[0]!.status = "pass";
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 1, [relay("fail")])).criteria[0]?.status, "fail");
});

test("Reviewer fail-closes real test evidence and isolates criterion evidence by iteration", async () => {
  const handoff = await exampleHandoff(); handoff.deliverables = []; handoff.testPlan = ["npm test"];
  handoff.acceptanceCriteria = [{ id: "ac", description: "fixture", verification: "fixture", verificationOwner: "relay", relayVerification: { kind: "event-count", eventType: "process.started", operator: "eq", expected: 1 } }];
  const execution: ExecutionResult = { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "ac", status: "pass", evidence: "forged" }], tests: [{ command: "npm test", status: "passed", evidence: "forged" }], proposedOperations: [], simulated: false };
  const relay = (iteration: number) => ({ version: "1.0" as const, evidenceId: `ev-${iteration}`, source: "relay" as const, runId: "run", handoffId: handoff.id, criterionId: "ac", iteration, result: "pass" as const, evidence: "relay", recordedAt: "2026-08-15T01:02:03.000Z" });
  const command = (exitCode: number, command = "npm test") => ({ version: "1.0" as const, source: "relay" as const, runId: "run", handoffId: handoff.id, iteration: 2, command, exitCode, startedAt: "2026-08-15T01:02:02.000Z", endedAt: "2026-08-15T01:02:03.000Z", timedOut: false, cancelled: false, outputLimitExceeded: false, spawnError: null, stdout: "", stderr: "", recordedAt: "2026-08-15T01:02:03.000Z" });
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 2, [relay(1)], [command(0)])).verdict, "REVISE");
  assert.equal((await new RuleBasedReviewer().review(handoff, execution, 2, [relay(2)], [command(0)])).verdict, "PASS");
  for (const evidence of [[], [command(1)], [command(0, "npm run wrong")], [command(0), command(1)]]) {
    assert.notEqual((await new RuleBasedReviewer().review(handoff, execution, 2, [relay(2)], evidence)).verdict, "PASS");
  }
});

test("codex-exec testPlan is executed by the Relay parent and JSONL shell wrappers are log-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-parent-tests-"));
  const handoff = await exampleHandoff();
  handoff.workspace.root = directory; handoff.workspace.allowedPaths = ["src"];
  handoff.requestedOperations = [{ type: "read", target: "src", reason: "fixture", risk: "low" }];
  handoff.deliverables = []; handoff.testPlan = ["npm test"];
  handoff.acceptanceCriteria = [{ id: "parent", description: "parent test", verification: "fixture", verificationOwner: "executor" }];
  class CodexFixture implements Executor {
    readonly name = "codex-exec";
    async execute(_value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      context.onProcessHandle?.({ pid: 42, result: Promise.resolve({ exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null }), observe(observer) { observer({ stream: "stdout", chunk: JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe -Command npm test", exit_code: 1 } }) + "\n" }); return () => undefined; }, detach() {}, cancel() { return this.result; } });
      return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "parent", status: "pass", evidence: "fixture" }], tests: [{ command: "npm test", status: "failed", evidence: "untrusted executor claim" }], proposedOperations: [], simulated: false };
    }
  }
  class ParentRunner implements ProcessRunner {
    requests: ProcessRequest[] = [];
    async run(request: ProcessRequest): Promise<ProcessResult> { this.requests.push(request); return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: false }; }
    start(request: ProcessRequest) { const result = this.run(request); return { pid: 123, result, observe: () => () => undefined, detach() {}, cancel: () => result }; }
  }
  try {
    const runner = new ParentRunner(); const handle = await new RunStore(directory).createRun(handoff);
    const result = await new Relay(new CodexFixture(), new RuleBasedReviewer(), runner).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle });
    assert.equal(result.status, "COMPLETED"); assert.equal(result.attempts[0]?.review.tests[0]?.status, "passed");
    assert.equal(runner.requests.length, 1); assert.equal(runner.requests[0]?.stdin, "");
    const persisted = await handle.readTestEvidence(1); assert.equal(persisted[0]?.command, "npm test"); assert.equal(persisted[0]?.exitCode, 0);
    const events = await handle.readEvents(); assert.ok(events.some(({ type, payload }) => type === "codex.event" && JSON.stringify(payload).includes("pwsh.exe")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Relay parent verifier matrix fails closed for every non-success terminal state", async () => {
  const cases: Array<[string, ProcessResult]> = [
    ["exit 0", { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: false }],
    ["exit 1", { exitCode: 1, signal: null, stdout: "", stderr: "failed", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: false }],
    ["timeout", { exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: true, outputLimitExceeded: false, spawnError: null, cancelled: false }],
    ["cancel", { exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: true }],
    ["output limit", { exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: false, outputLimitExceeded: true, spawnError: null, cancelled: false }],
    ["spawn error", { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: "ENOENT", cancelled: false }],
  ];
  for (const [name, terminal] of cases) {
    const directory = await mkdtemp(join(tmpdir(), "qing-parent-matrix-"));
    try {
      const handoff = await exampleHandoff(); handoff.workspace.root = directory; handoff.workspace.allowedPaths = ["README.md"];
      handoff.requestedOperations = [{ type: "read", target: "README.md", reason: "fixture", risk: "low" }]; handoff.deliverables = []; handoff.testPlan = ["fixture command"];
      handoff.acceptanceCriteria = [{ id: "matrix", description: "matrix", verification: "fixture", verificationOwner: "executor" }];
      class MatrixExecutor implements Executor { readonly name = "codex-exec"; async execute(): Promise<ExecutionResult> { return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "matrix", status: "pass", evidence: "fixture" }], tests: [], proposedOperations: [], simulated: false }; } }
      class MatrixRunner implements ProcessRunner { async run(): Promise<ProcessResult> { return terminal; } start(request: ProcessRequest) { assert.equal(request.stdin, ""); const result = this.run(); return { pid: 8123, result, observe: () => () => undefined, detach() {}, cancel: () => result }; } }
      const handle = await new RunStore(directory).createRun(handoff);
      const result = await new Relay(new MatrixExecutor(), new RuleBasedReviewer(), new MatrixRunner()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 5 });
      assert.equal(result.attempts[0]?.review.tests[0]?.status, name === "exit 0" ? "passed" : "failed", name);
      const evidence = await handle.readTestEvidence(1); assert.equal(evidence.length, 1, name); assert.equal(evidence[0]?.command, "fixture command", name);
      const events = await handle.readEvents(); assert.equal(events.filter(({ type }) => type === "test.started").length, 1, name); assert.equal(events.filter(({ type }) => type === "test.exited").length, 1, name);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("test evidence is closed, bound, unique, current-iteration, and archives history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-test-integrity-"));
  try {
    const handoff = await exampleHandoff(); handoff.testPlan = ["exact command"];
    const handle = await new RunStore(directory).createRun(handoff);
    const valid = (iteration: number) => ({ version: "1.0" as const, source: "relay" as const, runId: handle.runId, handoffId: handoff.id, iteration, command: "exact command", exitCode: 0, startedAt: "2026-08-15T01:02:02.000Z", endedAt: "2026-08-15T01:02:03.000Z", timedOut: false, cancelled: false, outputLimitExceeded: false, spawnError: null, stdout: "", stderr: "", recordedAt: "2026-08-15T01:02:03.000Z" });
    await handle.writeTestEvidence(1, [valid(1)]); await handle.appendEvent("iteration.advanced", "executing", 2, "fixture"); await handle.writeTestEvidence(2, [valid(2)]);
    assert.equal((await handle.readTestEvidence(1))[0]?.iteration, 1); assert.equal((await handle.readTestEvidence(2))[0]?.iteration, 2);
    const invalid: unknown[] = [[], [valid(2), valid(2)], [{ ...valid(2), command: "wrong" }], [{ ...valid(2), runId: "wrong" }], [{ ...valid(2), iteration: 1 }], [{ ...valid(2), startedAt: "not-a-time" }], [{ ...valid(2), exitCode: "0" }], [{ ...valid(2), unknown: true }]];
    for (const value of invalid) await assert.rejects(handle.writeTestEvidence(2, value as any));
    assert.deepEqual(await handle.readTestEvidence(1), [valid(1)]); assert.deepEqual(await handle.readTestEvidence(2), [valid(2)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent cancellation remains terminal during parent-test Relay cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-test-cancel-race-"));
  try {
    const handoff = await exampleHandoff(); handoff.workspace.root = directory; handoff.workspace.allowedPaths = ["README.md"];
    handoff.requestedOperations = [{ type: "read", target: "README.md", reason: "fixture", risk: "low" }]; handoff.deliverables = []; handoff.testPlan = ["delayed test", "must not run"];
    handoff.acceptanceCriteria = [{ id: "cancel", description: "cancel", verification: "fixture", verificationOwner: "executor" }];
    class CancelExecutor implements Executor { readonly name = "codex-exec"; async execute(): Promise<ExecutionResult> { return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "cancel", status: "pass", evidence: "fixture" }], tests: [], proposedOperations: [], simulated: false }; } }
    let finish!: (value: ProcessResult) => void; const pending = new Promise<ProcessResult>((resolve) => { finish = resolve; }); let starts = 0;
    class DelayedRunner implements ProcessRunner { async run(): Promise<ProcessResult> { return pending; } start() { starts += 1; return { pid: 9456, result: pending, observe: () => () => undefined, detach() {}, cancel: () => pending }; } }
    let reviews = 0; class CountingReviewer extends RuleBasedReviewer { override async review(...args: Parameters<RuleBasedReviewer["review"]>) { reviews += 1; return super.review(...args); } }
    const store = new RunStore(directory); const handle = await store.createRun(handoff);
    const relay = new Relay(new CancelExecutor(), new CountingReviewer(), new DelayedRunner()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 5 });
    for (let attempt = 0; attempt < 100 && !(await handle.readEvents()).some(({ type }) => type === "test.started"); attempt += 1) await delay(2);
    await store.cancelRun(handle.runId, async (pid) => { assert.equal(pid, 9456); finish({ exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: true }); return true; });
    const result = await relay; assert.equal(result.status, "BLOCKED"); assert.equal(starts, 1); assert.equal(reviews, 0);
    const record = await handle.readRecord(); assert.equal(record.status, "cancelled"); assert.equal(record.processState, "cancelled");
    const events = await handle.readEvents(); assert.deepEqual(events.map(({ sequence }) => sequence), events.map((_, index) => index + 1)); assert.equal(events.at(-1)?.type, "run.cancelled");
    const summary = JSON.parse(await readFile(handle.artifacts.finalSummary, "utf8")); assert.equal(summary.status, "cancelled"); assert.equal(summary.processState, "cancelled");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("separate CLI processes observe and cancel a real Relay parent test", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-real-cli-cancel-"));
  const stateDirectory = join(directory, "state");
  const configPath = join(directory, "relay.json");
  const cliPath = join(process.cwd(), "dist", "src", "cli.js");
  const delayedCommand = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
  const secondCommand = process.platform === "win32" ? "Write-Output should-not-run" : "echo should-not-run";
  const runCli = async (args: string[]) => {
    const child = spawn(process.execPath, [cliPath, ...args, "--config", configPath], { cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
    return { exitCode, stdout, stderr, json: JSON.parse(stdout) as any };
  };
  class ParentExecutor implements Executor { readonly name = "codex-exec"; async execute(): Promise<ExecutionResult> { return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [], tests: [], proposedOperations: [], simulated: false }; } }
  class CountingReviewer extends RuleBasedReviewer { calls = 0; override async review(...args: Parameters<RuleBasedReviewer["review"]>) { this.calls += 1; return super.review(...args); } }
  try {
    await writeFile(configPath, JSON.stringify({ runtime: { stateDirectory } }), "utf8");
    const handoff = await exampleHandoff();
    handoff.id = "real-cli-cancel"; handoff.deliverables = []; handoff.acceptanceCriteria = []; handoff.testPlan = [delayedCommand, secondCommand]; handoff.requestedOperations = [];
    const store = new RunStore(stateDirectory); const handle = await store.createRun(handoff); const reviewer = new CountingReviewer();
    const relayPromise = new Relay(new ParentExecutor(), reviewer).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 20 });
    for (let attempt = 0; attempt < 500; attempt += 1) { const events = await handle.readEvents(); if (events.some(({ type }) => type === "test.started") && events.some(({ type }) => type === "test.heartbeat")) break; await delay(10); }
    const status = await runCli(["status", handle.runId]); const logs = await runCli(["logs", handle.runId]);
    assert.equal(status.exitCode, 0, status.stderr); assert.equal(logs.exitCode, 0, logs.stderr);
    assert.equal(status.json.record.processState, "running"); assert.ok(Number.isInteger(status.json.record.lastEvent.payload.pid));
    assert.ok(logs.json.some((event: any) => event.type === "test.started")); assert.ok(logs.json.some((event: any) => event.type === "test.heartbeat"));
    const activePid = status.json.record.lastEvent.payload.pid as number; const cancel = await runCli(["cancel", handle.runId]); assert.equal(cancel.exitCode, 0, cancel.stderr); assert.equal(cancel.json.status, "cancelled");
    const result = await relayPromise; assert.equal(result.status, "BLOCKED"); assert.equal(reviewer.calls, 0);
    assert.throws(() => process.kill(activePid, 0));
    const events = await handle.readEvents(); assert.equal(events.filter(({ type }) => type === "test.started").length, 1); assert.equal(events.filter(({ type }) => type === "test.exited").length, 1);
    assert.deepEqual(events.map(({ sequence }) => sequence), events.map((_, index) => index + 1)); assert.equal(events.at(-1)?.type, "run.cancelled");
    const record = await handle.readRecord(); const processMetadata = JSON.parse(await readFile(handle.artifacts.process, "utf8")); const summary = JSON.parse(await readFile(handle.artifacts.finalSummary, "utf8"));
    assert.equal(record.status, "cancelled"); assert.equal(processMetadata.state, "cancelled"); assert.equal(summary.status, "cancelled");
    await assert.rejects(readFile(join(handle.directory, "attempts", "1", "test-evidence.json"), "utf8"));
    const shell = process.platform === "win32" ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "/bin/sh";
    assert.equal(processMetadata.command, shell); assert.deepEqual(processMetadata.args, process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", delayedCommand] : ["-c", delayedCommand]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real Relay revision loop requires fresh second-iteration evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-two-round-"));
  const handoff = await exampleHandoff(); handoff.workspace.root = directory; handoff.workspace.allowedPaths = ["README.md"]; handoff.requestedOperations = [{ type: "read", target: "README.md", reason: "fixture", risk: "low" }];
  handoff.deliverables = []; handoff.testPlan = ["fixture-test"]; handoff.maxIterations = 2;
  handoff.acceptanceCriteria = [{ id: "fresh", description: "fresh", verification: "fixture", verificationOwner: "executor" }];
  class TwoRound implements Executor { readonly name = "codex-exec"; async execute(_h: Handoff, context: ExecutionContext): Promise<ExecutionResult> { const pass = context.iteration === 2; return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "fresh", status: pass ? "pass" : "fail", evidence: `iteration ${context.iteration}` }], tests: [], proposedOperations: [], simulated: false }; } }
  class PassingRunner implements ProcessRunner { async run(): Promise<ProcessResult> { return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null, cancelled: false }; } start(request: ProcessRequest) { const result = this.run(); return { pid: 124, result, observe: () => () => undefined, detach() {}, cancel: () => result }; } }
  try {
    const handle = await new RunStore(directory).createRun(handoff);
    const result = await new Relay(new TwoRound(), new RuleBasedReviewer(), new PassingRunner()).run(handoff, { maxIterations: 2, approvedGateIds: [], runHandle: handle });
    assert.equal(result.status, "COMPLETED"); assert.deepEqual(result.attempts.map(({ review }) => review.verdict), ["REVISE", "PASS"]);
    assert.deepEqual((await handle.readTestEvidence(2)).map(({ iteration }) => iteration), [2]);
    assert.deepEqual((await handle.readTestEvidence(1)).map(({ iteration }) => iteration), [1]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("passing Relay evidence cannot override any global Executor blocker", async () => {
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [
    { id: "relay-ac", description: "Relay observation", verification: "fixture", verificationOwner: "relay", relayVerification: { kind: "event-count", eventType: "process.started", operator: "eq", expected: 1 } },
    { id: "executor-ac", description: "Executor observation", verification: "fixture", verificationOwner: "executor" },
  ];
  handoff.deliverables = [{ path: "tests/fixture.test.ts", description: "fixture" }];
  handoff.testPlan = ["npm test"];
  const relayPass = { version: "1.0" as const, evidenceId: "relay-pass", source: "relay" as const, runId: "run", handoffId: handoff.id, criterionId: "relay-ac", iteration: 1, result: "pass" as const, evidence: "Observed by Relay.", recordedAt: "2026-08-15T01:02:03.000Z" };
  const baseline: ExecutionResult = {
    status: "succeeded", summary: "fixture", artifacts: [...handoff.deliverables],
    criteriaEvidence: [{ id: "relay-ac", status: "not_verified", evidence: "Relay-owned." }, { id: "executor-ac", status: "pass", evidence: "Executor observation." }],
    tests: [{ command: "npm test", status: "passed", evidence: "offline fixture" }], proposedOperations: [], simulated: false,
  };
  const cases: Array<[string, (execution: ExecutionResult) => void, RegExp]> = [
    ["failed", (value) => { value.status = "failed"; }, /Executor status was failed/],
    ["skipped", (value) => { value.status = "skipped"; }, /Executor status was skipped/],
    ["simulated", (value) => { value.simulated = true; }, /Simulated executor evidence/],
    ["failed test", (value) => { value.tests[0]!.status = "failed"; }, /Required test was failed/],
    ["not-run test", (value) => { value.tests[0]!.status = "not_run"; }, /Required test was not_run/],
    ["missing test", (value) => { value.tests = []; }, /Required test was not_run/],
    ["missing deliverable", (value) => { value.artifacts = []; }, /Missing deliverable/],
    ["proposed operation", (value) => { value.proposedOperations = [{ type: "network_access", target: "example.invalid", reason: "fixture", risk: "high" }]; }, /fresh safety-gate/],
    ["other criterion fail", (value) => { value.criteriaEvidence[1]!.status = "fail"; }, /executor-ac is fail/],
  ];
  for (const [name, mutate, expected] of cases) {
    const execution = structuredClone(baseline);
    mutate(execution);
    const review = await new RuleBasedReviewer().review(handoff, execution, 1, [relayPass]);
    assert.notEqual(review.verdict, "PASS", name);
    assert.match(review.findings.map(({ message }) => message).join("\n"), expected, name);
  }
});

test("malformed, misbound, unknown, replayed, and legacy evidence files fail closed without mutation", async () => {
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [{ id: "relay-ac", description: "Relay observation", verification: "fixture", verificationOwner: "relay", relayVerification: { kind: "event-count", eventType: "process.started", operator: "eq", expected: 1 } }];
  handoff.deliverables = []; handoff.testPlan = [];
  const directory = await mkdtemp(join(tmpdir(), "qing-corrupt-evidence-"));
  try {
    const handle = await new RunStore(directory).createRun(handoff);
    const valid = { version: "1.0", evidenceId: "ev", source: "relay", runId: handle.runId, handoffId: handoff.id, criterionId: "relay-ac", iteration: 1, result: "pass", evidence: "fixture", recordedAt: "2026-08-15T01:02:03.000Z" };
    const corruptions = [
      "{malformed\n",
      JSON.stringify({ ...valid, runId: "wrong-run" }) + "\n",
      JSON.stringify({ ...valid, handoffId: "wrong-handoff" }) + "\n",
      JSON.stringify({ ...valid, criterionId: "unknown" }) + "\n",
      JSON.stringify(valid) + "\n" + JSON.stringify(valid) + "\n",
      JSON.stringify({ legacy: true }) + "\n",
    ];
    for (const contents of corruptions) {
      await writeFile(handle.artifacts.criterionEvidence, contents, "utf8");
      const before = await readFile(handle.artifacts.criterionEvidence);
      await assert.rejects(handle.readCriterionEvidence());
      assert.deepEqual(await readFile(handle.artifacts.criterionEvidence), before);
    }
    await writeFile(handle.artifacts.criterionEvidence, "", "utf8");
    assert.deepEqual(await handle.readCriterionEvidence(), []);
    assert.equal((await new RuleBasedReviewer().review(handoff, {
      status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "relay-ac", status: "not_verified", evidence: "Relay-owned." }], tests: [], proposedOperations: [], simulated: false,
    }, 1, [])).verdict, "REVISE");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Relay cannot complete when the persisted criterion evidence journal is malformed", async () => {
  const handoff = await exampleHandoff();
  handoff.acceptanceCriteria = [{ id: "executor-ac", description: "Executor observation", verification: "fixture", verificationOwner: "executor" }];
  handoff.deliverables = [];
  handoff.testPlan = [];
  const directory = await mkdtemp(join(tmpdir(), "qing-invalid-journal-"));
  class PassingExecutor implements Executor {
    readonly name = "passing-fixture";
    async execute(): Promise<ExecutionResult> {
      return { status: "succeeded", summary: "fixture", artifacts: [], criteriaEvidence: [{ id: "executor-ac", status: "pass", evidence: "Executor observation." }], tests: [], proposedOperations: [], simulated: false };
    }
  }
  try {
    const handle = await new RunStore(directory).createRun(handoff);
    await writeFile(handle.artifacts.criterionEvidence, "{malformed\n", "utf8");
    const before = await readFile(handle.artifacts.criterionEvidence);
    const result = await new Relay(new PassingExecutor(), new RuleBasedReviewer()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle });
    assert.equal(result.status, "MAX_ITERATIONS");
    assert.equal(result.attempts[0]?.review.verdict, "REVISE");
    assert.match(result.attempts[0]?.review.findings.map(({ message }) => message).join("\n"), /failed validation/);
    assert.deepEqual(await readFile(handle.artifacts.criterionEvidence), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("RunStore initializes parseable Git artifact placeholders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-run-artifacts-"));
  try {
    const handle = await new RunStore(directory).createRun(await exampleHandoff());
    for (const [path, role] of [
      [handle.artifacts.gitBefore, "git-before"],
      [handle.artifacts.gitAfter, "git-after"],
      [handle.artifacts.gitAudit, "git-audit"],
    ] as const) {
      const text = await readFile(path, "utf8");
      assert.ok(text.endsWith("\n"));
      const artifact = JSON.parse(text);
      assert.equal(artifact.version, "1.0");
      assert.equal(artifact.artifactRole, role);
      assert.equal(artifact.status, "not-applicable");
      assert.ok(artifact.reason.length > 0);
    }
    const collected = { version: "1.0", artifactRole: "git-before", status: "collected", head: "abc123" };
    await handle.writeGitBefore(collected);
    await handle.finalize("blocked", "blocked", 0, "not-started", "Fixture terminal state.");
    assert.deepEqual(JSON.parse(await readFile(handle.artifacts.gitBefore, "utf8")), collected);
    const summary = JSON.parse(await readFile(handle.artifacts.finalSummary, "utf8"));
    for (const path of [summary.artifacts.gitBefore, summary.artifacts.gitAfter, summary.artifacts.gitAudit]) {
      const text = await readFile(path, "utf8");
      assert.ok(text.endsWith("\n"));
      JSON.parse(text);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("short process does not emit a heartbeat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-relay-short-"));
  const handoff = await exampleHandoff();
  class ShortExecutor implements Executor {
    readonly name = "short";
    async execute(value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      context.onProcessStart?.({ pid: 7, command: process.execPath, args: [], cwd: directory, startedAt: new Date().toISOString() });
      context.onProcessExit?.({ pid: 7, endedAt: new Date().toISOString(), exitCode: 1, signal: null, cancelled: false, timedOut: false, outputLimitExceeded: false });
      return { status: "failed", summary: "fixture", artifacts: [], criteriaEvidence: value.acceptanceCriteria.map(({ id }) => ({ id, status: "fail", evidence: "fixture" })), tests: [], proposedOperations: [], simulated: false };
    }
  }
  try {
    const store = new RunStore(directory);
    const handle = await store.createRun(handoff);
    await new Relay(new ShortExecutor(), new RuleBasedReviewer()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 20 });
    await delay(40);
    assert.equal((await store.readEvents(handle.runId)).filter(({ type }) => type === "process.heartbeat").length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor exception clears heartbeat timer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-relay-error-"));
  const handoff = await exampleHandoff();
  class ThrowingExecutor implements Executor {
    readonly name = "throwing";
    async execute(_value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      context.onProcessStart?.({ pid: 8, command: process.execPath, args: [], cwd: directory, startedAt: new Date().toISOString() });
      await delay(25);
      throw new Error("fixture executor failure");
    }
  }
  try {
    const store = new RunStore(directory);
    const handle = await store.createRun(handoff);
    await assert.rejects(
      new Relay(new ThrowingExecutor(), new RuleBasedReviewer()).run(handoff, { maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 10 }),
      /fixture executor failure/,
    );
    const count = (await store.readEvents(handle.runId)).length;
    await delay(30);
    assert.equal((await store.readEvents(handle.runId)).length, count);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Relay persists ordered heartbeats and stops them after process exit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-relay-heartbeat-"));
  const handoff = await exampleHandoff();
  handoff.deliverables = [];
  let releaseProcess!: () => void;
  const processMayExit = new Promise<void>((resolve) => { releaseProcess = resolve; });
  let runPromise: ReturnType<Relay["run"]> | undefined;
  class DelayedExecutor implements Executor {
    readonly name = "delayed";
    async execute(value: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
      const startedAt = new Date().toISOString();
      context.onProcessStart?.({ pid: 4242, command: process.execPath, args: [], cwd: directory, startedAt });
      await processMayExit;
      context.onProcessExit?.({ pid: 4242, endedAt: new Date().toISOString(), exitCode: 0, signal: null, cancelled: false, timedOut: false, outputLimitExceeded: false });
      return {
        status: "succeeded", summary: "Delayed fixture completed.", artifacts: [...value.deliverables],
        criteriaEvidence: value.acceptanceCriteria.map(({ id }) => ({ id, status: "pass", evidence: "fixture" })),
        tests: value.testPlan.map((command) => ({ command, status: "passed", evidence: "fixture" })),
        proposedOperations: [], simulated: false,
      };
    }
  }
  try {
    const store = new RunStore(directory);
    const handle = await store.createRun(handoff);
    runPromise = new Relay(new DelayedExecutor(), new RuleBasedReviewer()).run(handoff, {
      maxIterations: 1, approvedGateIds: [], runHandle: handle, heartbeatIntervalMs: 20,
    });
    // Observe persisted execution, not scheduler speed. Hold the fixture open
    // until both heartbeats are visible even on a loaded CI runner.
    void runPromise.catch(() => {});
    const deadline = Date.now() + 5000;
    let activeRecord = await handle.readRecord();
    while (activeRecord.lastEvent?.type !== "process.heartbeat" ||
           (await store.readEvents(handle.runId)).filter(({ type }) => type === "process.heartbeat").length < 2) {
      assert.ok(Date.now() < deadline, "Timed out waiting for persisted execution heartbeats.");
      await delay(10);
      activeRecord = await handle.readRecord();
    }
    assert.equal(activeRecord.phase, "executing");
    assert.equal(activeRecord.iteration, 1);
    assert.equal(activeRecord.processState, "running");
    assert.equal(activeRecord.lastEvent?.type, "process.heartbeat");
    assert.ok(Date.parse(activeRecord.updatedAt) >= Date.parse(activeRecord.startedAt));
    releaseProcess();
    await runPromise;
    const events = await store.readEvents(handle.runId);
    const heartbeats = events.filter((event) => event.type === "process.heartbeat");
    assert.ok(heartbeats.length >= 2);
    assert.ok(heartbeats.every((event) => event.payload?.iteration === 1 && event.payload?.pid === 4242));
    assert.deepEqual(events.map(({ sequence }) => sequence), events.map((_, index) => index + 1));
    const exitIndex = events.findIndex((event) => event.type === "process.exited");
    assert.ok(exitIndex > events.map((event) => event.type).lastIndexOf("process.heartbeat"));
    const countAfterExit = events.length;
    await delay(45);
    assert.equal((await store.readEvents(handle.runId)).length, countAfterExit);
    assert.equal((await handle.readRecord()).status, "completed");
  } finally {
    // Never delete the journal while the Relay is still writing to it.
    releaseProcess();
    await runPromise?.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
