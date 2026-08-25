from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, found {count}: {pattern}")
    write(path, updated)


# ---------------------------------------------------------------------------
# 1. Semantic deletion detection: editing content inside index.js is not a
#    request to delete the file itself.
# ---------------------------------------------------------------------------
replace_once(
    "src/task-router.ts",
    'const deleteVerb = /删除|清空|移除|delete|remove|purge|drop/i;\n',
    'const deleteVerb = /删除|清空|移除|delete|remove|purge|drop/i;\n'
    'const inFileContentEdit = /(?:删除|移除|清理).{0,48}(?:[\\w.-]+[\\/\\\\])*[\\w.-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|json|ya?ml|md|txt|css|scss|html)(?:\\s*中|\\s*里|\\s*内|中的|里的|内的)|(?:delete|remove|clean).{0,64}\\b(?:from|in|inside)\\s+(?:[\\w.-]+[\\/\\\\])*[\\w.-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|json|ya?ml|md|txt|css|scss|html)/i;\n'
    'const explicitDeleteTarget = /(?:删除|清空|移除).{0,20}(?:文件|目录|文件夹|数据|记录|表|字段|列|分支|仓库|资源|账户|用户|缓存|日志|数据库|索引|对象|(?:[\\w.-]+[\\/\\\\])+[\\w.-]+|[\\w.-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|json|ya?ml|md|txt|css|scss|html))|(?:delete|remove|purge|drop).{0,24}(?:file|directory|folder|data|record|table|column|field|branch|repository|resource|account|user|cache|logs?|database|index|object|(?:[\\w.-]+[\\/\\\\])+[\\w.-]+|[\\w.-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|json|ya?ml|md|txt|css|scss|html))/i;\n',
)
replace_regex(
    "src/task-router.ts",
    r'\s*if \(deleteVerb\.test\(effective\)[\s\S]{0,360}?signals\.push\("delete-action"\);',
    '\n  const deleteIntent = !inFileContentEdit.test(effective)\n'
    '    && (explicitDeleteTarget.test(effective)\n'
    '      || (deleteVerb.test(effective) && destructiveTarget.test(effective) && !codeSymbolTarget.test(effective)));\n'
    '  if (deleteIntent) signals.push("delete-action");',
)

