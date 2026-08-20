import { randomUUID } from "node:crypto";
import { detectCliReasonCodes, routeExecutionMode } from "./execution-mode-router.js";
import { analyzeTaskComplexity } from "./task-analyzer.js";
import type { ExecutionModeDecision, ExecutionOwner, Handoff, OperationRequest, OrchestratorEdition, TaskCategory, TaskComplexityAnalysis, TaskRoute } from "./types.js";

export interface TaskRouteDecision {
  executionOwner: ExecutionOwner;
  route: TaskRoute;
  confidence: "low" | "medium" | "high";
  category: TaskCategory;
  reasons: string[];
  signals: string[];
  execution: ExecutionModeDecision;
  complexity: TaskComplexityAnalysis;
}

export interface TaskRouteOptions {
  edition?: OrchestratorEdition;
}

const code = /实现|修复|重构|写代码|修改|新增|删除|build|implement|fix|refactor|code|edit/i;
const analysis = /分析|诊断|审查|评估|检查|核对|只读|analy[sz]e|diagnose|review|assess|inspect|audit|read[- ]only/i;
const advice = /解释|说明|建议|怎么|是什么|为什么|explain|advise|how|what|why/i;
const content = /文档|报告|演示|设计稿|document|report|presentation|copywriting/i;
const infrastructure = /部署|上线|生产环境|数据库迁移|服务器|deploy|production|migration|terraform|kubernetes/i;
const external = /发送|发布|通知|邮件|消息|send|publish|email|message|notify/i;
const sequence = /先.+(?:再|然后|之后)|规划.+(?:执行|实现)|plan.+(?:then|and).+(?:implement|execute)/i;
const cliExecutionIntent = /接入|配置|搭建|启用|启动|切换|改用|使用|运行|执行|继续|提供|输出|放入|迁移|自动化|完成|integrate|configure|set\s*up|enable|start|switch|use|run|execute|continue|provide|output|move|migrate|automate|complete/i;

