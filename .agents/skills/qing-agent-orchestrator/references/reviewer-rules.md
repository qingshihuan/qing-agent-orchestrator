# Tiered verification rules

## Direct

Do not create an independent Reviewer. For executable work, the parent checks the most relevant artifact/diff and runs proportionate nondestructive verification. Advice needs no synthetic review phase.

## Lite

The parent verifies the Executor's changed artifacts, acceptance checks, and fresh relevant tests. Permit at most one scoped revision. Escalate to Full only if evidence reveals high risk, cross-system effects, material ambiguity, or genuinely independent workstreams.

## Full

Use an independent Reviewer. PASS requires executor success, concrete evidence for every criterion, required tests passed, deliverables present, no blocker/major finding, and no undeclared effect awaiting a gate. Use REVISE for bounded scoped defects and HUMAN_REVIEW for new consequential effects, credentials/authority, cross-backend fallback, or material ambiguity.

Do not repeat every trusted fresh check merely to create a second transcript; rerun critical, failed, stale, or untrusted checks. Never turn mock, dry-run, planning, or an active child into real completion. Record any model fallback audit and keep the final owner limited to `ChatGPT` or `Codex`.
