import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { routeTask } from "../src/task-router.js";
import { independentReviewReasons } from "../src/single-owner-policy.js";
import { acquireWorkspaceLease } from "../src/workspace-lease.js";
import { protectedInputSnapshot } from "../src/protected-inputs.js";
import { parseCodexUsage } from "../src/codex-usage.js";
import { SingleOwnerController } from "../src/single-owner-controller.js";
import { RunStore } from "../src/run-store.js";
import type { Executor } from "../src/executors/executor.js";
import type { Handoff, ExecutionResult } from "../src/types.js";

async function fixture(run: (root: string, handoff: Handoff) => Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),"qing-single-test-"));
  const workspace=join(root,"work"); await mkdir(workspace);
  await writeFile(join(workspace,"SPEC.md"),"Write result.txt with ok. No external effects.");
  await writeFile(join(workspace,"acceptance.cjs"),'require("node:assert/strict").equal(require("node:fs").readFileSync("result.txt","utf8"),"ok");');
  await writeFile(join(workspace,"result.txt"),"before");
  const git=(...args:string[])=>execFileSync("git",args,{cwd:workspace,stdio:"pipe"});
  git("init","-q"); git("add","."); git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","baseline");
  const handoff: Handoff={version:"1.0",id:"single-test",title:"Local fixture",objective:"实现本地结果文件并验证",category:"code_change",
    workspace:{root:workspace,allowedPaths:["result.txt"]},inputs:[],constraints:["Preserve SPEC.md and acceptance.cjs"],
    acceptanceCriteria:[{id:"ac",description:"result correct",verification:"node acceptance.cjs",verificationOwner:"executor"}],
    requestedOperations:[{type:"write",target:"result.txt",reason:"Produce declared file",risk:"low"},{type:"execute_tests",target:"node acceptance.cjs",reason:"Verify local file",risk:"low"}],
    deliverables:[{path:"result.txt",description:"result"}],testPlan:["node acceptance.cjs"],maxIterations:2};
  try { await run(root,handoff); } finally { await rm(root,{recursive:true,force:true}); }
}
function result(handoff:Handoff):ExecutionResult {
  return {status:"succeeded",summary:"Fixture only",artifacts:handoff.deliverables,criteriaEvidence:[{id:"ac",status:"pass",evidence:"fixture"}],tests:handoff.testPlan.map(command=>({command,status:"passed" as const,evidence:"fixture"})),proposedOperations:[],simulated:false};
}
const protectedPaths=["SPEC.md","acceptance.cjs"];

