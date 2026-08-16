import type { CriterionAudit, CriterionEvidence, ExecutionResult, Handoff, RelayCriterionEvidence, Review, TrustedCommandEvidence } from "./types.js";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface Reviewer {
  review(handoff: Handoff, execution: ExecutionResult, iteration: number, relayEvidence?: readonly RelayCriterionEvidence[], trustedCommands?: readonly TrustedCommandEvidence[]): Promise<Review>;
}

export class RuleBasedReviewer implements Reviewer {
  async review(handoff: Handoff, execution: ExecutionResult, iteration: number, relayEvidence: readonly RelayCriterionEvidence[] = [], trustedCommands?: readonly TrustedCommandEvidence[]): Promise<Review> {
    relayEvidence = relayEvidence.filter((item) => item.iteration === iteration);
    const criterionAudit: CriterionAudit[] = handoff.acceptanceCriteria.map((criterion) => {
      const executor = execution.criteriaEvidence.find(({ id }) => id === criterion.id) ?? null;
      const external = relayEvidence.filter(({ criterionId }) => criterionId === criterion.id);
      const relayFails = external.some(({ result }) => result === "fail");
      const relayPasses = external.some(({ result }) => result === "pass");
      const executorFails = executor?.status === "fail";
      const executorPasses = executor?.status === "pass";
      let status: CriterionEvidence["status"] = "not_verified";
      if (executorFails || relayFails) status = "fail";
      else if (criterion.verificationOwner === "executor") status = executorPasses ? "pass" : "not_verified";
      else if (criterion.verificationOwner === "relay") status = relayPasses ? "pass" : "not_verified";
      else status = executorPasses && relayPasses ? "pass" : "not_verified";
      return {
        id: criterion.id,
        verificationOwner: criterion.verificationOwner,
        status,
        executorEvidence: executor,
        relayEvidenceIds: external.map(({ evidenceId }) => evidenceId),
        evidence: [executor ? `executor:${executor.status}:${executor.evidence}` : "executor:none", ...external.map((item) => `relay:${item.evidenceId}:${item.result}:${item.evidence}`)].join(" | "),
      };
    });
    const criteria: CriterionEvidence[] = criterionAudit.map(({ id, status, evidence }) => ({ id, status, evidence }));
    const tests = handoff.testPlan.map((command) => {
      if (trustedCommands !== undefined) {
        const matches = trustedCommands.filter((item) => item.iteration === iteration && item.runId && item.handoffId === handoff.id && item.command === command);
        const item = matches[0];
        const consistent = matches.length === 1 && item?.exitCode === 0 && !item.timedOut && !item.cancelled && !item.outputLimitExceeded && item.spawnError === null && Boolean(item.startedAt) && Boolean(item.endedAt);
        return { command, status: consistent ? "passed" as const : "failed" as const, evidence: consistent ? `Relay parent process executed the exact declared command with exitCode 0 (${item!.startedAt}..${item!.endedAt}).` : `Relay parent test evidence count=${matches.length}; expected one complete, bound, successful record.` };
      }
      return execution.tests.find((item) => item.command === command) ?? { command, status: "not_run" as const, evidence: "Executor returned no evidence for this test." };
    });
    const missingDeliverables = [] as Handoff["deliverables"];
    for (const deliverable of handoff.deliverables) {
      const reported = execution.artifacts.some((artifact) => artifact.path === deliverable.path);
      let exists = false;
      try { exists = (await stat(resolve(handoff.workspace.root, deliverable.path))).isFile() || (await stat(resolve(handoff.workspace.root, deliverable.path))).isDirectory(); }
      catch { exists = false; }
      if (!reported || !exists) missingDeliverables.push(deliverable);
    }
    const findings: Review["findings"] = [];
    const revisionInstructions: string[] = [];
    if (execution.status !== "succeeded") findings.push({ severity: "blocker", message: `Executor status was ${execution.status}: ${execution.summary}` });
    if (execution.simulated) findings.push({ severity: "blocker", message: "Simulated executor evidence cannot receive PASS." });
    for (const criterion of criteria.filter(({ status }) => status !== "pass")) {
      findings.push({ severity: "major", message: `Acceptance criterion ${criterion.id} is ${criterion.status}.` });
      revisionInstructions.push(`Satisfy ${criterion.id} and provide evidence from its declared verification owner.`);
    }
    for (const item of tests.filter(({ status }) => status !== "passed")) findings.push({ severity: "major", message: `Required test was ${item.status}: ${item.command}` });
    for (const deliverable of missingDeliverables) findings.push({ severity: "major", message: `Missing deliverable: ${deliverable.path}`, path: deliverable.path });
    if (execution.proposedOperations.length) findings.push({ severity: "blocker", message: "Executor proposed new operations that require a fresh safety-gate evaluation." });
    const needsHumanReview = execution.proposedOperations.length > 0;
    const passed = execution.status === "succeeded" && !execution.simulated && criteria.every(({ status }) => status === "pass") && tests.every(({ status }) => status === "passed") && missingDeliverables.length === 0 && !needsHumanReview;
    const verdict: Review["verdict"] = needsHumanReview ? "HUMAN_REVIEW" : passed ? "PASS" : "REVISE";
    return { version: "1.0", handoffId: handoff.id, iteration, verdict, summary: `${verdict}: ${findings.length} finding(s).`, criteria, criterionAudit, findings, tests, revisionInstructions };
  }
}
