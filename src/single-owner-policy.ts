import { routeTask } from "./task-router.js";
import type { Handoff, OrchestrationConfig } from "./types.js";

/** Contract/effect declarations are authoritative even if prose says "offline". */
export function independentReviewReasons(handoff: Handoff, config?: OrchestrationConfig): string[] {
  const reasons: string[] = [];
  if (handoff.orchestration?.independentReviewer) reasons.push("contract-requires-independent-review");
  if (routeTask(handoff.objective, config ? { orchestration: config } : {}).orchestration.independentReviewer) reasons.push("risk-or-explicit-review-requirement");
  for (const op of handoff.requestedOperations) {
    if (op.risk === "high" || op.risk === "critical" || !["read", "write", "execute_tests"].includes(op.type)) {
      reasons.push("operation-requires-independent-review:" + op.type);
    }
  }
  return [...new Set(reasons)];
}
