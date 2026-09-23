import assert from "node:assert/strict";
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
    source.runtime = { ...(source.runtime ?? {}), stateDirectory: join(directory,"runs") };
    source.security ??= { approvedGateIds: [] };
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


test("Handoff references distinguish native host assessment from standalone grants",async()=>{
  const standard=await readFile(".agents/skills/qing-agent-orchestrator/references/handoff-protocol.md","utf8");
  const full=await readFile(".agents/skills/qing-agent-orchestrator-full/references/handoff-protocol.md","utf8");
  assert.match(standard,/does not require a second Qing gate-ID prompt/);
  assert.match(standard,/DENY and unknown permission states never become grants/);
  assert.match(full,/## Native parent and children/);
  assert.match(full,/## Standalone Relay/);
  assert.match(full,/must not manufacture/);
});
