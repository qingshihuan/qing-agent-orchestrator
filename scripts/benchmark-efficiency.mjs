import { execFileSync } from "node:child_process";
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
