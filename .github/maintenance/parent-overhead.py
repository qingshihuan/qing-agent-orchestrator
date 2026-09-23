"""Focused v0.13 changes. No user traces, pricing assumptions or permission changes."""
import json
import subprocess
from pathlib import Path

BASE = 'f5bc980173dc3117ac035f0def26483885a5ade4'
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
allowed = {'.github/maintenance/parent-overhead.py', '.github/workflows/prepare-parent-overhead.yml'}
changed = set(subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines())
assert changed <= allowed, f'Unexpected concurrent changes: {changed}'

def read(path): return Path(path).read_text(encoding='utf-8')
def write(path, value):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(value.encode('utf-8'))
def replace(path, old, new):
    value = read(path)
    assert value.count(old) == 1, f'Unexpected source: {path}: {old[:100]}'
    write(path, value.replace(old, new, 1))
def append(path, value): write(path, read(path).rstrip()+'\n\n'+value.strip()+'\n')

write('src/delegation-benefit.ts', r'''/** Cheap routing hints, never permission grants or a model latency prediction. */
export interface DelegationEvidence {
  boundary: "whole-task" | "independent-slice" | "coupled" | "unknown";
  contract: "fixed" | "unknown";
  acceptance: "ready" | "unknown";
  work: "substantial" | "small" | "unknown";
  parentWork: "integration-only" | "independent-work" | "blocked" | "duplicate-work" | "dominates" | "unknown";
}

export function delegationDeclined(text: string): boolean {
  return /(?:不要|不必|无需|禁止|不得|不创建|不使用).{0,10}(?:委派|子代理|子智能体|subagent)|(?:do not|don't|without|no)\s+(?:\w+\s+){0,3}(?:delegat\w*|subagents?)/i.test(text);
}

/** Conservative text fallback; the parent may supply facts already observed in this phase.
 * Missing facts mean Direct, not an extra model call to estimate those facts.
 */
export function assessDelegationBenefit(text: string, evidence?: DelegationEvidence): { worthwhile: boolean; reason: string } {
  if (delegationDeclined(text)) return { worthwhile: false, reason: "delegation-declined" };
  if (!evidence) {
    const complete = /独立(?:交付|实现|完成).{0,24}(?:完整|整个)|(?:whole[- ]task|end[- ]to[- ]end|self-contained)\s+(?:implementation|deliverable)/i.test(text);
    const contract = /(?:固定|冻结|既定|明确)的?(?:接口|规格|契约)|(?:fixed|frozen)\s+(?:interface|specification|contract)/i.test(text);
    const acceptance = /(?:固定|冻结|既定|现有)的?验收测试|(?:fixed|frozen|existing)\s+acceptance\s+tests/i.test(text);
    const integration = /父(?:任务|代理)只(?:做|负责)(?:集成|验收)|parent\s+(?:only\s+)?(?:integrates|verifies)/i.test(text);
    const costly = /紧密耦合|相互依赖|仅改一行|小辅助函数|父(?:任务|代理).{0,8}(?:仍负责大部分|阻塞|重复实现)|tightly[- ]coupled|tiny\s+helper|one[- ]line|parent\s+(?:blocked|duplicates)/i.test(text);
    if (!(complete && contract && acceptance && integration) || costly) {
      return { worthwhile: false, reason: "delegation-benefit-not-established" };
    }
    evidence = { boundary: "whole-task", contract: "fixed", acceptance: "ready", work: "substantial", parentWork: "integration-only" };
  }
  if (evidence.contract !== "fixed" || evidence.acceptance !== "ready" || evidence.work !== "substantial") {
    return { worthwhile: false, reason: "delegation-contract-or-work-insufficient" };
  }
  const whole = evidence.boundary === "whole-task" && evidence.parentWork === "integration-only";
  const parallelSlice = evidence.boundary === "independent-slice" && evidence.parentWork === "independent-work";
  return whole || parallelSlice
    ? { worthwhile: true, reason: "substantial-independent-deliverable" }
    : { worthwhile: false, reason: "parent-coordination-would-dominate" };
}
''')
replace('src/orchestration-policy.ts', 'import { createHash } from "node:crypto";', 'import { createHash } from "node:crypto";\nimport { assessDelegationBenefit, delegationDeclined, type DelegationEvidence } from "./delegation-benefit.js";')
replace('src/orchestration-policy.ts', '  config?: OrchestrationConfig | undefined;', '  config?: OrchestrationConfig | undefined;\n  delegationEvidence?: DelegationEvidence | undefined;')
replace('src/orchestration-policy.ts', '''  const needsLite = explicitDelegation.test(text)
    || input.complexity.band === "complex"
    || input.complexity.band === "high-risk"
    || input.complexity.scope === "multi-step"
    || input.category === "mixed";''', '''  // Full safety/review requirements above always take precedence. Complexity
  // alone cannot justify paying for an extra parent/child conversation.
  const delegation = assessDelegationBenefit(text, input.delegationEvidence);
  const requestedDelegation = explicitDelegation.test(text) && !delegationDeclined(text);
  const needsLite = requestedDelegation || delegation.worthwhile;''')
