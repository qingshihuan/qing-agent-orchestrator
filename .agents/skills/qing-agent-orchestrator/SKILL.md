---
name: qing-agent-orchestrator
description: Operate Qing's adaptive Direct, Lite, and Full workflow inside the ChatGPT/Codex desktop app, with effect-based approvals, bounded child delegation, model/reasoning routing only when delegation is justified, and risk-based review. Use when the user asks ChatGPT and Codex to collaborate, invokes Qing or Level 3, or wants a reviewed multi-step implementation. Skip it for ordinary requests that the parent can complete safely and directly.
---

# Qing Agent Orchestrator Desktop

Optimize for completion, safety, and total consumption. Classify the request with [orchestrator-spec.md](references/orchestrator-spec.md), then select exactly one tier before selecting any child model:

- **Direct** — parent completes the answer or safe single-scope work; zero children, zero independent Reviewer, and no Handoff approval.
- **Lite** — at most one Executor child; the parent performs targeted verification; at most one revision.
- **Full** — structured Handoff, Executor, independent Reviewer, and bounded revisions. Reserve this for high-risk effects, cross-system work, genuinely parallel workstreams, or an explicit Full/Level 3 request.

Reclassify the **remaining phase**, rather than inheriting the tier of earlier work: do so on every new user turn and immediately before child creation, reactivation, revision, or review. A phase may de-escalate Full → Lite → Direct when its remaining scope warrants it. Preserve a pending independent-review obligation for an unaccepted high-risk artifact while routine implementation is lower tier; restore Full only immediately before final acceptance. Full defaults to no more than two children and one revision unless an explicit bounded configuration overrides those defaults.

For an enforced v0.8 Relay phase, Direct returns `PARENT_ACTION_REQUIRED` without an Executor or Reviewer; Lite may run one Executor then returns `PARENT_VERIFICATION_REQUIRED` with that actual execution evidence and no fabricated Review. Neither is completion, and any pending final-review obligation remains intact.

Coordinate a live child by milestone, not repeated unchanged polling: issue one bounded event wait, collect a terminal result, and after a real no-progress timeout make exactly one takeover/replacement decision. Never interrupt a live child merely because it is slow, and never run an interrupt/reactivate loop.

The user's request authorizes declared, in-scope, reversible project reads/writes and nondestructive local build/test work. Evaluate [safety-gates.md](references/safety-gates.md) immediately before consequential effects. Pause only for the exact gated effects, preferably as one concise approval bundle; do not require a separate plan approval.

For Lite or Full, score only the justified delegated role and select a capability-valid model/reasoning pair. Before every child creation or reactivation, display only its `ChatGPT`/`Codex` ownership, role, task, explicit model, and reasoning effort. Do not repeat that the parent model remains unchanged; it is an internal invariant. If selection cannot be verified, state `inherited/unconfirmed`. Keep the capability-valid same-backend fallback chain internal. Do not preannounce fallback models; only after a replacement is actually used, disclose the rejected pair, reason, and actual replacement in the next progress or final result.

Use [handoff-protocol.md](references/handoff-protocol.md) and `schemas/handoff.schema.json` only for Full or when a material effect needs an exact operation contract. Apply [reviewer-rules.md](references/reviewer-rules.md) by tier and validate a Full review against `schemas/review.schema.json`. Re-gate new effects or scope expansion, preserve unrelated work, and never treat planning, mock output, or a live child as completion evidence.

Report the final outcome, high-level `executionOwner` (`ChatGPT` or `Codex` only), changed artifacts, relevant verification, remaining limits, and any fallback substitution. Do not produce a concrete tool ledger.
