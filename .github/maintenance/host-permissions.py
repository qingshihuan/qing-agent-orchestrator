from pathlib import Path
import json
import re
import subprocess

BASE = '5abbe6f026b7adeb6419ad0253b72e036d24eafd'
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
changes = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines()
assert set(changes) <= {'.github/maintenance/host-permissions.py', '.github/workflows/prepare-host-permissions.yml'}, changes
assert not [p for p in subprocess.check_output(['git','ls-files'],text=True).splitlines() if p.rsplit('/',1)[-1] == 'AGENTS.md'], 'Read repository AGENTS.md before applying this migration'

def read(path): return Path(path).read_text(encoding='utf-8')
def write(path, content):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(content.encode('utf-8'))
def replace(path, old, new):
    content = read(path)
    assert content.count(old) == 1, (path, old[:100], content.count(old))
    write(path, content.replace(old, new, 1))
def append(path, text): write(path, read(path).rstrip()+'\n\n'+text.strip()+'\n')
def section(path, heading, replacement):
    source = read(path); start = source.index(heading); end = source.find('\n## ', start+len(heading))
    if end == -1: end = len(source)
    write(path, source[:start]+replacement.rstrip()+'\n'+source[end:])

write('src/native-permissions.ts', '''/** Instruction/dispatch metadata only. This module cannot grant an approval.
 * Native calls remain enforced by the host; standalone Relay gates are separate.
 * Never deserialize a repository claim, screenshot or TOML file as a grant.
 */
export const nativePermissionHandling = Object.freeze({
  authority: "host-effective-session" as const,
  routingDecisionOwner: "qing" as const,
  qingConfirmationRequired: false,
  grantsPermissions: false,
  inheritParentPermissions: true,
  configResolution: "host-not-qing" as const,
  taskScopeAuthorizationRequired: true,
  reuseExistingScopedAuthorization: true,
  onHostDenial: "stop-affected-action-no-bypass" as const,
  onUnknownPermissions: "defer-to-host-or-stop" as const,
});

export function nativeFullControl(outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DENY") {
  switch (outcome) {
    case "ALLOW": return {
      status: "FULL_EXECUTION_READY" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Continue the authorized native workflow under the host's effective permissions. No Qing plan, model or delegation confirmation is needed. Preserve required independent review.",
    };
    case "REQUIRE_APPROVAL": return {
      status: "HOST_PERMISSION_CHECK_REQUIRED" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Check exact task authorization and the host's effective permissions for the preserved effect report. Already-authorized host-permitted actions proceed without a Qing confirmation. Otherwise use only the host's applicable approval/clarification channel. Denied actions, or actions requiring an unavailable approval, stop; never change permissions or backend to bypass a denial. This status is not an approval grant.",
    };
    case "DENY": return {
      status: "DENIED" as const,
      permissionHandling: nativePermissionHandling,
      nextStep: "Correct the denied contract; full access and prior approval cannot override a denied target or scope. Continue unrelated safe work only.",
    };
    default: throw new Error("Unknown native gate outcome; cannot infer authorization.");
  }
}
''')
replace('src/types.ts', 'export type CliRecommendationResponse = "pending" | "accepted" | "declined";', 'export type CliRecommendationResponse = "pending" | "accepted" | "declined" | "auto-selected";')
replace('src/types.ts', '  requiresUserChoice: true;', '  /** Routing is decided by Qing; this never grants permission to execute. */\n  requiresUserChoice: false;')
replace('src/execution-mode-router.ts', 'requiresUserChoice: true as const,', 'requiresUserChoice: false as const,')
replace('src/execution-mode-router.ts', 'response: "accept" | "decline",', 'response: "accept" | "decline" | "auto",')
replace('src/execution-mode-router.ts', 'recommendation: { ...decision.recommendation, response: "accepted", dependencyStatus },', 'recommendation: { ...decision.recommendation, response: response === "auto" ? "auto-selected" : "accepted", dependencyStatus },')

replace('src/cli.ts', 'let compactMode = false;', 'import { nativeFullControl, nativePermissionHandling } from "./native-permissions.js";\n\nlet compactMode = false;')
replace('src/cli.ts', '    "CLI_SETUP_REQUIRED",', '    "CLI_SETUP_REQUIRED",\n    "CLI_DEPENDENCY_CHECK_REQUIRED",\n    "HOST_PERMISSION_CHECK_REQUIRED",')
replace('src/cli.ts', '    status: source.status,', '    status: source.status,\n    permissionHandling: source.permissionHandling ?? null,\n    executionMode: execution?.mode ?? null,\n    cliRecommendation: execution?.recommendation ?? null,')
replace('src/cli.ts', '    modelSelectionScope: "delegated-task",', '    modelSelectionScope: "delegated-task",\n    permissionHandling: nativePermissionHandling,')
replace('src/cli.ts', 'if (cliResponse !== undefined && cliResponse !== "accept" && cliResponse !== "decline") {\n      throw new Error("--cli-response must be accept or decline");', 'if (cliResponse !== undefined && cliResponse !== "accept" && cliResponse !== "decline" && cliResponse !== "auto") {\n      throw new Error("--cli-response must be auto, accept or decline");')
replace('src/cli.ts', '''      if (!cliResponse) {
        print({ ...decision, status: "CLI_RECOMMENDATION_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "not-started", nextStep: `${execution.recommendation?.message}: ${execution.recommendation?.benefit} Ask the user to accept or decline. No CLI dependency check or task was started.` });''', '''      if (!cliResponse && args.includes("--no-model-probe")) {
        print({ ...decision, execution, permissionHandling: nativePermissionHandling, status: "CLI_DEPENDENCY_CHECK_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "not-started", nextStep: "Qing selected the process route, not a user-choice prompt. The explicit no-model-probe flag prevents discovery and planning calls. Continue with host-permitted read-only checks using --cli-response auto when appropriate; do not ask the user to choose a routing tier or approve this plan. This is not authorization for installation or task execution." });''')