replace('src/orchestration-policy.ts', 'reasons: [explicitDelegation.test(text) ? "explicit-delegation-request" : "bounded-complexity"],', 'reasons: [requestedDelegation ? "explicit-delegation-request" : delegation.reason],')
replace('src/orchestration-policy.ts', 'reasons: [input.route === "chat" ? "parent-answer" : "safe-single-scope-work"],', 'reasons: [input.route === "chat" ? "parent-answer" : "direct-retains-context", delegation.reason],')
replace('src/task-router.ts', 'import { randomUUID } from "node:crypto";', 'import { randomUUID } from "node:crypto";\nimport type { DelegationEvidence } from "./delegation-benefit.js";')
replace('src/task-router.ts', '  orchestration?: OrchestrationConfig;', '  orchestration?: OrchestrationConfig;\n  /** Facts already observed by the calling parent; not user approvals or a paid preflight. */\n  delegationEvidence?: DelegationEvidence;')
replace('src/task-router.ts', 'complexity, signals, config: options.orchestration });', 'complexity, signals, config: options.orchestration, delegationEvidence: options.delegationEvidence });')
replace('src/task-router.ts', '目标是范围明确、可逆的单一工作，由父任务直接完成并验证。', '由父任务保留上下文直接完成并验证；步骤或复杂度本身不证明委派收益。')
replace('src/cli.ts', 'Complete and, when executable, verify the in-scope work directly. No child, model allocation, Handoff approval, or CLI task was created.', 'Proceed directly to relevant work and required tests; do not spend another turn confirming this route, running a planner or probing models. No child or CLI task was created.')
replace('src/cli.ts', 'Create at most one Executor child, perform targeted parent verification, and allow at most one revision; no independent Reviewer or plan approval is required.', 'Delegate one complete implementation-and-test unit with fixed interfaces. Do not duplicate child work or inspect live traces; collect its final result, independently verify integration once per unchanged snapshot, and allow at most one revision. No plan approval is required.')

