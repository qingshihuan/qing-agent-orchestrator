import type { ModelCandidate, ModelReasoningEffort } from "./types.js";

export interface CodexModelCatalogEntry {
  slug: string;
  supportedReasoningEfforts: ModelReasoningEffort[];
  minimalClientVersion: string | null;
}

export interface CodexModelCatalog {
  models: Map<string, CodexModelCatalogEntry>;
}

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const knownEfforts = new Set<ModelReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVersion(value: string): SemanticVersion | null {
  const match = value.match(/\b(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\b/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease, "en", { numeric: true });
}

export function parseCodexModelCatalog(value: string): CodexModelCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Codex model catalog is not valid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error("Codex model catalog must contain a models array.");
  }

  const models = new Map<string, CodexModelCatalogEntry>();
  for (const [index, item] of parsed.models.entries()) {
    if (!isRecord(item) || typeof item.slug !== "string" || item.slug.length === 0) {
      throw new Error(`Codex model catalog entry ${index + 1} has no valid slug.`);
    }
    if (!Array.isArray(item.supported_reasoning_levels)) {
      throw new Error(`Codex model catalog entry '${item.slug}' has no reasoning-level array.`);
    }
    const supportedReasoningEfforts: ModelReasoningEffort[] = [];
    for (const [effortIndex, effortItem] of item.supported_reasoning_levels.entries()) {
      if (!isRecord(effortItem) || typeof effortItem.effort !== "string" || !knownEfforts.has(effortItem.effort as ModelReasoningEffort)) {
        throw new Error(`Codex model catalog entry '${item.slug}' has an invalid effort at index ${effortIndex}.`);
      }
      const effort = effortItem.effort as ModelReasoningEffort;
      if (!supportedReasoningEfforts.includes(effort)) supportedReasoningEfforts.push(effort);
    }
    const minimum = item.minimal_client_version;
    if (minimum !== undefined && minimum !== null && typeof minimum !== "string") {
      throw new Error(`Codex model catalog entry '${item.slug}' has an invalid minimal client version.`);
    }
    if (models.has(item.slug)) throw new Error(`Codex model catalog contains duplicate slug '${item.slug}'.`);
    models.set(item.slug, {
      slug: item.slug,
      supportedReasoningEfforts,
      minimalClientVersion: typeof minimum === "string" && minimum.length > 0 ? minimum : null,
    });
  }
  if (models.size === 0) throw new Error("Codex model catalog is empty.");
  return { models };
}

export function validateCandidateAgainstCatalog(
  candidate: Pick<ModelCandidate, "backend" | "model" | "reasoningEffort">,
  catalog: CodexModelCatalog,
  cliVersion: string,
): string | null {
  if (candidate.backend !== "codex-cli") return "Only Codex CLI candidates can be checked against the Codex model catalog.";
  const entry = catalog.models.get(candidate.model);
  if (!entry) return `Model '${candidate.model}' is absent from this Codex CLI bundled model catalog.`;
  if (!entry.supportedReasoningEfforts.includes(candidate.reasoningEffort)) {
    return `Reasoning effort '${candidate.reasoningEffort}' is unsupported for ${candidate.model}; bundled catalog supports ${entry.supportedReasoningEfforts.join(", ") || "no configurable effort"}.`;
  }
  if (entry.minimalClientVersion) {
    const actual = parseVersion(cliVersion);
    const minimum = parseVersion(entry.minimalClientVersion);
    if (!actual) return `Could not parse the installed Codex CLI version '${cliVersion}' required to validate ${candidate.model}.`;
    if (!minimum) return `Bundled catalog has an invalid minimal client version '${entry.minimalClientVersion}' for ${candidate.model}.`;
    if (compareVersions(actual, minimum) < 0) {
      return `Model '${candidate.model}' requires Codex CLI ${entry.minimalClientVersion} or newer; installed version is ${cliVersion}.`;
    }
  }
  return null;
}
