from pathlib import Path
import json
import re
import subprocess
import textwrap

BASE = 'd6bf2da3e172479b8f311f8bbabc72766ba60ff4'
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
changes = set(subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines())
assert changes <= {'.github/maintenance/migrate-gpt6.py', '.github/workflows/prepare-gpt6-scheduling.yml'}, changes

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(textwrap.dedent(value).lstrip('\n').encode('utf-8'))

def replace(path, old, new, count=1):
    s = read(path)
    assert s.count(old) == count, (path, old[:100], s.count(old))
    write(path, s.replace(old, new))

def append(path, value):
    write(path, read(path).rstrip() + '\n\n' + textwrap.dedent(value).strip() + '\n')

# Migrate active fixtures and instructions, not historical releases or evidence.
renames = {'gpt-5.6-sol': 'gpt-6-sol', 'gpt-5.6-luna': 'gpt-6-luna', 'gpt-5.6-terra': 'gpt-6-astra', 'gpt-5.3-codex-spark': 'gpt-6-luna'}
paths = list(Path('tests').rglob('*.ts')) + list(Path('examples').rglob('*.json'))
paths += list(Path('schemas').rglob('*.json'))
paths += [p for p in Path('.agents/skills').rglob('*.md') if 'runtime' not in p.parts]
for p in paths:
    original = read(p)
    updated = original
    for old, new in renames.items():
        updated = updated.replace(old, new)
    if updated != original:
        write(p, updated)

router = 'src/model-router.ts'
s = read(router)
a = s.index('// Recognized configuration pairs')
b = s.index('// Config parsing accepts', a)
s = s[:a] + '''// Project policy, not an assertion of live host/account access.
export const supportedTaskModels = Object.freeze([
  "gpt-6-luna", "gpt-6-sol", "gpt-6-astra",
] as const);
const desktopCapabilities: Readonly<Record<string, readonly ModelReasoningEffort[]>> = {
  "gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
};

''' + s[b:]
s = s.replace('  if (backend === "codex-cli") return catalogValidatedCliEfforts;', '  if (!Object.prototype.hasOwnProperty.call(desktopCapabilities, model)) return [];\n  if (backend === "codex-cli") return catalogValidatedCliEfforts;')
s = s.replace("is not in the declared ${candidate.backend} capability snapshot.", "is outside the GPT-6 task-model policy; use gpt-6-luna, gpt-6-sol or gpt-6-astra. Migrate the saved candidate configuration before retrying.")
old = '''export function selectModelCandidate(candidates: ModelCandidate[], health: ReadonlyMap<string, ModelHealthRecord>, request: ModelSelectionRequest): ModelSelection {'''
assert s.count(old) == 1
s = s.replace(old, '''export function planModelCandidates(candidates: ModelCandidate[], health: ReadonlyMap<string, ModelHealthRecord>, request: ModelSelectionRequest): ModelFallbackPlan {''', 1)
old = '''  const plan = explicitFallbackPlan(primary, candidates, health, request);
  const attempts: ModelFallbackAttempt[] = [];'''
assert s.count(old) == 1
s = s.replace(old, '''  return explicitFallbackPlan(primary, candidates, health, request);
}

export function selectModelCandidate(candidates: ModelCandidate[], health: ReadonlyMap<string, ModelHealthRecord>, request: ModelSelectionRequest): ModelSelection {
  const plan = planModelCandidates(candidates, health, request);
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const attempts: ModelFallbackAttempt[] = [];''', 1)
s = s.replace('const source = candidates.find(({ id }) => id === candidate.candidateId)!;', 'const source = byId.get(candidate.candidateId)!;')
write(router, s)