test("parallel/cross-module/transport hints never create an independent review obligation",()=>{
  for(const task of ["并行处理多个独立工作流","同时修改前后端和数据库服务","使用 CLI 实现本地工具","实现离线四模块事务与金额模拟器，不部署、不推送"]){
    const decision=routeTask(task);
    assert.notEqual(decision.orchestration.tier,"full",task);
    assert.equal(decision.executionPlan.verification,"acceptance");
    assert.equal(decision.executionPlan.parallelExecutionEnabled,false);
    assert.equal(decision.executionPlan.maxActiveImplementationOwners,1);
  }
});
test("real effects and explicit review still require independent verification, not another implementer",()=>{
  for(const task of ["部署到生产环境","推送到 origin/main","独立 Reviewer 审查修复","使用完整 Qing 实现功能"]){
    const d=routeTask(task); assert.equal(d.orchestration.independentReviewer,true,task);
    assert.equal(d.executionPlan.verification,"independent-review");
    assert.equal(d.executionPlan.implementationMode,"current-parent");
    assert.equal(d.executionPlan.grantsPermissions,false);
  }
});
test("ordinary direct and explicitly transferred tasks retain a single task owner",()=>{
  assert.equal(routeTask("修复本地函数").executionPlan.implementationMode,"current-parent");
  assert.equal(routeTask("使用 Qing Lite 实现完整模块").executionPlan.implementationMode,"single-worker");
});
test("declared high-risk contract cannot be erased by offline prose",async()=>{
  await fixture(async(_root,h)=>{
    assert.deepEqual(independentReviewReasons(h),[]);
    assert.ok(independentReviewReasons({...h,orchestration:{tier:"full",childAgentBudget:2,independentReviewer:true,maxRevisions:1}}).length);
    assert.ok(independentReviewReasons({...h,requestedOperations:[{type:"production_deploy",target:"prod",reason:"test",risk:"high"}]}).length);
  });
});
test("workspace lease blocks concurrent acquisition and releases only its own ownership",async()=>{
  const root=await mkdtemp(join(tmpdir(),"qing-lease-test-"));
  try { const lease=await acquireWorkspaceLease(root); await assert.rejects(acquireWorkspaceLease(root),/WORKSPACE_BUSY/); await lease.release(); await lease.release(); const next=await acquireWorkspaceLease(root); await next.release(); }
  finally { await rm(root,{recursive:true,force:true}); }
});
test("workspace lease canonicalizes aliases without treating RunStore as the lock boundary",async()=>{
  const root=await mkdtemp(join(tmpdir(),"qing-lease-alias-"));
  try { await mkdir(join(root,"actual")); await symlink(join(root,"actual"),join(root,"alias"),process.platform==="win32"?"junction":"dir"); const lease=await acquireWorkspaceLease(join(root,"actual")); try { await assert.rejects(acquireWorkspaceLease(join(root,"alias")),/WORKSPACE_BUSY/); }finally{await lease.release();} }
  finally{await rm(root,{recursive:true,force:true});}
});
test("immutable inputs reject traversal, missing files and symlinks",async()=>{
  await fixture(async(_root,h)=>{
    const before=await protectedInputSnapshot(h.workspace.root,protectedPaths); assert.match(before["SPEC.md"]!,/^[0-9a-f]{64}$/);
    for(const paths of [[],["../outside"],["SPEC.md","SPEC.md"],["missing"]]) await assert.rejects(protectedInputSnapshot(h.workspace.root,paths));
  });
});
test("turn usage preserves subset arithmetic and never claims request counts or a complete bill",()=>{
  const u=parseCodexUsage(JSON.stringify({type:"turn.completed",usage:{input_tokens:100,cached_input_tokens:80,output_tokens:30,reasoning_output_tokens:20}}));
  assert.deepEqual(u.totals,{inputTokens:100,cachedInputTokens:80,outputTokens:30,totalTokens:130});
  assert.equal(u.modelRequestCount,null); assert.equal(u.costUsd,null); assert.equal(u.wholeTaskUsageComplete,false);
});
test("missing, malformed and failed usage remain explicitly unknown rather than zero",()=>{
  for(const stream of ["",'{"type":"turn.completed"}','bad-json',JSON.stringify({type:"turn.completed",usage:{input_tokens:10,cached_input_tokens:20,output_tokens:0}})]){const u=parseCodexUsage(stream);assert.equal(u.totals,null);assert.ok(u.problems.length);}
  const u=parseCodexUsage('{"type":"turn.failed"}');assert.ok(u.problems.includes("failed-turn-may-have-unreported-usage"));
});
test("single-owner controller runs one implementation and real acceptance without a manager",async()=>{
  await fixture(async(root,h)=>{
    let calls=0;
    const executor:Executor={name:"codex-exec",async execute(value,context){calls++; assert.equal(context.singleOwner,true); await writeFile(join(value.workspace.root,"result.txt"),"ok"); return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const controller=new SingleOwnerController(executor);
    const output=await controller.run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(output.status,"COMPLETED",JSON.stringify(output)); assert.equal(calls,1);
    assert.equal(output.controller.managerModelCalls,0); assert.equal(output.controller.executorInvocations,1); assert.equal(output.controller.independentReviewPerformed,false);
    assert.equal((await handle.readTestEvidence(1)).length,1);
    await assert.rejects(controller.run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths}),/cannot be restarted/);
  });
});
test("changed protected acceptance never becomes success even if the worker self-reports pass",async()=>{
  await fixture(async(root,h)=>{
    const executor:Executor={name:"codex-exec",async execute(value){await writeFile(join(value.workspace.root,"result.txt"),"ok");await writeFile(join(value.workspace.root,"acceptance.cjs"),"// forged pass");return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(out.status,"BLOCKED"); assert.match(out.message,/Protected inputs changed/); assert.equal(out.attempts.length,0);
  });
});
test("a failed real acceptance stops after one invocation, not an automatic agent ladder",async()=>{
  await fixture(async(root,h)=>{
    let calls=0; const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:5,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.notEqual(out.status,"COMPLETED"); assert.equal(calls,1); assert.equal(out.controller.automaticRetries,0);
  });
});
test("required review and cancellation cannot be disguised as single-owner success",async()=>{
  await fixture(async(root,h)=>{
    let calls=0; const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const reviewed={...h,orchestration:{tier:"full" as const,childAgentBudget:2,independentReviewer:true,maxRevisions:1}};
    await assert.rejects(new SingleOwnerController(executor).run(reviewed,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths}),/INDEPENDENT_REVIEW_REQUIRED/);assert.equal(calls,0);
  });
});

test("a pre-cancelled run never starts its worker or acceptance",async()=>{
  await fixture(async(root,h)=>{
    let calls=0;
    const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const store=new RunStore(join(root,"state")); const handle=await store.createRun(h);
    await store.cancelRun(handle.runId,async()=>true);
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


test("legacy independent-slice evidence cannot reactivate split implementation",()=>{
  const d=routeTask("实现模块",{delegationEvidence:{boundary:"independent-slice",contract:"fixed",acceptance:"ready",work:"substantial",parentWork:"independent-work"}});
  assert.equal(d.orchestration.tier,"direct");
  assert.equal(d.executionPlan.implementationMode,"current-parent");
  assert.equal(d.orchestration.childAgentBudget,0);
});
test("real Full dispatch keeps the parent as implementer and allocates only independent review",async()=>{
  const { NodeProcessRunner }=await import("../src/process-runner.js");
  await fixture(async(_root,h)=>{
    const out=await new NodeProcessRunner().run({command:process.execPath,args:["dist/src/cli.js","dispatch","--task","使用完整 Qing 实现一个本地功能","--workspace",h.workspace.root,"--config","config/relay.example.json","--no-model-probe"],cwd:process.cwd(),stdin:"",timeoutMs:20000,maxOutputBytes:300000});
    assert.equal(out.exitCode,0,out.stderr);
    const d=JSON.parse(out.stdout);
    assert.equal(d.executionPlan.implementationMode,"current-parent");
    assert.equal(d.executionPlan.verification,"independent-review");
    assert.equal(d.modelSelection,null);
    assert.equal(d.delegationInvocation,null);
    assert.equal(d.reviewerModelSelection.role,"reviewer");
  });
});
test("implicit process planning creates a local scaffold without a manager-model executable",async()=>{
  const { NodeProcessRunner }=await import("../src/process-runner.js");
  await fixture(async(root,h)=>{
    const config=join(root,"local-planner.json");
    const handoff=join(root,"planned.json");
    await writeFile(config,JSON.stringify({executor:{codexExec:{command:"qing-manager-model-must-not-run"}}}));
    const out=await new NodeProcessRunner().run({command:process.execPath,args:["dist/src/cli.js","start","--task","使用 CLI 实现一个本地功能","--workspace",h.workspace.root,"--config",config,"--out",handoff],cwd:process.cwd(),stdin:"",timeoutMs:20000,maxOutputBytes:300000});
    assert.equal(out.exitCode,0,out.stderr);
    const d=JSON.parse(out.stdout);
    assert.equal(d.plannerSource,"local-fallback");
    assert.equal(d.modelSelection,null);
    assert.ok(JSON.parse(await readFile(handoff,"utf8")).testPlan.length>0);
  });
});