replace('src/cli.ts', 'execution = await respondToCliRecommendation(execution, "accept", {', 'execution = await respondToCliRecommendation(execution, cliResponse ?? "auto", {')
replace('src/cli.ts', 'Follow ${execution.recommendation?.installGuide}; any installation or configuration change needs its own approval. No task was started.', 'See ${execution.recommendation?.installGuide}. Continue desktop-capable work when possible; check only the missing installation or authentication scope through the host. Reuse existing exact authorization rather than asking to approve a route. No installation, login or task was started.')
# Direct work must not even inspect an optional CLI dependency.
source = read('src/cli.ts')
start = source.index('    if (decision.orchestration.tier === "direct") {', source.index('  if (command === "dispatch")'))
end = source.index('    if (execution.mode === "desktop-native"', start)
direct = source[start:end]
source = source[:start]+source[end:]
pos = source.index('    if (execution.mode === "cli-recommended") {', source.index('  if (command === "dispatch")'))
source = source[:pos]+direct+source[pos:]
# Native parent and Lite responses expose the same permission authority in full and compact output.
for state in ['DIRECT_EXECUTION_REQUIRED','LITE_EXECUTION_REQUIRED']:
    needle = 'status: "'+state+'", handoff'
    assert source.count(needle) == 2, (state,source.count(needle))
    source = source.replace(needle,'status: "'+state+'", permissionHandling: nativePermissionHandling, handoff')
start = source.index('    if (execution.mode === "desktop-native"')
end = source.index('    const workspace = await resolveSafeWorkspace(runtimeRoot, requestedWorkspace);', source.index('      return;\n    }', source.index('      const reviewerBundle',start)))
native = source[start:end]
status = 'status: gate.outcome === "ALLOW" ? "FULL_EXECUTION_READY" : gate.outcome === "DENY" ? "DENIED" : "AWAITING_APPROVAL"'
assert native.count(status)==1
native = native.replace(status,'...nativeFullControl(gate.outcome)')
next_step = ', nextStep: gate.outcome === "ALLOW" ? "Run the bounded Executor and independent Reviewer workflow now; no plan approval is needed." : gate.outcome === "DENY" ? "Revise the unsafe Handoff; denial cannot be approved away." : "Request one approval bundle containing only the displayed effect gate IDs, then continue."'
assert native.count(next_step)==1
native = native.replace(next_step,'')
source = source[:start]+native+source[end:]
source = source.replace('[--cli-response accept|decline]', '[--cli-response auto|accept|decline]')
source = source.replace('a full-edition CLI condition first returns a recommendation and waits for a user choice', 'Qing selects the route automatically; no-model-probe returns a side-effect-free inspection plan')
write('src/cli.ts',source)

# Preserve all standalone safety, executor, model and evidence enforcement.
protected = ['src/safety-gate.ts','src/config.ts','src/executors/codex-exec-executor.ts','src/model-router.ts','src/model-health.ts','src/model-scheduler.ts','src/relay.ts','src/reviewer.ts']
for path in protected:
    assert Path(path).read_bytes().replace(b'\r\n',b'\n') == subprocess.check_output(['git','show',BASE+':'+path]).replace(b'\r\n',b'\n'), path

