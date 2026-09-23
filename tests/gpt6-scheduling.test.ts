import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { ModelHealthChecker, modelSelectionArgs, type ModelHealthRecord } from "../src/model-health.js";
import { TaskModelScheduler } from "../src/model-scheduler.js";
import { planModelCandidates, continueModelFallbackAfterRejection } from "../src/model-router.js";
import type { ModelCandidate, ModelRole } from "../src/types.js";
import type { ProcessRunner, ProcessRequest, ProcessResult } from "../src/process-runner.js";

const request = { backend: "codex-cli", role: "executor", route: "codex", category: "code_change", complexityBand: "normal" } as const;
const options = (dir: string) => ({ command: "fixture", cwd: dir, schemaPath: join(dir,"schema.json"), cachePath: join(dir,"health.json"), timeoutMs: 1000, ttlMs: 60000 });
class Runner implements ProcessRunner {
  calls: string[] = [];
  async run(req: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(req.args[0]!);
    let stdout = "";
    if (req.args[0] === "--version") stdout = "codex-cli 9.9.9";
    else if (req.args[0] === "debug") stdout = JSON.stringify({ models: ["luna","sol","astra"].map(name => ({ slug: "gpt-6-"+name, supported_reasoning_levels: ["low","medium","high"].map(effort => ({effort})) })) });
    else {
      await writeFile(req.args[req.args.indexOf("--output-last-message")+1]!, JSON.stringify({status:"ok",capabilities:["planner","executor","reviewer"]}));
      stdout = '{"type":"turn.completed"}';
    }
    return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null };
  }
}
function observed(c: ModelCandidate, healthy = true): ModelHealthRecord {
  return { candidateId:c.id, fingerprint:"fixture", cliVersion:"9.9.9", state:healthy?"healthy":"unhealthy", cacheState:"fresh", checkedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(), failure:healthy?null:"capability", reason:"fixture" };
}
const scope = { operationsUnchanged:true, allowedPathsUnchanged:true, sandboxUnchanged:true, permissionsUnchanged:true, effectsUnchanged:true };

test("GPT-6 profiles choose effort by role without default xhigh or max", async () => {
  const config = await loadConfig("config/relay.example.json");
  const expected = [["trivial","executor","gpt-6-luna","low"],["normal","executor","gpt-6-luna","medium"],["complex","planner","gpt-6-sol","medium"],["complex","executor","gpt-6-sol","high"],["high-risk","reviewer","gpt-6-sol","high"]] as const;
  for (const [complexityBand,role,model,effort] of expected) {
    const plan = planModelCandidates(config.modelRouting.candidates, new Map(), {...request,complexityBand,role});
    assert.equal(plan.orderedCandidates[0]?.model,model);
    assert.equal(plan.orderedCandidates[0]?.reasoningEffort,effort);
    assert.ok(plan.orderedCandidates.length <= 2);
    if (complexityBand === "normal") assert.ok(plan.orderedCandidates.every(c=>c.model!=="gpt-6-astra"));
  }
});

test("old models cannot bypass config policy through direct argument construction", () => {
  for (const model of ["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4","gpt-5.3-codex-spark"]) {
    assert.throws(()=>modelSelectionArgs({backend:"codex-cli",model,profile:null,reasoningEffort:"medium",availability:"entitlement-dependent"}), /GPT-6/);
  }
});

