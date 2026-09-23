from pathlib import Path
import textwrap

def read(path): return Path(path).read_text(encoding='utf-8')
def put(path,value): Path(path).write_bytes(textwrap.dedent(value).lstrip('\n').encode('utf-8'))
def change(path,old,new):
    value=read(path)
    assert value.count(old)==1, (path,old[:100],value.count(old))
    put(path,value.replace(old,new,1))
def append(path,value): put(path,read(path).rstrip()+'\n\n'+textwrap.dedent(value).strip()+'\n')

# Preserve the existing public executionOwner naming contract. Topology is a
# separate mode, not a second ambiguous reporting owner.
for path in ['src/execution-plan.ts','src/cli.ts','tests/single-owner.test.ts','docs/single-owner.md']:
    put(path,read(path).replace('implementationOwner','implementationMode'))

# Invalid immutable-input paths must fail before any model discovery/probe.
change('src/cli.ts','import { SingleOwnerController }', 'import { protectedInputSnapshot } from "./protected-inputs.js";\nimport { SingleOwnerController }')
change('src/cli.ts','    handoff.workspace.root = workspace;', '    await protectedInputSnapshot(workspace, protectedPaths);\n    handoff.workspace.root = workspace;')

# The single owner may never propose a new effect and then run acceptance first.
marker='      if (singleOwner && (await options.verifyImmutableInputs?.() ?? []).length) {'
new='''      if (singleOwner && execution.proposedOperations.length > 0) {
        const proposedGate = evaluateSafetyGate({ ...handoff, id: `${handoff.id}-iteration-${iteration}`, requestedOperations: execution.proposedOperations }, options.approvedGateIds);
        if (proposedGate.outcome !== "ALLOW") {
          if (runHandle) {
            await runHandle.writeExecutorResult(execution, iteration);
            await runHandle.finalize("blocked", "blocked", iteration, "failed", "New effect blocked before acceptance.");
          }
          return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, phaseDecisions, message: "New effect requires scope/authority review; acceptance has not run." };
        }
      }
'''+marker
change('src/relay.ts',marker,new)
# Each acceptance step can affect later steps: recheck frozen inputs before
# every command, not just before the first command and after the last command.
marker='        for (const command of handoff.testPlan) {'
change('src/relay.ts',marker,marker+'''
          if (singleOwner && (await options.verifyImmutableInputs?.() ?? []).length) {
            if (runHandle) await runHandle.finalize("blocked", "blocked", iteration, "failed", "Acceptance input changed between commands.");
            return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, phaseDecisions, message: "Protected input changed between acceptance commands; stopped." };
          }''')

# Update only obsolete topology expectations. The original safe cases remain in
# the new regression suite; actual effects and explicit review still test Full.
p='tests/parent-overhead.test.ts'
change(p,'Full risk, parallel scope, explicit CLI and configured review always outrank savings','Actual risk and explicitly configured review always outrank savings')
change(p,'"同时修改前后端和数据库服务", "并行处理多个独立工作流", ','"同时修改前后端并部署到生产环境", "并行执行破坏性数据库迁移", ')
change(p,'"使用 CLI 完成任务"','"使用 CLI 执行生产部署"')
p='tests/task-router.test.ts'
change(p,'adaptive orchestration reserves Full for high-risk, cross-system, parallel, or explicit full work','adaptive orchestration reserves Full for real high-risk effects and explicit review')
change(p,'    "同时修改前后端和数据库服务",','    "同时修改前后端并部署到生产环境",')
change(p,'    "并行处理多个独立工作流",','    "并行执行破坏性数据库迁移",')
p='tests/routing-precision.test.ts'
change(p,'["把项目接入 GitHub Actions CI", "full"]','["把项目接入 GitHub Actions CI", "lite"]')
change(p,'["同时修改前后端和数据库服务", "full"]','["同时修改前后端和数据库服务", "direct"]')
change(p,'["并行处理多个独立工作流", "full"]','["并行处理多个独立工作流", "direct"]')
change(p,'{ direct: 10, lite: 1, full: 5 }','{ direct: 12, lite: 2, full: 2 }')
change(p,'assert.equal(childBudget, 11);','assert.equal(childBudget, 6);')
change(p,'assert.equal(reviewerCount, 5);','assert.equal(reviewerCount, 2);')
change(p,'assert.equal(modelSelectionCount, 6);','assert.equal(modelSelectionCount, 4);')