write('src/model-scheduler.ts', '''
import { planModelCandidates, selectModelCandidate, type ModelSelectionRequest } from "./model-router.js";
import type { ModelHealthChecker, ModelHealthRecord } from "./model-health.js";
import type { ModelCandidate, ModelFallbackPlanCandidate, ModelSelection } from "./types.js";

export interface ScheduledModel {
  selection: ModelSelection;
  health: ModelHealthRecord[];
}
type HealthChecker = Pick<ModelHealthChecker, "check" | "invalidateAfterRejection">;

/** One scheduler per CLI invocation, never a global account/entitlement cache. */
export class TaskModelScheduler {
  constructor(private readonly candidates: ModelCandidate[], private readonly checker: HealthChecker) {}

  async select(request: ModelSelectionRequest): Promise<ScheduledModel> {
    if (request.backend !== "codex-cli") throw new Error("CLI scheduler cannot probe a desktop backend.");
    // Use exactly the selector's ordered, tag/role/scope-filtered explicit chain.
    // Do not preflight unrelated models or healthy-primary fallbacks.
    const plan = planModelCandidates(this.candidates, new Map(), request);
    const byId = new Map(this.candidates.map(candidate => [candidate.id, candidate]));
    const health: ModelHealthRecord[] = [];
    for (const planned of plan.orderedCandidates) {
      const observed = await this.checker.check(byId.get(planned.candidateId)!);
      health.push(observed);
      if (observed.state === "healthy") break;
    }
    return { selection: selectModelCandidate(this.candidates, new Map(health.map(record => [record.candidateId, record])), request), health };
  }

  /** Called only after a concrete, selected-model rejection, not a task failure. */
  async prepareFallback(selection: ModelSelection, reason: string): Promise<ModelSelection> {
    if (!reason.trim()) throw new Error("Runtime rejection requires a concrete reason.");
    const byId = new Map(this.candidates.map(candidate => [candidate.id, candidate]));
    const checked = (planned: ModelFallbackPlanCandidate): ModelCandidate => {
      const source = byId.get(planned.candidateId);
      if (!source || !source.enabled || !source.roles.includes(selection.role) ||
          !source.complexityBands.includes(selection.complexityBand) ||
          source.model !== planned.model || source.backend !== planned.backend ||
          source.profile !== planned.profile || source.reasoningEffort !== planned.reasoningEffort ||
          source.availability !== planned.availability || source.backend !== "codex-cli" ||
          source.profile !== selection.profile) {
        throw new Error("Fallback configuration changed; create a new selection and scope assessment.");
      }
      return source;
    };
    const ordered = selection.fallbackPlan.orderedCandidates.map(candidate => ({ ...candidate }));
    const index = ordered.findIndex(candidate => candidate.candidateId === selection.candidateId);
    if (index < 0) throw new Error("Selected model is absent from the fallback plan.");
    // Validate the entire remaining plan before any new process or cache write.
    const sources = ordered.slice(index).map(checked);
    await this.checker.invalidateAfterRejection(sources[0]!, reason);
    for (let offset = 1; offset < sources.length; offset += 1) {
      const observed = await this.checker.check(sources[offset]!);
      const planned = ordered[index + offset]!;
      planned.observedState = observed.state;
      planned.cacheState = observed.cacheState;
      if (observed.state === "healthy") break;
    }
    // The existing fallback code still verifies all effect/sandbox scope proof.
    return { ...selection, fallbackPlan: { ...selection.fallbackPlan, orderedCandidates: ordered } };
  }
}
''')

# A short negative-cache interval avoids repeatedly submitting the same rejected
# model without preventing a later explicit refresh. This is not task retry.
replace('src/model-health.ts', '  status(candidate: ModelCandidate): ModelHealthRecord {', '''  async invalidateAfterRejection(candidate: ModelCandidate, reason: string): Promise<void> {
    if (candidate.backend !== "codex-cli" || validateModelCapability(candidate)) {
      throw new Error("Cannot invalidate an unsupported model candidate.");
    }
    const cliVersion = await this.cliVersion();
    const now = (this.options.now ?? Date.now)();
    await this.storeRecord({
      candidateId: candidate.id, fingerprint: candidateFingerprint(candidate, cliVersion), cliVersion,
      state: "unhealthy", cacheState: "fresh", checkedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(this.options.ttlMs, 60_000)).toISOString(),
      failure: "capability", reason: "Runtime model rejection: " + redactSensitiveText(reason).slice(0, 600),
    });
  }

  status(candidate: ModelCandidate): ModelHealthRecord {''')
