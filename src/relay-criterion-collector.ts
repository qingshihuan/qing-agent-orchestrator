import type { Handoff, RelayCriterionEvidence, RelayVerification, RunEvent } from "./types.js";
import type { RunHandle } from "./run-store.js";

const allowedFields: Record<string, ReadonlySet<string>> = {
  "process.started": new Set(["pid"]),
  "process.exited": new Set(["exitCode", "state"]),
  "process.heartbeat": new Set(["iteration", "pid", "elapsedMs"]),
  "sandbox.preflight": new Set(["ok", "effectiveSandbox", "requiresHumanReview"]),
};

function compare(actual: unknown, verification: RelayVerification): boolean {
  const expected = verification.expected;
  switch (verification.operator) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && Number.isFinite(actual) && actual >= expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && Number.isFinite(actual) && actual <= expected;
  }
}

function observe(events: readonly RunEvent[], verification: RelayVerification): { pass: boolean; evidence: string } {
  const selected = events.filter(({ type }) => type === verification.eventType);
  if (verification.kind === "event-count") {
    const pass = compare(selected.length, verification);
    return { pass, evidence: `Observed ${selected.length} ${verification.eventType} event(s); required ${verification.operator} ${verification.expected}.` };
  }
  if (!allowedFields[verification.eventType]?.has(verification.field)) throw new Error("Relay payload field is not on the collector whitelist.");
  const values = selected.map(({ payload }) => payload?.[verification.field]);
  const pass = values.some((value) => compare(value, verification));
  return { pass, evidence: `Observed ${selected.length} ${verification.eventType} event(s); payload ${verification.field} ${verification.operator} ${JSON.stringify(verification.expected)} matched=${pass}.` };
}

export async function collectRelayCriterionEvidence(
  handoff: Handoff,
  runHandle: RunHandle,
  iteration: number,
  clock: () => string = () => new Date().toISOString(),
): Promise<RelayCriterionEvidence[]> {
  await runHandle.appendEvent("relay-collector.started", "reviewing", iteration, "Trusted Relay event collection started.", { criterionCount: handoff.acceptanceCriteria.filter(({ verificationOwner }) => verificationOwner !== "executor").length });
  try {
    // Parent-owned observations are scoped to this attempt. Earlier failures
    // remain auditable on disk but cannot poison or satisfy a later revision.
    const events = (await runHandle.readEvents()).filter((event) => event.iteration === iteration);
    const evidence = handoff.acceptanceCriteria.flatMap((criterion): RelayCriterionEvidence[] => {
      if (criterion.verificationOwner === "executor") return [];
      const verification: RelayVerification | undefined = (criterion as { relayVerification?: RelayVerification }).relayVerification;
      if (!verification) throw new Error(`Criterion ${criterion.id} has no relayVerification.`);
      const observation = observe(events, verification);
      return [{
        version: "1.0",
        evidenceId: `relay-${iteration}-${criterion.id.replace(/[^A-Za-z0-9._-]/g, "_")}`,
        source: "relay",
        runId: runHandle.runId,
        handoffId: handoff.id,
        criterionId: criterion.id,
        iteration,
        result: observation.pass ? "pass" : "fail",
        evidence: observation.evidence,
        recordedAt: clock(),
      }];
    });
    await runHandle.appendEvent("relay-collector.completed", "reviewing", iteration, "Trusted Relay event collection completed.", { evidenceCount: evidence.length, passCount: evidence.filter(({ result }) => result === "pass").length, failCount: evidence.filter(({ result }) => result === "fail").length });
    return evidence;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runHandle.appendEvent("relay-collector.rejected", "reviewing", iteration, "Trusted Relay event collection rejected.", { reason: message.slice(0, 300) });
    throw error;
  }
}
