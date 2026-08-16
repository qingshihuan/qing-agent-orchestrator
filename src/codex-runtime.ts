import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

export type CodexInstallKind = "standalone" | "app-colocated" | "not-applicable" | "unknown";

export interface CodexRuntimeProvenance {
  platform: NodeJS.Platform;
  configuredCommand: string;
  resolvedExecutable: string | null;
  version: string | null;
  installKind: CodexInstallKind;
  packageRoot: string | null;
  packageExecutable: string | null;
  resourcesDirectory: string | null;
  sandboxHelperPath: string | null;
  sandboxHelperExists: boolean;
  consistent: boolean;
  reason: string;
}

export interface CodexRuntimeInspectionInput {
  command: string;
  version: string | null;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

export interface CompleteCodexRuntime { command: string; directory: string; environment: NodeJS.ProcessEnv }

interface CodexPackageManifest {
  version: string;
  entrypoint: string;
  resourcesDir: string;
}

const sandboxHelperName = "codex-windows-sandbox-setup.exe";

function isWindowsAppsPath(path: string): boolean {
  return /(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(path);
}

export async function resolveCompleteWindowsRuntime(command: string, environment: NodeJS.ProcessEnv = process.env): Promise<CompleteCodexRuntime> {
  const explicit = isAbsolute(command) || command.includes("/") || command.includes("\\");
  const directories = explicit ? [dirname(resolve(command))] : (environment.PATH ?? "").split(";").map((value) => stripQuotes(value.trim())).filter(Boolean);
  const names = explicit ? [resolve(command)] : (extname(command) ? [command] : [command + ".exe", command]);
  const failures: string[] = [];
  for (const directory of directories) {
    for (const name of names) {
      const candidate = explicit ? name : join(directory, name);
      if (!await isFile(candidate)) continue;
      if (isWindowsAppsPath(candidate)) { failures.push("WindowsApps candidate rejected"); continue; }
      if (!await isFile(join(dirname(candidate), sandboxHelperName))) { failures.push(`missing sandbox helper beside ${candidate}`); continue; }
      const resolvedExecutable = await realpath(candidate).catch(() => resolve(candidate));
      const runtimeDirectory = dirname(resolvedExecutable);
      return { command: resolvedExecutable, directory: runtimeDirectory, environment: { ...environment, PATH: runtimeDirectory + ";" + (environment.PATH ?? "") } };
    }
    if (explicit) break;
  }

  if (!explicit) {
    const defaultRuntimeRoot = environment.LOCALAPPDATA
      ? join(environment.LOCALAPPDATA, "OpenAI", "Codex", "bin")
      : null;
    const completeCandidates: string[] = [];
    if (defaultRuntimeRoot && !isWindowsAppsPath(defaultRuntimeRoot)) {
      try {
        const entries = await readdir(defaultRuntimeRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const runtimeDirectory = join(defaultRuntimeRoot, entry.name);
          const executable = join(runtimeDirectory, "codex.exe");
          if (isWindowsAppsPath(executable)) continue;
          if (await isFile(executable) && await isFile(join(runtimeDirectory, sandboxHelperName))) {
            completeCandidates.push(executable);
          }
        }
      } catch {
        failures.push(`default runtime root unavailable: ${defaultRuntimeRoot}`);
      }
    }
    if (completeCandidates.length === 1 && completeCandidates[0]) {
      const selectedCandidate = completeCandidates[0];
      const resolvedExecutable = await realpath(selectedCandidate).catch(() => resolve(selectedCandidate));
      const runtimeDirectory = dirname(resolvedExecutable);
      return { command: resolvedExecutable, directory: runtimeDirectory, environment: { ...environment, PATH: runtimeDirectory + ";" + (environment.PATH ?? "") } };
    }
    if (completeCandidates.length > 1) {
      throw new Error(`Multiple complete Codex Windows runtimes were found under ${defaultRuntimeRoot}; selection is ambiguous.`);
    }
    if (defaultRuntimeRoot) failures.push(`no complete runtime in direct subdirectories of ${defaultRuntimeRoot}`);
    else failures.push("LOCALAPPDATA is not configured");
  }
  throw new Error(`No complete Codex Windows runtime was found (${failures.join("; ") || "command not found"}).`);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function pathExtensions(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return configured
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function resolveConfiguredExecutable(
  command: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  const directories = isAbsolute(command) || hasPathSeparator
    ? [""]
    : (environment.PATH ?? "")
        .split(platform === "win32" ? ";" : ":")
        .map((value) => stripQuotes(value.trim()))
        .filter(Boolean);
  const extensions = platform === "win32" && extname(command).length === 0
    ? ["", ...pathExtensions(environment)]
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = directory ? join(directory, command + extension) : resolve(command + extension);
      if (!await isFile(candidate)) continue;
      try {
        return await realpath(candidate);
      } catch {
        return resolve(candidate);
      }
    }
  }
  return null;
}

function parseCliVersion(value: string | null): string | null {
  if (!value) return null;
  return value.match(/\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/)?.[0] ?? null;
}

function isPackageManifest(value: unknown): value is CodexPackageManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === "string"
    && typeof record.entrypoint === "string"
    && typeof record.resourcesDir === "string";
}

async function readPackageManifest(packageRoot: string): Promise<CodexPackageManifest | null> {
  try {
    const value = JSON.parse(await readFile(join(packageRoot, "codex-package.json"), "utf8")) as unknown;
    return isPackageManifest(value) ? value : null;
  } catch {
    return null;
  }
}

async function packageFromAncestor(executable: string): Promise<string | null> {
  let cursor = dirname(executable);
  for (let depth = 0; depth < 5; depth += 1) {
    if (await readPackageManifest(cursor)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function defaultCodexHome(environment: NodeJS.ProcessEnv): string {
  if (environment.CODEX_HOME) return resolve(environment.CODEX_HOME);
  if (environment.USERPROFILE) return resolve(environment.USERPROFILE, ".codex");
  return resolve(homedir(), ".codex");
}

async function matchingStandalonePackages(codexHome: string, version: string | null): Promise<string[]> {
  if (!version) return [];
  const releases = join(codexHome, "packages", "standalone", "releases");
  try {
    const entries = await readdir(releases, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageRoot = join(releases, entry.name);
      const manifest = await readPackageManifest(packageRoot);
      if (manifest?.version === version) matches.push(packageRoot);
    }
    return matches.sort();
  } catch {
    return [];
  }
}

async function standaloneProvenance(
  input: CodexRuntimeInspectionInput,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  resolvedExecutable: string,
  packageRoot: string,
): Promise<CodexRuntimeProvenance> {
  const manifest = await readPackageManifest(packageRoot);
  if (!manifest) {
    return unknownProvenance(input, platform, resolvedExecutable, "The selected standalone package manifest is missing or invalid.");
  }
  const packageExecutable = resolve(packageRoot, manifest.entrypoint);
  const resourcesDirectory = resolve(packageRoot, manifest.resourcesDir);
  const sandboxHelperPath = join(resourcesDirectory, sandboxHelperName);
  const [packageExecutableExists, sandboxHelperExists] = await Promise.all([
    isFile(packageExecutable),
    isFile(sandboxHelperPath),
  ]);
  const cliVersion = parseCliVersion(input.version);
  const versionMatches = cliVersion !== null && manifest.version === cliVersion;
  const consistent = packageExecutableExists && sandboxHelperExists && versionMatches;
  const reasons = [
    packageExecutableExists ? null : "package entrypoint is missing",
    sandboxHelperExists ? null : "sandbox helper is missing",
    versionMatches ? null : "CLI and package versions do not match",
  ].filter((value): value is string => value !== null);
  return {
    platform,
    configuredCommand: input.command,
    resolvedExecutable,
    version: input.version,
    installKind: "standalone",
    packageRoot,
    packageExecutable,
    resourcesDirectory,
    sandboxHelperPath,
    sandboxHelperExists,
    consistent,
    reason: consistent
      ? "The selected executable resolves to a complete, version-matched standalone Codex package."
      : `Standalone Codex provenance is inconsistent: ${reasons.join(", ")}.`,
  };
}

function unknownProvenance(
  input: CodexRuntimeInspectionInput,
  platform: NodeJS.Platform,
  resolvedExecutable: string | null,
  reason: string,
): CodexRuntimeProvenance {
  return {
    platform,
    configuredCommand: input.command,
    resolvedExecutable,
    version: input.version,
    installKind: "unknown",
    packageRoot: null,
    packageExecutable: null,
    resourcesDirectory: null,
    sandboxHelperPath: null,
    sandboxHelperExists: false,
    consistent: false,
    reason,
  };
}

export async function inspectCodexRuntimeProvenance(
  input: CodexRuntimeInspectionInput,
): Promise<CodexRuntimeProvenance> {
  const platform = input.platform ?? process.platform;
  const environment = input.environment ?? process.env;
  if (platform !== "win32") {
    return {
      platform,
      configuredCommand: input.command,
      resolvedExecutable: null,
      version: input.version,
      installKind: "not-applicable",
      packageRoot: null,
      packageExecutable: null,
      resourcesDirectory: null,
      sandboxHelperPath: null,
      sandboxHelperExists: false,
      consistent: true,
      reason: "Windows sandbox helper provenance is not applicable on this platform.",
    };
  }

  const resolvedExecutable = await resolveConfiguredExecutable(input.command, platform, environment);
  if (!resolvedExecutable) {
    return unknownProvenance(input, platform, null, "The configured Codex command could not be resolved to an executable file.");
  }

  const colocatedHelper = join(dirname(resolvedExecutable), sandboxHelperName);
  if (await isFile(colocatedHelper)) {
    return {
      platform,
      configuredCommand: input.command,
      resolvedExecutable,
      version: input.version,
      installKind: "app-colocated",
      packageRoot: dirname(resolvedExecutable),
      packageExecutable: resolvedExecutable,
      resourcesDirectory: dirname(resolvedExecutable),
      sandboxHelperPath: colocatedHelper,
      sandboxHelperExists: true,
      consistent: true,
      reason: "The selected Codex executable and Windows sandbox helper are colocated.",
    };
  }

  const ancestorPackage = await packageFromAncestor(resolvedExecutable);
  if (ancestorPackage) {
    return standaloneProvenance(input, platform, environment, resolvedExecutable, ancestorPackage);
  }

  const version = parseCliVersion(input.version);
  const candidates = await matchingStandalonePackages(defaultCodexHome(environment), version);
  if (candidates.length === 1 && candidates[0]) {
    return standaloneProvenance(input, platform, environment, resolvedExecutable, candidates[0]);
  }
  if (candidates.length > 1) {
    return unknownProvenance(input, platform, resolvedExecutable, "Multiple standalone Codex packages match the selected CLI version; provenance is ambiguous.");
  }
  return unknownProvenance(input, platform, resolvedExecutable, "No colocated helper or version-matched standalone Codex package was found.");
}