# Respect a newly configured shorter TTL even for a previously persisted entry.
replace('src/model-health.ts', 'if (!force && cached?.expiresAt && Date.parse(cached.expiresAt) > now)', 'if (!force && cached?.checkedAt && cached.expiresAt && Date.parse(cached.checkedAt) <= now && now - Date.parse(cached.checkedAt) < this.options.ttlMs && Date.parse(cached.expiresAt) > now)')

cli = 'src/cli.ts'
replace(cli, 'import { selectModelCandidate } from "./model-router.js";', 'import { selectModelCandidate } from "./model-router.js";\nimport { TaskModelScheduler } from "./model-scheduler.js";')
s = read(cli)
a = s.index('async function configuredModel(')
b = s.index('\nfunction desktopDelegationContract', a)
function = s[a:b]
c = function.index('  const checker = new ModelHealthChecker({')
function = function[:c] + '''  return taskModelScheduler(config).select({ backend, role, route: decision.route, category: decision.category, complexityBand });
}
'''
s = s[:a] + '''const taskSchedulers = new WeakMap<RelayConfig, TaskModelScheduler>();
function taskModelScheduler(config: RelayConfig): TaskModelScheduler {
  let scheduler = taskSchedulers.get(config);
  if (!scheduler) {
    scheduler = new TaskModelScheduler(config.modelRouting.candidates, new ModelHealthChecker({
      command: config.executor.codexExec.command,
      cwd: runtimeRoot,
      schemaPath: resolve(runtimeRoot, "schemas/model-health.schema.json"),
      timeoutMs: config.modelRouting.probeTimeoutMs,
      ttlMs: config.modelRouting.healthTtlMs,
      ephemeral: config.executor.codexExec.ephemeral,
      ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,
      cachePath: resolve(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory), "model-health-cache-v1.json"),
    }));
    taskSchedulers.set(config, scheduler);
  }
  return scheduler;
}

''' + function + s[b:]
s = s.replace('modelSelection: bundle.selection, modelHealth: bundle.health', 'modelSelection: bundle.selection, modelHealth: bundle.health, prepareModelFallback: (selection: ModelSelection, reason: string) => taskModelScheduler(config).prepareFallback(selection, reason)')
write(cli, s)
executor = 'src/executors/codex-exec-executor.ts'
replace(executor, '  modelHealth?: ModelHealthRecord[];', '  modelHealth?: ModelHealthRecord[];\n  prepareModelFallback?: (selection: ModelSelection, reason: string) => Promise<ModelSelection>;')
replace(executor, '''            const replacement = continueModelFallbackAfterRejection(
              rejected,''', '''            const prepared = this.options.prepareModelFallback
              ? await this.options.prepareModelFallback(rejected, rejectionReason)
              : rejected;
            const replacement = continueModelFallbackAfterRejection(
              prepared,''')
replace(executor, 'if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded) {', 'if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled) {')

# Three model names; multiple role/effort profiles are deliberate, not extra models.
config = json.loads(read('config/relay.example.json'))
config['modelRouting']['candidates'] = []
profiles = [
    ('luna-fast', 'luna', 'low', ['planner','executor','reviewer'], ['trivial'], 100, ['sol-fast']),
    ('sol-fast', 'sol', 'low', ['planner','executor','reviewer'], ['trivial'], 50, []),
    ('luna-normal', 'luna', 'medium', ['planner','executor','reviewer'], ['normal'], 100, ['sol-normal']),
    ('sol-normal', 'sol', 'medium', ['planner','executor','reviewer'], ['normal'], 50, []),
    ('sol-plan', 'sol', 'medium', ['planner'], ['complex','high-risk'], 100, ['astra-plan']),
    ('astra-plan', 'astra', 'medium', ['planner'], ['complex','high-risk'], 50, []),
    ('sol-complex', 'sol', 'high', ['executor','reviewer'], ['complex','high-risk'], 100, ['astra-demanding']),
    ('astra-demanding', 'astra', 'high', ['executor','reviewer'], ['complex','high-risk'], 50, []),
]
for prefix, backend in [('desktop','desktop-child'),('cli','codex-cli')]:
    for name, model, effort, roles, bands, priority, fallbacks in profiles:
        config['modelRouting']['candidates'].append(dict(id=prefix+'-'+name, backend=backend, model='gpt-6-'+model, profile=None, reasoningEffort=effort, availability='host-advertised' if prefix=='desktop' else 'entitlement-dependent', roles=roles, routes=['codex','hybrid'], categories=[], complexityBands=bands, tags=[], priority=priority, enabled=True, fallbacks=[prefix+'-'+f for f in fallbacks]))