# Entry instructions: Qing owns routing; host owns native permissions, not raw TOML.
for name in ['qing-agent-orchestrator','qing-agent-orchestrator-full']:
    path = '.agents/skills/'+name+'/SKILL.md'
    source=read(path)
    source=source.replace('Reclassify the remaining phase each user turn and before delegation, revision or review:', 'Qing decides Direct/Lite/Full and the task model automatically; do not ask the user to choose a tier, agent or routine plan. Reassess only at phase boundaries or changed facts, not every tool call:')
    old = 'Destructive, external, secret, global/system or uncertain effects require [safety-gates.md](references/safety-gates.md) and exact approvals before acting. Reversible in-scope edits/builds/tests need no plan approval. Preserve unrelated work; re-gate changed effects or scope.'
    new = 'For consequential or uncertain effects read [safety-gates.md](references/safety-gates.md). Native parent and children use the host\'s effective session permissions (including live overrides, config.toml layers and managed limits), not a second Qing approval system. Reuse exact user/task authorization and host grants; never ask again merely for a plan, agent, model, test or already-approved effect. on-request asks only when required; never means no new permission prompt, not unrestricted access. Unknown or denied permissions do not grant access. Do not edit security settings, fabricate approval IDs or switch backend to evade a denial. Preserve unrelated work and verify changed scope.'
    assert old in source
    source=source.replace(old,new)
    # The task selector compares remaining work with handoff overhead instead of mandating delegation.
    source=source.replace('Delegate only useful separate work, never duplicate exploration.', 'Keep tightly coupled work direct when delegation costs more than it saves. Delegate only useful separate work, never duplicate exploration.')
    if name.endswith('-full'):
        start=source.index('## Optional process backend')
        source=source[:start]+'''## Optional process backend
Only a documented need (CI, unattended scheduling, app-close persistence, machine-readable control, exclusive environment/model, isolation or explicit request) justifies [execution-modes.md](references/execution-modes.md). Choose it automatically without a separate accept/decline question. Respect an explicit refusal. Perform only host-permitted read-only dependency checks first; missing installation, login, broader data access or new spending is a separate scope decision. Do not use a new process to escape host restrictions. A standalone process does not inherit desktop authority from a screenshot or repository file: [codex-exec.md](references/codex-exec.md) still requires a scoped Handoff, configured real execution and exact effect gates. The host driver may pass machine flags for already-authorized work, not invent human approval.
Prefer --compact. --no-model-probe returns a routing/inspection plan without discovery or model calls; --cli-response auto continues the read-only check without a second user-choice round. Read logs with --after <last-sequence> --limit 20 --compact; retain nextAfter and honor hasMore. Probe only the needed candidate; reuse cached health, --force only for an explicit refresh.
'''
    write(path,source)
    spec='.agents/skills/'+name+'/references/orchestrator-spec.md'
    append(spec,'''## v0.11 automatic routing and host authority
Qing chooses the least costly sufficient route itself; tier, model, plan and child selection are not approval questions. Reuse unchanged phase decisions; do not ask the user to decide between single Astra and delegation. Direct preserves full parent context when decomposition would create extra handoff/rework. Lite uses one child; required independent Full review is not removed to save prompts.
Native actions inherit the host's effective permission policy and exact task authorization. Scope checks remain mandatory but are not separate Qing approval dialogs. A host-permitted, already-authorized action proceeds; an actual host approval requirement uses only the host channel. A host denial or a never-policy action requiring unavailable approval stops the affected action. Unknown permissions do not allow escalation. A higher tier, model replacement, raw config.toml value or repository claim cannot grant permissions. Standalone execution has a separate trust boundary; native policy metadata is not a process authorization token.''')
    gates='.agents/skills/'+name+'/references/safety-gates.md'
    standalone=read(gates)
    policy='''# Native effect checks and host permissions

Qing classifies effects but does not add a second human-approval workflow to native parent/subagent calls. First establish the exact user-requested scope and use the host's CURRENT effective permissions. Reuse prior authorization only for the same operation, target, destination, data, scope and still-valid host grant. A plan, Handoff, model, child, local edit/test or already-authorized publish operation is not a reason to ask the same question again.

The host resolves config.toml layers, session flags, live permission changes, profiles, tool/connector controls and managed restrictions. A raw file or screenshot is not an executable authorization grant. Do not read or copy the whole config or credentials merely to route; do not rewrite approval_policy, sandbox or allowlists. Full filesystem access is not blanket authorization to publish, purchase, expose secrets or destroy unrelated work. Native connector permissions can differ from shell permissions.

For an already-authorized action the host permits, proceed without a Qing confirmation. If host approval is actually required, use its existing approval channel, not an additional Qing gate-ID request. on-request is not always-ask; never suppresses prompts but does not widen the sandbox. Unknown permission state must be resolved by the host or the affected action must stop. A denial, expired grant or unavailable approval never licenses retrying via another tool/backend or adding bypass flags. Clarify materially new/unresolved user intent only once; continue independent safe work.

Preserve denied targets, allowedPaths, independent review, tests and evidence. Model substitution alone creates no new authorization requirement when the full same-backend scope proof remains valid. Changes to operation, target, data, backend or privileges require renewed scope/policy evaluation, not necessarily a new prompt when already covered.
'''
    if name.endswith('-full'):
        policy += '\n## Standalone Relay boundary\n\nThe following rules apply to separately launched Relay processes, not as duplicate native dialogs. The process has no trusted in-memory host approval bridge. Keep explicit scoped effect grants, disabled-real-execution defaults and --allow-real-execution. Do not accept a host-permitted string, generated gate IDs or a config.toml screenshot as a grant. The calling host may convey an already-authorized exact grant through the existing invocation; the model must not invent it.\n\n'+standalone.replace('# Effect-based safety gates\n','')
    write(gates,policy)

