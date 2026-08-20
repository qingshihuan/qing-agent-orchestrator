import type { ModelHealthRecord } from "./model-health.js";
import type { ComplexityBand, ModelBackend, ModelCandidate, ModelReasoningEffort, ModelRole, ModelSelection, TaskCategory, TaskRoute } from "./types.js";

export interface ModelSelectionRequest {
  backend: ModelBackend;
  role: ModelRole;
  route: Exclude<TaskRoute, "chat">;
  category: TaskCategory;
  complexityBand: ComplexityBand;
  tags?: string[];
}

export class NoHealthyModelCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoHealthyModelCandidateError";
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

export function selectModelCandidate(candidates: ModelCandidate[], health: ReadonlyMap<string, ModelHealthRecord>, request: ModelSelectionRequest): ModelSelection {
  const configured = candidates.filter((candidate) => supports(candidate, request));
  if (configured.length === 0) throw new NoHealthyModelCandidateError(`No configured model candidate supports backend=${request.backend}, role=${request.role}, route=${request.route}, category=${request.category}, complexity=${request.complexityBand}.`);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const requestedTags = request.tags ?? [];
  const tagScore = (candidate: ModelCandidate): number => requestedTags.filter((tag) => candidate.tags.includes(tag)).length;
  const ordered = [...configured].sort((left, right) => tagScore(right) - tagScore(left) || right.priority - left.priority || left.id.localeCompare(right.id));

  const visit = (candidate: ModelCandidate, fallbackFrom: string | null, chain: Set<string>): ModelSelection | null => {
    if (chain.has(candidate.id)) return null;
    chain.add(candidate.id);
    if (isAvailable(candidate, health)) {
      return {
        candidateId: candidate.id, backend: candidate.backend, model: candidate.model, profile: candidate.profile,
        reasoningEffort: candidate.reasoningEffort, availability: candidate.availability, role: request.role,
        complexityBand: request.complexityBand,
        reason: fallbackFrom
          ? `Selected explicit available fallback '${candidate.id}' after '${fallbackFrom}' was unavailable.`
          : `Selected available ${candidate.backend} candidate '${candidate.id}' for ${request.role}, complexity=${request.complexityBand}, by tags and priority.`,
        cacheState: candidate.backend === "desktop-child" ? "fresh" : health.get(candidate.id)!.cacheState,
        fallbackFrom,
      };
    }
    for (const fallbackId of candidate.fallbacks) {
      const fallback = byId.get(fallbackId);
      if (fallback && supports(fallback, request)) {
        const selected = visit(fallback, candidate.id, chain);
        if (selected) return selected;
      }
    }
    return null;
  };

  const fallbackIds = new Set(configured.flatMap(({ fallbacks }) => fallbacks));
  const primary = ordered.find(({ id }) => !fallbackIds.has(id)) ?? ordered[0]!;
  const selected = visit(primary, null, new Set());
  if (selected) return selected;
  const states = configured.map((candidate) => `${candidate.id}:${candidate.backend === "desktop-child" ? candidate.availability : health.get(candidate.id)?.state ?? "unverified"}`).join(", ");
  throw new NoHealthyModelCandidateError(`No available configured candidate exists for ${request.backend}/${request.role}. States: ${states}. Use only an explicit fallback chain; probe CLI candidates when applicable.`);
}