write('config/relay.example.json', json.dumps(config, ensure_ascii=False, indent=2)+'\n')

# Update assertions whose model-policy premise intentionally changed, retaining
# protocol/safety/fallback coverage. Unknown models are now rejected on both backends.
p = 'tests/model-router.test.ts'
s = read(p)
a = s.index('test("desktop capabilities remain host snapshots')
b = s.index('\ntest("disabled, expired', a)
s = s[:a] + '''test("only the three GPT-6 models are recognized; CLI efforts still need the local catalog", () => {
  for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]) {
    assert.deepEqual(supportedReasoningEfforts("desktop-child", model), ["low", "medium", "high", "xhigh", "max"]);
    for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
      assert.equal(validateModelCapability({ backend: "codex-cli", model, profile: null, reasoningEffort: effort, availability: "entitlement-dependent" }), null);
    }
  }
  for (const model of ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark", "future-catalog-model", "toString"]) {
    for (const backend of ["desktop-child", "codex-cli"] as const) assert.deepEqual(supportedReasoningEfforts(backend, model), []);
  }
  assert.match(validateModelCapability({ backend: "codex-cli", model: "gpt-6-sol", profile: null, reasoningEffort: "none", availability: "entitlement-dependent" }) ?? "", /unsupported/);
});
''' + s[b:]
write(p, s)
p = 'tests/config.test.ts'
s = read(p)
a = s.index('    const futureCatalogModel =')
b = s.index('\n\n', a)
s = s[:a] + '''    await assert.rejects(loadConfig(await write("future.json", { modelRouting: { mode: "explicit", candidates: [{ ...baseCandidate, model: "future-catalog-model", reasoningEffort: "ultra", fallbacks: [] }] } })), /GPT-6 task-model policy/);''' + s[b:]
write(p, s)
p = 'tests/astra-efficiency.test.ts'
s = read(p)
a = s.index('test("Astra is opt-in and does not silently upgrade')
b = s.index('\ntest("an old-client', a)
s = s[:a] + '''test("GPT-6 defaults keep ordinary work on Luna and complex work on Sol", async () => {
  const config = await loadConfig("config/relay.example.json");
  assert.deepEqual([...new Set(config.modelRouting.candidates.map(c => c.model))].sort(), ["gpt-6-astra", "gpt-6-luna", "gpt-6-sol"]);
  for (const [complexityBand, expected] of [["normal", "gpt-6-luna"], ["complex", "gpt-6-sol"]] as const) {
    const selection = selectModelCandidate(config.modelRouting.candidates, new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand });
    assert.equal(selection.model, expected);
  }
});
''' + s[b:]
s = s.replace('config.executor.codexExec.command = "nonexistent-qing-probe-sentinel";', 'config.executor.codexExec.command = "nonexistent-qing-probe-sentinel";\n    config.modelRouting.candidates.find((c: { id: string }) => c.id === "cli-astra-demanding")!.enabled = false;')
s = s.replace('/Astra is opt-in/', '/Astra is reserved/')
write(p, s)