# ---------------------------------------------------------------------------
# 2. Compact control-plane output and cost-bounded Lite model selection.
# ---------------------------------------------------------------------------
replace_once(
    "src/cli.ts",
    'const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");\n\nfunction print(value: unknown): void {\n  process.stdout.write(`${JSON.stringify(value, null, 2)}\\n`);\n}\n',
    '''const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let compactMode = false;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compactModel(value: unknown): Record<string, unknown> | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.model !== "string") return null;
  return {
    model: candidate.model,
    reasoningEffort: candidate.reasoningEffort ?? null,
    role: candidate.role ?? null,
    fallbackFrom: candidate.fallbackFrom ?? null,
  };
}

function compactControlPlane(value: unknown): unknown {
  if (!compactMode) return value;
  const source = record(value);
  if (!source || typeof source.status !== "string") return value;
  const supported = new Set([
    "DIRECT_EXECUTION_REQUIRED",
    "LITE_EXECUTION_REQUIRED",
    "FULL_EXECUTION_READY",
    "AWAITING_APPROVAL",
    "DENIED",
    "CLI_RECOMMENDATION_REQUIRED",
    "CLI_SETUP_REQUIRED",
  ]);
  if (!supported.has(source.status)) return value;
  const orchestration = record(source.orchestration);
  const execution = record(source.execution);
  const gate = record(source.safetyGate);
  const decisions = Array.isArray(gate?.decisions) ? gate.decisions : [];
  const gateIds = decisions.flatMap((item) => {
    const decision = record(item);
    return decision?.decision === "REQUIRE_APPROVAL" && typeof decision.gateId === "string" ? [decision.gateId] : [];
  });
  return {
    status: source.status,
    executionOwner: source.executionOwner ?? execution?.executionOwner ?? null,
    route: source.route ?? null,
    category: source.category ?? null,
    tier: orchestration?.tier ?? null,
    budget: orchestration ? {
      children: orchestration.childAgentBudget ?? 0,
      revisions: orchestration.maxRevisions ?? 0,
      independentReviewer: orchestration.independentReviewer ?? false,
    } : null,
    model: compactModel(source.modelSelection),
    reviewerModel: compactModel(source.reviewerModelSelection),
    handoffId: source.handoffId ?? null,
    approval: gate ? { outcome: gate.outcome ?? null, gateIds } : { outcome: "ALLOW", gateIds: [] },
    modelProbe: source.modelProbe ?? null,
    nextStep: source.nextStep ?? null,
  };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(compactControlPlane(value), null, compactMode ? 0 : 2)}\n`);
}
''',
)
replace_once(
    "src/cli.ts",
    '  const args = process.argv.slice(2);\n  const command = args[0];\n',
    '  const args = process.argv.slice(2);\n  compactMode = args.includes("--compact");\n  const command = args[0];\n',
)
replace_once(
    "src/cli.ts",
    '  const complexity = analyzeTaskComplexity({ text: task, category: decision.category, role, routeSignals: decision.signals });\n',
    '  const analyzedComplexity = analyzeTaskComplexity({ text: task, category: decision.category, role, routeSignals: decision.signals });\n'
    '  const complexityBand = decision.orchestration.tier === "lite" ? "normal" : analyzedComplexity.band;\n',
)
replace_once(
    "src/cli.ts",
    'selection: selectModelCandidate(config.modelRouting.candidates, new Map(), { backend, role, route: decision.route, category: decision.category, complexityBand: complexity.band }),',
    'selection: selectModelCandidate(config.modelRouting.candidates, new Map(), { backend, role, route: decision.route, category: decision.category, complexityBand }),',
)
replace_once(
    "src/cli.ts",
    '    ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,\n  });\n  const relevant = config.modelRouting.candidates.filter((candidate) => candidate.enabled && candidate.backend === "codex-cli" && candidate.roles.includes(role));\n  const health = await Promise.all(relevant.map((candidate) => checker.check(candidate)));\n  const byId = new Map(health.map((record) => [record.candidateId, record]));\n  return { selection: selectModelCandidate(config.modelRouting.candidates, byId, { backend, role, route: decision.route, category: decision.category, complexityBand: complexity.band }), health };\n',
    '''    ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,
    cachePath: resolve(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory), "model-health-cache-v1.json"),
  });
  const relevant = config.modelRouting.candidates.filter((candidate) => candidate.enabled
    && candidate.backend === "codex-cli"
    && candidate.roles.includes(role)
    && candidate.routes.includes(decision.route)
    && candidate.complexityBands.includes(complexityBand)
    && (candidate.categories.length === 0 || candidate.categories.includes(decision.category)));
  const byCandidate = new Map(config.modelRouting.candidates.map((candidate) => [candidate.id, candidate]));
  const fallbackIds = new Set(relevant.flatMap(({ fallbacks }) => fallbacks));
  const primary = [...relevant]
    .filter(({ id }) => !fallbackIds.has(id))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0]
    ?? [...relevant].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0];
  if (!primary) throw new Error(`No configured CLI candidate supports ${role}/${decision.route}/${decision.category}/${complexityBand}.`);
  const health: ModelHealthRecord[] = [];
  const queue = [primary];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    if (visited.has(candidate.id)) continue;
    visited.add(candidate.id);
    const observed = await checker.check(candidate);
    health.push(observed);
    if (observed.state === "healthy") break;
    for (const fallbackId of candidate.fallbacks) {
      const fallback = byCandidate.get(fallbackId);
      if (fallback && relevant.some(({ id }) => id === fallback.id)) queue.push(fallback);
    }
  }
  const byId = new Map(health.map((observed) => [observed.candidateId, observed]));
  return { selection: selectModelCandidate(config.modelRouting.candidates, byId, { backend, role, route: decision.route, category: decision.category, complexityBand }), health };
''',
)
replace_once(
    "src/cli.ts",
    '    "  dispatch --task <goal> --workspace <project> [--edition standard|full] [--cli-response accept|decline] [--config <file>] [--no-model-probe]",\n',
    '    "  dispatch --task <goal> --workspace <project> [--edition standard|full] [--cli-response accept|decline] [--config <file>] [--no-model-probe] [--compact]",\n',
)