/** Remove only negated high-risk terms so "不要发布" cannot create a high-risk route signal. */
export function stripNegatedRiskTerms(text: string): string {
  return text
    .replace(/(?:不|不要|不得|无需|禁止|避免|不会|不允许)[^，。；;,.]{0,10}(部署|上线|发布|发送|通知|邮件|消息|生产环境|数据库迁移|服务器)/gi, " ")
    .replace(/\b(?:do\s+not|don't|never|without|no)\s+(?:\w+\s+){0,3}(deploy|publish|send|email|message|notify|migrate)\b/gi, " ");
}

export function routeTask(text: string, options: TaskRouteOptions = {}): TaskRouteDecision {
  const task = text.trim();
  if (!task) throw new Error("Task text must not be empty.");
  const effective = stripNegatedRiskTerms(task);
  const signals: string[] = [];
  if (code.test(effective)) signals.push("code-change");
  if (analysis.test(effective)) signals.push("analysis");
  if (advice.test(effective)) signals.push("advice");
  if (content.test(effective)) signals.push("content");
  if (infrastructure.test(effective)) signals.push("infrastructure");
  if (external.test(effective)) signals.push("external-action");
  if (sequence.test(effective)) signals.push("plan-then-execute");

  const cliReasonCodes = detectCliReasonCodes(task);
  const hasReasoningOnlySignal = signals.some((value) => value === "advice" || value === "analysis");
  const explicitlyRequestsCli = cliReasonCodes.includes("explicit-cli-request");
  const actionableCliCondition = cliReasonCodes.length > 0
    && cliExecutionIntent.test(effective)
    && (explicitlyRequestsCli || !hasReasoningOnlySignal);
  if (actionableCliCondition && !signals.some((value) => ["code-change", "content", "infrastructure", "external-action"].includes(value))) {
    signals.push("code-change");
  }

  const hasExecution = signals.some((value) => ["code-change", "content", "infrastructure", "external-action"].includes(value));
  const materiallyMixed = signals.includes("plan-then-execute")
    || (signals.includes("code-change") && signals.some((value) => ["infrastructure", "external-action"].includes(value)))
    || (signals.includes("infrastructure") && signals.includes("external-action"));
  const route: TaskRoute = materiallyMixed ? "hybrid" : hasExecution ? "codex" : "chat";

  let category: TaskCategory = "advice";
  if (materiallyMixed) category = "mixed";
  else if (signals.includes("infrastructure")) category = "infrastructure";
  else if (signals.includes("external-action")) category = "external_action";
  else if (signals.includes("code-change")) category = "code_change";
  else if (signals.includes("content")) category = "content_creation";
  else if (signals.includes("analysis")) category = "analysis";

  const reasons = route === "chat"
    ? [signals.length ? "目标只要求解释、建议或只读推理，可由外层主会话回答。" : "未发现需要本地执行的明确动作，由外层主会话澄清或回答。"]
    : route === "codex"
      ? ["目标包含单一可执行产物，需要生成 Handoff 并等待精确 ID 批准。"]
      : ["目标包含规划后执行或多个实质类别，需要分阶段 Handoff 和审批。"];

  const execution = routeExecutionMode(task, options.edition ?? "full", route);
  const complexity = analyzeTaskComplexity({ text: task, category, role: "planner", routeSignals: signals });
  return {
    executionOwner: execution.executionOwner,
    route,
    confidence: signals.length === 0 ? "low" : materiallyMixed || signals.length === 1 ? "high" : "medium",
    category,
    reasons,
    signals,
    execution,
    complexity,
  };
}

export function createPendingDispatchHandoff(task: string, workspace: string, decision: TaskRouteDecision): Handoff {
  if (decision.route === "chat") throw new Error("Chat routing must not create a Handoff.");
  const operations: OperationRequest[] = [
    { type: "read", target: "**/*", reason: "Inspect only the project material required by the approved objective.", risk: "low" },
  ];
  if (decision.signals.some((signal) => ["code-change", "content"].includes(signal))) {
    operations.push(
      { type: "write", target: "**/*", reason: "Create only the approved project-local deliverables.", risk: "medium" },
      { type: "execute_tests", target: "project-local tests", reason: "Verify the approved deliverables locally.", risk: "low" },
    );
  }
  if (decision.signals.includes("infrastructure")) operations.push({ type: "production_deploy", target: "deployment target requires Planner refinement", reason: "The goal contains a real infrastructure action; retain it behind an explicit human gate.", risk: "high" });
  if (decision.signals.includes("external-action")) operations.push({ type: "external_message", target: "external target requires Planner refinement", reason: "The goal contains an external action; retain it behind an explicit human gate.", risk: "high" });
  return {
    version: "1.0",
    id: `qing-dispatch-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
    title: task.trim().slice(0, 100),
    objective: task.trim(),
    category: decision.category,
    workspace: { root: workspace, allowedPaths: ["**/*"] },
    inputs: [{ name: "user-goal", type: "text", value: task.trim(), required: true }],
    constraints: [
      "Preserve unrelated files and existing user changes.",
      "Do not execute before a person approves this exact Handoff ID.",
      "Any unlisted operation or unresolved remote target requires a revised Handoff and a new gate.",
    ],
    acceptanceCriteria: [{ id: "AC-OBJECTIVE", description: "The approved objective is completed and verified without expanding scope.", verification: "Executor returns concrete artifact and test evidence for the objective.", verificationOwner: "executor" }],
    requestedOperations: operations,
    deliverables: [],
    testPlan: operations.some(({ type }) => type === "execute_tests") ? ["Discover and run the project's relevant local test/build commands."] : [],
    maxIterations: 2,
    metadata: { createdAt: new Date().toISOString(), source: "qing-dispatch-local-envelope" },
  };
}
