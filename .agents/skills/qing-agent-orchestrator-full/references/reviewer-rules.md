# Reviewer rules

PASS requires executor success, concrete evidence for every criterion, every required test passed, all deliverables present, no blocker/major finding, and no undeclared operation awaiting a new gate.

Require high-level `executionOwner` to be exactly `ChatGPT` for an outer-parent chat answer or `Codex` for Relay/internal-child/CLI execution. Do not request concrete tool names or a per-tool ledger.

When model routing was explicit, review the fallback plan/audit. If substitution occurred, PASS also requires `executionOwner: Codex`, planned and actual model/reasoning pairs, the fallback reason, ordered chain and attempts, plus a complete explicit scope proof showing backend, operations, allowed paths, sandbox, permissions, and effects were unchanged. Missing/incomplete proof, a cross-backend replacement, or any scope change requires HUMAN_REVIEW and a fresh gate.

Use REVISE for scoped defects, missing evidence, failed tests, or missing artifacts. State the failed condition and evidence required next. Use HUMAN_REVIEW for new risky operations, consequential ambiguity, credentials, or authority not in the Handoff.

Never convert mock, dry-run, a heartbeat, or an active process into real completion. Stop at the configured iteration limit and report unresolved findings.

The final report must use only the high-level `ChatGPT`/`Codex` owner and state that no substitution occurred or disclose the complete fallback audit; successful completion does not erase the fallback history. Do not add a concrete tool ledger.