write('.agents/skills/qing-agent-orchestrator-full/references/execution-modes.md','''# Automatic execution mode selection
Qing selects native parent/children by default. Complexity, writing code or duration alone do not justify another process. A genuine CLI-only/control/persistence need can select the process path automatically; do not add an accept/decline question just for routing. A stated refusal wins and is not asked again.

`dispatch` performs read-only dependency checks for an automatic process route. The routing function itself has no I/O. `--no-model-probe` prevents these checks and planning calls and returns `CLI_DEPENDENCY_CHECK_REQUIRED`; the host driver can continue with `--cli-response auto` under its existing permissions. `accept` and `decline` remain compatible overrides; automatic decisions are recorded as `auto-selected`, never as a user acceptance.

Missing runtime/authentication returns a setup requirement, not permission to install or log in. Continue native-capable work when possible. Installation, account use, new costs and broader effects need actual task/host authorization. A ready state or recommendation never starts the task; only a separately authorized execute invocation can do so.

Do not switch backend because a native action was denied. A separate CLI process does not magically inherit a desktop session's effective configuration. Its documented sandbox, execution opt-in and scoped effect gates remain intact; do not force never/full-access or disable user config to imitate a screenshot.
''')
append('.agents/skills/qing-agent-orchestrator-full/references/codex-exec.md','''## v0.11 approval ownership
The decision to use a process is automatic, not an extra consent screen. Dependency checks are read-only and host-controlled. An existing exact authorization can be conveyed by the trusted calling host without asking the user to repeat it; generated Handoffs never supply their own approvals. This standalone adapter has no native-session permission bridge: its execution opt-in, sandbox and scoped effect gates remain enforced. Prefer native subagents for normal work so the actual host applies its effective config directly.''')

