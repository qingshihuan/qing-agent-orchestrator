import type { ModelHealthRecord } from "./model-health.js";
import type { ModelCandidate, ModelRole, ModelSelection, TaskCategory, TaskRoute } from "./types.js";

export interface ModelSelectionRequest {
  role: ModelRole;
  route: Exclude<TaskRoute, "chat">;
  category: TaskCategory;
  tags?: string[];
}

export class NoHealthyModelCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoHealthyModelCandidateError";
  }
}

function supports(candidate: ModelCandidate, request: ModelSelectionRequest): boolean {
  const tags = request.tags ?? [];
  return candidate.enabled
    && candidate.roles.includes(request.role)
    && candidate.routes.includes(request.route)
    && (candidate.categories.length === 0 || candidate.categories.includes(request.category))
    && (tags.length === 0 || candidate.tags.length === 0 || tags.every((tag) => candidate.tags.includes(tag)));
}

export function selectModelCandidate(
  candidates: ModelCandidate[],
  health: ReadonlyMap<string, ModelHealthRecord>,
  request: ModelSelectionRequest,
): ModelSelection {
  const configured = candidates.filter((candidate) => supports(candidate, request));
  if (configured.length === 0) {
    throw new NoHealthyModelCandidateError(`No configured model candidate supports role=${request.role}, route=${request.route}, category=${request.category}.`);
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const requestedTags = request.tags ?? [];
  const tagScore = (candidate: ModelCandidate): number => requestedTags.filter((tag) => candidate.tags.includes(tag)).length;
  const ordered = [...configured].sort((left, right) => tagScore(right) - tagScore(left) || right.priority - left.priority || left.id.localeCompare(right.id));
  const visited = new Set<string>();

  const visit = (candidate: ModelCandidate, fallbackFrom: string | null): ModelSelection | null => {
    if (visited.has(candidate.id)) return null;
    visited.add(candidate.id);
    const status = health.get(candidate.id);
    if (status?.state === "healthy") {
      return {
        candidateId: candidate.id,
        model: candidate.model,
        profile: candidate.profile,
        reasoningEffort: candidate.reasoningEffort,
        role: request.role,
        reason: fallbackFrom
          ? `Selected explicit healthy fallback '${candidate.id}' after '${fallbackFrom}' was unavailable.`
          : `Selected healthy candidate '${candidate.id}' for ${request.role} by task tags and priority.`,
        cacheState: status.cacheState,
        fallbackFrom,
      };
    }
    for (const fallbackId of candidate.fallbacks) {
      const fallback = byId.get(fallbackId);
      if (fallback && supports(fallback, request)) {
        const selected = visit(fallback, candidate.id);
        if (selected) return selected;
      }
    }
    return null;
  };

  for (const candidate of ordered) {
    const selected = visit(candidate, null);
    if (selected) return selected;
  }
  const states = configured.map((candidate) => `${candidate.id}:${health.get(candidate.id)?.state ?? "unverified"}`).join(", ");
  throw new NoHealthyModelCandidateError(`No healthy configured candidate is available for ${request.role}. States: ${states}. Run 'models probe' or fix the explicit candidate list.`);
}