policy_text = '''GPT-6 task-model policy: only gpt-6-luna, gpt-6-sol and gpt-6-astra. Direct creates no child. For delegated trivial work use Luna/low; normal work Luna/medium; complex planning Sol/medium; complex execution and independent review Sol/high. Astra is reserved for demanding work and explicit complex-task fallback, not ordinary-task retry. A failed task or test is not model unavailability. Preserve the revision budget; diagnose the failure instead of trying every model. Verify live host/CLI availability and disclose the actual pair. Never downgrade high-risk review to Luna merely to save credits. The parent model is unchanged.'''
for name in ['qing-agent-orchestrator','qing-agent-orchestrator-full']:
    p = '.agents/skills/'+name+'/SKILL.md'
    s = read(p)
    a = s.index('Astra is opt-in')
    b = s.index('\n', a)
    s = s[:a] + policy_text + ' Before spawning show ownership, role/task and actual pair (or inherited/unconfirmed). Keep explicit same-backend fallback chains internal; disclose actual substitutions and re-gate changed scope.' + s[b:]
    write(p, s)
    p = '.agents/skills/'+name+'/references/orchestrator-spec.md'
    s = read(p)
    a = s.find('## v0.9 context and model policy')
    if a >= 0:
        s = s[:a]
    write(p, s.rstrip() + '\n\n## v0.10 GPT-6 routing\n\n' + policy_text + '\n')

write('tests/gpt6-scheduling.test.ts', '''
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
''')

write('scripts/measure-gpt6-scheduling.mjs', '''
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../dist/src/config.js";
import { ModelHealthChecker } from "../dist/src/model-health.js";
import { TaskModelScheduler } from "../dist/src/model-scheduler.js";
import { planModelCandidates } from "../dist/src/model-router.js";
const dir=await mkdtemp(join(tmpdir(),"qing-measure-scheduling-"));
const config=await loadConfig("config/relay.example.json");
const calls={before:[],after:[]};
const request={backend:"codex-cli",role:"executor",route:"codex",category:"code_change",complexityBand:"normal"};
try {
  for (const mode of ["before","after"]) {
    const runner={async run(r){
      calls[mode].push(r.args[0]);
      let stdout="codex-cli 9.9.9";
      if(r.args[0]==="debug")stdout=JSON.stringify({models:["luna","sol","astra"].map(n=>({slug:"gpt-6-"+n,supported_reasoning_levels:["low","medium","high"].map(effort=>({effort}))}))});
      if(r.args[0]==="exec") { await writeFile(r.args[r.args.indexOf("--output-last-message")+1],JSON.stringify({status:"ok",capabilities:["planner","executor","reviewer"]}));stdout='{"type":"turn.completed"}'; }
      return {exitCode:0,signal:null,stdout,stderr:"",timedOut:false,outputLimitExceeded:false,spawnError:null};
    }};
    const options={command:"fake",cwd:dir,schemaPath:join(dir,"schema"),cachePath:join(dir,mode+".json"),timeoutMs:1000,ttlMs:60000};
    const shared=new TaskModelScheduler(config.modelRouting.candidates,new ModelHealthChecker(options,runner));
    for(const role of ["planner","executor","reviewer"]) {
      const scheduler=mode==="after"?shared:new TaskModelScheduler(config.modelRouting.candidates,new ModelHealthChecker(options,runner));
      await scheduler.select({...request,role});
    }
  }
  const count=values=>({versionDiscoveries:values.filter(v=>v==="--version").length,catalogDiscoveries:values.filter(v=>v==="debug").length,modelProbes:values.filter(v=>v==="exec").length,totalProcessRequests:values.length});
  const matrix=[];
  for(const complexityBand of ["trivial","normal","complex","high-risk"]) for(const role of ["planner","executor","reviewer"]) {
    const plan=planModelCandidates(config.modelRouting.candidates,new Map(),{...request,complexityBand,role});
    matrix.push({complexityBand,role,model:plan.orderedCandidates[0].model,effort:plan.orderedCandidates[0].reasoningEffort,fallbacks:plan.orderedCandidates.slice(1).map(c=>c.model)});
  }
  const report={baseline:"d6bf2da3e172479b8f311f8bbabc72766ba60ff4",date:"2026-09-23",method:"Three role selections for the same pair; fake process runner, same persisted-cache semantics; separate checkers versus invocation-shared checker",before:count(calls.before),after:count(calls.after),matrix,limits:["Not a connected-model token, latency or price benchmark","No API billing assumptions applied to ChatGPT subscriptions","Reduced discovery does not mean fewer model probes when the old persistent cache already hits"]};
  await writeFile("docs/gpt6-scheduling-measurements.json",JSON.stringify(report,null,2)+"\\n");
  console.log(JSON.stringify(report,null,2));
} finally {await rm(dir,{recursive:true,force:true});}
''')

