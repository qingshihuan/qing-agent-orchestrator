const modes = new Set(["read-only", "workspace-write"]);
function validMode(value) {
    return typeof value === "string" && modes.has(value);
}
function effectiveFromInput(input, requested) {
    if (input.effectiveSandbox !== undefined) {
        return validMode(input.effectiveSandbox) ? { value: input.effectiveSandbox, source: "cli-flag" } : { value: null, source: "unknown" };
    }
    if (!input.ignoreUserConfig && input.configuredSandbox !== undefined) {
        return validMode(input.configuredSandbox) ? { value: input.configuredSandbox, source: "user-config" } : { value: null, source: "unknown" };
    }
    const environment = input.environment ?? {};
    const environmentValue = environment.CODEX_EFFECTIVE_SANDBOX ?? environment.CODEX_SANDBOX;
    if (environmentValue !== undefined) {
        return validMode(environmentValue) ? { value: environmentValue, source: "environment" } : { value: null, source: "unknown" };
    }
    return { value: requested, source: "cli-flag" };
}
export function evaluateSandboxPreflight(input) {
    const requested = input.requestedSandbox ?? "workspace-write";
    const platform = input.platform ?? process.platform;
    const effective = effectiveFromInput(input, requested);
    const userConfigHonored = !input.ignoreUserConfig;
    const warning = input.ignoreUserConfig
        ? "Codex user configuration is explicitly ignored; the effective sandbox comes only from the reviewed CLI request."
        : null;
    const windowsSandbox = input.windowsSandbox ?? null;
    const runtimeProvenance = input.runtimeProvenance ?? null;
    if (!validMode(requested)) {
        return {
            ok: false,
            requestedSandbox: requested,
            effectiveSandbox: effective.value,
            source: "unknown",
            userConfigHonored,
            requiresHumanReview: true,
            reason: "Requested Codex sandbox is invalid.",
            warning,
            windowsSandbox,
            runtimeProvenance,
        };
    }
    if (effective.value === null) {
        return {
            ok: false,
            requestedSandbox: requested,
            effectiveSandbox: null,
            source: effective.source,
            userConfigHonored,
            requiresHumanReview: true,
            reason: "The effective Codex sandbox could not be determined from the reviewed CLI, user configuration, or environment.",
            warning,
            windowsSandbox,
            runtimeProvenance,
        };
    }
    if (effective.value !== requested) {
        return {
            ok: false,
            requestedSandbox: requested,
            effectiveSandbox: effective.value,
            source: effective.source,
            userConfigHonored,
            requiresHumanReview: false,
            reason: "Requested sandbox " + requested + " does not match effective sandbox " + effective.value + ".",
            warning,
            windowsSandbox,
            runtimeProvenance,
        };
    }
    if (platform === "win32" && requested === "workspace-write" && !runtimeProvenance?.consistent) {
        return {
            ok: false,
            requestedSandbox: requested,
            effectiveSandbox: effective.value,
            source: effective.source,
            userConfigHonored,
            requiresHumanReview: true,
            reason: "Windows workspace-write runtime provenance failed: "
                + (runtimeProvenance?.reason ?? "no runtime provenance evidence was recorded"),
            warning,
            windowsSandbox,
            runtimeProvenance,
        };
    }
    const windowsNote = platform === "win32" && !input.ignoreUserConfig
        ? "Windows user Codex configuration remains enabled for this invocation."
        : null;
    return {
        ok: true,
        requestedSandbox: requested,
        effectiveSandbox: effective.value,
        source: effective.source,
        userConfigHonored,
        requiresHumanReview: false,
        reason: "Requested and effective Codex sandboxes match.",
        warning: platform === "win32" && requested === "read-only" && !runtimeProvenance?.consistent
            ? "Read-only diagnostic allowed without a verified workspace-write helper; no mutating operation may be performed."
            : windowsNote ?? warning,
        windowsSandbox,
        runtimeProvenance,
    };
}
export function resolveEffectiveSandbox(input) {
    return evaluateSandboxPreflight(input);
}
export const preflightSandbox = evaluateSandboxPreflight;
