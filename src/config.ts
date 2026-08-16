import { readFile } from "node:fs/promises";
import type { ModelCandidate, ModelReasoningEffort, ModelRole, RelayConfig, TaskCategory } from "./types.js";

export const defaultConfig: RelayConfig = {
  executor: {
    mode: "dry-run",
    codexExec: {
      enabled: false,
      command: "codex",
      timeoutMs: 900_000,
      probeTimeoutMs: 10_000,
      sandbox: "workspace-write",
      ephemeral: true,
      ignoreUserConfig: true,
      skipGitRepoCheck: false,
      windowsSandbox: null,
      outputSchemaPath: "schemas/executor-result.schema.json",
      maxOutputBytes: 4 * 1024 * 1024,
    },
  },
  relay: { maxIterations: 3 },
  runtime: { stateDirectory: ".qing/runs" },
  modelRouting: { mode: "inherit", healthTtlMs: 3_600_000, probeTimeoutMs: 30_000, candidates: [] },
  security: { approvedGateIds: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberSetting(value: unknown, fallback: number, name: string, minimum: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || Number(result) < minimum || Number(result) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(result);
}

function booleanSetting(value: unknown, fallback: boolean, name: string): boolean {
  const result = value ?? fallback;
  if (typeof result !== "boolean") throw new Error(`${name} must be a boolean`);
  return result;
}

function stringSetting(value: unknown, fallback: string, name: string): string {
  const result = value ?? fallback;
  if (typeof result !== "string" || result.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return result;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[], name: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${name} contains unknown or forbidden fields: ${unknown.join(", ")}`);
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return [...value];
}

const modelToken = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;
const profileToken = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const roles = new Set<ModelRole>(["planner", "executor", "reviewer"]);
const efforts = new Set<ModelReasoningEffort>(["low", "medium", "high", "xhigh"]);
const categories = new Set<TaskCategory>(["advice", "analysis", "code_change", "content_creation", "infrastructure", "external_action", "mixed"]);

function parseCandidates(value: unknown): ModelCandidate[] {
  if (!Array.isArray(value)) throw new Error("modelRouting.candidates must be an array");
  const candidates = value.map((item, index): ModelCandidate => {
    if (!isRecord(item)) throw new Error(`modelRouting.candidates[${index}] must be an object`);
    rejectUnknown(item, ["id", "model", "profile", "reasoningEffort", "roles", "routes", "categories", "tags", "priority", "enabled", "fallbacks"], `modelRouting.candidates[${index}]`);
    const id = stringSetting(item.id, "", `modelRouting.candidates[${index}].id`);
    const model = stringSetting(item.model, "", `modelRouting.candidates[${index}].model`);
    if (!modelToken.test(model)) throw new Error(`modelRouting.candidates[${index}].model contains unsafe characters`);
    const profile = item.profile ?? null;
    if (profile !== null && (typeof profile !== "string" || !profileToken.test(profile))) throw new Error(`modelRouting.candidates[${index}].profile contains unsafe characters`);
    if (!efforts.has(item.reasoningEffort as ModelReasoningEffort)) throw new Error(`modelRouting.candidates[${index}].reasoningEffort is unsupported`);
    const candidateRoles = stringArray(item.roles, `modelRouting.candidates[${index}].roles`);
    if (!candidateRoles.every((role) => roles.has(role as ModelRole)) || candidateRoles.length === 0) throw new Error(`modelRouting.candidates[${index}].roles contains an unsupported role`);
    const routes = stringArray(item.routes, `modelRouting.candidates[${index}].routes`);
    if (!routes.every((route) => route === "codex" || route === "hybrid") || routes.length === 0) throw new Error(`modelRouting.candidates[${index}].routes supports only codex and hybrid`);
    const candidateCategories = stringArray(item.categories ?? [], `modelRouting.candidates[${index}].categories`);
    if (!candidateCategories.every((category) => categories.has(category as TaskCategory))) throw new Error(`modelRouting.candidates[${index}].categories contains an unsupported category`);
    return {
      id,
      model,
      profile: profile as string | null,
      reasoningEffort: item.reasoningEffort as ModelReasoningEffort,
      roles: candidateRoles as ModelRole[],
      routes: routes as Array<"codex" | "hybrid">,
      categories: candidateCategories as TaskCategory[],
      tags: stringArray(item.tags ?? [], `modelRouting.candidates[${index}].tags`),
      priority: numberSetting(item.priority, 0, `modelRouting.candidates[${index}].priority`, -10_000, 10_000),
      enabled: booleanSetting(item.enabled, true, `modelRouting.candidates[${index}].enabled`),
      fallbacks: stringArray(item.fallbacks ?? [], `modelRouting.candidates[${index}].fallbacks`),
    };
  });
  const ids = candidates.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("modelRouting.candidates contains duplicate IDs");
  const idSet = new Set(ids);
  for (const candidate of candidates) {
    for (const fallback of candidate.fallbacks) if (!idSet.has(fallback)) throw new Error(`Candidate '${candidate.id}' has dangling fallback '${fallback}'`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`modelRouting fallback cycle includes '${id}'`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const fallback of byId.get(id)?.fallbacks ?? []) visit(fallback);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return candidates;
}

export async function loadConfig(path?: string): Promise<RelayConfig> {
  if (!path) return structuredClone(defaultConfig);
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("config must be an object");
  rejectUnknown(parsed, ["executor", "relay", "runtime", "security", "modelRouting"], "config");
  const executor = isRecord(parsed.executor) ? parsed.executor : {};
  const codex = isRecord(executor.codexExec) ? executor.codexExec : {};
  const relay = isRecord(parsed.relay) ? parsed.relay : {};
  const runtime = isRecord(parsed.runtime) ? parsed.runtime : {};
  const security = isRecord(parsed.security) ? parsed.security : {};
  const modelRouting = isRecord(parsed.modelRouting) ? parsed.modelRouting : {};
  rejectUnknown(executor, ["mode", "codexExec"], "executor");
  rejectUnknown(codex, ["enabled", "command", "timeoutMs", "probeTimeoutMs", "sandbox", "ephemeral", "ignoreUserConfig", "skipGitRepoCheck", "windowsSandbox", "outputSchemaPath", "maxOutputBytes"], "executor.codexExec");
  rejectUnknown(relay, ["maxIterations"], "relay");
  rejectUnknown(runtime, ["stateDirectory"], "runtime");
  rejectUnknown(security, ["approvedGateIds"], "security");
  rejectUnknown(modelRouting, ["mode", "healthTtlMs", "probeTimeoutMs", "candidates"], "modelRouting");

  const mode = executor.mode ?? defaultConfig.executor.mode;
  if (mode !== "dry-run" && mode !== "mock" && mode !== "codex-exec") {
    throw new Error(`Unsupported executor mode '${String(mode)}'.`);
  }
  const sandbox = codex.sandbox ?? defaultConfig.executor.codexExec.sandbox;
  if (sandbox !== "read-only" && sandbox !== "workspace-write") {
    throw new Error("executor.codexExec.sandbox must be read-only or workspace-write");
  }
  const windowsSandbox = codex.windowsSandbox ?? defaultConfig.executor.codexExec.windowsSandbox;
  if (windowsSandbox !== null && windowsSandbox !== "unelevated" && windowsSandbox !== "elevated") {
    throw new Error("executor.codexExec.windowsSandbox must be unelevated, elevated, or null");
  }
  const approvedGateIds = security.approvedGateIds ?? [];
  if (!Array.isArray(approvedGateIds) || !approvedGateIds.every((value) => typeof value === "string")) {
    throw new Error("security.approvedGateIds must be an array of strings");
  }
  const modelMode = modelRouting.mode ?? defaultConfig.modelRouting.mode;
  if (modelMode !== "inherit" && modelMode !== "explicit") throw new Error("modelRouting.mode must be inherit or explicit");
  const modelCandidates = parseCandidates(modelRouting.candidates ?? []);
  if (modelMode === "explicit" && modelCandidates.length === 0) throw new Error("modelRouting.mode=explicit requires at least one candidate");
  if (modelMode === "inherit" && modelCandidates.length > 0) throw new Error("modelRouting candidates require mode=explicit; inherit never silently selects them");

  return {
    executor: {
      mode,
      codexExec: {
        enabled: booleanSetting(codex.enabled, defaultConfig.executor.codexExec.enabled, "executor.codexExec.enabled"),
        command: stringSetting(codex.command, defaultConfig.executor.codexExec.command, "executor.codexExec.command"),
        timeoutMs: numberSetting(codex.timeoutMs, defaultConfig.executor.codexExec.timeoutMs, "executor.codexExec.timeoutMs", 1_000, 3_600_000),
        probeTimeoutMs: numberSetting(codex.probeTimeoutMs, defaultConfig.executor.codexExec.probeTimeoutMs, "executor.codexExec.probeTimeoutMs", 1_000, 60_000),
        sandbox,
        ephemeral: booleanSetting(codex.ephemeral, defaultConfig.executor.codexExec.ephemeral, "executor.codexExec.ephemeral"),
        ignoreUserConfig: booleanSetting(codex.ignoreUserConfig, defaultConfig.executor.codexExec.ignoreUserConfig, "executor.codexExec.ignoreUserConfig"),
        skipGitRepoCheck: booleanSetting(codex.skipGitRepoCheck, defaultConfig.executor.codexExec.skipGitRepoCheck, "executor.codexExec.skipGitRepoCheck"),
        windowsSandbox,
        outputSchemaPath: stringSetting(codex.outputSchemaPath, defaultConfig.executor.codexExec.outputSchemaPath, "executor.codexExec.outputSchemaPath"),
        maxOutputBytes: numberSetting(codex.maxOutputBytes, defaultConfig.executor.codexExec.maxOutputBytes, "executor.codexExec.maxOutputBytes", 65_536, 64 * 1024 * 1024),
      },
    },
    relay: {
      maxIterations: numberSetting(relay.maxIterations, defaultConfig.relay.maxIterations, "relay.maxIterations", 1, 5),
    },
    runtime: {
      stateDirectory: stringSetting(
        runtime.stateDirectory,
        defaultConfig.runtime.stateDirectory,
        "runtime.stateDirectory",
      ),
    },
    modelRouting: {
      mode: modelMode,
      healthTtlMs: numberSetting(modelRouting.healthTtlMs, defaultConfig.modelRouting.healthTtlMs, "modelRouting.healthTtlMs", 1_000, 7 * 24 * 60 * 60 * 1_000),
      probeTimeoutMs: numberSetting(modelRouting.probeTimeoutMs, defaultConfig.modelRouting.probeTimeoutMs, "modelRouting.probeTimeoutMs", 1_000, 120_000),
      candidates: modelCandidates,
    },
    security: { approvedGateIds: [...approvedGateIds] },
  };
}