# A small entry contract: model tables, migration instructions and detailed
# coordination load only after delegation is justified. No new reference files.
entry = '''# Qing

Qing decides Direct/Lite/Full; no routine user choice or plan approval.

## Direct fast path
Unless Full is required or delegation has a clear net benefit, do the task in this parent NOW. Multiple steps alone are not a benefit. For Direct, do not preload references or schemas, call dispatch/start/doctor/models, allocate a child, or emit a routing-only reply. Read relevant files, implement and verify. Batch independent reads/checks with separate failure evidence; do not reread unchanged text. Put the route in the final outcome, not a separate model round.

## Delegate only when useful
Lite needs a substantial complete deliverable, fixed interfaces and ready acceptance tests, leaving the parent only integration or genuinely independent work. A small helper while the parent keeps most work is not enough. Unknown benefit defaults Direct without an estimator model call. Explicit delegation is honored within existing bounds.
For Lite read only the Lite section of [orchestrator-spec.md](references/orchestrator-spec.md): one Executor plus parent acceptance, at most one revision. Do not duplicate child implementation or stream its trace into the parent. Use one final result/real blocker; test changed integration once per snapshot.
Full remains required for high-risk/external effects, cross-system or genuinely parallel work, release/deploy or explicit Full. Load [Handoff](references/handoff-protocol.md), [Reviewer](references/reviewer-rules.md), SCHEMAS. Retain pending independent-review obligations through de-escalation; defaults two children/one revision. Never skip required review or verification. Reuse evidence only for the same unchanged inputs, commands and environment.

## Authority
Use effective host permissions and exact task scope, not a second Qing approval system. on-request uses host approval; never means no new permission prompt, not unrestricted access. Unknown/denied access stops affected work; no settings edits, forged grants or backend bypass. For consequential/uncertain effects read [safety-gates.md](references/safety-gates.md). Preserve unrelated work. Report actual artifacts, verification, limits and executionOwner; a plan/mock/heartbeat is not completion.
'''
for name in ['qing-agent-orchestrator', 'qing-agent-orchestrator-full']:
    full = name.endswith('-full')
    prefix = 'runtime/' if full else ''
    links = '[Handoff schema]('+prefix+'schemas/handoff.schema.json) and [Review schema]('+prefix+'schemas/review.schema.json)'
    header = '---\nname: '+name+'\ndescription: Qing chooses direct work or worthwhile delegation; minimize parent rounds and total cost while preserving host permissions and acceptance.\n---\n\n'
    content = header + entry.replace('SCHEMAS', links)
    if full:
        content += '\nOnly for a real process-backend need read [execution-modes.md](references/execution-modes.md) and [codex-exec.md](references/codex-exec.md). Standalone Relay retains execution opt-in and exact effect gates; it cannot infer host grants. No automatic install/login. Prefer --compact and cursor log pages; no routine probes or unchanged polling.\n'
    write('.agents/skills/'+name+'/SKILL.md', content)
    spec = '.agents/skills/'+name+'/references/orchestrator-spec.md'
    s = read(spec)
    s = s.replace('Bounded multi-step or complex work that benefits from one delegation', 'Substantial independent deliverable with fixed contract and net delegation benefit')
    write(spec, s)
    append(spec, '''## Lite execution: reduce parent work (v0.13)

This section supersedes complexity-only delegation guidance. Qing decides; the user is not asked to select a tier. Do not launch a paid Planner/estimator just to choose a route.

1. Before spawning, identify a fixed interface, relevant paths, acceptance commands, preservation/authority limits and one substantial unit. Prefer the whole implementation plus its tests when the parent only needs final acceptance. A slice is useful only when interfaces are fixed and the parent can do different independent work. If the parent will remain blocked, duplicate the child's implementation, or still do almost all substantive work, stay Direct. Unknown benefit also stays Direct. Risk/Full and explicit bounded user requests still take precedence.
2. Send that compact contract once. Include relevant type/validation edge cases from the actual specification, not newly invented requirements. The Executor implements and runs the agreed checks before returning. A failing check is diagnosed locally; do not return an unfinished happy-path implementation and ask the parent to debug it for you.
3. While the child works, do only disjoint useful work or wait for a terminal result/blocker. Do not read its entire conversation or poll progress files. A parent notification is not a reason for another model planning round.
4. Return changed paths, interface decisions, exact test commands/results, remaining failures and evidence locations. Keep logs on disk; transmit a bounded failure excerpt and retrieve more only when needed. No hard truncation of an unresolved safety or correctness issue.
5. Parent inspects the changed interfaces/diff and runs the required independent acceptance/integration checks. Do not redo child implementation. Reuse a successful check only if the code, dependencies, command and environment are unchanged; a parent's test is not replaced by child self-report. Full independent review remains separate. Fix affected work then rerun affected/required acceptance; do not rerun an unchanged full suite merely for a summary.
6. At most one revision brief containing all remaining findings, not a per-file dialogue. Ordinary task failure is not model unavailability. When recovery is needed choose one bounded revision or parent takeover after the child has stopped, not overlapping writes or an agent ladder. More calls for a real unresolved defect are reported, never hidden by falsely claiming completion.

Model selection remains GPT-6-only: Luna/low for truly trivial delegated work, Luna/medium for normal bounded work, Sol/medium for complex planning and Sol/high for complex execution/review; Astra is reserved for demanding work and the existing explicit fallback chain. Parent model is unchanged. Verify actual pair availability only when delegating. Same-backend scope-preserving fallback uses existing rules, not a new authorization. Do not eagerly probe backup models or lower mandatory review quality for price.

These are routing and instruction policies, not enforcement of host token budgets or predictions of actual model speed. DelegationEvidence supplied to the pure router describes observed work boundaries; it cannot grant permissions, erase Full requirements or replace tests.
''')