# Update behavior assertions; do not remove tests or weaken effect-gate checks.
replace('tests/execution-mode-router.test.ts','assert.equal(full.recommendation?.requiresUserChoice, true);','assert.equal(full.recommendation?.requiresUserChoice, false);')
replace('tests/task-router.test.ts','assert.equal(pending.status, "CLI_RECOMMENDATION_REQUIRED");','assert.equal(pending.status, "CLI_DEPENDENCY_CHECK_REQUIRED");')
replace('tests/task-router.test.ts','assert.equal(gatedOutput.status, "AWAITING_APPROVAL");','assert.equal(gatedOutput.status, "HOST_PERMISSION_CHECK_REQUIRED");')
write('tests/host-permissions.test.ts',r'''import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFullControl, nativePermissionHandling } from "../src/native-permissions.js";
import { routeExecutionMode, respondToCliRecommendation } from "../src/execution-mode-router.js";
import { NodeProcessRunner } from "../src/process-runner.js";
import { loadConfig } from "../src/config.js";

test("native metadata delegates enforcement, never grants approval or reads a raw config", () => {
  assert.equal(nativePermissionHandling.authority,"host-effective-session");
  assert.equal(nativePermissionHandling.qingConfirmationRequired,false);
  assert.equal(nativePermissionHandling.grantsPermissions,false);
  assert.equal(nativePermissionHandling.configResolution,"host-not-qing");
  assert.equal(nativePermissionHandling.taskScopeAuthorizationRequired,true);
  assert.equal(nativePermissionHandling.onHostDenial,"stop-affected-action-no-bypass");
  assert.ok(Object.isFrozen(nativePermissionHandling));
});
test("native effect requirements remain pending host checks rather than fabricated allow results", () => {
  const pending=nativeFullControl("REQUIRE_APPROVAL");
  assert.equal(pending.status,"HOST_PERMISSION_CHECK_REQUIRED");
  assert.equal(pending.permissionHandling.grantsPermissions,false);
  assert.match(pending.nextStep,/not an approval grant/);
  assert.match(pending.nextStep,/exact task authorization/);
});
test("denied and unknown outcomes cannot be approved away through host metadata", () => {
  assert.equal(nativeFullControl("DENY").status,"DENIED");
  assert.match(nativeFullControl("DENY").nextStep,/cannot override/);
  assert.throws(()=>nativeFullControl("unknown" as never),/cannot infer/);
});
test("safe Full work retains independent verification without a plan confirmation", () => {
  const ready=nativeFullControl("ALLOW");
  assert.equal(ready.status,"FULL_EXECUTION_READY");
  assert.match(ready.nextStep,/independent review/);
  assert.equal(ready.permissionHandling.qingConfirmationRequired,false);
});
test("automatic backend resolution does one read-only inspection without claiming human consent",async()=>{
  let inspected=0;
  const pending=routeExecutionMode("使用 CLI 完成工程任务","full","codex","full");
  assert.equal(pending.recommendation?.requiresUserChoice,false);
  const selected=await respondToCliRecommendation(pending,"auto",{inspect:async()=>{inspected++;return "ready";}});
  assert.equal(inspected,1);
  assert.equal(selected.mode,"cli-full-planning");
  assert.equal(selected.recommendation?.response,"auto-selected");
});
test("an explicit refusal suppresses inspection even when automatic routing selected CLI",async()=>{
  const pending=routeExecutionMode("定时无人值守运行","full","codex","full");
  const selected=await respondToCliRecommendation(pending,"decline",{inspect:async()=>{throw new Error("must not inspect");}});
  assert.equal(selected.mode,"desktop-fallback");
  assert.equal(selected.suppressCliPromptForTask,true);
});
test("missing dependencies or authentication never become permission to start or install",async()=>{
  for(const dependency of ["missing","authentication-required"] as const){
    const selected=await respondToCliRecommendation(routeExecutionMode("使用 CLI","full","codex","full"),"auto",{inspect:async()=>dependency});
    assert.equal(selected.mode,"cli-setup-required");
    assert.equal(selected.recommendation?.dependencyStatus,dependency);
    assert.equal(selected.recommendation?.response,"auto-selected");
  }
});

async function inFixture(run:(directory:string,config:string)=>Promise<void>){
  const directory=await mkdtemp(join(tmpdir(),"qing-host-policy-"));
  try{
    const source=JSON.parse(await readFile("config/relay.example.json","utf8"));
    source.executor.codexExec.command="nonexistent-qing-host-policy-sentinel";
    source.runtime.stateDirectory=join(directory,"runs");
    const config=join(directory,"relay.json");
    await writeFile(config,JSON.stringify(source));
    await run(directory,config);
  }finally{await rm(directory,{recursive:true,force:true});}
}
async function cli(directory:string,config:string,args:string[]){
  return new NodeProcessRunner().run({command:process.execPath,args:["dist/src/cli.js",...args,"--config",config],cwd:process.cwd(),stdin:"",timeoutMs:20000,maxOutputBytes:300000});
}
test("actual Direct and Lite dispatch preserve native authority in full and compact responses",async()=>{
  await inFixture(async(directory,config)=>{
    for(const [task,status] of [["解释这个项目的作用","DIRECT_EXECUTION_REQUIRED"],["先规划接口，然后实现并测试","LITE_EXECUTION_REQUIRED"]]){
      for(const flags of [[],["--compact"]]){
        const result=await cli(directory,config,["dispatch","--task",task!,"--workspace",directory,"--no-model-probe",...flags]);
        assert.equal(result.exitCode,0,result.stderr);
        const response=JSON.parse(result.stdout);
        assert.equal(response.status,status);
        assert.deepEqual(response.permissionHandling,nativePermissionHandling);
        assert.equal(response.modelProbe,"not-applicable");
      }
    }
  });
});
test("actual native Full keeps risky effects and review while removing the duplicate gate-ID prompt",async()=>{
  await inFixture(async(directory,config)=>{
    for(const flags of [[],["--compact"]]){
      const result=await cli(directory,config,["dispatch","--task","实现修复并部署到生产环境","--workspace",directory,"--no-model-probe",...flags]);
      assert.equal(result.exitCode,0,result.stderr);
      const response=JSON.parse(result.stdout);
      assert.equal(response.status,"HOST_PERMISSION_CHECK_REQUIRED");
      assert.equal(response.permissionHandling.grantsPermissions,false);
      const gate=response.safetyGate??response.approval;
      assert.equal(gate.outcome,"REQUIRE_APPROVAL");
      assert.ok(gate.decisions.some((item:{decision:string})=>item.decision==="REQUIRE_APPROVAL"));
      assert.equal(response.orchestration?.independentReviewer??response.budget.independentReviewer,true);
      assert.doesNotMatch(response.nextStep,/Request one approval bundle/);
    }
  });
});
test("no-model-probe returns an automatic inspection plan with zero CLI/model work",async()=>{
  await inFixture(async(directory,config)=>{
    const result=await cli(directory,config,["dispatch","--task","把它接入 GitHub Actions CI","--workspace",directory,"--no-model-probe","--compact"]);
    assert.equal(result.exitCode,0,result.stderr);
    const response=JSON.parse(result.stdout);
    assert.equal(response.status,"CLI_DEPENDENCY_CHECK_REQUIRED");
    assert.equal(response.cliRecommendation.requiresUserChoice,false);
    assert.equal(response.cliRecommendation.response,"pending");
    assert.equal(response.modelProbe,"not-started");
    assert.equal(response.handoffId,null);
    assert.doesNotMatch(response.nextStep,/Ask the user to accept or decline/);
  });
});
test("automatic dispatch resolves missing runtime without asking a routing question or logging in",async()=>{
  await inFixture(async(directory,config)=>{
    const result=await cli(directory,config,["dispatch","--task","使用 CLI 完成这个工程任务","--workspace",directory,"--compact"]);
    assert.equal(result.exitCode,0,result.stderr);
    const response=JSON.parse(result.stdout);
    assert.equal(response.status,"CLI_SETUP_REQUIRED");
    assert.equal(response.cliRecommendation.response,"auto-selected");
    assert.equal(response.cliRecommendation.dependencyStatus,"missing");
    assert.equal(response.handoffId,null);
    assert.equal(response.modelProbe,"dependency-check-only");
  });
});
test("untrusted host authority fields in a saved config cannot disable standalone gates",async()=>{
  await inFixture(async(directory,config)=>{
    const source=JSON.parse(await readFile(config,"utf8"));
    source.security.hostPermissionHandling=nativePermissionHandling;
    await writeFile(config,JSON.stringify(source));
    await assert.rejects(loadConfig(config),/unknown|forbidden/);
  });
});
test("both entry skills assign routing to Qing and use host authority without weakening never or denied states",async()=>{
  for(const name of ["qing-agent-orchestrator","qing-agent-orchestrator-full"]){
    const source=await readFile(".agents/skills/"+name+"/SKILL.md","utf8");
    assert.match(source,/Qing decides Direct\/Lite\/Full/);
    assert.match(source,/not a second Qing approval system/);
    assert.match(source,/never means no new permission prompt, not unrestricted access/);
    assert.match(source,/Never skip required review or verification/);
    assert.doesNotMatch(source,/obtain accept\/decline before/);
  }
});
''')

