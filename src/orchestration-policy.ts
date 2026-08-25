import type {
  Handoff,
  HandoffOrchestrationContract,
  OrchestrationConfig,
  OrchestrationDecision,
  TaskCategory,
  TaskComplexityAnalysis,
  TaskRoute,
} from "./types.js";

export interface OrchestrationPolicyInput {
  text: string;
  route: TaskRoute;
  category: TaskCategory;
  complexity: TaskComplexityAnalysis;
  signals: string[];
  config?: OrchestrationConfig | undefined;
}

export const defaultOrchestrationConfig: OrchestrationConfig = {
  mode: "adaptive",
  liteMaxChildren: 1,
  fullMaxChildren: 3,
  liteMaxRevisions: 1,
  fullMaxRevisions: 2,
  reviewerMode: "risk-based",
};

const explicitFull = /(?:启动|使用|采用|进入).{0,10}(?:Level\s*3|完整(?:版)?\s*Qing|完整编排|全量编排)|(?:独立|单独)\s*(?:Reviewer|审查(?:者|代理))|(?:使用|启用|启动|切换到?|改用)\s*(?:Codex\s*)?CLI|full(?:\s+qing|\s+orchestration)|independent\s+reviewer|(?:use|enable|start|switch\s+to)\s+(?:codex\s+)?cli/i;
const explicitDelegation = /(?:使用|创建|生成|启用).{0,10}(?:子(?:智能体|代理)|agent)|(?:delegate|spawn).{0,10}(?:agent|subagent)|Qing\s*Lite|轻量编排/i;
const genuinelyParallel = /多个(?:互相)?独立(?:任务|工作流|工作项)|并行(?:任务|工作流|实现|审查)|parallel\s+(?:tasks?|workstreams?)|independent\s+workstreams?/i;
const highEffectSignals = new Set([
  "infrastructure",
  "external-action",
  "delete-action",
  "git-push-action",
  "purchase-action",
  "global-write-action",
  "secret-action",
  "private-network-action",
  "scope-expansion-action",
  "database-migration-action",
  "global-install-action",
]);

export function decideOrchestration(input: OrchestrationPolicyInput): OrchestrationDecision {
  const config = input.config ?? defaultOrchestrationConfig;
  const text = input.text.trim();
  const forcedFull = config.mode === "full" || explicitFull.test(text) || input.signals.includes("cli-backend-condition");
  const decomposable = genuinelyParallel.test(text);
  const riskyEffect = input.signals.some((signal) => highEffectSignals.has(signal))
    || input.complexity.risk === "critical";
  const crossSystem = input.complexity.scope === "cross-system";

  if (input.route === "chat" && !forcedFull && !decomposable) {
    return {
      tier: "direct",
      childAgentBudget: 0,
      independentReviewer: false,
      maxRevisions: 0,
      parentVerification: false,
      modelSelectionRequired: false,
      approvalPolicy: "effects-only",
      decomposable: false,
      reasons: ["parent-answer"],
    };
  }

  if (forcedFull || riskyEffect || crossSystem || decomposable) {
    const reasons = [
      ...(forcedFull ? [config.mode === "full" ? "configuration-forces-full" : input.signals.includes("cli-backend-condition") ? "explicit-cli-backend-workflow" : "explicit-full-request"] : []),
      ...(riskyEffect ? ["high-risk-or-external-effect"] : []),
      ...(crossSystem ? ["cross-system-scope"] : []),
      ...(decomposable ? ["genuinely-parallel-work"] : []),
    ];
    return {
      tier: "full",
      childAgentBudget: config.fullMaxChildren,
      independentReviewer: true,
      maxRevisions: config.fullMaxRevisions,
      parentVerification: false,
      modelSelectionRequired: true,
      approvalPolicy: "effects-only",
      decomposable,
      reasons,
    };
  }

  const needsLite = explicitDelegation.test(text)
    || input.complexity.band === "complex"
    || input.complexity.band === "high-risk"
    || input.complexity.scope === "multi-step"
    || input.category === "mixed";
  if (needsLite) {
    return {
      tier: "lite",
      childAgentBudget: config.liteMaxChildren,
      independentReviewer: false,
      maxRevisions: config.liteMaxRevisions,
      parentVerification: true,
      modelSelectionRequired: true,
      approvalPolicy: "effects-only",
      decomposable: false,
      reasons: [explicitDelegation.test(text) ? "explicit-delegation-request" : "bounded-complexity"],
    };
  }

  return {
    tier: "direct",
    childAgentBudget: 0,
    independentReviewer: false,
    maxRevisions: 0,
    parentVerification: input.route !== "chat",
    modelSelectionRequired: false,
    approvalPolicy: "effects-only",
    decomposable: false,
    reasons: [input.route === "chat" ? "parent-answer" : "safe-single-scope-work"],
  };
}

export function createHandoffOrchestrationContract(decision: OrchestrationDecision): HandoffOrchestrationContract {
  return {
    tier: decision.tier,
    childAgentBudget: decision.childAgentBudget,
    independentReviewer: decision.independentReviewer,
    maxRevisions: decision.maxRevisions,
  };
}

export function bindHandoffOrchestration(handoff: Handoff, decision: OrchestrationDecision): Handoff {
  const orchestration = createHandoffOrchestrationContract(decision);
  return {
    ...handoff,
    maxIterations: Math.min(handoff.maxIterations, orchestration.maxRevisions + 1),
    orchestration,
  };
}

export interface ExecutableOrchestrationLimits {
  contract: HandoffOrchestrationContract;
  maxIterations: number;
  source: "handoff" | "derived-legacy";
}

export function resolveExecutableOrchestrationLimits(
  handoff: Handoff,
  decision: OrchestrationDecision,
  config: OrchestrationConfig,
  relayMaxIterations: number,
): ExecutableOrchestrationLimits {
  const contract = handoff.orchestration ?? createHandoffOrchestrationContract(decision);
  const configuredChildBudget = contract.tier === "direct" ? 0 : contract.tier === "lite" ? config.liteMaxChildren : config.fullMaxChildren;
  const configuredRevisionBudget = contract.tier === "direct" ? 0 : contract.tier === "lite" ? config.liteMaxRevisions : config.fullMaxRevisions;
  if (contract.childAgentBudget > configuredChildBudget) {
    throw new Error(`Handoff childAgentBudget ${contract.childAgentBudget} exceeds the configured ${contract.tier} limit ${configuredChildBudget}.`);
  }
  if (contract.maxRevisions > configuredRevisionBudget) {
    throw new Error(`Handoff maxRevisions ${contract.maxRevisions} exceeds the configured ${contract.tier} limit ${configuredRevisionBudget}.`);
  }
  return {
    contract,
    maxIterations: Math.max(1, Math.min(relayMaxIterations, handoff.maxIterations, contract.maxRevisions + 1)),
    source: handoff.orchestration ? "handoff" : "derived-legacy",
  };
}