# Existing Lite-path tests now explicitly request Lite. Preserve their assertions
# and add separate regressions proving the former implicit trigger stays Direct.
for p in ['tests/task-router.test.ts', 'tests/host-permissions.test.ts', 'tests/phase-reclassification.test.ts']:
    source = read(p)
    old = '先规划接口，然后实现并测试'
    assert old in source, p
    write(p, source.replace(old, '使用 Qing Lite：先规划接口，然后实现并测试'))
p = 'tests/v0.7-efficiency.test.ts'
replace(p, 'const mediumTask = "先重构认证接口，然后实现缓存并运行相关测试";', 'const mediumTask = "使用 Qing Lite：先重构认证接口，然后实现缓存并运行相关测试";')
replace(p, 'routes short and long coupled work Direct and keeps medium work Lite', 'routes coupled work Direct and preserves explicitly requested Lite')
# Model policy remains validated, but it must no longer occupy every Direct input.
replace('tests/astra-efficiency.test.ts', '    assert.match(source, /Astra is reserved/);', '    const policy = await readFile(".agents/skills/"+name+"/references/orchestrator-spec.md", "utf8");\n    assert.match(policy, /Astra is reserved/);')

write('tests/parent-overhead.test.ts', r'''import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessDelegationBenefit, type DelegationEvidence } from "../src/delegation-benefit.js";
import { routeTask } from "../src/task-router.js";
import { decideOrchestration, reclassifyRemainingPhase, defaultOrchestrationConfig } from "../src/orchestration-policy.js";
import { NodeProcessRunner } from "../src/process-runner.js";
const evidence: DelegationEvidence = { boundary: "whole-task", contract: "fixed", acceptance: "ready", work: "substantial", parentWork: "integration-only" };
const sequential = "先规划接口，然后实现并测试";
const independent = "按固定接口独立交付完整模块并通过既定验收测试，父任务只做集成验收";

test("ordinary sequential work no longer buys an extra delegation by complexity alone", () => {
  for (const task of [sequential, "先重构认证接口，然后实现缓存并运行相关测试"]) {
    const decision = routeTask(task);
    assert.equal(decision.orchestration.tier, "direct");
    assert.equal(decision.orchestration.childAgentBudget, 0);
    assert.equal(decision.orchestration.modelSelectionRequired, false);
    assert.equal(decision.orchestration.parentVerification, true);
    assert.equal(decision.execution.delegationTarget, "outer-session");
  }
});
test("score and mixed category alone do not prove an economic benefit", () => {
  for (const band of ["normal", "complex", "high-risk"] as const) {
    const decision = decideOrchestration({ text: sequential, route: "hybrid", category: "mixed", signals: [], complexity: { score: 90, band, category: "mixed", role: "planner", risk: "medium", scope: "multi-step", signals: [], reasons: [] } });
    assert.equal(decision.tier, "direct");
  }
});
test("unknown evidence defaults Direct without requesting an estimator", () => {
  assert.equal(assessDelegationBenefit("实现复杂模块").worthwhile, false);
  assert.equal(assessDelegationBenefit("实现模块", {} as DelegationEvidence).worthwhile, false);
});
test("one substantial whole implementation can still use Lite automatically", () => {
  const decision = routeTask("实现模块", { delegationEvidence: evidence });
  assert.equal(decision.orchestration.tier, "lite");
  assert.equal(decision.orchestration.childAgentBudget, 1);
  assert.equal(decision.orchestration.maxRevisions, 1);
  assert.equal(decision.orchestration.parentVerification, true);
});
test("clear fixed-contract text supports automatic Lite without a user routing flag", () => {
  assert.equal(routeTask(independent).orchestration.tier, "lite");
});
test("missing acceptance, unknown contract and tiny slices remain Direct", () => {
  for (const overrides of [{ acceptance: "unknown" }, { contract: "unknown" }, { work: "small" }, { work: "unknown" }] as const) {
    assert.equal(routeTask("实现模块", { delegationEvidence: { ...evidence, ...overrides } }).orchestration.tier, "direct");
  }
});
test("blocked, duplicate or dominant parent work rejects a cheap-child-only argument", () => {
  for (const parentWork of ["blocked", "duplicate-work", "dominates", "unknown"] as const) {
    assert.equal(assessDelegationBenefit("实现模块", { ...evidence, parentWork }).worthwhile, false);
  }
});
test("a substantial slice is useful only while the parent does disjoint work", () => {
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "independent-slice", parentWork: "independent-work" }).worthwhile, true);
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "independent-slice" }).worthwhile, false);
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "coupled" }).worthwhile, false);
});
test("explicit bounded delegation is respected but negated delegation is not forced", () => {
  assert.equal(routeTask("使用 Qing Lite："+sequential).orchestration.tier, "lite");
  assert.equal(routeTask("不要创建子智能体，"+sequential).orchestration.tier, "direct");
  assert.equal(assessDelegationBenefit("do not delegate; implement the task", evidence).worthwhile, false);
});
test("Full risk, parallel scope, explicit CLI and configured review always outrank savings", () => {
  for (const task of ["实现修复并部署到生产环境", "推送到 origin/main", "读取命名密钥", "同时修改前后端和数据库服务", "并行处理多个独立工作流", "使用完整 Qing 并安排独立 Reviewer 实现功能", "使用 CLI 完成任务"]) {
    const decision = routeTask(task, { delegationEvidence: { ...evidence, work: "small" } });
    assert.equal(decision.orchestration.tier, "full", task);
    assert.equal(decision.orchestration.independentReviewer, true, task);
  }
  assert.equal(routeTask(sequential, { orchestration: { ...defaultOrchestrationConfig, mode: "full" } }).orchestration.tier, "full");
});
test("de-escalating costly delegation never erases pending independent review", () => {
  const decision = routeTask(sequential);
  const input = { text: sequential, route: decision.route, category: decision.category, complexity: decision.complexity, signals: decision.signals, state: { previousTier: "full" as const, pendingIndependentReview: true, unacceptedHighRiskArtifact: true } };
  const implementation = reclassifyRemainingPhase({ ...input, milestone: "before-child-creation" });
  assert.equal(implementation.decision.tier, "direct");
  assert.equal(implementation.state.pendingIndependentReview, true);
  const review = reclassifyRemainingPhase({ ...input, state: implementation.state, milestone: "before-review" });
  assert.equal(review.decision.independentReviewer, true);
  assert.equal(review.decision.tier, "full");
});
test("actual sequential dispatch/start never start a Planner, write a Handoff or probe a model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-parent-cost-"));
  try {
    const config = join(directory, "config.json");
    const handoff = join(directory, "unexpected-handoff.json");
    await writeFile(config, JSON.stringify({ executor: { codexExec: { command: "qing-must-not-start-a-model" } } }));
    const runner = new NodeProcessRunner();
    for (const command of ["dispatch", "start"]) {
      const result = await runner.run({ command: process.execPath, args: ["dist/src/cli.js", command, "--task", sequential, "--workspace", directory, "--config", config, "--out", handoff, "--compact"], cwd: process.cwd(), stdin: "", timeoutMs: 20000, maxOutputBytes: 200000 });
      assert.equal(result.exitCode, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "DIRECT_EXECUTION_REQUIRED");
      assert.equal(output.model, null);
      assert.equal(output.modelProbe, "not-applicable");
      assert.equal(output.handoffPath, null);
    }
    await assert.rejects(access(handoff));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("entry contracts keep Direct free of control-plane work and defer model policy", async () => {
  for (const name of ["qing-agent-orchestrator", "qing-agent-orchestrator-full"]) {
    const entry = await readFile(".agents/skills/"+name+"/SKILL.md", "utf8");
    assert.match(entry, /## Direct fast path/);
    assert.match(entry, /do not preload references or schemas, call dispatch\/start\/doctor\/models/);
    assert.match(entry, /not a separate model round/);
    assert.match(entry, /Unknown benefit defaults Direct/);
    assert.match(entry, /Never skip required review or verification/);
    assert.ok(Buffer.byteLength(entry) < (name.endsWith("-full") ? 3300 : 2900));
  }
});
test("Lite requires tested whole units, no duplicate implementation and independent parent acceptance", async () => {
  for (const name of ["qing-agent-orchestrator", "qing-agent-orchestrator-full"]) {
    const policy = await readFile(".agents/skills/"+name+"/references/orchestrator-spec.md", "utf8");
    assert.match(policy, /implements and runs the agreed checks before returning/);
    assert.match(policy, /Do not redo child implementation/);
    assert.match(policy, /parent's test is not replaced by child self-report/);
    assert.match(policy, /At most one revision brief/);
    assert.match(policy, /not enforcement of host token budgets/);
  }
});
''')

