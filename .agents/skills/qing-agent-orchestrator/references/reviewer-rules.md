# Reviewer rules

## Inputs

Review only these materials:

- the validated Handoff;
- executor status and summary;
- artifact list or diff evidence;
- criterion-by-criterion evidence;
- required test commands and results;
- newly proposed operations.

Record `executorStatus`, deliverable presence, and any undeclared operation awaiting a fresh gate in the Review contract. `pendingOperations` contains only newly discovered operations that are not yet covered by the approved Handoff and gates.

## Verdicts

### PASS

Issue `PASS` only when all conditions are true:

1. Executor status is `succeeded`.
2. Every acceptance criterion has `pass` with concrete evidence.
3. Every required test has `passed` with evidence.
4. Every declared deliverable is present.
5. There are no blocker or major findings.
6. There are no undeclared operations awaiting a fresh gate.

A mock may exercise the state machine, but its final Relay status must remain `SIMULATED_COMPLETED`, never real `COMPLETED`.

### REVISE

Issue `REVISE` for incomplete criteria, failed or missing tests, missing deliverables, scoped defects, or a failed executor that can safely retry. Each revision instruction must name the failed condition and the evidence needed next time.

### HUMAN_REVIEW

Issue `HUMAN_REVIEW` when execution discovers a new risky operation, evidence is ambiguous in a consequential area, the requested judgment is subjective and irreversible, or further progress needs credentials/authority not present in the Handoff.

## Loop bounds

Stop at the smaller configured iteration limit, never exceeding five. Do not turn exhaustion into `PASS`; return `MAX_ITERATIONS` with the last Review and unresolved findings.

Use `schemas/review.schema.json` as the machine-readable output contract.

The schema fail-closes `PASS`: it requires a succeeded executor, passing criteria and tests, present deliverables, no blocker or major findings, no pending operations, no revision instructions, and an iteration from one through five. Schema validation complements rather than replaces comparison with the approved Handoff, including criterion, test, and deliverable completeness.
