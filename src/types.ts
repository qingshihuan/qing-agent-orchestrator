export type TaskCategory =
  | "advice"
  | "analysis"
  | "code_change"
  | "content_creation"
  | "infrastructure"
  | "external_action"
  | "mixed";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SandboxMode = "read-only" | "workspace-write";
export type WindowsSandboxMode = "unelevated" | "elevated";
export type TaskRoute = "chat" | "codex" | "hybrid";
export type OrchestratorEdition = "standard" | "full";
export type DelegationTarget = "outer-session" | "internal-child" | "visible-task";
export type ExecutionMode =
  | "desktop-native"
  | "cli-recommended"
  | "cli-setup-required"
  | "cli-awaiting-handoff-approval"
  | "desktop-fallback";
export type CliReasonCode =
  | "explicit-cli-request"
  | "script-or-ci"
  | "scheduled-batch-unattended"
  | "app-close-persistence"
  | "machine-readable-control-plane"
  | "cli-only-model-or-environment"
  | "process-isolation-or-queue";
export type CliDependencyStatus = "not-checked" | "missing" | "authentication-required" | "ready";
export type CliRecommendationResponse = "pending" | "accepted" | "declined";

export interface CliRecommendation {
  message: "建议切换 CLI 模式";
  benefit: string;
  reasonCodes: CliReasonCode[];
  requiresUserChoice: true;
  response: CliRecommendationResponse;
  dependencyStatus: CliDependencyStatus;
  installGuide: "https://learn.chatgpt.com/docs/codex/cli";
}

export interface ExecutionModeDecision {
  edition: OrchestratorEdition;
  mode: ExecutionMode;
  delegationTarget: DelegationTarget;
  returnsToParent: boolean;
  currentParentModelUnchanged: true;
  modelSelectionScope: "delegated-task";
  reasonCodes: CliReasonCode[];
  recommendation: CliRecommendation | null;
  suppressCliPromptForTask: boolean;
  limitations: string[];
}
export type ModelRole = "planner" | "executor" | "reviewer";
export type ModelBackend = "desktop-child" | "codex-cli";
export type ModelReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ModelAvailability = "host-advertised" | "entitlement-dependent";
export type ComplexityBand = "trivial" | "normal" | "complex" | "high-risk";
export type ModelHealthState = "healthy" | "unhealthy" | "unverified" | "expired";

export interface ModelCandidate {
  id: string;
  backend: ModelBackend;
  model: string;
  profile: string | null;
  reasoningEffort: ModelReasoningEffort;
  availability: ModelAvailability;
  roles: ModelRole[];
  routes: Array<Exclude<TaskRoute, "chat">>;
  categories: TaskCategory[];
  complexityBands: ComplexityBand[];
  tags: string[];
  priority: number;
  enabled: boolean;
  fallbacks: string[];
}

export interface ModelRoutingConfig {
  mode: "inherit" | "explicit";
  healthTtlMs: number;
  probeTimeoutMs: number;
  candidates: ModelCandidate[];
}

export interface ModelSelection {
  candidateId: string;
  backend: ModelBackend;
  model: string;
  profile: string | null;
  reasoningEffort: ModelReasoningEffort;
  availability: ModelAvailability;
  role: ModelRole;
  complexityBand: ComplexityBand;
  reason: string;
  cacheState: "fresh" | "cached";
  fallbackFrom: string | null;
}

export interface TaskComplexityAnalysis {
  score: number;
  band: ComplexityBand;
  category: TaskCategory;
  role: ModelRole;
  risk: RiskLevel;
  scope: "single" | "multi-step" | "cross-system";
  signals: string[];
  reasons: string[];
}

export type ProcessState =
  | "not-started"
  | "running"
  | "exited"
  | "cancelled"
  | "timed-out"
  | "failed"
  | "unknown";

export type RunPhase =
  | "created"
  | "preflight"
  | "auditing"
  | "executing"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type RunStatus =
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "max-iterations"
  | "human-review";

export type OperationType =
  | "read"
  | "write"
  | "delete"
  | "execute_tests"
  | "install_dependency"
  | "network_access"
  | "use_secret"
  | "external_message"
  | "git_commit"
  | "git_push"
  | "production_deploy"
  | "database_migration";

export interface OperationRequest {
  type: OperationType;
  target: string;
  reason: string;
  risk: RiskLevel;
}

interface AcceptanceCriterionBase {
  id: string;
  description: string;
  verification: string;
}

export type AcceptanceCriterion = AcceptanceCriterionBase & (
  | { verificationOwner: "executor"; relayVerification?: never }
  | { verificationOwner: "relay" | "hybrid"; relayVerification: RelayVerification }
);

export interface Handoff {
  version: "1.0";
  id: string;
  title: string;
  objective: string;
  category: TaskCategory;
  workspace: {
    root: string;
    allowedPaths: string[];
  };
  inputs: Array<{
    name: string;
    type: "file" | "text" | "url" | "image";
    value: string;
    required?: boolean;
  }>;
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  requestedOperations: OperationRequest[];
  deliverables: Array<{
    path: string;
    description: string;
  }>;
  testPlan: string[];
  maxIterations: number;
  metadata?: {
    createdAt?: string;
    source?: string;
  };
}

export type RelayEventType =
  | "process.started"
  | "process.exited"
  | "process.heartbeat"
  | "sandbox.preflight";

export type RelayCountOperator = "eq" | "gte" | "lte";
export type RelayPayloadOperator = "eq" | "ne" | "gte" | "lte";

export interface RelayEventCountVerification {
  kind: "event-count";
  eventType: RelayEventType;
  operator: RelayCountOperator;
  expected: number;
}

