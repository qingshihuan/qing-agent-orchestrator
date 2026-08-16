import type { ExecutionResult, Handoff } from "../types.js";
import type { ExecutionContext, Executor } from "./executor.js";

export class DryRunExecutor implements Executor {
  readonly name = "dry-run";

  async execute(handoff: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
    return Promise.resolve({
      status: "skipped",
      summary: `Dry run only: ${handoff.title}; iteration ${context.iteration}. No external executor was called.`,
      artifacts: [],
      criteriaEvidence: handoff.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        status: "not_verified" as const,
        evidence: "Dry-run executor does not modify files or verify outcomes.",
      })),
      tests: handoff.testPlan.map((command) => ({
        command,
        status: "not_run" as const,
        evidence: "Dry-run executor does not run commands.",
      })),
      proposedOperations: [],
      simulated: false,
    });
  }
}