# ---------------------------------------------------------------------------
# 3. Cross-process health cache. It retains only bounded health records and is
#    keyed by the existing candidate+CLI-version fingerprint.
# ---------------------------------------------------------------------------
replace_once(
    "src/model-health.ts",
    'import { mkdtemp, readFile, rm } from "node:fs/promises";\n',
    'import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";\n',
)
replace_once(
    "src/model-health.ts",
    'import { join, resolve } from "node:path";\n',
    'import { dirname, join, resolve } from "node:path";\n',
)
replace_once(
    "src/model-health.ts",
    '  now?: () => number;\n}\n',
    '  now?: () => number;\n  cachePath?: string;\n}\n',
)
replace_once(
    "src/model-health.ts",
    '  private catalogPromise?: Promise<CodexModelCatalog>;\n',
    '  private catalogPromise?: Promise<CodexModelCatalog>;\n  private persistentCacheLoaded = false;\n',
)
replace_once(
    "src/model-health.ts",
    '    const cliVersion = await this.cliVersion();\n',
    '    await this.loadPersistentCache();\n    const cliVersion = await this.cliVersion();\n',
)
replace_once(
    "src/model-health.ts",
    '  private unverified(candidateId: string, reason: string): ModelHealthRecord {\n',
    '''  private async loadPersistentCache(): Promise<void> {
    if (this.persistentCacheLoaded) return;
    this.persistentCacheLoaded = true;
    if (!this.options.cachePath) return;
    try {
      const parsed = JSON.parse(await readFile(this.options.cachePath, "utf8")) as { version?: unknown; records?: unknown };
      if (parsed.version !== "1.0" || !Array.isArray(parsed.records)) return;
      for (const value of parsed.records.slice(-128)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = value as ModelHealthRecord;
        if (typeof record.candidateId !== "string" || typeof record.fingerprint !== "string" || typeof record.reason !== "string") continue;
        if (!record.fingerprint || !record.expiresAt || Number.isNaN(Date.parse(record.expiresAt))) continue;
        this.cache.set(record.fingerprint, record);
      }
    } catch {
      // A missing or malformed optimization cache never blocks execution.
    }
  }

  private async persistCache(): Promise<void> {
    if (!this.options.cachePath) return;
    const target = this.options.cachePath;
    const temporary = `${target}.${process.pid}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    const records = [...this.cache.values()]
      .sort((left, right) => String(left.checkedAt).localeCompare(String(right.checkedAt)))
      .slice(-128);
    try {
      await writeFile(temporary, JSON.stringify({ version: "1.0", records }, null, 2) + "\n", "utf8");
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async storeRecord(record: ModelHealthRecord): Promise<void> {
    this.cache.set(record.fingerprint, record);
    await this.persistCache();
  }

  private unverified(candidateId: string, reason: string): ModelHealthRecord {
''',
)
text = read("src/model-health.ts")
text = text.replace('this.cache.set(fingerprint, record);\n        return record;', 'await this.storeRecord(record);\n        return record;')
text = text.replace('this.cache.set(fingerprint, record!);\n    return record!;', 'await this.storeRecord(record!);\n    return record!;')
write("src/model-health.ts", text)

# ---------------------------------------------------------------------------
# 4. Stop one invalid criterion-evidence iteration from poisoning every later
#    retry.
# ---------------------------------------------------------------------------
replace_once(
    "src/relay.ts",
    '    const criterionEvidenceErrors: string[] = [];\n',
    '    const persistentCriterionEvidenceErrors: string[] = [];\n',
)
replace_once(
    "src/relay.ts",
    '      criterionEvidenceErrors.push("Relay-owned criteria require a current durable RunHandle.");\n',
    '      persistentCriterionEvidenceErrors.push("Relay-owned criteria require a current durable RunHandle.");\n',
)
replace_once(
    "src/relay.ts",
    '    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {\n      let gitAudit: GitScopeComparison | null = null;\n',
    '    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {\n      const criterionEvidenceErrors = [...persistentCriterionEvidenceErrors];\n      let gitAudit: GitScopeComparison | null = null;\n',
)

