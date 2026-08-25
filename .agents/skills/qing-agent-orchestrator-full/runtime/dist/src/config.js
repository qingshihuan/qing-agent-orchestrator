import { readFile } from "node:fs/promises";
import { defaultOrchestrationConfig } from "./orchestration-policy.js";
import { validateModelCapability } from "./model-router.js";
export const defaultConfig = {
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
    orchestration: defaultOrchestrationConfig,
    modelRouting: { mode: "inherit", healthTtlMs: 3_600_000, probeTimeoutMs: 30_000, candidates: [] },
    security: { approvedGateIds: [] },
};
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberSetting(value, fallback, name, minimum, maximum) {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || Number(result) < minimum || Number(result) > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
    return Number(result);
}
function booleanSetting(value, fallback, name) {
    const result = value ?? fallback;
    if (typeof result !== "boolean")
        throw new Error(`${name} must be a boolean`);
    return result;
}
function stringSetting(value, fallback, name) {
    const result = value ?? fallback;
    if (typeof result !== "string" || result.trim().length === 0)
        throw new Error(`${name} must be a non-empty string`);
    return result;
}
function rejectUnknown(value, allowed, name) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0)
        throw new Error(`${name} contains unknown or forbidden fields: ${unknown.join(", ")}`);
}
function stringArray(value, name) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
        throw new Error(`${name} must be an array of non-empty strings`);
    }
    return [...value];
}
const modelToken = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;
const profileToken = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const roles = new Set(["planner", "executor", "reviewer"]);
const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const backends = new Set(["desktop-child", "codex-cli"]);
const availabilities = new Set(["host-advertised", "entitlement-dependent"]);
const complexityBands = new Set(["trivial", "normal", "complex", "high-risk"]);
const categories = new Set(["advice", "analysis", "code_change", "content_creation", "infrastructure", "external_action", "mixed"]);
function parseCandidates(value) {
    if (!Array.isArray(value))
        throw new Error("modelRouting.candidates must be an array");
    const candidates = value.map((item, index) => {
        if (!isRecord(item))
            throw new Error(`modelRouting.candidates[${index}] must be an object`);
        rejectUnknown(item, ["id", "backend", "model", "profile", "reasoningEffort", "availability", "roles", "routes", "categories", "complexityBands", "tags", "priority", "enabled", "fallbacks"], `modelRouting.candidates[${index}]`);
        const id = stringSetting(item.id, "", `modelRouting.candidates[${index}].id`);
        if (!backends.has(item.backend))
            throw new Error(`modelRouting.candidates[${index}].backend is unsupported`);
        const model = stringSetting(item.model, "", `modelRouting.candidates[${index}].model`);
        if (!modelToken.test(model))
            throw new Error(`modelRouting.candidates[${index}].model contains unsafe characters`);
        const profile = item.profile ?? null;
        if (profile !== null && (typeof profile !== "string" || !profileToken.test(profile)))
            throw new Error(`modelRouting.candidates[${index}].profile contains unsafe characters`);
        if (!efforts.has(item.reasoningEffort))
            throw new Error(`modelRouting.candidates[${index}].reasoningEffort is unsupported`);
        if (!availabilities.has(item.availability))
            throw new Error(`modelRouting.candidates[${index}].availability is unsupported`);
        const candidateRoles = stringArray(item.roles, `modelRouting.candidates[${index}].roles`);
        if (!candidateRoles.every((role) => roles.has(role)) || candidateRoles.length === 0)
            throw new Error(`modelRouting.candidates[${index}].roles contains an unsupported role`);
        const routes = stringArray(item.routes, `modelRouting.candidates[${index}].routes`);
        if (!routes.every((route) => route === "codex" || route === "hybrid") || routes.length === 0)
            throw new Error(`modelRouting.candidates[${index}].routes supports only codex and hybrid`);
        const candidateCategories = stringArray(item.categories ?? [], `modelRouting.candidates[${index}].categories`);
        if (!candidateCategories.every((category) => categories.has(category)))
            throw new Error(`modelRouting.candidates[${index}].categories contains an unsupported category`);
        const candidateComplexityBands = stringArray(item.complexityBands, `modelRouting.candidates[${index}].complexityBands`);
        if (!candidateComplexityBands.every((band) => complexityBands.has(band)) || candidateComplexityBands.length === 0)
            throw new Error(`modelRouting.candidates[${index}].complexityBands contains an unsupported band`);
        const candidate = {
            id,
            backend: item.backend,
            model,
            profile: profile,
            reasoningEffort: item.reasoningEffort,
            availability: item.availability,
            roles: candidateRoles,
            routes: routes,
            categories: candidateCategories,
            complexityBands: candidateComplexityBands,
            tags: stringArray(item.tags ?? [], `modelRouting.candidates[${index}].tags`),
            priority: numberSetting(item.priority, 0, `modelRouting.candidates[${index}].priority`, -10_000, 10_000),
            enabled: booleanSetting(item.enabled, true, `modelRouting.candidates[${index}].enabled`),
            fallbacks: stringArray(item.fallbacks ?? [], `modelRouting.candidates[${index}].fallbacks`),
        };
        const capabilityError = validateModelCapability(candidate);
        if (capabilityError)
            throw new Error(`modelRouting.candidates[${index}] capability mismatch: ${capabilityError}`);
        return candidate;
    });
    const ids = candidates.map(({ id }) => id);
    if (new Set(ids).size !== ids.length)
        throw new Error("modelRouting.candidates contains duplicate IDs");
    const idSet = new Set(ids);
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    for (const candidate of candidates) {
        for (const fallback of candidate.fallbacks) {
            if (!idSet.has(fallback))
                throw new Error(`Candidate '${candidate.id}' has dangling fallback '${fallback}'`);
            if (byId.get(fallback)?.backend !== candidate.backend)
                throw new Error(`Candidate '${candidate.id}' fallback '${fallback}' crosses model backends`);
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visiting.has(id))
            throw new Error(`modelRouting fallback cycle includes '${id}'`);
        if (visited.has(id))
            return;
        visiting.add(id);
        for (const fallback of byId.get(id)?.fallbacks ?? [])
            visit(fallback);
        visiting.delete(id);
        visited.add(id);
    };
    for (const id of ids)
        visit(id);
    return candidates;
}
export async function loadConfig(path) {
    if (!path)
        return structuredClone(defaultConfig);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed))
        throw new Error("config must be an object");
    rejectUnknown(parsed, ["executor", "relay", "runtime", "security", "orchestration", "modelRouting"], "config");
    const executor = isRecord(parsed.executor) ? parsed.executor : {};
    const codex = isRecord(executor.codexExec) ? executor.codexExec : {};
    const relay = isRecord(parsed.relay) ? parsed.relay : {};
    const runtime = isRecord(parsed.runtime) ? parsed.runtime : {};
    const security = isRecord(parsed.security) ? parsed.security : {};
    const orchestration = isRecord(parsed.orchestration) ? parsed.orchestration : {};
    const modelRouting = isRecord(parsed.modelRouting) ? parsed.modelRouting : {};
    rejectUnknown(executor, ["mode", "codexExec"], "executor");
    rejectUnknown(codex, ["enabled", "command", "timeoutMs", "probeTimeoutMs", "sandbox", "ephemeral", "ignoreUserConfig", "skipGitRepoCheck", "windowsSandbox", "outputSchemaPath", "maxOutputBytes"], "executor.codexExec");
    rejectUnknown(relay, ["maxIterations"], "relay");
    rejectUnknown(runtime, ["stateDirectory"], "runtime");
    rejectUnknown(security, ["approvedGateIds"], "security");
    rejectUnknown(orchestration, ["mode", "liteMaxChildren", "fullMaxChildren", "liteMaxRevisions", "fullMaxRevisions", "reviewerMode"], "orchestration");
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
    if (modelMode !== "inherit" && modelMode !== "explicit")
        throw new Error("modelRouting.mode must be inherit or explicit");
    const modelCandidates = parseCandidates(modelRouting.candidates ?? []);
    if (modelMode === "explicit" && modelCandidates.length === 0)
        throw new Error("modelRouting.mode=explicit requires at least one candidate");
    if (modelMode === "inherit" && modelCandidates.length > 0)
        throw new Error("modelRouting candidates require mode=explicit; inherit never silently selects them");
    const orchestrationMode = orchestration.mode ?? defaultConfig.orchestration.mode;
    if (orchestrationMode !== "adaptive" && orchestrationMode !== "full")
        throw new Error("orchestration.mode must be adaptive or full");
    const reviewerMode = orchestration.reviewerMode ?? defaultConfig.orchestration.reviewerMode;
    if (reviewerMode !== "risk-based")
        throw new Error("orchestration.reviewerMode must be risk-based");
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
            stateDirectory: stringSetting(runtime.stateDirectory, defaultConfig.runtime.stateDirectory, "runtime.stateDirectory"),
        },
        orchestration: {
            mode: orchestrationMode,
            liteMaxChildren: numberSetting(orchestration.liteMaxChildren, defaultConfig.orchestration.liteMaxChildren, "orchestration.liteMaxChildren", 1, 1),
            fullMaxChildren: numberSetting(orchestration.fullMaxChildren, defaultConfig.orchestration.fullMaxChildren, "orchestration.fullMaxChildren", 1, 8),
            liteMaxRevisions: numberSetting(orchestration.liteMaxRevisions, defaultConfig.orchestration.liteMaxRevisions, "orchestration.liteMaxRevisions", 1, 1),
            fullMaxRevisions: numberSetting(orchestration.fullMaxRevisions, defaultConfig.orchestration.fullMaxRevisions, "orchestration.fullMaxRevisions", 1, 5),
            reviewerMode: reviewerMode,
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