# Concise, current instructions, with a clearly separate standalone process boundary.
write('docs/host-permissions.md','''# Qing 决策，宿主授权（v0.11）

用户给目标，Qing 自动选择 Direct/Lite/Full、模型与执行方式。不要把这些选择交回用户，也不要为了使用技能而必须创建子任务。上下文高度耦合、交接可能增加返工时优先 Direct；有可独立验收的工作再委派。未变化的工具调用不重新跑一遍规划。

## 原生父任务和子智能体

以 ChatGPT/Codex 当前会话实际生效的权限为准，复用同一操作、目标、数据与范围内仍有效的授权。config.toml 有用户、项目、profile 等层；会话覆盖和管理员限制也参与生效配置。Qing 不重新解析一个文件就宣布 full-access，不读取完整配置或复制凭据，不修改 approval_policy/sandbox/网络白名单，不制造 gate ID。

- 已在用户任务范围内、宿主允许的动作：直接继续，不另弹 Qing 确认。
- on-request：只在宿主实际要求时走原生审批，不先问一次再触发宿主审批。
- never：不产生新的权限请求，不等于扩大 sandbox；受限操作失败后停止受影响动作。
- 缺少明确的业务授权、目标/数据不确定、越界或宿主拒绝：澄清新增部分或停止，不换工具/后端绕过。
- 高风险审查、禁止目标、测试与证据不因“少确认”而删除。

`nativePermissionHandling` 只是不可授权的控制合同。桌面 Full 的效果报告保留；原 REQUIRE_APPROVAL 映射为 `HOST_PERMISSION_CHECK_REQUIRED`，表示交给宿主与父任务核对已有范围/权限，不表示允许执行。DENY 仍是 DENIED，绝不把未知权限转换为 ALLOW。完整和 --compact 输出都保留该合同与未满足的效果报告。

## 可选 CLI 路由

选择进程后端不再固定询问接受/拒绝。正常 dispatch 可自动进行只读 doctor 检查；自动决策标为 auto-selected，不伪装为用户接受。`--no-model-probe` 同时阻止依赖/模型检查，返回 `CLI_DEPENDENCY_CHECK_REQUIRED`；宿主驱动可直接用 `--cli-response auto` 继续。accept/decline 兼容保留，明确拒绝仍被尊重。路由函数本身无 I/O。

缺失依赖或未登录只返回 setup 状态；不会自动安装、登录或修改配置。独立 Relay 不等于原生子智能体：当前没有可信的跨进程宿主权限传递接口。其默认禁用真实执行、--allow-real-execution、sandbox、精确效果 gate 均不变。宿主可传递已经明确授权的机器参数，但生成的 Handoff 或仓库文件不能自己给自己批准。普通工作优先原生后端，真正继承当前宿主权限，而非另外启动忽略配置的进程冒充继承。

## 验证边界

测试覆盖路由、只读依赖检查、完整/精简控制输出、拒绝与未知态以及不可信配置注入。没有在用户桌面验证原生授权弹窗或其真实 config.toml；不声称实现了一个可以读取桌面实时权限的远程接口。减少的是 Qing 自己的重复确认环节，不承诺宿主永远不询问，也没有真实任务 Token/时延 A/B 数值。

截图类告警中的 `session-flags: features.thread_tools is ignored` 表示当前会话传入了不识别的设置。它与 Qing 重复审批分开排查，不能只凭告警认定该键一定写在用户 config.toml，不能建议借机关闭所有安全控制。

官方核对（2026-09-23）：
- https://developers.openai.com/codex/config-basic
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/agent-approvals-security
''')
write('docs/release-notes-v0.11.0.md','''# v0.11.0 — 自动决策与宿主权限复用

Qing 自动决定 Direct/Lite/Full 和子任务模型；用户不需要先选择“单用 Astra 还是委派”。原生父任务/子智能体沿用宿主当前有效权限和已有任务授权，不新增计划、模型、委派或已授权效果的 Qing 确认。

桌面 Full 保留效果与独立审查要求；REQUIRE_APPROVAL 现在返回 HOST_PERMISSION_CHECK_REQUIRED，由宿主处理真实权限缺口，绝非自动 ALLOW。DENY、未知权限、越界及宿主拒绝不被绕过；never 不代表无限权限。

CLI 路由不再固定要求接受/拒绝，自动只读检查以 auto-selected 审计。--no-model-probe 仍无发现或模型调用，返回 CLI_DEPENDENCY_CHECK_REQUIRED。用户拒绝继续有效。不会自动安装、登录或开启真实执行；独立 Relay 仍保留精确效果 gate 和执行 opt-in，不根据截图/不可信文件推断父会话权限。

两版技能、预编译运行时、ZIP 和校验文件一起更新。保留 GPT-6 Luna/Sol/Astra、原模型预算及证据检查。升级前备份定制配置；本次不修改用户的 config.toml。

详见 docs/host-permissions.md。新增控制状态可能需要外部调用者更新；不再将 HOST_PERMISSION_CHECK_REQUIRED 当成要求用户输入 Qing gate ID 的指令。原始效果报告与 --compact 中的决定均保留。

验证基于单元/CLI/打包测试，未验证用户桌面实际弹窗、真实模型账户或端到端 Token 节省；无可信跨进程权限继承桥接。删掉重复确认不等于绕过宿主、管理员或连接器审批。
''')
write('docs/editions.md','''# 版本与执行方式（v0.11）

默认桌面标准版：Direct/Lite/Full、原生委派、宿主权限与分层验证；无运行时、启动器或 CLI 依赖。完整版增加可选进程能力，普通任务仍桌面优先。两版都由 Qing 决定任务是否值得委派，用户无需选择档位。

原生操作复用宿主实际生效的配置和精确任务授权，不额外批准 Handoff/子智能体/模型或已授权效果。高风险操作的范围检查仍存在，只有缺少真正授权时才由宿主处理。详见 [宿主权限](host-permissions.md)。

完整版遇到明确 CLI、CI、无人值守、应用关闭后继续、机器可读控制或进程隔离需求时可自动选择进程路线；复杂/长任务本身不是理由。路由函数无 I/O，dispatch 可做只读依赖检查，不再要求固定接受/拒绝。显式拒绝有效且不重复提示。--no-model-probe 返回 CLI_DEPENDENCY_CHECK_REQUIRED，不发起依赖/模型调用。

缺少依赖或认证返回 CLI_SETUP_REQUIRED，不会安装、登录或提交任务。单独的 Relay 保留安全默认、精确效果授权和 --allow-real-execution；它没有可信的桌面权限继承通道，不可把 full-access 截图当作授权。

把对应 ZIP 解压到用户或项目的 .agents/skills；本项目打包不会自动部署到用户电脑。标准版有桌面专用 Handoff/Review schema；完整版有独立进程 schema 与安全默认配置，不携带 codex.exe。更新前备份自定义配置。
''')
source=read('docs/codex-integration.md')
start=source.index('## 何时建议'); end=source.index('## 模型和推理强度')
source=source[:start]+'''## 自动选择和只读检查

Qing 仅在明确 CLI/CI、持久运行、机器控制或隔离等需求下选择进程方式。普通复杂工程保持原生子智能体。选择方式不再额外询问接受/拒绝；dispatch 自动只读检查，审计为 auto-selected。--no-model-probe 阻止发现和模型调用并返回 CLI_DEPENDENCY_CHECK_REQUIRED，--cli-response auto 可由宿主驱动继续；accept/decline 仍兼容，拒绝不再提示。

检查不会安装、登录、变更配置或执行任务。缺少能力只要求处理真正的缺口。安装、账户访问或新外部效果需要实际任务/宿主授权；同一授权不重复询问。

## 独立进程授权边界

原生父任务/子智能体直接使用宿主的当前有效权限。单独运行的 Relay 不具备可信的父会话权限桥接，不能从单个 config.toml、截图或生成的 Handoff 取得授权。现有 sandbox、allowedPaths、网络、证据和模型参数边界不变。

真实进程执行仍要求 executor.codexExec.enabled=true、--allow-real-execution 和精确效果 gate。已有明确授权可由调用宿主传递为机器参数，无需让用户重复手工输入；模型不得伪造授权。--approve-handoff 仅为旧兼容字段，安全计划本身不是审批点。不要为免提示强制设置 never/full-access 或换后端规避拒绝。

'''+source[end:]
source=source.replace('用户接受建议、完成依赖检查并显式提供', '调用方完成依赖检查并在授权范围内显式提供')
write('docs/codex-integration.md',source)
source=read('docs/architecture.md')
source=source.replace('仅命中稳定 reason code 时提出 CLI 建议。拒绝后回退桌面，接受后才检查依赖和创建新的 CLI Handoff。','仅命中稳定 reason code 时自动选择可选进程路线。明确拒绝后回退桌面；只读检查和规划在宿主授权范围内进行，不增加路由选择确认。')
source=source.replace('→ optional process recommendation → accept/decline','→ optional process route → host-permitted read-only checks')
source=source.replace('- 接受建议只进入只读依赖检查，不等于安装或真实任务启动。','- 自动进程路由只进入只读依赖检查，不等于安装或真实任务启动；--no-model-probe 完全阻止检查。')
source=source.replace('- Handoff 本身不是审批点；仅 delete/global/system/secrets/private/authenticated network/external write/push/deploy/purchase/destructive migration/scope expansion 等效果进入 gate。','- Handoff 本身不是审批点；原生路径由宿主处理真实效果授权，已授权范围不重复提示。独立 Relay 继续对 delete/global/system/secrets/private/authenticated network/external write/push/deploy/purchase/destructive migration/scope expansion 等效果执行原有 gate。')
source=source.replace('- 同步 gate 不用 URL 语法猜测', '- 独立 Relay 同步 gate 不用 URL 语法猜测')
source+='\n## v0.11 宿主权限归属\n\n原生控制输出保留不可授权的 permissionHandling 元数据；桌面 REQUIRE_APPROVAL 映射为 HOST_PERMISSION_CHECK_REQUIRED，DENY 仍拒绝。完整效果报告不丢失；只有宿主的当前有效权限和实际任务范围决定是否需要提示。元数据不是授权令牌，独立 CLI 无权复用它绕过自己的 gate。参见 host-permissions.md。\n'
write('docs/architecture.md',source)
replace('CONTRIBUTING.md','涉及删除、密钥、外部消息、push、部署、数据库迁移、全局安装或真实执行时，必须保留独立审批边界。','涉及删除、密钥、外部消息、push、部署、数据库迁移、全局安装或真实执行时，必须保留真实授权边界。原生模式复用宿主已经授予的精确权限与任务授权，不新增重复 Qing 弹窗；独立 Relay 的效果 gate 不由原生元数据绕过。')
for path in ['README.md','README.en.md']:
    source=read(path); first,rest=source.split('\n',1)
    summary='Qing 自动决定直接完成或委派，原生调用复用宿主当前权限与已授权任务范围，不再重复询问计划、模型或路由。独立 CLI 保留自己的授权边界。' if path=='README.md' else 'Qing chooses direct work or delegation automatically. Native calls reuse effective host permissions and exact task authorization without a second Qing confirmation. Standalone CLI enforcement remains separate.'
    source=first+'\n\n## v0.11.0 — Host-native permissions\n\n'+summary+' [Details](docs/host-permissions.md) · [Release](docs/release-notes-v0.11.0.md)\n'+rest
    source=source.replace('[v0.10.0 发布说明](docs/release-notes-v0.10.0.md)','[v0.11.0 发布说明](docs/release-notes-v0.11.0.md)')
    source=source.replace('[v0.10.0 release notes](docs/release-notes-v0.10.0.md)','[v0.11.0 release notes](docs/release-notes-v0.11.0.md)')
    source=source.replace('提出方案，获批后实现并运行测试。','自动选择合适方式完成修复并验证，沿用当前宿主权限，不重复确认已授权工作。')
    source=source.replace('只有命中明确条件且用户接受后才按需启用','命中明确进程需求时自动路由，仍受当前授权约束')
    source=source.replace('接受后只做只读依赖检查；安装/配置及真实高风险效果仍保持审批边界，安全任务不再额外批准 Handoff。','路由无需接受/拒绝确认，可在现有宿主权限内进行只读依赖检查；安装/配置或新效果仍需实际授权，已授权范围不重复提示。')
    if path=='README.md':
        source=source.replace('## 安全与证据\n','## 安全与证据\n\n以下精确 gate/主机清单是独立 Relay 的边界；原生操作由宿主按当前有效权限和任务授权处理，不额外要求 Qing gate ID。\n')
    write(path,source)