# ---------------------------------------------------------------------------
# 5. RunStore append operations no longer re-read and parse the entire JSONL
#    history while holding the lock. The durable record already stores the last
#    sequence number.
# ---------------------------------------------------------------------------
replace_once(
    "src/run-store.ts",
    '        this.record = JSON.parse(await readFile(this.recordPath, "utf8")) as RunRecord;\n        const text = await readFile(this.eventsPath, "utf8").catch(() => "");\n        const events = text.split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line) as RunEvent);\n        this.sequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);\n        return await operation();\n',
    '        this.record = JSON.parse(await readFile(this.recordPath, "utf8")) as RunRecord;\n        this.sequence = Math.max(this.sequence, this.record.lastEvent?.sequence ?? 0);\n        return await operation();\n',
)

# ---------------------------------------------------------------------------
# 6. Git audit keeps the tracked path index for scope checks but hashes only
#    dirty/untracked/deleted paths. Clean tracked files that become dirty are
#    classified as changed-existing through before.paths.
# ---------------------------------------------------------------------------
replace_once(
    "src/git-audit.ts",
    '  const contentDigests: Record<string, string> = {};\n  const workspacePath = (path: string): string => normalizePath(relative(resolve(cwd), join(repositoryRoot, path)) || ".");\n  for (const path of repositoryPaths) {\n    const mapped = workspacePath(path);\n    try { contentDigests[mapped] = createHash("sha256").update(await readFile(join(repositoryRoot, path))).digest("hex"); }\n    catch { contentDigests[mapped] = "missing"; }\n  }\n',
    '  const contentDigests: Record<string, string> = {};\n  const workspacePath = (path: string): string => normalizePath(relative(resolve(cwd), join(repositoryRoot, path)) || ".");\n  const digestPaths = [...new Set(repositoryEntries.flatMap((entry) => [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])]))];\n  for (const path of digestPaths) {\n    const mapped = workspacePath(path);\n    try { contentDigests[mapped] = createHash("sha256").update(await readFile(join(repositoryRoot, path))).digest("hex"); }\n    catch { contentDigests[mapped] = "missing"; }\n  }\n',
)
replace_once(
    "src/git-audit.ts",
    '    if (!before.contentDigests[path]) introducedPaths.push(path);\n    else if (!changedExistingPaths.includes(path)) changedExistingPaths.push(path);\n',
    '    if (!before.contentDigests[path]) {\n      const existedBefore = before.paths.some((candidate) => comparisonKey(candidate) === comparisonKey(path));\n      if (existedBefore) {\n        if (!changedExistingPaths.includes(path)) changedExistingPaths.push(path);\n      } else if (!introducedPaths.includes(path)) {\n        introducedPaths.push(path);\n      }\n    } else if (!changedExistingPaths.includes(path)) changedExistingPaths.push(path);\n',
)