test("shared invocation avoids two version discoveries and keeps one real health probe", async () => {
  const dir = await mkdtemp(join(tmpdir(),"qing-scheduler-shared-"));
  try {
    const candidates = (await loadConfig("config/relay.example.json")).modelRouting.candidates;
    const runner = new Runner();
    const scheduler = new TaskModelScheduler(candidates,new ModelHealthChecker(options(dir),runner));
    for (const role of ["planner","executor","reviewer"] as ModelRole[]) assert.equal((await scheduler.select({...request,role})).selection.model,"gpt-6-luna");
    assert.deepEqual(runner.calls,["--version","debug","exec"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("scheduler follows the selector's depth-first explicit chain, not a separate breadth-first chain", async () => {
  const template = (await loadConfig("config/relay.example.json")).modelRouting.candidates.find(c=>c.id==="cli-luna-normal")!;
  const c = (id:string, priority:number, fallbacks:string[]): ModelCandidate => ({...template,id,priority,fallbacks});
  const candidates = [c("a",100,["b","d"]),c("b",50,["c"]),c("c",30,[]),c("d",20,[])];
  const calls:string[]=[];
  const scheduler = new TaskModelScheduler(candidates,{ async check(item){calls.push(item.id);return observed(item,item.id==="c" || item.id==="d");},async invalidateAfterRejection(){} });
  const result = await scheduler.select(request);
  assert.equal(result.selection.candidateId,"c");
  assert.deepEqual(calls,["a","b","c"]);
});

test("healthy primary never probes fallbacks or unrelated candidates", async () => {
  const candidates = (await loadConfig("config/relay.example.json")).modelRouting.candidates;
  const calls:string[]=[];
  const scheduler = new TaskModelScheduler(candidates,{ async check(c){calls.push(c.id);return observed(c);},async invalidateAfterRejection(){} });
  await scheduler.select(request);
  assert.deepEqual(calls,["cli-luna-normal"]);
});

test("a runtime rejection probes just the remaining explicit fallback and keeps scope proof", async () => {
  const candidates = (await loadConfig("config/relay.example.json")).modelRouting.candidates;
  const calls:string[]=[];
  const scheduler = new TaskModelScheduler(candidates,{ async check(c){calls.push(c.id);return observed(c);},async invalidateAfterRejection(c){calls.push("rejected:"+c.id);} });
  const selected = (await scheduler.select(request)).selection;
  const prepared = await scheduler.prepareFallback(selected,"selected model unavailable");
  const replacement = continueModelFallbackAfterRejection(prepared,selected.candidateId,"selected model unavailable",scope);
  assert.equal(replacement.model,"gpt-6-sol");
  assert.equal(replacement.fallbackAudit.gateAssessment.requiresNewGate,false);
  assert.deepEqual(calls,["cli-luna-normal","rejected:cli-luna-normal","cli-sol-normal"]);
});

test("changed fallback configuration is refused before cache mutation or any probe", async () => {
  const candidates = (await loadConfig("config/relay.example.json")).modelRouting.candidates;
  let calls=0;
  const scheduler = new TaskModelScheduler(candidates,{async check(c){calls++;return observed(c);},async invalidateAfterRejection(){calls++;}});
  const selected = (await scheduler.select(request)).selection;
  candidates.find(c=>c.id==="cli-sol-normal")!.profile="changed-profile";
  await assert.rejects(scheduler.prepareFallback(selected,"unavailable"),/configuration changed/);
  assert.equal(calls,1);
});

test("post-rejection cooldown is persisted, redacted and explicitly refreshable", async () => {
  const dir = await mkdtemp(join(tmpdir(),"qing-scheduler-reject-"));
  try {
    const c = (await loadConfig("config/relay.example.json")).modelRouting.candidates.find(c=>c.id==="cli-luna-normal")!;
    const runner=new Runner();
    const checker=new ModelHealthChecker(options(dir),runner);
    await checker.check(c);
    await checker.invalidateAfterRejection(c,"unavailable OPENAI_API_KEY=private-test-sentinel");
    const newRunner=new Runner();
    const next=new ModelHealthChecker(options(dir),newRunner);
    const cached=await next.check(c);
    assert.equal(cached.state,"unhealthy");
    assert.deepEqual(newRunner.calls,["--version"]);
    assert.doesNotMatch(await readFile(join(dir,"health.json"),"utf8"),/private-test-sentinel/);
    assert.equal((await next.check(c,true)).state,"healthy");
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("a shorter configured TTL cannot be bypassed by a longer persisted cache expiry", async () => {
  const dir=await mkdtemp(join(tmpdir(),"qing-scheduler-ttl-"));
  try {
    const c=(await loadConfig("config/relay.example.json")).modelRouting.candidates.find(c=>c.id==="cli-luna-normal")!;
    const start=Date.now();
    await new ModelHealthChecker({...options(dir),now:()=>start},new Runner()).check(c);
    const runner=new Runner();
    await new ModelHealthChecker({...options(dir),ttlMs:1000,now:()=>start+1500},runner).check(c);
    assert.equal(runner.calls.filter(x=>x==="exec").length,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("policy migration keeps real execution disabled and cannot silently reconfigure the parent", async () => {
  const config=await loadConfig();
  assert.equal(config.executor.codexExec.enabled,false);
  assert.equal(config.modelRouting.mode,"inherit");
  assert.deepEqual(config.modelRouting.candidates,[]);
});