pkg=json.loads(read('package.json')); assert pkg['version']=='0.10.0'
pkg['version']='0.11.0'; pkg['scripts']['test']+=' dist/tests/host-permissions.test.js'
write('package.json',json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
lock=json.loads(read('package-lock.json')); lock['version']=lock['packages']['']['version']='0.11.0'
write('package-lock.json',json.dumps(lock,ensure_ascii=False,indent=2)+'\n')
source=read('CHANGELOG.md')
needle='## 0.10.0 - '; assert source.count(needle)==1
source=source.replace(needle,'## 0.11.0 - 2026-09-23\n\n### Changed\n\n- Qing owns automatic tier/model/backend decisions; remove routing-choice round trips.\n- Native parent/child work delegates permission enforcement to the effective host session without duplicate Qing confirmations.\n- Preserve denied scopes and full effect evidence; native pending effects use HOST_PERMISSION_CHECK_REQUIRED, never a fabricated grant.\n- Automatic read-only dependency checks are recorded as auto-selected; no-model-probe and explicit refusal remain respected.\n- Keep standalone execution opt-in, exact gates and sandbox unchanged. No raw TOML/screenshot permission inference.\n- Rebuild both skills and runtime; see docs/host-permissions.md.\n\n'+needle,1).replace('当前稳定版本为 `v0.10.0`','当前稳定版本为 `v0.11.0`')
write('CHANGELOG.md',source)
print('Prepared scoped host-native permission changes; standalone enforcement source unchanged.')