package=json.loads(read('package.json'))
assert package['version']=='0.9.0'
package['version']='0.10.0'
package['scripts']['test'] += ' dist/tests/gpt6-scheduling.test.js'
write('package.json',json.dumps(package,ensure_ascii=False,indent=2)+'\n')
lock=json.loads(read('package-lock.json'))
lock['version']=lock['packages']['']['version']='0.10.0'
write('package-lock.json',json.dumps(lock,ensure_ascii=False,indent=2)+'\n')

notes='''# v0.10.0 — GPT-6 三模型与按需调度

仅保留 `gpt-6-luna`、`gpt-6-sol`、`gpt-6-astra` 作为显式任务模型。旧模型及其他模型在配置解析和创建 CLI 参数时均被拒绝，不能通过回退链重新使用。历史版本、标签、历史测量与旧模型拒绝测试保留，不改写历史。

## 调度与消耗

| 委派工作 | 首选 | 显式回退 |
| --- | --- | --- |
| trivial | Luna / low | Sol / low |
| normal | Luna / medium | Sol / medium |
| complex / high-risk 规划 | Sol / medium | Astra / medium |
| complex / high-risk 执行与审查 | Sol / high | Astra / high |

Direct 仍不创建子任务、不分配子任务模型。不因为 Full、发布或多步骤就给所有角色使用 xhigh/max。任务或测试失败仍按有界修订处理，不能伪装为模型不可用来尝试所有模型。模型名称和档位的支持不代表当前账户已授权。

- CLI 预检与最终选择共用同一条有序显式链，修复深度/广度遍历不一致。
- 同一次命令按配置实例共享健康检查器，减少重复版本、目录发现；不跨账户共享运行时实例。
- 主模型预检成功时不提前探测备用模型。只有实际调用明确拒绝当前模型时，才按原链检查后继候选，再执行已有完整 scope/gate 校验。
- 对实际模型拒绝写入至多 60 秒的负缓存，避免下一任务立即重复失败；允许 `--force` 刷新，不新增后台重试。
- 较短的新配置 TTL 不再被旧缓存更长有效期绕过。
- 显式取消即使伴随 exit=0，也不能被执行器当作成功。

## 升级与边界

两版技能 ZIP、预编译 runtime、校验清单同步。旧的显式模型配置需要备份后迁移到 `config/relay.example.json` 的三模型配置；不自动覆盖用户的路径、权限或密钥设置。多个 candidate profile 是同一模型的角色/档位配置，不是增加模型种类。

安全安装包仍为 dry-run、真实执行关闭、modelRouting=inherit；继承父任务/宿主选择不等于已保证其使用 GPT-6。要强制这三款用于 CLI 子任务，应启用经本机目录和账户验证的显式三模型配置。父任务模型不被修改。

Astra 保留已核实的 0.153.0 最低 CLI 检查。Sol、Luna 不编造最低版本：使用本机目录的 model/effort/minimal_client_version，加真实有界健康预检。公开 API 档位不能直接作为桌面授权证明。

可复现调度计数见 `docs/gpt6-scheduling-measurements.json`。模拟进程计数不是实际模型 Token、端到端时延、成功率或订阅额度节省比例；没有调用用户真实账户进行 A/B。

官方核对日期：2026-09-23。Sol、Luna 于 2026-09-22 发布。来源：
- https://developers.openai.com/api/docs/changelog
- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/latest-model
- https://help.openai.com/en/articles/20001275

English: GPT-6-only explicit candidates, role-specific efforts, invocation-scoped shared checks, identical selection/probe order and lazy runtime fallback. Permission gates, bounded revisions, complete evidence and account checks remain intact. Old explicit model configurations require migration; inherited parent defaults are not silently rewritten.
'''
write('docs/release-notes-v0.10.0.md',notes)
s=read('CHANGELOG.md').replace('当前稳定版本为 `v0.9.0`','当前稳定版本为 `v0.10.0`')
s=s.replace('## 0.9.0 - ', '## 0.10.0 - 2026-09-23\n\n### Changed / Fixed\n\n- GPT-6 Luna/Sol/Astra only for explicit task candidates; older configs fail with migration guidance.\n- Role-specific low/medium/high profiles, shared per-command health discovery and consistent lazy fallback ordering.\n- Actual model rejection cooldown, stricter cache TTL reuse and cancelled-result rejection.\n- Rebuilt both editions; retained gates, evidence and default disabled real execution.\n- Deterministic process-request measurements and new scheduler regressions; see docs/release-notes-v0.10.0.md.\n\n## 0.9.0 - ',1)
write('CHANGELOG.md',s)
for p in ['README.md','README.en.md']:
    s=read(p)
    s=s.replace('[v0.9.0 发布说明](docs/release-notes-v0.9.0.md)','[v0.10.0 发布说明](docs/release-notes-v0.10.0.md)')
    s=s.replace('[v0.9.0 release notes](docs/release-notes-v0.9.0.md)','[v0.10.0 release notes](docs/release-notes-v0.10.0.md)')
    first,rest=s.split('\n',1)
    intro='## v0.10.0 — GPT-6 三模型调度\n\n仅保留 Luna、Sol、Astra；按角色使用 low/medium/high，共享任务内预检，备用模型仅按需探测。旧显式配置需要迁移，安全安装默认与父任务模型不变。详见 [发布说明](docs/release-notes-v0.10.0.md)。' if p=='README.md' else '## v0.10.0 — GPT-6-only task scheduling\n\nOnly Luna, Sol and Astra are explicit task candidates. Role-specific efforts, shared invocation checks and lazy fallbacks reduce redundant work. Migrate old explicit configs; safe installation and parent defaults are unchanged. See [release notes](docs/release-notes-v0.10.0.md).'
    write(p,first+'\n\n'+intro+'\n'+rest)
