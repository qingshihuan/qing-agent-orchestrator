---
name: qing-agent-orchestrator-full
description: Operate Qing's adaptive Direct, Lite, and Full desktop-first workflow with an optional guarded Codex CLI backend. Use for reviewed engineering work that may require CI, scheduled or unattended runs, app-close persistence, machine-readable control, CLI-only models/environments, process isolation, or an explicit CLI request. Keep ordinary safe work direct and recommend the CLI only for a documented backend need.
---

# Qing Agent Orchestrator Full

Use the smallest sufficient tier before choosing a model:

- **Direct:** parent completes safe single-scope work; no child, model allocation, independent Reviewer, Handoff approval, or CLI probe.
- **Lite:** at most one Executor, parent verification, and at most one revision.
- **Full:** structured Handoff, bounded Executor budget, independent Reviewer, and bounded revisions; use only for high-risk/global/external effects, cross-system work, genuinely parallel work, release/deploy, explicit Full/Level 3, or an accepted process-backend need.

Reclassify the **remaining phase** on every new user turn and immediately before child creation, reactivation, revision, or review; never retain Full only because an earlier phase needed it. De-escalate Full → Lite → Direct whenever the remaining phase permits. Keep a pending independent-review obligation for an unaccepted high-risk artifact through any temporary downgrade, and restore Full only immediately before final acceptance. Full defaults to at most two children and one revision unless an explicit bounded configuration overrides those defaults.

For an enforced v0.8 Relay phase, Direct returns `PARENT_ACTION_REQUIRED` without an Executor or Reviewer; Lite may run one Executor then returns `PARENT_VERIFICATION_REQUIRED` with that actual execution evidence and no fabricated Review. Neither is completion, and any pending final-review obligation remains intact.

Use milestone-driven coordination: wait once for a bounded event or terminal result, then make one takeover/replacement decision only after a real no-progress timeout. Do not repeatedly poll unchanged state, interrupt a live child merely for slowness, or enter an interrupt/reactivate loop.

Read [orchestrator-spec.md](references/orchestrator-spec.md) for deterministic routing, [safety-gates.md](references/safety-gates.md) for effect approvals, and [reviewer-rules.md](references/reviewer-rules.md) for tiered verification. Select a model/reasoning pair only after a tier justifies delegation. Before creation or reactivation, display only the child role/task, `ChatGPT`/`Codex` ownership, explicit model, and reasoning effort. Do not restate the unchanged-parent invariant or preannounce fallback models. If a replacement is actually used after rejection, disclose the reason and actual replacement in the next progress or final result.

## Optional process backend

Read [execution-modes.md](references/execution-modes.md) only when the request needs a separate process. Do not inspect, install, authenticate, probe, or invoke it during ordinary Direct/Lite work. For a documented condition, display `建议切换 CLI 模式`, explain the concrete benefit, and ask the user to accept or decline.

- Decline: continue all desktop-capable work and disclose only the unavailable backend-specific capability.
- Accept: run the read-only dependency/authentication check. Missing installation or configuration remains a gated global/system change.
- Ready: create a fresh Full Handoff and safety report. If every operation is allowed, return `FULL_EXECUTION_READY`; otherwise request one concise bundle of the exact effect gate IDs.

No recommendation, plan, or ready state starts a real process. `--allow-real-execution` remains an explicit invocation safeguard, but safe declared work needs no separate plan approval. Follow [codex-exec.md](references/codex-exec.md).

Keep the parent model unchanged internally, preserve unrelated work, use only capability-valid same-backend fallbacks, re-gate changed effects, and report real evidence without a per-tool ledger. Report fallback details only when a substitution actually occurred.
