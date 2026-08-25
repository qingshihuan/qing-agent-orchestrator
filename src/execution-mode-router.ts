import type {
  CliDependencyStatus,
  CliReasonCode,
  ExecutionModeDecision,
  OrchestrationTier,
  OrchestratorEdition,
  TaskRoute,
} from "./types.js";

const CLI_INSTALL_GUIDE = "https://learn.chatgpt.com/docs/codex/cli" as const;

const cliSignals: Array<{ code: CliReasonCode; pattern: RegExp }> = [
  { code: "explicit-cli-request", pattern: /(?:使用|启用|启动|切换到?|改用)\s*(?:Codex\s*)?CLI|(?:use|enable|start|switch\s+to)\s+(?:codex\s+)?cli(?:\s+mode)?/i },
  { code: "script-or-ci", pattern: /\bCI\b|GitHub Actions|持续集成|流水线|(?:shell|powershell|batch)\s+script|脚本调用|pipeline/i },
  { code: "scheduled-batch-unattended", pattern: /定时(?:任务|运行)?|计划任务|无人值守|批处理|scheduled|cron|unattended|batch\s+(?:job|run)/i },
  { code: "app-close-persistence", pattern: /(?:关闭|退出).{0,12}(?:桌面|应用|app).{0,12}(?:继续|运行)|(?:桌面|应用|app).{0,8}(?:关闭|退出)后.{0,8}(?:继续|运行)|after.{0,12}(?:desktop\s+)?app.{0,8}clos.{0,12}(?:continue|run)/i },
  { code: "machine-readable-control-plane", pattern: /JSONL|机器可读|status\s*\/\s*logs\s*\/\s*cancel|外部程序.{0,12}(?:状态|日志|取消)|machine[- ]readable|control[- ]plane/i },
  { code: "cli-only-model-or-environment", pattern: /CLI[- ]only|仅(?:能|可)?.{0,8}CLI.{0,8}(?:模型|环境|profile)|只能在.{0,8}CLI|(?:模型|环境|profile).{0,8}仅(?:能|可)?.{0,8}CLI/i },
  { code: "process-isolation-or-queue", pattern: /进程隔离|任务队列|独立进程|process[- ]isolation|task[- ]queue|worker[- ]process/i },
];

const visibleTask = /新开(?:会话|任务)|单独(?:会话|任务)|可见(?:会话|任务)|new\s+(?:thread|chat|task)|visible\s+(?:thread|task)/i;

function stripNegatedCliSignals(text: string): string {
  return text
    .replace(/(?:不|不要|无需|禁止|避免|拒绝|不想)[^，。；;,.]{0,18}(?:CLI|命令行|定时|无人值守|批处理|脚本|CI|流水线|任务队列|进程隔离)/gi, " ")
    .replace(/\b(?:do\s+not|don't|never|without|no|decline)\s+(?:\w+\s+){0,5}(?:cli|pipeline|script|scheduled|unattended|batch|queue)\b/gi, " ");
}

export function detectCliReasonCodes(text: string): CliReasonCode[] {
  const effective = stripNegatedCliSignals(text);
  return cliSignals.filter(({ pattern }) => pattern.test(effective)).map(({ code }) => code);
}

function recommendationBenefit(reasonCodes: CliReasonCode[]): string {
  if (reasonCodes.includes("app-close-persistence")) return "CLI 可在桌面应用关闭后继续运行并保留过程状态。";
  if (reasonCodes.includes("scheduled-batch-unattended")) return "CLI 更适合定时、批量或无人值守执行。";
  if (reasonCodes.includes("machine-readable-control-plane")) return "CLI 可提供适合外部程序读取的状态、日志和取消接口。";
  if (reasonCodes.includes("script-or-ci")) return "CLI 更适合脚本、流水线和 CI 调用。";
  if (reasonCodes.includes("cli-only-model-or-environment")) return "所需模型、配置或环境只在已配置的 CLI 后端可用。";
  if (reasonCodes.includes("process-isolation-or-queue")) return "CLI 可提供独立进程或任务队列边界。";
  return "你明确要求使用 CLI 执行这个任务。";
}

function declinedLimitations(reasonCodes: CliReasonCode[]): string[] {
  const messages: Partial<Record<CliReasonCode, string>> = {
    "scheduled-batch-unattended": "定时、批量或无人值守运行未由桌面回退提供。",
    "app-close-persistence": "桌面应用关闭后的持续运行未由桌面回退提供。",
    "machine-readable-control-plane": "供外部程序使用的机器可读 status、logs、cancel 或 JSONL 控制面未由桌面回退提供。",
    "cli-only-model-or-environment": "仅在 CLI 配置中可用的模型、profile 或环境未由桌面回退提供。",
    "process-isolation-or-queue": "独立进程、任务队列或进程隔离未由桌面回退提供。",
  };
  return reasonCodes.flatMap((code) => messages[code] ? [messages[code]] : []);
}

export function routeExecutionMode(
  text: string,
  edition: OrchestratorEdition,
  taskRoute: TaskRoute,
  orchestrationTier?: OrchestrationTier,
): ExecutionModeDecision {
  const delegationTarget = taskRoute === "chat" || orchestrationTier === "direct"
    ? "outer-session"
    : visibleTask.test(text)
      ? "visible-task"
      : "internal-child";
  const detectedReasonCodes = edition === "full" ? detectCliReasonCodes(text) : [];
  const reasonCodes = taskRoute === "chat"
    ? detectedReasonCodes.filter((code) => code === "explicit-cli-request")
    : detectedReasonCodes;
  const recommendation = reasonCodes.length > 0
    ? {
        message: "建议切换 CLI 模式" as const,
        benefit: recommendationBenefit(reasonCodes),
        reasonCodes,
        requiresUserChoice: true as const,
        response: "pending" as const,
        dependencyStatus: "not-checked" as const,
        installGuide: CLI_INSTALL_GUIDE,
      }
    : null;
  return {
    executionOwner: taskRoute === "chat" || delegationTarget === "outer-session" ? "ChatGPT" : "Codex",
    edition,
    mode: recommendation ? "cli-recommended" : "desktop-native",
    delegationTarget,
    returnsToParent: delegationTarget !== "visible-task",
    currentParentModelUnchanged: true,
    modelSelectionScope: "delegated-task",
    reasonCodes,
    recommendation,
    suppressCliPromptForTask: false,
    limitations: [],
  };
}

export interface CliDependencyInspector {
  inspect(): Promise<Exclude<CliDependencyStatus, "not-checked">>;
}

export async function respondToCliRecommendation(
  decision: ExecutionModeDecision,
  response: "accept" | "decline",
  inspector?: CliDependencyInspector,
): Promise<ExecutionModeDecision> {
  if (decision.edition !== "full" || !decision.recommendation || decision.mode !== "cli-recommended") {
    throw new Error("There is no pending full-edition CLI recommendation to answer.");
  }
  if (response === "decline") {
    return {
      ...decision,
      mode: "desktop-fallback",
      recommendation: { ...decision.recommendation, response: "declined" },
      suppressCliPromptForTask: true,
      limitations: declinedLimitations(decision.reasonCodes),
    };
  }
  if (!inspector) throw new Error("Accepting a CLI recommendation requires a dependency inspector.");
  const dependencyStatus = await inspector.inspect();
  return {
    ...decision,
    mode: dependencyStatus === "ready" ? "cli-full-planning" : "cli-setup-required",
    recommendation: { ...decision.recommendation, response: "accepted", dependencyStatus },
    suppressCliPromptForTask: true,
  };
}