p='docs/architecture.md'
s=read(p)
a=s.index('当前桌面 host capability snapshot：')
b=s.index('## 关键不变量',a)
s=s[:a]+'''## 当前模型策略（v0.10）

显式任务候选仅允许 gpt-6-luna、gpt-6-sol、gpt-6-astra。桌面识别 low/medium/high/xhigh/max，但必须由实时 host 确认 pair。CLI 的档位与最低版本以本机目录为准，并需要账户预检；不把 API 文档当作桌面或订阅授权。

Luna 处理 trivial/normal；Sol 负责复杂规划、执行与独立审查；Astra 是复杂任务的显式后备。任务内共享健康检查器，预检与最终选择使用同一条有序回退链。安全默认 modelRouting=inherit 不改父任务选择；三模型限制作用于显式子任务候选。详见 release-notes-v0.10.0.md。

'''+s[b:]
a=s.find('## v0.9 Astra and efficiency')
if a>=0:s=s[:a]
write(p,s)
append('docs/codex-integration.md','''## v0.10 GPT-6-only scheduling

Explicit candidates must use gpt-6-luna, gpt-6-sol or gpt-6-astra; unknown and retired models fail before submission. Migrate old saved configurations rather than silently renaming their model IDs. The runtime's safe inherit default does not control the parent's model.

The CLI now shares one task scheduler per loaded configuration instance. It uses the exact selector chain, performs no speculative backup probes, and only preflights remaining fallbacks after an explicit selected-model runtime rejection. Authentication, task, cancellation, protocol, schema and timeout errors are not model-fallback triggers. Rejected-model health is invalidated for at most 60 seconds; explicit force refresh remains possible. Permission/profile/scope checks still apply. Sol/Luna minimum versions come from the installed catalog, not an invented fixed floor. See release-notes-v0.10.0.md.''')

# The generated runtime will be rebuilt after typecheck and full regression tests.
print('Prepared GPT-6-only scheduling source, tests and release metadata.')
