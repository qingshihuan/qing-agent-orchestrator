import type { ExecutionResult, Handoff } from "../types.js";
import type { ExecutionContext, Executor } from "./executor.js";

export class MockExecutor implements Executor {
  readonly name = "mock";

  async execute(handoff: Handoff, context: ExecutionContext): Promise<ExecutionResult> {
    const firstPass = context.iteration === 1;
    return Promise.resolve({
      status: "succeeded",
      summary: firstPass
        ? "Simulated first attempt with one missing acceptance criterion."
        : "Simulated revised attempt satisfying every declared criterion.",
      artifacts: firstPass ? handoff.deliverables.slice(0, 1) : [...handoff.deliverables],
      criteriaEvidence: handoff.acceptanceCriteria.map((criterion, index) => ({
        id: criterion.id,
        status: firstPass && index === handoff.acceptanceCriteria.length - 1 ? "fail" : "pass",
        evidence:
          firstPass && index === handoff.acceptanceCriteria.length - 1
            ? "Mock scenario intentionally leaves the final criterion incomplete."
            : "Mock scenario reports this criterion as satisfied.",
      })),
      tests: handoff.testPlan.map((command) => ({
        command,
        status: firstPass ? "not_run" : "passed",
        evidence: firstPass ? "Mock first attempt did not run tests." : "Mock test result; no real process ran.",
      })),
      proposedOperations: [],
      simulated: true,
    });
  }
}