interface RelayPayloadVerificationBase {
  kind: "event-payload";
  operator: RelayPayloadOperator;
}

export type RelayEventPayloadVerification = RelayPayloadVerificationBase & (
  | { eventType: "process.started"; field: "pid"; expected: number }
  | { eventType: "process.exited"; field: "exitCode"; expected: number | null }
  | { eventType: "process.exited"; field: "state"; expected: string }
  | { eventType: "process.heartbeat"; field: "iteration" | "pid" | "elapsedMs"; expected: number }
  | { eventType: "sandbox.preflight"; field: "ok" | "requiresHumanReview"; expected: boolean }
  | { eventType: "sandbox.preflight"; field: "effectiveSandbox"; expected: string }
);

export type RelayVerification = RelayEventCountVerification | RelayEventPayloadVerification;

export type CriterionStatus = "pass" | "fail" | "not_verified";
export type TestStatus = "passed" | "failed" | "not_run";

export interface CriterionEvidence {
  id: string;
  status: CriterionStatus;
  evidence: string;
}

export interface TestEvidence {
  command: string;
  status: TestStatus;
  evidence: string;
}

export interface ExecutionResult {
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  artifacts: Array<{ path: string; description: string }>;
  criteriaEvidence: CriterionEvidence[];
  tests: TestEvidence[];
  proposedOperations: OperationRequest[];
  simulated: boolean;
}

export interface ProcessMetadata {
  state: ProcessState;
  pid: number | null;
  command: string | null;
  args: string[];
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  cancelled: boolean;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

export interface RunEvent {
  sequence: number;
  timestamp: string;
  type: string;
  phase: RunPhase;
  iteration: number;
  message: string;
  payload?: Record<string, unknown>;
}

export interface RunArtifactPaths {
  handoff: string;
  events: string;
  process: string;
  executorResult: string;
  review: string;
  finalSummary: string;
  gitBefore: string;
  gitAfter: string;
  gitAudit: string;
  sandboxPreflight: string;
  criterionEvidence: string;
  testEvidence: string;
}

export interface RunRecord {
  version: "1.0";
  runId: string;
  handoffId: string;
  phase: RunPhase;
  status: RunStatus;
  iteration: number;
  processState: ProcessState;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  artifactDirectory: string;
  artifacts: RunArtifactPaths;
  lastEvent: RunEvent | null;
}

export interface FinalRunSummary {
  version: "1.0";
  runId: string;
  handoffId: string;
  status: RunStatus;
  phase: RunPhase;
  summary: string;
  startedAt: string;
  completedAt: string;
  iteration: number;
  processState: ProcessState;
  artifacts: RunArtifactPaths;
}

export interface AcceptanceEvidenceSetup {
  id: string;
  action: "seed" | "reset" | "authenticate" | "fixture" | "navigate";
  target: string;
  value?: string;
}

export interface AcceptanceEvidenceAction {
  id: string;
  action: "navigate" | "click" | "type" | "select" | "wait" | "submit";
  target: string;
  value?: string;
}

export interface AcceptanceEvidenceAssertion {
  id: string;
  description: string;
  target: string;
  expected: string;
}

export interface AcceptanceEvidenceObservation {
  assertionId: string;
  observed: string;
  passed: boolean;
  evidence: string;
}

export interface AcceptanceEvidence {
  version: "1.0";
  id: string;
  title: string;
  seededSetup: AcceptanceEvidenceSetup[];
  actions: AcceptanceEvidenceAction[];
  assertions: AcceptanceEvidenceAssertion[];
  observedEvidence: AcceptanceEvidenceObservation[];
  result: "passed" | "failed";
}

export interface RelayCriterionEvidence {
  version: "1.0";
  evidenceId: string;
  source: "relay";
  runId: string;
  handoffId: string;
  criterionId: string;
  iteration: number;
  result: "pass" | "fail";
  evidence: string;
  recordedAt: string;
}

export interface TrustedCommandEvidence {
  version: "1.0";
  source: "relay";
  runId: string;
  handoffId: string;
  iteration: number;
  command: string;
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  spawnError: string | null;
  stdout: string;
  stderr: string;
  recordedAt: string;
}

export interface CriterionAudit {
  id: string;
  verificationOwner: "executor" | "relay" | "hybrid";
  status: CriterionStatus;
  executorEvidence: CriterionEvidence | null;
  relayEvidenceIds: string[];
  evidence: string;
}

export interface Review {
  version: "1.0";
  handoffId: string;
  iteration: number;
  verdict: "PASS" | "REVISE" | "HUMAN_REVIEW";
  summary: string;
  criteria: CriterionEvidence[];
  criterionAudit: CriterionAudit[];
  findings: Array<{
    severity: "blocker" | "major" | "minor" | "info";
    message: string;
    path?: string;
    remediation?: string;
  }>;
  tests: TestEvidence[];
  revisionInstructions: string[];
}

export interface RelayConfig {
  executor: {
    mode: "dry-run" | "mock" | "codex-exec";
    codexExec: {
      enabled: boolean;
      command: string;
      timeoutMs: number;
      probeTimeoutMs: number;
      sandbox: SandboxMode;
      ephemeral: boolean;
      ignoreUserConfig: boolean;
      skipGitRepoCheck: boolean;
      windowsSandbox: WindowsSandboxMode | null;
      outputSchemaPath: string;
      maxOutputBytes: number;
    };
  };
  relay: { maxIterations: number };
  runtime: {
    stateDirectory: string;
  };
  modelRouting: ModelRoutingConfig;
  security: { approvedGateIds: string[] };
}
