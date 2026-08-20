import type { ModelHealthRecord } from "./model-health.js";
import type {
  ComplexityBand,
  ModelBackend,
  ModelCandidate,
  ModelFallbackAttempt,
  ModelFallbackAudit,
  ModelFallbackGateAssessment,
  ModelFallbackPlan,
  ModelFallbackPlanCandidate,
  ModelFallbackScopeProof,
  ModelPair,
  ModelReasoningEffort,
  ModelRole,
  ModelSelection,
  TaskCategory,
  TaskRoute,
} from "./types.js";

export interface ModelSelectionRequest {
  backend: ModelBackend;
  role: ModelRole;
  route: Exclude<TaskRoute, "chat">;
  category: TaskCategory;
  complexityBand: ComplexityBand;
  tags?: string[];
}

export class NoHealthyModelCandidateError extends Error {
  constructor(message: string, readonly fallbackAudit?: ModelFallbackAudit) {
    super(message);
    this.name = "NoHealthyModelCandidateError";
  }
}

export class ModelFallbackRequiresGateError extends Error {
  constructor(message: string, readonly fallbackAudit?: ModelFallbackAudit) {
    super(message);
    this.name = "ModelFallbackRequiresGateError";
  }
}

const desktopCapabilities: Readonly<Record<string, readonly ModelReasoningEffort[]>> = {
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
};
const cliCapabilities: Readonly<Record<string, readonly ModelReasoningEffort[]>> = {
  "gpt-5.6": ["minimal", "low", "medium", "high", "xhigh"],
  "gpt-5.6-sol": ["minimal", "low", "medium", "high", "xhigh"],
  "gpt-5.6-terra": ["minimal", "low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["minimal", "low", "medium", "high", "xhigh"],
  "gpt-5.3-codex-spark": ["minimal", "low", "medium", "high", "xhigh"],
};

export function supportedReasoningEfforts(backend: ModelBackend, model: string): readonly ModelReasoningEffort[] {
  return (backend === "desktop-child" ? desktopCapabilities : cliCapabilities)[model] ?? [];
}

export function validateModelCapability(candidate: Pick<ModelCandidate, "backend" | "model" | "profile" | "reasoningEffort" | "availability">): string | null {
  if (candidate.backend === "desktop-child" && candidate.profile !== null) return "Desktop child candidates cannot use CLI profiles.";
  if (candidate.backend === "desktop-child" && candidate.availability !== "host-advertised") return "Desktop child candidates must be explicitly host-advertised for this configuration snapshot.";
  if (candidate.backend === "codex-cli" && candidate.availability !== "entitlement-dependent") return "Codex CLI availability must remain entitlement-dependent until a health probe passes.";
  const efforts = supportedReasoningEfforts(candidate.backend, candidate.model);
  if (efforts.length === 0) return `Model '${candidate.model}' is not in the declared ${candidate.backend} capability snapshot.`;
  if (!efforts.includes(candidate.reasoningEffort)) return `Reasoning effort '${candidate.reasoningEffort}' is unsupported for ${candidate.backend}/${candidate.model}.`;
  return null;
}

function supports(candidate: ModelCandidate, request: ModelSelectionRequest): boolean {
  const tags = request.tags ?? [];
  return candidate.enabled
    && candidate.backend === request.backend
    && validateModelCapability(candidate) === null
    && candidate.roles.includes(request.role)
    && candidate.routes.includes(request.route)
    && candidate.complexityBands.includes(request.complexityBand)
    && (candidate.categories.length === 0 || candidate.categories.includes(request.category))
    && (tags.length === 0 || candidate.tags.length === 0 || tags.every((tag) => candidate.tags.includes(tag)));
}

function isAvailable(candidate: ModelCandidate, health: ReadonlyMap<string, ModelHealthRecord>): boolean {
  return candidate.backend === "desktop-child"
    ? candidate.availability === "host-advertised"
    : health.get(candidate.id)?.state === "healthy";
}

const verifiedUnchangedScope: ModelFallbackScopeProof = {
  operationsUnchanged: true,
  allowedPathsUnchanged: true,
  sandboxUnchanged: true,
  permissionsUnchanged: true,
  effectsUnchanged: true,
};

function pair(candidate: Pick<ModelCandidate, "id" | "backend" | "model" | "profile" | "reasoningEffort">): ModelPair {
  return {
    candidateId: candidate.id,
    backend: candidate.backend,
    model: candidate.model,
    profile: candidate.profile,
    reasoningEffort: candidate.reasoningEffort,
  };
}

function plannedCandidate(candidate: ModelCandidate, health: ReadonlyMap<string, ModelHealthRecord>): ModelFallbackPlanCandidate {
  const record = health.get(candidate.id);
  return {
    ...pair(candidate),
    availability: candidate.availability,
    observedState: candidate.backend === "desktop-child" ? "host-advertised" : record?.state ?? "unverified",
    cacheState: candidate.backend === "desktop-child" ? "fresh" : record?.cacheState ?? null,
  };
}

export function assessModelFallbackGate(
  plannedPair: ModelPair,
  actualPair: ModelPair,
  scope?: Partial<ModelFallbackScopeProof>,
): ModelFallbackGateAssessment {
  const scopeProofComplete = [
    "operationsUnchanged",
    "allowedPathsUnchanged",
    "sandboxUnchanged",
    "permissionsUnchanged",
    "effectsUnchanged",
  ].every((field) => typeof scope?.[field as keyof ModelFallbackScopeProof] === "boolean");
  const normalizedScope: ModelFallbackScopeProof = {
    operationsUnchanged: scope?.operationsUnchanged === true,
    allowedPathsUnchanged: scope?.allowedPathsUnchanged === true,
    sandboxUnchanged: scope?.sandboxUnchanged === true,
    permissionsUnchanged: scope?.permissionsUnchanged === true,
    effectsUnchanged: scope?.effectsUnchanged === true,
  };
  const backendUnchanged = plannedPair.backend === actualPair.backend;
  const securityScopeUnchanged = scopeProofComplete
    && normalizedScope.allowedPathsUnchanged
    && normalizedScope.sandboxUnchanged
    && normalizedScope.permissionsUnchanged
    && normalizedScope.effectsUnchanged;
  const requiresNewGate = !backendUnchanged || !scopeProofComplete || !normalizedScope.operationsUnchanged || !securityScopeUnchanged;
  const reasons: string[] = [];
  if (!backendUnchanged) reasons.push("backend-changed");
  if (!scopeProofComplete) reasons.push("scope-proof-incomplete");
  if (scope?.operationsUnchanged === false) reasons.push("operations-changed");
  if (scope?.allowedPathsUnchanged === false) reasons.push("allowed-paths-changed");
  if (scope?.sandboxUnchanged === false) reasons.push("sandbox-changed");
  if (scope?.permissionsUnchanged === false) reasons.push("permissions-changed");
  if (scope?.effectsUnchanged === false) reasons.push("effects-changed");
  return { backendUnchanged, scopeProofComplete, ...normalizedScope, securityScopeUnchanged, requiresNewGate, reasons };
}

function explicitFallbackPlan(
  primary: ModelCandidate,
  candidates: ModelCandidate[],
  health: ReadonlyMap<string, ModelHealthRecord>,
  request: ModelSelectionRequest,
): ModelFallbackPlan {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ordered: ModelCandidate[] = [];
  const visited = new Set<string>();
  const visit = (candidate: ModelCandidate): void => {
    if (visited.has(candidate.id)) return;
    visited.add(candidate.id);
    ordered.push(candidate);
    for (const fallbackId of candidate.fallbacks) {
      const fallback = byId.get(fallbackId);
      if (!fallback) continue;
      if (fallback.backend !== primary.backend) {
        throw new ModelFallbackRequiresGateError(`Explicit fallback '${fallback.id}' crosses from ${primary.backend} to ${fallback.backend}; a backend change requires a fresh gate.`);
      }
      if (supports(fallback, request)) visit(fallback);
    }
  };
  visit(primary);
  return {
    strategy: "completion-first-explicit-chain",
    orderedCandidates: ordered.map((candidate) => plannedCandidate(candidate, health)),
    sameBackendOnly: true,
    noImplicitFallthrough: true,
  };
}

function unavailableReason(candidate: ModelFallbackPlanCandidate, health: ReadonlyMap<string, ModelHealthRecord>): string {
  if (candidate.observedState === "host-advertised") return "Host-advertised candidate has not yet been rejected by a real spawn.";
  return health.get(candidate.candidateId)?.reason ?? `Observed state is ${candidate.observedState}.`;
}

function selectionFromPlan(
  plan: ModelFallbackPlan,
  selectedIndex: number,
  role: ModelRole,
  complexityBand: ComplexityBand,
  attempts: ModelFallbackAttempt[],
  fallbackReason: string | null,
): ModelSelection {
  const planned = plan.orderedCandidates[0]!;
  const actual = plan.orderedCandidates[selectedIndex]!;
  const gateAssessment = assessModelFallbackGate(planned, actual, verifiedUnchangedScope);
  if (gateAssessment.requiresNewGate) throw new ModelFallbackRequiresGateError(`Model substitution requires a fresh gate: ${gateAssessment.reasons.join(", ")}.`);
  const fallbackFrom = selectedIndex > 0 ? plan.orderedCandidates[selectedIndex - 1]!.candidateId : null;
  return {
    executionOwner: "Codex",
    candidateId: actual.candidateId,
    backend: actual.backend,
    model: actual.model,
    profile: actual.profile,
    reasoningEffort: actual.reasoningEffort,
    availability: actual.availability,
    role,
    complexityBand,
    reason: fallbackFrom
      ? `Selected explicit capability-valid same-backend fallback '${actual.candidateId}' after '${fallbackFrom}' was unavailable.`
      : `Selected available ${actual.backend} candidate '${actual.candidateId}' for ${role}, complexity=${complexityBand}, by tags and priority.`,
    cacheState: actual.cacheState ?? "fresh",
    fallbackFrom,
    fallbackPlan: plan,
    fallbackAudit: {
      executionOwner: "Codex",
      plannedPair: pair({ id: planned.candidateId, ...planned }),
      actualPair: pair({ id: actual.candidateId, ...actual }),
      fallbackReason,
      chain: plan.orderedCandidates.map(({ candidateId }) => candidateId),
      attempts,
      gateAssessment,
    },
  };
}

export function selectModelCandidate(candidates: ModelCandidate[], health: ReadonlyMap<string, ModelHealthRecord>, request: ModelSelectionRequest): ModelSelection {
  const configured = candidates.filter((candidate) => supports(candidate, request));
  if (configured.length === 0) throw new NoHealthyModelCandidateError(`No configured model candidate supports backend=${request.backend}, role=${request.role}, route=${request.route}, category=${request.category}, complexity=${request.complexityBand}.`);
  const requestedTags = request.tags ?? [];
  const tagScore = (candidate: ModelCandidate): number => requestedTags.filter((tag) => candidate.tags.includes(tag)).length;
  const ordered = [...configured].sort((left, right) => tagScore(right) - tagScore(left) || right.priority - left.priority || left.id.localeCompare(right.id));

  const fallbackIds = new Set(configured.flatMap(({ fallbacks }) => fallbacks));
  const primary = ordered.find(({ id }) => !fallbackIds.has(id)) ?? ordered[0]!;
  const plan = explicitFallbackPlan(primary, candidates, health, request);
  const attempts: ModelFallbackAttempt[] = [];
  for (let index = 0; index < plan.orderedCandidates.length; index += 1) {
    const candidate = plan.orderedCandidates[index]!;
    const source = candidates.find(({ id }) => id === candidate.candidateId)!;
    if (isAvailable(source, health)) {
      attempts.push({ candidate: pair(source), outcome: "selected", reason: index === 0 ? "Highest-ranked explicit candidate is available." : "Explicit same-backend fallback is available." });
      const fallbackReason = attempts.filter(({ outcome }) => outcome === "unavailable").map(({ candidate: item, reason }) => `${item.candidateId}: ${reason}`).join(" | ") || null;
      return selectionFromPlan(plan, index, request.role, request.complexityBand, attempts, fallbackReason);
    }
    attempts.push({ candidate: pair(source), outcome: "unavailable", reason: unavailableReason(candidate, health) });
  }
  const states = plan.orderedCandidates.map((candidate) => `${candidate.candidateId}:${candidate.observedState}`).join(", ");
  throw new NoHealthyModelCandidateError(`No available configured candidate exists for ${request.backend}/${request.role}. States: ${states}. Use only an explicit fallback chain; probe CLI candidates when applicable.`);
}

export function continueModelFallbackAfterRejection(
  selection: ModelSelection,
  rejectedCandidateId: string,
  fallbackReason: string,
  scope?: Partial<ModelFallbackScopeProof>,
): ModelSelection {
  if (!fallbackReason.trim()) throw new Error("A concrete fallback reason is required after a model rejection.");
  if (selection.candidateId !== rejectedCandidateId) throw new Error(`Rejected candidate '${rejectedCandidateId}' is not the current actual candidate '${selection.candidateId}'.`);
  const currentIndex = selection.fallbackPlan.orderedCandidates.findIndex(({ candidateId }) => candidateId === rejectedCandidateId);
  if (currentIndex < 0) throw new NoHealthyModelCandidateError(`Rejected candidate '${rejectedCandidateId}' is absent from the explicit fallback plan.`);
  const attempts = selection.fallbackAudit.attempts.map((attempt) => attempt.outcome === "selected" && attempt.candidate.candidateId === rejectedCandidateId
    ? { ...attempt, outcome: "rejected" as const, reason: fallbackReason }
    : attempt);
  const combinedReason = [selection.fallbackAudit.fallbackReason, `${rejectedCandidateId}: ${fallbackReason}`].filter(Boolean).join(" | ");
  const rejectedAudit: ModelFallbackAudit = {
    ...selection.fallbackAudit,
    executionOwner: "Codex",
    actualPair: selection.fallbackAudit.actualPair,
    fallbackReason: combinedReason,
    attempts,
  };
  for (let index = currentIndex + 1; index < selection.fallbackPlan.orderedCandidates.length; index += 1) {
    const candidate = selection.fallbackPlan.orderedCandidates[index]!;
    if (candidate.observedState !== "host-advertised" && candidate.observedState !== "healthy") {
      attempts.push({ candidate: pair({ id: candidate.candidateId, ...candidate }), outcome: "unavailable", reason: `Observed state is ${candidate.observedState}.` });
      continue;
    }
    const gateAssessment = assessModelFallbackGate(selection.fallbackAudit.plannedPair, candidate, scope);
    if (gateAssessment.requiresNewGate) {
      throw new ModelFallbackRequiresGateError(
        `Model substitution requires a fresh gate: ${gateAssessment.reasons.join(", ")}.`,
        { ...rejectedAudit, gateAssessment },
      );
    }
    attempts.push({ candidate: pair({ id: candidate.candidateId, ...candidate }), outcome: "selected", reason: "Next explicit capability-valid same-backend candidate selected after a real rejection." });
    const continued = selectionFromPlan(selection.fallbackPlan, index, selection.role, selection.complexityBand, attempts, combinedReason);
    return {
      ...continued,
      role: selection.role,
      complexityBand: selection.complexityBand,
      reason: `Selected explicit same-backend fallback '${candidate.candidateId}' after host rejected '${rejectedCandidateId}': ${fallbackReason}`,
      fallbackFrom: rejectedCandidateId,
      fallbackAudit: {
        ...continued.fallbackAudit,
        plannedPair: selection.fallbackAudit.plannedPair,
        fallbackReason: combinedReason,
        gateAssessment,
      },
    };
  }
  throw new NoHealthyModelCandidateError(
    `Explicit fallback chain exhausted after '${rejectedCandidateId}' was rejected; no healthy safe candidate remains.`,
    rejectedAudit,
  );
}
