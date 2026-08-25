import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeProcessRunner, type ProcessRequest, type ProcessRunner } from "./process-runner.js";
import { redactSensitiveText } from "./executors/codex-exec-executor.js";
import { classifyTask } from "./classifier.js";
import type { Handoff, WindowsSandboxMode } from "./types.js";
import { validateHandoff } from "./validation.js";
import { resolveSafeWorkspace } from "./workspace.js";
import { modelSelectionArgs } from "./model-health.js";
import type { ModelSelection } from "./types.js";

export interface CodexPlannerOptions {
  command: string;
  runtimeRoot: string;
  timeoutMs: number;
  probeTimeoutMs: number;
  ephemeral: boolean;
  ignoreUserConfig: boolean;
  skipGitRepoCheck: boolean;
  windowsSandbox: WindowsSandboxMode | null;
  platform?: NodeJS.Platform;
  handoffSchemaPath: string;
  maxOutputBytes: number;
  modelSelection?: ModelSelection;
}

export interface PlannedHandoff {
  handoff: Handoff;
  workspace: string;
}

function newHandoffId(): string {
  return `qing-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function protocolError(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "codex exec returned no JSONL events";
  for (const [index, line] of lines.entries()) {
    try {
      const event = JSON.parse(line) as { type?: unknown };
      if (typeof event.type !== "string") return `JSONL event ${index + 1} has no string type`;
    } catch {
      return `stdout line ${index + 1} is not valid JSONL`;
    }
  }
  return null;
}

function plannerPrompt(task: string, workspace: string): string {
  return [
    "You are the Planner in the Qing Agent Orchestrator workflow.",
    "Inspect the workspace read-only and convert the user's natural-language goal into one complete Handoff.",
    "Return JSON matching the Handoff schema. Do not execute, edit, install, delete, deploy, push, or send anything.",
    "Declare every operation the future Executor may need. Use paths relative to the workspace in allowedPaths, requestedOperations targets, and deliverables.",
    "Use allowedPaths=['**/*'] only when the task genuinely needs project-wide access. Never use parent traversal or a filesystem root.",
    "Acceptance criteria must be objectively verifiable and each must declare verificationOwner as executor, relay, or hybrid.",
    "For executor owner set relayVerification to null. Relay/hybrid owners must provide relayVerification using only event-count or event-payload over process.started, process.exited, process.heartbeat, or sandbox.preflight.",
    "Do not express shell commands, paths, URLs, run IDs, external JSON, secrets, or arbitrary payload fields in relayVerification. Use relay only for Relay-observable facts; hybrid requires both sources.",
    "Put concrete commands in testPlan only when appropriate.",
    "Set maxIterations between 1 and 3 unless the task clearly needs more. Do not claim that work has already been completed.",
    `The exact workspace root is: ${workspace}`,
    `User goal: ${task}`,
  ].join("\n");
}

function boundedPlannerFailure(stdout: string, stderr: string): string {
  const section = (label: string, value: string): string => {
    const redacted = redactSensitiveText(value).trim();
    return redacted ? `${label}: ${redacted.slice(-1_350)}` : "";
  };
  return [section("stderr", stderr), section("stdout JSONL", stdout)].filter(Boolean).join("\n");
}

function normalizePlannerOutput(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object") return;
  const criteria = (parsed as { acceptanceCriteria?: unknown }).acceptanceCriteria;
  if (!Array.isArray(criteria)) return;
  for (const criterion of criteria) {
    if (!criterion || typeof criterion !== "object") continue;
    const candidate = criterion as Record<string, unknown>;
    if (candidate.verificationOwner === "executor" && candidate.relayVerification === null) {
      delete candidate.relayVerification;
      continue;
    }
    const relayVerification = candidate.relayVerification;
    if (
      relayVerification &&
      typeof relayVerification === "object" &&
      (relayVerification as Record<string, unknown>).kind === "event-count" &&
      (relayVerification as Record<string, unknown>).field === null
    ) {
      delete (relayVerification as Record<string, unknown>).field;
    }
  }
}

export class CodexHandoffPlanner {
  constructor(
    private readonly options: CodexPlannerOptions,
    private readonly runner: ProcessRunner = new NodeProcessRunner(),
  ) {}

  private probeRequest(args: string[]): ProcessRequest {
    return {
      command: this.options.command,
      args,
      cwd: this.options.runtimeRoot,
      stdin: "",
      timeoutMs: this.options.probeTimeoutMs,
      maxOutputBytes: Math.min(this.options.maxOutputBytes, 64 * 1024),
    };
  }

  async plan(task: string, requestedWorkspace: string): Promise<PlannedHandoff> {
    if (!task.trim()) throw new Error("Task text must not be empty.");
    const workspace = await resolveSafeWorkspace(this.options.runtimeRoot, requestedWorkspace);
    const schemaPath = await resolveSafeSchema(this.options.runtimeRoot, this.options.handoffSchemaPath);

    const version = await this.runner.run(this.probeRequest(["--version"]));
    if (version.exitCode !== 0 || version.spawnError || version.timedOut) {
      throw new Error("Codex CLI is unavailable; Handoff planning was not submitted.");
    }
    const login = await this.runner.run(this.probeRequest(["login", "status"]));
    if (login.exitCode !== 0 || login.spawnError || login.timedOut) {
      throw new Error("Codex CLI is not authenticated; Handoff planning was not submitted.");
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "qing-planner-"));
    const outputPath = join(temporaryDirectory, "handoff.json");
    const args = [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    ];
    if (this.options.modelSelection) args.push(...modelSelectionArgs(this.options.modelSelection));
    if (this.options.ephemeral) args.push("--ephemeral");
    if (this.options.ignoreUserConfig) args.push("--ignore-user-config");
    if (this.options.skipGitRepoCheck) args.push("--skip-git-repo-check");
    if ((this.options.platform ?? process.platform) === "win32" && this.options.windowsSandbox) {
      args.push("-c", `windows.sandbox=${this.options.windowsSandbox}`);
    }
    args.push("-");

    try {
      const result = await this.runner.run({
        command: this.options.command,
        args,
        cwd: workspace,
        stdin: plannerPrompt(task.trim(), workspace),
        timeoutMs: this.options.timeoutMs,
        maxOutputBytes: this.options.maxOutputBytes,
      });
      if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded) {
        const diagnostic = boundedPlannerFailure(result.stdout, result.stderr);
        const spawnDetail = redactSensitiveText(result.spawnError ?? "").trim().slice(-160);
        const detail = [spawnDetail, diagnostic].filter(Boolean).join("\n");
        throw new Error(`Codex Planner failed before producing a valid Handoff.${detail ? ` ${detail}` : ""}`);
      }
      const jsonlError = protocolError(result.stdout);
      if (jsonlError) throw new Error(`Codex Planner protocol error: ${jsonlError}`);

      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      normalizePlannerOutput(parsed);
      const validation = validateHandoff(parsed);
      if (!validation.ok || !validation.value) {
        throw new Error(`Codex Planner returned an invalid Handoff: ${validation.errors.join("; ")}`);
      }

      const handoff: Handoff = {
        ...validation.value,
        id: newHandoffId(),
        workspace: { ...validation.value.workspace, root: workspace },
        metadata: {
          ...validation.value.metadata,
          createdAt: new Date().toISOString(),
          source: "qing-natural-language-planner",
        },
      };
      const normalized = validateHandoff(handoff);
      if (!normalized.ok || !normalized.value) {
        throw new Error(`Normalized Handoff is invalid: ${normalized.errors.join("; ")}`);
      }
      return { handoff: normalized.value, workspace };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export async function planLocally(
  task: string,
  requestedWorkspace: string,
  runtimeRoot: string,
): Promise<PlannedHandoff> {
  if (!task.trim()) throw new Error("Task text must not be empty.");
  const workspace = await resolveSafeWorkspace(runtimeRoot, requestedWorkspace);
  const classification = classifyTask(task);
  if (["infrastructure", "external_action", "mixed"].includes(classification.category)) {
    throw new Error(
      `The conservative local Planner refuses '${classification.category}' tasks. Use the connected Planner or clarify and split the task.`,
    );
  }

  const changesFiles = classification.category === "code_change" || classification.category === "content_creation";
  const requestedOperations: Handoff["requestedOperations"] = [
    { type: "read", target: "**/*", reason: "Inspect the target project before acting.", risk: "low" },
  ];
  if (changesFiles) {
    requestedOperations.push({
      type: "write",
      target: "**/*",
      reason: "Create or update only files required by the declared objective.",
      risk: "medium",
    });
  }
  if (classification.category === "code_change") {
    requestedOperations.push({
      type: "execute_tests",
      target: "project-local test and build commands",
      reason: "Verify the declared implementation.",
      risk: "low",
    });
  }

  const acceptanceCriteria: Handoff["acceptanceCriteria"] = [
    {
      id: "ac-1",
      description: `The result satisfies this declared objective: ${task.trim()}`,
      verification: changesFiles
        ? "Review the changed artifacts against the exact objective and constraints."
        : "Review the response against project evidence and the exact objective.",
      verificationOwner: "executor",
    },
  ];
  if (classification.category === "code_change") {
    acceptanceCriteria.push({
      id: "ac-2",
      description: "Relevant project-local tests and checks pass.",
      verification: "Run the test and build commands discovered in the target project and report concrete results.",
      verificationOwner: "executor",
    });
  }

  const handoff: Handoff = {
    version: "1.0",
    id: newHandoffId(),
    title: task.trim().replace(/\s+/g, " ").slice(0, 80),
    objective: task.trim(),
    category: classification.category,
    workspace: { root: workspace, allowedPaths: ["**/*"] },
    inputs: [{ name: "user-goal", type: "text", value: task.trim(), required: true }],
    constraints: [
      "Preserve unrelated files and existing user changes.",
      "Do not delete, push, deploy, use secrets, access external services, or expand scope without a new gate.",
      "This Handoff was produced by the conservative local fallback and requires careful human review.",
    ],
    acceptanceCriteria,
    requestedOperations,
    deliverables: [],
    testPlan: classification.category === "code_change" ? ["Discover and run the project's relevant local test/build commands."] : [],
    maxIterations: 2,
    metadata: { createdAt: new Date().toISOString(), source: "qing-local-fallback-planner" },
  };
  const validation = validateHandoff(handoff);
  if (!validation.ok || !validation.value) {
    throw new Error(`Local Planner produced an invalid Handoff: ${validation.errors.join("; ")}`);
  }
  return { handoff: validation.value, workspace };
}

async function resolveSafeSchema(runtimeRoot: string, requestedPath: string): Promise<string> {
  const candidate = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(runtimeRoot, requestedPath);
  const [runtime, schema] = await Promise.all([realpath(resolve(runtimeRoot)), realpath(candidate)]);
  const relation = relative(runtime, schema);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("Handoff schema must be inside the Relay runtime.");
  return schema;
}

export async function saveHandoff(
  handoff: Handoff,
  runtimeRoot: string,
  stateDirectory: string,
  requestedOutput?: string,
): Promise<string> {
  const outputPath = requestedOutput
    ? resolve(requestedOutput)
    : join(isAbsolute(stateDirectory) ? stateDirectory : resolve(runtimeRoot, stateDirectory), `${handoff.id}.json`);
  const directory = requestedOutput
    ? dirname(outputPath)
    : isAbsolute(stateDirectory)
      ? stateDirectory
      : resolve(runtimeRoot, stateDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(handoff, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}
