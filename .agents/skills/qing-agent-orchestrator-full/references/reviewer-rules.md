# Tiered reviewer rules

Direct has no independent Reviewer; the parent performs proportionate checks for executable work. Lite uses parent verification and at most one revision. Full uses an independent Reviewer and the configured bounded revision loop.

Full PASS requires executor success, concrete criterion evidence, required tests passed, deliverables present, no blocker/major finding, and no undeclared effect awaiting a gate. Use REVISE for scoped defects and HUMAN_REVIEW for new consequential effects, credentials/authority, cross-backend fallback, or material ambiguity.

Rerun critical, failed, stale, or untrusted evidence rather than duplicating every fresh trusted test. Never promote planning, mock/dry-run output, or an active process to real completion. Preserve the fallback audit and limit ownership labels to `ChatGPT` or `Codex`.

When a high-risk artifact remains unaccepted, preserve the independent-review obligation even if the immediately preceding evidence or repair phase was reclassified Lite or Direct. The Reviewer is routed only at final acceptance, not repeatedly after each unchanged status observation.
