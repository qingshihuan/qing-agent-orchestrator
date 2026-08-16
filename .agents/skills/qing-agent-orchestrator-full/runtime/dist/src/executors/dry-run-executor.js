export class DryRunExecutor {
    name = "dry-run";
    async execute(handoff, context) {
        return Promise.resolve({
            status: "skipped",
            summary: `Dry run only: ${handoff.title}; iteration ${context.iteration}. No external executor was called.`,
            artifacts: [],
            criteriaEvidence: handoff.acceptanceCriteria.map((criterion) => ({
                id: criterion.id,
                status: "not_verified",
                evidence: "Dry-run executor does not modify files or verify outcomes.",
            })),
            tests: handoff.testPlan.map((command) => ({
                command,
                status: "not_run",
                evidence: "Dry-run executor does not run commands.",
            })),
            proposedOperations: [],
            simulated: false,
        });
    }
}