# ---------------------------------------------------------------------------
# 7. Version, changelog, tests, and reproducible three-size benchmark.
# ---------------------------------------------------------------------------
for package_path in ["package.json", ".agents/skills/qing-agent-orchestrator-full/runtime/package.json"]:
    data = json.loads(read(package_path))
    data["version"] = "0.7.0"
    if package_path == "package.json":
        test_script = data["scripts"]["test"]
        if "dist/tests/v0.7-efficiency.test.js" not in test_script:
            data["scripts"]["test"] = test_script + " dist/tests/v0.7-efficiency.test.js dist/tests/model-health-persistent.test.js"
        data["scripts"]["benchmark:efficiency"] = "npm run build --silent && node scripts/benchmark-efficiency.mjs"
    write(package_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

changelog = read("CHANGELOG.md")
changelog = changelog.replace("当前稳定版本为 `v0.6.0`", "当前稳定版本为 `v0.7.0`", 1)
marker = "## 0.6.0 - 2026-08-25\n"
section = '''## 0.7.0 - 2026-08-26

### Added

- `--compact` 控制面输出：保留状态、档位、预算、真实模型、审批和下一步，省略重复 Handoff/路由详情。
- 跨进程模型健康缓存；热缓存不再重复 entitlement 模型调用，fallback 只在主候选不可用时按链懒探测。
- 短、中、长三档确定性效率基准和回归测试。

### Changed

- Lite 固定使用 normal 成本档位选择单一 Executor；复杂度或风险不再让 Lite 首次调用直接升级到 Sol/xhigh。
- 删除判断区分“删除文件”和“删除文件内部代码”；`index.js` 等文件内编辑保持 Direct。
- Git 审计保留完整 tracked 路径索引，但只读取并哈希 dirty/untracked/deleted 内容。
- RunStore 追加事件时从 durable lastEvent 恢复 sequence，不再反复读取完整 JSONL 历史。

### Fixed

- 单次 Relay criterion evidence 格式错误不再污染后续修订轮次。

### Evidence boundary

- 三档基准记录的是路由、模型档位、控制面字节数和确定性运行时开销；控制面字节数是 token 代理，不是服务端计费 token。
- 实际模型生成 token、端到端成功率和真实任务墙钟收益仍需在相同仓库快照与模型下进行 connected A/B。

'''
if "## 0.7.0 - 2026-08-26" not in changelog:
    if marker not in changelog:
        raise RuntimeError("CHANGELOG 0.6.0 marker missing")
    changelog = changelog.replace(marker, section + marker, 1)
write("CHANGELOG.md", changelog)

write("tests/v0.7-efficiency.test.ts", r'''import assert from "node:assert/strict";
import test from "node:test";
import { NodeProcessRunner } from "../src/process-runner.js";
import { routeTask } from "../src/task-router.js";

const shortTask = "删除 src/index.js 中未使用的 console.log，并运行相关测试";
const mediumTask = "先重构认证接口，然后实现缓存并运行相关测试";
const longTask = "在同一个 TypeScript 仓库内完成一个范围明确的功能更新：调整路由器对文档、代码符号和路径的语义识别，同步更新相关单元测试和说明，保持公共 API 不变，不访问网络、不发布、不部署、不推送，并执行现有本地测试验证所有改动。所有修改必须留在当前仓库内，保留无关文件和用户已有改动。";

test("v0.7 routes short and long coupled work Direct and keeps medium work Lite", () => {
  const short = routeTask(shortTask);
  assert.equal(short.orchestration.tier, "direct");
  assert.equal(short.signals.includes("delete-action"), false);
  const medium = routeTask(mediumTask);
  assert.equal(medium.orchestration.tier, "lite");
  assert.equal(medium.orchestration.childAgentBudget, 1);
  const long = routeTask(longTask);
  assert.equal(long.orchestration.tier, "direct");
  assert.equal(long.orchestration.childAgentBudget, 0);
});

test("v0.7 compact dispatch preserves control facts while reducing output", async () => {
  const runner = new NodeProcessRunner();
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 20_000, maxOutputBytes: 2_000_000 };
  for (const taskText of [shortTask, mediumTask, longTask]) {
    const args = ["dist/src/cli.js", "dispatch", "--task", taskText, "--workspace", process.cwd(), "--config", "config/relay.example.json", "--no-model-probe"];
    const full = await runner.run({ ...base, args });
    const compact = await runner.run({ ...base, args: [...args, "--compact"] });
    assert.equal(full.exitCode, 0, full.stderr);
    assert.equal(compact.exitCode, 0, compact.stderr);
    const fullValue = JSON.parse(full.stdout) as Record<string, unknown>;
    const compactValue = JSON.parse(compact.stdout) as Record<string, unknown>;
    assert.equal(compactValue.status, fullValue.status);
    assert.ok(Buffer.byteLength(compact.stdout) < Buffer.byteLength(full.stdout) * 0.75, taskText);
  }
  const medium = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", mediumTask, "--workspace", process.cwd(), "--config", "config/relay.example.json", "--no-model-probe", "--compact"] });
  const output = JSON.parse(medium.stdout) as { tier: string; model: { model: string; reasoningEffort: string } };
  assert.equal(output.tier, "lite");
  assert.equal(output.model.model, "gpt-5.6-luna");
  assert.equal(output.model.reasoningEffort, "medium");
});
''')

write("tests/model-health-persistent.test.ts", r'''import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { candidateFingerprint, ModelHealthChecker } from "../src/model-health.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "../src/process-runner.js";
import type { ModelCandidate } from "../src/types.js";

class VersionOnlyRunner implements ProcessRunner {
  calls: string[][] = [];
  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.calls.push(request.args);
    if (request.args.length === 1 && request.args[0] === "--version") {
      return { exitCode: 0, signal: null, stdout: "codex-cli 9.9.9\n", stderr: "", timedOut: false, outputLimitExceeded: false, spawnError: null };
    }
    throw new Error(`Persistent cache miss unexpectedly invoked: ${request.args.join(" ")}`);
  }
}

const candidate: ModelCandidate = {
  id: "cli-cache-fixture",
  backend: "codex-cli",
  model: "gpt-5.6-luna",
  profile: null,
  reasoningEffort: "medium",
  availability: "entitlement-dependent",
  roles: ["executor"],
  routes: ["codex"],
  categories: ["code_change"],
  complexityBands: ["normal"],
  tags: [],
  priority: 100,
  enabled: true,
  fallbacks: [],
};

test("model health cache is reused across checker instances without a model probe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-health-cache-"));
  const cachePath = join(directory, "health.json");
  const fingerprint = candidateFingerprint(candidate, "codex-cli 9.9.9");
  await writeFile(cachePath, JSON.stringify({ version: "1.0", records: [{
    candidateId: candidate.id,
    fingerprint,
    cliVersion: "codex-cli 9.9.9",
    state: "healthy",
    cacheState: "fresh",
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    failure: null,
    reason: "fixture",
  }] }), "utf8");
  try {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const runner = new VersionOnlyRunner();
      const checker = new ModelHealthChecker({ command: "codex", cwd: directory, schemaPath: join(directory, "schema.json"), timeoutMs: 5_000, ttlMs: 60_000, cachePath }, runner);
      const result = await checker.check(candidate);
      assert.equal(result.state, "healthy");
      assert.equal(result.cacheState, "cached");
      assert.deepEqual(runner.calls, [["--version"]]);
    }
    const persisted = JSON.parse(await readFile(cachePath, "utf8")) as { version: string };
    assert.equal(persisted.version, "1.0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
''')

write("scripts/benchmark-efficiency.mjs", r'''import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { routeTask } from "../dist/src/task-router.js";

const tasks = [
  { size: "short", text: "删除 src/index.js 中未使用的 console.log，并运行相关测试" },
  { size: "medium", text: "先重构认证接口，然后实现缓存并运行相关测试" },
  { size: "long", text: "在同一个 TypeScript 仓库内完成一个范围明确的功能更新：调整路由器对文档、代码符号和路径的语义识别，同步更新相关单元测试和说明，保持公共 API 不变，不访问网络、不发布、不部署、不推送，并执行现有本地测试验证所有改动。所有修改必须留在当前仓库内，保留无关文件和用户已有改动。" },
];

const dispatch = (task, compact) => execFileSync(process.execPath, [
  "dist/src/cli.js", "dispatch", "--task", task, "--workspace", process.cwd(),
  "--config", "config/relay.example.json", "--no-model-probe", ...(compact ? ["--compact"] : []),
], { encoding: "utf8" });

const results = tasks.map(({ size, text }) => {
  const full = dispatch(text, false);
  const compact = dispatch(text, true);
  const fullValue = JSON.parse(full);
  const compactValue = JSON.parse(compact);
  const fullBytes = Buffer.byteLength(full);
  const compactBytes = Buffer.byteLength(compact);
  return {
    size,
    tier: compactValue.tier,
    childBudget: compactValue.budget?.children ?? 0,
    independentReviewer: compactValue.budget?.independentReviewer ?? false,
    model: compactValue.model,
    fullBytes,
    compactBytes,
    reductionPct: Number(((1 - compactBytes / fullBytes) * 100).toFixed(1)),
    tokenProxyFull: Math.ceil(fullBytes / 4),
    tokenProxyCompact: Math.ceil(compactBytes / 4),
    status: fullValue.status,
  };
});

const iterations = 200_000;
const started = performance.now();
for (let index = 0; index < iterations; index += 1) routeTask(tasks[index % tasks.length].text);
const elapsedMs = performance.now() - started;
const report = {
  version: "0.7.0",
  measuredAt: new Date().toISOString(),
  evidenceBoundary: "Control-plane output bytes are a token proxy, not provider billing tokens. No model generation call is made by this benchmark.",
  routeTiming: { iterations, elapsedMs: Number(elapsedMs.toFixed(3)), microsecondsPerRoute: Number((elapsedMs * 1000 / iterations).toFixed(3)) },
  tasks: results,
};
mkdirSync("artifacts/benchmarks", { recursive: true });
writeFileSync("artifacts/benchmarks/v0.7-efficiency.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
''')

print("Applied v0.7 efficiency transformations")
