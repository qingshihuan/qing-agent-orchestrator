import type { CodexRuntimeProvenance } from "./codex-runtime.js";
import type { SandboxMode, WindowsSandboxMode } from "./types.js";

export interface SandboxPreflightInput {
  requestedSandbox?: SandboxMode;
  effectiveSandbox?: SandboxMode | null;
  configuredSandbox?: SandboxMode | null;
  ignoreUserConfig: boolean;
  platform?: NodeJS.Platform;
  environment?: Record<string, string | undefined>;
  runtimeProvenance?: CodexRuntimeProvenance | null;
  windowsSandbox?: WindowsSandboxMode | null;
}

export interface SandboxPreflightResult {
  ok: boolean;
  requestedSandbox: SandboxMode;
  effectiveSandbox: SandboxMode | null;
  source: "cli-flag" | "user-config" | "environment" | "unknown";
  userConfigHonored: boolean;
  requiresHumanReview: boolean;
  reason: string;
  warning: string | null;
  windowsSandbox: WindowsSandboxMode | null;
  runtimeProvenance: CodexRuntimeProvenance | null;
}

const modes = new Set<SandboxMode>(["read-only", "workspace-write"]);

function validMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && modes.has(value as SandboxMode);
}

function effectiveFromInput(input: SandboxPreflightInput, requested: SandboxMode): {
  value: SandboxMode | null;
  source: SandboxPreflightResult["source"];
} {
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

export function evaluateSandboxPreflight(input: SandboxPreflightInput): SandboxPreflightResult {
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

export function resolveEffectiveSandbox(input: SandboxPreflightInput): SandboxPreflightResult {
  return evaluateSandboxPreflight(input);
}

export const preflightSandbox = evaluateSandboxPreflight;