package = json.loads(read('package.json'))
assert package['version'] == '0.12.0'
package['version'] = '0.13.0'
package['scripts']['test'] += ' dist/tests/parent-overhead.test.js'
write('package.json', json.dumps(package, ensure_ascii=False, indent=2)+'\n')
lock = json.loads(read('package-lock.json'))
lock['version'] = lock['packages']['']['version'] = '0.13.0'
write('package-lock.json', json.dumps(lock, ensure_ascii=False, indent=2)+'\n')

write('scripts/measure-parent-overhead.mjs', r'''// Deterministic source/contract comparison, NOT a connected-model benchmark.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { decideOrchestration } from "../dist/src/orchestration-policy.js";
const baseline = "f5bc980173dc3117ac035f0def26483885a5ade4";
const oldJs = execFileSync("git", ["show", baseline+":.agents/skills/qing-agent-orchestrator-full/runtime/dist/src/orchestration-policy.js"], { encoding: "utf8" });
const old = await import("data:text/javascript;base64,"+Buffer.from(oldJs).toString("base64"));
const bytes = text => Buffer.byteLength(text.replace(/\r\n/g,"\n"));
const scenarios = [
  ["sequential-safe", "先规划接口，然后实现并测试", []],
  ["fixed-complete-unit", "按固定接口独立交付完整模块并通过既定验收测试，父任务只做集成验收", []],
  ["explicit-lite", "使用 Qing Lite：先规划接口，然后实现并测试", []],
  ["high-effect", "实现修复并部署到生产环境", ["infrastructure"]],
].map(([name,text,signals]) => {
  const input = {text,signals,route:"hybrid",category:"mixed",complexity:{score:45,band:"complex",category:"mixed",role:"planner",risk:"medium",scope:"multi-step",signals:[],reasons:[]}};
  const before = old.decideOrchestration(input), after = decideOrchestration(input);
  return {name,before:{tier:before.tier,childBudget:before.childAgentBudget},after:{tier:after.tier,childBudget:after.childAgentBudget},independentReviewPreserved:before.independentReviewer===after.independentReviewer};
});
const skills = Object.fromEntries(["qing-agent-orchestrator","qing-agent-orchestrator-full"].map(name=>{
  const path=".agents/skills/"+name+"/SKILL.md";
  return [name,{beforeBytes:bytes(execFileSync("git",["show",baseline+":"+path],{encoding:"utf8"})),afterBytes:bytes(readFileSync(path,"utf8"))}];
}));
const result = {baseline,method:"UTF-8 entry bytes and pure routing on synthetic fixed inputs; no host/model calls",skills,scenarios,limits:["Not a replay of the supplied six task runs: original fixtures and per-request measurements were not supplied","No measured total tokens, pricing, success rate or wall-clock speed improvement","Child budgets are decisions, not counts of actual executions"]};
writeFileSync("docs/parent-overhead-measurements.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
''')
write('docs/parent-overhead.md', '''# Parent overhead: report-driven changes (v0.13)

The supplied v0.12 study ran one solo and one Qing trial per size. Short and medium used Direct; the long trial used Lite. All Qing trials took longer and consumed more total tokens. The long trial's inexpensive child did not offset additional parent requests, integration and revision. A short trial's lower cache-priced equivalent cost did not imply less work. This motivates changing parent behavior, not a claim that delegation never helps.

## Changes

- Direct starts relevant work immediately: no separate route-only response, mechanical dispatch/start/doctor, model inventory or extra reference load. The parent may batch independent useful reads/checks, but preserves their error evidence and scope.
- The pure router no longer promotes safe work to Lite merely because it is multi-step, complex or mixed. It needs a substantial independently verifiable unit with fixed contract and a nonduplicating parent plan, or an explicit delegation request. Missing economic evidence means Direct without a paid estimation round. Natural-language recognition is conservative; an already-informed caller may supply DelegationEvidence through routeTask options. These facts cannot weaken Full/safety gates.
- Lite aims to transfer substantial implementation plus testing, not a tiny helper while the expensive parent does everything else. Parent work is limited to useful disjoint work and final independent acceptance; do not consume live child transcripts or repeat its implementation. Group remaining defects into one revision brief within the existing budget.
- Do not reinterpret cheaper model rates as lower total cost. Include parent and child requests, retries and verification. Keep cached, uncached-equivalent and total-token measures distinct.

## What is and is not measured

`scripts/measure-parent-overhead.mjs` compares the actual v0.12 entry text and pure routing function against this source on synthetic inputs. It measures UTF-8 bytes and planned budgets, not actual task latency or billed tokens. Six supplied task summaries are not enough to reconstruct the fixtures or attribute every extra parent call to one instruction. No raw task IDs, private paths or original report were copied into this public repository.

The original fixtures, immutable acceptance tests and per-request traces were not attached to this change. Do not report the original six tasks as re-run, or predict a savings percentage. Node unit tests, exact package checks and offline entry-point smoke tests validate implementation behavior, not host obedience or model performance.

## Next connected comparison protocol

Use exactly the same frozen fixtures and acceptance requirements, fresh task contexts and the same parent model/effort/environment for solo, v0.12 and v0.13. Counterbalance order and separate cold/warm cache strata; use repeated trials, not a single pair. Record parent/child request counts, cumulative input (cached as a subset), output (reasoning as a subset), wall time from task start to accepted completion, failures/revisions and quality. Aggregate actual model prices from the same dated snapshot; never treat subscription credit balance as token usage. Report medians/distributions and all failed trials, not only successes. Experimental controller/setup cost is reported separately and not silently charged to a single method.

For Direct, the first useful action should be a relevant read/edit/test rather than a Qing control-plane step. For Lite, check whether substantial work actually moved out of the parent and whether parent requests decreased; a cheap child alone is not success. Host permissions, required independent review, acceptance and audit evidence remain unchanged. No real-account benchmark was run in CI.
''')
write('docs/release-notes-v0.13.0.md', '''# v0.13.0 — 减少父任务开销，而不只是换便宜模型

- 根据 v0.12 对照报告调整默认行为：Direct 直接读相关文件、实现、验证，不额外调用路由/Planner/预检，不为宣布分档单独产生一轮交互。
- 复杂度、多个步骤或 mixed 分类本身不再触发 Lite；只有完整、实质性、可独立验收的委派及清晰接口能证明收益，或用户明确要求委派时才进入 Lite。缺少依据时留在 Direct，不另起付费估算器。
- Lite 子任务承担实现与测试，父任务不重复实现、不持续读取子会话；集中收集一个完成结果和必要阻塞，独立完成集成验收，最多一次合并修订。修复后仍须运行受影响的必要测试。
- 将详细子模型/编排规则移到已有的条件参考段，缩小两版 SKILL.md。保留三款 GPT-6、父任务模型、原生宿主权限、独立 Relay 执行开关、Full 审查和回退约束。
- 增加路由收益、实际 Direct 命令无 Planner/模型调用、权限/审查保留和技能加载合同测试；同步两版 ZIP、预编译运行时与 SHA-256。

`docs/parent-overhead-measurements.json` 只记录入口字节与合成路由结果，不是总 Token 或真实任务耗时。没有取得报告的原始 fixtures/measurements，因此未重新执行那六次任务，也没有已实现的加速或费用下降百分比。原报告的单次采样与缓存/运行顺序局限继续有效。

升级前备份定制 relay.user.json。标准版和完整版均需更新指令；Node 22/24/26 支持不变，普通原生使用没有新增依赖。详见 docs/parent-overhead.md。
''')
changelog = read('CHANGELOG.md')
assert '## 0.12.0 - ' in changelog
changelog = changelog.replace('当前稳定版本为 `v0.12.0`', '当前稳定版本为 `v0.13.0`')
changelog = changelog.replace('## 0.12.0 - ', '## 0.13.0 - 2026-09-23\n\n### Changed\n\n- Direct fast path avoids routing-only rounds and unnecessary control-plane calls.\n- Evidence-based delegation benefit gate replaces complexity-only Lite promotion; preserve Full obligations and explicit bounded delegation.\n- Lite transfers complete tested work, avoids parent duplication and groups revisions.\n- Smaller conditional skill entries, new routing/CLI contract tests, synchronized archives and evidence boundaries.\n\n## 0.12.0 - ', 1)
write('CHANGELOG.md', changelog)
for path, title, summary in [('README.md', '## v0.13.0 — 优先减少父任务轮次与重复工作', 'Direct 直接执行；Lite 需要明确的委派收益，不因多步骤自动分派。子任务完成实现与测试，父任务专注集成验收。保留必要权限、测试和独立审查。'), ('README.en.md', '## v0.13.0 — Parent-round and coordination overhead', 'Direct starts useful work immediately. Lite needs a substantial fixed-contract deliverable, not complexity alone. Keep parent integration independent without duplicating child implementation; preserve permissions and required review.')]:
    first, rest = read(path).split('\n', 1)
    write(path, first+'\n\n'+title+'\n\n'+summary+' [Details](docs/parent-overhead.md) · [Release](docs/release-notes-v0.13.0.md)\n'+rest)
append('docs/architecture.md', '''## v0.13 delegation economics
Before ordinary Lite promotion, the pure orchestration policy evaluates a fixed contract, acceptance, substantial work and nonduplicating parent activity. Complexity/multi-step/mixed alone no longer promotes Lite. Unknown evidence stays Direct without a new estimator call. Explicit bounded delegation and existing Full risk/review conditions still take precedence. Optional routeTask delegationEvidence is an internal observed-work hint, not permission or a prediction. See parent-overhead.md. Native skill Direct execution requires no control-plane command; CLI dispatch remains available to machine callers.''')
append('docs/editions.md', '''## v0.13 speed/cost policy
两版均使用 Direct 快速路径和委派收益检查；普通工作不会只因“多步骤”就新建子任务。默认父任务保留上下文，只有可独立验收且能转移实质工作的委派才进入 Lite。安全、Full 审查及宿主权限规则不变。详见 parent-overhead.md。''')
print('Prepared focused parent-overhead changes; no connected-model claims or pricing/config changes.')