# Retain the earlier small-entry regression and all meaningful acceptance rules.
for name in ['qing-agent-orchestrator','qing-agent-orchestrator-full']:
    full=name.endswith('-full'); prefix='runtime/' if full else ''
    entry=f'''---
name: {name}
description: Route to one complete task owner, not a management team; preserve acceptance and effective host authority.
---

# Qing — single owner (experimental)

Qing decides Direct/Lite/Full: compatibility labels, not team templates.

## Direct fast path
Current capable parent does the whole task now. For Direct, do not preload references or schemas, call dispatch/start/doctor/models, or emit a routing-only reply. Read, implement and verify. Record the route in the result, not a separate model round. Unknown benefit defaults Direct without an estimator call. Multiple files, offline money/transaction logic, cross-module scope, transport and possible parallelism alone never require Full or a Reviewer.

## Whole-task transfer only
Transfer only a substantial complete deliverable with fixed scope and acceptance; one worker implements, debugs and tests it. Parent does not keep half the work, spawn a manager, read live transcripts or poll unchanged progress. Send the contract once; wait for terminal result or a real blocker, then independently verify. Read [Single-owner execution](references/orchestrator-spec.md) only for transfer. Native parent requests still cost tokens; no host request cap is enforced by this skill.

## Verification is separate
Actual consequential effects, explicit review and pending independent-review obligations still require an independent Reviewer. Parent may be the only implementer plus a read-only Reviewer. Only then load [Handoff](references/handoff-protocol.md), [Reviewer](references/reviewer-rules.md), [Handoff schema]({prefix}schemas/handoff.schema.json) and [Review schema]({prefix}schemas/review.schema.json). Never skip required review or verification. Tests are not source review. Reuse evidence only for the same unchanged inputs, commands and environment.

## Authority
Use host permissions and exact scope, not a second Qing approval system. on-request uses the host; never means no new permission prompt, not unrestricted access. Unknown/denied access stops affected work; no forged grants, security changes or backend bypass. Read [safety-gates.md](references/safety-gates.md) for consequential effects. Preserve unrelated work. Report actual artifacts, tests, limits, executionOwner and model substitutions, never a plan/mock as completion.
'''
    if full: entry+='\nOptional process/CI/persistence need: read [process guide](references/codex-exec.md). execute-single performs one complete worker and programmatic acceptance under existing opt-in and gates. No manager or automatic retry; required independent review stops separately. No API key, install or user-config change is authorized by routing.\n'
    put('.agents/skills/'+name+'/SKILL.md',entry)
    append('.agents/skills/'+name+'/references/orchestrator-spec.md', '''
The worker implements and runs the agreed checks before returning. Do not redo child implementation; a parent's test is not replaced by child self-report. At most one revision brief may be used in native recovery within existing bounds, after the previous worker stopped. These instructions are not enforcement of host token budgets.
''')

# Refuse contradictory public claims in the active README without deleting
# immutable historical release records.
for path in ['README.md','README.en.md']:
    s=read(path)
    s=s.replace('高风险/外部效果、跨系统、真正并行或显式 Full 请求才进入完整编排。','仅真实风险/外部效果或明确独立审查要求进入审查路径；跨模块和可并行本身不再触发 Full。')
    s=s.replace('高风险、跨系统或真正可并行的工作才进入 Full。','仅真实高风险或明确独立审查要求进入 Full；默认单一实现负责人。')
    s=s.replace('让擅长理解、规划和沟通的模型先把事情想清楚，让擅长代码与工程执行的 Codex 完成实现与验证。','由一个合适的执行者完整完成任务；不默认叠加持续工作的管理模型。')
    put(path,s)

append('tests/single-owner.test.ts','''
test("a pre-cancelled run never starts its worker or acceptance",async()=>{
  await fixture(async(root,h)=>{
    let calls=0;
    const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const store=new RunStore(join(root,"state")); const handle=await store.createRun(h);
    await store.cancelRun(handle.runId,async()=>{});
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(out.status,"BLOCKED"); assert.equal(calls,0); assert.equal(out.controller.executorInvocations,0);
  });
});
test("unknown live exit retains the workspace lease instead of transferring write ownership",async()=>{
  await fixture(async(root,h)=>{
    const executor:Executor={name:"codex-exec",async execute(_value,context){
      context.onProcessStart?.({pid:12345,command:"fixture-not-a-real-process",args:[],cwd:h.workspace.root,startedAt:new Date().toISOString()});
      throw new Error("fixture-lost-exit");
    }};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    await assert.rejects(new SingleOwnerController(executor).run(h,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths}),/fixture-lost-exit/);
    await assert.rejects(acquireWorkspaceLease(h.workspace.root),/WORKSPACE_BUSY/);
    // This fixture never starts a process. Test cleanup is explicit, not a stale-lease policy.
    const { createHash }=await import("node:crypto");
    const { realpath }=await import("node:fs/promises");
    const canonical=await realpath(h.workspace.root);
    const key=process.platform==="win32"?canonical.toLowerCase():canonical;
    const leasePath=join(tmpdir(),"qing-owner-leases-"+(process.getuid?.()??"user"),createHash("sha256").update(key).digest("hex"));
    await rm(leasePath,{recursive:true,force:true});
  });
});
test("an acceptance step cannot modify the next protected verifier and continue",async()=>{
  await fixture(async(root,h)=>{
    h.testPlan=[`node -e "require('node:fs').writeFileSync('acceptance.cjs','// tampered')"`,"node acceptance.cjs"];
    const executor:Executor={name:"codex-exec",async execute(value){await writeFile(join(value.workspace.root,"result.txt"),"ok");return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(out.status,"BLOCKED"); assert.match(out.message,/between acceptance commands/);
  });
});
test("proposed undeclared effects block before any acceptance command",async()=>{
  await fixture(async(root,h)=>{
    h.testPlan=[`node -e "require('node:fs').writeFileSync('unexpected-test.txt','bad')"`];
    const executor:Executor={name:"codex-exec",async execute(value){return {...result(value),proposedOperations:[{type:"git_push",target:"origin/main",reason:"new scope",risk:"high"}]};}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(out.status,"BLOCKED"); assert.match(out.message,/New effect/);
    await assert.rejects(readFile(join(h.workspace.root,"unexpected-test.txt")));
  });
});
''')
print('Single-owner refinements and policy-migration tests applied; no tests removed or skipped.')
